import type { Sim } from '../../sim/sim';
import { briefing } from './briefs';
import { parseInstruction, type Constraint } from './constraints';
import { fiscalLimits, type FiscalLimits } from './effects';
import { GraphState } from './graph';
import { checkStatement, checkVerdict, type Finding, type VerdictReport } from './guardrails';
import type { CityIssue } from './issues';
import { LlmError, type LlmReply, type LlmRequest, type Transport } from './llm';
import { CHIEF_SECRETARY, MINISTERS, MINISTER_BY_ID, type MinistryId } from './ministries';
import { optionsFor, type CouncilOption } from './options';
import { policyTurn, policyVerdict } from './policy';
import { chiefSystem, chiefTurn, ministerSystem, ministerTurn, type Lang, type Statement, type TurnContext } from './prompts';
import { chairVerdictSchema, jsonSchemaOf, ministerTurnSchema, parseChairVerdict, parseMinisterTurn, type ChairVerdict, type MinisterTurn, type Parsed } from './schemas';
import { estimateTokens, type AgentId, type Recorder, type TokenUsage, type TurnSource } from './telemetry';
import { seatsOf, triage, type Seat, type TriageEntry } from './triage';

export interface Decision {
  /** The recommendation after the guardrails. */
  option: string;
  summary: string;
  dissent: string;
  conditions: string;
  /** Option id -> ministers backing it at the end. */
  tally: Record<string, MinistryId[]>;
  /** What code found when it checked the recommendation against the game's rules. */
  guardrail: VerdictReport;
  /** Where the summary came from: the model, the cache, or the deterministic chair. */
  source: TurnSource;
}

export type SessionEvent =
  | { type: 'round'; round: 1 | 2 | 3 }
  | { type: 'thinking'; who: AgentId }
  | { type: 'said'; statement: Statement; provider: string }
  | { type: 'silent'; who: MinistryId; round: 1 | 2 }
  /** The model could not answer for this agent; a stand-in spoke instead. */
  | { type: 'failed'; who: AgentId; round: number; error: string }
  /** Something the mayor should know about how the meeting is being run. */
  | { type: 'notice'; message: string }
  | { type: 'decision'; decision: Decision; provider: string }
  | { type: 'error'; message: string }
  | { type: 'done' };

export interface SessionInput {
  city: string;
  issue: CityIssue;
  options: readonly CouncilOption[];
  seats: readonly Seat[];
  briefings: Record<MinistryId, string[]>;
  limits: FiscalLimits;
  mayorNote: string;
  lang: Lang;
  /** Past decisions to put in front of the agents: for the chair, and per minister. */
  memory?: { chair: readonly string[]; byMinister: Partial<Record<MinistryId, readonly string[]>> };
}

/** Everything a meeting needs, computed from the city in code before any model is called. */
export interface Meeting {
  issue: CityIssue;
  options: CouncilOption[];
  triage: TriageEntry[];
  seats: Seat[];
  briefings: Record<MinistryId, string[]>;
  limits: FiscalLimits;
}

export function prepareMeeting(sim: Sim, issue: CityIssue): Meeting {
  const options = optionsFor(sim, issue);
  const entries = triage(sim, issue, options);
  const seats = seatsOf(entries);
  // Only the seated ministries' figures are gathered: nobody else will be asked.
  const briefings = Object.fromEntries(MINISTERS.map((m) => [m.id, seats.some((s) => s.id === m.id) ? briefing(sim, m.id) : []])) as Record<MinistryId, string[]>;
  return { issue, options, triage: entries, seats, briefings, limits: fiscalLimits(sim) };
}

/** Hard ceilings on what one meeting may cost, whatever the model does. */
export const BUDGET = {
  /** Model calls per meeting: 1 lead + 3 reactions + up to 3 rebuttals + 1 chair. */
  maxCalls: 8,
  /** Speakers in round 2: the lead and the two sharpest challengers. */
  maxRebuttals: 3,
  ministerTokens: 700,
  chairTokens: 900,
  /** Calls in flight at once, to stay under free-tier per-minute limits. */
  concurrency: 3,
  /** Consecutive failures after which the meeting stops calling the model. */
  breakerAfter: 2,
};

/** Runs `tasks` with at most `limit` in flight, keeping free-tier rate limits happy. */
async function pool<T>(tasks: Array<() => Promise<T>>, limit: number): Promise<T[]> {
  const out: T[] = new Array(tasks.length);
  let next = 0;
  const worker = async (): Promise<void> => {
    while (next < tasks.length) {
      const i = next++;
      out[i] = await tasks[i]!();
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, tasks.length) }, worker));
  return out;
}

interface Answer<T> {
  data: T;
  source: TurnSource;
  provider: string;
  /** The model was asked (or would have been) and a stand-in answered instead. */
  fellBack: boolean;
}

