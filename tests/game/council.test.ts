import { afterEach, describe, expect, it, vi } from 'vitest';
import { complete, readProviders } from '../../server/llmProxy';
import { briefing } from '../../src/game/council/briefs';
import { forkSim } from '../../src/game/council/effects';
import { EDGES, GraphState, NODES } from '../../src/game/council/graph';
import { detectIssues } from '../../src/game/council/issues';
import { DemoTransport, LlmError, parseJsonReply, type LlmRequest, type Transport } from '../../src/game/council/llm';
import { MINISTERS, MINISTER_BY_ID } from '../../src/game/council/ministries';
import { optionsFor } from '../../src/game/council/options';
import { BUDGET, CouncilSession, prepareMeeting, type Decision, type SessionEvent, type SessionInput } from '../../src/game/council/session';
import { Recorder } from '../../src/game/council/telemetry';
import { MAX_SEATS, attendees, triage } from '../../src/game/council/triage';
import { RoadType } from '../../src/sim/roads/types';
import { cloneState } from '../../src/sim/save/serialize';
import { Sim } from '../../src/sim/sim';
import { rushFactor } from '../../src/sim/traffic/traffic';
import { ZoneType, zoneCode } from '../../src/sim/zoning/zones';
import { grownTown, runTicks } from './town';

describe('rush hour', () => {
  it('peaks at 9:00 and 18:00 and is quiet at night', () => {
    expect(rushFactor(8.75)).toBeGreaterThan(2.2);
    expect(rushFactor(18)).toBeGreaterThan(2.4);
    expect(rushFactor(13)).toBeGreaterThan(0.9);
    expect(rushFactor(13)).toBeLessThan(1.3);
    expect(rushFactor(3)).toBeLessThan(0.3);
    // Staggered hours lower and widen the peaks.
    expect(rushFactor(18, true)).toBeLessThan(rushFactor(18) * 0.7);
    expect(rushFactor(16.3, true)).toBeGreaterThan(rushFactor(16.3));
  });

  it('puts more cars on the road in the rush', () => {
    const sim = grownTown(120, true);
    sim.traffic.hour = 3;
    runTicks(sim, 1500);
    const night = sim.traffic.count;
    sim.traffic.hour = 18;
    runTicks(sim, 1500);
    expect(sim.traffic.count).toBeGreaterThan(night * 4);
  });
});

describe('road upgrade', () => {
  it('widens a street to an avenue, charges for it and clears what is in the way', () => {
    const sim = Sim.create(9);
    sim.state.heights.fill(5);
    sim.state.trees.fill(0);
    sim.state.sandbox = true;
    sim.growthRate = 1;
    sim.apply({ type: 'buildRoad', road: RoadType.Street, ax: 400, az: 400, bx: 720, bz: 400 });
    sim.apply({ type: 'zoneRect', x0: 51, y0: 45, x1: 88, y1: 48, zone: zoneCode(ZoneType.Residential, 1) });
    runTicks(sim, 1500);
    const plan = sim.planUpgrade(0, RoadType.Avenue);
    expect(plan.ok).toBe(true);
    expect(plan.displaced.length).toBeGreaterThan(0);
    sim.state.sandbox = false;
    const funds = sim.state.funds;
    expect(sim.apply({ type: 'upgradeRoad', edge: 0, road: RoadType.Avenue }).ok).toBe(true);
    expect(sim.state.roads.edges[0]!.type).toBe(RoadType.Avenue);
    expect(sim.state.funds).toBe(funds - plan.cost);
    for (const id of plan.displaced) expect(sim.state.buildings[id]).toBeNull();
    expect(sim.apply({ type: 'upgradeRoad', edge: 0, road: RoadType.Avenue }).ok).toBe(false);
  });
});

