import { clamp } from '../../core/math';
import {
  CONCRETE,
  GRAVEL_ROOF,
  LAWN,
  Layer,
  NO_WIN,
  PAVING,
  Style,
  WHITE_TRIM,
  WOOD,
  door,
  fence,
  flatRoof,
  frontPanel,
  ground,
  hedge,
  mat,
  parking,
  pick,
  roofFinish,
  rooftop,
  shrub,
  vary,
  win,
  type Lot,
  type Mat,
  type RGB,
} from './common';
import { fitBay } from './geo';

const HOUSE_WALLS: ReadonlyArray<[Layer, RGB]> = [
  [Layer.Plaster2, [1.22, 1.2, 1.14]], // off-white render
  [Layer.Plaster2, [1.2, 1.1, 0.86]], // cream
  [Layer.Plaster2, [1.16, 1.02, 0.7]], // pale yellow
  [Layer.Plaster, [1.0, 1.18, 1.0]], // sage
  [Layer.Plaster, [0.98, 1.12, 1.3]], // blue-grey
  [Layer.Plaster, [1.3, 0.98, 0.84]], // salmon
  [Layer.Brick, [1.45, 1.3, 1.2]], // red brick
  [Layer.Brick2, [1.5, 1.42, 1.34]], // buff brick
  [Layer.Brick, [1.05, 1.0, 0.98]], // dark brick
];

const HOUSE_ROOFS: ReadonlyArray<[Layer, RGB]> = [
  [Layer.Roof2, [1.0, 0.92, 0.88]], // clay tile
  [Layer.Roof2, [0.72, 0.62, 0.6]], // weathered clay
  [Layer.Roof3, [0.6, 0.62, 0.66]], // slate
  [Layer.Roof3, [0.82, 0.8, 0.78]], // grey tile
  [Layer.Roof, [1.1, 1.0, 0.95]], // brown tile
  [Layer.Roof, [0.7, 0.72, 0.78]], // dark shingle
];

const DOOR_TINTS: readonly RGB[] = [
  [0.75, 0.16, 0.12],
  [0.14, 0.3, 0.5],
  [0.16, 0.38, 0.22],
  [0.5, 0.32, 0.16],
  [0.2, 0.2, 0.22],
  [1.2, 1.2, 1.15],
];