/**
 * One council meeting, run as a walk through the graph in `graph.ts`:
 *
 *   debate_r1   the lead proposes, the other seated ministers react in parallel, each
 *               from its own isolated context
 *   debate_r2   only if round 1 ended in disagreement: the lead and the challengers
 *               answer each other once
 *   synthesis   the Chief Secretary recommends one option
 *   guardrails  code checks the recommendation against the game's rules; a hard
 *               violation is replaced by a deterministic choice
 *   hitl        handed to the mayor
 *
 * Every model call is validated against a schema. A call that fails, or a reply that
 * cannot be repaired, is answered by the deterministic policy agent for that seat, so a
 * meeting always reaches a recommendation and never spends a retry.
 */
export class CouncilSession {
  private readonly abort = new AbortController();
  private readonly statements: Statement[] = [];
  private readonly graph: GraphState;
  private calls = 0;
  private failures = 0;
  private breakerOpen = false;
  private readonly ids: string[];
  /** The parts of the mayor's instruction that code enforces. */
  readonly constraints: Constraint[];

  constructor(
    private readonly input: SessionInput,
    private readonly transport: Transport,
    private readonly emit: (e: SessionEvent) => void,
    private readonly hooks: { graph?: GraphState; recorder?: Recorder } = {},
  ) {
    this.ids = input.options.map((o) => o.id);
    this.constraints = parseInstruction(input.mayorNote);
    this.graph = hooks.graph ?? new GraphState();
    if (this.graph.node === 'detect') this.graph.go('triage', 'meeting started directly');
  }

  cancel(): void {
    this.abort.abort();
  }

  get cancelled(): boolean {
    return this.abort.signal.aborted;
  }

  private context(seat: Seat | null): TurnContext {
    const { issue, options, briefings, mayorNote, limits, memory } = this.input;
    return {
      issue,
      options,
      limits,
      briefing: seat ? (briefings[seat.id] ?? []) : [],
      reason: seat?.reason ?? '',
      mayorNote,
      earlier: this.statements.slice(),
      memory: seat ? (memory?.byMinister[seat.id] ?? []) : (memory?.chair ?? []),
      constraints: this.constraints,
    };
  }

  /** Each minister's current position: their last stated option. */
  private positions(): Map<MinistryId, string> {
    const last = new Map<MinistryId, string>();
    for (const s of this.statements) if (s.option !== 'none') last.set(s.minister, s.option);
    return last;
  }

  private tally(): Record<string, MinistryId[]> {
    const out: Record<string, MinistryId[]> = {};
    for (const [m, o] of this.positions()) (out[o] ??= []).push(m);
    return out;
  }

  /** Why the model is not being asked, or null if it may be. */
  private noModel(): string | null {
    if (this.breakerOpen) return 'circuit breaker open: the AI stopped answering, so the rest of the meeting runs offline';
    if (this.calls >= BUDGET.maxCalls) return `call budget of ${BUDGET.maxCalls} for this meeting is spent`;
    return null;
  }

  /**
   * One agent turn: ask the model, validate, and fall back to `standIn` if the call fails
   * or the reply cannot be made to fit the schema. Records the span either way.
   */
  private async ask<T>(who: AgentId, round: 1 | 2 | 3, req: LlmRequest, parse: (raw: string) => Parsed<T>, standIn: () => T, check: (data: T, seen: string) => Finding[]): Promise<Answer<T> & { findings: Finding[] }> {
    const rec = this.hooks.recorder;
    const startedAt = rec?.elapsed() ?? 0;
    const t0 = Date.now();
    const seen = `${req.system}\n${req.user}`;
    let reply: LlmReply | null = null;
    let parsed: Parsed<T> | null = null;
    let fallbackReason = this.noModel() ?? undefined;
    if (!fallbackReason) {
      this.calls++;
      try {
        reply = await this.transport.complete(req, this.abort.signal);
        this.failures = 0;
        parsed = parse(reply.text);
        if (parsed.outcome === 'fail') fallbackReason = `reply did not fit the schema (${parsed.errors.join('; ')})`;
      } catch (err) {
        if (this.cancelled) throw new Error('cancelled');
        const message = err instanceof Error ? err.message : String(err);
        fallbackReason = `model call failed: ${message}`;
        this.emit({ type: 'failed', who, round, error: message });
        // A rate limit will not clear within this meeting: stop asking at once.
        if (++this.failures >= BUDGET.breakerAfter || (err instanceof LlmError && err.rateLimited)) {
          if (!this.breakerOpen) this.emit({ type: 'notice', message: 'The AI stopped answering (rate limit or outage). The rest of this meeting uses the offline council, at no cost.' });
          this.breakerOpen = true;
        }
      }
    }
    const usable = parsed?.data ?? null;
    const data = usable ?? standIn();
    const source: TurnSource = usable === null || reply?.offline ? 'policy' : reply?.cached ? 'cache' : 'llm';
    const findings = check(data, seen);
    const usage: TokenUsage =
      reply && !reply.offline && !reply.cached
        ? reply.usage
          ? { ...reply.usage, source: 'api' }
          : { prompt: estimateTokens(seen), completion: estimateTokens(reply.text), reasoning: 0, source: 'estimate' }
        : { prompt: 0, completion: 0, reasoning: 0, source: 'none' };
    const provider = source === 'policy' ? 'deterministic policy' : (reply?.provider ?? 'unknown');
    rec?.span({
      agent: who,
      node: this.graph.node,
      round,
      startedAt,
      latencyMs: reply?.latencyMs ?? Date.now() - t0,
      source,
      provider,
      fallbackReason: usable === null ? fallbackReason : undefined,
      usage,
      schema: reply && !reply.offline ? (parsed?.outcome ?? 'fail') : 'n/a',
      repairs: parsed?.repairs ?? [],
      schemaErrors: parsed?.errors ?? [],
      guardrails: findings,
      request: { system: req.system, user: req.user },
      response: reply?.text ?? '',
      parsed: data,
      truncated: reply?.finish === 'length' || undefined,
    });
    return { data, source, provider, findings, fellBack: usable === null };
  }