describe('issues and options', () => {
  const sim = grownTown(150);
  sim.traffic.hour = 18;
  runTicks(sim, 1500);
  const issues = detectIssues(sim);

  it('finds the rush-hour jam and the missing services', () => {
    const kinds = issues.map((i) => i.kind);
    expect(kinds).toContain('traffic');
    expect(kinds).toContain('health');
    for (const i of issues) {
      expect(i.severity).toBeGreaterThanOrEqual(0);
      expect(i.severity).toBeLessThanOrEqual(1);
      expect(i.facts.length).toBeGreaterThan(0);
    }
  });

  it('offers only options that the game can actually carry out', () => {
    for (const issue of issues) {
      const opts = optionsFor(sim, issue);
      expect(opts[opts.length - 1]!.actions).toEqual([]);
      expect(opts.map((o) => o.id)).toEqual(opts.map((_, i) => String.fromCharCode(65 + i)));
      for (const o of opts) {
        expect(o.gist.length, `${issue.kind} ${o.id} has a one-line gist`).toBeGreaterThan(10);
        if (o.actions.length === 0) continue;
        const trial = new Sim(cloneState(sim.state));
        trial.state.funds = 1e9;
        for (const a of o.actions) expect(trial.apply(a).ok, `${issue.kind} ${o.id} ${o.title}: ${JSON.stringify(a)}`).toBe(true);
      }
    }
  });

  it('gives every ministry a briefing from real numbers', () => {
    for (const m of MINISTERS) {
      const lines = briefing(sim, m.id);
      expect(lines.length).toBeGreaterThan(0);
      expect(lines.join(' ')).not.toMatch(/NaN|undefined/);
    }
  });
});

describe('department triage', () => {
  const sim = grownTown(150);
  sim.traffic.hour = 18;
  runTicks(sim, 1500);
  const issues = detectIssues(sim);

  it('scores all nine ministries and seats the lead plus the most exposed', () => {
    for (const issue of issues) {
      const entries = triage(sim, issue, optionsFor(sim, issue));
      expect(entries.length).toBe(9);
      expect(entries[0]!.ministry).toBe(issue.lead);
      expect(entries[0]!.role).toBe('lead');
      const seated = entries.filter((e) => e.role !== 'standby');
      expect(seated.length).toBeLessThanOrEqual(MAX_SEATS);
      for (const e of entries) {
        expect(e.urgency).toBeGreaterThanOrEqual(0);
        expect(e.urgency).toBeLessThanOrEqual(1);
        expect(e.kpi).not.toMatch(/NaN|undefined/);
      }
      // Nobody on standby outranks somebody seated, unless they are not exposed at all.
      const lowestSeated = Math.min(...seated.filter((e) => e.role === 'seated').map((e) => e.urgency), 1);
      for (const e of entries.filter((x) => x.role === 'standby' && x.exposure > 0)) expect(e.urgency).toBeLessThanOrEqual(lowestSeated);
      // A seated ministry always has a concrete reason, backed by a signal.
      for (const e of seated.filter((x) => x.role === 'seated')) expect(e.signals.length).toBeGreaterThan(0);
    }
  });

  it('calls the lead first and brings in finance when options cost money', () => {
    const traffic = issues.find((i) => i.kind === 'traffic')!;
    const seats = attendees(sim, traffic, optionsFor(sim, traffic));
    expect(seats[0]!.id).toBe('roads');
    expect(new Set(seats.map((s) => s.id)).size).toBe(seats.length);
    expect(seats.map((s) => s.id)).toContain('finance');
    for (const s of seats) expect(s.reason.length).toBeGreaterThan(5);
  });
});

describe('council graph', () => {
  it('allows only the moves in the pipeline', () => {
    const g = new GraphState();
    expect(g.node).toBe('detect');
    expect(() => g.go('synthesis', 'skipping ahead')).toThrow(/illegal transition/);
    g.go('triage', 'trigger');
    g.go('debate_r1', 'seated');
    g.go('synthesis', 'agreement');
    expect(() => g.go('hitl', 'no guardrails')).toThrow(/illegal transition/);
    g.go('guardrails', 'check');
    g.go('hitl', 'to the mayor');
    g.go('execute', 'approved');
    g.go('done', 'executed');
    expect(g.history.map((t) => t.to)).toEqual(['triage', 'debate_r1', 'synthesis', 'guardrails', 'hitl', 'execute', 'done']);
    expect(g.tryGo('debate_r1', 'after the end')).toBe(false);
  });

  it('has an edge list for every node, and every edge leads to a node', () => {
    for (const n of NODES) for (const to of EDGES[n]) expect(NODES).toContain(to);
  });
});

