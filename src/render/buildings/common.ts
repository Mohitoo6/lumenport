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
  /**
   * Set when the building is turned to face a diagonal road: the grid lot's facing and
   * full size, so ground finishes still cover the whole lot.
   */
  grid?: { zx: number; zz: number; W: number; D: number };
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

// Additional finishes shared across modern Indian architectural elements.
export const IRON_DARK = mat(Layer.Metal, [0.3, 0.32, 0.36], 1.6);
export const TERRACOTTA = mat(Layer.Roof2, [1.18, 0.72, 0.52], 2.2);
export const SANDSTONE = mat(Layer.Plaster, [1.28, 1.08, 0.84], 2.8);
export const GLASS_RAIL = mat(Layer.ConcreteWall, [0.34, 0.5, 0.6], 2.5);
export const TANK_BLACK = mat(Layer.Metal, [0.22, 0.24, 0.28], 1.6);
export const TANK_WHITE = mat(Layer.Plaster2, [1.32, 1.32, 1.28], 2);
export const TANK_BLUE = mat(Layer.Plaster2, [0.24, 0.56, 0.96], 2);

export const SIGN: Win = win(Style.Sign, 1, 1, 0);

const FLAT_ROOFS: readonly Mat[] = [
  GRAVEL_ROOF,
  TAR_ROOF,
  mat(Layer.Concrete, [1.25, 1.24, 1.2], 2.2), // pale gravel / cool-roof lime wash
  mat(Layer.Concrete, [1.7, 1.7, 1.68], 3), // white heat-reflective terrace
  mat(Layer.Asphalt, [0.78, 0.6, 0.5], 4), // red-brown waterproofing / brick coba
  mat(Layer.Concrete, [1.35, 1.15, 0.98], 2.6), // terracotta terrace tiles
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
  const grid = l.grid;
  if (grid) l.g.withFacing(grid.zx, grid.zz, () => l.g.flat(-grid.W / 2, -grid.D / 2, grid.W / 2, grid.D / 2, y, m));
  else l.g.flat(-l.W / 2, -l.D / 2, l.W / 2, l.D / 2, y, m);
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

/** An overhead cylindrical HDPE water tank (Sintex-style) on a low masonry stand. */
export function waterTank(g: Geo, x: number, z: number, y: number, r: Rng, scale = 1, raised = true): void {
  const body = pick(r, [TANK_BLACK, TANK_BLACK, TANK_WHITE, TANK_BLUE] as const);
  const standH = raised ? 0.45 * scale : 0;
  const rad = 0.58 * scale;
  const h = 1.15 * scale;
  if (standH > 0) {
    g.box(x - rad * 0.9, z - rad * 0.9, x + rad * 0.9, z + rad * 0.9, y, y + standH, CONCRETE);
  }
  const by = y + standH;
  g.cyl(x, z, rad, rad, by, by + h, 8, body);
  // Manhole lid on top.
  g.cyl(x, z, rad * 0.38, rad * 0.38, by + h, by + h + 0.14 * scale, 6, body);
}

/**
 * Staircase head-room (mumty) on an Indian flat roof: masonry shaft, overhanging drip-ledge
 * roof slab, and a terrace door.
 */
export function stairTower(
  g: Geo,
  x0: number,
  z0: number,
  x1: number,
  z1: number,
  y: number,
  h: number,
  wall: Mat,
  trim: Mat = WHITE_TRIM,
): void {
  g.walls(x0, z0, x1, z1, y, y + h, wall);
  // Overhanging RCC roof slab.
  g.box(x0 - 0.22, z0 - 0.22, x1 + 0.22, z1 + 0.22, y + h, y + h + 0.18, trim, NO_WIN, CONCRETE);
  // Small terrace access door on the front face.
  const cx = (x0 + x1) * 0.5;
  const dw = Math.min(0.95, (x1 - x0) * 0.45);
  if (dw > 0.45 && h > 2.1) {
    frontPanel(g, cx, z1, dw, y + 0.05, y + 1.95, WOOD);
  }
}

/**
 * A projecting horizontal window sunshade (chhajja) along one face of a wall.
 * Align `y` to `floorY + 0.80 * floorH` so it sits right over procedural Punched windows.
 */
export function chhajja(
  g: Geo,
  a0: number,
  a1: number,
  fixedCoord: number,
  y: number,
  depth = 0.48,
  m: Mat = WHITE_TRIM,
  side: 'front' | 'back' | 'left' | 'right' = 'front',
): void {
  const th = 0.12;
  if (side === 'front') g.box(a0, fixedCoord, a1, fixedCoord + depth, y, y + th, m);
  else if (side === 'back') g.box(a0, fixedCoord - depth, a1, fixedCoord, y, y + th, m);
  else if (side === 'right') g.box(fixedCoord, a0, fixedCoord + depth, a1, y, y + th, m);
  else g.box(fixedCoord - depth, a0, fixedCoord, a1, y, y + th, m);
}

export type BalconyStyle = 'parapet-rail' | 'railing' | 'glass' | 'solid';

/**
 * A projecting balcony on a front (+z) or back (-z) facade.
 * Keeps triangle counts low so it scales cleanly from bungalows to 16-storey towers.
 */
export function balcony(
  g: Geo,
  x0: number,
  x1: number,
  z: number,
  y: number,
  depth: number,
  slabMat: Mat,
  railMat: Mat = IRON_DARK,
  style: BalconyStyle = 'parapet-rail',
  face: 'front' | 'back' = 'front',
): void {
  const z0 = face === 'front' ? z : z - depth;
  const z1 = face === 'front' ? z + depth : z;
  const edgeZ = face === 'front' ? z1 - 0.06 : z0 + 0.06;

  // Floor slab.
  g.box(x0, z0, x1, z1, y - 0.14, y, slabMat);

  if (style === 'solid') {
    const h = 1.0;
    const zOut = face === 'front' ? z1 : z0;
    if (face === 'front') {
      g.wall(x1, zOut, x0, zOut, y, y + h, slabMat);
      g.wall(x0, zOut, x1, zOut, y, y + h, slabMat);
    } else {
      g.wall(x0, zOut, x1, zOut, y, y + h, slabMat);
      g.wall(x1, zOut, x0, zOut, y, y + h, slabMat);
    }
    g.wall(x1, z0, x1, z1, y, y + h, slabMat);
    g.wall(x0, z1, x0, z0, y, y + h, slabMat);
    g.box(x0 - 0.02, edgeZ - 0.07, x1 + 0.02, edgeZ + 0.07, y + h, y + h + 0.08, railMat);
    return;
  }

  if (style === 'glass') {
    const h = 1.02;
    const zOut = face === 'front' ? z1 - 0.04 : z0 + 0.04;
    // Glazed front panel + thin top metal rail (very low poly for high-rises).
    if (face === 'front') {
      g.wall(x1, zOut, x0, zOut, y, y + h - 0.06, GLASS_RAIL, win(Style.Curtain, Math.max(1.2, (x1 - x0) / 2), h, 0.5));
      g.wall(x0, zOut, x1, zOut, y, y + h - 0.06, GLASS_RAIL);
    } else {
      g.wall(x0, zOut, x1, zOut, y, y + h - 0.06, GLASS_RAIL, win(Style.Curtain, Math.max(1.2, (x1 - x0) / 2), h, 0.5));
      g.wall(x1, zOut, x0, zOut, y, y + h - 0.06, GLASS_RAIL);
    }
    g.wall(x1 - 0.03, z0, x1 - 0.03, z1, y, y + h - 0.06, GLASS_RAIL);
    g.wall(x0 + 0.03, z1, x0 + 0.03, z0, y, y + h - 0.06, GLASS_RAIL);
    g.box(x0, edgeZ - 0.04, x1, edgeZ + 0.04, y + h - 0.06, y + h, railMat);
    return;
  }

  if (style === 'parapet-rail') {
    const ph = 0.55;
    const rh = 1.02;
    const zOut = face === 'front' ? z1 : z0;
    if (face === 'front') {
      g.wall(x1, zOut, x0, zOut, y, y + ph, slabMat);
      g.wall(x0, zOut, x1, zOut, y, y + ph, slabMat);
    } else {
      g.wall(x0, zOut, x1, zOut, y, y + ph, slabMat);
      g.wall(x1, zOut, x0, zOut, y, y + ph, slabMat);
    }
    g.wall(x1, z0, x1, z1, y, y + ph, slabMat);
    g.wall(x0, z1, x0, z0, y, y + ph, slabMat);
    g.railing(x0 + 0.05, edgeZ, x1 - 0.05, edgeZ, y + ph, y + rh, railMat, 1.6, 0.05, false);
    return;
  }

  // Full open railing on front and both sides.
  const rh = 1.02;
  g.railing(x0 + 0.05, edgeZ, x1 - 0.05, edgeZ, y, y + rh, railMat, 1.4, 0.05, true);
  g.railing(x0 + 0.05, z0 + 0.05, x0 + 0.05, z1 - 0.05, y, y + rh, railMat, 1.4, 0.05, true);
  g.railing(x1 - 0.05, z0 + 0.05, x1 - 0.05, z1 - 0.05, y, y + rh, railMat, 1.4, 0.05, true);
}

/**
 * Perimeter compound wall with corner pillars and an optional front (+z) gate opening,
 * taller gate piers, iron gate, and optional overhead entry lintel/arch.
 */
export function compoundWall(
  g: Geo,
  x0: number,
  z0: number,
  x1: number,
  z1: number,
  h: number,
  wallMat: Mat,
  pillarMat: Mat = WHITE_TRIM,
  gate?: { cx: number; w: number; gateMat?: Mat; overhead?: boolean },
): void {
  const t = 0.22;
  if (x1 - x0 < 2.5 || z1 - z0 < 2.5) return;

  // Back, left, and right walls.
  g.box(x0, z0, x1, z0 + t, 0, h, wallMat, NO_WIN, pillarMat);
  g.box(x0, z0 + t, x0 + t, z1 - t, 0, h, wallMat, NO_WIN, pillarMat);
  g.box(x1 - t, z0 + t, x1, z1 - t, 0, h, wallMat, NO_WIN, pillarMat);

  // Corner pillars.
  const ps = 0.19;
  for (const [px, pz] of [
    [x0 + ps, z0 + ps],
    [x1 - ps, z0 + ps],
    [x0 + ps, z1 - ps],
    [x1 - ps, z1 - ps],
  ] as const) {
    g.box(px - ps, pz - ps, px + ps, pz + ps, 0, h + 0.18, pillarMat);
  }

  // Front wall (+z), split around the gate if present.
  if (!gate) {
    g.box(x0, z1 - t, x1, z1, 0, h, wallMat, NO_WIN, pillarMat);
    return;
  }
  const gx0 = Math.max(x0 + 0.6, gate.cx - gate.w * 0.5);
  const gx1 = Math.min(x1 - 0.6, gate.cx + gate.w * 0.5);
  if (gx0 > x0 + t) g.box(x0, z1 - t, gx0, z1, 0, h, wallMat, NO_WIN, pillarMat);
  if (x1 - t > gx1) g.box(gx1, z1 - t, x1, z1, 0, h, wallMat, NO_WIN, pillarMat);

  // Gate piers.
  const gp = 0.24;
  const gh = h + (gate.overhead ? 1.45 : 0.45);
  g.box(gx0 - gp, z1 - gp * 2, gx0 + gp, z1 + 0.04, 0, gh, pillarMat);
  g.box(gx1 - gp, z1 - gp * 2, gx1 + gp, z1 + 0.04, 0, gh, pillarMat);
  // Pier caps.
  g.box(gx0 - gp - 0.05, z1 - gp * 2 - 0.05, gx0 + gp + 0.05, z1 + 0.09, gh, gh + 0.12, CONCRETE);
  g.box(gx1 - gp - 0.05, z1 - gp * 2 - 0.05, gx1 + gp + 0.05, z1 + 0.09, gh, gh + 0.12, CONCRETE);

  // Overhead lintel / society gate beam.
  if (gate.overhead && gx1 - gx0 > 2.2) {
    g.box(gx0 - gp - 0.1, z1 - gp * 2 - 0.05, gx1 + gp + 0.1, z1 + 0.09, gh + 0.12, gh + 0.62, pillarMat);
  }

  // Iron gate between piers.
  if (gx1 - gx0 > 0.9) {
    g.railing(gx0 + gp, z1 - t * 0.6, gx1 - gp, z1 - t * 0.6, 0.1, h + 0.15, gate.gateMat ?? IRON_DARK, 0.95, 0.05, true);
  }
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

/**
 * Indian residential flat-roof furnishings: a mumty stair tower, 1-4 Sintex water tanks
 * (placed on the mumty or terrace), AC units, and an optional solar water heater.
 */
export function indianRooftop(
  l: Lot,
  x0: number,
  z0: number,
  x1: number,
  z1: number,
  y: number,
  wall: Mat,
  trim: Mat = WHITE_TRIM,
  tankCount = 1,
): void {
  const { g, r } = l;
  const w = x1 - x0;
  const d = z1 - z0;
  if (w < 3.6 || d < 3.6) return;

  // Staircase mumty placed toward the back/side of the terrace.
  const mw = Math.min(3.2, Math.max(2.1, w * 0.28));
  const md = Math.min(3.4, Math.max(2.2, d * 0.3));
  const side = r.chance(0.5) ? -1 : 1;
  const mx0 = side < 0 ? x0 + 0.7 : x1 - 0.7 - mw;
  const mx1 = mx0 + mw;
  const mz0 = z0 + 0.7;
  const mz1 = mz0 + md;
  const mh = 2.45;
  stairTower(g, mx0, mz0, mx1, mz1, y, mh, wall, trim);

  // Place overhead water tanks on top of the mumty slab (or beside it if many).
  const onMumty = Math.min(tankCount, mw > 2.6 ? 2 : 1);
  for (let i = 0; i < onMumty; i++) {
    const tx = mx0 + ((i + 0.5) / onMumty) * mw;
    const tz = (mz0 + mz1) * 0.5;
    waterTank(g, tx, tz, y + mh + 0.18, r, 0.85, false);
  }
  const extra = tankCount - onMumty;
  for (let i = 0; i < extra; i++) {
    const tx = side < 0 ? Math.min(x1 - 1.2, mx1 + 1.1 + i * 1.45) : Math.max(x0 + 1.2, mx0 - 1.1 - i * 1.45);
    if (tx > x0 + 0.9 && tx < x1 - 0.9) {
      waterTank(g, tx, mz0 + 1.1, y, r, 0.92, true);
    }
  }

  // Outdoor AC unit(s) tucked near the opposite back corner.
  const ax = side < 0 ? x1 - 1.3 : x0 + 1.3;
  const az = z0 + 1.4;
  if (Math.abs(ax - (mx0 + mx1) * 0.5) > mw * 0.65) {
    acUnit(g, ax, az, y, 0.72);
  }

  // Occasional rooftop solar water heater (angled dark panel + horizontal cylinder).
  if (w > 6.5 && d > 5.5 && r.chance(0.35)) {
    const sx = side < 0 ? x1 - 2.3 : x0 + 2.3;
    const sz = z1 - 2.2;
    const panel = mat(Layer.ConcreteWall, [0.14, 0.2, 0.34], 2);
    g.poly(
      [
        [sx - 0.95, y + 1.05, sz - 0.6],
        [sx + 0.95, y + 1.05, sz - 0.6],
        [sx + 0.95, y + 0.35, sz + 0.6],
        [sx - 0.95, y + 0.35, sz + 0.6],
      ],
      panel,
    );
    g.box(sx - 0.95, sz - 0.78, sx + 0.95, sz - 0.42, y + 1.05, y + 1.4, WHITE_TRIM);
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