/** Detached house with a pitched roof, porch, optional garage, drive and garden. */
export function house(l: Lot): void {
  const { g, r, W, D } = l;
  ground(l, mat(Layer.Grass, vary(r, LAWN.tint, 0.1), 5));
  const narrow = W < 12;
  const floors = l.level >= 2 || r.chance(0.22) ? 2 : 1;
  const fh = 2.85;
  const plinth = 0.4;
  const top = plinth + floors * fh;
  const hasGarage = !narrow && r.chance(0.72);
  const gw = hasGarage ? 3.9 : 0;
  const side = r.chance(0.5) ? 1 : -1;
  const bw = clamp((narrow ? 5.4 : r.range(8, 10.2)) + (l.level - 1) * 0.9, 4.8, W - 3 - gw);
  const bd = clamp(r.range(6.8, 8.6) + (l.level - 1) * 0.8, 5.5, D - 8.2);
  const z1 = D / 2 - r.range(4.3, 5.6);
  const z0 = z1 - bd;
  const cx = hasGarage ? (-side * gw) / 2 : r.range(-0.4, 0.4);
  const x0 = cx - bw / 2;
  const x1 = cx + bw / 2;

  const [wl, wt] = pick(r, HOUSE_WALLS);
  const wall = mat(wl, vary(r, wt), wl <= Layer.Brick2 ? 2 : 3);
  const [rl, rt] = pick(r, HOUSE_ROOFS);
  const roof = mat(rl, vary(r, rt), 2.4);
  const doorTint = pick(r, DOOR_TINTS);

  g.walls(x0, z0, x1, z1, 0, plinth, CONCRETE);
  const wf = win(Style.Punched, fitBay(bw, 2.7), fh, r.range(0.4, 0.5));
  const ws = win(Style.Punched, fitBay(bd, 3.2), fh, 0.36);
  g.walls(x0, z0, x1, z1, plinth, top, wall, [wf, ws, wf, ws]);

  // Roof: ridge along the long side most of the time; sometimes hipped.
  const alongX = bw >= bd ? r.chance(0.8) : r.chance(0.25);
  const span = alongX ? bd : bw;
  const rise = (span / 2) * r.range(0.55, 0.78);
  const hipped = r.chance(0.3);
  if (hipped) g.hip(x0, z0, x1, z1, top, rise * 0.9, 0.45, roof);
  else g.gable(x0, z0, x1, z1, top, rise, alongX, 0.45, roof, wall);

  // Level 3 houses gain a front wing with its own gable.
  if (l.level >= 3 && bw > 8) {
    const ww = bw * 0.42;
    const wx0 = side > 0 ? x0 : x1 - ww;
    g.walls(wx0, z1, wx0 + ww, z1 + 2.2, 0, plinth, CONCRETE);
    g.walls(wx0, z1, wx0 + ww, z1 + 2.2, plinth, top, wall, win(Style.Punched, ww, fh, 0.5));
    g.gable(wx0, z1 - 1, wx0 + ww, z1 + 2.2, top, (ww / 2) * 0.7, false, 0.4, roof, wall);
  }

  // Chimney.
  if (r.chance(0.7)) {
    const chx = r.range(x0 + 1, x1 - 1);
    const chz = alongX ? (z0 + z1) / 2 + r.range(-1, 1) : r.range(z0 + 1, z1 - 1);
    const cm = mat(Layer.Brick, [1.3, 1.15, 1.05], 1.6);
    g.box(chx - 0.38, chz - 0.38, chx + 0.38, chz + 0.38, top, top + rise + 0.75, cm, NO_WIN, CONCRETE);
  }

  // Garage, attached at one side, with a paved drive to the street.
  const doorX = clamp(cx + (hasGarage ? side * -1.4 : r.range(-1.5, 1.5)), x0 + 1, x1 - 1);
  if (hasGarage) {
    const gx0 = side > 0 ? x1 : x0 - gw;
    const gz1 = z1 - r.range(0, 1.2);
    const gz0 = gz1 - 6.2;
    const gh = 2.75;
    g.walls(gx0, gz0, gx0 + gw, gz1, 0, gh, wall);
    g.gable(gx0, gz0, gx0 + gw, gz1, gh, 0.9, false, 0.3, roof, wall);
    frontPanel(g, gx0 + gw / 2, gz1, 2.7, 0.02, 2.2, mat(Layer.Metal, [1.5, 1.5, 1.48], 1.1));
    g.flat(gx0 + 0.45, gz1, gx0 + gw - 0.45, D / 2, 0.035, CONCRETE);
  } else if (!narrow) {
    // No garage: a strip of drive beside the house.
    const dx = side > 0 ? x1 + 0.4 : x0 - 3.2;
    if (dx > -W / 2 + 0.2 && dx + 2.8 < W / 2 - 0.2) g.flat(dx, z1 - 5, dx + 2.8, D / 2, 0.035, CONCRETE);
  }

  // Porch and front door.
  const stepY = plinth;
  g.box(doorX - 1.25, z1, doorX + 1.25, z1 + 1.5, 0, stepY, CONCRETE);
  g.box(doorX - 0.9, z1 + 1.5, doorX + 0.9, z1 + 1.85, 0, stepY * 0.5, CONCRETE);
  door(g, doorX, z1, stepY, doorTint);
  if (r.chance(0.7)) {
    for (const px of [doorX - 1.15, doorX + 1.15]) g.box(px - 0.07, z1 + 1.33, px + 0.07, z1 + 1.47, stepY, stepY + 2.25, WHITE_TRIM);
    g.box(doorX - 1.4, z1, doorX + 1.4, z1 + 1.6, stepY + 2.25, stepY + 2.4, WHITE_TRIM, NO_WIN, roof);
  }
  g.flat(doorX - 0.6, z1 + 1.85, doorX + 0.6, D / 2, 0.035, PAVING);

  // Garden: boundary, planting, trees.
  const hx = W / 2 - 0.35;
  const hz = D / 2 - 0.35;
  const boundary = r.int(3);
  if (boundary === 0) {
    hedge(g, -hx - 0.3, -hz - 0.3, hx + 0.3, -hz + 0.3, r.range(1.0, 1.6));
    hedge(g, -hx - 0.3, -hz, -hx + 0.3, z1 - 1, 1.1);
    hedge(g, hx - 0.3, -hz, hx + 0.3, z1 - 1, 1.1);
  } else if (boundary === 1) {
    const fm = r.chance(0.5) ? WOOD : WHITE_TRIM;
    fence(g, -hx, -hz, hx, -hz, 1.5, fm);
    fence(g, -hx, -hz, -hx, z1 - 1, 1.5, fm);
    fence(g, hx, -hz, hx, z1 - 1, 1.5, fm);
  }
  const shrubs = r.int(4);
  for (let i = 0; i < shrubs; i++) {
    const sx = r.range(x0, x1);
    if (Math.abs(sx - doorX) < 1.6) continue;
    shrub(g, sx, z1 + 0.7, r.range(0.45, 0.75), [0.4 + r.next() * 0.2, 0.62 + r.next() * 0.15, 0.3]);
  }
  if (z0 - -D / 2 > 5 && r.chance(0.75)) g.tree(r.range(-hx + 2.5, hx - 2.5), (z0 - D / 2) / 2, r.range(0.55, 0.85), r.next() * 6);
  if (!narrow && r.chance(0.35)) g.tree(side > 0 ? -hx + 2.2 : hx - 2.2, D / 2 - 2.6, r.range(0.4, 0.55), r.next() * 6);
}