/** Runs one meeting and collects what it emitted and recorded. */
async function hold(input: SessionInput, transport: Transport) {
  const events: SessionEvent[] = [];
  const recorder = new Recorder({ mode: 'live', issue: { key: input.issue.key, kind: input.issue.kind, title: input.issue.title, severity: input.issue.severity, lead: input.issue.lead }, day: 0, trigger: 'test', triage: [], limits: input.limits, options: [], memory: [] });
  const graph = new GraphState();
  graph.go('triage', 'test');
  await new CouncilSession(input, transport, (e) => events.push(e), { graph, recorder }).run();
  const said = events.filter((e): e is Extract<SessionEvent, { type: 'said' }> => e.type === 'said').map((e) => e.statement);
  const decision = events.find((e): e is Extract<SessionEvent, { type: 'decision' }> => e.type === 'decision')?.decision as Decision | undefined;
  return { events, said, decision, trace: recorder.trace, graph, rounds: events.filter((e) => e.type === 'round').map((e) => (e as { round: number }).round) };
}

function inputFor(sim: Sim, kind = 'traffic'): SessionInput {
  const issue = detectIssues(sim).find((i) => i.kind === kind)!;
  const m = prepareMeeting(sim, issue);
  return { city: 'Test', issue, options: m.options, seats: m.seats, briefings: m.briefings, limits: m.limits, mayorNote: '', lang: 'en' };
}

/** A model that says exactly what a test tells it to. */
function scripted(reply: (req: LlmRequest) => Record<string, unknown> | string | Error, log: LlmRequest[] = []): Transport {
  return {
    label: 'AI',
    complete: async (req) => {
      log.push(req);
      const r = reply(req);
      if (r instanceof Error) throw r;
      return { provider: 'test · model', text: typeof r === 'string' ? r : JSON.stringify(r), usage: { prompt: 100, completion: 20, reasoning: 0 }, latencyMs: 5 };
    },
  };
}

const agree = (option: string) => (req: LlmRequest) =>
  req.meta.role === 'chief'
    ? { option, summary: `The council agrees on option ${option}.`, dissent: '', conditions: '' }
    : { speak: true, stance: req.meta.lead ? 'propose' : 'support', option, say: `I back option ${option}.`, condition: '' };

