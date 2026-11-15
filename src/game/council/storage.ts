/**
 * A tiny key-value port, so the council's memory, cache and telemetry can persist in the
 * browser and still run in Node tests. Storage is a convenience: every read and write is
 * allowed to fail (private windows, blocked site data) without breaking the game.
 */
export interface KV {
  get(key: string): string | null;
  set(key: string, value: string): void;
}

export function memoryKV(): KV {
  const m = new Map<string, string>();
  return { get: (k) => m.get(k) ?? null, set: (k, v) => void m.set(k, v) };
}

export function browserKV(): KV {
  return {
    get(key) {
      try {
        return globalThis.localStorage?.getItem(key) ?? null;
      } catch {
        return null;
      }
    },
    set(key, value) {
      try {
        globalThis.localStorage?.setItem(key, value);
      } catch {
        // Not persisted this time; the in-memory copy still works.
      }
    },
  };
}

export function readJson<T>(kv: KV, key: string, fallback: T): T {
  const raw = kv.get(key);
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

/** FNV-1a, as hex: a short stable key for a prompt. */
export function hashText(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}
