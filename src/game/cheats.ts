/**
 * Test codes for the developers: typed into the Ask box, they add money to the treasury
 * so every feature can be tried without grinding. Only SHA-256 hashes of the codes are in
 * the code, so reading the game's JavaScript does not reveal them. A code is recognised
 * here, before anything is sent to a model, so it never costs a token or reaches a log.
 */
const SALT = 'lumenport-cheat:';

export interface CheatCode {
  /** SHA-256 of the salt and the code, in lowercase hex. */
  hash: string;
  amount: number;
}

export const CHEAT_CODES: readonly CheatCode[] = [
  { hash: '899b5964249f1c2470eba75c8b946b404861ee0a4407b1d21a36a7e1939d070b', amount: 50_000 },
  { hash: 'f97c7c27a3fec10bf9a92ef93301a4e94091bb3761fcc788abfe295fb43b8fa1', amount: 100_000 },
  { hash: 'ee8dbb1a624bddfa5bafb86c57e39c975e5fde43e2b205fc0ecd6407c9f38ff2', amount: 150_000 },
];

/** The hash a typed text is compared by, or null when it cannot be a code. */
export async function codeHash(text: string): Promise<string | null> {
  const t = text.trim().toLowerCase();
  if (t.length < 6 || t.length > 40 || /\s/.test(t) || !globalThis.crypto?.subtle) return null;
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(SALT + t));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

/** The money a test code grants, or 0 when the text is not one. */
export async function cheatAmount(text: string, codes: readonly CheatCode[] = CHEAT_CODES): Promise<number> {
  const hash = await codeHash(text);
  return hash ? (codes.find((c) => c.hash === hash)?.amount ?? 0) : 0;
}
