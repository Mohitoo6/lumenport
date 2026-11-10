import type { Rng } from '../../core/rng';
import { Geo, Layer, NO_WIN, Style, mat, win, type Mat, type RGB, type Win } from './geo';

/** Everything an archetype needs to draw one building on its lot. */
export interface Lot {
  g: Geo;
  r: Rng;
  /** Lot width along the road and depth away from it, metres. */
  W: number;
  D: number;
  level: number;
  density: number;
}

// Finishes shared by every archetype. Tints multiply dark scans, so values above 1 are normal.
export const CONCRETE = mat(Layer.Concrete, [1.55, 1.55, 1.52], 3);
export const CONCRETE_DARK = mat(Layer.Concrete, [0.95, 0.96, 0.98], 3);
export const PAVING = mat(Layer.Pavement, [1.12, 1.2, 1.32], 3.2);
export const ASPHALT = mat(Layer.Asphalt, [0.6, 0.61, 0.64], 5);
export const LAWN = mat(Layer.Grass, [0.74, 0.98, 0.58], 5);
export const DIRT = mat(Layer.Dirt, [1.0, 0.95, 0.9], 4);
export const GRAVEL_ROOF = mat(Layer.Concrete, [0.82, 0.82, 0.84], 2.2);
export const TAR_ROOF = mat(Layer.Asphalt, [0.5, 0.5, 0.52], 4);
export const METAL_GREY = mat(Layer.Metal, [1.35, 1.38, 1.42], 2.5);
export const STEEL_DARK = mat(Layer.Concrete, [0.42, 0.44, 0.47], 3);
export const WHITE_TRIM = mat(Layer.Plaster2, [1.25, 1.24, 1.2], 3);
export const HEDGE = mat(Layer.Grass, [0.42, 0.62, 0.3], 2.5);
export const WOOD = mat(Layer.Plaster, [0.62, 0.44, 0.28], 2);
export const LINE_WHITE = mat(Layer.Concrete, [2.1, 2.1, 2.05], 3);

export const SIGN: Win = win(Style.Sign, 1, 1, 0);

const FLAT_ROOFS: readonly Mat[] = [
  GRAVEL_ROOF,
  TAR_ROOF,
  mat(Layer.Concrete, [1.25, 1.24, 1.2], 2.2), // pale gravel
  mat(Layer.Concrete, [1.7, 1.7, 1.68], 3), // white membrane
  mat(Layer.Asphalt, [0.78, 0.6, 0.5], 4), // red-brown felt
  mat(Layer.Concrete, [0.7, 0.86, 0.74], 3), // green coating
  mat(Layer.Asphalt, [0.75, 0.76, 0.8], 4), // grey felt
];

export function pick<T>(r: Rng, items: readonly T[]): T {
  return items[r.int(items.length)]!;
}

/** Slightly varies a tint so two buildings with the same paint do not match exactly. */
export function vary(r: Rng, c: RGB, amount = 0.08): RGB {
  const k = 1 + (r.next() - 0.5) * 2 * amount;
  return [c[0] * k, c[1] * k, c[2] * k];
}

/** A flat-roof finish; varied so a district of flat roofs is not one grey sheet from above. */
export function roofFinish(r: Rng): Mat {
  return FLAT_ROOFS[r.int(FLAT_ROOFS.length)]!;
}

/** Covers the whole lot with one ground finish. */
export function ground(l: Lot, m: Mat, y = 0.02): void {
  l.g.flat(-l.W / 2, -l.D / 2, l.W / 2, l.D / 2, y, m);
}

/** A panel on a front-facing (+z) wall, standing a few centimetres proud of it. */
export function frontPanel(g: Geo, cx: number, z: number, w: number, y0: number, y1: number, m: Mat, wn: Win = NO_WIN): void {
  g.wall(cx + w / 2, z + 0.05, cx - w / 2, z + 0.05, y0, y1, m, wn);
}

/** Flat roof: slab, a parapet with inner faces and a capping. */
export function flatRoof(g: Geo, x0: number, z0: number, x1: number, z1: number, y: number, wall: Mat, roof: Mat = GRAVEL_ROOF, parapet = 0.55): void {
  const t = 0.28;
  g.walls(x0, z0, x1, z1, y, y + parapet, wall);
  // Inner faces look inward, so the rectangle is walked the other way round.
  g.wall(x1 - t, z0 + t, x0 + t, z0 + t, y, y + parapet, wall);
  g.wall(x1 - t, z1 - t, x1 - t, z0 + t, y, y + parapet, wall);
  g.wall(x0 + t, z1 - t, x1 - t, z1 - t, y, y + parapet, wall);
  g.wall(x0 + t, z0 + t, x0 + t, z1 - t, y, y + parapet, wall);
  const cap = CONCRETE;
  const yc = y + parapet;
  g.flat(x0, z0, x1, z0 + t, yc, cap);
  g.flat(x0, z1 - t, x1, z1, yc, cap);
  g.flat(x0, z0 + t, x0 + t, z1 - t, yc, cap);
  g.flat(x1 - t, z0 + t, x1, z1 - t, yc, cap);
  g.flat(x0 + t, z0 + t, x1 - t, z1 - t, y + 0.03, roof);
}

export function acUnit(g: Geo, x: number, z: number, y: number, s = 1): void {
  g.box(x - 0.8 * s, z - 0.55 * s, x + 0.8 * s, z + 0.55 * s, y, y + 0.85 * s, METAL_GREY);
  g.cyl(x, z, 0.36 * s, 0.36 * s, y + 0.85 * s, y + 0.93 * s, 8, STEEL_DARK);
}

