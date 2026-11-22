/**
 * Abuse limits for a public deployment of the AI endpoint. On a laptop (`npm run dev`) the
 * endpoint is only reachable by its owner and none of this applies. Hosted, anyone can
 * post to `/api/llm`, so without limits the site's free-tier keys become a free
 * chatbot for the internet. The guard caps:
 *
 *   - calls per visitor (by IP) in a rolling ten minutes: a council meeting is at most 8
 *     calls and an assistant question 1, so the default allows a few meetings;
 *   - calls per day for the whole deployment, so a busy day cannot exhaust a free tier;
 *   - prompt size and output tokens, so a call cannot be used for anything large.
 *
 * Counters live in memory. On a serverless host each warm instance counts on its own, so
 * the real ceiling is a multiple of these numbers; a shared store (Redis, KV) would make
 * it exact. That is stated in the README rather than hidden.
 */
export interface GuardLimits {
  perVisitor: number;
  windowMs: number;
  perDay: number;
  /** Calls per visitor in the same window when they bring their own key (no daily cap then). */
  perVisitorOwnKey: number;
  /** Characters of system plus user prompt. */
  maxPromptChars: number;
  maxOutputTokens: number;
}

export function limitsFrom(env: Record<string, string | undefined>): GuardLimits {
  const n = (k: string, d: number): number => {
    const v = Number(env[k]);
    return Number.isFinite(v) && v > 0 ? v : d;
  };
  return {
    perVisitor: n('LLM_CALLS_PER_VISITOR', 30),
    windowMs: 10 * 60_000,
    perDay: n('LLM_CALLS_PER_DAY', 500),
    perVisitorOwnKey: n('LLM_OWN_KEY_CALLS_PER_VISITOR', 150),
    maxPromptChars: n('LLM_MAX_PROMPT_CHARS', 24_000),
    maxOutputTokens: n('LLM_MAX_OUTPUT_TOKENS', 1_000),
  };
}

export type Verdict = { ok: true } | { ok: false; status: number; error: string; retryAfterS?: number };

export class Guard {
  private readonly visitors = new Map<string, number[]>();
  private day = '';
  private today = 0;

  constructor(
    readonly limits: GuardLimits,
    private readonly now: () => number = Date.now,
  ) {}

  /** Checks a request before any provider is called; counts it if allowed. */
  check(visitor: string, promptChars: number, ownKey = false): Verdict {
    const t = this.now();
    if (promptChars > this.limits.maxPromptChars) return { ok: false, status: 413, error: `Prompt too long (${promptChars} characters; the limit is ${this.limits.maxPromptChars})` };
    const d = new Date(t).toISOString().slice(0, 10);
    if (d !== this.day) {
      this.day = d;
      this.today = 0;
    }
    // A visitor on their own key pays for their own calls: no share of the daily cap.
    if (!ownKey && this.today >= this.limits.perDay)
      return { ok: false, status: 429, error: 'The free AI has reached its daily limit for this site. The council carries on with its offline ministers; add your own API key in Menu > AI to keep live ministers.', retryAfterS: 3600 };
    const key = ownKey ? `own:${visitor}` : visitor;
    const cap = ownKey ? this.limits.perVisitorOwnKey : this.limits.perVisitor;
    const recent = (this.visitors.get(key) ?? []).filter((x) => t - x < this.limits.windowMs);
    if (recent.length >= cap) {
      const retryAfterS = Math.ceil((recent[0]! + this.limits.windowMs - t) / 1000);
      this.visitors.set(key, recent);
      return { ok: false, status: 429, error: `Too many AI calls from this browser; try again in ${Math.ceil(retryAfterS / 60)} min. The offline council still works${ownKey ? '' : ', or add your own API key in Menu > AI'}.`, retryAfterS };
    }
    recent.push(t);
    this.visitors.set(key, recent);
    if (!ownKey) this.today++;
    // Keep the map from growing without bound on a long-lived instance.
    if (this.visitors.size > 5000) for (const [k, v] of this.visitors) if (t - v[v.length - 1]! >= this.limits.windowMs) this.visitors.delete(k);
    return { ok: true };
  }
}
