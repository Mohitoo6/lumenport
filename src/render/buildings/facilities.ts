import { FacilityKind } from '../../sim/facilities';
import {
  acUnit,
  ASPHALT,
  awning,
  balcony,
  chhajja,
  compoundWall,
  CONCRETE,
  CONCRETE_DARK,
  fence,
  flatRoof,
  frontPanel,
  GLASS_RAIL,
  GRAVEL_ROOF,
  ground,
  hedge,
  IRON_DARK,
  LAWN,
  Layer,
  LINE_WHITE,
  mat,
  METAL_GREY,
  NO_WIN,
  parking,
  PAVING,
  pick,
  roofFinish,
  rooftop,
  SANDSTONE,
  shrub,
  SIGN,
  stairTower,
  STEEL_DARK,
  Style,
  TAR_ROOF,
  TERRACOTTA,
  vary,
  waterTank,
  WHITE_TRIM,
  win,
  WOOD,
  type Geo,
  type Lot,
  type Mat,
  type RGB,
} from './common';
import { fitBay, type Win } from './geo';

const GRAVEL = mat(Layer.Concrete, [1.1, 1.08, 1.02], 2.5);
const CHAIN_LINK = mat(Layer.Concrete, [0.7, 0.72, 0.74], 1);
const WHITE = mat(Layer.Plaster2, [1.3, 1.3, 1.28], 3);

/** A thin panel visible from both sides (rotor blades, solar panel undersides). */
function slab(g: Geo, pts: Array<readonly [number, number, number]>, m: Mat, w = NO_WIN): void {
  g.poly(pts, m, w, false);
  g.poly([...pts].reverse(), m, NO_WIN, false);
}

/** Chimney with red and white bands. */
function stack(g: Geo, x: number, z: number, h: number, radius: number): void {
  const white = mat(Layer.Concrete, [1.7, 1.7, 1.66], 3);
  const red = mat(Layer.Concrete, [1.7, 0.3, 0.22], 3);
  const segs = 7;
  for (let i = 0; i < segs; i++) {
    const y0 = (h * i) / segs;
    const y1 = (h * (i + 1)) / segs;
    const r0 = radius * (1.35 - 0.5 * (i / segs));
    const r1 = radius * (1.35 - 0.5 * ((i + 1) / segs));
    g.cyl(x, z, r0, r1, y0, y1, 14, i >= segs - 4 && (segs - i) % 2 === 1 ? red : white, null);
  }
  g.cyl(x, z, radius * 0.9, radius * 0.9, h, h + 0.4, 14, STEEL_DARK);
}

function coalPlant(l: Lot): void {
  const { g, r, W, D } = l;
  ground(l, mat(Layer.Concrete, [0.95, 0.95, 0.94], 4));
  const clad = mat(Layer.Metal, [1.2, 1.24, 1.3], 2.6);
  const roof = mat(Layer.Metal, [1.05, 1.07, 1.1], 2.4);
  // Boiler house: the tall block.
  const bx0 = -W / 2 + 2;
  const bx1 = bx0 + 11;
  const bz0 = -D / 2 + 2;
  const bz1 = bz0 + 12;
  g.walls(bx0, bz0, bx1, bz1, 0, 1.2, CONCRETE);
  g.walls(bx0, bz0, bx1, bz1, 1.2, 21, clad, win(Style.Industrial, fitBay(11, 3.6), 6.6, 0.5));
  g.gable(bx0, bz0, bx1, bz1, 21, 1.6, false, 0.3, roof, clad);
  // Turbine hall: long and lower, in front.
  const tz1 = D / 2 - 6;
  g.walls(bx0, bz1, bx1 + 5, tz1, 0, 1.2, CONCRETE);
  g.walls(bx0, bz1, bx1 + 5, tz1, 1.2, 11, mat(Layer.Brick2, [1.4, 1.34, 1.26], 2), win(Style.Industrial, fitBay(16, 4), 9.8, 0.5));
  g.gable(bx0, bz1, bx1 + 5, tz1, 11, 1.4, true, 0.3, roof, clad);
  frontPanel(g, bx0 + 4, tz1, 4, 0.02, 4.4, mat(Layer.Metal, [1.2, 1.22, 1.25], 0.9));
  // Stacks behind the boiler house, linked by a flue.
  stack(g, bx1 + 3.2, bz0 + 2.6, 44 + r.next() * 4, 1.35);
  stack(g, bx1 + 3.2, bz0 + 8.4, 40 + r.next() * 4, 1.25);
  g.box(bx1, bz0 + 1.8, bx1 + 2.6, bz0 + 3.4, 8, 10, METAL_GREY);
  g.box(bx1, bz0 + 7.6, bx1 + 2.6, bz0 + 9.2, 8, 10, METAL_GREY);
  // Cooling tower: a waisted concrete shell.
  const cx = W / 2 - 7.2;
  const cz = -D / 2 + 8;
  const shell = mat(Layer.Concrete, [1.5, 1.5, 1.46], 4);
  const radii = [6.4, 5.4, 4.7, 4.3, 4.2, 4.4, 4.8];
  for (let i = 0; i < radii.length - 1; i++) g.cyl(cx, cz, radii[i]!, radii[i + 1]!, i * 4, (i + 1) * 4, 18, shell, null);
  g.cyl(cx, cz, 4.8, 4.5, 24, 24.3, 18, CONCRETE_DARK, STEEL_DARK);
  // Coal yard: heap and an inclined conveyor into the boiler house.
  const hx = W / 2 - 6;
  const hz = D / 2 - 7;
  const coal = mat(Layer.Asphalt, [0.22, 0.22, 0.24], 2);
  g.cyl(hx, hz, 5, 0.4, 0, 3.6, 12, coal, null);
  g.cyl(hx - 3.6, hz + 1.2, 3.2, 0.3, 0, 2.4, 10, coal, null);
  slab(g, [[hx, 3.4, hz - 0.6], [hx, 3.4, hz + 0.6], [bx1 + 5, 10, hz + 0.6], [bx1 + 5, 10, hz - 0.6]], METAL_GREY);
  g.box(hx - 4.2, hz - 0.15, hx - 3.9, hz + 0.15, 0, 6, STEEL_DARK);
  // Switchyard at the street.
  for (let i = 0; i < 3; i++) {
    const tx = bx0 + 1.5 + i * 2.6;
    g.box(tx - 0.8, D / 2 - 4.2, tx + 0.8, D / 2 - 2.8, 0, 1.9, mat(Layer.Metal, [0.8, 0.84, 0.88], 1.5));
    g.cyl(tx, D / 2 - 3.5, 0.12, 0.12, 1.9, 3.4, 6, mat(Layer.Concrete, [1.8, 1.8, 1.75]));
  }
  fence(g, -W / 2 + 0.3, D / 2 - 0.4, bx0 + 9, D / 2 - 0.4, 2.4, CHAIN_LINK);
  fence(g, -W / 2 + 0.3, -D / 2 + 0.3, -W / 2 + 0.3, D / 2 - 0.4, 2.4, CHAIN_LINK);
}

function windTurbine(l: Lot): void {
  const { g, r, W, D } = l;
  ground(l, LAWN);
  g.cyl(0, 0, 4.2, 4.2, 0, 0.25, 16, GRAVEL);
  g.flat(-1.2, 0, 1.2, D / 2, 0.04, GRAVEL);
  const H = 58;
  g.cyl(0, 0, 1.9, 1.05, 0.25, H, 16, WHITE, null);
  g.box(-0.5, 1.6, 0.5, 1.9, 0.25, 2.3, mat(Layer.Metal, [0.9, 0.92, 0.95], 1.5));
  // Nacelle and hub; the rotor faces the road.
  g.box(-1.4, -3.4, 1.4, 2.6, H, H + 2.8, WHITE);
  const hz = 3.4;
  g.box(-0.9, 2.6, 0.9, hz, H + 0.5, H + 2.3, WHITE);
  const phase = r.next() * Math.PI * 2;
  const R = 31;
  for (let k = 0; k < 3; k++) {
    const a = phase + (k * Math.PI * 2) / 3;
    const ux = Math.cos(a);
    const uy = Math.sin(a);
    // Across-blade direction in the rotor plane.
    const vx = -uy;
    const vy = ux;
    const hy = H + 1.4;
    const p = (d: number, w: number): [number, number, number] => [ux * d + vx * w, hy + uy * d + vy * w, hz + 0.25];
    // Root section, then a long taper to the tip.
    slab(g, [p(0.6, -0.8), p(R * 0.28, -1.3), p(R * 0.28, 0.7), p(0.6, 0.6)], WHITE);
    slab(g, [p(R * 0.28, -1.3), p(R, -0.15), p(R, 0.25), p(R * 0.28, 0.7)], WHITE);
  }
  shrub(g, -W / 2 + 2, -D / 2 + 2, 0.7);
  shrub(g, W / 2 - 2.2, -D / 2 + 2.4, 0.6);
}

function solarFarm(l: Lot): void {
  const { g, W, D } = l;
  ground(l, mat(Layer.Grass, [0.7, 0.88, 0.52], 5));
  const cells = mat(Layer.ConcreteWall, [0.1, 0.16, 0.34], 3);
  const frame = mat(Layer.Metal, [1.3, 1.32, 1.35], 1.5);
  const rows = Math.floor((D - 7) / 3.4);
  const x0 = -W / 2 + 2;
  const x1 = W / 2 - 2;
  for (let i = 0; i < rows; i++) {
    const z = -D / 2 + 2 + i * 3.4;
    // Each table leans toward the street side.
    slab(g, [[x0, 2.2, z], [x1, 2.2, z], [x1, 0.75, z + 2.3], [x0, 0.75, z + 2.3]], cells, win(Style.Curtain, 1.05, 1.37, 0.5));
    const posts = Math.max(2, Math.round((x1 - x0) / 5));
    for (let k = 0; k <= posts; k++) {
      const px = x0 + 0.3 + ((x1 - x0 - 0.6) * k) / posts;
      g.box(px - 0.06, z + 0.15, px + 0.06, z + 0.27, 0, 2.1, frame, NO_WIN, null);
      g.box(px - 0.06, z + 2.0, px + 0.06, z + 2.12, 0, 0.85, frame, NO_WIN, null);
    }
  }
  // Inverter cabin and service track at the street.
  g.flat(-W / 2 + 1, D / 2 - 4, W / 2 - 1, D / 2 - 0.5, 0.04, GRAVEL);
  g.box(W / 2 - 5.5, D / 2 - 3.6, W / 2 - 2, D / 2 - 1.2, 0, 2.6, mat(Layer.Metal, [1.4, 1.42, 1.4], 1.6), NO_WIN, CONCRETE_DARK);
  g.box(W / 2 - 8, D / 2 - 3.2, W / 2 - 6.4, D / 2 - 1.8, 0, 1.6, mat(Layer.Metal, [0.8, 0.86, 0.82], 1.5));
  fence(g, -W / 2 + 0.3, -D / 2 + 0.3, W / 2 - 0.3, -D / 2 + 0.3, 2, CHAIN_LINK);
  fence(g, -W / 2 + 0.3, -D / 2 + 0.3, -W / 2 + 0.3, D / 2 - 0.3, 2, CHAIN_LINK);
  fence(g, W / 2 - 0.3, -D / 2 + 0.3, W / 2 - 0.3, D / 2 - 0.3, 2, CHAIN_LINK);
}

function waterTower(l: Lot): void {
  const { g, W, D } = l;
  ground(l, LAWN);
  g.cyl(0, 0, 5.2, 5.2, 0, 0.2, 16, CONCRETE);
  g.flat(-1, 0, 1, D / 2, 0.04, CONCRETE);
  const paint = mat(Layer.Plaster2, [1.05, 1.2, 1.32], 3);
  const steel = mat(Layer.Metal, [1.1, 1.14, 1.2], 2);
  const H = 22;
  // Legs lean inward; a wide riser pipe runs up the middle.
  for (let k = 0; k < 6; k++) {
    const a = (k / 6) * Math.PI * 2;
    const bx = Math.cos(a) * 4.2;
    const bz = Math.sin(a) * 4.2;
    const tx = Math.cos(a) * 3.3;
    const tz = Math.sin(a) * 3.3;
    const s = 0.22;
    slab(g, [[bx - s, 0.2, bz], [bx + s, 0.2, bz], [tx + s, H, tz], [tx - s, H, tz]], steel);
    slab(g, [[bx, 0.2, bz - s], [bx, 0.2, bz + s], [tx, H, tz + s], [tx, H, tz - s]], steel);
  }
  g.cyl(0, 0, 3.9, 3.9, 10.4, 10.7, 16, steel, null);
  g.cyl(0, 0, 0.75, 0.75, 0.2, H - 2, 10, paint, null);
  // Tank: bowl, drum, shallow roof.
  g.cyl(0, 0, 0.9, 5.2, H - 2.6, H, 18, paint, null);
  g.cyl(0, 0, 5.2, 5.2, H, H + 5.4, 18, paint, null);
  g.cyl(0, 0, 5.35, 5.35, H + 2.4, H + 3.3, 18, mat(Layer.Plaster2, [0.35, 0.6, 1.0], 3), null);
  g.cyl(0, 0, 5.3, 0.5, H + 5.4, H + 7.2, 18, paint);
  g.cyl(0, 0, 0.12, 0.05, H + 7.2, H + 9.5, 5, steel, null);
  fence(g, -W / 2 + 0.4, -D / 2 + 0.4, W / 2 - 0.4, -D / 2 + 0.4, 2, CHAIN_LINK);
  fence(g, -W / 2 + 0.4, -D / 2 + 0.4, -W / 2 + 0.4, D / 2 - 0.4, 2, CHAIN_LINK);
  fence(g, W / 2 - 0.4, -D / 2 + 0.4, W / 2 - 0.4, D / 2 - 0.4, 2, CHAIN_LINK);
}

function waterPump(l: Lot): void {
  const { g, W, D } = l;
  ground(l, CONCRETE);
  const wall = mat(Layer.Brick, [1.4, 1.26, 1.16], 2);
  const roof = mat(Layer.Roof3, [0.7, 0.72, 0.76], 2.4);
  const pipe = mat(Layer.Plaster2, [0.3, 0.55, 1.0], 2);
  const x0 = -W / 2 + 1.4;
  const x1 = x0 + 8.4;
  const z0 = -D / 2 + 1.6;
  const z1 = D / 2 - 4.2;
  g.walls(x0, z0, x1, z1, 0, 0.6, CONCRETE_DARK);
  g.walls(x0, z0, x1, z1, 0.6, 5.2, wall, win(Style.Industrial, fitBay(8.4, 2.8), 4.6, 0.5));
  g.gable(x0, z0, x1, z1, 5.2, 2.1, false, 0.4, roof, wall);
  frontPanel(g, x0 + 2.4, z1, 2.4, 0.02, 3, mat(Layer.Metal, [0.6, 0.75, 1.0], 1));
  // Pipework: two mains leave the building, rise over a valve set and run to the back.
  const px = x1 + 1.3;
  for (const off of [0, 1.7]) {
    g.box(x1, z0 + 1.6 + off * 1.4, px + off + 0.45, z0 + 2.5 + off * 1.4, 0.7, 1.6, pipe);
    g.box(px + off - 0.45, -D / 2 + 0.5, px + off + 0.45, z0 + 2.5 + off * 1.4, 0.7, 1.6, pipe);
    g.cyl(px + off, z0 + 2.05 + off * 1.4, 0.62, 0.62, 0.5, 1.9, 10, STEEL_DARK);
  }
  // Surge tank and a control kiosk.
  g.cyl(W / 2 - 2.6, D / 2 - 5.6, 1.5, 1.5, 0, 5.4, 14, WHITE, null);
  g.cyl(W / 2 - 2.6, D / 2 - 5.6, 1.55, 0.2, 5.4, 6.1, 14, METAL_GREY);
  g.box(W / 2 - 4.4, D / 2 - 3, W / 2 - 1.4, D / 2 - 1.4, 0, 2.2, mat(Layer.Metal, [1.3, 1.34, 1.3], 1.5));
  g.flat(-W / 2 + 0.5, D / 2 - 3.6, x1, D / 2 - 0.3, 0.04, ASPHALT);
  fence(g, -W / 2 + 0.3, -D / 2 + 0.3, -W / 2 + 0.3, D / 2 - 0.3, 2, CHAIN_LINK);
  fence(g, W / 2 - 0.3, -D / 2 + 0.3, W / 2 - 0.3, D / 2 - 0.3, 2, CHAIN_LINK);
}

function signBoard(g: Geo, x0: number, x1: number, z: number, y0: number, y1: number, tint: RGB): void {
  g.box(x0, z, x1, z + 0.18, y0, y1, mat(Layer.Plaster2, tint, 3), SIGN, CONCRETE_DARK);
}

function flagpole(g: Geo, x: number, z: number, tint: RGB): void {
  g.cyl(x, z, 0.07, 0.04, 0, 9, 6, mat(Layer.Concrete, [1.8, 1.8, 1.8]), null);
  slab(g, [[x, 8.8, z], [x + 1.7, 8.8, z], [x + 1.7, 7.8, z], [x, 7.8, z]], mat(Layer.Plaster2, tint, 3));
}

/**
 * Police station (Thana): cream/stone facade with navy-blue & red police bands, arched
 * entrance portico, glowing blue-and-red fascia sign, comms mast, compound wall and patrol bay.
 */
