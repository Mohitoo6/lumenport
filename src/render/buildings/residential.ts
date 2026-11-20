import { clamp } from '../../core/math';
import {
  CONCRETE,
  CONCRETE_DARK,
  GRAVEL_ROOF,
  IRON_DARK,
  LAWN,
  Layer,
  NO_WIN,
  PAVING,
  SANDSTONE,
  STEEL_DARK,
  Style,
  TERRACOTTA,
  WHITE_TRIM,
  balcony,
  chhajja,
  compoundWall,
  door,
  fence,
  flatRoof,
  frontPanel,
  ground,
  hedge,
  indianRooftop,
  mat,
  parking,
  pick,
  roofFinish,
  rooftop,
  shrub,
  vary,
  waterTank,
  win,
  type BalconyStyle,
  type Lot,
  type Mat,
  type RGB,
} from './common';
import { fitBay } from './geo';

/** Colourful Indian plaster, pastel, and warm brick finishes for independent homes. */
const HOUSE_WALLS: ReadonlyArray<[Layer, RGB]> = [
  [Layer.Plaster2, [1.28, 1.24, 1.15]], // ivory / lime white
  [Layer.Plaster2, [1.28, 1.15, 0.86]], // warm cream / butter
  [Layer.Plaster2, [1.3, 1.08, 0.66]], // turmeric yellow
  [Layer.Plaster2, [1.34, 0.96, 0.78]], // peach / terracotta pastel
  [Layer.Plaster, [0.96, 1.22, 1.02]], // pistachio / mint green
  [Layer.Plaster, [0.92, 1.14, 1.34]], // powder / sky blue
  [Layer.Plaster2, [1.26, 0.94, 0.98]], // soft rose / Jaipur pink
  [Layer.Plaster, [1.24, 1.08, 0.88]], // warm sandstone ochre
  [Layer.Brick, [1.45, 1.26, 1.14]], // red brick
  [Layer.Brick2, [1.5, 1.4, 1.3]], // buff brick
];

/** Contrasting accent bands, parapets, and feature walls. */
const ACCENT_TINTS: readonly RGB[] = [
  [0.98, 0.56, 0.4], // terracotta
  [0.64, 0.5, 0.38], // warm coffee brown
  [0.48, 0.56, 0.66], // slate blue-grey
  [0.74, 0.68, 0.58], // warm taupe
  [0.44, 0.66, 0.56], // muted teal-sage
  [0.86, 0.64, 0.36], // ochre gold
];

const HOUSE_ROOFS: ReadonlyArray<[Layer, RGB]> = [
  [Layer.Roof2, [1.15, 0.78, 0.62]], // Mangalore clay tile
  [Layer.Roof2, [0.92, 0.72, 0.62]], // weathered clay
  [Layer.Roof3, [0.58, 0.6, 0.65]], // slate
  [Layer.Roof, [1.08, 0.94, 0.86]], // warm brown tile
  [Layer.Roof3, [0.78, 0.78, 0.76]], // grey tile
];

const DOOR_TINTS: readonly RGB[] = [
  [0.48, 0.28, 0.14], // polished teak
  [0.36, 0.2, 0.11], // dark rosewood
  [0.68, 0.16, 0.12], // vermilion
  [0.14, 0.32, 0.48], // deep blue
  [0.16, 0.4, 0.24], // heritage green
  [0.24, 0.24, 0.26], // charcoal
];

const FLOWER_SHRUBS: readonly RGB[] = [
  [0.44, 0.68, 0.32], // foliage green
  [0.52, 0.72, 0.3], // bright lime-green
  [0.92, 0.3, 0.55], // bougainvillea magenta
  [0.95, 0.56, 0.22], // marigold / hibiscus orange
];

/** Adds sunshades (chhajjas) aligned above procedural Punched windows on a front or side wall. */
function wallChhajjas(
  l: Lot,
  a0: number,
  a1: number,
  fixedCoord: number,
  baseY: number,
  fh: number,
  floors: number,
  bay: number,
  continuous: boolean,
  trim: Mat,
  side: 'front' | 'left' | 'right',
): void {
  const { g } = l;
  const len = a1 - a0;
  if (len < 1.5) return;
  for (let f = 0; f < floors; f++) {
    const cy = baseY + (f + 0.8) * fh;
    if (continuous) {
      chhajja(g, a0 + 0.12, a1 - 0.12, fixedCoord, cy, 0.46, trim, side);
    } else {
      const n = Math.max(1, Math.round(len / bay));
      const b = len / n;
      for (let i = 0; i < n; i++) {
        const w0 = a0 + i * b + b * 0.18;
        const w1 = a0 + (i + 1) * b - b * 0.18;
        if (w1 - w0 > 0.5) chhajja(g, w0, w1, fixedCoord, cy, 0.44, trim, side);
      }
    }
  }
}

/**
 * Independent Indian house or bungalow: mixes flat-roof terrace homes (with mumty stair
 * towers, overhead water tanks, chhajjas and balconies) and Mangalore-tile pitched-roof
 * bungalows, set inside a compound wall with gate and garden.
 */