const TERRACE_WALLS: ReadonlyArray<[Layer, RGB]> = [
  [Layer.Brick, [1.5, 1.3, 1.2]],
  [Layer.Brick, [1.15, 1.05, 1.0]],
  [Layer.Brick2, [1.5, 1.4, 1.3]],
  [Layer.Brick2, [1.1, 1.0, 0.95]],
  [Layer.Plaster2, [1.2, 1.15, 1.02]],
  [Layer.Plaster, [1.25, 1.05, 0.9]],
  [Layer.Plaster, [0.95, 1.1, 1.22]],
];

/** A terrace of narrow town houses, each with its own colour, stoop and roofline. */
function terrace(l: Lot): void {
  const { g, r, W, D } = l;
  ground(l, LAWN);
  const n = Math.max(1, Math.floor((W - 1) / 6.2));
  const uw = (W - 1) / n;
  const z1 = D / 2 - 3.2;
  const depth = clamp(r.range(9.5, 11.5), 7, D - 7);
  const z0 = z1 - depth;
  const fh = 3.0;
  const base = 2 + (l.level >= 2 ? 1 : 0);
  g.flat(-W / 2, z1, W / 2, D / 2, 0.03, PAVING);
  for (let i = 0; i < n; i++) {
    const x0 = -W / 2 + 0.5 + i * uw;
    const x1 = x0 + uw;
    const floors = base + (l.level >= 3 && r.chance(0.5) ? 1 : 0);
    const top = 0.6 + floors * fh;
    const [wl, wt] = pick(r, TERRACE_WALLS);
    const wall = mat(wl, vary(r, wt), wl <= Layer.Brick2 ? 2 : 3);
    const wn = win(Style.Punched, uw / 2, fh, r.range(0.44, 0.56));
    g.walls(x0, z0, x1, z1, 0, 0.6, CONCRETE);
    g.walls(x0, z0, x1, z1, 0.6, top, wall, [wn, NO_WIN, wn, NO_WIN]);
    if (r.chance(0.45)) {
      const [rl, rt] = pick(r, HOUSE_ROOFS);
      g.gable(x0, z0, x1, z1, top, 1.9, true, 0.25, mat(rl, rt, 2.4), wall);
    } else {
      flatRoof(g, x0, z0, x1, z1, top, wall, roofFinish(r), 0.5);
      // Cornice.
      g.box(x0 - 0.02, z1, x1 + 0.02, z1 + 0.22, top + 0.15, top + 0.5, WHITE_TRIM);
    }
    // Stoop and door at one side of the unit.
    const dx = x0 + uw * (r.chance(0.5) ? 0.27 : 0.73);
    g.box(dx - 0.75, z1, dx + 0.75, z1 + 1.3, 0, 0.6, CONCRETE);
    g.box(dx - 0.75, z1 + 1.3, dx + 0.75, z1 + 1.7, 0, 0.3, CONCRETE);
    door(g, dx, z1, 0.6, pick(r, DOOR_TINTS));
    if (r.chance(0.5)) shrub(g, x0 + uw * (dx > x0 + uw / 2 ? 0.25 : 0.75), z1 + 0.8, 0.5);
    // Back yard divider.
    if (i > 0) fence(g, x0, -D / 2 + 0.3, x0, z0, 1.6);
  }
  fence(g, -W / 2 + 0.3, -D / 2 + 0.3, W / 2 - 0.3, -D / 2 + 0.3, 1.6);
  if (r.chance(0.6)) g.tree(r.range(-W / 2 + 3, W / 2 - 3), (z0 - D / 2) / 2, 0.6, r.next() * 6);
}

