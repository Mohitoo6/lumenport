import type { ExecutionReport, Feasibility, FiscalLimits, StateDelta } from './effects';
import type { GraphNode, Transition } from './graph';
import type { Finding, VerdictReport } from './guardrails';
import type { MinistryId } from './ministries';
import type { SchemaOutcome } from './schemas';
import { readJson, type KV } from './storage';
import type { TriageEntry } from './triage';

/**
 * Zero-token observability. Everything here is measured by code around each model call:
 * how long it took, how many tokens the provider billed (or an estimate when it does not
 * say), whether the reply fitted the schema, what the guardrails found, and where the
 * words came from. Nothing is judged by a second model.
 */

export type AgentId = MinistryId | 'chief';

/** Where a turn's words came from. */
export type TurnSource = 'llm' | 'cache' | 'policy';

export interface TokenUsage {
  prompt: number;
  completion: number;
  /** Hidden reasoning tokens, when the provider reports them. */
  reasoning: number;
  /** api: the provider's own count. estimate: characters / 4. none: no model was called. */
  source: 'api' | 'estimate' | 'none';
}

/** One agent turn: the unit the inspector lists. */
export interface AgentSpan {
  id: number;
  agent: AgentId;
  node: GraphNode;
  round: 1 | 2 | 3;
  /** Milliseconds since the trace began, and how long the call took. */
  startedAt: number;
  latencyMs: number;
  source: TurnSource;
  /** Provider and model, or 'deterministic policy'. */
  provider: string;
  /** Why a stand-in answered instead of the model, if one did. */
  fallbackReason?: string;
  usage: TokenUsage;
  schema: SchemaOutcome | 'n/a';
  repairs: string[];
  schemaErrors: string[];
  guardrails: Finding[];
  /** Exactly what the agent was shown and what came back: the evidence for every check. */
  request: { system: string; user: string };
  response: string;
  parsed: unknown;
  /** The model stopped because it ran out of output budget. */
  truncated?: boolean;
}

export interface TraceOption {
  id: string;
  title: string;
  effects: StateDelta;
  feasibility: Feasibility;
}

export interface TraceTotals {
  turns: number;
  llmCalls: number;
  cacheHits: number;
  policyTurns: number;
  promptTokens: number;
  completionTokens: number;
  reasoningTokens: number;
  /** Sum of model latency, and the slowest single call. */
  latencyMs: number;
  maxLatencyMs: number;
  schemaPass: number;
  schemaRepaired: number;
  schemaFail: number;
  guardrailFlags: number;
  /** True when every token count came from the provider. */
  measured: boolean;
}

/** Who shaped the mayor's final choice. */
export interface Attribution {
  chosen: string;
  recommended: string;
  followedChair: boolean;
  /** The first minister to put the chosen option forward, and everyone backing it at the end. */
  proposedBy: MinistryId | null;
  backers: MinistryId[];
}

/** Everything known about one meeting, from trigger to execution. */
export interface CouncilTrace {
  id: string;
  startedAt: number;
  mode: 'live' | 'offline';
  issue: { key: string; kind: string; title: string; severity: number; lead: MinistryId };
  /** Game day the meeting was held. */
  day: number;
  trigger: string;
  node: GraphNode;
  transitions: Transition[];
  triage: TriageEntry[];
  limits: FiscalLimits;
  options: TraceOption[];
  /** The memory lines injected into the agents' context. */
  memory: string[];
  spans: AgentSpan[];
  verdict?: VerdictReport;
  attribution?: Attribution;
  execution?: ExecutionReport;
  totals: TraceTotals;
}

/** A rough token count for text when the provider reports none: about 4 characters each. */
export function estimateTokens(text: string): number {
  let ascii = 0;
  let other = 0;
  for (let i = 0; i < text.length; i++) text.charCodeAt(i) < 128 ? ascii++ : other++;
  // Devanagari and other scripts tokenise far less efficiently than English.
  return Math.ceil(ascii / 4 + other / 1.6);
}

export function totalsOf(spans: readonly AgentSpan[]): TraceTotals {
  const t: TraceTotals = {
    turns: spans.length,
    llmCalls: 0,
    cacheHits: 0,
    policyTurns: 0,
    promptTokens: 0,
    completionTokens: 0,
    reasoningTokens: 0,
    latencyMs: 0,
    maxLatencyMs: 0,
    schemaPass: 0,
    schemaRepaired: 0,
    schemaFail: 0,
    guardrailFlags: 0,
    measured: true,
  };
  for (const s of spans) {
    if (s.source === 'llm') {
      t.llmCalls++;
      t.promptTokens += s.usage.prompt;
      t.completionTokens += s.usage.completion;
      t.reasoningTokens += s.usage.reasoning;
      t.latencyMs += s.latencyMs;
      t.maxLatencyMs = Math.max(t.maxLatencyMs, s.latencyMs);
      if (s.usage.source !== 'api') t.measured = false;
    } else if (s.source === 'cache') t.cacheHits++;
    else t.policyTurns++;
    if (s.schema === 'pass') t.schemaPass++;
    else if (s.schema === 'repaired') t.schemaRepaired++;
    else if (s.schema === 'fail') t.schemaFail++;
    t.guardrailFlags += s.guardrails.filter((g) => !g.passed).length;
  }
  return t;
}

