import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { CouncilController } from '../../src/game/council/controller';
import { forkSim } from '../../src/game/council/effects';
import type { CityIssue } from '../../src/game/council/issues';
import { CachedTransport, type LlmRequest, type Transport } from '../../src/game/council/llm';
import { EpisodicMemory, decisionRecord, memoryLine, relevance, type DecisionRecord } from '../../src/game/council/memory';
import { memoryKV, type KV } from '../../src/game/council/storage';
import { NO_DELTA } from '../../src/game/council/effects';
import { EMPTY_STATS, estimateTokens, loadStats, loadTraces } from '../../src/game/council/telemetry';
import type { Sim } from '../../src/sim/sim';
import type { Speed } from '../../src/sim/state';
import { ui } from '../../src/ui/store';
import { grownTown, runTicks } from './town';

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

let town: Sim;
beforeAll(() => {
  town = grownTown(150);
  town.traffic.hour = 18;
  runTicks(town, 1500);
});

let sim: Sim;
let kv: KV;
beforeEach(() => {
  sim = forkSim(town);
  sim.traffic.hour = 18;
  runTicks(sim, 1500);
  kv = memoryKV();
  ui.council.value = null;
  ui.trace.value = null;
  ui.aiStats.value = EMPTY_STATS;
});

function controller(): CouncilController {
  let speed: Speed = 1;
  const c = new CouncilController({ sim, cityName: () => 'Testville', lookAt: () => {}, speed: () => speed, setSpeed: (s) => (speed = s), chime: () => {}, kv });
  c.auto = false;
  c.forceDemo = true;
  return c;
}

/** Convenes on an issue kind and plays the offline debate through to the recommendation. */
async function debate(c: CouncilController, kind: string): Promise<void> {
  c.update(2.01);
  const issue = c.issues.find((i) => i.kind === kind);
  expect(issue, `the test town has a ${kind} problem`).toBeDefined();
  c.convene(issue!.key);
  c.start('', 'en', true);
  for (let i = 0; i < 1000 && c.consulting; i++) {
    await sleep(10);
    c.update(0);
  }
  c.skip();
  expect(ui.council.value?.phase).toBe('decided');
}

