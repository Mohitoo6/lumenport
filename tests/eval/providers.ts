import { loadEnv } from 'vite';
import { complete, readProviders, type Provider } from '../../server/llmProxy';

/**
 * Providers for the evaluations. Free tiers run out (daily quotas) and throttle (tokens per
 * minute), so the evaluation first checks which providers answer at all, then waits out
 * rate limits instead of counting them as failures.
 */

export interface EvalProviders {
  speakers: Provider[];
  judge: Provider[];
  notes: string[];
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

export async function evalProviders(): Promise<EvalProviders> {
  const all = readProviders(loadEnv('development', process.cwd(), ''));
  const speakers: Provider[] = [];
  const notes: string[] = [];
  for (const p of all) {
    const r = await complete([p], { system: 'Reply with JSON {"ok": true}', user: 'ping', maxTokens: 30, json: true });
    if ('error' in r) notes.push(`${p.model}: unavailable (${r.error.replace(/\s+/g, ' ').slice(r.error.indexOf(':') + 1, r.error.indexOf(':') + 90).trim()}…)`);
    else speakers.push(p);
  }
  if (speakers.length === 0) throw new Error(`No provider answers: ${notes.join('; ')}`);
  // The judge should be a different model family from the speakers. EVAL_JUDGE_MODEL picks a
  // model on the same service as a working provider (default: Qwen on Groq).
  const judgeModel = process.env.EVAL_JUDGE_MODEL ?? 'qwen/qwen3.8-27b';
  const host = speakers.find((p) => /groq/i.test(p.baseUrl)) ?? speakers[0]!;
  const judge = [{ ...host, model: judgeModel }];
  return { speakers, judge, notes };
}

/** `complete`, but waits out rate limits ("try again in 9.4s") and retries. */
export async function patient(providers: Provider[], req: Parameters<typeof complete>[1], attempts = 10): Promise<Awaited<ReturnType<typeof complete>>> {
  let last: Awaited<ReturnType<typeof complete>> = { error: 'not tried' };
  for (let i = 0; i < attempts; i++) {
    last = await complete(providers, req);
    if (!('error' in last)) return last;
    if (!/\b(429|503|timeout|timed out)\b/i.test(last.error)) return last;
    const waits = [...last.error.matchAll(/try again in ([\d.]+)\s*(ms|s)/gi)].map((m) => Number(m[1]) * (m[2]!.toLowerCase() === 'ms' ? 1 : 1000));
    await sleep(Math.min(60_000, (waits.length ? Math.max(...waits) : 8000 * (i + 1)) + 500));
  }
  return last;
}
