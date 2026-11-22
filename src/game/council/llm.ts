import type { Constraint } from './constraints';
import { loadOwnKey, ownKeyField } from '../aiKey';
import type { FiscalLimits } from './effects';
import type { MinistryId } from './ministries';
import type { CouncilOption } from './options';
import { policyTurn, policyVerdict, type Lang } from './policy';
import { extractJson } from './schemas';
import { hashText, readJson, type KV } from './storage';

export interface LlmRequest {
  system: string;
  user: string;
  maxTokens: number;
  /** JSON Schema of the reply, sent to providers that can enforce one. */
  schema?: Record<string, unknown>;
  schemaName?: string;
  /** Who is speaking, with the structured view of the meeting. The model never sees this; the offline agents and tests use it. */
  meta: {
    role: 'minister' | 'chief';
    minister?: MinistryId;
    round?: 1 | 2;
    lead?: boolean;
    options: readonly CouncilOption[];
    lang: Lang;
    reason?: string;
    /** The best-backed option so far. */
    backed?: string;
    limits?: FiscalLimits;
    /** Where each minister stands so far. */
    positions?: ReadonlyMap<MinistryId, string>;
    tally?: Record<string, MinistryId[]>;
    constraints?: readonly Constraint[];
  };
}

export interface LlmUsage {
  prompt: number;
  completion: number;
  reasoning: number;
}

export interface LlmReply {
  text: string;
  /** Which provider and model answered, for the transparency line in the UI. */
  provider: string;
  /** Token counts from the provider's own response, when it sent them. */
  usage?: LlmUsage;
  /** Time spent in the provider call, as measured by the server. */
  latencyMs?: number;
  /** The reply came from the local cache: no request was made. */
  cached?: boolean;
  /** The reply came from the deterministic agents, not a model. */
  offline?: boolean;
  /** Why the model stopped ("length" means it ran out of output budget). */
  finish?: string;
}

/** A failed model call, with what the caller needs to decide whether to try again. */
export class LlmError extends Error {
  constructor(
    message: string,
    readonly status: number,
    /** Every provider refused for rate limits or overload: trying again now is pointless. */
    readonly rateLimited: boolean,
  ) {
    super(message);
    this.name = 'LlmError';
  }
}

export interface Transport {
  /** Shown in the council panel: where the ministers' words come from. */
  readonly label: string;
  complete(req: LlmRequest, signal?: AbortSignal): Promise<LlmReply>;
}

/**
 * Talks to the language model through the game's own server (`/api/llm`), which holds the
 * API keys and tries each configured provider in turn. Keys never reach the browser.
 */
export class HttpTransport implements Transport {
  readonly label = 'AI';

  async complete(req: LlmRequest, signal?: AbortSignal): Promise<LlmReply> {
    const res = await fetch('/api/llm', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ system: req.system, user: req.user, maxTokens: req.maxTokens, json: true, schema: req.schema, schemaName: req.schemaName, ...ownKeyField() }),
      signal,
    });
    const data = (await res.json().catch(() => ({}))) as { text?: string; provider?: string; error?: string; usage?: LlmUsage; latencyMs?: number; finish?: string; rateLimited?: boolean };
    if (!res.ok || typeof data.text !== 'string') throw new LlmError(data.error ?? `The AI server answered ${res.status}`, res.status, data.rateLimited === true || res.status === 429);
    return { text: data.text, provider: data.provider ?? 'unknown', usage: data.usage, latencyMs: data.latencyMs, finish: data.finish };
  }
}

export interface ProviderHealth {
  name: string;
  /** Milliseconds until a rate-limited or failing provider is tried first again; 0 when healthy. */
  restingMs: number;
}

export interface AiStatus {
  ready: boolean;
  providers: string[];
  health: ProviderHealth[];
}

/** Whether the server has any AI provider configured, and which are resting after a rate limit. */
export async function aiStatus(): Promise<AiStatus> {
  // A player's own key makes the AI available whatever the shared keys are doing.
  const own = loadOwnKey();
  if (own) return { ready: true, providers: [`Your key · ${own.model}`], health: [] };
  try {
    const res = await fetch('/api/llm/status');
    if (!res.ok) return { ready: false, providers: [], health: [] };
    const data = (await res.json()) as Partial<AiStatus>;
    return { ready: data.ready === true, providers: data.providers ?? [], health: data.health ?? [] };
  } catch {
    return { ready: false, providers: [], health: [] };
  }
}

const CACHE_KEY = 'metropolis.ai.cache.v1';
const CACHE_SIZE = 48;

/**
 * An exact-match response cache in front of any transport. The key is a hash of the whole
 * prompt, so a hit is only possible when an agent is asked exactly the same thing about
 * exactly the same city: re-running a meeting, or resuming one that was cut off by a rate
 * limit. A hit costs no request and no tokens. Kept in local storage, newest first.
 */
export class CachedTransport implements Transport {
  readonly label: string;
  private entries: Array<{ key: string; text: string; provider: string }>;

  constructor(
    private readonly inner: Transport,
    private readonly kv: KV,
  ) {
    this.label = inner.label;
    this.entries = readJson(kv, CACHE_KEY, [] as Array<{ key: string; text: string; provider: string }>);
  }

  async complete(req: LlmRequest, signal?: AbortSignal): Promise<LlmReply> {
    const key = `${hashText(req.system)}${hashText(req.user)}:${req.system.length + req.user.length}`;
    const hit = this.entries.find((e) => e.key === key);
    if (hit) return { text: hit.text, provider: hit.provider, cached: true };
    const reply = await this.inner.complete(req, signal);
    // Only real model output is worth keeping; the offline agents are free to recompute.
    if (!reply.offline) {
      this.entries = [{ key, text: reply.text, provider: reply.provider }, ...this.entries.filter((e) => e.key !== key)].slice(0, CACHE_SIZE);
      this.kv.set(CACHE_KEY, JSON.stringify(this.entries));
    }
    return reply;
  }
}

const NO_LIMITS: FiscalLimits = { sandbox: true, treasury: 0, hourlyNet: 0, loanHeadroom: 0, spendCeiling: Infinity, runwayHours: null };

/**
 * The offline council: every turn is taken by the deterministic policy agents
 * (`policy.ts`). Used by the offline mode, by tests and by the screenshot runs, and
 * labelled as such in the UI so a player never mistakes it for the model.
 */
export class DemoTransport implements Transport {
  readonly label = 'Offline (no AI)';

  async complete(req: LlmRequest): Promise<LlmReply> {
    await new Promise((r) => setTimeout(r, 40));
    const { meta } = req;
    const limits = meta.limits ?? NO_LIMITS;
    const body =
      meta.role === 'chief'
        ? policyVerdict(meta.options, meta.tally ?? (meta.backed && meta.backed !== 'none' ? { [meta.backed]: [] } : {}), meta.lang, meta.constraints)
        : policyTurn(meta.minister!, meta.round ?? 1, meta.lead === true, { options: meta.options, limits, lang: meta.lang, positions: meta.positions, constraints: meta.constraints });
    return { provider: 'deterministic policy', text: JSON.stringify(body), offline: true };
  }
}

/** Pulls the first JSON object out of a model reply, tolerating code fences and chatter. */
export function parseJsonReply(text: string): Record<string, unknown> | null {
  return extractJson(text)?.value ?? null;
}
