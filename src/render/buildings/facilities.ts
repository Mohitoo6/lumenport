import { FacilityKind } from '../../sim/facilities';
import {
  ASPHALT,
  CONCRETE,
  CONCRETE_DARK,
  LAWN,
  LINE_WHITE,
  Layer,
  METAL_GREY,
  NO_WIN,
  PAVING,
  SIGN,
  STEEL_DARK,
  Style,
  WHITE_TRIM,
  WOOD,
  fence,
  flatRoof,
  frontPanel,
  ground,
  hedge,
  mat,
  parking,
  roofFinish,
  rooftop,
  shrub,
  win,
  type Geo,
  type Lot,
  type Mat,
  type RGB,
} from './common';
import { fitBay } from './geo';

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
  g.box(x0, z, x1, z + 0.16, y0, y1, mat(Layer.Plaster2, tint, 3), SIGN, CONCRETE_DARK);
}

function flagpole(g: Geo, x: number, z: number, tint: RGB): void {
  g.cyl(x, z, 0.07, 0.04, 0, 9, 6, mat(Layer.Concrete, [1.8, 1.8, 1.8]), null);
  slab(g, [[x, 8.8, z], [x + 1.7, 8.8, z], [x + 1.7, 7.8, z], [x, 7.8, z]], mat(Layer.Plaster2, tint, 3));
}

function police(l: Lot): void {
  const { g, r, W, D } = l;
  ground(l, PAVING);
  const wall = mat(Layer.ConcreteWall, [1.12, 1.14, 1.2], 3);
  const blue: RGB = [0.08, 0.2, 0.62];
  const x0 = -W / 2 + 1.2;
  const x1 = W / 2 - 4.6;
  const z0 = -D / 2 + 1.2;
  const z1 = D / 2 - 3.2;
  const fh = 3.4;
  g.walls(x0, z0, x1, z1, 0, 0.5, CONCRETE_DARK);
  g.walls(x0, z0, x1, z1, 0.5, 0.5 + 2 * fh, wall, win(Style.Ribbon, fitBay(x1 - x0, 3.2), fh, 0.5));
  // A band in force blue under the parapet, and a lit sign over the door.
  g.walls(x0 - 0.05, z0 - 0.05, x1 + 0.05, z1 + 0.05, 0.5 + 2 * fh - 0.7, 0.5 + 2 * fh, mat(Layer.Plaster2, blue, 3));
  flatRoof(g, x0, z0, x1, z1, 0.5 + 2 * fh, wall, roofFinish(r));
  rooftop(l, x0, z0, x1, z1, 0.5 + 2 * fh, wall);
  g.cyl(x0 + 2, z0 + 2, 0.12, 0.04, 0.5 + 2 * fh, 0.5 + 2 * fh + 9, 5, METAL_GREY, null);
  const dx = (x0 + x1) / 2;
  g.box(dx - 2, z1, dx + 2, z1 + 1.8, 3.2, 3.45, CONCRETE);
  frontPanel(g, dx, z1, 2.4, 0.5, 3, mat(Layer.Concrete, [0.5, 0.52, 0.56], 2), win(Style.Storefront, 2.4, 2.5, 0.5));
  signBoard(g, dx - 2.6, dx + 2.6, z1, 3.6, 4.4, blue);
  g.box(dx - 1.6, z1, dx + 1.6, z1 + 1.4, 0, 0.5, CONCRETE);
  // Patrol car bays at the side.
  parking(g, x1 + 0.4, z0, W / 2 - 0.5, z1);
  flagpole(g, x0 + 1, D / 2 - 1.6, blue);
}

