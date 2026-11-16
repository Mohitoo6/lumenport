import { beforeAll, describe, expect, it } from 'vitest';
import { anyCompliant, parseInstruction, violations } from '../../src/game/council/constraints';
import { NO_DELTA } from '../../src/game/council/effects';
import { GraphState } from '../../src/game/council/graph';
import { detectIssues } from '../../src/game/council/issues';
import { DemoTransport, type LlmRequest, type Transport } from '../../src/game/council/llm';
import { EpisodicMemory, OUTCOME_AFTER_HOURS, decisionRecord, memoryLine } from '../../src/game/council/memory';
import { CouncilSession, prepareMeeting, type Decision, type SessionEvent, type SessionInput } from '../../src/game/council/session';
import { memoryKV } from '../../src/game/council/storage';
import type { Sim } from '../../src/sim/sim';
import { grownTown, runTicks } from './town';

const ids = (note: string): string[] => parseInstruction(note).map((c) => c.id).sort();

describe('the mayor’s instruction as rules', () => {
  it('reads money caps, upfront and hourly', () => {
    expect(parseInstruction('Keep the upfront cost under $1,500.')).toEqual([{ id: 'max_cost', limit: 1500, label: 'upfront cost at most $1,500' }]);
    expect(parseInstruction('no more than 5k please')[0]).toMatchObject({ id: 'max_cost', limit: 5000 });
    expect(parseInstruction('budget of ₹2 lakh')[0]).toMatchObject({ id: 'max_cost', limit: 200000 });
    expect(parseInstruction('at most $300 an hour')[0]).toMatchObject({ id: 'max_hourly', limit: 300 });
    expect(parseInstruction('under $400/hour and under $9,000').map((c) => [c.id, c.limit])).toEqual([
      ['max_hourly', 400],
      ['max_cost', 9000],
    ]);
    // Two caps: the tighter one holds.
    expect(parseInstruction('under $9,000. Actually under $2,000.')[0]!.limit).toBe(2000);
  });

  it('reads prohibitions, and tells homes from workplaces', () => {
    expect(ids('Do not demolish any homes or workplaces.')).toEqual(['no_demolition']);
    expect(ids("Don't demolish homes.")).toEqual(['no_displacement']);
    expect(ids('No demolition.')).toEqual(['no_demolition']);
    expect(ids('Nobody should be evicted')).toEqual(['no_displacement']);
    expect(ids('no new loans, and do not raise taxes')).toEqual(['no_debt', 'no_tax_rise']);
    expect(ids('Avoid coal.')).toEqual(['no_polluter']);
    expect(ids('Do not demolish any homes. Keep it under $5,000.')).toEqual(['max_cost', 'no_displacement']);
  });

  it('enforces nothing it does not recognise', () => {
    expect(parseInstruction('')).toEqual([]);
    expect(parseInstruction('Be quick about it and think of the children.')).toEqual([]);
    // A positive statement is not a prohibition.
    expect(parseInstruction('Demolish whatever you need to.')).toEqual([]);
    expect(parseInstruction('Raise taxes if you must.')).toEqual([]);
  });
});

/** A model that says exactly what a test tells it to. */
function scripted(reply: (req: LlmRequest) => Record<string, unknown>, log: LlmRequest[] = []): Transport {
  return {
    label: 'AI',
    complete: async (req) => {
      log.push(req);
      return { provider: 'test', text: JSON.stringify(reply(req)), usage: { prompt: 100, completion: 20, reasoning: 0 } };
    },
  };
}

async function hold(input: SessionInput, transport: Transport) {
  const events: SessionEvent[] = [];
  const graph = new GraphState();
  graph.go('triage', 'test');
  const session = new CouncilSession(input, transport, (e) => events.push(e), { graph });
  await session.run();
  return { session, decision: events.find((e): e is Extract<SessionEvent, { type: 'decision' }> => e.type === 'decision')!.decision as Decision, said: events.filter((e): e is Extract<SessionEvent, { type: 'said' }> => e.type === 'said').map((e) => e.statement) };
}

