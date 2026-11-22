import { EventEmitter } from 'node:events';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { describe, expect, it } from 'vitest';
import { Guard, limitsFrom } from '../../server/guard';
import { llmHandler } from '../../server/llmProxy';

const limits = { perVisitor: 3, windowMs: 600_000, perDay: 5, perVisitorOwnKey: 10, maxPromptChars: 100, maxOutputTokens: 50 };

describe('the public endpoint guard', () => {
  it('limits each visitor in a rolling window, then lets them back in', () => {
    let t = Date.UTC(2026, 10, 21, 9);
    const g = new Guard(limits, () => t);
    for (let i = 0; i < 3; i++) expect(g.check('a', 10).ok).toBe(true);
    const no = g.check('a', 10);
    expect(no.ok).toBe(false);
    expect(!no.ok && no.status).toBe(429);
    expect(g.check('b', 10).ok).toBe(true);
    t += 600_001;
    expect(g.check('a', 10).ok).toBe(true);
  });

  it('caps the whole site per day, and resets the next day', () => {
    let t = Date.UTC(2026, 10, 21, 9);
    const g = new Guard({ ...limits, perVisitor: 100 }, () => t);
    for (let i = 0; i < 5; i++) expect(g.check(`v${i}`, 10).ok).toBe(true);
    expect(g.check('new', 10).ok).toBe(false);
    t += 24 * 3600_000;
    expect(g.check('new', 10).ok).toBe(true);
  });

  it('refuses oversized prompts before calling anyone', () => {
    const g = new Guard(limits);
    const v = g.check('a', 101);
    expect(!v.ok && v.status).toBe(413);
  });

  it('reads its limits from the environment, with safe defaults', () => {
    expect(limitsFrom({}).perVisitor).toBe(30);
    expect(limitsFrom({ LLM_CALLS_PER_DAY: '42' }).perDay).toBe(42);
    expect(limitsFrom({ LLM_CALLS_PER_DAY: 'lots' }).perDay).toBe(500);
  });
});

/** A minimal request/response pair for the handler. */
function call(handler: ReturnType<typeof llmHandler>, url: string, method: string, body?: unknown, ip = '1.2.3.4') {
  const req = Object.assign(new EventEmitter(), { url, method, headers: { 'x-forwarded-for': ip }, socket: {}, body }) as unknown as IncomingMessage & { body?: unknown };
  let status = 0;
  let text = '';
  const res = { statusCode: 0, setHeader: () => undefined, end: (t: string) => ((text = t), (status = (res as { statusCode: number }).statusCode)) } as unknown as ServerResponse;
  return handler(req, res).then(() => ({ status, json: JSON.parse(text) as Record<string, unknown> }));
}

describe('the hosted endpoint', () => {
  it('reports that it is limited, and turns away a visitor over the limit without calling a provider', async () => {
    const h = llmHandler({ LLM_CALLS_PER_VISITOR: '1' }, { public: true });
    const status = await call(h, '/api/llm/status', 'GET');
    expect(status.json.limited).toBe(true);
    expect(status.json.ready).toBe(false);
    // No providers configured: the first call fails at the provider step, the second at the guard.
    const first = await call(h, '/api/llm', 'POST', { system: 's', user: 'u' });
    expect(first.status).not.toBe(429);
    const second = await call(h, '/api/llm', 'POST', { system: 's', user: 'u' });
    expect(second.status).toBe(429);
    expect(String(second.json.error)).toMatch(/offline council/);
  });

  it('is unguarded on the dev server unless LLM_PUBLIC is set', async () => {
    const h = llmHandler({});
    expect((await call(h, '/api/llm/status', 'GET')).json.limited).toBe(false);
    expect((await call(llmHandler({ LLM_PUBLIC: '1' }), '/api/llm/status', 'GET')).json.limited).toBe(true);
  });
});

describe('a player’s own key', () => {
  it('skips the site’s daily cap but keeps a per-visitor limit of its own', () => {
    const t = Date.UTC(2026, 10, 22, 9);
    const g = new Guard({ ...limits, perDay: 1, perVisitorOwnKey: 2 }, () => t);
    expect(g.check('a', 10).ok).toBe(true);
    expect(g.check('b', 10).ok).toBe(false);
    expect(g.check('b', 10, true).ok).toBe(true);
    expect(g.check('b', 10, true).ok).toBe(true);
    expect(g.check('b', 10, true).ok).toBe(false);
  });

  it('is forwarded only to known provider hosts, over https', async () => {
    const { ownProvider } = await import('../../server/llmProxy');
    expect(ownProvider({ baseUrl: 'https://api.groq.com/openai/v1/', model: 'm', apiKey: 'k' })).toMatchObject({ name: 'Your key', baseUrl: 'https://api.groq.com/openai/v1' });
    expect(ownProvider({ baseUrl: 'https://evil.example.com/v1', model: 'm', apiKey: 'k' })).toMatchObject({ error: expect.stringMatching(/does not forward/) });
    expect(ownProvider({ baseUrl: 'http://api.groq.com/openai/v1', model: 'm', apiKey: 'k' })).toMatchObject({ error: expect.stringMatching(/https/) });
    expect(ownProvider({ baseUrl: 'https://api.groq.com/openai/v1', model: 'm', apiKey: '' })).toMatchObject({ error: expect.any(String) });
  });

  it('sends the call to the player’s provider, not the site’s', async () => {
    const seen: string[] = [];
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async (url: string, init: RequestInit) => {
      seen.push(`${url} ${String((init.headers as Record<string, string>).Authorization)}`);
      return new Response(JSON.stringify({ choices: [{ message: { content: '{"ok":true}' }, finish_reason: 'stop' }], usage: { prompt_tokens: 3, completion_tokens: 2 } }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }) as typeof fetch;
    try {
      const h = llmHandler({ LLM_BASE_URL: 'https://site.example/v1', LLM_MODEL: 'site', LLM_API_KEY: 'site-key' }, { public: true });
      const r = await call(h, '/api/llm', 'POST', { system: 's', user: 'u', own: { baseUrl: 'https://api.groq.com/openai/v1', model: 'mine', apiKey: 'player-key' } });
      expect(r.status).toBe(200);
      expect(seen.length).toBeGreaterThan(0);
      expect(seen.every((s) => s.startsWith('https://api.groq.com/openai/v1') && s.endsWith('Bearer player-key'))).toBe(true);
      const bad = await call(h, '/api/llm', 'POST', { system: 's', user: 'u', own: { baseUrl: 'https://evil.example.com/v1', model: 'm', apiKey: 'k' } });
      expect(bad.status).toBe(400);
    } finally {
      globalThis.fetch = realFetch;
    }
  });
});