function police(l: Lot): void {
  const { g, r, W, D } = l;
  ground(l, PAVING);
  const wall = mat(Layer.Plaster2, [1.24, 1.22, 1.16], 3);
  const blue: RGB = [0.08, 0.22, 0.68];
  const red: RGB = [0.82, 0.12, 0.1];
  const x0 = -W / 2 + 1.2;
  const x1 = W / 2 - 4.4;
  const z0 = -D / 2 + 1.2;
  const z1 = D / 2 - 3.6;
  const fh = 3.4;
  // A band in force blue under the parapet, and a lit sign over the door.
  // Patrol car bays at the side.
  const top = 0.6 + 2 * fh;

  g.walls(x0, z0, x1, z1, 0, 0.6, CONCRETE_DARK);
  g.walls(x0, z0, x1, z1, 0.6, top, wall, win(Style.Punched, fitBay(x1 - x0, 2.8), fh, 0.46));
  chhajja(g, x0 - 0.1, x1 + 0.1, z1, 0.6 + 0.8 * fh, 0.45, WHITE_TRIM, 'front');
  chhajja(g, x0 - 0.1, x1 + 0.1, z1, 0.6 + 1.8 * fh, 0.45, WHITE_TRIM, 'front');
  g.walls(x0 - 0.06, z0 - 0.06, x1 + 0.06, z1 + 0.06, top - 0.65, top - 0.22, mat(Layer.Plaster2, blue, 3));
  g.walls(x0 - 0.06, z0 - 0.06, x1 + 0.06, z1 + 0.06, top - 0.22, top + 0.02, mat(Layer.Plaster2, red, 3));
  flatRoof(g, x0, z0, x1, z1, top, wall, roofFinish(r), 0.75);
  rooftop(l, x0, z0, x1, z1, top, wall);
  waterTank(g, x0 + 1.5, z0 + 1.5, top, r, 0.8, true);
  g.cyl(x1 - 1.6, z0 + 1.6, 0.12, 0.04, top, top + 9.5, 6, METAL_GREY, null);

  const dx = (x0 + x1) * 0.5;
  g.arch(dx, z1 + 1.6, 3.6, 0.6, 2.55, 0.7, 0.35, WHITE_TRIM, 0.32, 0.22);
  g.box(dx - 1.9, z1, dx + 1.9, z1 + 1.7, 3.45, 3.7, WHITE_TRIM, NO_WIN, CONCRETE);
  frontPanel(g, dx, z1, 2.4, 0.6, 3.1, mat(Layer.Concrete, [0.46, 0.48, 0.54], 2), win(Style.Storefront, 2.4, 2.5, 0.5));
  signBoard(g, dx - 2.6, dx + 0.3, z1 + 1.6, 3.75, 4.5, blue);
  signBoard(g, dx + 0.3, dx + 2.6, z1 + 1.6, 3.75, 4.5, red);
  g.stair(dx - 1.4, z1 + 1.5, dx + 1.4, z1 + 2.3, 0, 0.6, 3, CONCRETE);

  parking(g, x1 + 0.5, z0, W / 2 - 0.6, z1);
  compoundWall(g, -W / 2 + 0.3, -D / 2 + 0.3, W / 2 - 0.3, D / 2 - 0.3, 1.3, wall, WHITE_TRIM, {
    cx: dx,
    w: 4.4,
    gateMat: IRON_DARK,
  });
  flagpole(g, x0 + 0.9, D / 2 - 1.6, blue);
}

/**
 * Fire station: red-brick & white-trim appliance hall with 3 framed red bay doors,
 * crew quarters with balcony and chhajjas above, and a tall watch/hose tower.
 */
function fireStation(l: Lot): void {
  const { g, r, W, D } = l;
  ground(l, mat(Layer.Concrete, [1.18, 1.18, 1.15], 4));
  const wall = mat(Layer.Brick, [1.5, 1.18, 1.08], 2);
  const red: RGB = [0.82, 0.1, 0.08];
  const x0 = -W / 2 + 1;
  const x1 = W / 2 - 1;
  const z0 = -D / 2 + 1;
  const z1 = D / 2 - 5;
  // Appliance bay with three tall red doors, crew quarters above.
  const h = 6.0;

  g.walls(x0, z0, x1, z1, 0, h, wall);
  const bays = 3;
  const bw = (x1 - x0 - 3.4) / bays;
  for (let i = 0; i < bays; i++) {
    const cx = x0 + 0.5 + bw * (i + 0.5);
    frontPanel(g, cx, z1, bw - 0.45, 0.02, 4.5, WHITE_TRIM);
    frontPanel(g, cx, z1 + 0.04, bw - 0.72, 0.02, 4.35, mat(Layer.Metal, [1.85, 0.28, 0.22], 0.8));
    frontPanel(g, cx, z1 + 0.07, bw - 1.1, 2.55, 3.55, mat(Layer.Concrete, [0.4, 0.46, 0.52], 2), win(Style.Curtain, (bw - 1.1) / 3, 1, 0.5));
  }
  // Hose-drying tower at the corner.
  g.box(x0 + 0.2, z1, x1 - 3.3, z1 + 1.15, 4.65, 4.9, WHITE_TRIM);

  g.walls(x0, z0, x1, z1, h, h + 3.2, WHITE_TRIM, win(Style.Punched, fitBay(x1 - x0, 2.8), 3.2, 0.5));
  balcony(g, x0 + 0.6, x1 - 3.8, z1, h, 1.0, CONCRETE, IRON_DARK, 'parapet-rail', 'front');
  chhajja(g, x0, x1 - 3.4, z1, h + 2.55, 0.48, WHITE_TRIM, 'front');
  flatRoof(g, x0, z0, x1, z1, h + 3.2, wall, roofFinish(r), 0.8);
  rooftop(l, x0, z0, x1, z1, h + 3.2, wall);
  signBoard(g, x0 + 0.8, x1 - 3.8, z1 + 1.1, 4.95, 5.85, red);

  const tx = x1 - 1.5;
  // Apron with keep-clear hatching.
  g.walls(tx - 1.55, z1 - 3.1, tx + 1.55, z1 + 0.35, 0, 15.6, wall, win(Style.Punched, 3.1, 3.6, 0.34));
  g.box(tx - 1.75, z1 - 3.3, tx + 1.75, z1 + 0.55, 14.9, 15.6, WHITE_TRIM);
  g.hip(tx - 1.55, z1 - 3.1, tx + 1.55, z1 + 0.35, 15.6, 1.8, 0.35, TERRACOTTA);
  g.cyl(tx, z1 - 1.35, 0.08, 0.03, 17.4, 20.2, 6, METAL_GREY, null);

  for (let i = 0; i < 6; i++) g.flat(x0 + 1 + i * 2.2, z1 + 0.6, x0 + 1.22 + i * 2.2, D / 2 - 0.4, 0.04, mat(Layer.Concrete, [2.2, 1.7, 0.2], 3));
}

function clinic(l: Lot): void {
  const { g, r, W, D } = l;
  ground(l, PAVING);
  const wall = mat(Layer.Plaster2, [1.32, 1.32, 1.3], 3);
  const green: RGB = [0.08, 0.6, 0.3];
  const x0 = -W / 2 + 1.2;
  const x1 = W / 2 - 1.2;
  const z0 = -D / 2 + 1.2;
  const z1 = D / 2 - 5.2;
  const fh = 3.5;
  const top = 0.5 + 3 * fh;
  g.walls(x0, z0, x1, z1, 0, 0.5, CONCRETE);
  g.walls(x0, z0, x1, z1, 0.5, top, wall, win(Style.Ribbon, fitBay(x1 - x0, 2.6), fh, 0.5));
  flatRoof(g, x0, z0, x1, z1, top, wall, roofFinish(r));
  rooftop(l, x0, z0, x1, z1, top, wall);
  // Stair tower with a green cross sign.
  const tx = x0 + 2.2;
  g.box(tx - 1.8, z1, tx + 1.8, z1 + 0.5, 0, top + 2.4, mat(Layer.Plaster2, [0.95, 1.2, 1.05], 3));
  g.box(tx - 0.35, z1 + 0.5, tx + 0.35, z1 + 0.62, top - 2.6, top + 0.2, mat(Layer.Plaster2, green, 3), SIGN);
  g.box(tx - 1.2, z1 + 0.5, tx + 1.2, z1 + 0.62, top - 1.55, top - 0.85, mat(Layer.Plaster2, green, 3), SIGN);
  // Entrance canopy and ambulance bay.
  const dx = x1 - 4;
  g.box(dx - 3, z1, dx + 3, z1 + 3.4, 3.4, 3.7, mat(Layer.Plaster2, green, 3), NO_WIN, CONCRETE);
  for (const px of [dx - 2.8, dx + 2.8]) g.box(px - 0.1, z1 + 3.1, px + 0.1, z1 + 3.3, 0, 3.4, WHITE_TRIM);
  frontPanel(g, dx, z1, 4, 0.5, 3.2, mat(Layer.Concrete, [0.5, 0.52, 0.56], 2), win(Style.Storefront, 2, 2.7, 0.5));
  g.flat(-W / 2 + 0.5, z1 + 3.6, W / 2 - 0.5, D / 2 - 0.4, 0.04, ASPHALT);
  g.flat(dx - 1.6, z1 + 3.9, dx + 1.6, D / 2 - 0.7, 0.05, LINE_WHITE);
  shrub(g, x0 + 5.5, z1 + 0.9, 0.6);
  shrub(g, x0 + 7.2, z1 + 0.9, 0.6);
}


/**
 * A multiplex cinema: a dark-slate block with a double-height glazed
 * lobby, a neon-trimmed marquee, poster lightboxes, stepped auditoriums and a lit rooftop sign.
 */
function multiplex(l: Lot): void {
  const { g, r, W, D } = l;
  ground(l, PAVING);
  const hw = W / 2;
  const hd = D / 2;
  const dark = mat(Layer.ConcreteWall, [0.34, 0.36, 0.42], 3);
  const warm = mat(Layer.Plaster2, [1.26, 0.92, 0.62], 3);
  const glass = mat(Layer.ConcreteWall, [0.34, 0.54, 0.72], 2.6);
  const crimson: RGB = [0.95, 0.14, 0.22];
  const gold: RGB = [0.98, 0.72, 0.12];
  const cyan: RGB = [0.08, 0.72, 0.92];
  const violet: RGB = [0.68, 0.18, 0.86];

  // Rear stepped auditorium block (windowless acoustic halls).
  const ax0 = -hw + 1.8;
  const ax1 = hw - 1.8;
  const az0 = -hd + 1.8;
  const az1 = hd - 11.5;
  const audH = 14.8;
  g.walls(ax0, az0, ax1, az1, 0, audH, dark);
  // Decorative vertical golden fins wrapping the auditorium volume.
  const fins = 7;
  for (let i = 0; i <= fins; i++) {
    const fx = ax0 + ((ax1 - ax0) * i) / fins;
    g.box(fx - 0.18, az1 - 0.2, fx + 0.18, az1 + 0.45, 8.6, audH + 0.9, warm);
  }
  flatRoof(g, ax0, az0, ax1, az1, audH, dark, roofFinish(r), 1.0);
  rooftop(l, ax0, az0, ax1, az1, audH, dark);

  // Front double-height glazed foyer atrium.
  const fx0 = ax0 + 2.0;
  const fx1 = ax1 - 2.0;
  const fz1 = az1 + 5.2;
  const foyerH = 8.8;
  g.walls(fx0, az1, fx1, fz1, 0, foyerH, glass, win(Style.Curtain, 2.2, 4.4, 0.75));
  g.box(fx0 - 0.4, az1, fx1 + 0.4, fz1 + 0.4, foyerH, foyerH + 0.8, dark);
  // Cafe terrace balcony on top of the foyer.
  balcony(g, fx0 + 0.6, fx1 - 0.6, fz1 + 0.2, foyerH + 0.8, 0.4, WHITE_TRIM, IRON_DARK, 'glass', 'front');

  // Sweeping cantilevered cinema marquee canopy with glowing gold & crimson trim.
  g.box(fx0 - 1.2, fz1, fx1 + 1.2, fz1 + 3.2, 4.8, 5.7, dark, NO_WIN, GRAVEL_ROOF);
  g.box(fx0 - 1.25, fz1 + 3.12, fx1 + 1.25, fz1 + 3.3, 4.85, 5.18, mat(Layer.Plaster2, gold, 3), SIGN);
  g.box(fx0 - 1.25, fz1 + 3.12, fx1 + 1.25, fz1 + 3.3, 5.32, 5.65, mat(Layer.Plaster2, crimson, 3), SIGN);
  g.stair(-4.2, fz1, 4.2, fz1 + 1.4, 0, 0.45, 3, CONCRETE);

  // Glowing cinema sign tower rising above the roof.
  g.box(-5.6, az1 + 0.3, 5.6, az1 + 1.1, audH - 1.0, audH + 4.4, dark);
  g.box(-5.2, az1 + 1.1, 5.2, az1 + 1.32, audH - 0.2, audH + 3.8, mat(Layer.Plaster2, crimson, 3), SIGN);
  g.box(-4.8, az1 + 1.1, 4.8, az1 + 1.32, audH + 3.85, audH + 4.25, mat(Layer.Plaster2, gold, 3), SIGN);

  // Glowing movie-poster lightboxes along the front plaza wings.
  const posters: readonly RGB[] = [crimson, cyan, gold, violet];
  const xs = [-hw + 3.6, -hw + 6.4, hw - 6.4, hw - 3.6];
  for (let i = 0; i < 4; i++) {
    const px = xs[i]!;
    g.box(px - 0.95, fz1 + 1.0, px + 0.95, fz1 + 1.35, 0.4, 3.6, dark);
    g.box(px - 0.8, fz1 + 1.35, px + 0.8, fz1 + 1.45, 0.8, 3.3, mat(Layer.Plaster2, posters[i]!, 3), SIGN);
  }

  // Front plaza planters, trees & side drop-off strip.
  g.flat(-hw + 0.6, hd - 3.4, hw - 0.6, hd - 0.5, 0.04, ASPHALT);
  g.tree(-hw + 2.2, hd - 4.8, 0.52, 0.6);
  g.tree(hw - 2.2, hd - 4.8, 0.52, 2.2);
  shrub(g, -6.0, fz1 + 2.4, 0.55, [0.92, 0.3, 0.55]);
  shrub(g, 6.0, fz1 + 2.4, 0.55, [0.95, 0.56, 0.22]);
}

/**
 * A bazaar street: an arched entrance gate, rows of stalls with sloped
 * awnings and lit boards, a shade tree at the chowk, and festive lights overhead.
 */
function marketStreet(l: Lot): void {
  const { g, r, W, D } = l;
  ground(l, PAVING);
  const hw = W / 2;
  const hd = D / 2;
  const stallPalette: readonly RGB[] = [
    [0.95, 0.48, 0.08], // saffron
    [0.88, 0.16, 0.38], // magenta
    [0.08, 0.58, 0.42], // emerald
    [0.12, 0.42, 0.86], // royal blue
    [0.96, 0.76, 0.08], // marigold
    [0.82, 0.22, 0.14], // terracotta red
  ];
  const plaster = mat(Layer.Plaster2, [1.28, 1.18, 0.96], 3);
  const trim = SANDSTONE;
  const warmGlow: RGB = [1.0, 0.76, 0.28];

  // Central decorative bazaar walkway carpet in contrasting sandstone paving.
  g.flat(-hw + 1.2, -2.4, hw - 1.2, 2.8, 0.04, mat(Layer.Pavement, [1.28, 1.14, 0.96], 2.5));

  // Back row of market stalls running across the full width.
  const backZ0 = -hd + 0.8;
  const backZ1 = backZ0 + 3.8;
  const nStalls = Math.max(3, Math.round((W - 2.4) / 4.4));
  const sw = (W - 2.4) / nStalls;
  for (let i = 0; i < nStalls; i++) {
    const sx0 = -hw + 1.2 + i * sw;
    const sx1 = sx0 + sw - 0.18;
    const col = stallPalette[i % stallPalette.length]!;
    g.walls(sx0, backZ0, sx1, backZ1, 0, 3.3, plaster, [NO_WIN, NO_WIN, win(Style.Storefront, sx1 - sx0, 3.3, 0.7), NO_WIN]);
    g.box(sx0, backZ0, sx1, backZ1, 3.3, 3.65, trim, NO_WIN, TERRACOTTA);
    // Display counter & vibrant sloped awning.
    g.box(sx0 + 0.25, backZ1, sx1 - 0.25, backZ1 + 0.75, 0, 0.9, WOOD);
    awning(g, sx0 + 0.1, sx1 - 0.1, backZ1, 3.1, 1.65, col);
    signBoard(g, sx0 + 0.35, sx1 - 0.35, backZ1, 3.2, 3.85, col);
  }

  // Front corner kiosks flanking a wide central bazaar entrance opening.
  const openHalf = Math.min(4.6, W * 0.18);
  const frontZ1 = hd - 1.2;
  const frontZ0 = frontZ1 - 3.2;
  for (const side of [-1, 1]) {
    const kx0 = side < 0 ? -hw + 1.4 : openHalf + 1.0;
    const kx1 = side < 0 ? -openHalf - 1.0 : hw - 1.4;
    if (kx1 - kx0 < 3.0) continue;
    const col = pick(r, stallPalette);
    g.walls(kx0, frontZ0, kx1, frontZ1, 0, 3.1, plaster, [
      win(Style.Storefront, fitBay(kx1 - kx0, 3.2), 3.1, 0.65),
      NO_WIN,
      win(Style.Storefront, fitBay(kx1 - kx0, 3.2), 3.1, 0.65),
      NO_WIN,
    ]);
    g.box(kx0, frontZ0, kx1, frontZ1, 3.1, 3.45, trim, NO_WIN, TERRACOTTA);
    awning(g, kx0 + 0.2, kx1 - 0.2, frontZ1, 2.95, 1.1, col);
    signBoard(g, kx0 + 0.5, kx1 - 0.5, frontZ1, 3.05, 3.65, col);
  }

  // Ornate arched Indian bazaar entrance gate at the street front.
  g.arch(0, frontZ1 + 0.2, openHalf * 2 + 1.4, 0, 3.2, 1.4, 0.6, trim, 0.55, 0.45, 8);
  signBoard(g, -openHalf * 0.75, openHalf * 0.75, frontZ1 + 0.22, 4.15, 4.95, [0.92, 0.22, 0.14]);

  // Overhead festive string-light / lantern beams spanning the bazaar lane (glows warmly at night).
  const beams = Math.max(3, Math.round((W - 4) / 5.5));
  for (let i = 0; i < beams; i++) {
    const bx = -hw + 2.5 + ((W - 5) * i) / Math.max(1, beams - 1);
    g.cyl(bx, backZ1 + 1.7, 0.08, 0.06, 0, 4.5, 6, IRON_DARK);
    g.cyl(bx, frontZ0 - 0.3, 0.08, 0.06, 0, 4.5, 6, IRON_DARK);
    g.box(bx - 0.08, backZ1 + 1.7, bx + 0.08, frontZ0 - 0.3, 4.35, 4.52, mat(Layer.Plaster2, warmGlow, 2), SIGN);
  }

  // Central chowk planter with shade tree and benches.
  g.cyl(0, 0.2, 1.8, 1.8, 0.04, 0.55, 12, trim, LAWN);
  g.tree(0, 0.2, 0.62, r.next() * 6);
  g.box(-3.6, -0.3, -2.2, 0.3, 0.35, 0.5, WOOD);
  g.box(2.2, -0.3, 3.6, 0.3, 0.35, 0.5, WOOD);
}

