import { afterEach, describe, expect, it, vi } from 'vitest';
import { complete, readProviders } from '../../server/llmProxy';
import { attendees, briefing } from '../../src/game/council/briefs';
import { detectIssues } from '../../src/game/council/issues';
import { DemoTransport, parseJsonReply, type LlmRequest, type Transport } from '../../src/game/council/llm';
import { MINISTERS, type MinistryId } from '../../src/game/council/ministries';
import { optionsFor } from '../../src/game/council/options';
import { CouncilSession, type SessionEvent } from '../../src/game/council/session';
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
        if (o.actions.length === 0) continue;
        const trial = new Sim(cloneState(sim.state));
        trial.state.funds = 1e9;
        for (const a of o.actions) expect(trial.apply(a).ok, `${issue.kind} ${o.id} ${o.title}: ${JSON.stringify(a)}`).toBe(true);
      }
    }
  });

  it('calls the lead first and only ministers with a stake', () => {
    const traffic = issues.find((i) => i.kind === 'traffic')!;
    const seats = attendees(sim, traffic, optionsFor(sim, traffic));
    expect(seats[0]!.id).toBe('roads');
    expect(seats.length).toBeLessThanOrEqual(6);
    expect(new Set(seats.map((s) => s.id)).size).toBe(seats.length);
    expect(seats.map((s) => s.id)).toContain('finance');
    for (const s of seats) expect(s.reason.length).toBeGreaterThan(5);
  });

  it('gives every ministry a briefing from real numbers', () => {
    for (const m of MINISTERS) {
      const lines = briefing(sim, m.id);
      expect(lines.length).toBeGreaterThan(0);
      expect(lines.join(' ')).not.toMatch(/NaN|undefined/);
    }
  });
});

function sessionInput(sim: Sim) {
  const issue = detectIssues(sim).find((i) => i.kind === 'traffic' || i.kind === 'health')!;
  const options = optionsFor(sim, issue);
  const seats = attendees(sim, issue, options);
  const briefings = Object.fromEntries(MINISTERS.map((m) => [m.id, briefing(sim, m.id)])) as Record<MinistryId, string[]>;
  return { city: 'Test', issue, options, seats, briefings, mayorNote: '', lang: 'en' as const };
}

describe('council session', () => {
  const sim = grownTown(150);
  sim.traffic.hour = 18;
  runTicks(sim, 1500);

  it('runs two rounds and ends with a valid recommendation', async () => {
    const input = sessionInput(sim);
    const events: SessionEvent[] = [];
    await new CouncilSession(input, new DemoTransport(), (e) => events.push(e)).run();
    const rounds = events.filter((e) => e.type === 'round').map((e) => (e as { round: number }).round);
    expect(rounds).toEqual([1, 2, 3]);
    const said = events.filter((e): e is Extract<SessionEvent, { type: 'said' }> => e.type === 'said');
    expect(said[0]!.statement.minister).toBe(input.issue.lead);
    expect(said[0]!.statement.stance).toBe('propose');
    const decision = events.find((e): e is Extract<SessionEvent, { type: 'decision' }> => e.type === 'decision')!;
    expect(input.options.map((o) => o.id)).toContain(decision.decision.option);
    expect(events[events.length - 1]!.type).toBe('done');
  });

  it('lets ministers stay silent and keeps going when one cannot be reached', async () => {
    const input = sessionInput(sim);
    const demo = new DemoTransport();
    const flaky: Transport = {
      label: 'flaky',
      complete: async (req: LlmRequest) => {
        if (req.meta.role === 'minister' && !req.meta.lead && req.meta.minister === input.seats[1]?.id) throw new Error('503 overloaded');
        if (req.meta.role === 'minister' && !req.meta.lead && req.meta.minister === input.seats[2]?.id) return { provider: 't', text: '{"speak": false, "stance": "neutral", "option": "none", "statement": "", "condition": ""}' };
        return demo.complete(req);
      },
    };
    const events: SessionEvent[] = [];
    await new CouncilSession(input, flaky, (e) => events.push(e)).run();
    if (input.seats[1]) expect(events.some((e) => e.type === 'failed' && e.who === input.seats[1]!.id)).toBe(true);
    if (input.seats[2]) expect(events.some((e) => e.type === 'silent' && e.who === input.seats[2]!.id)).toBe(true);
    expect(events.some((e) => e.type === 'decision')).toBe(true);
  });

  it('reports an error when no minister can be reached', async () => {
    const dead: Transport = { label: 'dead', complete: async () => Promise.reject(new Error('All AI providers failed')) };
    const events: SessionEvent[] = [];
    await new CouncilSession(sessionInput(sim), dead, (e) => events.push(e)).run();
    expect(events.some((e) => e.type === 'error')).toBe(true);
    expect(events.some((e) => e.type === 'decision')).toBe(false);
  });

  it('ignores option letters that are not on the table', async () => {
    const input = sessionInput(sim);
    const liar: Transport = {
      label: 'liar',
      complete: async (req: LlmRequest) => ({
        provider: 't',
        text: req.meta.role === 'chief' ? '{"option": "Z", "summary": "Do Z.", "dissent": "", "conditions": ""}' : '```json\n{"speak": true, "stance": "propose", "option": "Q", "statement": "I propose Q.", "condition": ""}\n```',
      }),
    };
    const events: SessionEvent[] = [];
    await new CouncilSession(input, liar, (e) => events.push(e)).run();
    const said = events.filter((e): e is Extract<SessionEvent, { type: 'said' }> => e.type === 'said');
    expect(said.every((e) => e.statement.option === 'none')).toBe(true);
    const decision = events.find((e): e is Extract<SessionEvent, { type: 'decision' }> => e.type === 'decision')!;
    expect(input.options.map((o) => o.id)).toContain(decision.decision.option);
  });

  it('parses JSON wrapped in fences or chatter', () => {
    expect(parseJsonReply('Sure! ```json\n{"a": 1}\n```')).toEqual({ a: 1 });
    expect(parseJsonReply('no json here')).toBeNull();
    expect(parseJsonReply('[1,2]')).toBeNull();
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
    expect(out).toEqual({ text: '{"ok":true}', provider: 'Groq · model-b' });
    expect(calls[0]!.url).toBe('https://a.example/v1/chat/completions');
    expect(calls[0]!.auth).toBe('Bearer key-a');
    expect(calls[0]!.body.reasoning_effort).toBe('low');
    expect(calls[1]!.body.response_format).toBeDefined();
    expect(calls[2]!.body.response_format).toBeUndefined();
  });

  it('reports every failure when all providers fail', async () => {
    vi.stubGlobal('fetch', async () => new Response('{"error":{"message":"rate limited"}}', { status: 429 }));
    const out = await complete(readProviders(env), { system: 's', user: 'u' });
    expect('error' in out && out.error).toMatch(/All AI providers failed.*429.*429/);
  });
});
