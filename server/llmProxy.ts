import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Plugin } from 'vite';
import { Guard, limitsFrom } from './guard';
import { ALLOWED_HOSTS } from '../src/game/aiKey';

/**
 * A small server-side endpoint for the AI council. The browser posts a prompt to
 * `/api/llm`; this code adds the API key and calls an OpenAI-compatible chat endpoint. Keys
 * stay in `.env` on the machine running the server and never reach the page.
 *
 * Providers are read from `.env` in order: LLM_*, then FALLBACK1_*, FALLBACK2_*, ... Each
 * needs BASE_URL, MODEL and API_KEY; REASONING_EFFORT is optional. If one is rate-limited,
 * overloaded or misconfigured, the next is tried, and the failing one is rested for a while.
 */

export interface Provider {
  name: string;
  baseUrl: string;
  model: string;
  apiKey: string;
  effort?: string;
}

export function readProviders(env: Record<string, string | undefined>): Provider[] {
  const prefixes = ['LLM', ...Array.from({ length: 9 }, (_, i) => `FALLBACK${i + 1}`)];
  const out: Provider[] = [];
  for (const p of prefixes) {
    const baseUrl = env[`${p}_BASE_URL`]?.trim();
    const model = env[`${p}_MODEL`]?.trim();
    const apiKey = env[`${p}_API_KEY`]?.trim();
    if (!baseUrl || !model || !apiKey) continue;
    const host = (() => {
      try {
        return new URL(baseUrl).host;
      } catch {
        return baseUrl;
      }
    })();
    const name = host.includes('generativelanguage') ? 'Gemini' : host.includes('groq') ? 'Groq' : host.includes('openrouter') ? 'OpenRouter' : host;
    out.push({ name, baseUrl: baseUrl.replace(/\/+$/, ''), model, apiKey, effort: env[`${p}_REASONING_EFFORT`]?.trim() || undefined });
  }
  return out;
}

interface CompleteRequest {
  system: string;
  user: string;
  maxTokens?: number;
  json?: boolean;
  /** JSON Schema the reply must fit. Sent as a structured-output constraint where supported. */
  schema?: Record<string, unknown>;
  schemaName?: string;
}

/** Token counts as the provider reported them. */
export interface Usage {
  prompt: number;
  completion: number;
  /** Hidden reasoning tokens (billed, not shown). */
  reasoning: number;
}

export interface Completion {
  text: string;
  provider: string;
  usage?: Usage;
  /** Time inside the provider call that answered, in milliseconds. */
  latencyMs: number;
  /** Why the model stopped; "length" means the output budget ran out. */
  finish?: string;
  /** Provider calls made for this one request, counting fall backs. */
  attempts: number;
}

/**
 * How strictly a provider can be asked for JSON, strongest first: a full JSON Schema
 * (the reply is constrained to the contract), plain JSON mode, or nothing but the prompt.
 */
type JsonMode = 'schema' | 'object' | 'none';

/**
 * How long one provider may take before the next is tried. A meeting is interactive: a
 * provider that hangs must not stall it while a faster fallback is waiting.
 */
const TIMEOUT_MS = 20_000;
/**
 * Used when a provider has no REASONING_EFFORT in .env. Council replies are two sentences
 * of JSON; hidden reasoning was measured at over 90% of the output tokens without this.
 */
const DEFAULT_EFFORT = 'low';
/** Providers that refused the default reasoning effort: it is not sent to them again. */
const noEffort = new Set<string>();
const keyOf = (p: Provider): string => `${p.baseUrl}|${p.model}`;
/** Provider -> time until which it is tried last. */
const resting = new Map<string, number>();
/** Provider -> the strongest JSON mode it has accepted, so a rejected mode is not sent twice. */
const jsonModes = new Map<string, JsonMode>();

interface ProviderResult {
  status: number;
  text?: string;
  error?: string;
  usage?: Usage;
  finish?: string;
  latencyMs: number;
}

interface ChatResponse {
  choices?: Array<{ message?: { content?: unknown }; finish_reason?: string }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number; completion_tokens_details?: { reasoning_tokens?: number } };
  error?: { message?: string } | string;
}

function usageOf(u: ChatResponse['usage']): Usage | undefined {
  if (!u || typeof u.prompt_tokens !== 'number') return undefined;
  const completion = u.completion_tokens ?? 0;
  // Some providers put reasoning in the details; others only show it as a gap in the total.
  const reasoning = u.completion_tokens_details?.reasoning_tokens ?? Math.max(0, (u.total_tokens ?? 0) - u.prompt_tokens - completion);
  return { prompt: u.prompt_tokens, completion, reasoning };
}