  /** One minister's turn. Returns their statement, or null if they stayed silent. */
  private async turn(seat: Seat, round: 1 | 2): Promise<Statement | null> {
    const { city, lang, options, issue, limits } = this.input;
    const lead = seat.id === issue.lead;
    this.emit({ type: 'thinking', who: seat.id });
    const positions = this.positions();
    const constraints = this.constraints;
    const standIn = (): MinisterTurn => policyTurn(seat.id, round, lead, { options, limits, lang, positions, constraints });
    try {
      const answer = await this.ask<MinisterTurn>(
        seat.id,
        round,
        {
          system: ministerSystem(seat.id, city, lang),
          user: ministerTurn(seat.id, round, issue.lead, this.context(seat)),
          maxTokens: BUDGET.ministerTokens,
          schema: jsonSchemaOf(ministerTurnSchema(this.ids)),
          schemaName: 'minister_turn',
          meta: { role: 'minister', minister: seat.id, round, lead, options, lang, reason: seat.reason, limits, positions, constraints },
        },
        (raw) => parseMinisterTurn(raw, this.ids),
        standIn,
        (data, seen) => checkStatement(data, seen, options, constraints),
      );
      // The lead may not pass: they called the meeting.
      const passed = lead && round === 1 && (!answer.data.speak || !answer.data.say.trim());
      const turn = passed ? standIn() : answer.data;
      if (!turn.speak || !turn.say.trim()) {
        this.emit({ type: 'silent', who: seat.id, round });
        return null;
      }
      const flags = answer.findings.filter((f) => !f.passed && f.strength !== 'info').map((f) => f.detail);
      const statement: Statement = {
        minister: seat.id,
        round,
        stance: lead && round === 1 && turn.stance === 'neutral' ? 'propose' : turn.stance,
        option: turn.option,
        text: turn.say.trim(),
        condition: turn.condition,
        standIn: answer.fellBack || passed || undefined,
        flags: flags.length ? flags : undefined,
      };
      this.emit({ type: 'said', statement, provider: answer.provider });
      return statement;
    } catch {
      // Only a cancelled meeting reaches here: every other failure has a stand-in.
      return null;
    }
  }

  /**
   * The conditional edge after round 1. A second round costs model calls, so it is taken
   * only when someone actually disagrees: a minister objects, or backs a different option
   * from the lead. Returns who speaks in it, or null when the council already agrees.
   */
  private contest(leadSeat: Seat): { speakers: Seat[]; reason: string } | null {
    const lead = leadSeat.id;
    const proposal = this.statements.find((s) => s.minister === lead)?.option ?? 'none';
    const challengers = this.statements.filter((s) => s.minister !== lead && (s.stance === 'oppose' || s.stance === 'concern' || (s.option !== 'none' && proposal !== 'none' && s.option !== proposal)));
    if (challengers.length === 0) return null;
    const seats = this.input.seats.filter((seat) => challengers.some((c) => c.minister === seat.id));
    const speakers = [leadSeat, ...seats].slice(0, BUDGET.maxRebuttals);
    const who = challengers.map((c) => `${MINISTER_BY_ID[c.minister].short} (${c.stance}${c.option !== 'none' ? `, backs ${c.option}` : ''})`).join(', ');
    return { speakers, reason: `contested by ${who}; the lead proposed ${proposal}` };
  }

