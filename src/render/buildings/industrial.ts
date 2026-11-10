import {
  ASPHALT,
  CONCRETE,
  CONCRETE_DARK,
  Layer,
  METAL_GREY,
  NO_WIN,
  SIGN,
  STEEL_DARK,
  Style,
  fence,
  flatRoof,
  frontPanel,
  ground,
  mat,
  parking,
  pick,
  roofFinish,
  rooftop,
  vary,
  win,
  type Geo,
  type Lot,
  type Mat,
  type RGB,
} from './common';
import { fitBay } from './geo';

const CLADDING: readonly RGB[] = [
  [1.45, 1.48, 1.5], // galvanised
  [1.5, 1.42, 1.2], // beige
  [0.8, 1.05, 1.35], // blue
  [0.85, 1.15, 0.9], // green
  [1.35, 0.8, 0.7], // oxide red
  [1.1, 1.12, 1.16], // grey
];

const CONTAINER: readonly RGB[] = [
  [1.5, 0.5, 0.35],
  [0.4, 0.75, 1.4],
  [0.5, 1.15, 0.6],
  [1.6, 1.2, 0.3],
  [1.2, 1.22, 1.25],
  [1.0, 0.5, 0.9],
];

const SHED_ROOFS: readonly RGB[] = [
  [1.25, 1.27, 1.3],
  [1.45, 1.46, 1.48],
  [0.95, 0.8, 0.7],
  [0.8, 0.95, 1.1],
  [0.85, 1.0, 0.88],
  [1.05, 1.05, 1.02],
];

const CHAIN_LINK = mat(Layer.Concrete, [0.7, 0.72, 0.74], 1);

function containers(l: Lot, x: number, z: number, alongX: boolean, n: number): void {
  const { g, r } = l;
  for (let i = 0; i < n; i++) {
    const stack = r.chance(0.35) ? 2 : 1;
    for (let s = 0; s < stack; s++) {
      const m = mat(Layer.Metal, pick(r, CONTAINER), 1.4);
      const off = i * 2.7;
      if (alongX) g.box(x, z + off, x + 6.1, z + off + 2.44, s * 2.6, s * 2.6 + 2.6, m);
      else g.box(x + off, z, x + off + 2.44, z + 6.1, s * 2.6, s * 2.6 + 2.6, m);
    }
  }
}

function rollerDoors(g: Geo, x0: number, x1: number, z: number, n: number): void {
  const step = (x1 - x0) / n;
  for (let i = 0; i < n; i++) {
    const cx = x0 + step * (i + 0.5);
    frontPanel(g, cx, z, Math.min(4, step * 0.7), 0.02, 4.2, mat(Layer.Metal, [1.2, 1.22, 1.25], 0.9));
  }
}

/** Upright tank with a shallow conical roof and a rim. */
function tank(g: Geo, x: number, z: number, radius: number, h: number, m: Mat): void {
  g.cyl(x, z, radius, radius, 0, h, 16, m, null);
  g.cyl(x, z, radius + 0.08, radius + 0.08, h, h + 0.18, 16, STEEL_DARK, null);
  g.cyl(x, z, radius + 0.08, 0.3, h + 0.18, h + 0.18 + radius * 0.22, 16, m);
}

/** Tall chimney with warning bands. */
function stack(l: Lot, x: number, z: number, h: number, radius: number, banded: boolean): void {
  const { g } = l;
  const body = banded ? mat(Layer.Concrete, [1.7, 1.7, 1.66], 3) : mat(Layer.Brick, [1.3, 1.12, 1.0], 2);
  const red = mat(Layer.Concrete, [1.7, 0.3, 0.22], 3);
  g.cyl(x, z, radius * 1.5, radius * 1.3, 0, 2.5, 12, CONCRETE);
  const segs = banded ? 6 : 1;
  for (let i = 0; i < segs; i++) {
    const y0 = 2.5 + ((h - 2.5) * i) / segs;
    const y1 = 2.5 + ((h - 2.5) * (i + 1)) / segs;
    const r0 = radius * (1.3 - 0.45 * (i / segs));
    const r1 = radius * (1.3 - 0.45 * ((i + 1) / segs));
    g.cyl(x, z, r0, r1, y0, y1, 12, banded && i >= segs - 3 && i % 2 === (segs - 1) % 2 ? red : body, null);
  }
  g.cyl(x, z, radius * 0.9, radius * 0.9, h, h + 0.3, 12, STEEL_DARK);
}

