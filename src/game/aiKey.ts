/**
 * The player's own AI key ("bring your own key").
 *
 * The hosted game runs on the site's free-tier keys, shared by every visitor and capped
 * per visitor and per day. A player who wants the live council without those caps can add
 * a key of their own for any OpenAI-compatible provider. It is kept in this browser only
 * (localStorage), sent with each AI request to the game's server, used for that one call
 * and never stored or logged there. The server only forwards to the known provider hosts
 * below, so the field cannot be used to make it call anywhere else.
 */
export interface OwnKey {
  provider: ProviderId;
  baseUrl: string;
  model: string;
  apiKey: string;
}

export type ProviderId = 'groq' | 'gemini' | 'openrouter' | 'openai' | 'deepseek' | 'mistral' | 'together';

export const PROVIDERS: Record<ProviderId, { label: string; baseUrl: string; model: string; keysAt: string }> = {
  groq: { label: 'Groq (free tier available)', baseUrl: 'https://api.groq.com/openai/v1', model: 'openai/gpt-oss-120b', keysAt: 'console.groq.com/keys' },
  gemini: { label: 'Google Gemini (free tier available)', baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', model: 'gemini-3.6-flash', keysAt: 'aistudio.google.com/apikey' },
  openrouter: { label: 'OpenRouter', baseUrl: 'https://openrouter.ai/api/v1', model: 'openai/gpt-4o-mini', keysAt: 'openrouter.ai/keys' },
  openai: { label: 'OpenAI', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini', keysAt: 'platform.openai.com/api-keys' },
  deepseek: { label: 'DeepSeek', baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat', keysAt: 'platform.deepseek.com/api_keys' },
  mistral: { label: 'Mistral', baseUrl: 'https://api.mistral.ai/v1', model: 'mistral-small-latest', keysAt: 'console.mistral.ai/api-keys' },
  together: { label: 'Together AI', baseUrl: 'https://api.together.xyz/v1', model: 'meta-llama/Llama-3.3-70B-Instruct-Turbo', keysAt: 'api.together.xyz/settings/api-keys' },
};

/** Hosts the server will forward a player's key to. Anything else is refused. */
export const ALLOWED_HOSTS = ['api.groq.com', 'generativelanguage.googleapis.com', 'openrouter.ai', 'api.openai.com', 'api.deepseek.com', 'api.mistral.ai', 'api.together.xyz'];

const KEY = 'metropolis.ai.ownKey.v1';

export function loadOwnKey(): OwnKey | null {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Partial<OwnKey> | null;
    if (!v || typeof v.apiKey !== 'string' || !v.apiKey || typeof v.model !== 'string' || !v.provider || !(v.provider in PROVIDERS)) return null;
    return { provider: v.provider, baseUrl: PROVIDERS[v.provider].baseUrl, model: v.model, apiKey: v.apiKey };
  } catch {
    return null;
  }
}

export function saveOwnKey(k: OwnKey | null): void {
  try {
    if (k) localStorage.setItem(KEY, JSON.stringify(k));
    else localStorage.removeItem(KEY);
  } catch {
    /* private window: the key lasts until the page closes */
  }
}

/** The extra field an AI request carries when the player has a key of their own. */
export function ownKeyField(): { own?: OwnKey } {
  const k = loadOwnKey();
  return k ? { own: k } : {};
}

/** A key shown safely: provider, model and the last four characters. */
export function describeKey(k: OwnKey): string {
  return `${PROVIDERS[k.provider].label.split(' (')[0]} · ${k.model} · …${k.apiKey.slice(-4)}`;
}