async function callProvider(p: Provider, req: CompleteRequest, mode: JsonMode, timeoutMs = TIMEOUT_MS): Promise<ProviderResult> {
  const body: Record<string, unknown> = {
    model: p.model,
    messages: [
      { role: 'system', content: req.system },
      { role: 'user', content: req.user },
    ],
    max_tokens: Math.min(4000, Math.max(200, req.maxTokens ?? 1200)),
  };
  if (mode === 'schema' && req.schema) body.response_format = { type: 'json_schema', json_schema: { name: req.schemaName ?? 'reply', strict: true, schema: req.schema } };
  else if (mode !== 'none' && req.json) body.response_format = { type: 'json_object' };
  const effort = p.effort ?? (noEffort.has(keyOf(p)) ? undefined : DEFAULT_EFFORT);
  if (effort) body.reasoning_effort = effort;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  const t0 = Date.now();
  try {
    const res = await fetch(`${p.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${p.apiKey}` },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    const raw = await res.text();
    const latencyMs = Date.now() - t0;
    let data: ChatResponse = {};
    try {
      data = JSON.parse(raw) as ChatResponse;
    } catch {
      // Some errors come back as plain text.
    }
    if (!res.ok) {
      const msg = typeof data.error === 'string' ? data.error : (data.error?.message ?? raw.slice(0, 200));
      return { status: res.status, error: msg, latencyMs };
    }
    const choice = data.choices?.[0];
    const content = choice?.message?.content;
    const usage = usageOf(data.usage);
    if (typeof content !== 'string' || content.trim() === '') return { status: 502, error: choice?.finish_reason === 'length' ? 'empty reply: the output budget ran out' : 'empty reply', latencyMs, usage };
    return { status: 200, text: content, usage, finish: choice?.finish_reason, latencyMs };
  } catch (err) {
    return { status: 504, error: ctrl.signal.aborted ? 'timed out' : err instanceof Error ? err.message : String(err), latencyMs: Date.now() - t0 };
  } finally {
    clearTimeout(timer);
  }
}

const WEAKER: Record<JsonMode, JsonMode | null> = { schema: 'object', object: 'none', none: null };

export async function complete(providers: Provider[], req: CompleteRequest, timeoutMs = TIMEOUT_MS): Promise<Completion | { error: string; rateLimited: boolean }> {
  const errors: string[] = [];
  const now = Date.now();
  let attempts = 0;
  let limited = 0;
  // Rested providers are tried last rather than never, in case all of them are resting.
  const order = providers.map((_, i) => i).sort((a, b) => Number((resting.get(keyOf(providers[a]!)) ?? 0) > now) - Number((resting.get(keyOf(providers[b]!)) ?? 0) > now));
  for (const i of order) {
    const p = providers[i]!;
    const key = keyOf(p);
    let mode: JsonMode | null = jsonModes.get(key) ?? (req.schema ? 'schema' : 'object');
    if (mode === 'schema' && !req.schema) mode = 'object';
    let r: ProviderResult = { status: 0, latencyMs: 0 };
    // Not every model accepts a schema, or JSON mode at all: step down once per rejection
    // and remember what worked (the prompt still asks for JSON either way).
    while (mode) {
      attempts++;
      r = await callProvider(p, req, mode, timeoutMs);
      if (r.status !== 400) break;
      if (/response_format|json|schema/i.test(r.error ?? '')) {
        mode = WEAKER[mode];
        continue;
      }
      // Any other rejection may be the default reasoning effort, which not every model
      // takes: ask once more without it, and never send it to this provider again.
      if (!p.effort && !noEffort.has(key)) {
        noEffort.add(key);
        continue;
      }
      break;
    }
    if (r.status === 200 && r.text) {
      resting.delete(key);
      if (mode && (req.schema || mode !== 'schema')) jsonModes.set(key, mode);
      return { text: r.text, provider: `${p.name} · ${p.model}`, usage: r.usage, latencyMs: r.latencyMs, finish: r.finish, attempts };
    }
    // Overloaded or rate-limited providers stay that way for a while: rest them, not just skip once.
    // A provider that hangs is rested as long as a misconfigured one: each retry costs the full timeout.
    const rest = r.status === 401 || r.status === 403 || r.status === 404 ? 10 * 60_000 : r.status === 504 ? 5 * 60_000 : r.status === 429 || r.status === 503 ? 180_000 : 60_000;
    if (r.status === 429 || r.status === 503) limited++;
    resting.set(key, Date.now() + rest);
    errors.push(`${p.name} ${p.model}: ${r.status} ${r.error ?? ''}`.trim());
  }
  if (providers.length === 0) return { error: 'No AI provider is configured: add LLM_BASE_URL, LLM_MODEL and LLM_API_KEY to .env.', rateLimited: false };
  return { error: `All AI providers failed. ${errors.join(' | ')}`, rateLimited: limited === providers.length };
}

