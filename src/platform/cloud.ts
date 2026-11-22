import type { SupabaseClient } from '@supabase/supabase-js';
import { decodeState, encodeState } from './portable';
import type { SaveMeta } from '../sim/save/serialize';
import type { GameState } from '../sim/state';

/**
 * Accounts and cloud saves, on Supabase (hosted Postgres with built-in auth).
 *
 * Signing in is passwordless: an emailed magic link, or Google when the project has it
 * turned on. Each saved city is one row in `city_saves`, readable and writable only by its
 * owner (row-level security in `supabase/schema.sql`). The browser only ever holds the
 * project's public "anon" key; the database enforces who can see what.
 *
 * Without VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY the feature is off and the game
 * saves in this browser only, as before. The Supabase library is loaded on demand, so
 * players on a build without accounts never download it.
 */
const URL_ = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const ANON = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
export const GOOGLE_SIGN_IN = import.meta.env.VITE_SUPABASE_GOOGLE === '1';

/** Cloud slots: two the player saves to by hand, and one the game keeps up to date. */
export const CLOUD_SLOTS: ReadonlyArray<readonly [slot: string, name: string]> = [
  ['cloud-auto', 'Cloud autosave'],
  ['cloud-1', 'Cloud slot 1'],
  ['cloud-2', 'Cloud slot 2'],
];

export function cloudEnabled(): boolean {
  return Boolean(URL_ && ANON);
}

let client: Promise<SupabaseClient> | null = null;

function db(): Promise<SupabaseClient> {
  if (!cloudEnabled()) return Promise.reject(new Error('Cloud saves are not set up'));
  client ??= import('@supabase/supabase-js').then(({ createClient }) =>
    createClient(URL_!, ANON!, { auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, storageKey: 'metropolis.auth' } }),
  );
  return client;
}

export interface Account {
  email: string;
  id: string;
}

/** Calls `cb` with the signed-in account (or null) now and whenever it changes. */
export async function watchAccount(cb: (a: Account | null, event: string) => void): Promise<void> {
  const sb = await db();
  sb.auth.onAuthStateChange((event, session) => {
    const u = session?.user;
    cb(u ? { email: u.email ?? 'your account', id: u.id } : null, event);
  });
}

export async function signInWithEmail(email: string): Promise<string | null> {
  const sb = await db();
  const { error } = await sb.auth.signInWithOtp({ email, options: { emailRedirectTo: location.origin + location.pathname } });
  return error ? error.message : null;
}

export async function signInWithGoogle(): Promise<string | null> {
  const sb = await db();
  const { error } = await sb.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: location.origin + location.pathname } });
  return error ? error.message : null;
}

export async function signOut(): Promise<void> {
  const sb = await db();
  await sb.auth.signOut();
}

interface Row {
  slot: string;
  city_name: string;
  population: number;
  funds: number;
  tick: number;
  updated_at: string;
}

export const cloudSaves = {
  async list(): Promise<SaveMeta[]> {
    const sb = await db();
    const { data, error } = await sb.from('city_saves').select('slot, city_name, population, funds, tick, updated_at').order('updated_at', { ascending: false });
    if (error) throw new Error(error.message);
    return (data as Row[]).map((r) => ({ slot: r.slot, cityName: r.city_name, population: r.population, funds: r.funds, tick: r.tick, savedAt: Date.parse(r.updated_at) }));
  },
  async put(slot: string, state: GameState, userId: string): Promise<void> {
    const sb = await db();
    const data = await encodeState(state);
    const { error } = await sb.from('city_saves').upsert(
      { user_id: userId, slot, city_name: state.cityName, population: state.stats.population, funds: Math.floor(state.funds), tick: state.tick, data, updated_at: new Date().toISOString() },
      { onConflict: 'user_id,slot' },
    );
    if (error) throw new Error(error.message);
  },
  async get(slot: string): Promise<unknown> {
    const sb = await db();
    const { data, error } = await sb.from('city_saves').select('data').eq('slot', slot).maybeSingle();
    if (error) throw new Error(error.message);
    return data ? decodeState((data as { data: string }).data) : null;
  },
};