describe('human in the loop', () => {
  it('shows the mayor every option with its measured payload before anything is said', () => {
    const c = controller();
    c.update(2.01);
    c.convene(c.issues.find((i) => i.kind === 'traffic')!.key);
    const v = ui.council.value!;
    expect(v.phase).toBe('brief');
    expect(v.triage.length).toBe(9);
    expect(v.triage.filter((t) => t.role !== 'standby').map((t) => t.ministry)).toEqual(v.seats.map((s) => s.id));
    for (const o of v.options) {
      expect(o.effects.budgetDelta + 0).toBe(-o.cost + 0);
      expect(o.feasibility.status).toBeDefined();
    }
    const trace = ui.trace.value!;
    expect(trace.node).toBe('triage');
    expect(trace.trigger).toMatch(/severity \d+%/);
    expect(trace.spans).toEqual([]);
    c.close();
    expect(ui.trace.value!.node).toBe('aborted');
  });

  it('executes the approved option as one transaction and the city changes as the payload said', async () => {
    const c = controller();
    await debate(c, 'traffic');
    const v = ui.council.value!;
    const rec = v.options.find((o) => o.id === v.decision!.option)!;
    const funds = sim.state.funds;
    c.approve(rec.id);
    const after = ui.council.value!;
    expect(after.phase).toBe('enacted');
    expect(after.result!.ok).toBe(true);
    expect(after.result!.drift).toEqual([]);
    expect(sim.state.funds).toBe(funds + rec.effects.budgetDelta);
    const trace = ui.trace.value!;
    expect(trace.node).toBe('done');
    expect(trace.transitions.map((t) => t.to).slice(-2)).toEqual(['execute', 'done']);
    expect(trace.execution!.observed!.budgetDelta).toBe(rec.effects.budgetDelta);
    expect(trace.attribution).toMatchObject({ chosen: rec.id, recommended: rec.id, followedChair: true });
    expect(trace.attribution!.proposedBy).not.toBeNull();
    // Lifetime numbers and the trace survive a reload.
    expect(loadStats(kv)).toMatchObject({ meetings: 1, decisions: 1, followedChair: 1 });
    expect(loadTraces(kv)[0]!.attribution!.chosen).toBe(rec.id);
    // Approving twice does nothing: the graph has left the mayor's node.
    c.approve(rec.id);
    expect(sim.state.funds).toBe(funds + rec.effects.budgetDelta);
    c.close();
  });

  it('records who proposed the option when the mayor overrules the council', async () => {
    const c = controller();
    await debate(c, 'traffic');
    const v = ui.council.value!;
    const other = v.options.find((o) => o.id !== v.decision!.option && !o.hasActions)!;
    c.approve(other.id);
    const trace = ui.trace.value!;
    expect(trace.attribution).toMatchObject({ chosen: other.id, followedChair: false });
    expect(trace.transitions.find((t) => t.to === 'execute')!.reason).toMatch(/overruling/);
    expect(loadStats(kv)).toMatchObject({ decisions: 1, followedChair: 0 });
    c.close();
  });

  it('leaves the city untouched and returns the choice to the mayor when execution is refused', async () => {
    const c = controller();
    await debate(c, 'traffic');
    const v = ui.council.value!;
    const costly = v.options.find((o) => o.cost > 0)!;
    // The treasury empties while the mayor is thinking.
    sim.state.funds = 0;
    const roads = sim.state.roads.edges.length;
    c.approve(costly.id);
    const after = ui.council.value!;
    expect(after.phase).toBe('decided');
    expect(after.result!.ok).toBe(false);
    expect(after.result!.text).toMatch(/Nothing was changed/);
    expect(sim.state.funds).toBe(0);
    expect(sim.state.roads.edges.length).toBe(roads);
    expect(ui.trace.value!.node).toBe('hitl');
    // The mayor can still choose something that works.
    c.approve(v.options[v.options.length - 1]!.id);
    expect(ui.council.value!.phase).toBe('enacted');
    c.close();
  });

  it('takes the loan first when the mayor approves an option the treasury cannot cover', async () => {
    sim.state.loans = [];
    const c = controller();
    c.update(2.01);
    const key = c.issues.find((i) => i.kind === 'traffic')!.key;
    sim.state.funds = 200;
    c.convene(key);
    const option = ui.council.value!.options.find((o) => o.feasibility.status === 'needs_loan');
    expect(option, 'an option that needs a loan').toBeDefined();
    expect(option!.financing!.amount).toBeGreaterThanOrEqual(option!.feasibility.shortfall);
    c.start('', 'en', true);
    for (let i = 0; i < 1000 && c.consulting; i++) {
      await sleep(10);
      c.update(0);
    }
    c.skip();
    c.approve(option!.id, true);
    expect(ui.council.value!.result!.ok).toBe(true);
    expect(sim.state.loans.length).toBe(1);
    expect(sim.state.funds).toBe(200 + option!.financing!.amount - option!.cost);
    expect(ui.trace.value!.execution!.observed!.debtDelta).toBeGreaterThan(0);
    c.close();
  });
});