/**
 * Indian school campus: warm cream/sandstone two-storey classroom wing with colonnaded
 * verandah and chhajjas, Mangalore-tile assembly hall, sports court, and compound wall
 * with an arched school gate.
 */
function school(l: Lot): void {
  const { g, r, W, D } = l;
  ground(l, LAWN);
  // Classroom wing along the back, hall at one end.
  const wall = mat(Layer.Plaster2, [1.3, 1.2, 0.96], 3);
  const accent = mat(Layer.Brick, [1.42, 1.12, 0.98], 2);
  const yellow: RGB = [0.92, 0.62, 0.06];
  const fh = 3.5;

  const x0 = -W / 2 + 1.4;
  const x1 = W / 2 - 1.4;
  const z0 = -D / 2 + 1.4;
  const z1 = z0 + 8.0;
  const top = 0.5 + 2 * fh;
  g.walls(x0, z0, x1, z1, 0, 0.5, CONCRETE_DARK);
  g.walls(x0, z0, x1, z1, 0.5, top, wall, win(Style.Punched, fitBay(x1 - x0, 2.8), fh, 0.5));
  const vx0 = x0 + 9.2;
  const vz1 = z1 + 1.6;
  g.box(vx0, z1, x1, vz1, 0, 0.5, CONCRETE);
  g.box(vx0, z1, x1, vz1, 0.5 + fh - 0.16, 0.5 + fh, WHITE_TRIM);
  g.box(vx0, z1, x1, vz1, top - 0.16, top, WHITE_TRIM);
  const vCols = Math.max(3, Math.round((x1 - vx0) / 3.2));
  for (let i = 0; i <= vCols; i++) {
    const cx = vx0 + ((x1 - vx0) * i) / vCols;
    g.box(cx - 0.12, vz1 - 0.24, cx + 0.12, vz1, 0.5, top, WHITE_TRIM);
  }
  g.railing(vx0 + 0.1, vz1 - 0.08, x1 - 0.1, vz1 - 0.08, 0.5 + fh, 0.5 + fh + 1.0, IRON_DARK, 1.5, 0.05, true);
  chhajja(g, x0, x1, vz1, top - 0.35, 0.5, accent, 'front');
  flatRoof(g, x0, z0, x1, z1, top, wall, roofFinish(r), 0.85);
  rooftop(l, x0, z0, x1, z1, top, wall);
  // Entrance and sign.
  // Playground: a painted court, a path to the gate, trees along the fence.
  waterTank(g, x1 - 2.0, z0 + 2.0, top, r, 0.9, true);

  const hx1 = x0 + 9.0;
  const hz1 = z1 + 7.2;
  g.walls(x0, z1, hx1, hz1, 0, 7.2, accent, win(Style.Punched, fitBay(9, 2.8), 3.6, 0.45));
  g.gable(x0, z1, hx1, hz1, 7.2, 2.2, false, 0.45, TERRACOTTA, accent);

  const dx = hx1 + 2.8;
  g.box(dx - 2.2, vz1, dx + 2.2, vz1 + 1.6, 3.4, 3.7, mat(Layer.Plaster2, yellow, 3), NO_WIN, CONCRETE);
  frontPanel(g, dx, z1, 3.0, 0.5, 3.1, mat(Layer.Concrete, [0.46, 0.5, 0.54], 2), win(Style.Storefront, 1.5, 2.6, 0.5));
  signBoard(g, dx + 2.5, Math.min(x1 - 0.5, dx + 8.5), vz1, 4.3, 5.25, yellow);

  const cx0 = hx1 + 1.4;
  const cz0 = vz1 + 2.4;
  g.flat(cx0, cz0, x1 - 0.4, D / 2 - 2.4, 0.04, ASPHALT);
  g.flat(cx0 + 0.6, cz0 + 0.6, x1 - 1.0, cz0 + 0.72, 0.05, LINE_WHITE);
  g.flat(cx0 + 0.6, D / 2 - 3.12, x1 - 1.0, D / 2 - 3.0, 0.05, LINE_WHITE);
  g.flat(cx0 + 0.6, cz0 + 0.6, cx0 + 0.72, D / 2 - 3.0, 0.05, LINE_WHITE);
  g.flat(x1 - 1.12, cz0 + 0.6, x1 - 1.0, D / 2 - 3.0, 0.05, LINE_WHITE);
  g.flat((cx0 + x1 - 0.4) / 2 - 0.06, cz0 + 0.6, (cx0 + x1 - 0.4) / 2 + 0.06, D / 2 - 3.0, 0.05, LINE_WHITE);
  g.flat(dx - 1.1, vz1 + 1.6, dx + 1.1, D / 2 - 0.3, 0.04, PAVING);

  compoundWall(g, -W / 2 + 0.3, -D / 2 + 0.3, W / 2 - 0.3, D / 2 - 0.3, 1.45, wall, WHITE_TRIM, {
    cx: dx,
    w: 4.2,
    gateMat: IRON_DARK,
    overhead: true,
  });
  g.tree(x0 + 2.0, D / 2 - 2.5, 0.58, 1.2);
  g.tree(x0 + 6.4, D / 2 - 2.7, 0.52, 3.1);
  flagpole(g, dx - 3.2, vz1 + 2.0, yellow);
}

function park(l: Lot): void {
  const { g, r, W, D } = l;
  ground(l, mat(Layer.Grass, [0.7, 1.02, 0.52], 5));
  // Crossing paths meeting at a small fountain.
  g.flat(-0.9, -D / 2, 0.9, D / 2, 0.035, PAVING);
  g.flat(-W / 2, -0.9, W / 2, 0.9, 0.035, PAVING);
  g.cyl(0, 0, 2.6, 2.6, 0, 0.05, 16, PAVING);
  g.cyl(0, 0, 1.7, 1.7, 0.05, 0.5, 14, CONCRETE, mat(Layer.ConcreteWall, [0.2, 0.5, 0.62], 3));
  g.cyl(0, 0, 0.22, 0.14, 0.5, 1.4, 8, CONCRETE);
  g.cyl(0, 0, 0.6, 0.6, 1.4, 1.5, 10, CONCRETE);
  // Hedge along the back and sides, open to the street.
  hedge(g, -W / 2 + 0.2, -D / 2 + 0.2, -1.2, -D / 2 + 0.8, 0.9);
  hedge(g, 1.2, -D / 2 + 0.2, W / 2 - 0.2, -D / 2 + 0.8, 0.9);
  // Trees in each quarter, a little off-grid, with benches by the paths.
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      g.tree(sx * (W / 4 + r.range(-0.8, 0.8)), sz * (D / 4 + r.range(-0.8, 0.8)), r.range(0.5, 0.72), r.next() * 6);
      g.box(sx * 1.5 - 0.25, sz * 3.4 - 0.7, sx * 1.5 + 0.25, sz * 3.4 + 0.7, 0.3, 0.45, WOOD);
      shrub(g, sx * (W / 2 - 1.4), sz * 1.9, 0.55, [0.55 + r.next() * 0.3, 0.6, 0.3 + r.next() * 0.25]);
    }
  }
}

/** Where the town hall's front doors are, in the building's local frame (metres). */
export const TOWN_HALL_DOOR = { z: 4.02, y: 1.4, width: 3.2, height: 4.3 };

/**
 * The town hall: a stone civic building on a podium, with a columned portico, a pediment
 * with a clock, and a copper dome. The front doors are a separate, animated mesh
 * (see townHallDoors.ts); here the doorway is a dark recess.
 */
function townHall(l: Lot): void {
  const { g, W, D } = l;
  const stone = mat(Layer.ConcreteWall, [1.42, 1.38, 1.28], 3);
  const stoneDark = mat(Layer.ConcreteWall, [1.12, 1.08, 1.0], 3);
  const trim = mat(Layer.Plaster2, [1.38, 1.36, 1.3], 3);
  const copper = mat(Layer.Metal, [0.55, 1.02, 0.86], 2);
  const gold = mat(Layer.Metal, [2.2, 1.7, 0.6], 1);
  ground(l, mat(Layer.Pavement, [1.15, 1.13, 1.08], 3));
  // Lawns at the sides of the square.
  g.flat(-W / 2 + 0.6, -D / 2 + 0.6, -12.6, D / 2 - 6, 0.04, LAWN);
  g.flat(12.6, -D / 2 + 0.6, W / 2 - 0.6, D / 2 - 6, 0.04, LAWN);

  // Podium and front steps.
  const top = 1.4;
  g.box(-12.4, -11.4, 12.4, 6.6, 0, top, stoneDark, NO_WIN, stone);
  for (let k = 0; k < 5; k++) {
    const y = (top / 5) * (k + 1);
    g.box(-8 + k * 0.1, 6.6, 8 - k * 0.1, 11.2 - k * 0.9, 0, y, stone);
  }

  // Main block: two tall storeys with long windows.
  const z1 = TOWN_HALL_DOOR.z;
  const roof = 10.6;
  const wf = win(Style.Punched, 3.1, 4.6, 0.42);
  const ws = win(Style.Punched, fitBay(14, 3.2), 4.6, 0.42);
  // Back and sides; the front is built below around the doorway.
  g.wall(-11, -10, 11, -10, top, roof, stone, wf);
  g.wall(11, -10, 11, z1, top, roof, stone, ws);
  g.wall(-11, z1, -11, -10, top, roof, stone, ws);
  // Front wall in three parts so the doorway stays open.
  const dw = TOWN_HALL_DOOR.width / 2;
  g.wall(11, z1, dw, z1, top, roof, stone, win(Style.Punched, fitBay(11 - dw, 3.1), 4.6, 0.42));
  g.wall(-dw, z1, -11, z1, top, roof, stone, win(Style.Punched, fitBay(11 - dw, 3.1), 4.6, 0.42));
  g.wall(dw, z1, -dw, z1, top + TOWN_HALL_DOOR.height, roof, stone);
  // Door surround and the dark recess behind the doors.
  g.box(-dw - 0.35, z1, dw + 0.35, z1 + 0.25, top + TOWN_HALL_DOOR.height, top + TOWN_HALL_DOOR.height + 0.45, trim);
  g.box(-dw - 0.35, z1, -dw, z1 + 0.25, top, top + TOWN_HALL_DOOR.height, trim);
  g.box(dw, z1, dw + 0.35, z1 + 0.25, top, top + TOWN_HALL_DOOR.height, trim);
  g.wall(dw, z1 - 1.2, -dw, z1 - 1.2, top, top + TOWN_HALL_DOOR.height, mat(Layer.Plaster2, [0.32, 0.24, 0.18], 2));
  g.wall(-dw, z1 - 1.2, -dw, z1, top, top + TOWN_HALL_DOOR.height, mat(Layer.Plaster2, [0.4, 0.32, 0.24], 2));
  g.wall(dw, z1, dw, z1 - 1.2, top, top + TOWN_HALL_DOOR.height, mat(Layer.Plaster2, [0.4, 0.32, 0.24], 2));
  g.flat(-dw, z1 - 1.2, dw, z1, top + 0.02, mat(Layer.Concrete, [0.9, 0.7, 0.5], 2));
  // Cornice and flat roof.
  g.box(-11.4, -10.4, 11.4, z1 + 0.4, roof - 0.2, roof + 0.5, trim);
  flatRoof(g, -11, -10, 11, z1, roof + 0.5, stone, mat(Layer.Concrete, [1.1, 1.1, 1.08], 3), 0.6);

  // Portico: six columns, entablature and a pediment with a clock.
  const pz0 = z1 + 0.4;
  const pz1 = z1 + 2.6;
  for (let k = 0; k < 6; k++) {
    const x = -7 + k * 2.8;
    g.box(x - 0.6, pz1 - 1.75, x + 0.6, pz1 - 0.55, top, top + 0.4, stone);
    g.cyl(x, pz1 - 1.15, 0.5, 0.42, top + 0.4, roof - 0.4, 14, trim, null);
    g.box(x - 0.6, pz1 - 1.75, x + 0.6, pz1 - 0.55, roof - 0.4, roof, stone);
  }
  g.box(-8, pz0, 8, pz1, roof, roof + 1.1, trim, NO_WIN, stone);
  const apex = roof + 1.1 + 3.4;
  g.poly([[-8.4, roof + 1.1, pz1], [8.4, roof + 1.1, pz1], [0, apex, pz1]], stone, NO_WIN, false);
  g.poly([[8.4, roof + 1.1, pz1], [8.4, roof + 1.1, pz0], [0, apex, pz0], [0, apex, pz1]], copper);
  g.poly([[-8.4, roof + 1.1, pz0], [-8.4, roof + 1.1, pz1], [0, apex, pz1], [0, apex, pz0]], copper);
  g.poly([[8.4, roof + 1.1, pz0], [-8.4, roof + 1.1, pz0], [0, apex, pz0]], stone, NO_WIN, false);
  g.wall(1.1, pz1 + 0.06, -1.1, pz1 + 0.06, roof + 1.5, roof + 3.7, mat(Layer.Plaster2, [1.1, 1.0, 0.7], 2), SIGN);
  g.wall(1.35, pz1 + 0.04, -1.35, pz1 + 0.04, roof + 1.25, roof + 3.95, gold);

  // Drum, dome and lantern.
  const dz = -3;
  g.cyl(0, dz, 5.4, 5.4, roof + 0.5, roof + 1.4, 24, trim);
  g.cyl(0, dz, 4.8, 4.8, roof + 1.4, roof + 4.4, 24, stone, null);
  for (let k = 0; k < 12; k++) {
    const a = (k / 12) * Math.PI * 2;
    g.box(Math.cos(a) * 4.9 - 0.18, dz + Math.sin(a) * 4.9 - 0.18, Math.cos(a) * 4.9 + 0.18, dz + Math.sin(a) * 4.9 + 0.18, roof + 1.4, roof + 4.4, trim, NO_WIN, null);
  }
  g.cyl(0, dz, 5.1, 5.1, roof + 4.4, roof + 4.9, 24, trim);
  const rings = 7;
  for (let k = 0; k < rings; k++) {
    const a0 = (k / rings) * (Math.PI / 2);
    const a1 = ((k + 1) / rings) * (Math.PI / 2);
    g.cyl(0, dz, Math.cos(a0) * 4.9, Math.cos(a1) * 4.9 + 0.01, roof + 4.9 + Math.sin(a0) * 5.2, roof + 4.9 + Math.sin(a1) * 5.2, 24, copper, null);
  }
  const lantern = roof + 4.9 + 5.2;
  g.cyl(0, dz, 0.95, 0.95, lantern - 0.2, lantern + 1.6, 10, trim);
  g.cyl(0, dz, 1.1, 0.08, lantern + 1.6, lantern + 3.0, 10, copper, null);
  g.cyl(0, dz, 0.05, 0.03, lantern + 3.0, lantern + 6.5, 5, mat(Layer.Concrete, [1.8, 1.8, 1.8]), null);
  slab(g, [[0, lantern + 6.3, dz], [2.2, lantern + 6.3, dz], [2.2, lantern + 5.0, dz], [0, lantern + 5.0, dz]], mat(Layer.Plaster2, [1.6, 0.55, 0.15], 2));

  // The square: flagpoles, trees and lamps.
  for (const sx of [-1, 1]) {
    g.cyl(sx * 10, 12.4, 0.08, 0.05, 0, 11, 6, mat(Layer.Concrete, [1.8, 1.8, 1.8]), null);
    slab(g, [[sx * 10, 10.8, 12.4], [sx * 10 + sx * 2.4, 10.8, 12.4], [sx * 10 + sx * 2.4, 9.3, 12.4], [sx * 10, 9.3, 12.4]], mat(Layer.Plaster2, sx < 0 ? [0.2, 0.4, 1.1] : [1.5, 0.95, 0.2], 2));
    g.tree(sx * 13.6, -6, 0.75, sx);
    g.tree(sx * 13.6, 4, 0.7, sx * 2);
    shrub(g, sx * 9.4, 7.4, 0.7);
  }
}

/** Deck height of the elevated metro above the station pad (matches METRO.height). */
export const METRO_DECK = 19;

/**
 * Elevated metro station (modern Indian metro style): sculptural vaulted steel-and-glass
 * canopy over the viaduct platform, platform screen-door glazing, glowing teal fascia,
 * glazed concourse with cantilevered entrance canopy, and a covered lift/escalator tower.
 */