/** Which providers are resting after a failure, and for how much longer. */
export function providerHealth(providers: Provider[]): Array<{ name: string; restingMs: number }> {
  const now = Date.now();
  return providers.map((p) => ({ name: `${p.name} · ${p.model}`, restingMs: Math.max(0, (resting.get(keyOf(p)) ?? 0) - now) }));
}

function send(res: ServerResponse, status: number, body: unknown): void {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}

function readBody(req: IncomingMessage, limit: number): Promise<string> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > limit) {
        reject(new Error('Request too large'));
        req.destroy();
      } else chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

/** Checks a player's own provider settings; only known provider hosts are allowed. */
export function ownProvider(o: { baseUrl?: unknown; model?: unknown; apiKey?: unknown }): Provider | { error: string } {
  if (typeof o.baseUrl !== 'string' || typeof o.model !== 'string' || typeof o.apiKey !== 'string' || !o.apiKey.trim() || !o.model.trim()) return { error: 'Your AI key settings are incomplete' };
  let host = '';
  try {
    const u = new URL(o.baseUrl);
    if (u.protocol !== 'https:') return { error: 'Your AI provider must use https' };
    host = u.host;
  } catch {
    return { error: 'Your AI provider address is not a URL' };
  }
  if (!ALLOWED_HOSTS.includes(host)) return { error: `The game does not forward keys to ${host}` };
  return { name: 'Your key', baseUrl: o.baseUrl.replace(/\/+$/, ''), model: o.model.trim().slice(0, 120), apiKey: o.apiKey.trim() };
}

/**
 * The endpoint itself, shared by the dev server and a hosted function. `guard` is null on
 * a laptop; hosted (LLM_PUBLIC=1, or any serverless host) every call passes through it.
 */
export function llmHandler(env: Record<string, string | undefined>, opts: { public?: boolean } = {}) {
  const providers = readProviders(env);
  const guard = opts.public || env.LLM_PUBLIC === '1' ? new Guard(limitsFrom(env)) : null;
  return async (req: IncomingMessage & { body?: unknown }, res: ServerResponse, next?: () => void): Promise<void> => {
    const url = (req.url ?? '').split('?')[0];
    if (url === '/api/llm/status' && req.method === 'GET') {
      send(res, 200, { ready: providers.length > 0, providers: providers.map((p) => `${p.name} · ${p.model}`), health: providerHealth(providers), limited: guard !== null });
      return;
    }
    if (url !== '/api/llm') {
      if (next) next();
      else send(res, 404, { error: 'Not found' });
      return;
    }
    if (req.method !== 'POST') return send(res, 405, { error: 'POST only' });
    try {
      // Serverless hosts may have parsed the body already.
      const raw = req.body !== undefined ? (typeof req.body === 'string' ? req.body : JSON.stringify(req.body)) : await readBody(req, 256_000);
      const body = JSON.parse(raw) as CompleteRequest & { own?: { baseUrl?: unknown; model?: unknown; apiKey?: unknown } };
      if (typeof body.system !== 'string' || typeof body.user !== 'string') return send(res, 400, { error: 'system and user are required' });
      // A player's own key: forwarded to that provider for this one call, never stored or logged.
      const own = body.own ? ownProvider(body.own) : null;
      delete body.own;
      if (own && 'error' in own) return send(res, 400, { error: own.error });
      if (guard) {
        const fwd = req.headers['x-forwarded-for'];
        const visitor = (Array.isArray(fwd) ? fwd[0] : fwd)?.split(',')[0]?.trim() || req.socket?.remoteAddress || 'unknown';
        const v = guard.check(visitor, body.system.length + body.user.length, own !== null);
        if (!v.ok) {
          if (v.retryAfterS) res.setHeader('Retry-After', String(v.retryAfterS));
          return send(res, v.status, { error: v.error, rateLimited: v.status === 429 });
        }
        body.maxTokens = Math.min(body.maxTokens ?? guard.limits.maxOutputTokens, guard.limits.maxOutputTokens);
      }
      const out = await complete(own ? [own] : providers, body);
      if ('error' in out) send(res, out.rateLimited ? 429 : 502, out);
      else send(res, 200, out);
    } catch (err) {
      send(res, 400, { error: err instanceof Error ? err.message : 'Bad request' });
    }
  };
}

export function llmProxy(env: Record<string, string | undefined>): Plugin {
  const handler = llmHandler(env);
  return {
    name: 'metropolis-llm-proxy',
    configureServer(server) {
      server.middlewares.use((req, res, next) => void handler(req, res, next));
    },
    configurePreviewServer(server) {
      server.middlewares.use((req, res, next) => void handler(req, res, next));
    },
  };
}