export function house(l: Lot): void {
  const { g, r, W, D } = l;
  ground(l, mat(Layer.Grass, vary(r, LAWN.tint, 0.1), 5));

  const narrow = W < 12;
  const compact = D < 12;
  const flatStyle = r.chance(0.58);
  const modernVilla = flatStyle && l.level >= 2 && !narrow && r.chance(0.32);
  const floors = l.level >= 2 || r.chance(0.35) ? 2 : 1;
  const fh = 2.95;
  const plinth = 0.45;
  const top = plinth + floors * fh;

  const hasCarport = !narrow && !compact && r.chance(0.68);
  const cw = hasCarport ? 3.5 : 0;
  const side = r.chance(0.5) ? 1 : -1;

  const bw = clamp((narrow ? 5.2 : r.range(7.6, 9.8)) + (l.level - 1) * 0.85, 4.4, Math.max(4.4, W - 2.6 - cw));
  const bd = clamp(r.range(6.4, 8.4) + (l.level - 1) * 0.7, 4.8, Math.max(4.8, D - 5.6));
  const frontSetback = clamp(r.range(3.2, 4.8), 2.4, Math.max(2.4, D - bd - 1.4));
  const z1 = D / 2 - frontSetback;
  const z0 = z1 - bd;
  const cx = hasCarport ? (-side * cw) * 0.46 : r.range(-0.35, 0.35);
  const x0 = clamp(cx - bw / 2, -W / 2 + 1.1, W / 2 - 1.1 - bw);
  const x1 = x0 + bw;

  const [wl, wt] = pick(r, HOUSE_WALLS);
  const wall = mat(wl, vary(r, wt), wl <= Layer.Brick2 ? 2 : 3);
  const accent = mat(Layer.Plaster2, vary(r, pick(r, ACCENT_TINTS), 0.06), 3);
  const trim = r.chance(0.75) ? WHITE_TRIM : SANDSTONE;
  const [rl, rt] = pick(r, HOUSE_ROOFS);
  const roof = mat(rl, vary(r, rt), 2.3);
  const doorTint = pick(r, DOOR_TINTS);

  // Plinth and main walls.
  g.walls(x0, z0, x1, z1, 0, plinth, CONCRETE_DARK);
  const frontBay = fitBay(bw, 2.7);
  const sideBay = fitBay(bd, 3.1);
  const wf = win(Style.Punched, frontBay, fh, r.range(0.42, 0.52));
  const ws = win(Style.Punched, sideBay, fh, 0.38);

  if (modernVilla && floors === 2) {
    // Ground floor in main colour, cantilevered upper box in crisp white/accent.
    const y1 = plinth + fh;
    g.walls(x0, z0, x1, z1, plinth, y1, wall, [wf, ws, wf, ws]);
    const ux0 = Math.max(-W / 2 + 0.9, x0 - 0.35);
    const ux1 = Math.min(W / 2 - 0.9, x1 + 0.35);
    const uz1 = z1 + 0.55;
    g.walls(ux0, z0, ux1, uz1, y1, top, WHITE_TRIM, [wf, ws, win(Style.Ribbon, fitBay(ux1 - ux0, 2.8), fh, 0.55), ws]);
    // Accent vertical fin on the facade.
    const fx = side > 0 ? ux0 + 0.6 : ux1 - 1.4;
    g.box(fx, uz1, fx + 0.85, uz1 + 0.25, plinth, top + 0.9, accent);
    flatRoof(g, ux0, z0, ux1, uz1, top, WHITE_TRIM, roofFinish(r), 0.85);
    indianRooftop(l, ux0, z0, ux1, uz1, top, WHITE_TRIM, accent, 1);
  } else {
    g.walls(x0, z0, x1, z1, plinth, top, wall, [wf, ws, wf, ws]);

    // Contrasting floor-slab band on 2-storey houses.
    if (floors === 2) {
      g.box(x0 - 0.08, z0 - 0.08, x1 + 0.08, z1 + 0.08, plinth + fh - 0.14, plinth + fh + 0.06, trim);
    }

    if (flatStyle) {
      const parapetH = r.range(0.75, 0.98);
      flatRoof(g, x0, z0, x1, z1, top, wall, roofFinish(r), parapetH);
      // Decorative front parapet coping / accent band.
      g.box(x0 - 0.06, z1 - 0.04, x1 + 0.06, z1 + 0.14, top + parapetH - 0.22, top + parapetH + 0.05, accent);
      indianRooftop(l, x0, z0, x1, z1, top, wall, trim, floors);
    } else {
      const alongX = bw >= bd ? r.chance(0.75) : r.chance(0.3);
      const span = alongX ? bd : bw;
      const rise = (span / 2) * r.range(0.48, 0.68);
      if (r.chance(0.45)) g.hip(x0, z0, x1, z1, top, rise * 0.88, 0.52, roof);
      else g.gable(x0, z0, x1, z1, top, rise, alongX, 0.52, roof, wall);
      // Small overhead water tank tucked on a side roof-ledge or rear stand on pitched homes.
      if (z0 > -D / 2 + 2.2) {
        waterTank(g, x0 + 0.9, z0 - 0.85, 0, r, 0.78, true);
      }
    }

    // Sunshades (chhajjas) over windows.
    wallChhajjas(l, x0, x1, z1, plinth, fh, floors, frontBay, flatStyle && r.chance(0.5), trim, 'front');
    if (bw > 6.5) {
      wallChhajjas(l, z0, z1, x1, plinth, fh, floors, sideBay, false, trim, 'right');
      wallChhajjas(l, z0, z1, x0, plinth, fh, floors, sideBay, false, trim, 'left');
    }
  }

  // Front verandah / porch with columns or arches, plus upper-floor balcony on 2-storey homes.
  const doorX = clamp((x0 + x1) * 0.5 + (hasCarport ? -side * 1.1 : r.range(-1.1, 1.1)), x0 + 1.3, x1 - 1.3);
  const porchW = clamp(bw * 0.48, 2.4, 4.4);
  const px0 = clamp(doorX - porchW / 2, x0 + 0.15, x1 - porchW - 0.15);
  const px1 = px0 + porchW;
  const porchD = clamp(1.55, 1.2, Math.max(1.2, D / 2 - z1 - 1.3));
  const pz1 = z1 + porchD;
  const porchTop = plinth + fh - 0.18;

  // Raised sit-out platform + steps.
  g.box(px0, z1, px1, pz1, 0, plinth, CONCRETE);
  g.stair(doorX - 0.8, pz1, doorX + 0.8, Math.min(D / 2 - 0.45, pz1 + 0.75), 0, plinth, 3, CONCRETE);
  door(g, doorX, z1, plinth, doorTint);

  const archedPorch = !modernVilla && porchW >= 2.8 && r.chance(0.45);
  if (archedPorch) {
    g.arch((px0 + px1) * 0.5, pz1, porchW, plinth, porchTop - 0.85, 0.65, 0.34, trim, 0.3, 0.2);
    g.box(px0 - 0.12, z1, px1 + 0.12, pz1 + 0.12, porchTop, porchTop + 0.18, trim, NO_WIN, flatStyle ? GRAVEL_ROOF : roof);
  } else {
    for (const colX of [px0 + 0.12, px1 - 0.12]) {
      g.box(colX - 0.11, pz1 - 0.24, colX + 0.11, pz1 - 0.02, plinth, porchTop, trim);
    }
    if (!flatStyle && floors === 1) {
      // Sloping Mangalore-tile verandah roof.
      g.poly(
        [
          [px0 - 0.18, porchTop + 0.55, z1],
          [px1 + 0.18, porchTop + 0.55, z1],
          [px1 + 0.18, porchTop - 0.05, pz1 + 0.22],
          [px0 - 0.18, porchTop - 0.05, pz1 + 0.22],
        ],
        roof,
      );
    } else {
      g.box(px0 - 0.14, z1, px1 + 0.14, pz1 + 0.14, porchTop, porchTop + 0.18, trim);
    }
  }

  // Upper-floor balcony over the porch (or cantilevered on 2-storey homes).
  if (floors === 2 && !modernVilla) {
    const bStyle: BalconyStyle = flatStyle ? (r.chance(0.5) ? 'parapet-rail' : 'railing') : 'railing';
    balcony(g, px0, px1, z1, plinth + fh, porchD, trim, IRON_DARK, bStyle, 'front');
  } else if (modernVilla && floors === 2) {
    balcony(g, px0, px1, z1 + 0.55, plinth + fh, 1.1, WHITE_TRIM, IRON_DARK, 'glass', 'front');
  }

  // Covered carport / portico or paved drive beside the house.
  let gateX = doorX;
  if (hasCarport) {
    const gx0 = side > 0 ? x1 : x0 - cw;
    const gx1 = gx0 + cw;
    const gz1 = z1 - 0.2;
    const gz0 = Math.max(-D / 2 + 1.1, gz1 - 5.2);
    if (gx0 > -W / 2 + 0.5 && gx1 < W / 2 - 0.5) {
      const ch = 2.75;
      // Open-sided RCC carport with slim columns.
      for (const colZ of [gz0 + 0.25, gz1 - 0.25]) {
        const colX = side > 0 ? gx1 - 0.18 : gx0 + 0.18;
        g.box(colX - 0.12, colZ - 0.12, colX + 0.12, colZ + 0.12, 0, ch, trim);
      }
      g.box(gx0, gz0, gx1, gz1 + 0.2, ch, ch + 0.18, trim, NO_WIN, flatStyle ? GRAVEL_ROOF : TERRACOTTA);
      // Paved driveway straight to the gate.
      g.flat(gx0 + 0.2, gz0, gx1 - 0.2, D / 2 - 0.1, 0.035, PAVING);
      gateX = (gx0 + gx1) * 0.5;
    }
  } else {
    // Pedestrian path from front steps to the gate.
    g.flat(doorX - 0.65, pz1 + 0.65, doorX + 0.65, D / 2 - 0.1, 0.035, PAVING);
  }

  // Front courtyard paving strip.
  g.flat(x0 - 0.3, z1, x1 + 0.3, Math.min(D / 2 - 0.5, pz1 + 0.8), 0.03, PAVING);

  // Boundary: Indian compound wall with gate (~80%) or hedge/fence (~20%).
  const hx = W / 2 - 0.3;
  const hz = D / 2 - 0.3;
  if (r.chance(0.82)) {
    const cwMat = r.chance(0.55) ? wall : WHITE_TRIM;
    const gateW = hasCarport ? Math.min(3.4, W * 0.34) : Math.min(2.0, W * 0.28);
    compoundWall(g, -hx, -hz, hx, hz, r.range(1.25, 1.55), cwMat, trim, {
      cx: clamp(gateX, -hx + gateW * 0.5 + 0.7, hx - gateW * 0.5 - 0.7),
      w: gateW,
      gateMat: IRON_DARK,
      overhead: l.level >= 3 && !narrow && r.chance(0.35),
    });
  } else {
    hedge(g, -hx - 0.2, -hz - 0.2, hx + 0.2, -hz + 0.2, r.range(1.1, 1.5));
    hedge(g, -hx - 0.2, -hz, -hx + 0.2, z1, 1.15);
    hedge(g, hx - 0.2, -hz, hx + 0.2, z1, 1.15);
  }

  // Garden planting: flowering shrubs & shade trees.
  const nShrubs = 2 + r.int(3);
  for (let i = 0; i < nShrubs; i++) {
    const sx = r.range(x0, x1);
    if (Math.abs(sx - doorX) < 1.5) continue;
    shrub(g, sx, Math.min(hz - 0.6, z1 + 0.65), r.range(0.42, 0.7), pick(r, FLOWER_SHRUBS));
  }
  if (z0 - -D / 2 > 4.2 && r.chance(0.75)) {
    g.tree(r.range(-hx + 2.2, hx - 2.2), (z0 - D / 2) / 2, r.range(0.52, 0.8), r.next() * 6);
  }
  if (!narrow && r.chance(0.45)) {
    const tx = side > 0 ? -hx + 1.9 : hx - 1.9;
    if (Math.abs(tx - gateX) > 2.2) g.tree(tx, D / 2 - 2.2, r.range(0.4, 0.55), r.next() * 6);
  }
}

