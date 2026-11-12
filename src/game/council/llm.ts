import { MINISTER_BY_ID, type MinistryId } from './ministries';
import type { CouncilOption } from './options';
import type { Lang, Stance } from './prompts';

export interface LlmRequest {
  system: string;
  user: string;
  maxTokens: number;
  /** Who is speaking. The real transport ignores it; the demo transport uses it. */
  meta: { role: 'minister' | 'chief'; minister?: MinistryId; round?: 1 | 2; lead?: boolean; options: readonly CouncilOption[]; lang: Lang; reason?: string; backed?: string };
}

export interface LlmReply {
  text: string;
  /** Which provider and model answered, for the transparency line in the UI. */
  provider: string;
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
      body: JSON.stringify({ system: req.system, user: req.user, maxTokens: req.maxTokens, json: true }),
      signal,
    });
    const data = (await res.json().catch(() => ({}))) as { text?: string; provider?: string; error?: string };
    if (!res.ok || typeof data.text !== 'string') throw new Error(data.error ?? `The AI server answered ${res.status}`);
    return { text: data.text, provider: data.provider ?? 'unknown' };
  }
}

/** Whether the server has any AI provider configured. */
export async function aiStatus(): Promise<{ ready: boolean; providers: string[] }> {
  try {
    const res = await fetch('/api/llm/status');
    if (!res.ok) return { ready: false, providers: [] };
    return (await res.json()) as { ready: boolean; providers: string[] };
  } catch {
    return { ready: false, providers: [] };
  }
}

/**
 * Offline stand-in for the model: produces plausible, rule-based statements from the
 * option facts. Used by tests and the screenshot runs, and labelled "Demo" in the UI so a
 * player never mistakes it for the real thing.
 */
export class DemoTransport implements Transport {
  readonly label = 'Demo (no AI)';

  async complete(req: LlmRequest): Promise<LlmReply> {
    await new Promise((r) => setTimeout(r, 40));
    const { meta } = req;
    const opts = meta.options.filter((o) => o.actions.length > 0);
    const none = meta.options[meta.options.length - 1]!;
    const hi = meta.lang === 'hi';
    if (meta.role === 'chief') {
      const pick = meta.backed && meta.backed !== 'none' ? meta.backed : (opts[0]?.id ?? none.id);
      const o = meta.options.find((x) => x.id === pick) ?? none;
      return {
        provider: 'demo',
        text: JSON.stringify({
          option: o.id,
          summary: hi
            ? `परिषद का बहुमत विकल्प ${o.id} (${o.title}) के पक्ष में है। यह समस्या का सीधा समाधान है और उठाई गई आपत्तियों को ध्यान में रखता है।`
            : `The council mostly backs option ${o.id}, ${o.title.toLowerCase()}. It deals with the problem directly and the concerns raised can be managed.`,
          dissent: '',
          conditions: '',
        }),
      };
    }
    const id = meta.minister!;
    const m = MINISTER_BY_ID[id];
    const lead = meta.lead === true;
    // Rule of thumb per portfolio: which option this minister would back and why.
    const score = (o: CouncilOption): number => {
      let v = o.actions.length > 0 ? 10 : 0;
      const im = o.impact;
      if (id === 'finance') v -= o.cost / 1000 + o.monthly / 50;
      if (id === 'welfare' || id === 'planning') v -= im.displacedResidents / 5;
      if (id === 'health') v -= (im.clinicM < 300 ? 6 : 0) + (im.pollutes ? 8 : 0);
      if (id === 'education') v -= im.schoolM < 250 ? 6 : 0;
      if (id === 'environment') v += (im.green ? 4 : 0) - (im.pollutes ? 10 : 0) - im.treesCleared / 5;
      if (id === 'energy') v -= im.powerCut ? 10 : 0;
      return v;
    };
    const best = [...meta.options].sort((a, b) => score(b) - score(a))[0]!;
    const worst = [...opts].sort((a, b) => score(a) - score(b))[0];
    const concerned = !lead && worst && score(worst) < 4 && worst.id !== best.id;
    if (!lead && meta.round === 2 && !concerned) return { provider: 'demo', text: JSON.stringify({ speak: false, stance: 'neutral', option: best.id, statement: '', condition: '' }) };
    const stance: Stance = lead ? 'propose' : concerned ? 'concern' : 'support';
    const text = hi
      ? lead
        ? `मेयर साहब, ${m.short} विभाग की ओर से मेरा प्रस्ताव है विकल्प ${best.id}: ${best.title}। ${best.facts[0] ?? ''}`
        : concerned
          ? `मुझे विकल्प ${worst!.id} पर आपत्ति है, यह हमारे ${m.short} दायित्व पर असर डालता है। मैं विकल्प ${best.id} का समर्थन करता हूँ।`
          : `${m.short} की दृष्टि से विकल्प ${best.id} ठीक है।`
      : lead
        ? `Mayor, I propose option ${best.id}, ${best.title.toLowerCase()}. ${best.facts[0] ?? ''}`
        : concerned
          ? `I have a concern with option ${worst!.id}: it cuts against ${m.mandate.toLowerCase().replace(/\.$/, '')}. I would back option ${best.id} instead.`
          : `From the ${m.short.toLowerCase()} side, option ${best.id} is acceptable.`;
    return { provider: 'demo', text: JSON.stringify({ speak: true, stance, option: best.id, statement: text, condition: '' }) };
  }
}

/** Pulls the first JSON object out of a model reply, tolerating code fences and chatter. */
export function parseJsonReply(text: string): Record<string, unknown> | null {
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    const v = JSON.parse(text.slice(start, end + 1)) as unknown;
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}