/** Roof-level plant: air handlers, a stair bulkhead, vents, sometimes a water tank. */
export function rooftop(l: Lot, x0: number, z0: number, x1: number, z1: number, y: number, wall: Mat, tank = false): void {
  const { g, r } = l;
  const w = x1 - x0 - 2;
  const d = z1 - z0 - 2;
  if (w < 2 || d < 2) return;
  const spot = (): [number, number] => [x0 + 1 + r.next() * w, z0 + 1 + r.next() * d];
  if (w > 5 && d > 4) {
    const [bx, bz] = spot();
    const hx = Math.min(1.6, w / 3);
    g.box(Math.max(x0 + 0.6, bx - hx), Math.max(z0 + 0.6, bz - 1.3), Math.min(x1 - 0.6, bx + hx), Math.min(z1 - 0.6, bz + 1.3), y, y + 2.5, wall, NO_WIN, TAR_ROOF);
  }
  const n = Math.min(6, 1 + Math.floor((w * d) / 45) + r.int(2));
  for (let i = 0; i < n; i++) {
    const [ax, az] = spot();
    acUnit(g, ax, az, y, 0.8 + r.next() * 0.5);
  }
  for (let i = 0; i < 2; i++) {
    const [vx, vz] = spot();
    g.cyl(vx, vz, 0.18, 0.18, y, y + 0.7 + r.next() * 0.5, 6, METAL_GREY);
  }
  if (tank && w > 4 && d > 4) {
    const [tx, tz] = spot();
    const legs = STEEL_DARK;
    for (const [ox, oz] of [[-0.8, -0.8], [0.8, -0.8], [0.8, 0.8], [-0.8, 0.8]] as const) g.box(tx + ox - 0.07, tz + oz - 0.07, tx + ox + 0.07, tz + oz + 0.07, y, y + 1.6, legs);
    g.cyl(tx, tz, 1.25, 1.25, y + 1.6, y + 3.7, 10, WOOD, null);
    g.cyl(tx, tz, 1.35, 0, y + 3.7, y + 4.5, 10, mat(Layer.Metal, [0.8, 0.8, 0.82], 2));
  }
}

/** A canvas awning sloping out from a front wall, with a hanging valance. */
export function awning(g: Geo, x0: number, x1: number, z: number, y: number, depth: number, tint: RGB): void {
  const m = mat(Layer.Plaster2, tint, 2);
  g.poly([[x0, y, z], [x1, y, z], [x1, y - 0.55, z + depth], [x0, y - 0.55, z + depth]], m);
  g.wall(x1, z + depth, x0, z + depth, y - 0.85, y - 0.55, m);
  g.poly([[x0, y, z], [x0, y - 0.55, z + depth], [x0, y - 0.85, z + depth]], m, NO_WIN, false);
  g.poly([[x1, y, z], [x1, y - 0.85, z + depth], [x1, y - 0.55, z + depth]], m, NO_WIN, false);
}

export function hedge(g: Geo, x0: number, z0: number, x1: number, z1: number, h = 1.0): void {
  g.box(Math.min(x0, x1), Math.min(z0, z1), Math.max(x0, x1), Math.max(z0, z1), 0, h, HEDGE);
}

/** A thin fence visible from both sides. */
export function fence(g: Geo, x0: number, z0: number, x1: number, z1: number, h: number, m: Mat = WOOD): void {
  g.wall(x0, z0, x1, z1, 0, h, m);
  g.wall(x1, z1, x0, z0, 0, h, m);
}

/** A rounded bush: a short drum with a cone on top. */
export function shrub(g: Geo, x: number, z: number, radius: number, tint: RGB = [0.5, 0.72, 0.34]): void {
  const m = mat(Layer.Grass, tint, 2);
  g.cyl(x, z, radius, radius * 0.92, 0, radius * 0.7, 7, m, null);
  g.cyl(x, z, radius * 0.92, 0.05, radius * 0.7, radius * 1.35, 7, m, null);
}

/** Car park: asphalt with painted stalls along its long edges. */
export function parking(g: Geo, x0: number, z0: number, x1: number, z1: number, y = 0.04): void {
  g.flat(x0, z0, x1, z1, y, ASPHALT);
  const alongX = x1 - x0 >= z1 - z0;
  const len = alongX ? x1 - x0 : z1 - z0;
  const n = Math.floor(len / 2.6);
  const depth = Math.min(5, (alongX ? z1 - z0 : x1 - x0) * 0.42);
  for (let i = 0; i <= n; i++) {
    const p = (alongX ? x0 : z0) + (len - n * 2.6) / 2 + i * 2.6;
    if (alongX) {
      g.flat(p - 0.06, z0 + 0.3, p + 0.06, z0 + depth, y + 0.012, LINE_WHITE);
      g.flat(p - 0.06, z1 - depth, p + 0.06, z1 - 0.3, y + 0.012, LINE_WHITE);
    } else {
      g.flat(x0 + 0.3, p - 0.06, x0 + depth, p + 0.06, y + 0.012, LINE_WHITE);
      g.flat(x1 - depth, p - 0.06, x1 - 0.3, p + 0.06, y + 0.012, LINE_WHITE);
    }
  }
}

/** A simple entrance door with a frame, on a front wall. */
export function door(g: Geo, cx: number, z: number, y: number, tint: RGB, w = 1.0, h = 2.1): void {
  frontPanel(g, cx, z, w + 0.24, y, y + h + 0.12, WHITE_TRIM);
  g.wall(cx + w / 2, z + 0.09, cx - w / 2, z + 0.09, y, y + h, mat(Layer.Plaster2, tint, 2));
}

export { Geo, Layer, NO_WIN, Style, mat, win };
export type { Mat, RGB, Win };