function metroStation(l: Lot): void {
  const { g, W, D } = l;
  ground(l, PAVING);
  // Platform slab and the columns that carry it.
  const teal: RGB = [0.05, 0.58, 0.66];
  const amber: RGB = [0.95, 0.66, 0.1];
  const steel = mat(Layer.Metal, [1.3, 1.35, 1.42], 2.2);
  const glass = mat(Layer.ConcreteWall, [0.42, 0.64, 0.78], 2.6);
  const deck = mat(Layer.Concrete, [1.34, 1.34, 1.32], 3);
  const hw = W / 2 - 0.5;
  const hd = D / 2 - 0.5;

  for (const [x, z] of [
    [-hw + 1.2, -hd + 1.2],
    [hw - 1.2, -hd + 1.2],
    [-hw + 1.2, hd - 1.2],
    [hw - 1.2, hd - 1.2],
  ] as const) {
    g.cyl(x, z, 0.62, 0.54, 0, METRO_DECK - 2.0, 12, CONCRETE);
    g.box(x - 0.95, z - 0.95, x + 0.95, z + 0.95, METRO_DECK - 2.0, METRO_DECK - 1.2, WHITE_TRIM);
  }

  g.box(-hw, -hd, hw, hd, METRO_DECK - 1.2, METRO_DECK - 0.1, deck);
  // Platform edge strips and benches.
  // Canopy on slender posts.
  g.box(-hw - 0.1, -hd - 0.08, hw + 0.1, hd + 0.08, METRO_DECK - 0.6, METRO_DECK - 0.15, mat(Layer.Plaster2, teal, 3), SIGN, null);
  g.flat(-hw, -hd, hw, -hd + 0.45, METRO_DECK - 0.07, mat(Layer.Concrete, [2.1, 1.85, 0.35], 3));
  g.flat(-hw, hd - 0.45, hw, hd, METRO_DECK - 0.07, mat(Layer.Concrete, [2.1, 1.85, 0.35], 3));

  g.walls(-hw + 1.2, -hd + 0.5, hw - 1.2, -hd + 0.62, METRO_DECK - 0.1, METRO_DECK + 1.45, glass, win(Style.Curtain, 2.0, 1.5, 0.6));
  g.walls(-hw + 1.2, hd - 0.62, hw - 1.2, hd - 0.5, METRO_DECK - 0.1, METRO_DECK + 1.45, glass, win(Style.Curtain, 2.0, 1.5, 0.6));
  for (const bx of [-3.2, 3.2]) g.box(bx - 1.2, -0.4, bx + 1.2, 0.4, METRO_DECK - 0.1, METRO_DECK + 0.45, steel);

  for (const x of [-hw + 1.4, 0, hw - 1.4]) {
    g.cyl(x, -2.0, 0.16, 0.16, METRO_DECK - 0.1, METRO_DECK + 3.9, 8, steel);
    g.cyl(x, 2.0, 0.16, 0.16, METRO_DECK - 0.1, METRO_DECK + 3.9, 8, steel);
    g.box(x - 0.14, -hd - 0.4, x + 0.14, hd + 0.4, METRO_DECK + 3.7, METRO_DECK + 4.1, steel);
  }
  // Ticket hall at the front, glazed, with the line colour band.
  const roofMat = mat(Layer.Metal, [1.55, 1.58, 1.62], 2.5);
  const ry0 = METRO_DECK + 3.8;
  const ry1 = METRO_DECK + 5.1;
  const ry2 = METRO_DECK + 5.65;
  g.poly([[-hw - 0.6, ry0, -hd - 0.5], [hw + 0.6, ry0, -hd - 0.5], [hw + 0.6, ry1, -hd * 0.45], [-hw - 0.6, ry1, -hd * 0.45]], roofMat);
  g.poly([[-hw - 0.6, ry1, -hd * 0.45], [hw + 0.6, ry1, -hd * 0.45], [hw + 0.6, ry2, 0], [-hw - 0.6, ry2, 0]], glass, win(Style.Curtain, 2.2, 3.0, 0.7));
  g.poly([[-hw - 0.6, ry2, 0], [hw + 0.6, ry2, 0], [hw + 0.6, ry1, hd * 0.45], [-hw - 0.6, ry1, hd * 0.45]], glass, win(Style.Curtain, 2.2, 3.0, 0.7));
  g.poly([[-hw - 0.6, ry1, hd * 0.45], [hw + 0.6, ry1, hd * 0.45], [hw + 0.6, ry0, hd + 0.5], [-hw - 0.6, ry0, hd + 0.5]], roofMat);
  g.box(-hw - 0.3, -0.35, hw + 0.3, 0.35, ry2, ry2 + 0.55, mat(Layer.Plaster2, teal, 3), SIGN, CONCRETE_DARK);

  const z1 = D / 2 - 0.8;
  // Glazed lift and stair tower from the hall up to the platform.
  const z0 = z1 - 5.4;
  g.walls(-4.8, z0, 4.8, z1, 0, 4.4, mat(Layer.ConcreteWall, [0.46, 0.52, 0.58], 2), win(Style.Storefront, 1.6, 4.4, 0.6));
  g.box(-5.3, z0 - 0.3, 5.3, z1 + 1.4, 4.4, 5.0, mat(Layer.Plaster2, teal, 3), NO_WIN, CONCRETE_DARK);
  g.box(-5.3, z1 + 1.32, 5.3, z1 + 1.44, 4.42, 4.65, mat(Layer.Plaster2, amber, 3), SIGN);
  signBoard(g, -2.4, 2.4, z1 + 1.38, 5.05, 6.4, teal);
  const tx0 = 4.6;
  const tx1 = W / 2 - 0.4;
  const tz0 = z0 - 4.6;
  const tz1 = z0 + 0.6;
  g.walls(tx0, tz0, tx1, tz1, 0, METRO_DECK + 3.2, glass, win(Style.Curtain, 1.4, 3.2, 0.7));
  g.box(tx0 - 0.25, tz0 - 0.25, tx1 + 0.25, tz1 + 0.25, METRO_DECK + 3.2, METRO_DECK + 3.8, mat(Layer.Plaster2, teal, 3), NO_WIN, CONCRETE_DARK);

  g.box(-W / 2 + 0.6, D / 2 - 2.4, -5.2, D / 2 - 0.8, 0, 0.42, CONCRETE, NO_WIN, LAWN);
  g.tree(-W / 2 + 1.6, D / 2 - 1.6, 0.44, 0.3);
}

/**
 * Flagship Indian IT Park campus: landscaped podium with reflection pool, three stepped
 * glass towers with sun-louvre fins and a glazed skybridge connecting the main blocks,
 * glowing corporate monolith sign, security cabin and visitor parking.
 */
function itPark(l: Lot): void {
  const { g, r, W, D } = l;
  ground(l, PAVING);
  const glassBlue = mat(Layer.ConcreteWall, [0.34, 0.58, 0.82], 2.6);
  const glassTeal = mat(Layer.ConcreteWall, [0.28, 0.64, 0.62], 2.6);
  const frame = mat(Layer.ConcreteWall, [1.28, 1.3, 1.32], 3);
  const darkFrame = mat(Layer.Metal, [0.46, 0.5, 0.56], 2.5);
  const signBlue: RGB = [0.08, 0.48, 0.96];
  const signCyan: RGB = [0.06, 0.72, 0.82];
  const fh = 3.8;

  const towers: Array<[number, number, number, number, number, Mat]> = [
    [-W / 2 + 1.8, -D / 2 + 1.8, -W / 2 + 13.4, -D / 2 + 13.4, 11 + r.int(3), glassBlue],
    [W / 2 - 12.6, -D / 2 + 1.8, W / 2 - 1.8, -D / 2 + 11.4, 8 + r.int(3), glassTeal],
    [W / 2 - 11.6, -D / 2 + 13.8, W / 2 - 1.8, -D / 2 + 21.6, 5 + r.int(2), glassBlue],
  ];
  // Podium joining the towers.

  g.walls(-W / 2 + 1.8, -D / 2 + 1.8, W / 2 - 1.8, -D / 2 + 10.2, 0, 5.2, frame, win(Style.Storefront, 2.8, 5.2, 0.58));
  flatRoof(g, -W / 2 + 1.8, -D / 2 + 1.8, W / 2 - 1.8, -D / 2 + 10.2, 5.2, frame, LAWN, 0.95);

  for (let idx = 0; idx < towers.length; idx++) {
    const [x0, z0, x1, z1, floors, m] = towers[idx]!;
    const top = floors * fh;
    g.walls(x0, z0, x1, z1, 0, top, m, win(Style.Curtain, 1.65, fh, 0.62));
    for (const [cx, cz] of [[x0, z0], [x1, z0], [x1, z1], [x0, z1]] as const) {
      g.box(cx - 0.35, cz - 0.35, cx + 0.35, cz + 0.35, 0, top + 0.9, frame);
    }
    const midX = (x0 + x1) * 0.5;
    g.box(midX - 0.16, z1, midX + 0.16, z1 + 0.45, 5.2, top + 0.9, frame);
    if (floors >= 8) {
      const my = Math.floor(floors * 0.5) * fh;
      g.box(x0 - 0.18, z0 - 0.18, x1 + 0.18, z1 + 0.18, my - 0.18, my + 0.18, darkFrame);
    }
    flatRoof(g, x0, z0, x1, z1, top, frame, roofFinish(r), 1.0);
    rooftop(l, x0, z0, x1, z1, top, frame);
    // Crown: a slim fin on top of the tallest.

    if (idx === 0) {
      g.box(x1 - 2.4, z0 + 0.6, x1 - 0.8, z1 - 0.6, top, top + 5.6, frame);
      g.box(x0 + 0.6, z1 - 0.3, x1 - 0.6, z1 + 0.15, top, top + 2.6, darkFrame);
      g.box(x0 + 1.4, z1 + 0.15, x1 - 1.4, z1 + 0.32, top + 0.6, top + 2.1, mat(Layer.Plaster2, signCyan, 3), SIGN);
    } else if (idx === 1) {
      g.box(x0 + 0.8, z1 - 0.3, x1 - 0.8, z1 + 0.1, top, top + 2.2, frame);
    }
  }
  // Plaza, the sign and parking at the front.

  const sbY = 5 * fh;
  g.box(-W / 2 + 13.4, -D / 2 + 4.8, W / 2 - 12.6, -D / 2 + 8.6, sbY, sbY + 3.4, glassBlue, win(Style.Curtain, 1.6, 3.4, 0.7), frame);

  g.flat(-W / 2 + 1.8, -D / 2 + 13.8, W / 2 - 13.2, D / 2 - 9.2, 0.04, mat(Layer.Pavement, [1.26, 1.24, 1.18], 3));
  g.box(-W / 2 + 3.4, -D / 2 + 15.2, -W / 2 + 11.4, -D / 2 + 20.0, 0.04, 0.38, WHITE_TRIM, NO_WIN, mat(Layer.ConcreteWall, [0.16, 0.52, 0.68], 3));

  g.box(-W / 2 + 2.4, D / 2 - 8.7, -W / 2 + 12.2, D / 2 - 8.15, 0, 2.5, darkFrame);
  g.box(-W / 2 + 2.8, D / 2 - 8.15, -W / 2 + 11.8, D / 2 - 8.0, 0.6, 2.15, mat(Layer.Plaster2, signBlue, 3), SIGN);
  parking(g, -W / 2 + 1.0, D / 2 - 7.5, W / 2 - 4.2, D / 2 - 1.0);
  g.walls(W / 2 - 3.6, D / 2 - 4.0, W / 2 - 1.2, D / 2 - 1.6, 0, 2.8, frame, win(Style.Storefront, 2.4, 2.4, 0.55));
  g.box(W / 2 - 3.8, D / 2 - 4.2, W / 2 - 1.0, D / 2 - 1.4, 2.8, 3.05, darkFrame);

  for (let k = 0; k < 5; k++) g.tree(-W / 2 + 3.5 + k * 3.8, -D / 2 + 14.5 + (k % 2) * 5.2, 0.52 + r.next() * 0.2, k * 1.1);
}

/**
 * University / college campus: heritage sandstone main academic hall with colonnaded
 * portico & clock tower, brick teaching wings with chhajjas, landscaped central quad with
 * fountain plaza, and an arched campus entrance gate.
 */
function university(l: Lot): void {
  const { g, r, W, D } = l;
  ground(l, LAWN);
  const stone = mat(Layer.ConcreteWall, [1.48, 1.38, 1.22], 3);
  const brick = mat(Layer.Brick, [1.26, 0.96, 0.84], 2);
  const slate = mat(Layer.Roof2, [0.85, 0.68, 0.6], 2.8);
  const copper = mat(Layer.Metal, [0.55, 1.02, 0.86], 2);
  // Main hall across the back.
  // Clock tower in the middle of the hall.
  // Teaching wings down both sides.
  const navy: RGB = [0.12, 0.2, 0.5];
  const fh = 4.0;

  const hz0 = -D / 2 + 2.0;
  const hz1 = hz0 + 10.2;
  g.walls(-W / 2 + 4.8, hz0, W / 2 - 4.8, hz1, 0, 0.8, CONCRETE_DARK);
  g.walls(-W / 2 + 4.8, hz0, W / 2 - 4.8, hz1, 0.8, 0.8 + 3 * fh, stone, win(Style.Punched, fitBay(W - 9.6, 3.1), fh, 0.45));
  chhajja(g, -W / 2 + 4.8, W / 2 - 4.8, hz1, 0.8 + 0.8 * fh, 0.5, WHITE_TRIM, 'front');
  chhajja(g, -W / 2 + 4.8, W / 2 - 4.8, hz1, 0.8 + 1.8 * fh, 0.5, WHITE_TRIM, 'front');
  g.gable(-W / 2 + 4.8, hz0, W / 2 - 4.8, hz1, 0.8 + 3 * fh, 3.6, true, 0.5, slate, stone);

  g.stair(-3.2, hz1 + 2.0, 3.2, hz1 + 3.4, 0, 0.8, 4, CONCRETE);
  g.box(-2.8, hz1 - 3.0, 2.8, hz1 + 2.2, 0, 23, stone, win(Style.Punched, 2.8, 4, 0.35), null);
  g.box(-3.2, hz1 - 3.4, 3.2, hz1 + 2.6, 23, 24.2, WHITE_TRIM);
  g.cyl(0, hz1 - 0.4, 2.7, 0.2, 24.2, 30.5, 8, copper, null);
  g.box(-1.15, hz1 + 2.25, 1.15, hz1 + 2.42, 17.5, 19.8, mat(Layer.Plaster2, [1.9, 1.85, 1.6], 3), SIGN, null);

  for (const side of [-1, 1]) {
    const x0 = side < 0 ? -W / 2 + 1.8 : W / 2 - 10.8;
    const x1 = x0 + 9.0;
    const z0 = hz1 + 2.2;
    const z1 = D / 2 - 6.2;
    g.walls(x0, z0, x1, z1, 0, 0.6, CONCRETE_DARK);
    g.walls(x0, z0, x1, z1, 0.6, 0.6 + 2 * fh, brick, win(Style.Punched, 3.0, fh, 0.46));
    chhajja(g, z0 + 0.2, z1 - 0.2, side < 0 ? x1 : x0, 0.6 + 0.8 * fh, 0.46, WHITE_TRIM, side < 0 ? 'right' : 'left');
    chhajja(g, z0 + 0.2, z1 - 0.2, side < 0 ? x1 : x0, 0.6 + 1.8 * fh, 0.46, WHITE_TRIM, side < 0 ? 'right' : 'left');
    g.gable(x0, z0, x1, z1, 0.6 + 2 * fh, 2.6, false, 0.45, slate, brick);
  }
  // The quad: crossing paths and trees.

  const qx0 = -W / 2 + 11.4;
  const qx1 = W / 2 - 11.4;
  const qz = (hz1 + D / 2) * 0.5;
  g.flat(-1.4, hz1 + 2.2, 1.4, D / 2 - 0.4, 0.04, PAVING);
  g.flat(qx0, qz - 1.1, qx1, qz + 1.1, 0.04, PAVING);
  g.cyl(0, qz, 3.4, 3.4, 0.04, 0.08, 16, PAVING);
  g.cyl(0, qz, 2.0, 2.0, 0.08, 0.55, 14, WHITE_TRIM, mat(Layer.ConcreteWall, [0.18, 0.52, 0.66], 3));
  g.cyl(0, qz, 0.26, 0.16, 0.55, 1.8, 8, WHITE_TRIM);

  for (let k = 0; k < 6; k++) {
    const x = (k % 2 ? qx1 - 2.6 : qx0 + 2.6) + (r.next() - 0.5);
    const z = hz1 + 5.8 + Math.floor(k / 2) * 7.0;
    g.tree(x, z, 0.62 + r.next() * 0.25, k * 1.3);
  }
  // Gate with the name.

  compoundWall(g, -W / 2 + 0.4, -D / 2 + 0.4, W / 2 - 0.4, D / 2 - 0.4, 1.6, stone, WHITE_TRIM, {
    cx: 0,
    w: 7.4,
    gateMat: IRON_DARK,
    overhead: true,
  });
  g.box(-3.6, D / 2 - 0.55, 3.6, D / 2 - 0.18, 3.25, 4.15, mat(Layer.Plaster2, navy, 3), SIGN, stone);
  flagpole(g, 7.2, D / 2 - 2.2, navy);
}

/**
 * Regional shopping mall (10 x 8 cells, ~80 m x 64 m): glazed curved atrium entrance with
 * barrel-vault skylight, flanking anchor-store blocks with vertical fins and glowing LED
 * billboards, rooftop food-court terrace, integrated multi-level car park (MLCP) + surface
 * parking, and a landscaped front fountain plaza with a mall totem sign.
 */
