import { mkdirSync, writeFileSync } from 'node:fs';
import { it } from 'vitest';
import { type Provider } from '../../server/llmProxy';
import { evalProviders, patient } from './providers';
import { briefing } from '../../src/game/council/briefs';
import { fiscalLimits } from '../../src/game/council/effects';
import { attendees, type Seat } from '../../src/game/council/triage';
import { detectIssues, type CityIssue } from '../../src/game/council/issues';
import { DemoTransport, type LlmRequest, type Transport } from '../../src/game/council/llm';
import { MINISTERS, type MinistryId } from '../../src/game/council/ministries';
import { optionsFor, type CouncilOption } from '../../src/game/council/options';
import type { Lang } from '../../src/game/council/prompts';
import { CouncilSession, type Decision } from '../../src/game/council/session';
import type { Sim } from '../../src/sim/sim';
import { grownTown, runTicks } from '../game/town';
import { checkStatement, type StatementCheck } from './grade';
import { judgeSystem, judgeUser, parseVerdicts, type JudgedLine, type Verdict } from './judge';
import { writeReport } from './report';

/**
 * Evaluates the AI council against the real providers in .env:
 *   1. a meeting on every kind of problem the test town has (grounding, relevance, rules),
 *   2. the same meeting in Hindi (language rule),
 *   3. a meeting under the mayor's constraints (does the recommendation respect them?),
 *   4. a controlled experiment: one fact changed (option A demolishes 0 homes or 40),
 *      everything else identical, to see whether positions follow the data,
 *   5. a judge calibration: planted bad statements the judge and the checks must catch.
 * Spends free-tier requests and takes 20-40 minutes, so it only runs with EVAL_COUNCIL=1:
 *   EVAL_COUNCIL=1 npx vitest run --config vitest.eval.config.ts
 */

export interface LineRecord {
  id: string;
  minister: MinistryId | 'chief';
  round: number;
  stance: string;
  option: string;
  text: string;
  condition: string;
  provider: string;
  checks?: StatementCheck;
}

export interface MeetingRecord {
  name: string;
  group: 'issue' | 'hindi' | 'constraint' | 'counterfactual';
  variant?: string;
  issue: { kind: string; title: string; lead: MinistryId; facts: string[] };
  options: Array<{ id: string; title: string; cost: number; monthly: number; facts: string[]; displacedHomes: number; jobsLost: number; hasActions: boolean }>;
  seats: Array<{ id: MinistryId; reason: string }>;
  note: string;
  lang: Lang;
  lines: LineRecord[];
  silent: Array<{ who: MinistryId; round: number }>;
  failed: Array<{ who: string; round: number; error: string }>;
  decision: (Omit<Decision, 'tally'> & { tally: Record<string, string[]>; provider: string }) | null;
  /** Each minister's last stated backing. */
  final: Record<string, string>;
  seconds: number;
  judge?: { provider: string; verdicts: Verdict[]; error?: string };
}

export interface CalibrationRecord {
  planted: Array<{ id: string; kind: 'invented-numbers' | 'off-topic' | 'wrong-portfolio'; text: string }>;
  judge?: { provider: string; verdicts: Verdict[]; error?: string };
  checks: Record<string, StatementCheck>;
}

const RUN = process.env.EVAL_COUNCIL === '1';

function speakerTransport(providers: Provider[], calls: Map<string, string>): Transport {
  return {
    label: 'eval',
    complete: async (req: LlmRequest) => {
      // EVAL_DEMO=1 runs the whole pipeline on the scripted ministers (a smoke test, no quota).
      const r = process.env.EVAL_DEMO === '1' ? await new DemoTransport().complete(req) : await patient(providers, { system: req.system, user: req.user, maxTokens: req.maxTokens, json: true, schema: req.schema, schemaName: req.schemaName });
      if ('error' in r) throw new Error(r.error);
      // What this speaker saw, for the grounding check.
      const key = req.meta.role === 'chief' ? 'chief-3' : `${req.meta.minister}-${req.meta.round}`;
      calls.set(key, `${req.system}\n${req.user}`);
      return r;
    },
  };
}

function optionView(o: CouncilOption): MeetingRecord['options'][number] {
  return { id: o.id, title: o.title, cost: o.cost, monthly: o.monthly, facts: o.facts, displacedHomes: o.impact.displacedHomes, jobsLost: o.impact.jobsLost, hasActions: o.actions.length > 0 };
}

interface MeetingSpec {
  name: string;
  group: MeetingRecord['group'];
  variant?: string;
  sim: Sim;
  issue: CityIssue;
  options: CouncilOption[];
  seats?: Seat[];
  note?: string;
  lang?: Lang;
}

