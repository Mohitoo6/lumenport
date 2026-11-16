import type { StateDelta } from './effects';
import type { CityIssue, IssueKind } from './issues';
import type { MinistryId } from './ministries';
import { readJson, type KV } from './storage';

/**
 * The council's episodic memory: what the mayor decided before, kept per city in local
 * storage, and handed back to the agents as one line per decision.
 *
 * It is deliberately not a vector store. Each decision is a small structured record, and
 * relevance is scored by rule (same problem, same kind, same ministry, money, recency), so
 * recall costs no tokens and no model call, and the cost of *using* the memory is capped:
 * at most three lines for the chair and two for a minister, about 25 tokens each.
 */
export interface DecisionRecord {
  /** When it was decided: game hours since the city was founded, and the calendar label. */
  at: number;
  date: string;
  issueKey: string;
  issueKind: IssueKind;
  issueTitle: string;
  lead: MinistryId;
  /** Ministries who were in the room: memory is recalled for those it concerns. */
  seated: MinistryId[];
  optionTitle: string;
  /** What was actually done: 'none' for "take no action". */
  acted: boolean;
  budgetDelta: number;
  hourlyNetDelta: number;
  debtDelta: number;
  taxChanged: boolean;
  residentsDisplaced: number;
  /** Whether the mayor took the chair's recommendation or overruled it. */
  followedChair: boolean;
  /** How bad the problem was when this was decided, 0..1. */
  severity?: number;
  /**
   * What became of it, judged by the same detector that raised the problem, once enough
   * game time has passed: gone, or still there. Absent until then.
   */
  outcome?: 'resolved' | 'persisted';
}

/** Game hours after a decision at which its outcome is judged: half a day. */
export const OUTCOME_AFTER_HOURS = 12;
/** Game hours in a year: the scale on which old decisions fade. */
const HOURS_PER_YEAR = 24 * 12;

const KEEP = 40;
const key = (cityKey: string): string => `metropolis.council.memory.v2:${cityKey}`;

const usd = (n: number): string => `${n < 0 ? '-' : '+'}$${Math.abs(Math.round(n)).toLocaleString('en-US')}`;

/** One decision as one line: the form the agents see. */
export function memoryLine(r: DecisionRecord): string {
  const parts: string[] = [];
  if (r.budgetDelta !== 0) parts.push(`${usd(r.budgetDelta)} now`);
  if (r.hourlyNetDelta !== 0) parts.push(`${usd(r.hourlyNetDelta)}/hour`);
  if (r.residentsDisplaced > 0) parts.push(`${r.residentsDisplaced} residents displaced`);
  const what = r.acted ? `${r.optionTitle}${parts.length ? ` (${parts.join(', ')})` : ''}` : 'took no action';
  const outcome = r.outcome === 'resolved' ? ' Outcome: the problem went away.' : r.outcome === 'persisted' ? ' Outcome: the problem was still there half a day later.' : '';
  return `${r.date}, ${r.issueTitle}: ${what}${r.followedChair ? '' : '; mayor overruled the council'}.${outcome}`;
}

export interface Recalled {
  record: DecisionRecord;
  /** The relevance score and why, for the inspector. */
  score: number;
  why: string[];
  line: string;
}

/**
 * How relevant a past decision is to the issue on the table. Pure arithmetic: no
 * embeddings, no model.
 */
export function relevance(r: DecisionRecord, issue: CityIssue, now: number, moneyAtStake: boolean): { score: number; why: string[] } {
  let score = 0;
  const why: string[] = [];
  if (r.issueKey === issue.key) {
    score += 4;
    why.push('same problem');
  } else if (r.issueKind === issue.kind) {
    score += 3;
    why.push('same kind of problem');
  }
  if (r.lead === issue.lead && r.issueKind !== issue.kind) {
    score += 1.5;
    why.push('same ministry');
  }
  // Loans, taxes and big spends shape every later money decision.
  const fiscal = r.debtDelta > 0 || r.taxChanged || Math.abs(r.budgetDelta) >= 5000;
  if (fiscal && (issue.kind === 'budget' || moneyAtStake)) {
    score += issue.kind === 'budget' ? 2.5 : 1.5;
    why.push(r.debtDelta > 0 ? 'left the city in debt' : r.taxChanged ? 'changed taxes' : 'a large spend');
  }
  // A fix that did not work is exactly what the council should hear about again.
  if (score > 0 && r.outcome === 'persisted' && r.issueKind === issue.kind) {
    score += 1;
    why.push('it did not fix the problem');
  }
  if (score === 0) return { score: 0, why };
  // Old decisions fade: half the weight is kept, half decays over about a game year.
  const age = Math.max(0, now - r.at);
  return { score: Math.round(score * (0.5 + 0.5 * Math.exp(-age / HOURS_PER_YEAR)) * 100) / 100, why };
}