/** Warehouse or workshop: clad shed, roller doors, a small office and a fenced yard. */
function warehouse(l: Lot): void {
  const { g, r, W, D } = l;
  ground(l, ASPHALT);
  const clad = mat(Layer.Metal, vary(r, pick(r, CLADDING)), 2.2);
  const roofM = mat(Layer.Metal, vary(r, pick(r, SHED_ROOFS)), 2.2);
  const z0 = -D / 2 + 1;
  const z1 = D / 2 - Math.min(9, D * 0.36);
  const x0 = -W / 2 + 1;
  const x1 = W / 2 - 1 - (W > 20 ? r.range(0, 5) : 0);
  const h = r.range(6.5, 8.5) + (l.level - 1);
  g.walls(x0, z0, x1, z1, 0, 0.8, CONCRETE);
  const lights = win(Style.Industrial, fitBay(x1 - x0, 4.5), h - 0.8, 0.5);
  g.walls(x0, z0, x1, z1, 0.8, h, clad, [lights, NO_WIN, lights, NO_WIN]);
  g.gable(x0, z0, x1, z1, h, (x1 - x0) * 0.09 + 0.6, false, 0.4, roofM, clad);
  rollerDoors(g, x0 + 1, x1 - 1, z1, Math.max(1, Math.round((x1 - x0) / 9)));
  // Loading apron.
  g.flat(x0, z1, x1, z1 + 3, 0.05, mat(Layer.Concrete, [1.2, 1.2, 1.18], 4));
  // Office annex with proper windows.
  if (W > 20 && W / 2 - 1 - x1 > 3.5) {
    const ax0 = x1;
    const ax1 = W / 2 - 1;
    const wall = mat(Layer.Brick2, vary(r, [1.45, 1.4, 1.32]), 2);
    g.walls(ax0, z1 - 9, ax1, z1, 0, 6.4, wall, win(Style.Punched, fitBay(ax1 - ax0, 2.6), 3.2, 0.5));
    flatRoof(g, ax0, z1 - 9, ax1, z1, 6.4, wall, roofFinish(r));
    rooftop(l, ax0, z1 - 9, ax1, z1, 6.4, wall);
  }
  // Company sign on the gable.
  g.box(-3, z1, 3, z1 + 0.15, h - 1.6, h - 0.4, mat(Layer.Plaster2, pick(r, CONTAINER).map((c) => c * 0.6) as unknown as RGB, 3), SIGN);
  if (D / 2 - z1 > 6) containers(l, -W / 2 + 1.5, z1 + 4, false, Math.min(3, Math.floor((W - 12) / 2.7)));
  fence(g, -W / 2 + 0.3, -D / 2 + 0.3, -W / 2 + 0.3, D / 2 - 0.3, 2.2, CHAIN_LINK);
  fence(g, W / 2 - 0.3, -D / 2 + 0.3, W / 2 - 0.3, D / 2 - 0.3, 2.2, CHAIN_LINK);
}

