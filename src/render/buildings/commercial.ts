import {
  ASPHALT,
  CONCRETE,
  GRAVEL_ROOF,
  LAWN,
  Layer,
  LINE_WHITE,
  METAL_GREY,
  NO_WIN,
  PAVING,
  SIGN,
  STEEL_DARK,
  Style,
  awning,
  flatRoof,
  ground,
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

const SHOP_WALLS: ReadonlyArray<[Layer, RGB]> = [
  [Layer.Brick, [1.45, 1.3, 1.2]],
  [Layer.Brick2, [1.5, 1.42, 1.32]],
  [Layer.Brick, [1.02, 1.0, 1.0]],
  [Layer.Plaster2, [1.22, 1.18, 1.08]],
  [Layer.Plaster, [1.3, 1.12, 0.92]],
  [Layer.Plaster, [0.96, 1.1, 1.2]],
  [Layer.ConcreteWall, [1.12, 1.12, 1.1]],
];

/** Saturated colours for awnings, fascias and signs. */
const BRAND: readonly RGB[] = [
  [0.82, 0.12, 0.1],
  [0.1, 0.32, 0.72],
  [0.08, 0.5, 0.3],
  [0.92, 0.55, 0.06],
  [0.5, 0.14, 0.5],
  [0.06, 0.48, 0.55],
  [0.9, 0.78, 0.1],
  [0.16, 0.16, 0.18],
];

function signBand(l: Lot, x0: number, x1: number, z: number, y0: number, y1: number, tint: RGB): void {
  l.g.box(x0, z, x1, z + 0.18, y0, y1, mat(Layer.Plaster2, tint, 3), SIGN, mat(Layer.Concrete, [0.6, 0.6, 0.6]));
}

/** A parade of small shops: glazed fronts, awnings and fascia signs, flats or stores above. */
function shops(l: Lot): void {
  const { g, r, W, D } = l;
  ground(l, PAVING);
  const z1 = D / 2 - 0.6;
  const z0 = Math.max(-D / 2 + (D > 18 ? 7 : 1.2), z1 - r.range(11, 14));
  const n = Math.max(1, Math.round((W - 0.6) / r.range(6.5, 8.5)));
  const uw = (W - 0.6) / n;
  const gh = 3.9;
  for (let i = 0; i < n; i++) {
    const x0 = -W / 2 + 0.3 + i * uw;
    const x1 = x0 + uw;
    const upper = (l.level >= 2 ? 1 : 0) + (r.chance(0.45) ? 1 : 0);
    const fh = 3.0;
    const top = gh + upper * fh;
    const [wl, wt] = pick(r, SHOP_WALLS);
    const wall = mat(wl, vary(r, wt), wl <= Layer.Brick2 ? 2 : 3);
    const brand = pick(r, BRAND);
    const front = win(Style.Storefront, fitBay(uw, 3.6), gh, 0.5);
    g.walls(x0, z0, x1, z1, 0, gh, wall, [NO_WIN, NO_WIN, front, NO_WIN]);
    if (upper > 0) {
      const wn = win(Style.Punched, fitBay(uw, 2.6), fh, r.range(0.44, 0.56));
      g.walls(x0, z0, x1, z1, gh, top, wall, [wn, NO_WIN, wn, NO_WIN]);
    }
    flatRoof(g, x0, z0, x1, z1, top, wall, roofFinish(r), r.range(0.5, 1.1));
    rooftop(l, x0, z0, x1, z1, top, wall);
    signBand(l, x0 + 0.4, x1 - 0.4, z1, gh - 0.75, gh - 0.1, brand);
    if (r.chance(0.7)) awning(g, x0 + 0.5, x1 - 0.5, z1 + 0.18, gh - 0.8, 1.5, r.chance(0.6) ? brand : pick(r, BRAND));
    // A projecting blade sign on some units.
    if (upper > 0 && r.chance(0.5)) g.box(x0 + 0.5, z1, x0 + 0.72, z1 + 1.0, gh + 0.6, gh + 2.6, mat(Layer.Plaster2, pick(r, BRAND), 3), SIGN);
  }
  if (z0 - -D / 2 > 5) parking(g, -W / 2 + 0.5, -D / 2 + 0.5, W / 2 - 0.5, z0 - 0.6);
}

/** A strip mall set back behind its car park, with a long canopy and a pylon sign. */
function stripMall(l: Lot): void {
  const { g, r, W, D } = l;
  ground(l, ASPHALT);
  const depth = Math.min(11, D * 0.42);
  const z0 = -D / 2 + 0.8;
  const z1 = z0 + depth;
  const x0 = -W / 2 + 0.8;
  const x1 = W / 2 - 0.8;
  const h = 4.6;
  const [wl, wt] = pick(r, SHOP_WALLS);
  const wall = mat(wl, vary(r, wt), 3);
  const brand = pick(r, BRAND);
  g.walls(x0, z0, x1, z1, 0, h, wall, [NO_WIN, NO_WIN, win(Style.Storefront, fitBay(x1 - x0, 4), h, 0.5), NO_WIN]);
  flatRoof(g, x0, z0, x1, z1, h, wall, roofFinish(r), 0.9);
  rooftop(l, x0, z0, x1, z1, h, wall);
  // Walkway canopy on slim posts.
  g.box(x0, z1, x1, z1 + 2.6, 3.3, 3.55, mat(Layer.Plaster2, brand, 3), NO_WIN, GRAVEL_ROOF);
  const posts = Math.max(2, Math.round((x1 - x0) / 5));
  for (let i = 0; i <= posts; i++) {
    const px = x0 + 0.2 + ((x1 - x0 - 0.4) * i) / posts;
    g.box(px - 0.08, z1 + 2.35, px + 0.08, z1 + 2.51, 0, 3.3, CONCRETE);
  }
  g.flat(x0, z1, x1, z1 + 2.8, 0.12, PAVING);
  // One sign per unit above the canopy.
  const units = Math.max(2, Math.round((x1 - x0) / 8));
  for (let i = 0; i < units; i++) {
    const ux = x0 + ((x1 - x0) * (i + 0.5)) / units;
    signBand(l, ux - 2.4, ux + 2.4, z1, 3.65, 4.45, pick(r, BRAND));
  }
  parking(g, -W / 2 + 1.2, z1 + 3.4, W / 2 - 1.2, D / 2 - 1.4, 0.03);
  // Pylon sign at the street.
  const sx = (r.chance(0.5) ? -1 : 1) * (W / 2 - 1.6);
  g.box(sx - 0.14, D / 2 - 1.2, sx + 0.14, D / 2 - 0.92, 0, 6.5, STEEL_DARK);
  g.box(sx - 1.3, D / 2 - 1.24, sx + 1.3, D / 2 - 0.88, 4.4, 6.8, mat(Layer.Plaster2, brand, 3), SIGN);
  g.tree(-sx, D / 2 - 1.6, 0.45, r.next() * 6);
}

/** Filling station: a canopy over the pumps and a small shop. */
function gasStation(l: Lot): void {
  const { g, r, W, D } = l;
  ground(l, mat(Layer.Concrete, [1.15, 1.15, 1.14], 4));
  const brand = pick(r, BRAND);
  const cw = Math.min(W - 4, 13);
  const cz = D / 2 - 6.5;
  const canopy = mat(Layer.Plaster2, [1.3, 1.3, 1.28], 3);
  g.box(-cw / 2, cz - 3.6, cw / 2, cz + 3.6, 4.8, 5.5, mat(Layer.Plaster2, brand, 3), SIGN, canopy);
  for (const px of [-cw / 2 + 1.6, cw / 2 - 1.6]) {
    g.box(px - 0.2, cz - 0.2, px + 0.2, cz + 0.2, 0, 4.8, canopy);
    g.box(px - 1.5, cz - 0.55, px + 1.5, cz + 0.55, 0, 0.18, CONCRETE);
    for (const ox of [-0.85, 0.85]) g.box(px + ox - 0.28, cz - 0.3, px + ox + 0.28, cz + 0.3, 0.18, 1.75, mat(Layer.Plaster2, [1.25, 1.25, 1.2], 2), NO_WIN, mat(Layer.Plaster2, brand, 2));
  }
  // Kiosk at the back.
  const kz0 = -D / 2 + 0.8;
  const kz1 = Math.min(kz0 + 6, cz - 5);
  const kw = Math.min(W - 3, 10);
  const wall = mat(Layer.Plaster2, [1.2, 1.2, 1.16], 3);
  g.walls(-kw / 2, kz0, kw / 2, kz1, 0, 3.6, wall, [NO_WIN, NO_WIN, win(Style.Storefront, fitBay(kw, 3.3), 3.6, 0.5), NO_WIN]);
  flatRoof(g, -kw / 2, kz0, kw / 2, kz1, 3.6, wall, roofFinish(r), 0.6);
  signBand(l, -kw / 2 + 0.4, kw / 2 - 0.4, kz1, 2.85, 3.5, brand);
  // Price totem.
  const sx = W / 2 - 1.4;
  g.box(sx - 0.7, D / 2 - 1.4, sx + 0.7, D / 2 - 1.1, 0, 5.6, mat(Layer.Plaster2, brand, 3), SIGN);
  g.flat(-W / 2 + 0.3, D / 2 - 0.5, W / 2 - 0.3, D / 2 - 0.38, 0.035, LINE_WHITE);
}

const OFFICE_WALLS: ReadonlyArray<[Layer, RGB]> = [
  [Layer.ConcreteWall, [1.15, 1.14, 1.1]],
  [Layer.Brick, [1.4, 1.26, 1.18]],
  [Layer.Brick2, [1.48, 1.42, 1.34]],
  [Layer.Plaster2, [1.2, 1.18, 1.12]],
  [Layer.Plaster, [1.05, 1.1, 1.16]],
  [Layer.Brick, [0.95, 0.94, 0.96]],
];

/** Mid-rise mixed-use block: shops at street level, offices above. */
function midrise(l: Lot): void {
  const { g, r, W, D } = l;
  ground(l, PAVING);
  const gh = 4.4;
  const fh = 3.4;
  const floors = 2 + l.level + r.int(2);
  const top = gh + floors * fh;
  const z1 = D / 2 - 0.8;
  const z0 = -D / 2 + (D > 22 ? 7.5 : 1.5);
  const x0 = -W / 2 + 0.8;
  const x1 = W / 2 - 0.8;
  const [wl, wt] = pick(r, OFFICE_WALLS);
  const wall = mat(wl, vary(r, wt), wl <= Layer.Brick2 ? 2 : 3);
  const brand = pick(r, BRAND);
  const shop = win(Style.Storefront, fitBay(x1 - x0, 4.2), gh, 0.5);
  const sideShop = win(Style.Storefront, fitBay(z1 - z0, 4.2), gh, 0.5);
  g.walls(x0, z0, x1, z1, 0, gh, mat(Layer.ConcreteWall, [0.85, 0.85, 0.86], 3), [NO_WIN, sideShop, shop, sideShop]);
  const style = r.chance(0.55) ? Style.Ribbon : Style.Punched;
  const wf = win(style, fitBay(x1 - x0, style === Style.Ribbon ? 3.6 : 2.8), fh, r.range(0.5, 0.62));
  const ws = win(style, fitBay(z1 - z0, style === Style.Ribbon ? 3.6 : 2.8), fh, 0.52);
  g.walls(x0, z0, x1, z1, gh, top, wall, [wf, ws, wf, ws]);
  // String course above the shops and a cornice at the top.
  g.box(x0 - 0.12, z1, x1 + 0.12, z1 + 0.2, gh - 0.1, gh + 0.25, CONCRETE);
  g.box(x0 - 0.15, z1, x1 + 0.15, z1 + 0.3, top - 0.1, top + 0.3, CONCRETE);
  flatRoof(g, x0, z0, x1, z1, top, wall, roofFinish(r), 0.9);
  rooftop(l, x0, z0, x1, z1, top, wall);
  const units = Math.max(1, Math.round((x1 - x0) / 9));
  for (let i = 0; i < units; i++) {
    const ux0 = x0 + ((x1 - x0) * i) / units + 0.5;
    const ux1 = x0 + ((x1 - x0) * (i + 1)) / units - 0.5;
    const c = r.chance(0.5) ? brand : pick(r, BRAND);
    signBand(l, ux0, ux1, z1, gh - 0.95, gh - 0.2, c);
    if (r.chance(0.5)) awning(g, ux0, ux1, z1 + 0.2, gh - 1.0, 1.4, c);
  }
  // Rooftop billboard on some.
  if (r.chance(0.35)) {
    const bw = Math.min(9, (x1 - x0) * 0.6);
    for (const px of [-bw / 2 + 0.6, bw / 2 - 0.6]) g.box(px - 0.1, z1 - 1.6, px + 0.1, z1 - 1.4, top, top + 4.6, STEEL_DARK);
    g.box(-bw / 2, z1 - 1.75, bw / 2, z1 - 1.5, top + 1.6, top + 4.8, mat(Layer.Plaster2, pick(r, BRAND), 3), SIGN);
  }
  if (z0 - -D / 2 > 5.5) parking(g, -W / 2 + 0.5, -D / 2 + 0.5, W / 2 - 0.5, z0 - 0.6);
}

/** Glass colours for curtain walls: the tint of the reflection. */
const GLASS: readonly RGB[] = [
  [0.4, 0.55, 0.68],
  [0.34, 0.5, 0.5],
  [0.52, 0.6, 0.66],
  [0.6, 0.5, 0.38],
  [0.3, 0.38, 0.5],
  [0.44, 0.58, 0.52],
  [0.56, 0.58, 0.6],
];

/** Office tower: podium, curtain-wall shaft with setbacks, and a crown. */
function officeTower(l: Lot): void {
  const { g, r, W, D } = l;
  ground(l, PAVING);
  const fh = 3.8;
  const total = 10 + l.level * 6 + r.int(6);
  const glass = pick(r, GLASS);
  const curtain = mat(Layer.ConcreteWall, glass, 3);
  const frame: Mat = r.chance(0.5) ? mat(Layer.ConcreteWall, [1.2, 1.2, 1.18], 3) : mat(Layer.Concrete, [0.5, 0.52, 0.55], 3);
  const stone = mat(Layer.ConcreteWall, vary(r, [1.1, 1.08, 1.04]), 3);

  let x0 = -W / 2 + 1.4;
  let x1 = W / 2 - 1.4;
  let z1 = D / 2 - 2.4;
  let z0 = -D / 2 + 1.6;

  // Podium: two tall floors with shopfront glazing.
  const ph = 9;
  const pw = win(Style.Storefront, fitBay(x1 - x0, 4.6), ph / 2, 0.5);
  const pd = win(Style.Storefront, fitBay(z1 - z0, 4.6), ph / 2, 0.5);
  g.walls(x0, z0, x1, z1, 0, ph, stone, [pd, pd, pw, pd]);
  flatRoof(g, x0, z0, x1, z1, ph, stone, PAVING, 1.0);
  // Entrance canopy.
  g.box(-3, z1, 3, z1 + 2.2, 4.2, 4.5, frame);

  // Shaft in one to three tiers, each stepping in.
  const tiers = 1 + (total > 18 ? 1 : 0) + (total > 26 && r.chance(0.6) ? 1 : 0);
  let y = ph;
  let left = total;
  const piers = r.chance(0.5);
  for (let t = 0; t < tiers; t++) {
    const inset = t === 0 ? r.range(1.2, 2.4) : r.range(1.4, 2.6);
    x0 += inset;
    x1 -= inset;
    z0 += inset * 0.9;
    z1 -= inset * 0.9;
    if (x1 - x0 < 8 || z1 - z0 < 8) break;
    const n = t === tiers - 1 ? left : Math.max(4, Math.round(left * r.range(0.5, 0.65)));
    left -= n;
    const top = y + n * fh;
    const wf = win(Style.Curtain, fitBay(x1 - x0, 1.9), fh, 0.5);
    const ws = win(Style.Curtain, fitBay(z1 - z0, 1.9), fh, 0.5);
    g.walls(x0, z0, x1, z1, y, top, curtain, [wf, ws, wf, ws]);
    if (piers) {
      // Solid corner piers frame the glass.
      for (const [cx, cz] of [[x0, z0], [x1, z0], [x1, z1], [x0, z1]] as const) g.box(cx - 0.45, cz - 0.45, cx + 0.45, cz + 0.45, y, top + 0.6, frame);
    }
    flatRoof(g, x0, z0, x1, z1, top, frame, roofFinish(r), 1.1);
    y = top;
  }
  // Crown: plant enclosure, then a mast or a lit sign.
  const cx = (x0 + x1) / 2;
  const cz = (z0 + z1) / 2;
  const cw = (x1 - x0) * 0.55;
  const cd = (z1 - z0) * 0.55;
  g.box(cx - cw / 2, cz - cd / 2, cx + cw / 2, cz + cd / 2, y, y + 4.2, frame, NO_WIN, GRAVEL_ROOF);
  rooftop(l, x0, z0, x1, z1, y, frame);
  if (r.chance(0.55)) {
    g.cyl(cx, cz, 0.22, 0.05, y + 4.2, y + 4.2 + r.range(8, 16), 6, METAL_GREY);
  } else {
    g.box(cx - cw / 2 + 0.3, cz + cd / 2, cx + cw / 2 - 0.3, cz + cd / 2 + 0.2, y + 1.2, y + 3.6, mat(Layer.Plaster2, pick(r, BRAND), 3), SIGN);
  }
  // Plaza: planters and trees along the street.
  for (const sx of [-W / 2 + 2.2, W / 2 - 2.2]) {
    g.box(sx - 1, D / 2 - 2.1, sx + 1, D / 2 - 0.5, 0, 0.45, CONCRETE, NO_WIN, LAWN);
    g.tree(sx, D / 2 - 1.3, 0.5, r.next() * 6);
  }
  shrub(g, -4.2, D / 2 - 1.2, 0.5);
  shrub(g, 4.2, D / 2 - 1.2, 0.5);
}

export function commercial(l: Lot): void {
  const { r, W, D } = l;
  if (l.density === 1) {
    if (W >= 16 && D >= 16 && r.chance(0.06)) gasStation(l);
    else if (W >= 24 && D >= 16 && r.chance(0.5)) stripMall(l);
    else shops(l);
  } else if (l.density === 2) {
    if (W < 12 || D < 14) shops(l);
    else midrise(l);
  } else if (W < 20 || D < 20) midrise(l);
  else officeTower(l);
}
