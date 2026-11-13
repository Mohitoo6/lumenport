import { FACING_DX, FACING_DY, type Facing } from '../../sim/zoning/zones';

export type RGB = readonly [number, number, number];

/** Layer order in the city texture arrays (see cityMaterial.ts). */
export const enum Layer {
  Brick = 0,
  Brick2 = 1,
  Plaster = 2,
  Plaster2 = 3,
  ConcreteWall = 4,
  Metal = 5,
  Roof = 6,
  Roof2 = 7,
  Roof3 = 8,
  Concrete = 9,
  Pavement = 10,
  Asphalt = 11,
  Grass = 12,
  Dirt = 13,
}

export const CITY_LAYERS = [
  'brick', 'brick2', 'plaster', 'plaster2', 'concrete_wall', 'metal', 'roof', 'roof2', 'roof3',
  'concrete', 'pavement', 'asphalt', 'grass', 'dirt',
] as const;

/** A surface finish: texture layer, colour multiplier and tile size in metres. */
export interface Mat {
  layer: Layer;
  tint: RGB;
  scale: number;
}

export function mat(layer: Layer, tint: RGB = [1, 1, 1], scale = 3): Mat {
  return { layer, tint, scale };
}

/** Facade styles understood by the city shader. */
export const enum Style {
  None = 0,
  /** Individual framed windows in a solid wall. */
  Punched = 1,
  /** Continuous horizontal window bands. */
  Ribbon = 2,
  /** Floor-to-ceiling glass with mullions and spandrel panels. */
  Curtain = 3,
  /** Tall shop glazing. */
  Storefront = 4,
  /** Small high-level factory lights. */
  Industrial = 5,
  /** A lit sign or panel: glows at night in its own colour. */
  Sign = 6,
}

export interface Win {
  style: Style;
  /** Bay width and floor height in metres: the window grid. */
  bay: number;
  floor: number;
  /** Style-specific: window width fraction for Punched, lit fraction bias otherwise. */
  param: number;
}

export const NO_WIN: Win = { style: Style.None, bay: 1, floor: 1, param: 0 };

export function win(style: Style, bay: number, floor: number, param = 0.5): Win {
  return { style, bay, floor, param };
}

/** Splits a wall length into whole bays close to the wanted width. */
export function fitBay(length: number, want: number): number {
  return length / Math.max(1, Math.round(length / want));
}

export interface TreeSpot {
  x: number;
  y: number;
  z: number;
  scale: number;
  rot: number;
}

export type V3 = readonly [number, number, number];

/**
 * Writes building geometry. Shapes are described in the building's own frame (x across the
 * lot, z toward the road, y up from the pad) and stored in world space, with the extra
 * attributes the city shader needs: facade coordinates, texture layer, tint and window grid.
 */
export class Geo {
  readonly pos: number[] = [];
  readonly nor: number[] = [];
  readonly uv: number[] = [];
  readonly tint: number[] = [];
  /** fu, fv, layer, seed */
  readonly a: number[] = [];
  /** bay, floor, style, param */
  readonly b: number[] = [];
  readonly idx: number[] = [];
  readonly trees: TreeSpot[] = [];
  count = 0;
  /** Per-building random in 0..1, baked into every vertex for window lighting. */
  seed = 0;
  /** Bounds of everything above knee height, in the local frame: the building's massing. */
  minX = Infinity;
  maxX = -Infinity;
  minZ = Infinity;
  maxZ = -Infinity;
  maxY = 0;

  private ox = 0;
  private oy = 0;
  private oz = 0;
  // Local x axis and local z axis expressed in world (x, z).
  private xx = 1;
  private xz = 0;
  private zx = 0;
  private zz = 1;

  /** Places the local frame: origin at the lot centre on the pad, +z facing the road. */
  frame(cx: number, y: number, cz: number, facing: Facing): void {
    this.ox = cx;
    this.oy = y;
    this.oz = cz;
    this.zx = FACING_DX[facing]!;
    this.zz = FACING_DY[facing]!;
    // Rotation only: x = z rotated a quarter turn.
    this.xx = this.zz;
    this.xz = -this.zx;
  }

