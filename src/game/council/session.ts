import { CHIEF_SECRETARY, MINISTER_BY_ID, type MinistryId } from './ministries';
import type { CityIssue } from './issues';
import type { CouncilOption } from './options';
import { parseJsonReply, type LlmRequest, type Transport } from './llm';
import { chiefSystem, chiefTurn, ministerSystem, ministerTurn, type Lang, type Stance, type Statement, type TurnContext } from './prompts';
import type { Seat } from './briefs';

export interface Decision {
  option: string;
  summary: string;
  dissent: string;
  conditions: string;
  /** Option id -> ministers backing it at the end. */
  tally: Record<string, MinistryId[]>;
}

export type SessionEvent =
  | { type: 'round'; round: 1 | 2 | 3 }
  | { type: 'thinking'; who: MinistryId | 'chief' }
  | { type: 'said'; statement: Statement; provider: string }
  | { type: 'silent'; who: MinistryId; round: 1 | 2 }
  | { type: 'failed'; who: MinistryId | 'chief'; round: number; error: string }
  | { type: 'decision'; decision: Decision; provider: string }
  | { type: 'error'; message: string }
  | { type: 'done' };

export interface SessionInput {
  city: string;
  issue: CityIssue;
  options: readonly CouncilOption[];
  seats: readonly Seat[];
  briefings: Record<MinistryId, string[]>;
  mayorNote: string;
  lang: Lang;
}

const STANCES: Stance[] = ['propose', 'support', 'concern', 'oppose', 'neutral'];

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

/**
 * One council meeting. Round 1: the lead minister opens with a proposal, then every other
 * attendee reacts to it, independently and in parallel (each may stay silent). Round 2:
 * everyone who spoke sees the whole discussion and gives a final position. Then the Chief
 * Secretary sums up and recommends one option, checked against the options on the table.
 */
export class CouncilSession {
  private readonly abort = new AbortController();
  private readonly statements: Statement[] = [];

  constructor(
    private readonly input: SessionInput,
    private readonly transport: Transport,
    private readonly emit: (e: SessionEvent) => void,
  ) {}

  cancel(): void {
    this.abort.abort();
  }

  get cancelled(): boolean {
    return this.abort.signal.aborted;
  }

  private context(seat: Seat): TurnContext {
    const { issue, options, briefings, mayorNote } = this.input;
    return { issue, options, briefing: briefings[seat.id] ?? [], reason: seat.reason, mayorNote, earlier: this.statements.slice() };
  }

  /** Asks the model, parsing its JSON reply; one retry if the reply is not usable. */
  private async ask(req: LlmRequest): Promise<{ data: Record<string, unknown>; provider: string }> {
    let lastError = 'no reply';
    for (let attempt = 0; attempt < 2; attempt++) {
      if (this.cancelled) throw new Error('cancelled');
      const user = attempt === 0 ? req.user : `${req.user}\n\nYour previous reply was not a valid JSON object. Reply with the JSON object only.`;
      try {
        const reply = await this.transport.complete({ ...req, user }, this.abort.signal);
        const data = parseJsonReply(reply.text);
        if (data) return { data, provider: reply.provider };
        lastError = 'the reply was not valid JSON';
      } catch (err) {
        if (this.cancelled) throw new Error('cancelled');
        lastError = err instanceof Error ? err.message : String(err);
      }
    }
    throw new Error(lastError);
  }

  private validOption(v: unknown): string {
    const s = typeof v === 'string' ? v.trim().toUpperCase().replace(/^OPTION\s+/, '') : '';
    return this.input.options.some((o) => o.id === s) ? s : 'none';
  }

  /** One minister's turn. Returns their statement, or null if they stayed silent or failed. */
  private async turn(seat: Seat, round: 1 | 2): Promise<Statement | null> {
    const { city, lang, options, issue } = this.input;
    const lead = seat.id === issue.lead;
    this.emit({ type: 'thinking', who: seat.id });
    try {
      const { data, provider } = await this.ask({
        system: ministerSystem(seat.id, city, lang),
        user: ministerTurn(seat.id, round, issue.lead, this.context(seat)),
        maxTokens: 1200,
        meta: { role: 'minister', minister: seat.id, round, lead, options, lang, reason: seat.reason },
      });
      const text = typeof data.statement === 'string' ? data.statement.trim() : '';
      const speak = (data.speak !== false || lead) && text.length > 0;
      if (!speak) {
        this.emit({ type: 'silent', who: seat.id, round });
        return null;
      }
      const stance = STANCES.includes(data.stance as Stance) ? (data.stance as Stance) : lead && round === 1 ? 'propose' : 'neutral';
      const statement: Statement = {
        minister: seat.id,
        round,
        stance,
        option: this.validOption(data.option),
        text,
        condition: typeof data.condition === 'string' ? data.condition.trim() : '',
      };
      this.emit({ type: 'said', statement, provider });
      return statement;
    } catch (err) {
      if (this.cancelled) return null;
      this.emit({ type: 'failed', who: seat.id, round, error: err instanceof Error ? err.message : String(err) });
      return null;
    }
  }

