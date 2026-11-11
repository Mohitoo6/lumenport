import type { SaveMeta } from '../sim/save/serialize';
import type { GameState } from '../sim/state';

const DB = 'metropolis';
const STORE = 'saves';

interface SaveRecord {
  meta: SaveMeta;
  state: GameState;
}

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('Could not open storage'));
  });
}

function run<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return open().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const tx = db.transaction(STORE, mode);
        const req = fn(tx.objectStore(STORE));
        tx.oncomplete = () => {
          db.close();
          resolve(req.result);
        };
        tx.onerror = () => {
          db.close();
          reject(tx.error ?? new Error('Storage error'));
        };
      }),
  );
}

/** Saved cities live in IndexedDB, one record per slot. Typed arrays are stored as they are. */
export const saves = {
  put(meta: SaveMeta, state: GameState): Promise<unknown> {
    return run('readwrite', (s) => s.put({ meta, state } satisfies SaveRecord, meta.slot));
  },
  async get(slot: string): Promise<GameState | null> {
    const rec = await run<SaveRecord | undefined>('readonly', (s) => s.get(slot));
    return rec?.state ?? null;
  },
  async list(): Promise<SaveMeta[]> {
    const all = await run<SaveRecord[]>('readonly', (s) => s.getAll());
    return all.map((r) => r.meta).sort((a, b) => b.savedAt - a.savedAt);
  },
};