/** Factory: brick hall under a sawtooth roof, a boiler stack and process tanks. */
function factory(l: Lot): void {
  const { g, r, W, D } = l;
  ground(l, mat(Layer.Concrete, [1.0, 1.0, 1.0], 4));
  const wall = mat(r.chance(0.6) ? Layer.Brick : Layer.Brick2, vary(r, [1.35, 1.2, 1.12]), 2);
  const roofM = mat(Layer.Metal, vary(r, pick(r, SHED_ROOFS)), 2.2);
  const yard = Math.min(8, D * 0.3);
  const z0 = -D / 2 + 1.2;
  const z1 = D / 2 - yard;
  const x0 = -W / 2 + 1.2;
  const x1 = W / 2 - 1.2 - Math.min(8, W * 0.28);
  const h = 8 + l.level;
  g.walls(x0, z0, x1, z1, 0, 0.8, CONCRETE);
  const lights = win(Style.Industrial, fitBay(x1 - x0, 4), h - 0.8, 0.5);
  const sideL = win(Style.Industrial, fitBay(z1 - z0, 4), h - 0.8, 0.5);
  g.walls(x0, z0, x1, z1, 0.8, h, wall, [lights, sideL, lights, sideL]);
  // Sawtooth roof: each tooth is a glazed riser and a long slope behind it.
  const teeth = Math.max(2, Math.round((z1 - z0) / 6.5));
  const tz = (z1 - z0) / teeth;
  const rise = 2.3;
  const glazing = mat(Layer.ConcreteWall, [0.4, 0.5, 0.56], 3);
  for (let i = 0; i < teeth; i++) {
    const a = z0 + i * tz;
    const b = a + tz;
    g.poly([[x0, h, a], [x1, h, a], [x1, h + rise, b], [x0, h + rise, b]], roofM);
    g.wall(x1, b, x0, b, h, h + rise, glazing, win(Style.Curtain, fitBay(x1 - x0, 2), rise * 1.3, 0.5));
    g.poly([[x0, h, a], [x0, h + rise, b], [x0, h, b]], wall, NO_WIN, false);
    g.poly([[x1, h, a], [x1, h, b], [x1, h + rise, b]], wall, NO_WIN, false);
  }
  rollerDoors(g, x0 + 1.5, x1 - 1.5, z1, Math.max(1, Math.round((x1 - x0) / 11)));
  g.box(x0 + 1, z1, x0 + 8, z1 + 0.15, h - 1.9, h - 0.6, mat(Layer.Plaster2, [0.7, 0.7, 0.68], 3), SIGN);

  // Service yard at the side: stack, tanks, pipe run.
  const sx = (x1 + W / 2) / 2;
  stack(l, sx, z0 + 3.5, r.range(22, 30) + l.level * 2, 1.0, r.chance(0.5));
  const tm = mat(Layer.Metal, vary(r, [1.4, 1.42, 1.45]), 2.4);
  const tr = Math.min(2.6, (W / 2 - x1 - 1.6) / 2);
  if (tr > 1.2) {
    tank(g, sx, z0 + 10, tr, r.range(5, 8), tm);
    if (z1 - z0 > 20) tank(g, sx, z0 + 10 + tr * 2 + 1, tr, r.range(4, 7), tm);
    // Pipe bridge from the hall to the tanks.
    g.box(x1, z0 + 9.6, sx, z0 + 10.4, 4.2, 4.7, METAL_GREY);
    g.box(sx - 0.15, z0 + 9.85, sx + 0.15, z0 + 10.15, 0, 4.2, STEEL_DARK);
  }
  if (yard > 6) parking(g, -W / 2 + 1, z1 + 3.2, W / 2 - 1, D / 2 - 0.8, 0.04);
}

