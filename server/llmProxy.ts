import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Plugin } from 'vite';

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
}

const TIMEOUT_MS = 50_000;
/** Provider index -> time until which it is skipped. */
const resting = new Map<number, number>();

async function callProvider(p: Provider, req: CompleteRequest, withJsonMode: boolean): Promise<{ status: number; text?: string; error?: string }> {
  const body: Record<string, unknown> = {
    model: p.model,
    messages: [
      { role: 'system', content: req.system },
      { role: 'user', content: req.user },
    ],
    max_tokens: Math.min(4000, Math.max(200, req.maxTokens ?? 1200)),
  };
  if (req.json && withJsonMode) body.response_format = { type: 'json_object' };
  if (p.effort) body.reasoning_effort = p.effort;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${p.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${p.apiKey}` },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    const raw = await res.text();
    let data: { choices?: Array<{ message?: { content?: unknown } }>; error?: { message?: string } | string } = {};
    try {
      data = JSON.parse(raw) as typeof data;
    } catch {
      // Some errors come back as plain text.
    }
    if (!res.ok) {
      const msg = typeof data.error === 'string' ? data.error : (data.error?.message ?? raw.slice(0, 200));
      return { status: res.status, error: msg };
    }
    const content = data.choices?.[0]?.message?.content;
    if (typeof content !== 'string' || content.trim() === '') return { status: 502, error: 'empty reply' };
    return { status: 200, text: content };
  } catch (err) {
    return { status: 504, error: ctrl.signal.aborted ? 'timed out' : err instanceof Error ? err.message : String(err) };
  } finally {
    clearTimeout(timer);
  }
}

export async function complete(providers: Provider[], req: CompleteRequest): Promise<{ text: string; provider: string } | { error: string }> {
  const errors: string[] = [];
  const now = Date.now();
  // Rested providers are tried last rather than never, in case all of them are resting.
  const order = providers.map((_, i) => i).sort((a, b) => Number((resting.get(a) ?? 0) > now) - Number((resting.get(b) ?? 0) > now));
  for (const i of order) {
    const p = providers[i]!;
    let r = await callProvider(p, req, true);
    // Some models reject JSON mode: ask again without it (the prompt still asks for JSON).
    if (r.status === 400 && /response_format|json/i.test(r.error ?? '')) r = await callProvider(p, req, false);
    if (r.status === 200 && r.text) {
      resting.delete(i);
      return { text: r.text, provider: `${p.name} · ${p.model}` };
    }
    // Overloaded or rate-limited providers stay that way for a while: rest them, not just skip once.
    const rest = r.status === 401 || r.status === 403 || r.status === 404 ? 10 * 60_000 : r.status === 429 || r.status === 503 ? 180_000 : 60_000;
    resting.set(i, Date.now() + rest);
    errors.push(`${p.name} ${p.model}: ${r.status} ${r.error ?? ''}`.trim());
  }
  return { error: providers.length ? `All AI providers failed. ${errors.join(' | ')}` : 'No AI provider is configured: add LLM_BASE_URL, LLM_MODEL and LLM_API_KEY to .env.' };
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

export function llmProxy(env: Record<string, string | undefined>): Plugin {
  const providers = readProviders(env);
  const handler = async (req: IncomingMessage, res: ServerResponse, next: () => void): Promise<void> => {
    const url = req.url ?? '';
    if (url === '/api/llm/status' && req.method === 'GET') {
      send(res, 200, { ready: providers.length > 0, providers: providers.map((p) => `${p.name} · ${p.model}`) });
      return;
    }
    if (url !== '/api/llm') return next();
    if (req.method !== 'POST') return send(res, 405, { error: 'POST only' });
    try {
      const body = JSON.parse(await readBody(req, 256_000)) as CompleteRequest;
      if (typeof body.system !== 'string' || typeof body.user !== 'string') return send(res, 400, { error: 'system and user are required' });
      const out = await complete(providers, body);
      if ('error' in out) send(res, 502, out);
      else send(res, 200, out);
    } catch (err) {
      send(res, 400, { error: err instanceof Error ? err.message : 'Bad request' });
    }
  };
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