describe('episodic memory', () => {
  const issue = (kind: CityIssue['kind'], key = kind, lead: CityIssue['lead'] = 'roads'): CityIssue => ({ key, kind, lead, severity: 0.6, title: `A ${kind} problem`, summary: '', facts: [], x: 0, z: 0 });
  const rec = (at: number, kind: CityIssue['kind'], over: Partial<DecisionRecord> = {}): DecisionRecord => ({
    ...decisionRecord({ at, date: `hour ${at}` }, issue(kind), ['roads', 'finance'], { title: `Fix ${kind}`, acted: true }, { ...NO_DELTA, budgetDelta: -1200, hourlyNetDelta: -40 }, true),
    ...over,
  });

  it('writes one compact line per decision', () => {
    const line = memoryLine(rec(212, 'traffic', { optionTitle: 'Widen Canal Street to a four-lane avenue', budgetDelta: -4200, hourlyNetDelta: -642, residentsDisplaced: 38, followedChair: false }));
    expect(line).toBe('hour 212, A traffic problem: Widen Canal Street to a four-lane avenue (-$4,200 now, -$642/hour, 38 residents displaced); mayor overruled the council.');
    expect(estimateTokens(line)).toBeLessThan(45);
    expect(memoryLine(rec(3, 'traffic', { acted: false }))).toMatch(/took no action\.$/);
  });

  it('recalls by relevance, not by recency alone, and at most three', () => {
    const m = new EpisodicMemory(memoryKV(), 'city');
    m.record(rec(10, 'traffic'));
    m.record(rec(20, 'health', { lead: 'health', seated: ['health'] }));
    m.record(rec(30, 'budget', { lead: 'finance', debtDelta: 54000, budgetDelta: 50000 }));
    m.record(rec(40, 'crime', { lead: 'safety', seated: ['safety'], budgetDelta: -500 }));
    m.record(rec(50, 'traffic', { issueKey: 'traffic:other' }));
    const got = m.recall(issue('traffic', 'traffic'), 60, { moneyAtStake: true });
    expect(got.length).toBe(3);
    // The same problem outranks a newer one of the same kind; the loan is remembered because money is at stake.
    expect(got[0]!.record.at).toBe(10);
    expect(got[0]!.why).toContain('same problem');
    expect(got.map((g) => g.record.issueKind).sort()).toEqual(['budget', 'traffic', 'traffic']);
    // Unrelated decisions are not recalled at all.
    expect(m.recall(issue('education', 'education', 'education'), 60).length).toBe(0);
    // A minister remembers only what their department was part of.
    expect(m.recall(issue('traffic'), 60, { moneyAtStake: true, ministry: 'safety' }).length).toBe(0);
    expect(m.recall(issue('traffic'), 60, { moneyAtStake: true, ministry: 'finance', limit: 2 }).length).toBe(2);
  });

  it('fades old decisions and forgets the future when a save is rewound', () => {
    const fresh = relevance(rec(100, 'traffic'), issue('traffic'), 101, false).score;
    const old = relevance(rec(100, 'traffic'), issue('traffic'), 2000, false).score;
    expect(old).toBeLessThan(fresh);
    expect(old).toBeGreaterThan(fresh * 0.45);
    const store = memoryKV();
    const m = new EpisodicMemory(store, 'city');
    m.record(rec(10, 'traffic'));
    m.record(rec(90, 'traffic'));
    m.rewindTo(50);
    expect(new EpisodicMemory(store, 'city').all.map((r) => r.at)).toEqual([10]);
    expect(new EpisodicMemory(store, 'another-city').all).toEqual([]);
  });

  it('carries a decision into the next meeting on the same problem', async () => {
    const c = controller();
    await debate(c, 'traffic');
    const first = ui.council.value!;
    const chosen = first.options.find((o) => o.id === first.decision!.option)!;
    c.approve(chosen.id);
    c.close();
    // The same city, later: a new controller, as after a reload.
    runTicks(sim, 400);
    const again = controller();
    again.update(2.01);
    const issue2 = again.issues.find((i) => i.kind === 'traffic') ?? again.issues[0]!;
    again.convene(issue2.key);
    const v = ui.council.value!;
    if (issue2.kind === 'traffic') {
      expect(v.memory.length).toBeGreaterThan(0);
      expect(v.memory[0]).toContain(chosen.hasActions ? chosen.title : 'took no action');
      expect(ui.trace.value!.memory).toEqual(v.memory);
    }
    again.close();
  });
});

describe('response cache', () => {
  it('answers a repeated prompt without calling the model, and survives a reload', async () => {
    const store = memoryKV();
    let calls = 0;
    const inner: Transport = {
      label: 'AI',
      complete: async () => {
        calls++;
        return { text: '{"ok":true}', provider: 'test', usage: { prompt: 50, completion: 5, reasoning: 0 } };
      },
    };
    const req = (user: string): LlmRequest => ({ system: 'sys', user, maxTokens: 100, meta: { role: 'chief', options: [], lang: 'en' } });
    const cache = new CachedTransport(inner, store);
    const a = await cache.complete(req('same question'));
    const b = await cache.complete(req('same question'));
    expect(calls).toBe(1);
    expect(a.cached).toBeUndefined();
    expect(b).toMatchObject({ text: '{"ok":true}', cached: true });
    // The same city a moment later is a different prompt, so a different answer is fetched.
    await cache.complete(req('same question, different city'));
    expect(calls).toBe(2);
    await new CachedTransport(inner, store).complete(req('same question'));
    expect(calls).toBe(2);
  });
});