const BLOCK_WALLS: ReadonlyArray<[Layer, RGB]> = [
  [Layer.Brick, [1.45, 1.28, 1.18]],
  [Layer.Brick2, [1.5, 1.42, 1.32]],
  [Layer.Brick, [1.0, 0.98, 0.98]],
  [Layer.Plaster2, [1.18, 1.14, 1.04]],
  [Layer.Plaster, [1.28, 1.16, 0.96]],
  [Layer.ConcreteWall, [1.15, 1.14, 1.12]],
];

const BALCONY: readonly Mat[] = [
  mat(Layer.Plaster2, [1.22, 1.22, 1.2], 3),
  mat(Layer.Concrete, [1.5, 1.5, 1.48], 3),
  mat(Layer.Plaster, [0.7, 0.75, 0.82], 3),
];

/** Stacks of solid-fronted balconies on a front wall. */
function balconies(l: Lot, x0: number, x1: number, z: number, fh: number, from: number, floors: number, base: number, m: Mat): void {
  const { g } = l;
  const bay = fitBay(x1 - x0, 5.4);
  const n = Math.round((x1 - x0) / bay);
  for (let c = 0; c < n; c++) {
    if (n > 2 && c % 2 === 1) continue;
    const bx0 = x0 + c * bay + bay * 0.14;
    const bx1 = x0 + (c + 1) * bay - bay * 0.14;
    for (let f = from; f < floors; f++) {
      const y = base + f * fh;
      g.box(bx0, z, bx1, z + 1.25, y - 0.12, y + 1.02, m);
    }
  }
}