  /** Each minister's final position: their last stated option. */
  private tally(): Record<string, MinistryId[]> {
    const last = new Map<MinistryId, string>();
    for (const s of this.statements) if (s.option !== 'none') last.set(s.minister, s.option);
    const out: Record<string, MinistryId[]> = {};
    for (const [m, o] of last) (out[o] ??= []).push(m);
    return out;
  }

  async run(): Promise<void> {
    const { seats, issue, options, city, lang } = this.input;
    const leadSeat = seats.find((s) => s.id === issue.lead) ?? seats[0]!;
    const others = seats.filter((s) => s !== leadSeat);
    try {
      // Round 1: the lead opens, then the others react in parallel.
      this.emit({ type: 'round', round: 1 });
      const opening = await this.turn(leadSeat, 1);
      if (opening) this.statements.push(opening);
      if (this.cancelled) return;
      const r1 = await pool(others.map((seat) => () => this.turn(seat, 1)), 5);
      for (const s of r1) if (s) this.statements.push(s);
      if (this.cancelled) return;
      if (this.statements.length === 0) {
        this.emit({ type: 'error', message: 'No minister could be reached. Check the AI keys in .env and try again.' });
        return;
      }

      // Round 2: everyone who spoke gives a final position, having heard the others.
      this.emit({ type: 'round', round: 2 });
      const speakers = seats.filter((seat) => this.statements.some((s) => s.minister === seat.id));
      const r2 = await pool(speakers.map((seat) => () => this.turn(seat, 2)), 5);
      for (const s of r2) if (s) this.statements.push(s);
      if (this.cancelled) return;

      // The Chief Secretary sums up.
      this.emit({ type: 'round', round: 3 });
      this.emit({ type: 'thinking', who: 'chief' });
      const tally = this.tally();
      const ranked = Object.entries(tally).sort((a, b) => b[1].length - a[1].length);
      const tallyText = ranked.length
        ? ranked.map(([o, ms]) => `option ${o}: ${ms.map((m) => MINISTER_BY_ID[m].short).join(', ')}`).join('; ')
        : 'no minister named an option';
      let decision: Decision;
      let provider = 'rules';
      try {
        const ctx = this.context(leadSeat);
        const reply = await this.ask({
          system: chiefSystem(city, lang),
          user: chiefTurn(ctx, tallyText),
          maxTokens: 1500,
          meta: { role: 'chief', options, lang, backed: ranked[0]?.[0] },
        });
        provider = reply.provider;
        const option = this.validOption(reply.data.option);
        decision = {
          option: option !== 'none' ? option : (ranked[0]?.[0] ?? options[options.length - 1]!.id),
          summary: typeof reply.data.summary === 'string' ? reply.data.summary : '',
          dissent: typeof reply.data.dissent === 'string' ? reply.data.dissent : '',
          conditions: typeof reply.data.conditions === 'string' ? reply.data.conditions : '',
          tally,
        };
      } catch (err) {
        if (this.cancelled) return;
        // Without a summary, fall back to the majority so the mayor can still decide.
        this.emit({ type: 'failed', who: 'chief', round: 3, error: err instanceof Error ? err.message : String(err) });
        decision = {
          option: ranked[0]?.[0] ?? options[options.length - 1]!.id,
          summary: `${CHIEF_SECRETARY.title} could not be reached. Most ministers back option ${ranked[0]?.[0] ?? '-'}.`,
          dissent: '',
          conditions: '',
          tally,
        };
      }
      this.emit({ type: 'decision', decision, provider });
    } finally {
      if (!this.cancelled) this.emit({ type: 'done' });
    }
  }
}