async function meeting(spec: MeetingSpec, providers: Provider[]): Promise<MeetingRecord> {
  const { sim, issue, options } = spec;
  const seats = spec.seats ?? attendees(sim, issue, options);
  const lang = spec.lang ?? 'en';
  const note = spec.note ?? '';
  const briefings = Object.fromEntries(MINISTERS.map((m) => [m.id, briefing(sim, m.id)])) as Record<MinistryId, string[]>;
  const calls = new Map<string, string>();
  const valid = options.map((o) => o.id);
  const rec: MeetingRecord = {
    name: spec.name,
    group: spec.group,
    variant: spec.variant,
    issue: { kind: issue.kind, title: issue.title, lead: issue.lead, facts: issue.facts },
    options: options.map(optionView),
    seats: seats.map((s) => ({ id: s.id, reason: s.reason })),
    note,
    lang,
    lines: [],
    silent: [],
    failed: [],
    decision: null,
    final: {},
    seconds: 0,
  };
  const t0 = Date.now();
  await new CouncilSession({ city: 'New Haven', issue, options, seats, briefings, limits: fiscalLimits(sim), mayorNote: note, lang }, speakerTransport(providers, calls), (e) => {
    if (e.type === 'said') {
      const s = e.statement;
      const seen = calls.get(`${s.minister}-${s.round}`) ?? '';
      rec.lines.push({ id: `${s.minister}-${s.round}`, minister: s.minister, round: s.round, stance: s.stance, option: s.option, text: s.text, condition: s.condition, provider: e.provider, checks: checkStatement(s, seen, valid, lang) });
      if (s.option !== 'none') rec.final[s.minister] = s.option;
    } else if (e.type === 'silent') rec.silent.push({ who: e.who, round: e.round });
    else if (e.type === 'failed') rec.failed.push({ who: e.who, round: e.round, error: e.error.slice(0, 200) });
    else if (e.type === 'decision') {
      const d = e.decision;
      rec.decision = { ...d, provider: e.provider };
      const seen = calls.get('chief-3') ?? '';
      rec.lines.push({ id: 'chief', minister: 'chief', round: 3, stance: 'neutral', option: d.option, text: d.summary, condition: d.conditions, provider: e.provider, checks: checkStatement({ option: d.option, text: d.summary, stance: 'neutral' }, seen, valid, lang) });
    }
  }).run();
  rec.seconds = Math.round((Date.now() - t0) / 1000);
  console.log(`[eval] ${spec.name}: ${rec.lines.length} statements, ${rec.silent.length} silent, ${rec.failed.length} failed, recommends ${rec.decision?.option} (${rec.seconds}s)`);
  return rec;
}

async function judge(
  rec: { lines: JudgedLine[]; issue: CityIssue; options: readonly CouncilOption[]; briefings: Partial<Record<MinistryId, string[]>>; note: string },
  providers: Provider[],
): Promise<{ provider: string; verdicts: Verdict[]; error?: string }> {
  const ids = rec.lines.map((l) => l.id);
  if (process.env.EVAL_DEMO === '1') return { provider: '', verdicts: [], error: 'demo run: no judge' };
  for (let attempt = 0; attempt < 2; attempt++) {
    const r = await patient(providers, { system: judgeSystem(), user: judgeUser({ issue: rec.issue, options: rec.options, briefings: rec.briefings, mayorNote: rec.note, lines: rec.lines }), maxTokens: 6000, json: true });
    if ('error' in r) return { provider: '', verdicts: [], error: r.error.slice(0, 300) };
    const verdicts = parseVerdicts(r.text, ids);
    if (verdicts.length >= ids.length * 0.8) return { provider: r.provider, verdicts };
  }
  return { provider: '', verdicts: [], error: 'judge reply could not be parsed' };
}

function judgedLines(rec: MeetingRecord): JudgedLine[] {
  return rec.lines.map((l) => ({ id: l.id, speaker: l.minister, round: l.round, text: l.text, option: l.option }));
}

/** Option A with its demolition fact rewritten: none, or 40 homes. */
function variantA(options: CouncilOption[], harsh: boolean): CouncilOption[] {
  return options.map((o) => {
    if (o.id !== 'A') return o;
    const facts = o.facts.filter((f) => !/demolish|takes the front|no buildings/i.test(f));
    facts.splice(1, 0, harsh ? 'The wider road takes the front of neighbouring lots: demolishes 40 homes (1,380 residents) and 6 workplaces (210 jobs).' : 'The extra width fits inside the existing road reserve: no buildings are demolished.');
    return { ...o, facts, impact: { ...o.impact, displacedHomes: harsh ? 40 : 0, displacedResidents: harsh ? 1380 : 0, jobsLost: harsh ? 210 : 0 } };
  });
}

