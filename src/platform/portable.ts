import type { GameState } from '../sim/state';

/**
 * A saved city as one compact, self-contained blob, for storage outside this browser
 * (the cloud saves). Typed arrays become base64 inside JSON, and the whole is gzipped with
 * the platform's CompressionStream, so no library is needed. `decodeState` reverses it;
 * the result still goes through `validateState` before it is loaded.
 */
const TYPED = { f32: Float32Array, u8: Uint8Array, i32: Int32Array } as const;
type Tag = keyof typeof TYPED;

function tagOf(v: unknown): Tag | null {
  if (v instanceof Float32Array) return 'f32';
  if (v instanceof Uint8Array) return 'u8';
  if (v instanceof Int32Array) return 'i32';
  return null;
}

function toBase64(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

function fromBase64(b64: string): Uint8Array {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

async function pipe(bytes: Uint8Array, stream: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const out = new Response(new Blob([bytes as BlobPart]).stream().pipeThrough(stream));
  return new Uint8Array(await out.arrayBuffer());
}

/** The city as gzipped JSON, base64-encoded so it can sit in a text column. */
export async function encodeState(state: GameState): Promise<string> {
  const json = JSON.stringify(state, (_k, v: unknown) => {
    const tag = tagOf(v);
    if (!tag) return v;
    const a = v as Float32Array | Uint8Array | Int32Array;
    return { __typed: tag, b64: toBase64(new Uint8Array(a.buffer, a.byteOffset, a.byteLength)) };
  });
  return toBase64(await pipe(new TextEncoder().encode(json), new CompressionStream('gzip')));
}

export async function decodeState(blob: string): Promise<unknown> {
  const json = new TextDecoder().decode(await pipe(fromBase64(blob), new DecompressionStream('gzip')));
  return JSON.parse(json, (_k, v: unknown) => {
    if (v && typeof v === 'object' && '__typed' in v && 'b64' in v) {
      const { __typed, b64 } = v as { __typed: Tag; b64: string };
      const bytes = fromBase64(b64);
      const Ctor = TYPED[__typed];
      return new Ctor(bytes.buffer as ArrayBuffer, bytes.byteOffset, bytes.byteLength / Ctor.BYTES_PER_ELEMENT);
    }
    return v;
  });
}