const TERRACE_WALLS: ReadonlyArray<[Layer, RGB]> = [
  [Layer.Plaster2, [1.26, 1.18, 0.96]], // cream
  [Layer.Plaster2, [1.3, 1.0, 0.82]], // warm peach
  [Layer.Plaster, [0.96, 1.18, 1.04]], // mint
  [Layer.Plaster, [0.94, 1.12, 1.28]], // sky blue
  [Layer.Plaster2, [1.28, 1.14, 0.74]], // ochre yellow
  [Layer.Brick, [1.46, 1.26, 1.14]], // red brick
  [Layer.Brick2, [1.5, 1.4, 1.3]], // buff brick
];

/** Row houses / urban terrace: colourful narrow units with chhajjas, balconies, and roof tanks. */
function terrace(l: Lot): void {
  const { g, r, W, D } = l;
  ground(l, PAVING);
  const n = Math.max(1, Math.floor((W - 1) / 5.8));
  const uw = (W - 1) / n;
  const z1 = D / 2 - 2.8;
  const depth = clamp(r.range(8.8, 11.2), 6.4, Math.max(6.4, D - 6.0));
  const z0 = z1 - depth;
  const fh = 3.0;
  const baseFloors = 2 + (l.level >= 2 ? 1 : 0);

  // Rear lawn strip.
  if (z0 > -D / 2 + 1.5) {
    g.flat(-W / 2 + 0.3, -D / 2 + 0.3, W / 2 - 0.3, z0, 0.03, LAWN);
  }

  for (let i = 0; i < n; i++) {
    const x0 = -W / 2 + 0.5 + i * uw;
    const x1 = x0 + uw;
    const floors = baseFloors + (l.level >= 3 && r.chance(0.5) ? 1 : 0);
    const plinth = 0.55;
    const top = plinth + floors * fh;
    const [wl, wt] = pick(r, TERRACE_WALLS);
    const wall = mat(wl, vary(r, wt), wl <= Layer.Brick2 ? 2 : 3);
    const wn = win(Style.Punched, uw / 2, fh, r.range(0.44, 0.54));

    g.walls(x0, z0, x1, z1, 0, plinth, CONCRETE_DARK);
    g.walls(x0, z0, x1, z1, plinth, top, wall, [wn, NO_WIN, wn, NO_WIN]);

    // Chhajjas over windows on ground/upper floors and a compact balcony on the first floor.
    wallChhajjas(l, x0 + 0.2, x1 - 0.2, z1, plinth, fh, floors, uw / 2, true, WHITE_TRIM, 'front');
    if (floors >= 2) {
      balcony(g, x0 + 0.4, x1 - 0.4, z1, plinth + fh, 0.95, WHITE_TRIM, IRON_DARK, 'parapet-rail', 'front');
    }

    if (r.chance(0.32)) {
      const [rl, rt] = pick(r, HOUSE_ROOFS);
      g.gable(x0, z0, x1, z1, top, 1.85, true, 0.28, mat(rl, rt, 2.3), wall);
    } else {
      flatRoof(g, x0, z0, x1, z1, top, wall, roofFinish(r), 0.78);
      g.box(x0 - 0.02, z1, x1 + 0.02, z1 + 0.18, top + 0.45, top + 0.78, WHITE_TRIM);
      waterTank(g, (x0 + x1) * 0.5, z0 + 1.4, top, r, 0.82, true);
    }

    // Entry steps and door.
    const dx = x0 + uw * (r.chance(0.5) ? 0.3 : 0.7);
    g.stair(dx - 0.65, z1, dx + 0.65, z1 + 1.15, 0, plinth, 3, CONCRETE);
    door(g, dx, z1, plinth, pick(r, DOOR_TINTS));
    if (r.chance(0.55)) {
      shrub(g, x0 + uw * (dx > x0 + uw / 2 ? 0.24 : 0.76), z1 + 0.7, 0.48, pick(r, FLOWER_SHRUBS));
    }

    // Low front boundary divider between units.
    if (i > 0) {
      g.box(x0 - 0.09, z1 + 0.1, x0 + 0.09, D / 2 - 0.3, 0, 1.05, WHITE_TRIM);
      fence(g, x0, -D / 2 + 0.3, x0, z0, 1.5);
    }
  }
  fence(g, -W / 2 + 0.3, -D / 2 + 0.3, W / 2 - 0.3, -D / 2 + 0.3, 1.5);
  if (z0 - -D / 2 > 3.5 && r.chance(0.65)) {
    g.tree(r.range(-W / 2 + 2.5, W / 2 - 2.5), (z0 - D / 2) / 2, 0.58, r.next() * 6);
  }
}