function shoppingMall(l: Lot): void {
  const { g, r, W, D } = l;
  ground(l, PAVING);

  const hw = W / 2;
  const hd = D / 2;
  const stone = mat(Layer.ConcreteWall, [1.28, 1.24, 1.16], 3);
  const warmStone = SANDSTONE;
  const darkMetal = mat(Layer.Metal, [0.36, 0.4, 0.46], 2.5);
  const glass = mat(Layer.ConcreteWall, [0.36, 0.58, 0.78], 2.6);
  const glassWarm = mat(Layer.ConcreteWall, [0.56, 0.48, 0.4], 2.6);
  const brandA: RGB = [0.92, 0.2, 0.16];
  const brandB: RGB = [0.1, 0.46, 0.88];
  const brandC: RGB = [0.96, 0.62, 0.08];
  const brandD: RGB = [0.64, 0.16, 0.62];

  const mlcpW = Math.min(18, W * 0.24);
  const mallX0 = -hw + 3.0;
  const mallX1 = hw - 3.0 - mlcpW - 1.5;
  const mallW = mallX1 - mallX0;
  const mallCx = (mallX0 + mallX1) * 0.5;

  const plazaDepth = Math.min(18, D * 0.28);
  const mallZ1 = hd - plazaDepth;
  const mallZ0 = -hd + 5.5;
  const mallD = mallZ1 - mallZ0;

  const mallH = 15.6;
  const fh = 5.2;

  const atriumW = Math.min(18, mallW * 0.34);
  const ax0 = mallCx - atriumW * 0.5;
  const ax1 = mallCx + atriumW * 0.5;

  const wings: Array<[number, number, Mat, RGB, RGB]> = [
    [mallX0, ax0, stone, brandA, brandC],
    [ax1, mallX1, warmStone, brandB, brandD],
  ];

  for (const [wx0, wx1, wMat, sign1, sign2] of wings) {
    const ww = wx1 - wx0;
    const wH = mallH + 1.2;
    const frontStore = win(Style.Storefront, fitBay(ww, 4.4), fh, 0.6);
    const upperBand = win(Style.Ribbon, fitBay(ww, 3.8), fh, 0.45);
    g.walls(wx0, mallZ0, wx1, mallZ1, 0, fh, darkMetal, [NO_WIN, frontStore, frontStore, frontStore]);
    g.walls(wx0, mallZ0, wx1, mallZ1, fh, wH, wMat, [NO_WIN, upperBand, upperBand, upperBand]);
    g.box(wx0 - 0.25, mallZ1, wx1 + 0.25, mallZ1 + 0.7, fh - 0.2, fh + 0.35, darkMetal);
    const fins = Math.max(3, Math.round(ww / 3.8));
    for (let i = 1; i < fins; i++) {
      const fx = wx0 + (ww * i) / fins;
      g.box(fx - 0.18, mallZ1, fx + 0.18, mallZ1 + 0.65, fh + 0.35, wH + 0.9, darkMetal);
    }
    flatRoof(g, wx0, mallZ0, wx1, mallZ1, wH, wMat, roofFinish(r), 1.1);
    rooftop(l, wx0, mallZ0, wx1, mallZ1, wH, wMat);

    const bx = (wx0 + wx1) * 0.5;
    const bw = Math.min(8.5, ww * 0.52);
    g.box(bx - bw * 0.5, mallZ1 + 0.55, bx + bw * 0.5, mallZ1 + 0.85, fh + 1.6, fh + 5.6, mat(Layer.Plaster2, sign1, 3), SIGN, darkMetal);
    g.box(bx - bw * 0.42, mallZ1 + 0.55, bx + bw * 0.42, mallZ1 + 0.85, fh + 6.4, fh + 9.2, mat(Layer.Plaster2, sign2, 3), SIGN, darkMetal);

    if (ww > 10) {
      balcony(g, wx0 + 1.2, wx1 - 1.2, mallZ1, fh + 0.35, 1.8, WHITE_TRIM, IRON_DARK, 'glass', 'front');
    }
  }

  const az1 = mallZ1 + 3.2;
  const atriumH = mallH + 3.2;
  g.walls(ax0, mallZ0, ax1, az1, 0, atriumH, glass, [
    NO_WIN,
    win(Style.Curtain, 2.2, fh, 0.7),
    win(Style.Curtain, fitBay(atriumW, 2.0), fh, 0.75),
    win(Style.Curtain, 2.2, fh, 0.7),
  ]);
  g.box(ax0 - 0.6, mallZ1 - 0.4, ax0 + 0.4, az1 + 0.4, 0, atriumH + 0.8, darkMetal);
  g.box(ax1 - 0.4, mallZ1 - 0.4, ax1 + 0.6, az1 + 0.4, 0, atriumH + 0.8, darkMetal);
  g.box(ax0 - 0.6, az1 - 0.3, ax1 + 0.6, az1 + 0.5, atriumH, atriumH + 1.1, darkMetal);

  const skyY0 = atriumH + 0.6;
  const skyRise = 3.4;
  const segs = 6;
  for (let i = 0; i < segs; i++) {
    const t0 = (i / segs) * Math.PI;
    const t1 = ((i + 1) / segs) * Math.PI;
    const xa = mallCx - Math.cos(t0) * (atriumW * 0.48);
    const ya = skyY0 + Math.sin(t0) * skyRise;
    const xb = mallCx - Math.cos(t1) * (atriumW * 0.48);
    const yb = skyY0 + Math.sin(t1) * skyRise;
    g.poly(
      [
        [xa, ya, mallZ0 + 2],
        [xb, yb, mallZ0 + 2],
        [xb, yb, az1],
        [xa, ya, az1],
      ],
      glassWarm,
      win(Style.Curtain, 2.4, 3.0, 0.65),
    );
  }
  g.box(ax0, mallZ0, ax1, mallZ0 + 2.2, mallH, atriumH + 0.6, stone);

  const canZ1 = az1 + 4.4;
  g.box(ax0 - 1.4, az1, ax1 + 1.4, canZ1, 5.4, 6.2, darkMetal, NO_WIN, GRAVEL_ROOF);
  g.box(ax0 - 1.2, canZ1, ax1 + 1.2, canZ1 + 0.25, 5.45, 6.15, mat(Layer.Plaster2, brandC, 3), SIGN);
  for (const px of [ax0 - 0.9, ax1 + 0.9]) {
    g.cyl(px, canZ1 - 0.7, 0.36, 0.32, 0, 5.4, 10, WHITE_TRIM);
  }
  g.box(mallCx - atriumW * 0.38, az1 + 0.45, mallCx + atriumW * 0.38, az1 + 0.78, atriumH - 2.6, atriumH - 0.3, mat(Layer.Plaster2, brandA, 3), SIGN, darkMetal);
  g.stair(ax0 + 1.2, az1, ax1 - 1.2, az1 + 1.6, 0, 0.55, 4, CONCRETE);

  const px0 = mallX1 + 1.5;
  const px1 = hw - 2.0;
  const pz0 = mallZ0 + 1.0;
  const pz1 = mallZ1;
  const decks = 4;
  const deckH = 3.1;
  const mlcpTop = decks * deckH;

  for (let d = 1; d <= decks; d++) {
    const y = d * deckH;
    g.box(px0, pz0, px1, pz1, y - 0.25, y, CONCRETE);
    g.walls(px0, pz0, px1, pz1, y, y + 1.05, WHITE_TRIM);
  }
  const colRows = Math.max(3, Math.round((pz1 - pz0) / 8));
  for (let i = 0; i <= colRows; i++) {
    const cz = pz0 + 0.4 + ((pz1 - pz0 - 0.8) * i) / colRows;
    g.box(px0 + 0.1, cz - 0.3, px0 + 0.7, cz + 0.3, 0, mlcpTop, CONCRETE_DARK, NO_WIN, null);
    g.box(px1 - 0.7, cz - 0.3, px1 - 0.1, cz + 0.3, 0, mlcpTop, CONCRETE_DARK, NO_WIN, null);
  }
  g.box(px0 - 0.2, pz1 - 4.2, px0 + 3.8, pz1 + 0.3, 0, mlcpTop + 2.8, darkMetal, win(Style.Curtain, 1.8, 3.1, 0.5), GRAVEL_ROOF);
  g.box(px0 + 0.4, pz1 + 0.3, px0 + 3.2, pz1 + 0.52, mlcpTop - 1.0, mlcpTop + 2.0, mat(Layer.Plaster2, brandB, 3), SIGN);
  parking(g, px0 + 1.0, pz0 + 1.0, px1 - 1.0, pz1 - 1.0, mlcpTop + 0.04);

  g.flat(-hw + 1.5, hd - 5.2, hw - 1.5, hd - 0.6, 0.04, ASPHALT);
  g.flat(mallCx - 6.0, canZ1 - 0.5, mallCx + 6.0, hd - 5.0, 0.04, ASPHALT);

  if (ax0 - 2.0 - (-hw + 2.0) > 8) parking(g, -hw + 2.0, mallZ1 + 2.5, ax0 - 2.5, hd - 6.2, 0.04);
  if (hw - 2.0 - (ax1 + 2.5) > 8) parking(g, ax1 + 2.5, mallZ1 + 2.5, hw - 2.0, hd - 6.2, 0.04);

  const fz = Math.min(hd - 7.0, canZ1 + 3.0);
  g.cyl(mallCx, fz, 3.2, 3.2, 0.04, 0.55, 16, WHITE_TRIM, mat(Layer.ConcreteWall, [0.16, 0.56, 0.72], 3));
  g.cyl(mallCx, fz, 0.45, 0.3, 0.55, 1.9, 10, WHITE_TRIM);

  const tx = -hw + 3.2;
  g.box(tx - 1.1, hd - 2.4, tx + 1.1, hd - 1.6, 0, 10.5, darkMetal);
  g.box(tx - 1.15, hd - 1.6, tx + 1.15, hd - 1.42, 6.2, 10.2, mat(Layer.Plaster2, brandA, 3), SIGN);
  g.box(tx - 1.15, hd - 1.6, tx + 1.15, hd - 1.42, 3.6, 5.8, mat(Layer.Plaster2, brandC, 3), SIGN);

  for (let i = 0; i < 6; i++) {
    const lx = -hw + 6.5 + ((W - 13) * i) / 5;
    if (Math.abs(lx - mallCx) < 7.0) continue;
    g.box(lx - 1.2, hd - 6.4, lx + 1.2, hd - 5.2, 0, 0.45, CONCRETE, NO_WIN, LAWN);
    g.tree(lx, hd - 5.8, 0.56 + r.next() * 0.16, i * 1.1);
  }
  for (const sx of [ax0 - 2.0, ax1 + 2.0]) shrub(g, sx, az1 + 1.5, 0.75, [0.9, 0.32, 0.52]);
  if (mallD > 10) g.flat(-hw + 1.5, -hd + 0.8, hw - 1.5, mallZ0 - 0.6, 0.04, ASPHALT);
}

function airport(l: Lot): void {
  const { g, W, D } = l;
  ground(l, mat(Layer.Grass, [0.85, 1.0, 0.75], 6));
  // Work in "runway" coordinates: u along the long side, v across it, v = +vMax at the road.
  const long = W >= D;
  const U = (long ? W : D) / 2;
  const V = (long ? D : W) / 2;
  const at = (u: number, v: number): [number, number] => (long ? [u, v] : [v, -u]);
  const rect = (u0: number, v0: number, u1: number, v1: number): [number, number, number, number] => {
    const [ax, az] = at(u0, v0);
    const [bx, bz] = at(u1, v1);
    return [Math.min(ax, bx), Math.min(az, bz), Math.max(ax, bx), Math.max(az, bz)];
  };
  const flat = (u0: number, v0: number, u1: number, v1: number, y: number, m: Mat): void => {
    const [x0, z0, x1, z1] = rect(u0, v0, u1, v1);
    g.flat(x0, z0, x1, z1, y, m);
  };
  const box = (u0: number, v0: number, u1: number, v1: number, y0: number, y1: number, m: Mat, w: Parameters<Geo['box']>[7] = NO_WIN, top?: Mat | null): void => {
    const [x0, z0, x1, z1] = rect(u0, v0, u1, v1);
    g.box(x0, z0, x1, z1, y0, y1, m, w, top);
  };
  const tarmac = mat(Layer.Asphalt, [0.82, 0.82, 0.84], 3);
  const apronMat = mat(Layer.Concrete, [1.12, 1.12, 1.1], 3);
  const paint = mat(Layer.Concrete, [2.2, 2.2, 2.15], 3);
  const yellow = mat(Layer.Concrete, [2.0, 1.6, 0.3], 3);
  // Runway on the far side of the site.
  const rv = -V + 14;
  const rw = 11;
  flat(-U + 6, rv - rw, U - 6, rv + rw, 0.06, tarmac);
  // Centre-line dashes, threshold bars and aiming points.
  for (let u = -U + 30; u < U - 30; u += 18) flat(u, rv - 0.35, u + 9, rv + 0.35, 0.08, paint);
  for (const end of [-1, 1]) {
    const u0 = end < 0 ? -U + 8 : U - 20;
    for (let k = -4; k <= 4; k++) flat(u0, rv + k * 2.2 - 0.6, u0 + 12, rv + k * 2.2 + 0.6, 0.08, paint);
    const ua = end < 0 ? -U + 48 : U - 62;
    flat(ua, rv - 6, ua + 14, rv - 4, 0.08, paint);
    flat(ua, rv + 4, ua + 14, rv + 6, 0.08, paint);
  }
  // Edge lights.
  const light = mat(Layer.Concrete, [3.2, 3.0, 2.2], 3);
  for (let u = -U + 8; u <= U - 8; u += 14) {
    for (const side of [-1, 1]) {
      const [x, z] = at(u, rv + side * (rw + 0.8));
      g.box(x - 0.2, z - 0.2, x + 0.2, z + 0.2, 0, 0.45, light);
    }
  }
  // Taxiway parallel to the runway, with links at both ends.
  const tv = rv + rw + 14;
  flat(-U + 18, tv - 4.5, U - 18, tv + 4.5, 0.05, tarmac);
  for (let u = -U + 22; u < U - 22; u += 10) flat(u, tv - 0.2, u + 5, tv + 0.2, 0.07, yellow);
  for (const end of [-1, 1]) {
    const u0 = end < 0 ? -U + 18 : U - 27;
    flat(u0, rv + rw, u0 + 9, tv, 0.05, tarmac);
  }
  // Apron between the taxiway and the terminal.
  const av0 = tv + 4.5;
  const av1 = V - 18;
  flat(-U + 30, av0, U - 30, av1, 0.05, apronMat);
  for (let u = -U + 60; u < U - 60; u += 34) flat(u - 0.2, av0, u + 0.2, av1, 0.07, yellow);
  // Terminal: a long glass hall with a deep roof, facing the road.
  const glass = mat(Layer.Metal, [0.55, 0.78, 0.95], 2.4);
  const frame = mat(Layer.Concrete, [1.5, 1.5, 1.48], 3);
  const tu0 = -U * 0.32;
  const tu1 = U * 0.32;
  box(tu0, av1, tu1, V - 4, 0, 9, glass, win(Style.Curtain, 2.4, 4.5, 0.7), frame);
  box(tu0 - 2, av1 - 2, tu1 + 2, V - 2.5, 9, 10, mat(Layer.Metal, [1.45, 1.47, 1.5], 2.5));
  // Jet bridges reaching out to the apron.
  for (const u of [tu0 + 14, 0, tu1 - 14]) box(u - 1.6, av1 - 16, u + 1.6, av1, 3, 6, frame, win(Style.Ribbon, 2, 3, 0.5));
  // Control tower beside the terminal.
  const [cx, cz] = at(tu1 + 16, av1 + 6);
  g.cyl(cx, cz, 2.6, 2.2, 0, 30, 12, frame);
  g.cyl(cx, cz, 4.6, 4.2, 30, 35, 12, glass, null);
  g.cyl(cx, cz, 4.9, 4.9, 35, 36, 12, frame);
  // Cargo shed at the other end of the apron.
  box(-U + 34, av0 + 6, -U * 0.45, av1 - 2, 0, 11, mat(Layer.Metal, [0.95, 0.98, 1.02], 2.2), win(Style.Industrial, 6, 11, 0.3), mat(Layer.Roof3, [0.8, 0.82, 0.86], 3));
  // Parked aircraft at the gates.
  const white = mat(Layer.Plaster2, [1.9, 1.9, 1.88], 3);
  const tail = mat(Layer.Plaster2, [0.2, 0.45, 1.3], 3);
  for (const u of [tu0 + 14, 0, tu1 - 14]) {
    const nose = av1 - 17;
    const tailV = nose - 28;
    // Fuselage along v, wings across u, fin at the tail.
    box(u - 2, tailV, u + 2, nose, 1.6, 5.4, white);
    box(u - 14, tailV + 11, u + 14, tailV + 15.5, 3.2, 3.6, white);
    box(u - 6, tailV, u + 6, tailV + 3, 4.6, 5.0, white);
    box(u - 0.25, tailV, u + 0.25, tailV + 5, 5.4, 11, tail);
  }
  // Car park and the access road along the front.
  const [px0, pz0, px1, pz1] = rect(tu1 + 26, V - 16, U - 6, V - 2);
  parking(g, px0, pz0, px1, pz1);
  flat(-U + 6, V - 3, U - 6, V - 0.5, 0.04, PAVING);
  flagpole(g, ...at(tu0 - 6, V - 3), [0.2, 0.45, 1.3]);
}

/**
 * Modern Indian city bus shelter: sleek sloped steel-and-glass canopy, glowing route/ad
 * lightbox, slatted seating bench, yellow kerb tactile strip, planter and illuminated flag.
 */