// ---------------------------------------------------------------------------------------
// Lifetime numbers, kept across meetings and reloads

export interface AiStats {
  meetings: number;
  llmCalls: number;
  cacheHits: number;
  policyTurns: number;
  promptTokens: number;
  completionTokens: number;
  latencyMs: number;
  schemaPass: number;
  schemaRepaired: number;
  schemaFail: number;
  guardrailFlags: number;
  overrides: number;
  decisions: number;
  followedChair: number;
}

export const EMPTY_STATS: AiStats = {
  meetings: 0,
  llmCalls: 0,
  cacheHits: 0,
  policyTurns: 0,
  promptTokens: 0,
  completionTokens: 0,
  latencyMs: 0,
  schemaPass: 0,
  schemaRepaired: 0,
  schemaFail: 0,
  guardrailFlags: 0,
  overrides: 0,
  decisions: 0,
  followedChair: 0,
};

const STATS_KEY = 'metropolis.ai.stats.v1';
const TRACES_KEY = 'metropolis.ai.traces.v1';
const KEEP_TRACES = 4;

export function loadStats(kv: KV): AiStats {
  return { ...EMPTY_STATS, ...readJson<Partial<AiStats>>(kv, STATS_KEY, {}) };
}

/** Folds a finished meeting into the lifetime numbers. */
export function addToStats(stats: AiStats, trace: CouncilTrace): AiStats {
  const t = trace.totals;
  return {
    meetings: stats.meetings + 1,
    llmCalls: stats.llmCalls + t.llmCalls,
    cacheHits: stats.cacheHits + t.cacheHits,
    policyTurns: stats.policyTurns + t.policyTurns,
    promptTokens: stats.promptTokens + t.promptTokens,
    completionTokens: stats.completionTokens + t.completionTokens,
    latencyMs: stats.latencyMs + t.latencyMs,
    schemaPass: stats.schemaPass + t.schemaPass,
    schemaRepaired: stats.schemaRepaired + t.schemaRepaired,
    schemaFail: stats.schemaFail + t.schemaFail,
    guardrailFlags: stats.guardrailFlags + t.guardrailFlags,
    overrides: stats.overrides + (trace.verdict?.status === 'overridden' ? 1 : 0),
    decisions: stats.decisions,
    followedChair: stats.followedChair,
  };
}

export function saveStats(kv: KV, stats: AiStats): void {
  kv.set(STATS_KEY, JSON.stringify(stats));
}

export function loadTraces(kv: KV): CouncilTrace[] {
  return readJson<CouncilTrace[]>(kv, TRACES_KEY, []);
}

/** Keeps the last few meetings so the inspector has something to show after a reload. */
export function saveTrace(kv: KV, trace: CouncilTrace): CouncilTrace[] {
  const all = [trace, ...loadTraces(kv).filter((t) => t.id !== trace.id)].slice(0, KEEP_TRACES);
  kv.set(TRACES_KEY, JSON.stringify(all));
  return all;
}

// ---------------------------------------------------------------------------------------

/** Collects one meeting's trace and tells the UI whenever it changes. */
export class Recorder {
  readonly trace: CouncilTrace;
  private nextSpan = 1;
  private readonly t0 = Date.now();

  constructor(
    init: Omit<CouncilTrace, 'id' | 'startedAt' | 'node' | 'transitions' | 'spans' | 'totals'>,
    private readonly onChange: (trace: CouncilTrace) => void = () => {},
  ) {
    this.trace = { ...init, id: `${init.issue.key}@${this.t0.toString(36)}`, startedAt: this.t0, node: 'detect', transitions: [], spans: [], totals: totalsOf([]) };
  }

  /** Milliseconds since the trace began. */
  elapsed(): number {
    return Date.now() - this.t0;
  }

  span(span: Omit<AgentSpan, 'id'>): AgentSpan {
    const s = { ...span, id: this.nextSpan++ };
    this.trace.spans.push(s);
    this.trace.totals = totalsOf(this.trace.spans);
    this.changed();
    return s;
  }

  graph(node: GraphNode, transitions: readonly Transition[]): void {
    this.trace.node = node;
    this.trace.transitions = transitions.slice();
    this.changed();
  }

  set(patch: Partial<Pick<CouncilTrace, 'verdict' | 'attribution' | 'execution' | 'mode' | 'memory'>>): void {
    Object.assign(this.trace, patch);
    this.changed();
  }

  /** New spans and a fresh graph for a meeting that is run again on the same issue. */
  restart(mode: 'live' | 'offline'): void {
    this.trace.spans = [];
    this.trace.totals = totalsOf([]);
    this.trace.mode = mode;
    this.trace.verdict = undefined;
    this.trace.attribution = undefined;
    this.trace.execution = undefined;
    this.changed();
  }

  private changed(): void {
    // A new object each time, so signal subscribers see a change.
    this.onChange({ ...this.trace, spans: this.trace.spans.slice() });
  }
}
