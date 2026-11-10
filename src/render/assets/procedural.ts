import {
  DataTexture,
  LinearFilter,
  LinearMipmapLinearFilter,
  RGBAFormat,
  RepeatWrapping,
  UnsignedByteType,
} from 'three';
import { hash32 } from '../../core/rng';

/** Gradient noise that tiles with the given integer period. Returns roughly [-1, 1]. */
function periodicNoise(x: number, y: number, period: number, seed: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const u = fx * fx * (3 - 2 * fx);
  const v = fy * fy * (3 - 2 * fy);
  const g = (gx: number, gy: number, dx: number, dy: number): number => {
    const px = ((gx % period) + period) % period;
    const py = ((gy % period) + period) % period;
    const h = hash32(px + Math.imul(hash32(py + Math.imul(seed, 0x27d4eb2d)), 0x165667b1));
    const a = (h / 4294967296) * Math.PI * 2;
    return Math.cos(a) * dx + Math.sin(a) * dy;
  };
  const a = g(ix, iy, fx, fy);
  const b = g(ix + 1, iy, fx - 1, fy);
  const c = g(ix, iy + 1, fx, fy - 1);
  const d = g(ix + 1, iy + 1, fx - 1, fy - 1);
  return (a + (b - a) * u + (c + (d - c) * u - (a + (b - a) * u)) * v) * 1.41421356;
}

function periodicFbm(u: number, v: number, basePeriod: number, octaves: number, seed: number): number {
  let amp = 1;
  let period = basePeriod;
  let sum = 0;
  let norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += amp * periodicNoise(u * period, v * period, period, seed + i * 17);
    norm += amp;
    amp *= 0.5;
    period *= 2;
  }
  return sum / norm;
}

/**
 * Tileable RGBA noise: four independent fbm channels, remapped to fill 0..255. Shaders use
 * it for terrain splat masks, macro colour variation and foam breakup.
 */
export function makeNoiseTexture(size = 256, seed = 9001): DataTexture {
  const data = new Uint8Array(size * size * 4);
  const periods = [4, 6, 3, 8];
  for (let c = 0; c < 4; c++) {
    const tmp = new Float32Array(size * size);
    let lo = Infinity;
    let hi = -Infinity;
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const n = periodicFbm(x / size, y / size, periods[c]!, 5, seed + c * 1000);
        tmp[y * size + x] = n;
        if (n < lo) lo = n;
        if (n > hi) hi = n;
      }
    }
    const scale = 255 / (hi - lo);
    for (let i = 0; i < tmp.length; i++) data[i * 4 + c] = Math.round((tmp[i]! - lo) * scale);
  }
  const tex = new DataTexture(data, size, size, RGBAFormat, UnsignedByteType);
  tex.wrapS = tex.wrapT = RepeatWrapping;
  tex.magFilter = LinearFilter;
  tex.minFilter = LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.needsUpdate = true;
  return tex;
}

/**
 * Tileable water normal map built from a sum of sine waves with integer wave numbers
 * (so it wraps exactly) and an analytic gradient.
 */
export function makeWaterNormalTexture(size = 256, seed = 4242): DataTexture {
  const waves: Array<{ kx: number; ky: number; amp: number; phase: number }> = [];
  let s = seed;
  const rand = (): number => {
    s = hash32(s);
    return s / 4294967296;
  };
  for (let i = 0; i < 28; i++) {
    const mag = 2 + Math.floor(rand() * 13);
    const ang = rand() * Math.PI * 2;
    const kx = Math.round(Math.cos(ang) * mag);
    const ky = Math.round(Math.sin(ang) * mag);
    if (kx === 0 && ky === 0) continue;
    waves.push({ kx, ky, amp: 0.55 / Math.hypot(kx, ky) ** 1.15, phase: rand() * Math.PI * 2 });
  }
  const data = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const u = (x / size) * Math.PI * 2;
      const v = (y / size) * Math.PI * 2;
      let dx = 0;
      let dy = 0;
      for (const w of waves) {
        const c = Math.cos(w.kx * u + w.ky * v + w.phase) * w.amp;
        dx += c * w.kx;
        dy += c * w.ky;
      }
      const inv = 1 / Math.hypot(dx, dy, 1);
      const i = (y * size + x) * 4;
      data[i] = Math.round((-dx * inv * 0.5 + 0.5) * 255);
      data[i + 1] = Math.round((-dy * inv * 0.5 + 0.5) * 255);
      data[i + 2] = Math.round((inv * 0.5 + 0.5) * 255);
      data[i + 3] = 255;
    }
  }
  const tex = new DataTexture(data, size, size, RGBAFormat, UnsignedByteType);
  tex.wrapS = tex.wrapT = RepeatWrapping;
  tex.magFilter = LinearFilter;
  tex.minFilter = LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.anisotropy = 4;
  tex.needsUpdate = true;
  return tex;
}

/**
 * Stand-in PBR pixels for a texture that failed to download: mottled colour, a gentle
 * bumpy normal and a rough, non-metal ARM. Not as rich as the real thing, never flat.
 */
export function proceduralPixels(kind: 'diff' | 'nor' | 'arm', base: [number, number, number], size: number, seed: number): Uint8ClampedArray {
  const data = new Uint8ClampedArray(size * size * 4);
  const hgt = new Float32Array(size * size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      hgt[y * size + x] = periodicFbm(x / size, y / size, 8, 5, seed);
    }
  }
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      const n = hgt[y * size + x]!;
      if (kind === 'diff') {
        const m = 0.78 + n * 0.45;
        data[i] = base[0] * m;
        data[i + 1] = base[1] * m;
        data[i + 2] = base[2] * m;
      } else if (kind === 'nor') {
        const xr = hgt[y * size + ((x + 1) % size)]!;
        const yd = hgt[((y + 1) % size) * size + x]!;
        const dx = (n - xr) * 6;
        const dy = (n - yd) * 6;
        const inv = 1 / Math.hypot(dx, dy, 1);
        data[i] = (dx * inv * 0.5 + 0.5) * 255;
        data[i + 1] = (dy * inv * 0.5 + 0.5) * 255;
        data[i + 2] = (inv * 0.5 + 0.5) * 255;
      } else {
        data[i] = 215 + n * 40; // AO
        data[i + 1] = 205 + n * 40; // roughness
        data[i + 2] = 0; // metalness
      }
      data[i + 3] = 255;
    }
  }
  return data;
}