function busStop(l: Lot): void {
  const { g, W, D } = l;
  ground(l, PAVING);
  const steel = mat(Layer.Metal, [0.46, 0.5, 0.56], 2.2);
  const roof = mat(Layer.Metal, [1.45, 1.48, 1.52], 2.5);
  const glass = mat(Layer.ConcreteWall, [0.46, 0.72, 0.9], 2.4);
  const red: RGB = [0.85, 0.12, 0.08];
  const amber: RGB = [0.96, 0.68, 0.1];
  const kerb = D / 2;
  // Back wall of glass between two posts, and the roof.
  // Bench and the timetable board.
  // The stop flag at the kerb.
  const z0 = kerb - 3.3;
  const x0 = -W / 2 + 1.0;
  const x1 = W / 2 - 1.0;

  g.flat(-W / 2 + 0.2, kerb - 0.35, W / 2 - 0.2, kerb - 0.1, 0.04, mat(Layer.Concrete, [2.1, 1.75, 0.25], 3));

  for (const x of [x0, (x0 + x1) * 0.5, x1]) g.box(x - 0.08, z0 - 0.08, x + 0.08, z0 + 0.08, 0, 2.75, steel);
  g.walls(x0, z0 - 0.05, x1, z0 + 0.05, 0.25, 2.45, glass, win(Style.Curtain, 1.4, 2.2, 0.8));
  g.poly(
    [
      [x0 - 0.35, 2.65, z0 - 0.35],
      [x1 + 0.35, 2.65, z0 - 0.35],
      [x1 + 0.35, 2.9, z0 + 1.75],
      [x0 - 0.35, 2.9, z0 + 1.75],
    ],
    roof,
  );
  g.box(x0 - 0.35, z0 + 1.65, x1 + 0.35, z0 + 1.78, 2.62, 2.95, mat(Layer.Plaster2, red, 3), SIGN, null);

  g.box(x0 + 0.55, z0 + 0.25, x1 - 1.5, z0 + 0.72, 0.44, 0.54, mat(Layer.Metal, [0.75, 0.78, 0.82], 2));
  g.box(x1 - 1.15, z0 + 0.08, x1 - 0.25, z0 + 0.24, 0.35, 2.25, mat(Layer.Plaster2, [1.65, 1.62, 1.5], 3), SIGN, steel);

  g.cyl(x1 + 0.25, kerb - 0.55, 0.06, 0.05, 0, 3.3, 8, steel);
  g.box(x1 - 0.12, kerb - 0.62, x1 + 0.62, kerb - 0.48, 2.6, 3.2, mat(Layer.Plaster2, amber, 3), SIGN, null);
  shrub(g, x0 - 0.4, z0 + 0.4, 0.35);
}

/** A red cross on a white square plate, standing on a front (+z) face. */
function redCross(g: Geo, cx: number, cy: number, z: number, s: number): void {
  const red = mat(Layer.Plaster2, [1.9, 0.16, 0.14], 3);
  g.box(cx - s / 2, z, cx + s / 2, z + 0.12, cy - s / 2, cy + s / 2, mat(Layer.Plaster2, [1.6, 1.6, 1.58], 3), SIGN, null);
  g.box(cx - s * 0.12, z + 0.12, cx + s * 0.12, z + 0.2, cy - s * 0.36, cy + s * 0.36, red, SIGN, null);
  g.box(cx - s * 0.36, z + 0.12, cx + s * 0.36, z + 0.2, cy - s * 0.12, cy + s * 0.12, red, SIGN, null);
}

/** An ambulance parked along z, nose toward the road. */
function ambulance(g: Geo, x: number, z: number): void {
  const body = mat(Layer.Plaster2, [1.55, 1.55, 1.52], 3);
  g.box(x - 1.0, z - 2.6, x + 1.0, z + 1.4, 0.35, 2.55, body, NO_WIN, body);
  g.box(x - 1.0, z + 1.4, x + 1.0, z + 2.6, 0.35, 1.65, body, NO_WIN, body);
  g.box(x - 0.9, z + 1.38, x + 0.9, z + 1.45, 1.65, 2.35, mat(Layer.Metal, [0.3, 0.4, 0.5], 2));
  g.box(x - 1.02, z - 2.6, x + 1.02, z + 2.6, 1.1, 1.35, mat(Layer.Plaster2, [1.8, 0.2, 0.16], 3));
  g.box(x - 0.5, z + 1.0, x + 0.5, z + 1.3, 2.55, 2.75, mat(Layer.Plaster2, [0.3, 0.5, 1.9], 3), SIGN, null);
  for (const [wx, wz] of [[-0.95, -1.7], [0.95, -1.7], [-0.95, 1.8], [0.95, 1.8]] as const) g.cyl(x + wx, z + wz, 0.36, 0.36, 0, 0.72, 6, STEEL_DARK);
}

/**
 * A multi-speciality hospital in the style of the homes: a white ward tower with chhajja
 * sunshades and a glazed lift core, a helipad and water tanks on the roof, a two-storey OPD
 * podium with a green terrace, a porte-cochere for drop-off, an emergency wing with its own
 * canopy and an ambulance, oxygen tanks in the service yard, and a gated, landscaped
 * compound with parking.
 */
function hospital(l: Lot): void {
  const { g, r, W, D } = l;
  ground(l, PAVING);
  const white = mat(Layer.Plaster2, vary(r, [1.36, 1.34, 1.28], 0.04), 3);
  const accentTint = pick(r, [[0.3, 0.78, 0.82], [0.32, 0.55, 0.95], [0.42, 0.8, 0.55]] as const);
  const accent = mat(Layer.Plaster2, accentTint, 3);
  const glass = mat(Layer.Metal, [accentTint[0] * 1.5, accentTint[1] * 1.3, accentTint[2] * 1.25], 2.6);
  const red: RGB = [0.85, 0.1, 0.08];

  // Compound wall with a gated entrance on the road side.
  const gateX = -W * 0.12;
  compoundWall(g, -W / 2 + 0.4, -D / 2 + 0.4, W / 2 - 0.4, D / 2 - 0.4, 1.5, white, accent, { cx: gateX, w: 9, overhead: true });

  const fh = 3.6;
  const plinth = 0.6;
  const tw = Math.min(W - 9, 36);
  const tx0 = -tw / 2;
  const tx1 = tw / 2;
  const tz0 = -D / 2 + 3.5;
  const tz1 = tz0 + Math.min(15, D * 0.3);
  const floors = 7 + r.int(2);
  const top = plinth + floors * fh;

  // Ward tower in two steps: a tall block and a lower one, joined by a glazed lift core.
  const cx = tx0 + tw * 0.6;
  const lowTop = top - 2 * fh;
  const blocks: Array<[number, number, number]> = [
    [tx0, cx - 2.6, top],
    [cx + 2.6, tx1, lowTop],
  ];
  for (const [x0, x1, yTop] of blocks) {
    g.walls(x0, tz0, x1, tz1, 0, plinth, CONCRETE_DARK);
    g.walls(x0, tz0, x1, tz1, plinth, yTop, white, win(Style.Ribbon, fitBay(x1 - x0, 2.8), fh, 0.5));
    for (let y = plinth + fh * 1.78; y < yTop - 0.5; y += fh) {
      chhajja(g, x0, x1, tz1, y, 0.55, WHITE_TRIM, 'front');
      chhajja(g, x0, x1, tz0, y, 0.55, WHITE_TRIM, 'back');
    }
    flatRoof(g, x0, tz0, x1, tz1, yTop, white, mat(Layer.Concrete, [1.35, 1.35, 1.32], 3), 0.9);
    // Crown: an accent fascia wrapping the top floor.
    g.box(x0 - 0.35, tz0 - 0.35, x1 + 0.35, tz1 + 0.35, yTop - 0.35, yTop + 0.95, accent, NO_WIN, null);
  }
  // Vertical fins on the tall block's front.
  const fins = Math.max(2, Math.round((cx - 2.6 - tx0) / 4.5));
  for (let i = 0; i <= fins; i++) {
    const fx = tx0 + 0.15 + ((cx - 2.6 - tx0 - 0.3) * i) / fins;
    g.box(fx - 0.14, tz1, fx + 0.14, tz1 + 0.75, plinth + fh, top - 0.35, WHITE_TRIM, NO_WIN, null);
  }
  g.box(cx - 2.6, tz0 + 0.6, cx + 2.6, tz1 - 0.2, plinth, top + 2.6, white, NO_WIN, CONCRETE);
  g.box(cx - 2.6, tz1 - 0.2, cx + 2.6, tz1 + 1.4, plinth, top + 3.6, glass, win(Style.Curtain, 1.3, fh, 0.6), CONCRETE);
  redCross(g, cx, top + 1.7, tz1 + 1.4, 2.6);
  // Lit name board high on the tall block, beside a red cross.
  const bx0 = tx0 + 2;
  const bx1 = Math.min(cx - 5.5, bx0 + 13);
  g.box(bx0, tz1 + 0.75, bx1, tz1 + 0.95, top - fh - 0.1, top - 0.6, mat(Layer.Plaster2, accentTint, 3), SIGN, null);
  redCross(g, bx1 + 1.8, top - fh / 2 - 0.35, tz1 + 0.75, 2.6);

  // Roof: helipad on the tall block; lift room, water tanks and plant on the low one.
  const hx = tx0 + Math.min(6.4, (cx - 2.6 - tx0) / 2);
  const hz = (tz0 + tz1) / 2;
  const pad = Math.min(5.2, (tz1 - tz0) / 2 - 0.8, (cx - 2.6 - tx0) / 2 - 0.8);
  g.cyl(hx, hz, pad, pad, top, top + 0.18, 16, mat(Layer.Concrete, [2.0, 1.6, 0.25], 3));
  g.cyl(hx, hz, pad - 0.45, pad - 0.45, top, top + 0.2, 16, mat(Layer.Asphalt, [0.55, 0.56, 0.6], 4));
  const hm = mat(Layer.Concrete, [2.1, 2.1, 2.05], 3);
  g.flat(hx - 1.6, hz - 2, hx - 1.0, hz + 2, top + 0.22, hm);
  g.flat(hx + 1.0, hz - 2, hx + 1.6, hz + 2, top + 0.22, hm);
  g.flat(hx - 1.0, hz - 0.3, hx + 1.0, hz + 0.3, top + 0.22, hm);
  stairTower(g, tx1 - 7.5, tz0 + 1.2, tx1 - 3.5, tz0 + 5.2, lowTop, 3, white, WHITE_TRIM);
  for (let i = 0; i < 3; i++) waterTank(g, tx1 - 7 + i * 1.5, tz0 + 3.2, lowTop + 3.18, r, 0.85, false);
  for (let i = 0; i < 3; i++) acUnit(g, tx1 - 2.4, tz0 + 2 + i * 2.6, lowTop, 1.1);
  for (let i = 0; i < 2; i++) acUnit(g, cx + 4.5 + i * 3, tz1 - 2.5, lowTop, 1.1);

  // OPD podium in front of the tower, with a green terrace.
  const pz0 = tz1;
  const pz1 = pz0 + 9;
  const px0 = tx0;
  const px1 = tx1 - 10;
  const ph = plinth + 2 * 4.2;
  g.walls(px0, pz0, px1, pz1, 0, plinth, CONCRETE_DARK);
  g.walls(px0, pz0, px1, pz1, plinth, plinth + 4.2, glass, win(Style.Storefront, 3, 4.2, 0.6));
  g.walls(px0, pz0, px1, pz1, plinth + 4.2, ph, white, win(Style.Ribbon, fitBay(px1 - px0, 2.8), 4.2, 0.5));
  chhajja(g, px0, px1, pz1, plinth + 4.2 + 3.3, 0.7, WHITE_TRIM, 'front');
  flatRoof(g, px0, pz0, px1, pz1, ph, white, mat(Layer.Grass, [0.55, 0.85, 0.45], 4), 1.0);
  g.railing(px0 + 0.3, pz1 - 0.2, px1 - 0.3, pz1 - 0.2, ph + 1.0, ph + 1.6, GLASS_RAIL, 2.2, 0.05, false);
  for (let i = 0; i < 4; i++) shrub(g, px0 + 3 + i * ((px1 - px0 - 6) / 3), pz0 + 3, 0.8);
  // Name board along the podium.
  g.box(px0 + 2, pz1 + 0.05, px1 - 2, pz1 + 0.25, plinth + 4.5, plinth + 5.6, mat(Layer.Plaster2, accentTint, 3), SIGN, CONCRETE_DARK);

  // Porte-cochere for drop-off at the main door.
  const dx = (px0 + px1) / 2;
  const cz1 = pz1 + 7;
  g.box(dx - 5.5, pz1, dx + 5.5, cz1, 4.6, 5.1, white, NO_WIN, CONCRETE);
  g.box(dx - 5.6, cz1 - 0.1, dx + 5.6, cz1 + 0.1, 4.3, 5.2, accent);
  for (const ox of [-4.8, 4.8]) g.cyl(dx + ox, cz1 - 0.8, 0.3, 0.3, 0, 4.6, 8, WHITE_TRIM);
  frontPanel(g, dx, pz1, 6, plinth, 3.6, mat(Layer.Metal, [0.45, 0.6, 0.7], 2), win(Style.Storefront, 2, 3, 0.7));
  g.stair(dx - 4, pz1, dx + 4, pz1 + 1.4, 0, plinth, 3, CONCRETE);

  // Emergency wing at the side: single storey, red band, its own canopy and ambulance.
  const ex0 = px1 + 0.6;
  const ex1 = tx1;
  const ez1 = pz1 - 1;
  const eh = 5.2;
  g.walls(ex0, pz0, ex1, ez1, 0, eh, white, win(Style.Ribbon, fitBay(ex1 - ex0, 2.6), eh, 0.5));
  g.walls(ex0 - 0.05, pz0, ex1 + 0.05, ez1 + 0.05, eh - 1.1, eh, mat(Layer.Plaster2, red, 3));
  flatRoof(g, ex0, pz0, ex1, ez1, eh, white, mat(Layer.Concrete, [1.35, 1.35, 1.32], 3));
  const emx = (ex0 + ex1) / 2;
  g.box(ex0 + 0.3, ez1, ex1 - 0.3, ez1 + 6.5, 4.2, 4.55, white, NO_WIN, CONCRETE);
  g.box(ex0 + 0.3, ez1 + 6.4, ex1 - 0.3, ez1 + 6.6, 3.7, 4.55, mat(Layer.Plaster2, red, 3), SIGN, null);
  for (const ox of [ex0 + 0.8, ex1 - 0.8]) g.cyl(ox, ez1 + 6, 0.22, 0.22, 0, 4.2, 8, WHITE_TRIM);
  frontPanel(g, emx, ez1, 4.4, 0, 3.4, mat(Layer.Metal, [0.45, 0.6, 0.7], 2), win(Style.Storefront, 2.2, 3, 0.8));
  redCross(g, ex1 - 1.6, eh + 1.2, ez1 + 0.3, 1.8);
  ambulance(g, emx - 1.4, ez1 + 3.6);

  // Forecourt: a drive along the front, a lane to the gate, parking and a lawn.
  const fz = pz1 + 0.2;
  const lane = Math.min(cz1 + 2.5, D / 2 - 1);
  g.flat(-W / 2 + 1, fz, W / 2 - 1, lane, 0.03, ASPHALT);
  g.flat(gateX - 4, lane, gateX + 4, D / 2 - 0.4, 0.03, ASPHALT);
  g.flat(dx - 1.2, fz + 1.5, dx + 1.2, cz1 - 1, 0.045, mat(Layer.Concrete, [2.0, 1.7, 0.3], 3));
  if (D / 2 - 1 - lane > 4) {
    parking(g, gateX + 4.6, lane + 0.4, W / 2 - 1, D / 2 - 1);
    g.flat(-W / 2 + 1, lane + 0.4, gateX - 4.6, D / 2 - 1, 0.035, LAWN);
    for (let i = 0; i < 3; i++) g.tree(-W / 2 + 3 + i * ((gateX - 6 + W / 2 - 3) / 2), lane + (D / 2 - lane) / 2, 0.6 + r.next() * 0.2, i);
    flagpole(g, gateX - 5.5, D / 2 - 2, [1.6, 0.55, 0.15]);
  }

  // Service yard behind: liquid-oxygen tanks and a generator room; trees along the walls.
  g.cyl(tx1 + 2.2, tz0 + 1.6, 1.0, 1.0, 0, 6.5, 10, mat(Layer.Plaster2, [1.5, 1.5, 1.48], 3));
  g.cyl(tx1 + 2.2, tz0 + 1.6, 1.0, 0.2, 6.5, 7.2, 10, mat(Layer.Plaster2, [1.5, 1.5, 1.48], 3));
  g.box(tx0 - 3.6, tz0 + 1, tx0 - 0.8, tz0 + 6, 0, 3, CONCRETE_DARK, NO_WIN, TAR_ROOF);
  for (let i = 0; i < 4; i++) g.tree(-W / 2 + 4 + i * ((W - 8) / 3), -D / 2 + 1.7, 0.55 + r.next() * 0.2, i + 3);
  for (let i = 0; i < 2; i++) {
    g.tree(-W / 2 + 2.2, tz1 + i * 6, 0.5, i + 7);
    g.tree(W / 2 - 2.2, tz1 + 2 + i * 6, 0.5, i + 9);
  }
}

/** A flat ring on the ground (a painted line or a mowing band), as quads. */
function ring(g: Geo, cx: number, cz: number, r0: number, r1: number, y: number, m: Mat, n = 56): void {
  for (let i = 0; i < n; i++) {
    const a0 = (i / n) * Math.PI * 2;
    const a1 = ((i + 1) / n) * Math.PI * 2;
    g.poly(
      [
        [cx + Math.cos(a0) * r0, y, cz + Math.sin(a0) * r0],
        [cx + Math.cos(a0) * r1, y, cz + Math.sin(a0) * r1],
        [cx + Math.cos(a1) * r1, y, cz + Math.sin(a1) * r1],
        [cx + Math.cos(a1) * r0, y, cz + Math.sin(a1) * r0],
      ],
      m,
    );
  }
}