  /** Like `frame`, but facing any direction: +z points along (zx, zz), a unit vector. */
  frameDir(cx: number, y: number, cz: number, zx: number, zz: number): void {
    this.ox = cx;
    this.oy = y;
    this.oz = cz;
    this.zx = zx;
    this.zz = zz;
    this.xx = zz;
    this.xz = -zx;
  }

  /** Runs `draw` in another facing (same origin), then restores the current one. */
  withFacing(zx: number, zz: number, draw: () => void): void {
    const saved = [this.xx, this.xz, this.zx, this.zz] as const;
    this.zx = zx;
    this.zz = zz;
    this.xx = zz;
    this.xz = -zx;
    draw();
    [this.xx, this.xz, this.zx, this.zz] = saved;
  }

  private v(x: number, y: number, z: number, nx: number, ny: number, nz: number, u: number, w: number, m: Mat, fu: number, fv: number, wn: Win): number {
    this.pos.push(this.ox + x * this.xx + z * this.zx, this.oy + y, this.oz + x * this.xz + z * this.zz);
    this.nor.push(nx * this.xx + nz * this.zx, ny, nx * this.xz + nz * this.zz);
    this.uv.push(u / m.scale, w / m.scale);
    this.tint.push(m.tint[0], m.tint[1], m.tint[2]);
    this.a.push(fu, fv, m.layer, this.seed);
    this.b.push(wn.bay, wn.floor, wn.style, wn.param);
    if (y > 1) {
      if (x < this.minX) this.minX = x;
      if (x > this.maxX) this.maxX = x;
      if (z < this.minZ) this.minZ = z;
      if (z > this.maxZ) this.maxZ = z;
      if (y > this.maxY) this.maxY = y;
    }
    return this.count++;
  }

  /** Adds a tree to the lot (drawn by the shared instanced tree mesh). */
  tree(x: number, z: number, scale: number, rot: number): void {
    this.trees.push({ x: this.ox + x * this.xx + z * this.zx, y: this.oy, z: this.oz + x * this.xz + z * this.zz, scale, rot });
  }

  /**
   * A vertical wall from (x0, z0) to (x1, z1). It faces left of that direction, so walking
   * a footprint clockwise (seen from above with -z up) gives outward walls.
   * `fv0` is the height of the wall's base above its floor line, for the window grid.
   */
  wall(x0: number, z0: number, x1: number, z1: number, y0: number, y1: number, m: Mat, w: Win = NO_WIN, fv0 = 0, fu0 = 0): void {
    const dx = x1 - x0;
    const dz = z1 - z0;
    const len = Math.hypot(dx, dz);
    if (len < 1e-4 || y1 - y0 < 1e-4) return;
    const nx = dz / len;
    const nz = -dx / len;
    const h = y1 - y0;
    const a = this.v(x0, y0, z0, nx, 0, nz, fu0, y0, m, fu0, fv0, w);
    const b = this.v(x0, y1, z0, nx, 0, nz, fu0, y1, m, fu0, fv0 + h, w);
    const c = this.v(x1, y1, z1, nx, 0, nz, fu0 + len, y1, m, fu0 + len, fv0 + h, w);
    const d = this.v(x1, y0, z1, nx, 0, nz, fu0 + len, y0, m, fu0 + len, fv0, w);
    this.idx.push(a, b, c, a, c, d);
  }

  /** Walls around an axis-aligned rectangle. `w` may differ per side: [back, right, front, left]. */
  walls(x0: number, z0: number, x1: number, z1: number, y0: number, y1: number, m: Mat, w: Win | readonly [Win, Win, Win, Win] = NO_WIN, fv0 = 0): void {
    const ws = Array.isArray(w) ? (w as readonly Win[]) : [w, w, w, w];
    this.wall(x0, z0, x1, z0, y0, y1, m, ws[0] as Win, fv0);
    this.wall(x1, z0, x1, z1, y0, y1, m, ws[1] as Win, fv0);
    this.wall(x1, z1, x0, z1, y0, y1, m, ws[2] as Win, fv0);
    this.wall(x0, z1, x0, z0, y0, y1, m, ws[3] as Win, fv0);
  }