function fireStation(l: Lot): void {
  const { g, r, W, D } = l;
  ground(l, mat(Layer.Concrete, [1.15, 1.15, 1.14], 4));
  const wall = mat(Layer.Brick, [1.5, 1.2, 1.1], 2);
  const red: RGB = [0.75, 0.08, 0.06];
  const x0 = -W / 2 + 1;
  const x1 = W / 2 - 1;
  const z0 = -D / 2 + 1;
  const z1 = D / 2 - 5;
  const h = 6.2;
  // Appliance bay with three tall red doors, crew quarters above.
  g.walls(x0, z0, x1, z1, 0, h, wall);
  const bays = 3;
  const bw = (x1 - x0 - 3.4) / bays;
  for (let i = 0; i < bays; i++) {
    const cx = x0 + 0.5 + bw * (i + 0.5);
    frontPanel(g, cx, z1, bw - 0.6, 0.02, 4.4, mat(Layer.Metal, [1.9, 0.3, 0.24], 0.8));
    frontPanel(g, cx, z1 + 0.03, bw - 1, 2.6, 3.6, mat(Layer.Concrete, [0.4, 0.45, 0.5], 2), win(Style.Curtain, (bw - 1) / 3, 1, 0.5));
  }
  g.walls(x0, z0, x1, z1, h, h + 3, wall, win(Style.Punched, fitBay(x1 - x0, 2.8), 3, 0.5));
  flatRoof(g, x0, z0, x1, z1, h + 3, wall, roofFinish(r));
  rooftop(l, x0, z0, x1, z1, h + 3, wall);
  signBoard(g, x0 + 1, x1 - 4, z1, 4.9, 5.8, red);
  // Hose-drying tower at the corner.
  const tx = x1 - 1.5;
  g.walls(tx - 1.5, z1 - 3, tx + 1.5, z1 + 0.3, 0, 15, wall, win(Style.Punched, 3, 3.6, 0.3));
  g.hip(tx - 1.5, z1 - 3, tx + 1.5, z1 + 0.3, 15, 1.6, 0.3, mat(Layer.Roof3, [0.6, 0.62, 0.66], 2.4));
  // Apron with keep-clear hatching.
  for (let i = 0; i < 6; i++) g.flat(x0 + 1 + i * 2.2, z1 + 0.6, x0 + 1.2 + i * 2.2, D / 2 - 0.4, 0.04, mat(Layer.Concrete, [2.2, 1.7, 0.2], 3));
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

function school(l: Lot): void {
  const { g, r, W, D } = l;
  ground(l, LAWN);
  const wall = mat(Layer.Brick2, [1.5, 1.42, 1.3], 2);
  const yellow: RGB = [0.9, 0.62, 0.06];
  const fh = 3.6;
  // Classroom wing along the back, hall at one end.
  const x0 = -W / 2 + 1.5;
  const x1 = W / 2 - 1.5;
  const z0 = -D / 2 + 1.5;
  const z1 = z0 + 8.5;
  const top = 0.5 + 2 * fh;
  g.walls(x0, z0, x1, z1, 0, 0.5, CONCRETE);
  g.walls(x0, z0, x1, z1, 0.5, top, wall, win(Style.Ribbon, fitBay(x1 - x0, 3), fh, 0.5));
  flatRoof(g, x0, z0, x1, z1, top, wall, roofFinish(r));
  rooftop(l, x0, z0, x1, z1, top, wall);
  const hx1 = x0 + 9;
  const hz1 = z1 + 7.5;
  g.walls(x0, z1, hx1, hz1, 0, 7.5, wall, win(Style.Industrial, fitBay(9, 3), 7.5, 0.5));
  g.gable(x0, z1, hx1, hz1, 7.5, 1.8, false, 0.4, mat(Layer.Metal, [1.2, 1.24, 1.3], 2.4), wall);
  // Entrance and sign.
  const dx = hx1 + 3;
  g.box(dx - 2.2, z1, dx + 2.2, z1 + 2, 3.3, 3.55, mat(Layer.Plaster2, yellow, 3), NO_WIN, CONCRETE);
  frontPanel(g, dx, z1, 3.2, 0.5, 3.1, mat(Layer.Concrete, [0.5, 0.52, 0.56], 2), win(Style.Storefront, 1.6, 2.6, 0.5));
  signBoard(g, dx + 3, dx + 8, z1, 4.3, 5.2, yellow);
  // Playground: a painted court, a path to the gate, trees along the fence.
  const cx0 = hx1 + 1.5;
  const cz0 = z1 + 3.4;
  g.flat(cx0, cz0, x1, D / 2 - 2.2, 0.04, ASPHALT);
  const lines = mat(Layer.Concrete, [2.1, 2.1, 2.05], 3);
  g.flat(cx0 + 0.6, cz0 + 0.6, x1 - 0.6, cz0 + 0.72, 0.05, lines);
  g.flat(cx0 + 0.6, D / 2 - 2.92, x1 - 0.6, D / 2 - 2.8, 0.05, lines);
  g.flat(cx0 + 0.6, cz0 + 0.6, cx0 + 0.72, D / 2 - 2.8, 0.05, lines);
  g.flat(x1 - 0.72, cz0 + 0.6, x1 - 0.6, D / 2 - 2.8, 0.05, lines);
  g.flat((cx0 + x1) / 2 - 0.06, cz0 + 0.6, (cx0 + x1) / 2 + 0.06, D / 2 - 2.8, 0.05, lines);
  g.flat(dx - 1, z1 + 2, dx + 1, cz0, 0.04, PAVING);
  fence(g, -W / 2 + 0.4, D / 2 - 0.5, W / 2 - 0.4, D / 2 - 0.5, 1.4, CHAIN_LINK);
  g.tree(x0 + 2, D / 2 - 2.4, 0.55, 1.2);
  g.tree(x0 + 6.5, D / 2 - 2.6, 0.5, 3.1);
  flagpole(g, dx - 3.4, z1 + 2.6, yellow);
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
 * A metro station: a glazed ticket hall at street level and an island platform up on the
 * viaduct, under a long canopy, reached by a covered stair. Lines arrive at its centre.
 */
function metroStation(l: Lot): void {
  const { g, W, D } = l;
  ground(l, PAVING);
  const teal: RGB = [0.05, 0.55, 0.62];
  const steel = mat(Layer.Metal, [1.25, 1.3, 1.36], 2.2);
  const deck = mat(Layer.Concrete, [1.32, 1.32, 1.3], 3);
  const hw = W / 2 - 0.6;
  const hd = D / 2 - 0.6;
  // Platform slab and the columns that carry it.
  for (const [x, z] of [
    [-hw + 1, -hd + 1],
    [hw - 1, -hd + 1],
    [-hw + 1, hd - 1],
    [hw - 1, hd - 1],
  ] as const) {
    g.cyl(x, z, 0.55, 0.55, 0, METRO_DECK - 1.2, 12, CONCRETE);
  }
  g.box(-hw, -hd, hw, hd, METRO_DECK - 1.2, METRO_DECK - 0.1, deck);
  // Platform edge strips and benches.
  g.flat(-hw, -hd, hw, -hd + 0.4, METRO_DECK - 0.08, mat(Layer.Concrete, [2.0, 1.8, 0.4], 3));
  g.flat(-hw, hd - 0.4, hw, hd, METRO_DECK - 0.08, mat(Layer.Concrete, [2.0, 1.8, 0.4], 3));
  // Canopy on slender posts.
  for (const x of [-hw + 1.5, 0, hw - 1.5]) {
    g.cyl(x, -1.6, 0.14, 0.14, METRO_DECK - 0.1, METRO_DECK + 3.6, 8, steel);
    g.cyl(x, 1.6, 0.14, 0.14, METRO_DECK - 0.1, METRO_DECK + 3.6, 8, steel);
  }
  g.box(-hw - 0.4, -hd + 0.2, hw + 0.4, hd - 0.2, METRO_DECK + 3.6, METRO_DECK + 4.0, mat(Layer.Metal, [1.5, 1.52, 1.55], 2.5));
  g.box(-hw - 0.4, -0.5, hw + 0.4, 0.5, METRO_DECK + 4.0, METRO_DECK + 4.6, mat(Layer.Plaster2, teal, 3), SIGN, CONCRETE_DARK);
  // Ticket hall at the front, glazed, with the line colour band.
  const z1 = D / 2 - 0.8;
  const z0 = z1 - 5;
  g.walls(-4.5, z0, 4.5, z1, 0, 4.2, mat(Layer.Concrete, [0.6, 0.62, 0.66], 2), win(Style.Storefront, 1.8, 4.2, 0.5));
  g.box(-4.8, z0 - 0.2, 4.8, z1 + 0.3, 4.2, 4.8, mat(Layer.Plaster2, teal, 3), NO_WIN, CONCRETE_DARK);
  signBoard(g, -1.2, 1.2, z1 + 0.3, 4.9, 6.6, teal);
  // Glazed lift and stair tower from the hall up to the platform.
  const tx0 = 4.4;
  const tx1 = W / 2 - 0.4;
  const tz0 = z0 - 4.5;
  const tz1 = z0 + 0.5;
  g.walls(tx0, tz0, tx1, tz1, 0, METRO_DECK + 2.8, mat(Layer.Metal, [0.62, 0.85, 1.0], 2.4), win(Style.Curtain, 1.4, 3.2, 0.7));
  g.box(tx0 - 0.2, tz0 - 0.2, tx1 + 0.2, tz1 + 0.2, METRO_DECK + 2.8, METRO_DECK + 3.3, mat(Layer.Plaster2, teal, 3), NO_WIN, CONCRETE_DARK);
  g.tree(-W / 2 + 1.6, D / 2 - 1.6, 0.4, 0.3);
}

/** An IT park: three glass office towers on a landscaped podium, with parking and a sign. */
function itPark(l: Lot): void {
  const { g, r, W, D } = l;
  ground(l, PAVING);
  const glassBlue = mat(Layer.Metal, [0.55, 0.78, 1.05], 2.6);
  const glassGreen = mat(Layer.Metal, [0.5, 0.95, 0.9], 2.6);
  const frame = mat(Layer.ConcreteWall, [1.25, 1.27, 1.3], 3);
  const fh = 3.8;
  const towers: Array<[number, number, number, number, number, Mat]> = [
    [-W / 2 + 2, -D / 2 + 2, -W / 2 + 13, -D / 2 + 13, 10 + r.int(3), glassBlue],
    [W / 2 - 12, -D / 2 + 2, W / 2 - 2, -D / 2 + 11, 7 + r.int(3), glassGreen],
    [W / 2 - 11, -D / 2 + 13.5, W / 2 - 2, -D / 2 + 21, 5 + r.int(2), glassBlue],
  ];
  // Podium joining the towers.
  g.walls(-W / 2 + 2, -D / 2 + 2, W / 2 - 2, -D / 2 + 9, 0, 5, frame, win(Style.Storefront, 3, 5, 0.5));
  flatRoof(g, -W / 2 + 2, -D / 2 + 2, W / 2 - 2, -D / 2 + 9, 5, frame, mat(Layer.Grass, [0.55, 0.85, 0.45], 4), 0.9);
  for (const [x0, z0, x1, z1, floors, m] of towers) {
    const top = floors * fh;
    g.walls(x0, z0, x1, z1, 0, top, m, win(Style.Curtain, 1.6, fh, 0.6));
    flatRoof(g, x0, z0, x1, z1, top, frame);
    rooftop(l, x0, z0, x1, z1, top, frame);
    // Crown: a slim fin on top of the tallest.
    if (floors >= 10) g.box(x1 - 2.2, z0 + 1, x1 - 1, z1 - 1, top, top + 5, frame);
  }
  // Plaza, the sign and parking at the front.
  g.flat(-W / 2 + 2, -D / 2 + 13.5, W / 2 - 13, D / 2 - 9, 0.04, mat(Layer.Pavement, [1.25, 1.22, 1.15], 3));
  const sign: RGB = [0.1, 0.45, 0.95];
  g.box(-W / 2 + 3, D / 2 - 8.6, -W / 2 + 12, D / 2 - 8.2, 0, 2.2, mat(Layer.Plaster2, sign, 3), SIGN, CONCRETE_DARK);
  parking(g, -W / 2 + 1, D / 2 - 7.5, W / 2 - 1, D / 2 - 1);
  for (let k = 0; k < 4; k++) g.tree(-W / 2 + 4 + k * 4.5, -D / 2 + 15 + (k % 2) * 3, 0.5 + r.next() * 0.2, k);
}

/**
 * A university: a stone main hall with a clock tower facing a lawn quad, flanked by two
 * brick teaching wings, with paths and trees.
 */
function university(l: Lot): void {
  const { g, r, W, D } = l;
  ground(l, LAWN);
  const stone = mat(Layer.ConcreteWall, [1.5, 1.42, 1.28], 3);
  const brick = mat(Layer.Brick, [1.15, 0.92, 0.82], 2);
  const slate = mat(Layer.Roof2, [0.75, 0.78, 0.85], 3);
  const copper = mat(Layer.Metal, [0.55, 1.02, 0.86], 2);
  const fh = 4;
  // Main hall across the back.
  const hz0 = -D / 2 + 2;
  const hz1 = hz0 + 10;
  g.walls(-W / 2 + 5, hz0, W / 2 - 5, hz1, 0, 3 * fh, stone, win(Style.Punched, fitBay(W - 10, 3.2), fh, 0.45));
  g.gable(-W / 2 + 5, hz0, W / 2 - 5, hz1, 3 * fh, 3.5, true, 0.5, slate, stone);
  // Clock tower in the middle of the hall.
  g.box(-2.6, hz1 - 3, 2.6, hz1 + 2.2, 0, 22, stone, win(Style.Punched, 2.6, 4, 0.35), null);
  g.box(-3, hz1 - 3.4, 3, hz1 + 2.6, 22, 23, stone);
  g.cyl(0, hz1 - 0.4, 2.6, 0.2, 23, 29, 8, copper, null);
  g.box(-1.1, hz1 + 2.25, 1.1, hz1 + 2.4, 17, 19.2, mat(Layer.Plaster2, [1.9, 1.85, 1.6], 3), SIGN, null);
  // Teaching wings down both sides.
  for (const side of [-1, 1]) {
    const x0 = side < 0 ? -W / 2 + 2 : W / 2 - 11;
    const x1 = x0 + 9;
    const z0 = hz1 + 2;
    const z1 = D / 2 - 6;
    g.walls(x0, z0, x1, z1, 0, 2 * fh, brick, win(Style.Punched, 3, fh, 0.45));
    g.gable(x0, z0, x1, z1, 2 * fh, 2.6, false, 0.4, slate, brick);
  }
  // The quad: crossing paths and trees.
  const qx0 = -W / 2 + 12;
  const qx1 = W / 2 - 12;
  g.flat(-1.2, hz1 + 2, 1.2, D / 2 - 0.5, 0.04, PAVING);
  g.flat(qx0, (hz1 + D / 2) / 2 - 1, qx1, (hz1 + D / 2) / 2 + 1, 0.04, PAVING);
  for (let k = 0; k < 6; k++) {
    const x = (k % 2 ? qx1 - 3 : qx0 + 3) + (r.next() - 0.5);
    const z = hz1 + 6 + Math.floor(k / 2) * 7;
    g.tree(x, z, 0.6 + r.next() * 0.25, k * 1.3);
  }
  // Gate with the name.
  const navy: RGB = [0.12, 0.18, 0.45];
  g.box(-5, D / 2 - 1.2, -3.6, D / 2 - 0.4, 0, 3.4, stone);
  g.box(3.6, D / 2 - 1.2, 5, D / 2 - 0.4, 0, 3.4, stone);
  g.box(-3.6, D / 2 - 1.1, 3.6, D / 2 - 0.5, 2.6, 3.4, mat(Layer.Plaster2, navy, 3), SIGN, stone);
  flagpole(g, 7, D / 2 - 2, navy);
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
    default:
      park(l);
  }
}