/** Stepped seating: `tiers` rows rising away from the field edge `edge`, toward `back`. */
function stand(g: Geo, along0: number, along1: number, edge: number, back: number, alongX: boolean, tiers: number, seats: readonly Mat[]): void {
  const dir = Math.sign(back - edge);
  const step = Math.abs(back - edge) / tiers;
  for (let k = 0; k < tiers; k++) {
    const front = edge + dir * step * k;
    const y = 0.75 * (k + 1);
    const top = seats[k % seats.length]!;
    const [z0, z1] = dir > 0 ? [front, back] : [back, front];
    if (alongX) g.box(along0, z0, along1, z1, 0, y, CONCRETE_DARK, NO_WIN, top);
    else g.box(z0, along0, z1, along1, 0, y, CONCRETE_DARK, NO_WIN, top);
  }
}

/**
 * A cricket ground on a 96 m lot: a mown oval with the pitch and its creases in the
 * middle, the 30-yard circle and the boundary rope, advertising boards that light up at
 * night, stands on three sides (the back one roofed, with the scoreboard), a two-storey
 * pavilion facing the field from the road side, sight screens behind both ends of the
 * pitch, four floodlight towers, and a gated compound with parking.
 */
function sportsGround(l: Lot): void {
  const { g, r, W, D } = l;
  const hw = W / 2;
  const hd = D / 2;
  // The field sits a little back from the road, leaving the front for the pavilion.
  const cz = -4;
  const R = Math.min(hw, hd) - 12;
  const grassA = mat(Layer.Grass, [0.74, 1.1, 0.52], 5);
  const grassB = mat(Layer.Grass, [0.6, 0.94, 0.44], 5);
  const pitch = mat(Layer.Dirt, [1.3, 1.14, 0.86], 2.5);
  const roof = mat(Layer.Metal, [1.25, 1.27, 1.3], 2);
  const lamp = mat(Layer.Plaster2, [2.6, 2.55, 2.3], 1);
  const team = pick(r, [
    [0.3, 0.5, 1.15],
    [1.2, 0.55, 0.25],
    [0.35, 0.85, 0.55],
    [1.05, 0.85, 0.3],
  ] as const satisfies readonly RGB[]);
  const seatA = mat(Layer.Concrete, team, 2);
  const seatB = mat(Layer.Concrete, [1.25, 1.25, 1.22], 2);

  // Concourse, then the field in mowing rings, darker and lighter in turn.
  ground(l, mat(Layer.Pavement, [1.08, 1.05, 0.98], 3));
  g.cyl(0, cz, R + 3, R + 3, 0, 0.04, 56, grassB);
  for (let k = 0; k < 7; k++) {
    const rr = R + 1.5 - k * 5;
    if (rr < 3) break;
    g.cyl(0, cz, rr, rr, 0.04 + k * 0.004, 0.044 + k * 0.004, 56, k % 2 ? grassB : grassA, k % 2 ? grassB : grassA);
  }
  const top = 0.08;
  ring(g, 0, cz, R, R + 0.35, top, LINE_WHITE); // boundary rope
  ring(g, 0, cz, 20.4, 20.6, top, LINE_WHITE, 40); // 30-yard circle

  // The pitch runs toward the road; creases and stumps at both ends.
  g.flat(-1.6, cz - 11, 1.6, cz + 11, top + 0.004, pitch);
  for (const s of [-1, 1]) {
    const zc = cz + s * 10.06;
    g.flat(-1.32, zc - 0.03, 1.32, zc + 0.03, top + 0.008, LINE_WHITE);
    g.flat(-1.32, zc - s * 1.25 - 0.03, 1.32, zc - s * 1.25 + 0.03, top + 0.008, LINE_WHITE);
    for (const x of [-0.11, 0, 0.11]) g.cyl(x, zc, 0.02, 0.02, top, top + 0.71, 4, WHITE_TRIM);
  }

  // Advertising boards just inside the rope, lit at night, leaving gaps at the sight screens.
  const boards = [
    [1.25, 0.32, 0.25],
    [0.25, 0.45, 1.25],
    [1.3, 1.05, 0.25],
    [0.3, 1.0, 0.5],
    [1.2, 0.3, 0.8],
  ] as const;
  const n = 40;
  for (let i = 0; i < n; i++) {
    const a0 = ((i + 0.08) / n) * Math.PI * 2;
    const a1 = ((i + 0.92) / n) * Math.PI * 2;
    if (Math.abs(Math.sin((a0 + a1) / 2)) > 0.97) continue;
    const rb = R - 0.6;
    const x0 = Math.cos(a0) * rb;
    const z0 = cz + Math.sin(a0) * rb;
    const x1 = Math.cos(a1) * rb;
    const z1 = cz + Math.sin(a1) * rb;
    const m = mat(Layer.Plaster2, boards[i % boards.length]!, 1);
    g.wall(x0, z0, x1, z1, 0, 0.9, m, SIGN);
    g.wall(x1, z1, x0, z0, 0, 0.9, CONCRETE_DARK);
  }

  // Sight screens behind each end of the pitch.
  g.box(-5.5, cz - R - 1.2, 5.5, cz - R - 0.8, 0, 6, WHITE, NO_WIN, WHITE);
  g.box(-5.5, cz + R + 0.8, 5.5, cz + R + 1.2, 0, 5, WHITE, NO_WIN, WHITE);

  // Stands: back (roofed, with the scoreboard) and both sides.
  const backEdge = cz - R - 2;
  const backWall = -hd + 1.4;
  stand(g, -R + 4, -7, backEdge, backWall, true, 4, [seatA, seatB, seatA, seatB]);
  stand(g, 7, R - 4, backEdge, backWall, true, 4, [seatA, seatB, seatA, seatB]);
  for (const s of [-1, 1]) {
    const roofY = 6.8;
    for (const x of [-R + 4, -7, 7, R - 4]) g.cyl(x, backWall + 0.3, 0.14, 0.14, 0, roofY, 6, METAL_GREY);
    g.box(s < 0 ? -R + 3.5 : 6.5, backWall - 0.3, s < 0 ? -6.5 : R - 3.5, backEdge + 0.8, roofY, roofY + 0.25, roof);
  }
  for (const s of [-1, 1]) stand(g, cz - R + 8, cz + R - 12, s * (R + 2), s * (hw - 1.4), false, 3, [seatB, seatA, seatB]);
  // Scoreboard over the gap in the back stand.
  g.box(-6, backWall, 6, backWall + 1.2, 0, 4, CONCRETE_DARK);
  g.box(-6.5, backWall + 0.2, 6.5, backWall + 1.0, 4, 10, mat(Layer.Concrete, [0.2, 0.22, 0.26], 1), SIGN, CONCRETE_DARK);

  // The pavilion: two storeys facing the field, a balcony, a tiled hip roof, a lit name.
  const pz0 = cz + R + 3;
  const pz1 = Math.min(hd - 3.5, pz0 + 9);
  const px = 13;
  const cream = mat(Layer.Plaster2, [1.36, 1.27, 1.08], 3);
  const ribbon = win(Style.Ribbon, fitBay(px * 2, 3), 3.6, 0.6);
  g.box(-px, pz0, px, pz1, 0, 7.4, cream, ribbon, TAR_ROOF);
  g.hip(-px - 0.6, pz0 - 0.6, px + 0.6, pz1 + 0.6, 7.4, 2.4, 0.4, TERRACOTTA);
  // Members' balcony on the field side.
  g.box(-px + 1, pz0 - 2.2, px - 1, pz0, 3.5, 3.75, CONCRETE);
  g.railing(-px + 1, pz0 - 2.1, px - 1, pz0 - 2.1, 3.75, 4.75, GLASS_RAIL, 2, 0.05, false);
  chhajja(g, -px + 0.5, px - 0.5, pz0, 6.9, 1.2, WHITE_TRIM, 'back');
  for (const x of [-px + 1.2, -px / 3, px / 3, px - 1.2]) g.cyl(x, pz0 - 2, 0.16, 0.16, 0, 3.5, 8, WHITE_TRIM);
  // Name board over the road entrance.
  g.box(-8, pz1, 8, pz1 + 0.3, 5.2, 6.6, mat(Layer.Plaster2, team, 1), SIGN);
  g.box(-3, pz1, 3, pz1 + 2.2, 0, 3.4, CONCRETE, NO_WIN, CONCRETE);

  // Floodlight towers in the four corners, their lamp banks lit at night.
  for (const [x, z] of [
    [-hw + 3.5, -hd + 3.5],
    [hw - 3.5, -hd + 3.5],
    [-hw + 3.5, hd - 6],
    [hw - 3.5, hd - 6],
  ] as const) {
    g.cyl(x, z, 0.45, 0.28, 0, 30, 8, METAL_GREY);
    g.box(x - 2.4, z - 0.35, x + 2.4, z + 0.35, 29.5, 32.6, lamp, SIGN, METAL_GREY);
  }

  // Compound wall with a gate, parking either side of the pavilion, trees by the wall.
  compoundWall(g, -hw + 0.4, -hd + 0.4, hw - 0.4, hd - 0.4, 2.0, cream, WHITE_TRIM, { cx: px + 6, w: 7, overhead: true });
  parking(g, px + 2, pz0 + 1, hw - 7, hd - 1.5);
  parking(g, -hw + 7, pz0 + 1, -px - 2, hd - 1.5);
  for (const s of [-1, 1]) {
    g.tree(s * (hw - 4), cz + R - 4, r.range(0.55, 0.75), r.next() * 6);
    g.tree(s * (hw - 4.5), cz - 4, r.range(0.55, 0.75), r.next() * 6);
  }
}

/** A white patrol car parked along z: blue stripe, and a red-and-blue light bar that glows. */
function patrolCar(g: Geo, x: number, z: number): void {
  const body = mat(Layer.Plaster2, [1.6, 1.6, 1.58], 3);
  const glass = mat(Layer.Metal, [0.32, 0.4, 0.5], 2);
  g.box(x - 0.9, z - 2.2, x + 0.9, z + 2.2, 0.3, 1.05, body, NO_WIN, body);
  g.box(x - 0.82, z - 1.1, x + 0.82, z + 0.9, 1.05, 1.55, glass, NO_WIN, body);
  g.box(x - 0.92, z - 2.2, x + 0.92, z + 2.2, 0.62, 0.78, mat(Layer.Plaster2, [0.12, 0.26, 0.85], 3));
  g.box(x - 0.6, z - 0.2, x, z + 0.15, 1.55, 1.72, mat(Layer.Plaster2, [1.9, 0.15, 0.12], 3), SIGN, null);
  g.box(x, z - 0.2, x + 0.6, z + 0.15, 1.55, 1.72, mat(Layer.Plaster2, [0.2, 0.4, 1.9], 3), SIGN, null);
  for (const [wx, wz] of [[-0.85, -1.4], [0.85, -1.4], [-0.85, 1.4], [0.85, 1.4]] as const) g.cyl(x + wx, z + wz, 0.33, 0.33, 0, 0.66, 6, STEEL_DARK);
}

/** A fire engine parked along z, cab toward +z: red body, white stripe, ladder, light bar. */
function fireEngine(g: Geo, x: number, z: number): void {
  const red = mat(Layer.Metal, [1.85, 0.22, 0.16], 0.9);
  const white = mat(Layer.Plaster2, [1.6, 1.6, 1.56], 3);
  g.box(x - 1.2, z - 4.2, x + 1.2, z + 2.2, 0.45, 3.0, red, NO_WIN, red);
  g.box(x - 1.2, z + 2.2, x + 1.2, z + 4.0, 0.45, 2.6, red, NO_WIN, red);
  g.box(x - 1.1, z + 3.95, x + 1.1, z + 4.02, 1.6, 2.4, mat(Layer.Metal, [0.3, 0.38, 0.48], 2));
  g.box(x - 1.22, z - 4.2, x + 1.22, z + 4.0, 1.25, 1.45, white);
  // Ladder on the roof and the light bar over the cab.
  g.box(x - 0.55, z - 4.6, x - 0.42, z + 1.8, 3.0, 3.35, METAL_GREY);
  g.box(x + 0.42, z - 4.6, x + 0.55, z + 1.8, 3.0, 3.35, METAL_GREY);
  for (let k = 0; k < 6; k++) g.box(x - 0.42, z - 4.3 + k * 1.1, x + 0.42, z - 4.2 + k * 1.1, 3.15, 3.25, METAL_GREY);
  g.box(x - 0.9, z + 2.6, x + 0.9, z + 3.0, 2.6, 2.85, mat(Layer.Plaster2, [0.3, 0.5, 1.9], 3), SIGN, null);
  for (const [wx, wz] of [[-1.15, -3], [1.15, -3], [-1.15, -1.4], [1.15, -1.4], [-1.15, 2.8], [1.15, 2.8]] as const) g.cyl(x + wx, z + wz, 0.46, 0.46, 0, 0.92, 6, STEEL_DARK);
}

/** A helipad on a roof at height y: a dark disc, a white ring and a white H. */
function helipad(g: Geo, cx: number, cz: number, y: number, radius: number): void {
  const pad = mat(Layer.Asphalt, [0.42, 0.44, 0.48], 3);
  g.cyl(cx, cz, radius, radius, y, y + 0.12, 20, pad, pad);
  ring(g, cx, cz, radius * 0.78, radius * 0.9, y + 0.14, LINE_WHITE, 24);
  const s = radius * 0.42;
  g.flat(cx - s * 0.62, cz - s, cx - s * 0.36, cz + s, y + 0.15, LINE_WHITE);
  g.flat(cx + s * 0.36, cz - s, cx + s * 0.62, cz + s, y + 0.15, LINE_WHITE);
  g.flat(cx - s * 0.36, cz - s * 0.14, cx + s * 0.36, cz + s * 0.14, y + 0.15, LINE_WHITE);
}

/**
 * Police headquarters on a 32 m lot: a four-storey stone block with the force's blue and
 * red bands, a columned entrance portico under a lit sign, a glazed stair core, a helipad
 * and a comms mast on the roof, a motor pool of patrol cars beside a garage, a parade
 * ground with the flag, and a walled compound with a guarded gate.
 */
function policeHQ(l: Lot): void {
  const { g, r, W, D } = l;
  ground(l, PAVING);
  const stone = mat(Layer.Plaster2, [1.26, 1.22, 1.12], 3);
  const blue: RGB = [0.08, 0.22, 0.68];
  const red: RGB = [0.82, 0.12, 0.1];
  const hw = W / 2;
  const hd = D / 2;
  const x0 = -hw + 1.5;
  const x1 = hw * 0.32;
  const z0 = -hd + 1.5;
  const z1 = hd * 0.18;
  const fh = 3.5;
  const plinth = 0.7;
  const top = plinth + 4 * fh;

  // The main block, with sunshades over each floor and the force's bands under the parapet.
  g.walls(x0, z0, x1, z1, 0, plinth, CONCRETE_DARK);
  g.walls(x0, z0, x1, z1, plinth, top, stone, win(Style.Punched, fitBay(x1 - x0, 2.6), fh, 0.5));
  for (let f = 1; f <= 3; f++) chhajja(g, x0 - 0.1, x1 + 0.1, z1, plinth + f * fh - 0.25, 0.55, WHITE_TRIM, 'front');
  g.walls(x0 - 0.06, z0 - 0.06, x1 + 0.06, z1 + 0.06, top - 0.8, top - 0.3, mat(Layer.Plaster2, blue, 3));
  g.walls(x0 - 0.06, z0 - 0.06, x1 + 0.06, z1 + 0.06, top - 0.3, top, mat(Layer.Plaster2, red, 3));
  flatRoof(g, x0, z0, x1, z1, top, stone, roofFinish(r), 0.8);

  // A glazed stair core at the back corner, rising above the roof.
  const glass = mat(Layer.Metal, [0.55, 0.72, 0.95], 2.4);
  g.box(x1 - 4.5, z0 - 0.01, x1 - 0.8, z0 + 4, 0, top + 3.2, glass, win(Style.Curtain, 1.8, fh, 0.5), stone);

  // Roof: helipad, comms mast with a dish, a water tank.
  const pad = Math.min(5.2, (x1 - x0) * 0.24);
  helipad(g, x0 + pad + 1.2, (z0 + z1) / 2, top + 0.05, pad);
  const mx = x1 - 2.6;
  const mz = z1 - 2.6;
  g.cyl(mx, mz, 0.22, 0.08, top, top + 12, 6, METAL_GREY, null);
  for (let k = 1; k <= 3; k++) g.box(mx - 0.6, mz - 0.05, mx + 0.6, mz + 0.05, top + k * 3, top + k * 3 + 0.1, METAL_GREY);
  g.cyl(mx - 1.4, mz, 0.9, 0.2, top + 3.2, top + 3.6, 10, WHITE_TRIM);
  waterTank(g, (x0 + x1) / 2 + 3, z0 + 2, top, r, 0.9, true);

  // The entrance: a portico of four columns under a slab carrying the lit sign.
  const dx = (x0 + x1) / 2;
  const pz = z1 + 3.4;
  g.box(dx - 5, z1, dx + 5, pz, 5.1, 5.6, WHITE_TRIM, NO_WIN, CONCRETE);
  for (const c of [-4.2, -1.4, 1.4, 4.2]) g.cyl(dx + c, pz - 0.5, 0.32, 0.32, 0.6, 5.1, 10, WHITE_TRIM);
  g.box(dx - 5.4, z1 - 0.1, dx + 5.4, pz + 0.4, 0, 0.6, CONCRETE, NO_WIN, PAVING);
  g.stair(dx - 3, pz + 0.4, dx + 3, pz + 1.6, 0, 0.6, 3, CONCRETE);
  frontPanel(g, dx, z1, 4, 0.6, 3.6, mat(Layer.Concrete, [0.42, 0.46, 0.54], 2), win(Style.Storefront, 2, 3, 0.5));
  signBoard(g, dx - 4.6, dx, pz, 5.7, 6.9, blue);
  signBoard(g, dx, dx + 4.6, pz, 5.7, 6.9, red);

  // The motor pool: a garage block and a row of patrol cars on the side yard.
  const yx0 = x1 + 2;
  const yx1 = hw - 1.2;
  g.box(yx0, z0, yx1, z0 + 7, 0, 4.4, stone, win(Style.Industrial, 3, 4.4, 0.5), TAR_ROOF);
  for (let k = 0; k < 3; k++) {
    const cx = yx0 + 1.6 + k * ((yx1 - yx0 - 3.2) / 2);
    frontPanel(g, cx, z0 + 7, 2.6, 0, 3.2, mat(Layer.Metal, [0.6, 0.64, 0.7], 1.2));
  }
  parking(g, yx0, z0 + 8.5, yx1, z1 + 2);
  const cars = Math.max(2, Math.floor((yx1 - yx0) / 3.2));
  for (let k = 0; k < cars; k++) patrolCar(g, yx0 + 1.6 + k * 3.1, (z0 + 8.5 + z1 + 2) / 2);

  // Parade ground with the flag, between the block and the road.
  g.flat(x0, pz + 2, x1, hd - 1.2, 0.03, mat(Layer.Concrete, [1.22, 1.18, 1.1], 3));
  flagpole(g, x0 + 2, hd - 2.4, blue);
  for (const x of [x0 + 5, x1 - 2]) g.tree(x, hd - 2.4, r.range(0.45, 0.6), r.next() * 6);

  // A walled compound with a gate and a guard post beside it.
  const gate = (x1 + hw) / 2;
  compoundWall(g, -hw + 0.3, -hd + 0.3, hw - 0.3, hd - 0.3, 1.6, stone, WHITE_TRIM, { cx: gate, w: 6, gateMat: IRON_DARK });
  g.box(gate - 4.6, hd - 3.2, gate - 3.2, hd - 1.6, 0, 2.6, WHITE_TRIM, win(Style.Punched, 1.2, 2.6, 0.5), mat(Layer.Plaster2, blue, 3));
}

