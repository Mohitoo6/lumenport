import { hash32 } from './rng';

function gradDot(ix: number, iy: number, seed: number, dx: number, dy: number): number {
  const h = hash32(ix + Math.imul(hash32(iy + Math.imul(seed, 0x27d4eb2d)), 0x165667b1));
  const a = (h / 4294967296) * Math.PI * 2;
  return Math.cos(a) * dx + Math.sin(a) * dy;
}

/** 2D gradient noise in roughly [-1, 1]. */
export function noise2(x: number, y: number, seed: number): number {
  const ix = Math.floor(x);
  const iy = Math.floor(y);
  const fx = x - ix;
  const fy = y - iy;
  const u = fx * fx * fx * (fx * (fx * 6 - 15) + 10);
  const v = fy * fy * fy * (fy * (fy * 6 - 15) + 10);
  const n00 = gradDot(ix, iy, seed, fx, fy);
  const n10 = gradDot(ix + 1, iy, seed, fx - 1, fy);
  const n01 = gradDot(ix, iy + 1, seed, fx, fy - 1);
  const n11 = gradDot(ix + 1, iy + 1, seed, fx - 1, fy - 1);
  const a = n00 + (n10 - n00) * u;
  const b = n01 + (n11 - n01) * u;
  return (a + (b - a) * v) * 1.41421356;
}

/** Fractal Brownian motion, roughly [-1, 1]. */
export function fbm(x: number, y: number, seed: number, octaves: number, lacunarity = 2, gain = 0.5): number {
  let amp = 1;
  let freq = 1;
  let sum = 0;
  let norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += amp * noise2(x * freq, y * freq, seed + i * 101);
    norm += amp;
    amp *= gain;
    freq *= lacunarity;
  }
  return sum / norm;
}

/** Ridged multifractal in [0, 1]: sharp crests, good for hills. */
export function ridged(x: number, y: number, seed: number, octaves: number): number {
  let amp = 1;
  let freq = 1;
  let sum = 0;
  let norm = 0;
  let prev = 1;
  for (let i = 0; i < octaves; i++) {
    let n = 1 - Math.abs(noise2(x * freq, y * freq, seed + i * 131));
    n *= n;
    sum += n * amp * prev;
    norm += amp;
    prev = n;
    amp *= 0.5;
    freq *= 2.03;
  }
  return sum / norm;
}