const BUILDER_WALLS: ReadonlyArray<[Layer, RGB]> = [
  [Layer.Plaster2, [1.26, 1.22, 1.12]], // warm off-white
  [Layer.Plaster2, [1.26, 1.16, 0.94]], // cream beige
  [Layer.Plaster, [1.3, 1.06, 0.88]], // warm apricot / terracotta tint
  [Layer.Plaster, [1.0, 1.16, 1.06]], // soft sage
  [Layer.Plaster, [0.98, 1.1, 1.24]], // cool slate pastel
  [Layer.Brick2, [1.48, 1.4, 1.3]], // buff brick
  [Layer.Brick, [1.42, 1.24, 1.14]], // warm brick
  [Layer.ConcreteWall, [1.18, 1.16, 1.12]], // architectural concrete
];

/**
 * Indian 3-to-5 storey builder floor / walk-up apartment: optional stilt parking on the
 * ground floor, colourful two-tone plaster, stacked balconies with railings, chhajjas,
 * compound wall with gate, mumty stair tower and clustered rooftop water tanks.
 */
function builderFloor(l: Lot): void {
  const { g, r, W, D } = l;
  ground(l, PAVING);

  const stilt = r.chance(0.68);
  const resFloors = 3 + (l.level >= 2 ? 1 : 0) + (l.level >= 3 && r.chance(0.55) ? 1 : 0);
  const fh = 3.0;
  const stiltH = stilt ? 2.85 : 0.55;
  const top = stiltH + resFloors * fh;

  const frontGap = clamp(r.range(2.6, 3.8), 2.0, Math.max(2.0, D * 0.25));
  const z1 = D / 2 - frontGap;
  const backSpace = D > 20 ? 7.5 : 1.6;
  const z0 = Math.min(z1 - 7.0, -D / 2 + backSpace);
  const x0 = -W / 2 + 1.3;
  const x1 = W / 2 - 1.3;
  const bw = x1 - x0;
  const bd = z1 - z0;

  const [wl, wt] = pick(r, BUILDER_WALLS);
  const wall = mat(wl, vary(r, wt), wl <= Layer.Brick2 ? 2 : 3);
  const accent = mat(Layer.Plaster2, vary(r, pick(r, ACCENT_TINTS), 0.06), 3);
  const trim = WHITE_TRIM;

  if (stilt) {
    // Recessed dark lobby & stilt parking columns.
    g.flat(x0, z0, x1, z1, 0.04, CONCRETE_DARK);
    const coreW = Math.min(3.4, bw * 0.32);
    g.walls(-coreW / 2, z0 + 0.6, coreW / 2, z1 - 2.2, 0, stiltH, CONCRETE_DARK);
    frontPanel(g, 0, z1 - 2.2, Math.min(2.2, coreW * 0.7), 0.05, 2.35, mat(Layer.Concrete, [0.5, 0.52, 0.55], 2), win(Style.Storefront, 2.0, 2.3, 0.5));
    const colsX = Math.max(2, Math.round(bw / 4.2) + 1);
    for (let i = 0; i < colsX; i++) {
      const px = x0 + 0.25 + ((bw - 0.5) * i) / (colsX - 1);
      g.box(px - 0.2, z1 - 0.42, px + 0.2, z1 - 0.02, 0, stiltH, CONCRETE);
      g.box(px - 0.2, z0 + 0.02, px + 0.2, z0 + 0.42, 0, stiltH, CONCRETE);
    }
    // Stilt ceiling slab band.
    g.box(x0 - 0.1, z0 - 0.1, x1 + 0.1, z1 + 0.1, stiltH - 0.22, stiltH, trim);
  } else {
    g.walls(x0, z0, x1, z1, 0, stiltH, CONCRETE_DARK);
  }

  // Residential floors.
  const frontBay = fitBay(bw, 2.8);
  const sideBay = fitBay(bd, 3.1);
  const wf = win(Style.Punched, frontBay, fh, r.range(0.46, 0.56));
  const ws = win(Style.Punched, sideBay, fh, 0.42);
  g.walls(x0, z0, x1, z1, stiltH, top, wall, [wf, ws, wf, ws]);

  // Vertical accent feature strip (stairwell / facade frame).
  const sx = r.chance(0.5) ? x0 + bw * 0.5 : sidePos(x0, x1, r.chance(0.5) ? 0.22 : 0.78);
  g.box(sx - 1.15, z1, sx + 1.15, z1 + 0.24, stiltH, top + 0.95, accent, win(Style.Punched, 2.3, fh, 0.34));

  // Projecting balconies with railings on the front, split cleanly around the accent strip.
  const bStyle: BalconyStyle = l.level >= 3 && r.chance(0.45) ? 'glass' : 'parapet-rail';
  const railMat = IRON_DARK;
  const leftSpan = sx - 1.35 - x0;
  const rightSpan = x1 - (sx + 1.35);
  const bStart = stilt ? 0 : 1;
  for (let f = bStart; f < resFloors; f++) {
    const y = stiltH + f * fh;
    if (leftSpan > 2.4) {
      balcony(g, x0 + 0.3, sx - 1.4, z1, y, 1.15, trim, railMat, bStyle, 'front');
    }
    if (rightSpan > 2.4) {
      balcony(g, sx + 1.4, x1 - 0.3, z1, y, 1.15, trim, railMat, bStyle, 'front');
    }
  }

  // Chhajjas on side windows (and ground floor front if not stilted).
  wallChhajjas(l, z0, z1, x1, stiltH, fh, resFloors, sideBay, true, trim, 'right');
  wallChhajjas(l, z0, z1, x0, stiltH, fh, resFloors, sideBay, true, trim, 'left');
  if (!stilt) {
    wallChhajjas(l, x0, x1, z1, stiltH, fh, 1, frontBay, true, trim, 'front');
  }

  // Flat terrace roof, parapet, mumty stair tower, and 2-4 Sintex tanks.
  flatRoof(g, x0, z0, x1, z1, top, wall, roofFinish(r), 0.95);
  g.box(x0 - 0.08, z1 - 0.04, x1 + 0.08, z1 + 0.16, top + 0.65, top + 0.98, accent);
  indianRooftop(l, x0, z0, x1, z1, top, wall, trim, Math.min(4, Math.max(2, resFloors - 1)));

  // Entrance canopy when not stilted.
  if (!stilt) {
    g.box(sx - 1.5, z1, sx + 1.5, z1 + 1.5, stiltH + 2.4, stiltH + 2.62, trim);
    frontPanel(g, sx, z1, 2.0, stiltH, stiltH + 2.25, mat(Layer.Concrete, [0.5, 0.52, 0.55], 2), win(Style.Storefront, 2.0, 2.25, 0.5));
    g.stair(sx - 1.2, z1, sx + 1.2, z1 + 1.2, 0, stiltH, 3, CONCRETE);
  }

  // Perimeter compound wall with wide gate.
  const hx = W / 2 - 0.28;
  const hz = D / 2 - 0.28;
  const gateW = clamp(W * 0.28, 3.0, 4.6);
  compoundWall(g, -hx, -hz, hx, hz, 1.4, wall, trim, {
    cx: stilt ? clamp(r.chance(0.5) ? -W * 0.18 : W * 0.18, -hx + gateW * 0.5 + 0.8, hx - gateW * 0.5 - 0.8) : clamp(sx, -hx + gateW * 0.5 + 0.8, hx - gateW * 0.5 - 0.8),
    w: gateW,
    gateMat: IRON_DARK,
  });

  if (backSpace > 5.5) {
    parking(g, -W / 2 + 0.7, -D / 2 + 0.7, W / 2 - 0.7, z0 - 0.7);
  }

  // Front planters and trees inside the compound.
  shrub(g, -W / 2 + 1.6, D / 2 - 1.2, 0.52, pick(r, FLOWER_SHRUBS));
  shrub(g, W / 2 - 1.6, D / 2 - 1.2, 0.52, pick(r, FLOWER_SHRUBS));
  g.tree(-W / 2 + 2.0, D / 2 - 1.8, 0.52, r.next() * 6);
  if (W > 18) g.tree(W / 2 - 2.0, D / 2 - 1.8, 0.52, r.next() * 6);
}