  /** A horizontal rectangle facing up. */
  flat(x0: number, z0: number, x1: number, z1: number, y: number, m: Mat): void {
    const a = this.v(x0, y, z0, 0, 1, 0, x0, z0, m, 0, 0, NO_WIN);
    const b = this.v(x0, y, z1, 0, 1, 0, x0, z1, m, 0, 0, NO_WIN);
    const c = this.v(x1, y, z1, 0, 1, 0, x1, z1, m, 0, 0, NO_WIN);
    const d = this.v(x1, y, z0, 0, 1, 0, x1, z0, m, 0, 0, NO_WIN);
    this.idx.push(a, b, c, a, c, d);
  }

  /** A box: four walls and, unless `top` is null, a lid. */
  box(x0: number, z0: number, x1: number, z1: number, y0: number, y1: number, m: Mat, w: Win | readonly [Win, Win, Win, Win] = NO_WIN, top: Mat | null | undefined = undefined, fv0 = 0): void {
    this.walls(x0, z0, x1, z1, y0, y1, m, w, fv0);
    if (top !== null) this.flat(x0, z0, x1, z1, y1, top ?? m);
  }

  /**
   * Any planar polygon of three or four points. The face is turned to point up (or, for
   * vertical faces, as wound). Texture runs along the first edge.
   */
  poly(p: readonly V3[], m: Mat, w: Win = NO_WIN, faceUp = true): void {
    const [p0, p1] = p as [V3, V3];
    const ux = p1[0] - p0[0];
    const uy = p1[1] - p0[1];
    const uz = p1[2] - p0[2];
    const last = p[p.length - 1]!;
    const vx = last[0] - p0[0];
    const vy = last[1] - p0[1];
    const vz = last[2] - p0[2];
    let nx = uy * vz - uz * vy;
    let ny = uz * vx - ux * vz;
    let nz = ux * vy - uy * vx;
    const nl = Math.hypot(nx, ny, nz) || 1;
    nx /= nl;
    ny /= nl;
    nz /= nl;
    const flip = faceUp && ny < 0;
    if (flip) {
      nx = -nx;
      ny = -ny;
      nz = -nz;
    }
    // In-plane axes for texture and facade coordinates.
    const ul = Math.hypot(ux, uy, uz) || 1;
    const ax = ux / ul;
    const ay = uy / ul;
    const az = uz / ul;
    const bx = ny * az - nz * ay;
    const by = nz * ax - nx * az;
    const bz = nx * ay - ny * ax;
    const ids: number[] = [];
    for (const q of p) {
      const rx = q[0] - p0[0];
      const ry = q[1] - p0[1];
      const rz = q[2] - p0[2];
      const u = rx * ax + ry * ay + rz * az;
      const t = Math.abs(rx * bx + ry * by + rz * bz);
      ids.push(this.v(q[0], q[1], q[2], nx, ny, nz, u, t, m, u, t, w));
    }
    for (let i = 1; i < ids.length - 1; i++) {
      if (flip) this.idx.push(ids[0]!, ids[i + 1]!, ids[i]!);
      else this.idx.push(ids[0]!, ids[i]!, ids[i + 1]!);
    }
  }

  /**
   * Pitched roof over a rectangle. The ridge runs along x when `alongX`, else along z.
   * Gable ends are closed with `gable` wall material.
   */
  gable(x0: number, z0: number, x1: number, z1: number, y: number, rise: number, alongX: boolean, over: number, roof: Mat, gable: Mat, gw: Win = NO_WIN): void {
    const yr = y + rise;
    if (alongX) {
      const zm = (z0 + z1) / 2;
      const half = (z1 - z0) / 2;
      const drop = (rise * over) / half;
      this.poly([[x0 - over, y - drop, z0 - over], [x1 + over, y - drop, z0 - over], [x1 + over, yr, zm], [x0 - over, yr, zm]], roof);
      this.poly([[x1 + over, y - drop, z1 + over], [x0 - over, y - drop, z1 + over], [x0 - over, yr, zm], [x1 + over, yr, zm]], roof);
      this.poly([[x0, y, z0], [x0, y, z1], [x0, yr, zm]], gable, gw, false);
      this.poly([[x1, y, z1], [x1, y, z0], [x1, yr, zm]], gable, gw, false);
    } else {
      const xm = (x0 + x1) / 2;
      const half = (x1 - x0) / 2;
      const drop = (rise * over) / half;
      this.poly([[x0 - over, y - drop, z1 + over], [x0 - over, y - drop, z0 - over], [xm, yr, z0 - over], [xm, yr, z1 + over]], roof);
      this.poly([[x1 + over, y - drop, z0 - over], [x1 + over, y - drop, z1 + over], [xm, yr, z1 + over], [xm, yr, z0 - over]], roof);
      this.poly([[x1, y, z0], [x0, y, z0], [xm, yr, z0]], gable, gw, false);
      this.poly([[x0, y, z1], [x1, y, z1], [xm, yr, z1]], gable, gw, false);
    }
  }