it.runIf(RUN)(
  'council evaluation against the real AI',
  async () => {
    const ep = await evalProviders();
    const providers = ep.speakers;
    const judgeProviders = ep.judge;
    console.log(`[eval] speakers: ${providers.map((p) => p.model).join(', ')}; judge: ${judgeProviders[0]!.model}; ${ep.notes.join('; ')}`);
    const sim = grownTown(150);
    sim.traffic.hour = 18;
    runTicks(sim, 1500);
    const issues = detectIssues(sim);
    const byKind = new Map<string, CityIssue>();
    for (const i of issues) if (!byKind.has(i.kind)) byKind.set(i.kind, i);
    console.log('[eval] issues:', [...byKind.keys()].join(', '));
    const traffic = byKind.get('traffic');
    if (!traffic) throw new Error('The test town has no traffic issue');
    const meetings: MeetingRecord[] = [];
    const only = process.env.EVAL_ONLY;

    // 1. One meeting per kind of problem.
    for (const [kind, issue] of [...byKind].slice(0, 6)) {
      if (only && only !== 'issues') break;
      meetings.push(await meeting({ name: `issue: ${kind}`, group: 'issue', sim, issue, options: optionsFor(sim, issue) }, providers));
    }
    const trafficOptions = optionsFor(sim, traffic);
    // 2. Hindi.
    if (!only || only === 'hindi') meetings.push(await meeting({ name: 'hindi: traffic', group: 'hindi', sim, issue: traffic, options: trafficOptions, lang: 'hi' }, providers));
    // 3. The mayor's constraints.
    if (!only || only === 'constraint')
      meetings.push(
        await meeting(
          { name: 'constraint: traffic', group: 'constraint', sim, issue: traffic, options: trafficOptions, note: 'Do not demolish any homes or workplaces. Keep the upfront cost under $1,500.' },
          providers,
        ),
      );
    // 4. Controlled experiment, two runs per variant, same seats for both.
    if (!only || only === 'counterfactual') {
      const harsh = variantA(trafficOptions, true);
      const clean = variantA(trafficOptions, false);
      const seats = attendees(sim, traffic, harsh);
      for (let rep = 1; rep <= 2; rep++) {
        meetings.push(await meeting({ name: `counterfactual: A demolishes nothing (run ${rep})`, group: 'counterfactual', variant: 'clean', sim, issue: traffic, options: clean, seats }, providers));
        meetings.push(await meeting({ name: `counterfactual: A demolishes 40 homes (run ${rep})`, group: 'counterfactual', variant: 'harsh', sim, issue: traffic, options: harsh, seats }, providers));
      }
    }

    // Judge every meeting.
    const briefings = Object.fromEntries(MINISTERS.map((m) => [m.id, briefing(sim, m.id)])) as Record<MinistryId, string[]>;
    const optionsOf = (rec: MeetingRecord): CouncilOption[] => {
      const issue = issues.find((i) => i.kind === rec.issue.kind)!;
      const base = optionsFor(sim, issue);
      return rec.variant === 'harsh' ? variantA(base, true) : rec.variant === 'clean' ? variantA(base, false) : base;
    };
    for (const rec of meetings) {
      const issue = issues.find((i) => i.kind === rec.issue.kind)!;
      rec.judge = await judge({ lines: judgedLines(rec), issue, options: optionsOf(rec), briefings, note: rec.note }, judgeProviders);
      console.log(`[eval] judged ${rec.name} via ${rec.judge.provider || rec.judge.error}`);
    }

    // 5. Judge calibration: the first traffic meeting with planted bad statements.
    const base = meetings.find((m) => m.group === 'issue' && m.issue.kind === 'traffic') ?? meetings[0]!;
    const planted: CalibrationRecord['planted'] = [
      { id: 'planted-1', kind: 'invented-numbers', text: 'Widening the road will cut journey times by 64% and save the city $48,000 a year in lost working hours, according to our own survey. I back option A.' },
      { id: 'planted-2', kind: 'off-topic', text: 'Before we spend anything on roads we should bid to host the regional games and build a stadium; tourism would pay for every option on this table. I back option D.' },
      { id: 'planted-3', kind: 'wrong-portfolio', text: 'The real problem here is policing: we need thirty more officers on night patrol and a new station in the north. I back option C.' },
    ];
    const plantedSpeakers: Array<MinistryId | 'chief'> = [base.issue.lead, 'finance', 'environment'];
    const calLines: JudgedLine[] = [
      ...judgedLines(base),
      ...planted.map((p, i) => ({ id: p.id, speaker: plantedSpeakers[i]!, round: 2, text: p.text, option: (p.text.match(/option ([A-E])/) ?? [])[1] ?? 'none' })),
    ];
    const baseIssue = issues.find((i) => i.kind === base.issue.kind)!;
    const calOptions = optionsOf(base);
    const seenAll = `${judgeUser({ issue: baseIssue, options: calOptions, briefings, mayorNote: '', lines: [] })}`;
    const calibration: CalibrationRecord = {
      planted,
      checks: Object.fromEntries(planted.map((p) => [p.id, checkStatement({ option: 'A', text: p.text, stance: 'support' }, seenAll, calOptions.map((o) => o.id), 'en')])),
    };
    calibration.judge = await judge({ lines: calLines, issue: baseIssue, options: calOptions, briefings, note: '' }, judgeProviders);

    const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    mkdirSync('eval/runs', { recursive: true });
    const providerNames = providers.map((p) => p.model);
    const run = { stamp, providers: providerNames, judgeModel: judgeProviders[0]!.model, unavailable: ep.notes, meetings, calibration };
    writeFileSync(`eval/runs/council-${stamp}.json`, JSON.stringify(run, null, 1));
    writeReport(run, 'eval/REPORT.md');
    console.log(`[eval] wrote eval/runs/council-${stamp}.json and eval/REPORT.md`);
  },
  4 * 60 * 60_000,
);