/**
 * Central fire station on a 32 m lot: a five-bay appliance hall with red doors and a lit
 * name board, three storeys of crew and control rooms behind, a seven-storey drill tower
 * striped red and white, engines on a hatched apron, a siren mast, and a fenced yard.
 */
function fireHQ(l: Lot): void {
  const { g, r, W, D } = l;
  ground(l, mat(Layer.Concrete, [1.18, 1.18, 1.15], 4));
  const brick = mat(Layer.Brick, [1.5, 1.18, 1.08], 2);
  const red: RGB = [0.82, 0.1, 0.08];
  const hw = W / 2;
  const hd = D / 2;
  const x0 = -hw + 1.2;
  const x1 = hw - 8.5;
  const hz1 = hd * 0.1;
  const hz0 = hz1 - 9;
  const hallH = 6.6;

  // The appliance hall: five tall red doors under a long name board.
  g.walls(x0, hz0, x1, hz1, 0, hallH, brick);
  const bays = 5;
  const bw = (x1 - x0 - 0.8) / bays;
  for (let i = 0; i < bays; i++) {
    const cx = x0 + 0.4 + bw * (i + 0.5);
    frontPanel(g, cx, hz1, bw - 0.4, 0.02, 4.9, WHITE_TRIM);
    frontPanel(g, cx, hz1 + 0.04, bw - 0.7, 0.02, 4.75, mat(Layer.Metal, [1.85, 0.28, 0.22], 0.8));
    frontPanel(g, cx, hz1 + 0.07, bw - 1.1, 2.8, 3.9, mat(Layer.Concrete, [0.4, 0.46, 0.52], 2), win(Style.Curtain, (bw - 1.1) / 3, 1.1, 0.5));
  }
  g.box(x0 + 0.3, hz1, x1 - 0.3, hz1 + 1.2, 5.1, 5.35, WHITE_TRIM);
  signBoard(g, x0 + 1.5, x1 - 1.5, hz1 + 1.2, 5.4, 6.4, red);
  flatRoof(g, x0, hz0, x1, hz1, hallH, brick, roofFinish(r), 0.6);

  // Crew quarters and control room: three storeys behind the hall, with a balcony.
  const cz0 = -hd + 1.2;
  const cTop = 0.6 + 3 * 3.4;
  g.walls(x0, cz0, x1, hz0, 0, cTop, brick, win(Style.Punched, fitBay(x1 - x0, 2.8), 3.4, 0.5));
  balcony(g, x0 + 1, x1 - 1, hz0, cTop - 3.2, 1.0, CONCRETE, IRON_DARK, 'parapet-rail', 'front');
  chhajja(g, x0, x1, hz0, cTop - 0.7, 0.5, WHITE_TRIM, 'front');
  flatRoof(g, x0, cz0, x1, hz0, cTop, brick, roofFinish(r), 0.7);
  rooftop(l, x0, cz0, x1, hz0, cTop, brick);

  // The drill tower: seven storeys in red and white bands, open landings for ladder drills.
  const tx0 = x1 + 1.5;
  const tx1 = hw - 1.5;
  const tz0 = -hd + 1.5;
  const tz1 = tz0 + 5.5;
  const storey = 3.1;
  const white = mat(Layer.Plaster2, [1.5, 1.5, 1.46], 3);
  for (let k = 0; k < 7; k++) {
    const m = k % 2 === 0 ? mat(Layer.Plaster2, red, 3) : white;
    g.walls(tx0, tz0, tx1, tz1, k * storey, (k + 1) * storey, m, win(Style.Punched, (tx1 - tx0) / 2, storey, 0.42));
    g.box(tx0 + 0.3, tz1, tx1 - 0.3, tz1 + 0.9, (k + 1) * storey - 0.15, (k + 1) * storey, CONCRETE);
    g.railing(tx0 + 0.3, tz1 + 0.85, tx1 - 0.3, tz1 + 0.85, (k + 1) * storey, (k + 1) * storey + 1, IRON_DARK, 1.2, 0.05, false);
  }
  g.hip(tx0 - 0.3, tz0 - 0.3, tx1 + 0.3, tz1 + 0.3, 7 * storey, 1.6, 0.3, TERRACOTTA);
  // Siren mast on the hall roof.
  g.cyl(x0 + 2, hz0 + 2, 0.1, 0.05, hallH, hallH + 6, 6, METAL_GREY, null);
  g.cyl(x0 + 2, hz0 + 2, 0.45, 0.45, hallH + 5.2, hallH + 5.9, 8, mat(Layer.Plaster2, red, 3));

  // Apron with keep-clear hatching and two engines out front; hoses drying by the tower.
  const az1 = hd - 0.6;
  for (let i = 0; i < 9; i++) g.flat(x0 + 1 + i * 2.3, hz1 + 1.4, x0 + 1.25 + i * 2.3, az1 - 3, 0.04, mat(Layer.Concrete, [2.2, 1.7, 0.2], 3));
  fireEngine(g, x0 + 0.4 + bw * 1.5, hz1 + 6.2);
  fireEngine(g, x0 + 0.4 + bw * 3.5, hz1 + 6.2);
  for (let k = 0; k < 3; k++) g.box(tx0 + 0.5 + k * 1.6, tz1 + 3, tx0 + 0.6 + k * 1.6, tz1 + 3.1, 0, 5, METAL_GREY);

  // A fence around the sides and back; the front is open for the engines.
  g.railing(-hw + 0.4, -hd + 0.4, hw - 0.4, -hd + 0.4, 0, 1.8, CHAIN_LINK, 2.5, 0.05, true);
  g.railing(-hw + 0.4, -hd + 0.4, -hw + 0.4, hd - 0.4, 0, 1.8, CHAIN_LINK, 2.5, 0.05, true);
  g.railing(hw - 0.4, -hd + 0.4, hw - 0.4, hd - 0.4, 0, 1.8, CHAIN_LINK, 2.5, 0.05, true);
  parking(g, tx0, tz1 + 4, hw - 1, hd - 1);
}

/**
 * An indoor stadium on an 80 m lot: a round arena whose drum has entrances at ground
 * level, a band of glass, and a ring of LED screens that glows at night; a white dome of
 * stepped rings with a glazed lantern on top; four entrance canopies, a big screen over the
 * main gate, ticket kiosks, and a plaza with trees, lamps and parking in the corners.
 */
function indoorStadium(l: Lot): void {
  const { g, r, W, D } = l;
  ground(l, PAVING);
  const hw = W / 2;
  const hd = D / 2;
  const cx = 0;
  const cz = -3;
  const R = Math.min(hw, hd) - 13;
  const n = 36;
  // The home team's colour, on the LED ring, the kiosks and the pylon (saturated so it glows).
  const team = pick(r, [
    [0.3, 0.65, 2.0],
    [2.0, 0.55, 0.25],
    [0.35, 1.7, 0.9],
    [1.8, 0.35, 1.4],
  ] as const satisfies readonly RGB[]);
  const led = mat(Layer.Plaster2, team, 1);
  const podium = mat(Layer.Concrete, [0.95, 0.96, 1.0], 3);
  const glass = mat(Layer.Metal, [0.5, 0.66, 0.9], 2.4);
  const cladding = mat(Layer.Metal, [1.42, 1.44, 1.48], 2);
  const dome = mat(Layer.Plaster2, [1.55, 1.56, 1.6], 3);
  const rib = mat(Layer.Metal, [1.2, 1.22, 1.26], 2);

  // The plaza ring round the arena, slightly lighter than the forecourt.
  ring(g, cx, cz, R, R + 6, 0.03, mat(Layer.Pavement, [1.3, 1.3, 1.34], 3), n);

  // The drum: podium with doors, glass band, LED ring, metal fascia.
  const bands: Array<[number, number, Mat, Win]> = [
    [0, 4.2, podium, win(Style.Storefront, 4, 4.2, 0.55)],
    [4.2, 11.2, glass, win(Style.Curtain, 2.2, 3.5, 0.5)],
    [11.2, 13, led, SIGN],
    [13, 14.4, cladding, NO_WIN],
  ];
  for (let i = 0; i < n; i++) {
    const a0 = (i / n) * Math.PI * 2;
    const a1 = ((i + 1) / n) * Math.PI * 2;
    const p0x = cx + Math.cos(a0) * R;
    const p0z = cz + Math.sin(a0) * R;
    const p1x = cx + Math.cos(a1) * R;
    const p1z = cz + Math.sin(a1) * R;
    for (const [y0, y1, m, w] of bands) g.wall(p0x, p0z, p1x, p1z, y0, y1, m, w);
    // Vertical fins between the glass panels.
    if (i % 2 === 0) {
      const fx = cx + Math.cos(a0) * (R + 0.35);
      const fz = cz + Math.sin(a0) * (R + 0.35);
      g.cyl(fx, fz, 0.22, 0.22, 4.2, 11.2, 4, cladding, null);
    }
  }

  // The dome: stepped rings rising to a glazed lantern.
  const steps = 6;
  const rise = 10;
  for (let k = 0; k < steps; k++) {
    const t0 = (k / steps) * (Math.PI / 2) * 0.86;
    const t1 = ((k + 1) / steps) * (Math.PI / 2) * 0.86;
    const r0 = (R + 1.2) * Math.cos(t0);
    const r1 = (R + 1.2) * Math.cos(t1);
    const y0 = 14.4 + rise * Math.sin(t0);
    const y1 = 14.4 + rise * Math.sin(t1);
    g.cyl(cx, cz, r0, r1, y0, y1, n, dome, null);
    // Twelve steel ribs running up the dome, standing a little proud of it.
    for (let q = 0; q < 12; q++) {
      const a = (q / 12) * Math.PI * 2;
      const c = Math.cos(a);
      const s = Math.sin(a);
      const e = 0.35;
      const w = 0.28;
      g.poly(
        [
          [cx + c * (r0 + e) - s * w, y0 + e, cz + s * (r0 + e) + c * w],
          [cx + c * (r0 + e) + s * w, y0 + e, cz + s * (r0 + e) - c * w],
          [cx + c * (r1 + e) + s * w, y1 + e, cz + s * (r1 + e) - c * w],
          [cx + c * (r1 + e) - s * w, y1 + e, cz + s * (r1 + e) + c * w],
        ],
        rib,
      );
    }
  }
  const topR = (R + 1.2) * Math.cos((Math.PI / 2) * 0.86);
  const topY = 14.4 + rise * Math.sin((Math.PI / 2) * 0.86);
  g.cyl(cx, cz, topR, topR * 0.7, topY, topY + 2.2, 16, glass, dome);
  ring(g, cx, cz, R + 0.2, R + 1.3, 14.4, cladding, n);

  // Four entrance canopies on columns, the front one with a big screen above.
  for (let q = 0; q < 4; q++) {
    const a = (q / 4) * Math.PI * 2 + Math.PI / 2;
    const ux = Math.cos(a);
    const uz = Math.sin(a);
    const ex = cx + ux * (R + 2.2);
    const ez = cz + uz * (R + 2.2);
    const half = 5;
    const depth = 2.2;
    const [bx0, bz0, bx1, bz1] = Math.abs(ux) > 0.5 ? [ex - depth, ez - half, ex + depth, ez + half] : [ex - half, ez - depth, ex + half, ez + depth];
    g.box(bx0, bz0, bx1, bz1, 4.4, 4.75, cladding, NO_WIN, cladding);
    for (const s of [-1, 1]) {
      const px = Math.abs(ux) > 0.5 ? ex + ux * depth * 0.8 : ex + s * (half - 0.6);
      const pz = Math.abs(ux) > 0.5 ? ez + s * (half - 0.6) : ez + uz * depth * 0.8;
      g.cyl(px, pz, 0.2, 0.2, 0, 4.4, 6, METAL_GREY, null);
    }
  }
  const fz = cz + R + 4.6;
  g.box(-7, fz, 7, fz + 0.4, 5.2, 9.4, mat(Layer.Concrete, [0.2, 0.22, 0.26], 1), SIGN, CONCRETE_DARK);
  g.box(-7.4, fz - 0.1, 7.4, fz + 0.5, 9.4, 9.8, cladding);

  // Ticket kiosks by the front gate, and a name totem at the road.
  for (const s of [-1, 1]) g.box(s * 11 - 1.4, fz + 3, s * 11 + 1.4, fz + 5, 0, 2.8, cladding, win(Style.Storefront, 1.4, 2.8, 0.5), led);
  // A sign pylon at the road: a dark frame with a lit panel in the team colour.
  g.box(-1.1, hd - 2.6, 1.1, hd - 1.8, 0, 8, mat(Layer.Concrete, [0.32, 0.34, 0.38], 2), NO_WIN, cladding);
  g.box(-0.85, hd - 1.85, 0.85, hd - 1.75, 3.2, 7.6, led, SIGN, null);
  g.box(-0.85, hd - 2.65, 0.85, hd - 2.55, 3.2, 7.6, led, SIGN, null);

  // Parking in the four corners, trees and lamps along the plaza.
  const pk = 11;
  parking(g, -hw + 1, -hd + 1, -hw + 1 + pk, -hd + 1 + pk * 1.6);
  parking(g, hw - 1 - pk, -hd + 1, hw - 1, -hd + 1 + pk * 1.6);
  parking(g, -hw + 1, hd - 1 - pk, -hw + 1 + pk * 1.6, hd - 1);
  parking(g, hw - 1 - pk * 1.6, hd - 1 - pk, hw - 1, hd - 1);
  const lamp = mat(Layer.Plaster2, [2.6, 2.55, 2.3], 1);
  for (let q = 0; q < 12; q++) {
    const a = (q / 12) * Math.PI * 2 + 0.26;
    const x = cx + Math.cos(a) * (R + 8.5);
    const z = cz + Math.sin(a) * (R + 8.5);
    if (Math.abs(x) > hw - 2 || Math.abs(z) > hd - 2) continue;
    if (q % 2 === 0) g.tree(x, z, r.range(0.5, 0.7), r.next() * 6);
    else {
      g.cyl(x, z, 0.12, 0.09, 0, 7, 6, METAL_GREY, null);
      g.box(x - 0.5, z - 0.25, x + 0.5, z + 0.25, 7, 7.3, lamp, SIGN, METAL_GREY);
    }
  }
}

export function facility(l: Lot, kind: number): void {
  switch (kind) {
    case FacilityKind.CoalPlant:
      coalPlant(l);
      break;
    case FacilityKind.WindTurbine:
      windTurbine(l);
      break;
    case FacilityKind.SolarFarm:
      solarFarm(l);
      break;
    case FacilityKind.WaterTower:
      waterTower(l);
      break;
    case FacilityKind.WaterPump:
      waterPump(l);
      break;
    case FacilityKind.Police:
      police(l);
      break;
    case FacilityKind.FireStation:
      fireStation(l);
      break;
    case FacilityKind.Clinic:
      clinic(l);
      break;
    case FacilityKind.Hospital:
      hospital(l);
      break;
    case FacilityKind.SportsGround:
      sportsGround(l);
      break;
    case FacilityKind.School:
      school(l);
      break;
    case FacilityKind.MetroStation:
      metroStation(l);
      break;
    case FacilityKind.ItPark:
      itPark(l);
      break;
    case FacilityKind.University:
      university(l);
      break;
    case FacilityKind.TownHall:
      townHall(l);
      break;
    case FacilityKind.BusStop:
      busStop(l);
      break;
    case FacilityKind.Airport:
      airport(l);
      break;
    case FacilityKind.ShoppingMall:
      shoppingMall(l);
      break;
    case FacilityKind.Multiplex:
      multiplex(l);
      break;
    case FacilityKind.MarketStreet:
      marketStreet(l);
      break;
    case FacilityKind.PoliceHQ:
      policeHQ(l);
      break;
    case FacilityKind.FireHQ:
      fireHQ(l);
      break;
    case FacilityKind.IndoorStadium:
      indoorStadium(l);
      break;
    default:
      park(l);
  }
}