describe('council session', () => {
  const sim = grownTown(150);
  sim.traffic.hour = 18;
  runTicks(sim, 1500);

  it('walks the graph to the mayor and ends with a valid, checked recommendation', async () => {
    const input = inputFor(sim);
    const { events, said, decision, graph, trace } = await hold(input, new DemoTransport());
    expect(said[0]!.minister).toBe(input.issue.lead);
    expect(said[0]!.stance).toBe('propose');
    expect(input.options.map((o) => o.id)).toContain(decision!.option);
    expect(['pass', 'flagged']).toContain(decision!.guardrail.status);
    expect(graph.node).toBe('hitl');
    expect(graph.history[0]!.to).toBe('triage');
    expect(graph.history.map((t) => t.to).slice(-3)).toEqual(['synthesis', 'guardrails', 'hitl']);
    expect(trace.transitions.length).toBe(graph.history.length);
    // The offline council costs nothing and is recorded as such.
    expect(trace.totals.llmCalls).toBe(0);
    expect(trace.totals.promptTokens).toBe(0);
    expect(trace.spans.every((s) => s.source === 'policy')).toBe(true);
    expect(events[events.length - 1]!.type).toBe('done');
  });

  it('skips round 2 when the council agrees, saving its calls', async () => {
    const input = inputFor(sim);
    const log: LlmRequest[] = [];
    const { rounds, graph, trace, decision } = await hold(input, scripted(agree('B'), log));
    expect(rounds).toEqual([1, 3]);
    expect(graph.visited('debate_r2')).toBe(false);
    expect(graph.history.find((t) => t.to === 'synthesis')!.reason).toMatch(/round 2 skipped/);
    expect(log.length).toBe(input.seats.length + 1);
    expect(trace.totals.llmCalls).toBe(input.seats.length + 1);
    expect(trace.totals.promptTokens).toBe(100 * log.length);
    expect(trace.totals.measured).toBe(true);
    expect(trace.totals.schemaPass).toBe(log.length);
    expect(decision!.option).toBe('B');
  });

  it('holds round 2 only when contested, and only for the lead and the challengers', async () => {
    const input = inputFor(sim);
    const rebel = input.seats[1]!.id;
    const log: LlmRequest[] = [];
    const reply = (req: LlmRequest) => {
      if (req.meta.role === 'chief') return { option: 'B', summary: 'Most back option B.', dissent: `${MINISTER_BY_ID[rebel].short} prefers C.`, conditions: '' };
      if (req.meta.minister === rebel) return { speak: true, stance: 'oppose', option: 'C', say: 'I object to option B and back option C.', condition: '' };
      return agree('B')(req);
    };
    const { rounds, said, graph, decision } = await hold(input, scripted(reply, log));
    expect(rounds).toEqual([1, 2, 3]);
    expect(graph.history.find((t) => t.to === 'debate_r2')!.reason).toContain(MINISTER_BY_ID[rebel].short);
    const round2 = said.filter((s) => s.round === 2).map((s) => s.minister);
    expect(round2.sort()).toEqual([input.issue.lead, rebel].sort());
    expect(log.length).toBe(input.seats.length + 2 + 1);
    expect(log.length).toBeLessThanOrEqual(BUDGET.maxCalls);
    expect(decision!.tally.C).toEqual([rebel]);
  });

  it('answers a failed call with a stand-in for that seat, so the meeting loses nobody', async () => {
    const input = inputFor(sim);
    const down = input.seats[1]!.id;
    const quiet = input.seats[2]?.id;
    const reply = (req: LlmRequest) => {
      if (req.meta.role === 'minister' && req.meta.minister === down) return new Error('503 overloaded');
      if (req.meta.role === 'minister' && req.meta.minister === quiet) return { speak: false, stance: 'neutral', option: 'none', say: '', condition: '' };
      return agree('B')(req);
    };
    const { events, said, decision, trace } = await hold(input, scripted(reply));
    expect(events.some((e) => e.type === 'failed' && e.who === down)).toBe(true);
    const stood = said.find((s) => s.minister === down)!;
    expect(stood.standIn).toBe(true);
    expect(stood.text.length).toBeGreaterThan(10);
    if (quiet) expect(events.some((e) => e.type === 'silent' && e.who === quiet)).toBe(true);
    const span = trace.spans.find((s) => s.agent === down)!;
    expect(span.source).toBe('policy');
    expect(span.fallbackReason).toMatch(/503/);
    expect(decision).toBeDefined();
  });

  it('opens a circuit breaker on a rate limit and finishes offline without another call', async () => {
    const input = inputFor(sim);
    const log: LlmRequest[] = [];
    const { events, said, decision, trace } = await hold(input, scripted(() => new LlmError('All AI providers failed. 429', 429, true), log));
    // One call found out; the breaker stopped the rest.
    expect(log.length).toBe(1);
    expect(events.some((e) => e.type === 'notice')).toBe(true);
    expect(events.some((e) => e.type === 'error')).toBe(false);
    expect(said.length).toBeGreaterThanOrEqual(input.seats.length);
    expect(said.every((s) => s.standIn)).toBe(true);
    expect(input.options.map((o) => o.id)).toContain(decision!.option);
    expect(decision!.source).toBe('policy');
    expect(trace.spans.filter((s) => s.fallbackReason?.includes('circuit breaker')).length).toBeGreaterThan(0);
    expect(trace.totals.promptTokens).toBe(0);
  });

  it('never spends more than the call budget, however long the debate', async () => {
    const input = inputFor(sim);
    const log: LlmRequest[] = [];
    // Everyone objects to everyone: the most contested meeting possible.
    const reply = (req: LlmRequest) => (req.meta.role === 'chief' ? agree('A')(req) : { speak: true, stance: 'oppose', option: req.meta.lead ? 'A' : 'B', say: 'I object.', condition: '' });
    const { said } = await hold(input, scripted(reply, log));
    expect(log.length).toBeLessThanOrEqual(BUDGET.maxCalls);
    expect(said.filter((s) => s.round === 2).length).toBeLessThanOrEqual(BUDGET.maxRebuttals);
  });

  it('treats an option letter that is not on the table as no option, and repairs fenced JSON', async () => {
    const input = inputFor(sim);
    const reply = (req: LlmRequest) => (req.meta.role === 'chief' ? '{"option": "Z", "summary": "Do Z.", "dissent": "", "conditions": ""}' : '```json\n{"speak": true, "stance": "propose", "option": "Q", "statement": "I propose Q.", "condition": ""}\n```');
    const { said, decision, trace } = await hold(input, scripted(reply));
    expect(said.every((s) => s.option === 'none')).toBe(true);
    expect(said.every((s) => !s.standIn)).toBe(true);
    const minister = trace.spans.find((s) => s.agent !== 'chief')!;
    expect(minister.schema).toBe('repaired');
    expect(minister.repairs.join(' ')).toMatch(/not on the table/);
    // The chair gets no benefit of the doubt: an invented option fails the schema.
    const chair = trace.spans.find((s) => s.agent === 'chief')!;
    expect(chair.schema).toBe('fail');
    expect(chair.source).toBe('policy');
    expect(input.options.map((o) => o.id)).toContain(decision!.option);
  });

  it('shows each minister its own department and lens, not the others', async () => {
    const input = inputFor(sim);
    const log: LlmRequest[] = [];
    await hold(input, scripted(agree('B'), log));
    const promptOf = (id: string) => log.find((r) => r.meta.minister === id && r.meta.round === 1)!;
    const finance = promptOf('finance');
    expect(finance.system).toContain('Fiscal discipline');
    expect(finance.user).toContain('YOUR DEPARTMENT (Finance)');
    expect(finance.user).toMatch(/treasury after \$/);
    // Every agent sees the shared money limits.
    for (const r of log) expect(r.user).toContain('BUDGET: treasury');
    for (const seat of input.seats) {
      const mine = promptOf(seat.id);
      for (const other of input.seats) {
        if (other.id === seat.id) continue;
        expect(mine.user).not.toContain(`YOUR DEPARTMENT (${MINISTER_BY_ID[other.id].short})`);
        // The figures of another department never appear in this agent's prompt.
        for (const line of input.briefings[other.id]) expect(mine.user).not.toContain(line);
      }
      if (seat.id !== 'finance' && seat.id !== input.issue.lead) expect(mine.user).not.toMatch(/treasury after \$/);
    }
    // Only the lead is given every fact of every option; the others get one line each.
    const lead = promptOf(input.issue.lead);
    expect(lead.user.length).toBeGreaterThan(finance.user.length);
    for (const r of log) if (r.schema) expect(r.schema.type).toBe('object');
  });

  it('puts remembered decisions in front of the agents they concern', async () => {
    const input = inputFor(sim);
    const line = 'Day 12 (13 Jan 2030), Budget deficit: Take a $20,000 loan (+$20,000 now, -$900/month).';
    const log: LlmRequest[] = [];
    await hold({ ...input, memory: { chair: [line], byMinister: { finance: [line] } } }, scripted(agree('B'), log));
    expect(log.find((r) => r.meta.role === 'chief')!.user).toContain(line);
    expect(log.find((r) => r.meta.minister === 'finance')!.user).toContain(line);
    expect(log.find((r) => r.meta.minister === input.issue.lead)!.user).not.toContain('PAST DECISIONS');
  });

  it('parses JSON wrapped in fences or chatter', () => {
    expect(parseJsonReply('Sure! ```json\n{"a": 1}\n```')).toEqual({ a: 1 });
    expect(parseJsonReply('no json here')).toBeNull();
    expect(parseJsonReply('[1,2]')).toBeNull();
    expect(parseJsonReply('{"a": "a } in a string"} trailing {')).toEqual({ a: 'a } in a string' });
  });
});