/** Heavy plant: tank farm, silos with a conveyor, a process hall and banded stacks. */
function heavy(l: Lot): void {
  const { g, r, W, D } = l;
  ground(l, mat(Layer.Concrete, [0.92, 0.92, 0.92], 4));
  const clad = mat(Layer.Metal, vary(r, pick(r, CLADDING)), 2.4);
  const roofM = mat(Layer.Metal, vary(r, pick(r, SHED_ROOFS)), 2.2);
  // Process hall across the back.
  const hx0 = -W / 2 + 1.2;
  const hx1 = W / 2 - 1.2;
  const hz0 = -D / 2 + 1.2;
  const hz1 = hz0 + Math.min(11, D * 0.36);
  const h = 11 + l.level;
  g.walls(hx0, hz0, hx1, hz1, 0, 1, CONCRETE);
  g.walls(hx0, hz0, hx1, hz1, 1, h, clad, win(Style.Industrial, fitBay(hx1 - hx0, 5), h - 1, 0.5));
  g.gable(hx0, hz0, hx1, hz1, h, 1.8, true, 0.4, roofM, clad);
  rollerDoors(g, hx0 + 2, hx1 - 2, hz1, Math.max(1, Math.round((hx1 - hx0) / 12)));
  // Stacks rising from behind the hall.
  const stacks = 1 + (W > 24 ? 1 : 0);
  for (let i = 0; i < stacks; i++) stack(l, hx0 + 4 + i * 5.5, hz1 + 3, r.range(30, 40) + l.level * 3, 1.25, true);

  // Tank farm in front: a bund wall around a group of tanks.
  const fx0 = -W / 2 + 1.6;
  const fx1 = W * 0.08;
  const fz0 = hz1 + 7;
  const fz1 = D / 2 - 1.6;
  if (fz1 - fz0 > 6) {
    g.walls(fx0, fz0, fx1, fz1, 0, 0.9, CONCRETE_DARK);
    const tm = mat(Layer.Metal, vary(r, [1.5, 1.5, 1.48]), 2.6);
    const tr = Math.min((fx1 - fx0 - 1.5) / 4, (fz1 - fz0 - 1.5) / 4, 3.4);
    const cols = Math.max(1, Math.floor((fx1 - fx0 - 1) / (tr * 2 + 0.8)));
    const rows = Math.max(1, Math.floor((fz1 - fz0 - 1) / (tr * 2 + 0.8)));
    for (let j = 0; j < rows; j++) {
      for (let i = 0; i < cols; i++) {
        const tx = fx0 + 0.8 + tr + i * (tr * 2 + 0.8);
        const tzc = fz0 + 0.8 + tr + j * (tr * 2 + 0.8);
        tank(g, tx, tzc, tr, r.range(5.5, 9), tm);
      }
    }
  }
  // Silos and an inclined conveyor on the other side.
  const sx = W / 2 - 4.2;
  const sz = hz1 + 9;
  if (D / 2 - sz > 4) {
    const sm = mat(Layer.Concrete, [1.5, 1.5, 1.46], 3);
    const n = D / 2 - sz > 10 ? 3 : 2;
    for (let i = 0; i < n; i++) {
      const cz = sz + i * 3.7;
      g.cyl(sx, cz, 1.7, 1.7, 0, 13, 12, sm, null);
      g.cyl(sx, cz, 1.75, 0.25, 13, 14.6, 12, METAL_GREY);
    }
    // Conveyor from the ground up to the silo tops.
    g.poly([[sx - 9, 1, sz - 0.6], [sx - 9, 1, sz + 0.6], [sx, 15, sz + 0.6], [sx, 15, sz - 0.6]], METAL_GREY);
    g.poly([[sx - 9, 1, sz + 0.6], [sx - 9, 2.1, sz + 0.6], [sx, 16.1, sz + 0.6], [sx, 15, sz + 0.6]], METAL_GREY, NO_WIN, false);
    g.poly([[sx - 9, 2.1, sz - 0.6], [sx - 9, 1, sz - 0.6], [sx, 15, sz - 0.6], [sx, 16.1, sz - 0.6]], METAL_GREY, NO_WIN, false);
    g.poly([[sx - 9, 2.1, sz - 0.6], [sx, 16.1, sz - 0.6], [sx, 16.1, sz + 0.6], [sx - 9, 2.1, sz + 0.6]], METAL_GREY);
    for (const px of [sx - 6.5, sx - 3.2]) g.box(px - 0.15, sz - 0.15, px + 0.15, sz + 0.15, 0, 1 + ((px - (sx - 9)) / 9) * 14, STEEL_DARK);
  }
  fence(g, -W / 2 + 0.3, D / 2 - 0.4, W / 2 - 0.3, D / 2 - 0.4, 2.4, CHAIN_LINK);
}

export function industrial(l: Lot): void {
  const { W, D } = l;
  if (l.density === 1 || W < 20 || D < 20) warehouse(l);
  else if (l.density === 2 || W < 28 || D < 24) factory(l);
  else heavy(l);
}