  /** Hipped roof: all four sides slope. The ridge runs along the longer side. */
  hip(x0: number, z0: number, x1: number, z1: number, y: number, rise: number, over: number, roof: Mat): void {
    const ax0 = x0 - over;
    const ax1 = x1 + over;
    const az0 = z0 - over;
    const az1 = z1 + over;
    const w = ax1 - ax0;
    const d = az1 - az0;
    const yr = y + rise;
    const ye = y - 0.12;
    if (w >= d) {
      const inset = d / 2;
      const zm = (az0 + az1) / 2;
      const r0: V3 = [ax0 + inset, yr, zm];
      const r1: V3 = [ax1 - inset, yr, zm];
      this.poly([[ax0, ye, az0], [ax1, ye, az0], r1, r0], roof);
      this.poly([[ax1, ye, az1], [ax0, ye, az1], r0, r1], roof);
      this.poly([[ax0, ye, az1], [ax0, ye, az0], r0], roof);
      this.poly([[ax1, ye, az0], [ax1, ye, az1], r1], roof);
    } else {
      const inset = w / 2;
      const xm = (ax0 + ax1) / 2;
      const r0: V3 = [xm, yr, az0 + inset];
      const r1: V3 = [xm, yr, az1 - inset];
      this.poly([[ax0, ye, az1], [ax0, ye, az0], r0, r1], roof);
      this.poly([[ax1, ye, az0], [ax1, ye, az1], r1, r0], roof);
      this.poly([[ax0, ye, az0], [ax1, ye, az0], r0], roof);
      this.poly([[ax1, ye, az1], [ax0, ye, az1], r1], roof);
    }
  }

  /** Upright cylinder or cone frustum with smooth sides and an optional flat cap. */
  cyl(cx: number, cz: number, r0: number, r1: number, y0: number, y1: number, sides: number, m: Mat, cap: Mat | null = m): void {
    const slope = (r0 - r1) / (y1 - y0);
    const first = this.count;
    for (let i = 0; i <= sides; i++) {
      const t = (i / sides) * Math.PI * 2;
      const c = Math.cos(t);
      const s = Math.sin(t);
      const nl = Math.hypot(1, slope);
      const u = (i / sides) * Math.PI * 2 * r0;
      this.v(cx + c * r0, y0, cz + s * r0, c / nl, slope / nl, s / nl, u, y0, m, 0, 0, NO_WIN);
      this.v(cx + c * r1, y1, cz + s * r1, c / nl, slope / nl, s / nl, u, y1, m, 0, 0, NO_WIN);
    }
    for (let i = 0; i < sides; i++) {
      const a = first + i * 2;
      this.idx.push(a, a + 1, a + 3, a, a + 3, a + 2);
    }
    if (cap && r1 > 0.01) {
      const centre = this.v(cx, y1, cz, 0, 1, 0, cx, cz, cap, 0, 0, NO_WIN);
      let prev = -1;
      for (let i = 0; i <= sides; i++) {
        const t = (i / sides) * Math.PI * 2;
        const x = cx + Math.cos(t) * r1;
        const z = cz + Math.sin(t) * r1;
        const id = this.v(x, y1, z, 0, 1, 0, x, z, cap, 0, 0, NO_WIN);
        if (prev >= 0) this.idx.push(centre, id, prev);
        prev = id;
      }
    }
  }
}