describe('guardrails on the recommendation', () => {
  const rich = grownTown(150);
  rich.traffic.hour = 18;
  runTicks(rich, 1500);

  it('replaces a recommendation the city cannot pay for, by rule and without another model call', async () => {
    const poor = forkSim(rich);
    poor.traffic.hour = 18;
    runTicks(poor, 1500);
    // No money and every loan already taken: nothing that costs money is affordable.
    poor.state.funds = 50;
    poor.state.loans = [0, 1, 2].map((tier) => ({ tier, payment: 100, monthsLeft: 12 }));
    const input = inputFor(poor);
    const costly = input.options.find((o) => o.cost > 50)!;
    expect(costly.feasibility.status).toBe('unaffordable');
    const log: LlmRequest[] = [];
    const { decision } = await hold(input, scripted(agree(costly.id), log));
    expect(decision!.guardrail.status).toBe('overridden');
    expect(decision!.guardrail.original).toBe(costly.id);
    expect(decision!.option).not.toBe(costly.id);
    const chosen = input.options.find((o) => o.id === decision!.option)!;
    expect(chosen.feasibility.status).toBe('ok');
    expect(decision!.guardrail.findings.find((f) => f.check === 'within_spend_ceiling')!.passed).toBe(false);
    expect(decision!.summary).toContain(`option ${chosen.id}`);
    // The override is code: exactly one chair call was made.
    expect(log.filter((r) => r.meta.role === 'chief').length).toBe(1);
  });

  it('flags figures a speaker was never shown', async () => {
    const input = inputFor(rich);
    const reply = (req: LlmRequest) =>
      req.meta.role === 'chief'
        ? { option: 'B', summary: 'Option B saves 73,412 residents a commute.', dissent: '', conditions: '' }
        : { speak: true, stance: req.meta.lead ? 'propose' : 'support', option: 'B', say: req.meta.lead ? 'Option B will cut jams by 61,877 cars.' : 'I back option B.', condition: '' };
    const { said, decision, trace } = await hold(input, scripted(reply));
    const lead = said.find((s) => s.minister === input.issue.lead)!;
    expect(lead.flags?.join(' ')).toMatch(/61,877/);
    expect(said.filter((s) => s.minister !== input.issue.lead).every((s) => !s.flags)).toBe(true);
    const finding = decision!.guardrail.findings.find((f) => f.check === 'grounded_figures')!;
    expect(finding.passed).toBe(false);
    expect(finding.detail).toMatch(/73,412/);
    expect(decision!.guardrail.status).toBe('flagged');
    expect(decision!.option).toBe('B');
    expect(trace.totals.guardrailFlags).toBeGreaterThan(0);
  });
});