describe('the instruction in a meeting', () => {
  let sim: Sim;
  let input: SessionInput;
  beforeAll(() => {
    sim = grownTown(150);
    sim.traffic.hour = 18;
    runTicks(sim, 1500);
    const issue = detectIssues(sim).find((i) => i.kind === 'traffic')!;
    const m = prepareMeeting(sim, issue);
    input = { city: 'Test', issue, options: m.options, seats: m.seats, briefings: m.briefings, limits: m.limits, mayorNote: '', lang: 'en' };
  });

  it('marks the options it rules out for every agent', async () => {
    const demolishing = input.options.find((o) => o.effects.jobsLost > 0 || o.effects.residentsDisplaced > 0)!;
    expect(demolishing, 'the test town has an option that demolishes something').toBeDefined();
    const log: LlmRequest[] = [];
    const agree = (req: LlmRequest) => (req.meta.role === 'chief' ? { option: 'B', summary: 'Option B.', dissent: '', conditions: '' } : { speak: true, stance: req.meta.lead ? 'propose' : 'support', option: 'B', say: 'I back option B.', condition: '' });
    const { session } = await hold({ ...input, mayorNote: 'Do not demolish any homes or workplaces.' }, scripted(agree, log));
    expect(session.constraints.map((c) => c.id)).toEqual(['no_demolition']);
    for (const r of log) {
      expect(r.user).toContain('Enforced by rule: nothing demolished');
      const line = r.user.split('\n').find((l) => l.startsWith(`${demolishing.id}. `))!;
      expect(line).toContain("AGAINST THE MAYOR'S INSTRUCTION");
    }
    expect(violations(demolishing, session.constraints).length).toBeGreaterThan(0);
    expect(anyCompliant(input.options, session.constraints)).toBe(true);
  });

  it('will not let the council recommend against it while another option respects it', async () => {
    const demolishing = input.options.find((o) => o.effects.jobsLost > 0 || o.effects.residentsDisplaced > 0)!;
    const log: LlmRequest[] = [];
    // Every agent, the chair included, ignores the instruction.
    const defy = (req: LlmRequest) =>
      req.meta.role === 'chief' ? { option: demolishing.id, summary: `Option ${demolishing.id} is the strongest fix.`, dissent: '', conditions: '' } : { speak: true, stance: req.meta.lead ? 'propose' : 'support', option: demolishing.id, say: `I back option ${demolishing.id}.`, condition: '' };
    const { decision, said } = await hold({ ...input, mayorNote: 'No demolition.' }, scripted(defy, log));
    expect(decision.guardrail.status).toBe('overridden');
    expect(decision.guardrail.original).toBe(demolishing.id);
    expect(decision.option).not.toBe(demolishing.id);
    const chosen = input.options.find((o) => o.id === decision.option)!;
    expect(chosen.actions.length).toBeGreaterThan(0);
    expect(chosen.effects.buildingsDemolished).toBe(0);
    expect(decision.summary).toMatch(/against your instruction/);
    // Each minister who backed it is flagged too, and no extra call was made to fix it.
    expect(said.every((s) => s.flags?.some((f) => /against the mayor's instruction/.test(f)))).toBe(true);
    expect(log.filter((r) => r.meta.role === 'chief').length).toBe(1);
  });

  it('says so, without overriding, when no option that acts can meet it', async () => {
    const pick = input.options.find((o) => o.cost > 0)!;
    const agree = (req: LlmRequest) => (req.meta.role === 'chief' ? { option: pick.id, summary: `Option ${pick.id}.`, dissent: '', conditions: '' } : { speak: true, stance: req.meta.lead ? 'propose' : 'support', option: pick.id, say: `I back option ${pick.id}.`, condition: '' });
    // Nothing that acts is free and costs nothing an hour.
    const { decision } = await hold({ ...input, mayorNote: 'under $0 and under $0 an hour' }, scripted(agree));
    const finding = decision.guardrail.findings.find((f) => f.check === 'respects_mayor_instruction')!;
    expect(finding.passed).toBe(false);
    expect(finding.strength).toBe('warn');
    expect(decision.guardrail.status).toBe('flagged');
    expect(decision.option).toBe(pick.id);
  });

  it('is respected by the offline council too', async () => {
    const { decision, said } = await hold({ ...input, mayorNote: 'Do not demolish any homes or workplaces. Keep the upfront cost under $1,500.' }, new DemoTransport());
    const chosen = input.options.find((o) => o.id === decision.option)!;
    expect(chosen.effects.buildingsDemolished).toBe(0);
    expect(chosen.cost).toBeLessThanOrEqual(1500);
    expect(decision.guardrail.findings.find((f) => f.check === 'respects_mayor_instruction')!.passed).toBe(true);
    for (const s of said) expect(violations(input.options.find((o) => o.id === s.option)!, parseInstruction('Do not demolish any homes or workplaces. Keep the upfront cost under $1,500.'))).toEqual([]);
  });
});

describe('memory of outcomes', () => {
  const issue = { key: 'traffic:Canal Street', kind: 'traffic' as const, lead: 'roads' as const, severity: 0.7, title: 'Gridlock on Canal Street', summary: '', facts: [], x: 0, z: 0 };
  const record = (at: number) => decisionRecord({ at, date: `hour ${at}` }, issue, ['roads', 'finance'], { title: 'Widen Canal Street', acted: true }, { ...NO_DELTA, budgetDelta: -2496 }, true);

  it('judges a decision by whether its problem is still detected half a day later', () => {
    const kv = memoryKV();
    const m = new EpisodicMemory(kv, 'city');
    m.record(record(100));
    m.record({ ...record(105), issueKey: 'health:1', issueKind: 'health', issueTitle: 'No clinic nearby' });
    // Too early: nothing is judged.
    expect(m.settle(100 + OUTCOME_AFTER_HOURS - 1, new Set([issue.key]))).toBe(0);
    expect(m.all[0]!.outcome).toBeUndefined();
    // Half a day on, the jam is still being detected; the clinic problem is not.
    expect(m.settle(105 + OUTCOME_AFTER_HOURS, new Set([issue.key]))).toBe(2);
    expect(m.all.map((r) => r.outcome)).toEqual(['persisted', 'resolved']);
    // Judged once, and kept across a reload.
    expect(m.settle(400, new Set())).toBe(0);
    expect(new EpisodicMemory(kv, 'city').all[0]!.outcome).toBe('persisted');
  });

  it('tells the council when a past fix did not work, and ranks that memory higher', () => {
    const m = new EpisodicMemory(memoryKV(), 'city');
    m.record(record(100));
    m.record({ ...record(101), issueKey: 'traffic:Mill Road', optionTitle: 'Staggered office hours (policy)' });
    m.settle(200, new Set([issue.key]));
    const line = memoryLine(m.all[0]!);
    expect(line).toMatch(/Widen Canal Street.*Outcome: the problem was still there half a day later\.$/);
    expect(memoryLine(m.all[1]!)).toMatch(/Outcome: the problem went away\.$/);
    const other = { ...issue, key: 'traffic:King Street' };
    const got = m.recall(other, 210);
    expect(got[0]!.record.optionTitle).toBe('Widen Canal Street');
    expect(got[0]!.why).toContain('it did not fix the problem');
    expect(got[0]!.record.severity).toBe(0.7);
  });
});