/** Walk-up apartment block: three to five storeys, flat roof, balconies, parking behind. */
function apartments(l: Lot): void {
  const { g, r, W, D } = l;
  ground(l, LAWN);
  const floors = 3 + l.level - 1 + (r.chance(0.4) ? 1 : 0);
  const fh = 3.0;
  const base = 0.5;
  const top = base + floors * fh;
  const z1 = D / 2 - r.range(3.5, 4.5);
  const backSpace = D > 20 ? 8.5 : 2;
  const z0 = Math.min(z1 - 8, -D / 2 + backSpace);
  const x0 = -W / 2 + 1.6;
  const x1 = W / 2 - 1.6;
  const [wl, wt] = pick(r, BLOCK_WALLS);
  const wall = mat(wl, vary(r, wt), wl <= Layer.Brick2 ? 2 : 3);
  const wf = win(Style.Punched, fitBay(x1 - x0, 2.7), fh, r.range(0.46, 0.58));
  const ws = win(Style.Punched, fitBay(z1 - z0, 3), fh, 0.42);
  g.walls(x0, z0, x1, z1, 0, base, CONCRETE);
  g.walls(x0, z0, x1, z1, base, top, wall, [wf, ws, wf, ws]);
  flatRoof(g, x0, z0, x1, z1, top, wall, roofFinish(r));
  rooftop(l, x0, z0, x1, z1, top, wall, wl <= Layer.Brick2 && r.chance(0.6));
  if (r.chance(0.8)) balconies(l, x0, x1, z1, fh, 1, floors, base, pick(r, BALCONY));

  // Entrance: canopy, glazed door, path.
  const ex = r.range(-1.5, 1.5);
  g.box(ex - 1.8, z1, ex + 1.8, z1 + 1.8, base + 2.5, base + 2.72, CONCRETE);
  for (const px of [ex - 1.6, ex + 1.6]) g.box(px - 0.08, z1 + 1.55, px + 0.08, z1 + 1.71, 0, base + 2.5, CONCRETE);
  frontPanel(g, ex, z1, 2.2, base, base + 2.3, mat(Layer.Concrete, [0.5, 0.52, 0.55], 2), win(Style.Storefront, 2.2, 2.3, 0.5));
  g.box(ex - 1.6, z1, ex + 1.6, z1 + 1.9, 0, base, CONCRETE);
  g.flat(ex - 1.1, z1 + 1.9, ex + 1.1, D / 2, 0.035, PAVING);
  shrub(g, ex - 2.6, z1 + 0.8, 0.6);
  shrub(g, ex + 2.6, z1 + 0.8, 0.6);

  if (backSpace > 6) {
    parking(g, -W / 2 + 0.6, -D / 2 + 0.6, W / 2 - 0.6, z0 - 0.8);
  }
  g.tree(-W / 2 + 2.2, D / 2 - 2.2, 0.55, r.next() * 6);
  if (W > 20) g.tree(W / 2 - 2.2, D / 2 - 2.2, 0.55, r.next() * 6);
}

const TOWER_WALLS: ReadonlyArray<[Layer, RGB]> = [
  [Layer.Plaster2, [1.22, 1.2, 1.15]],
  [Layer.ConcreteWall, [1.2, 1.18, 1.14]],
  [Layer.Plaster, [1.3, 1.2, 1.02]],
  [Layer.Brick2, [1.5, 1.42, 1.32]],
  [Layer.Plaster, [0.95, 1.05, 1.18]],
  [Layer.Brick, [1.35, 1.2, 1.12]],
];

