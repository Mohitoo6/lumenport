import { CELL, MAP, VERTS, WORLD } from '../../core/constants';
import { clamp, lerp, smoothstep } from '../../core/math';
import { fbm, ridged } from '../../core/noise';

const HALF = WORLD / 2;

/**
 * Analytic terrain height in metres at any world position, including outside the playable
 * map (the renderer uses that for the distant backdrop). Water level is y = 0.
 *
 * Shape: gentle buildable plains in the middle, hills rising toward the corners and
 * beyond, a meandering river crossing west to east and a lake to the north-west.
 */
export function terrainHeight(x: number, z: number, seed: number): number {
  const cx = x - HALF;
  const cz = z - HALF;
  const r = Math.hypot(cx, cz);

  // Plains: broad swells plus low rolling variation.
  let h = 8 + fbm(x / 900, z / 900, seed, 4) * 6;
  h += fbm(x / 260, z / 260, seed + 11, 3) * 1.5;

  // Hills grow with distance from the centre; the ring is warped so it is not circular.
  const warped = r + fbm(x / 700, z / 700, seed + 5, 2) * 280;
  const edge = smoothstep(760, 1700, warped);
  const hills = ridged(x / 1100, z / 1100, seed + 23, 5);
  h += edge * (16 + hills * 190);

  // Fine detail: almost none on the plains, rougher in the hills.
  h += fbm(x / 60, z / 60, seed + 3, 2) * (0.25 + edge * 2.6);

  // River: sinuous channel roughly along +x, south of the centre.
  const p1 = (seed % 97) * 0.13;
  const p2 = (seed % 89) * 0.29;
  const zr = HALF + 300 + 200 * Math.sin(x / 520 + p1) + 85 * Math.sin(x / 233 + p2);
  const slope = (200 / 520) * Math.cos(x / 520 + p1) + (85 / 233) * Math.cos(x / 233 + p2);
  const dr = Math.abs(z - zr) / Math.sqrt(1 + slope * slope);
  const w = 36 + 9 * Math.sin(x / 310 + p2);
  h = carve(h, dr, w * 0.5, w * 1.25, 420, -4.5);

  // Lake: irregular basin north-west of the centre.
  const lx = HALF - 400;
  const lz = HALF - 330;
  const dl = Math.hypot(x - lx, z - lz) + fbm(x / 170, z / 170, seed + 41, 3) * 60;
  h = carve(h, dl, 110, 185, 300, -6);

  return h;
}

/** Blends `h` into a basin: `bed` inside `inner`, a low bank at `outer`, back to `h` over `blend`. */
function carve(h: number, d: number, inner: number, outer: number, blend: number, bed: number): number {
  if (d >= outer + blend) return h;
  const bank = Math.min(h, 1.7);
  const basin = lerp(bed, bank, smoothstep(inner, outer, d));
  return basin + smoothstep(outer, outer + blend, d) * (h - bank);
}

/** Samples the analytic terrain on the playable grid: VERTS x VERTS vertex heights. */
export function generateHeights(seed: number): Float32Array {
  const out = new Float32Array(VERTS * VERTS);
  for (let j = 0; j < VERTS; j++) {
    for (let i = 0; i < VERTS; i++) {
      out[j * VERTS + i] = terrainHeight(i * CELL, j * CELL, seed);
    }
  }
  return out;
}

/** Bilinear height lookup on the playable grid, clamped at the map border. */
export function heightAt(heights: Float32Array, x: number, z: number): number {
  const gx = clamp(x / CELL, 0, MAP);
  const gz = clamp(z / CELL, 0, MAP);
  const i = Math.min(Math.floor(gx), MAP - 1);
  const j = Math.min(Math.floor(gz), MAP - 1);
  const fx = gx - i;
  const fz = gz - j;
  const k = j * VERTS + i;
  const a = heights[k]!;
  const b = heights[k + 1]!;
  const c = heights[k + VERTS]!;
  const d = heights[k + VERTS + 1]!;
  return lerp(lerp(a, b, fx), lerp(c, d, fx), fz);
}

/** Largest height difference between the four corners of a cell: a cheap slope measure. */
export function cellRelief(heights: Float32Array, i: number, j: number): number {
  const k = j * VERTS + i;
  const a = heights[k]!;
  const b = heights[k + 1]!;
  const c = heights[k + VERTS]!;
  const d = heights[k + VERTS + 1]!;
  return Math.max(a, b, c, d) - Math.min(a, b, c, d);
}

export function cellMinHeight(heights: Float32Array, i: number, j: number): number {
  const k = j * VERTS + i;
  return Math.min(heights[k]!, heights[k + 1]!, heights[k + VERTS]!, heights[k + VERTS + 1]!);
}