function sidePos(x0: number, x1: number, t: number): number {
  return x0 + (x1 - x0) * t;
}

const TOWER_WALLS: ReadonlyArray<[Layer, RGB]> = [
  [Layer.Plaster2, [1.26, 1.24, 1.18]], // crisp ivory
  [Layer.ConcreteWall, [1.22, 1.2, 1.16]], // warm architectural grey
  [Layer.Plaster, [1.3, 1.18, 0.98]], // warm cream / sandstone
  [Layer.Plaster2, [1.18, 1.2, 1.24]], // cool off-white
  [Layer.Brick2, [1.46, 1.38, 1.28]], // buff clad
  [Layer.Plaster, [1.28, 1.08, 0.94]], // soft terracotta
];

/**
 * High-density residential tower in a gated complex: perimeter compound wall with
 * security gatehouse & entry arch, landscaped podium or stilt base, stepped tower massing
 * with glass/railing balcony stacks, vertical accent fins, and an overhead water tank +
 * lift-room crown.
 */
function tower(l: Lot): void {
  const { g, r, W, D } = l;
  ground(l, PAVING);

  const fh = 3.0;
  const floors = 8 + l.level * 3 + r.int(4); // 11..20 storeys
  const podiumH = r.chance(0.55) ? 3.8 : 0;
  const z1 = D / 2 - 4.2;
  const x0 = -W / 2 + 2.0;
  const x1 = W / 2 - 2.0;
  const z0 = -D / 2 + (D > 26 ? 7.2 : 2.4);

  const [wl, wt] = pick(r, TOWER_WALLS);
  const wall = mat(wl, vary(r, wt), wl <= Layer.Brick2 ? 2 : 3);
  const accent = mat(Layer.Plaster2, vary(r, pick(r, ACCENT_TINTS), 0.06), 3);
  const trim = WHITE_TRIM;

  // Tower footprint: wide slab with twin setback wings on wide lots, or point tower.
  const slab = W >= 22 && r.chance(0.55);
  const tx0 = slab ? x0 + 0.8 : x0 + (x1 - x0) * 0.14;
  const tx1 = slab ? x1 - 0.8 : x1 - (x1 - x0) * 0.14;
  const tz1 = z1 - (podiumH > 0 ? 1.4 : 0);
  const tz0 = slab ? Math.max(z0 + 0.4, tz1 - 12.2) : Math.max(z0 + 0.5, tz1 - (tx1 - tx0) * r.range(0.78, 1.0));
  const tw = tx1 - tx0;
  const td = tz1 - tz0;

  const base = podiumH > 0 ? podiumH : 3.2;
  const top = base + floors * fh;

  if (podiumH > 0) {
    // Clubhouse / convenience-retail podium with landscaped terrace garden on top.
    const shop = win(Style.Storefront, fitBay(x1 - x0, 4.4), podiumH, 0.5);
    const plain = win(Style.Punched, fitBay(z1 - z0, 3.4), podiumH, 0.4);
    g.walls(x0, z0, x1, z1, 0, podiumH, mat(Layer.ConcreteWall, [1.06, 1.04, 1.02], 3), [NO_WIN, plain, shop, plain]);
    flatRoof(g, x0, z0, x1, z1, podiumH, trim, LAWN, 0.9);
  } else {
    // Grand double-height lobby + stilt base with drop-off portico canopy.
    g.walls(tx0, tz0, tx1, tz1, 0, base, CONCRETE_DARK, [
      NO_WIN,
      win(Style.Punched, fitBay(td, 3.4), base, 0.4),
      win(Style.Storefront, fitBay(tw, 3.8), base, 0.55),
      win(Style.Punched, fitBay(td, 3.4), base, 0.4),
    ]);
    g.box(tx0 - 0.15, tz0 - 0.15, tx1 + 0.15, tz1 + 0.15, base - 0.25, base, trim);
  }

  // Drop-off entrance portico canopy.
  const cx = (tx0 + tx1) * 0.5;
  const czFront = podiumH > 0 ? z1 : tz1;
  g.box(cx - 2.6, czFront, cx + 2.6, czFront + 2.3, 3.1, 3.38, accent, NO_WIN, CONCRETE);
  for (const px of [cx - 2.4, cx + 2.4]) {
    g.box(px - 0.14, czFront + 2.0, px + 0.14, czFront + 2.28, 0, 3.1, trim);
  }

  // Main tower shaft.
  const style = r.chance(0.35) ? Style.Ribbon : Style.Punched;
  const wf = win(style, fitBay(tw, 3.1), fh, r.range(0.5, 0.6));
  const ws = win(style, fitBay(td, 3.1), fh, 0.48);
  g.walls(tx0, tz0, tx1, tz1, base, top, wall, [wf, ws, wf, ws]);

  // Accent vertical lift-core pier and slim corner architectural fins.
  const stairWin = win(Style.Punched, 2.5, fh, 0.34);
  g.box(cx - 1.35, tz1, cx + 1.35, tz1 + 0.36, base, top + 1.6, accent, stairWin);
  g.box(cx - 1.35, tz0 - 0.36, cx + 1.35, tz0, base, top + 1.6, accent, stairWin);
  for (const fx of [tx0 + 0.3, tx1 - 0.3]) {
    g.box(fx - 0.22, tz1, fx + 0.22, tz1 + 0.45, base, top + 1.8, accent);
  }

  // Horizontal cornice / refuge-floor band halfway up tall towers.
  if (floors >= 12) {
    const midY = base + Math.floor(floors * 0.5) * fh;
    g.box(tx0 - 0.16, tz0 - 0.16, tx1 + 0.16, tz1 + 0.16, midY - 0.14, midY + 0.14, accent);
  }

  // Balcony stacks on the front (glass balustrades keep triangle count well under budget).
  const bStyle: BalconyStyle = l.level >= 2 ? 'glass' : 'parapet-rail';
  const leftW = cx - 1.6 - (tx0 + 0.6);
  const rightW = tx1 - 0.6 - (cx + 1.6);
  const stacks: Array<[number, number]> = [];
  if (leftW >= 2.8) {
    if (leftW >= 6.4) {
      const m = tx0 + 0.6 + leftW * 0.5;
      stacks.push([tx0 + 0.6, m - 0.4], [m + 0.4, cx - 1.6]);
    } else {
      stacks.push([tx0 + 0.6, cx - 1.6]);
    }
  }
  if (rightW >= 2.8) {
    if (rightW >= 6.4) {
      const m = cx + 1.6 + rightW * 0.5;
      stacks.push([cx + 1.6, m - 0.4], [m + 0.4, tx1 - 0.6]);
    } else {
      stacks.push([cx + 1.6, tx1 - 0.6]);
    }
  }
  for (const [bx0, bx1] of stacks) {
    for (let f = 0; f < floors; f++) {
      // Stagger or skip top refuge band floor for visual rhythm on tall towers.
      if (floors >= 14 && f === Math.floor(floors * 0.5)) continue;
      balcony(g, bx0, bx1, tz1, base + f * fh, 1.15, trim, IRON_DARK, bStyle, 'front');
    }
  }

  // Roof parapet, lift machine room, overhead concrete water tank (OHT) and crown pergola.
  flatRoof(g, tx0, tz0, tx1, tz1, top, wall, roofFinish(r), 1.05);
  rooftop(l, tx0, tz0, tx1, tz1, top, wall);
  const pz = (tz0 + tz1) * 0.5;
  const cw = Math.min(5.2, tw * 0.42);
  const cd = Math.min(4.2, td * 0.42);
  // Lift machine room + raised concrete OHT slab.
  g.box(cx - cw / 2, pz - cd / 2, cx + cw / 2, pz + cd / 2, top, top + 3.2, accent, NO_WIN, GRAVEL_ROOF);
  g.box(cx - cw * 0.38, pz - cd * 0.38, cx + cw * 0.38, pz + cd * 0.38, top + 3.2, top + 5.1, trim, NO_WIN, CONCRETE);
  // Crown architectural pergola beam connecting the front fins.
  g.box(tx0 + 0.08, tz1 - 0.1, tx1 - 0.08, tz1 + 0.45, top + 1.45, top + 1.85, accent);
  if (r.chance(0.5)) {
    g.cyl(cx + cw * 0.35, pz, 0.09, 0.03, top + 5.1, top + 5.1 + r.range(4, 7), 5, STEEL_DARK);
  }

  // Gated complex perimeter: compound wall, overhead society gate arch, and security cabin.
  const hx = W / 2 - 0.28;
  const hz = D / 2 - 0.28;
  const gateW = clamp(W * 0.26, 4.0, 5.8);
  compoundWall(g, -hx, -hz, hx, hz, 1.5, wall, trim, {
    cx: 0,
    w: gateW,
    gateMat: IRON_DARK,
    overhead: true,
  });

  // Security guard cabin beside the main gate.
  const gx = gateW * 0.5 + 1.15;
  if (gx + 1.1 < hx) {
    g.walls(gx - 0.9, hz - 2.3, gx + 0.9, hz - 0.5, 0, 2.5, trim, win(Style.Storefront, 1.8, 2.2, 0.5));
    g.box(gx - 1.05, hz - 2.45, gx + 1.05, hz - 0.35, 2.5, 2.68, accent);
  }

  // Landscaped forecourt lawns, entry drive, trees, and visitor parking behind.
  g.flat(-hx + 0.5, z1 + 0.4, -gateW * 0.5 - 0.3, hz - 0.4, 0.04, LAWN);
  g.flat(gateW * 0.5 + 0.3, z1 + 0.4, hx - 0.5, hz - 0.4, 0.04, LAWN);
  g.flat(-gateW * 0.48, czFront, gateW * 0.48, D / 2, 0.05, PAVING);

  g.tree(-hx + 2.3, hz - 2.1, 0.58, r.next() * 6);
  g.tree(hx - 2.3, hz - 2.1, 0.58, r.next() * 6);
  shrub(g, -gateW * 0.5 - 1.1, hz - 1.2, 0.55, pick(r, FLOWER_SHRUBS));
  shrub(g, gateW * 0.5 + 1.1, hz - 1.2, 0.55, pick(r, FLOWER_SHRUBS));

  if (z0 - -D / 2 > 5.8) {
    parking(g, -hx + 0.5, -hz + 0.5, hx - 0.5, z0 - 0.6);
  }
}

export function residential(l: Lot): void {
  if (l.density === 1) house(l);
  else if (l.density === 2) {
    if (l.W < 12 || l.D < 14) house(l);
    else if (l.r.chance(0.35)) terrace(l);
    else builderFloor(l);
  } else if (l.W < 16 || l.D < 16) builderFloor(l);
  else tower(l);
}