/** Residential tower on a low podium, with balcony stacks and a roof-level plant room. */
function tower(l: Lot): void {
  const { g, r, W, D } = l;
  ground(l, PAVING);
  const fh = 3.0;
  const floors = 7 + l.level * 4 + r.int(4);
  const podiumH = r.chance(0.6) ? 4.2 : 0;
  const z1 = D / 2 - 3.5;
  const x0 = -W / 2 + 2.2;
  const x1 = W / 2 - 2.2;
  const z0 = -D / 2 + (D > 26 ? 7 : 2.5);
  const [wl, wt] = pick(r, TOWER_WALLS);
  const wall = mat(wl, vary(r, wt), wl <= Layer.Brick2 ? 2 : 3);
  // The lift and stair core reads as a slightly darker or warmer pier on each long face.
  const shade = pick(r, [[0.74, 0.74, 0.76], [0.82, 0.74, 0.66], [0.66, 0.72, 0.8], [0.62, 0.62, 0.62]] as RGB[]);
  const accent = mat(Layer.Plaster2, [1.2 * shade[0], 1.2 * shade[1], 1.2 * shade[2]], 3);

  // Tower shaft: slab or point block depending on the lot.
  const slab = r.chance(0.5) && W >= 24;
  const tx0 = slab ? x0 + 0.5 : x0 + (x1 - x0) * 0.14;
  const tx1 = slab ? x1 - 0.5 : x1 - (x1 - x0) * 0.14;
  const tz1 = z1 - (podiumH > 0 ? 1.5 : 0);
  const tz0 = slab ? Math.max(z0, tz1 - 13) : Math.max(z0 + 0.5, tz1 - (tx1 - tx0) * r.range(0.8, 1.05));
  const base = podiumH > 0 ? podiumH : 0.6;
  const top = base + floors * fh;

  if (podiumH > 0) {
    const shop = win(Style.Storefront, fitBay(x1 - x0, 4.5), podiumH, 0.5);
    const plain = win(Style.Punched, fitBay(z1 - z0, 3.4), podiumH, 0.4);
    g.walls(x0, z0, x1, z1, 0, podiumH, mat(Layer.ConcreteWall, [1.0, 1.0, 1.0], 3), [NO_WIN, plain, shop, plain]);
    flatRoof(g, x0, z0, x1, z1, podiumH, wall, PAVING, 0.9);
  } else {
    g.walls(tx0, tz0, tx1, tz1, 0, base, CONCRETE);
  }

  const style = r.chance(0.35) ? Style.Ribbon : Style.Punched;
  const wf = win(style, fitBay(tx1 - tx0, 3.1), fh, r.range(0.5, 0.62));
  const ws = win(style, fitBay(tz1 - tz0, 3.1), fh, 0.5);
  g.walls(tx0, tz0, tx1, tz1, base, top, wall, [wf, ws, wf, ws]);
  // A coloured vertical strip marks the lift core.
  const sx = tx0 + (tx1 - tx0) * r.range(0.3, 0.7);
  const stair = win(Style.Punched, 2.6, fh, 0.34);
  g.box(sx - 1.3, tz1, sx + 1.3, tz1 + 0.35, base, top + 1.4, accent, stair);
  g.box(sx - 1.3, tz0 - 0.35, sx + 1.3, tz0, base, top + 1.4, accent, stair);
  flatRoof(g, tx0, tz0, tx1, tz1, top, wall, roofFinish(r));
  rooftop(l, tx0, tz0, tx1, tz1, top, wall);
  // Plant room and mast.
  const px = (tx0 + tx1) / 2;
  const pz = (tz0 + tz1) / 2;
  g.box(px - 2.6, pz - 2, px + 2.6, pz + 2, top, top + 3, accent, NO_WIN, GRAVEL_ROOF);
  if (r.chance(0.5)) g.cyl(px + 1.5, pz, 0.09, 0.03, top + 3, top + 3 + r.range(5, 9), 5, mat(Layer.Concrete, [1.6, 1.6, 1.6]));

  // Balconies on the front, left and right of the core strip.
  const bm = pick(r, BALCONY);
  if (sx - 1.6 - tx0 > 4) balconies(l, tx0, sx - 1.6, tz1, fh, 0, floors, base, bm);
  if (tx1 - (sx + 1.6) > 4) balconies(l, sx + 1.6, tx1, tz1, fh, 0, floors, base, bm);

  // Forecourt planting.
  g.flat(-W / 2 + 0.4, z1 + 0.4, W / 2 - 0.4, D / 2 - 0.4, 0.04, LAWN);
  g.flat(sx - 1.6, z1, sx + 1.6, D / 2, 0.05, PAVING);
  g.tree(-W / 2 + 2.4, D / 2 - 1.9, 0.55, r.next() * 6);
  g.tree(W / 2 - 2.4, D / 2 - 1.9, 0.55, r.next() * 6);
  if (z0 - -D / 2 > 6) parking(g, -W / 2 + 0.6, -D / 2 + 0.6, W / 2 - 0.6, z0 - 0.6);
}

export function residential(l: Lot): void {
  if (l.density === 1) house(l);
  else if (l.density === 2) {
    if (l.W < 12 || l.D < 14) house(l);
    else if (l.r.chance(0.5)) terrace(l);
    else apartments(l);
  } else if (l.W < 16 || l.D < 16) apartments(l);
  else tower(l);
}