  async run(): Promise<void> {
    const { seats, issue, options, city, lang, limits } = this.input;
    const leadSeat = seats.find((s) => s.id === issue.lead) ?? seats[0]!;
    const others = seats.filter((s) => s !== leadSeat);
    const sync = (): void => this.hooks.recorder?.graph(this.graph.node, this.graph.history);
    try {
      // Round 1: the lead opens, then the others react in parallel.
      this.graph.go('debate_r1', `${seats.length} agents seated`);
      sync();
      this.emit({ type: 'round', round: 1 });
      const opening = await this.turn(leadSeat, 1);
      if (opening) this.statements.push(opening);
      if (this.cancelled) return;
      const r1 = await pool(others.map((seat) => () => this.turn(seat, 1)), BUDGET.concurrency);
      for (const s of r1) if (s) this.statements.push(s);
      if (this.cancelled) return;

      // Round 2, only if contested.
      const contest = this.contest(leadSeat);
      if (contest) {
        this.graph.go('debate_r2', contest.reason);
        sync();
        this.emit({ type: 'round', round: 2 });
        const r2 = await pool(contest.speakers.map((seat) => () => this.turn(seat, 2)), BUDGET.concurrency);
        for (const s of r2) if (s) this.statements.push(s);
        if (this.cancelled) return;
        this.graph.go('synthesis', 'final positions are in');
      } else {
        this.graph.go('synthesis', 'round 1 ended in agreement: round 2 skipped');
      }
      sync();

      // The Chief Secretary sums up.
      this.emit({ type: 'round', round: 3 });
      this.emit({ type: 'thinking', who: 'chief' });
      const tally = this.tally();
      const ranked = Object.entries(tally).sort((a, b) => b[1].length - a[1].length);
      const tallyText = ranked.length ? ranked.map(([o, ms]) => `${o}: ${ms.map((m) => MINISTER_BY_ID[m].short).join(', ')}`).join('; ') : 'no minister named an option';
      const user = chiefTurn(this.context(null), tallyText);
      const system = chiefSystem(city, lang);
      const answer = await this.ask<ChairVerdict>(
        'chief',
        3,
        {
          system,
          user,
          maxTokens: BUDGET.chairTokens,
          schema: jsonSchemaOf(chairVerdictSchema(this.ids)),
          schemaName: 'chair_verdict',
          meta: { role: 'chief', options, lang, backed: ranked[0]?.[0], limits, tally, constraints: this.constraints },
        },
        (raw) => parseChairVerdict(raw, this.ids),
        () => policyVerdict(options, tally, lang, this.constraints),
        // The chair's span carries the same findings the verdict is judged on.
        (data, seen) => checkVerdict(data, { options, limits, seen, tally, constraints: this.constraints }).findings,
      );
      if (this.cancelled) return;

      // Guardrails: code has the last word on what may be recommended.
      this.graph.go('guardrails', `chair recommends ${answer.data.option}`);
      sync();
      const report = checkVerdict(answer.data, { options, limits, seen: `${system}\n${user}`, tally, constraints: this.constraints });
      let verdict = answer.data;
      if (report.status === 'overridden') {
        const safe = options.find((o) => o.id === report.option)!;
        const againstMayor = report.findings.some((f) => !f.passed && f.strength === 'block' && f.check === 'respects_mayor_instruction');
        verdict = {
          option: safe.id,
          summary:
            lang === 'hi'
              ? `परिषद का झुकाव विकल्प ${report.original} की ओर था, पर ${againstMayor ? 'वह आपके निर्देश के विरुद्ध है' : 'वह खेल के नियमों के अनुसार संभव नहीं है'}। इसलिए मेरी सिफ़ारिश विकल्प ${safe.id} है: ${safe.title}। ${safe.gist}`
              : `The council leaned towards option ${report.original}, but ${againstMayor ? 'it goes against your instruction, Mayor' : "it cannot be carried out under the city's rules"}. I therefore recommend option ${safe.id}, ${safe.title.toLowerCase()}. ${safe.gist}`,
          dissent: answer.data.dissent,
          conditions: answer.data.conditions,
        };
      }
      this.hooks.recorder?.set({ verdict: report });
      this.graph.go('hitl', report.status === 'overridden' ? `guardrail override: ${report.original} -> ${report.option}` : `guardrails ${report.status}: option ${report.option} goes to the mayor`);
      sync();
      this.emit({
        type: 'decision',
        decision: { option: verdict.option, summary: verdict.summary, dissent: verdict.dissent, conditions: verdict.conditions, tally, guardrail: report, source: answer.source },
        provider: answer.source === 'policy' ? `${CHIEF_SECRETARY.title} (offline)` : answer.provider,
      });
    } catch (err) {
      if (!this.cancelled) this.emit({ type: 'error', message: err instanceof Error ? err.message : String(err) });
    } finally {
      if (!this.cancelled) this.emit({ type: 'done' });
    }
  }
}