/** Below this a past decision is not worth the tokens. A loan stays relevant to spending for about half a game year. */
const MIN_SCORE = 1.2;

export class EpisodicMemory {
  private records: DecisionRecord[];

  constructor(
    private readonly kv: KV,
    private readonly cityKey: string,
  ) {
    this.records = readJson<DecisionRecord[]>(kv, key(cityKey), []);
  }

  get all(): readonly DecisionRecord[] {
    return this.records;
  }

  record(r: DecisionRecord): void {
    this.records = [...this.records, r].slice(-KEEP);
    this.kv.set(key(this.cityKey), JSON.stringify(this.records));
  }

  /**
   * Drops decisions dated after `now`. Loading an older save rewinds the city, and the
   * council must not remember things that have not happened in it yet.
   */
  rewindTo(now: number): void {
    const kept = this.records.filter((r) => r.at <= now);
    if (kept.length === this.records.length) return;
    this.records = kept;
    this.kv.set(key(this.cityKey), JSON.stringify(kept));
  }

  /**
   * Closes the loop on old decisions: once a decision is old enough, records whether the
   * problem it was about is still being detected. Zero tokens: the detector that raised
   * the problem is the judge of whether it went away. Returns how many were settled.
   */
  settle(now: number, activeIssueKeys: ReadonlySet<string>): number {
    let settled = 0;
    for (const r of this.records) {
      if (r.outcome || now < r.at + OUTCOME_AFTER_HOURS) continue;
      r.outcome = activeIssueKeys.has(r.issueKey) ? 'persisted' : 'resolved';
      settled++;
    }
    if (settled > 0) this.kv.set(key(this.cityKey), JSON.stringify(this.records));
    return settled;
  }

  /** The most relevant past decisions for an issue, best first. */
  recall(issue: CityIssue, now: number, opts: { moneyAtStake?: boolean; limit?: number; ministry?: MinistryId } = {}): Recalled[] {
    const out: Recalled[] = [];
    for (const r of this.records) {
      if (r.at > now) continue;
      // A minister remembers what their own department was part of.
      if (opts.ministry && r.lead !== opts.ministry && !r.seated.includes(opts.ministry)) continue;
      const { score, why } = relevance(r, issue, now, opts.moneyAtStake ?? false);
      if (score >= MIN_SCORE) out.push({ record: r, score, why, line: memoryLine(r) });
    }
    out.sort((a, b) => b.score - a.score || b.record.at - a.record.at);
    return out.slice(0, opts.limit ?? 3);
  }
}

/** Builds the record of a decision from what was approved and what it did. */
export function decisionRecord(
  when: { at: number; date: string },
  issue: CityIssue,
  seated: MinistryId[],
  option: { title: string; acted: boolean },
  delta: StateDelta,
  followedChair: boolean,
): DecisionRecord {
  return {
    at: when.at,
    date: when.date,
    issueKey: issue.key,
    issueKind: issue.kind,
    issueTitle: issue.title,
    lead: issue.lead,
    seated,
    optionTitle: option.title,
    acted: option.acted,
    budgetDelta: delta.budgetDelta,
    hourlyNetDelta: delta.hourlyNetDelta,
    debtDelta: delta.debtDelta,
    taxChanged: delta.taxRateDelta.some((d) => d !== 0),
    residentsDisplaced: delta.residentsDisplaced,
    followedChair,
    severity: issue.severity,
  };
}