describe('AI proxy', () => {
  afterEach(() => vi.unstubAllGlobals());
  const env = {
    LLM_BASE_URL: 'https://a.example/v1/',
    LLM_MODEL: 'model-a',
    LLM_API_KEY: 'key-a',
    LLM_REASONING_EFFORT: 'low',
    FALLBACK1_BASE_URL: 'https://api.groq.com/openai/v1',
    FALLBACK1_MODEL: 'model-b',
    FALLBACK1_API_KEY: 'key-b',
    FALLBACK2_BASE_URL: 'https://c.example',
    FALLBACK2_MODEL: 'model-c',
  };

  it('reads providers in order and skips incomplete ones', () => {
    const ps = readProviders(env);
    expect(ps.map((p) => p.model)).toEqual(['model-a', 'model-b']);
    expect(ps[0]!.baseUrl).toBe('https://a.example/v1');
    expect(ps[0]!.effort).toBe('low');
    expect(ps[1]!.name).toBe('Groq');
  });

  it('falls back to the next provider and retries without JSON mode when it is rejected', async () => {
    const calls: Array<{ url: string; body: Record<string, unknown>; auth: string }> = [];
    vi.stubGlobal('fetch', async (url: string, init: { body: string; headers: Record<string, string> }) => {
      const body = JSON.parse(init.body) as Record<string, unknown>;
      calls.push({ url, body, auth: init.headers.Authorization! });
      if (url.startsWith('https://a.example')) return new Response('{"error":{"message":"overloaded"}}', { status: 503 });
      if (body.response_format) return new Response('{"error":{"message":"response_format not supported"}}', { status: 400 });
      return new Response(JSON.stringify({ choices: [{ message: { content: '{"ok":true}' } }] }), { status: 200 });
    });
    const out = await complete(readProviders(env), { system: 's', user: 'u', json: true });
    expect(out).toMatchObject({ text: '{"ok":true}', provider: 'Groq · model-b', attempts: 3 });
    expect(calls[0]!.url).toBe('https://a.example/v1/chat/completions');
    expect(calls[0]!.auth).toBe('Bearer key-a');
    expect(calls[0]!.body.reasoning_effort).toBe('low');
    expect(calls[1]!.body.response_format).toBeDefined();
    expect(calls[2]!.body.response_format).toBeUndefined();
  });

  it('asks for the schema first, steps down when it is refused, and remembers what worked', async () => {
    const ps = readProviders({ LLM_BASE_URL: 'https://s.example/v1', LLM_MODEL: 'model-s', LLM_API_KEY: 'k' });
    const formats: unknown[] = [];
    vi.stubGlobal('fetch', async (_url: string, init: { body: string }) => {
      const body = JSON.parse(init.body) as { response_format?: { type: string } };
      formats.push(body.response_format?.type);
      if (body.response_format?.type === 'json_schema') return new Response('{"error":{"message":"json_schema is not supported by this model"}}', { status: 400 });
      return new Response(JSON.stringify({ choices: [{ message: { content: '{"ok":true}' }, finish_reason: 'stop' }], usage: { prompt_tokens: 321, completion_tokens: 12, total_tokens: 400 } }), { status: 200 });
    });
    const schema = { type: 'object', properties: { ok: { type: 'boolean' } }, required: ['ok'] };
    const first = await complete(ps, { system: 's', user: 'u', json: true, schema, schemaName: 'ok' });
    // Token counts come from the provider; reasoning is the gap in the total.
    expect(first).toMatchObject({ usage: { prompt: 321, completion: 12, reasoning: 67 }, finish: 'stop', attempts: 2 });
    await complete(ps, { system: 's', user: 'u', json: true, schema, schemaName: 'ok' });
    // The refused mode is not sent a second time.
    expect(formats).toEqual(['json_schema', 'json_object', 'json_object']);
  });

  it('asks for low reasoning effort by default and drops it for a model that refuses it', async () => {
    const ps = readProviders({ LLM_BASE_URL: 'https://e.example/v1', LLM_MODEL: 'model-e', LLM_API_KEY: 'k' });
    const efforts: unknown[] = [];
    vi.stubGlobal('fetch', async (_url: string, init: { body: string }) => {
      const body = JSON.parse(init.body) as { reasoning_effort?: string };
      efforts.push(body.reasoning_effort);
      if (body.reasoning_effort) return new Response('{"error":{"message":"unknown parameter"}}', { status: 400 });
      return new Response(JSON.stringify({ choices: [{ message: { content: '{"ok":true}' } }] }), { status: 200 });
    });
    expect(await complete(ps, { system: 's', user: 'u', json: true })).toMatchObject({ text: '{"ok":true}' });
    await complete(ps, { system: 's', user: 'u', json: true });
    expect(efforts).toEqual(['low', undefined, undefined]);
  });

  it('gives up on a provider that hangs and moves to the next', async () => {
    const ps = readProviders({ LLM_BASE_URL: 'https://slow.example/v1', LLM_MODEL: 'slow', LLM_API_KEY: 'k', FALLBACK1_BASE_URL: 'https://fast.example/v1', FALLBACK1_MODEL: 'fast', FALLBACK1_API_KEY: 'k' });
    vi.stubGlobal('fetch', (url: string, init: { signal: AbortSignal }) => {
      if (url.startsWith('https://fast.example')) return Promise.resolve(new Response(JSON.stringify({ choices: [{ message: { content: '{"ok":true}' } }] }), { status: 200 }));
      return new Promise((_resolve, reject) => init.signal.addEventListener('abort', () => reject(new Error('aborted'))));
    });
    const t0 = Date.now();
    const out = await complete(ps, { system: 's', user: 'u', json: true }, 60);
    expect(out).toMatchObject({ provider: 'fast.example · fast' });
    expect(Date.now() - t0).toBeLessThan(2000);
    // The hanging provider is now resting, so the next request goes straight to the fast one.
    const urls: string[] = [];
    vi.stubGlobal('fetch', (url: string) => {
      urls.push(url);
      return Promise.resolve(new Response(JSON.stringify({ choices: [{ message: { content: '{"ok":true}' } }] }), { status: 200 }));
    });
    await complete(ps, { system: 's', user: 'u', json: true }, 60);
    expect(urls[0]).toContain('fast.example');
  });

  it('reports every failure, and says when it is a rate limit', async () => {
    vi.stubGlobal('fetch', async () => new Response('{"error":{"message":"rate limited"}}', { status: 429 }));
    const out = await complete(readProviders(env), { system: 's', user: 'u' });
    expect('error' in out && out.error).toMatch(/All AI providers failed.*429.*429/);
    expect('error' in out && out.rateLimited).toBe(true);
  });
});
