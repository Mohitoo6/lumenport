import { CONCRETE, CONCRETE_DARK, DIRT, Layer, NO_WIN, STEEL_DARK, WOOD, fence, ground, mat, pick, type Lot, type RGB } from './common';

export interface Massing {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  maxY: number;
}

const HOARDING: readonly RGB[] = [
  [0.3, 0.5, 0.75],
  [0.3, 0.6, 0.4],
  [1.3, 1.3, 1.25],
  [1.4, 1.0, 0.3],
];

const CRANE = mat(Layer.Metal, [1.9, 1.35, 0.2], 1.2);

/**
 * A building site. Stage 0 is cleared ground with a foundation slab; stages 1-3 raise a
 * concrete frame toward the finished building's height. Tall jobs get a tower crane.
 */
export function construction(l: Lot, stage: number, m: Massing): void {
  const { g, r, W, D } = l;
  ground(l, DIRT);
  let x0 = m.minX;
  let x1 = m.maxX;
  let z0 = m.minZ;
  let z1 = m.maxZ;
  let height = m.maxY;
  if (!(height > 0) || x1 - x0 < 3 || z1 - z0 < 3) {
    x0 = -W * 0.3;
    x1 = W * 0.3;
    z0 = -D * 0.3;
    z1 = D * 0.25;
    height = 6;
  }
  // Keep the frame just inside the finished envelope.
  x0 += 0.25;
  x1 -= 0.25;
  z0 += 0.25;
  z1 -= 0.25;

  // Site hoarding on the sides and back; the street side stays open for deliveries.
  if (W >= 16) {
    const hm = mat(Layer.Plaster2, pick(r, HOARDING), 3);
    const hx = W / 2 - 0.25;
    const hz = D / 2 - 0.25;
    fence(g, -hx, -hz, hx, -hz, 2, hm);
    fence(g, -hx, -hz, -hx, hz, 2, hm);
    fence(g, hx, -hz, hx, hz, 2, hm);
  }

  // Foundation.
  g.box(x0 - 0.4, z0 - 0.4, x1 + 0.4, z1 + 0.4, 0, 0.35, CONCRETE);

  if (stage >= 1) {
    const floorH = height > 16 ? 3.6 : 3.0;
    const h = Math.max(floorH, height * (stage / 3) * 0.96);
    const floors = Math.max(1, Math.round(h / floorH));
    const top = floors * floorH;
    const nx = Math.max(1, Math.round((x1 - x0) / 5.5));
    const nz = Math.max(1, Math.round((z1 - z0) / 5.5));
    for (let i = 0; i <= nx; i++) {
      for (let j = 0; j <= nz; j++) {
        const cx = x0 + ((x1 - x0) * i) / nx;
        const cz = z0 + ((z1 - z0) * j) / nz;
        g.box(cx - 0.22, cz - 0.22, cx + 0.22, cz + 0.22, 0.35, top + 0.35, CONCRETE, NO_WIN, null);
      }
    }
    for (let f = 1; f <= floors; f++) {
      const y = 0.35 + f * floorH;
      g.box(x0 - 0.15, z0 - 0.15, x1 + 0.15, z1 + 0.15, y - 0.25, y, f === floors ? CONCRETE_DARK : CONCRETE);
    }
    // Once the frame is topped out, the lower walls start to close in.
    if (stage >= 3) {
      const wm = mat(Layer.ConcreteWall, [0.95, 0.95, 0.95], 3);
      const upTo = 0.35 + Math.max(1, Math.floor(floors * 0.55)) * floorH;
      g.wall(x0, z0, x1, z0, 0.35, upTo, wm);
      g.wall(x1, z0, x1, z1, 0.35, upTo, wm);
      g.wall(x0, z1, x0, z0, 0.35, upTo, wm);
    }

    if (height > 32) {
      // Tower crane: mast beside the frame, slewing unit, jib and counter-jib.
      const mx = x1 + 2.2 < W / 2 - 1 ? x1 + 2.2 : x0 - 2.2;
      const mz = z0 + 1.5;
      const mh = height + 9;
      g.box(mx - 0.75, mz - 0.75, mx + 0.75, mz + 0.75, 0, mh, CRANE, NO_WIN, null);
      g.box(mx - 1.6, mz - 1.6, mx + 1.6, mz + 1.6, 0, 0.5, CONCRETE);
      g.box(mx - 1.0, mz - 1.0, mx + 1.0, mz + 1.0, mh, mh + 1.8, mat(Layer.Plaster2, [1.25, 1.25, 1.2], 3));
      const reach = Math.max(W, D) * 0.75;
      const dir = mx > 0 ? -1 : 1;
      const jx0 = dir > 0 ? mx - reach * 0.3 : mx - reach;
      const jx1 = dir > 0 ? mx + reach : mx + reach * 0.3;
      g.box(jx0, mz - 0.45, jx1, mz + 0.45, mh + 1.8, mh + 2.7, CRANE);
      const cwx = dir > 0 ? jx0 : jx1 - 2.4;
      g.box(cwx, mz - 0.7, cwx + 2.4, mz + 0.7, mh + 0.6, mh + 1.8, STEEL_DARK);
      g.cyl(mx, mz, 0.3, 0.05, mh + 2.7, mh + 6.5, 4, CRANE, null);
      // Hook line.
      const hx = mx + dir * reach * 0.55;
      g.box(hx - 0.04, mz - 0.04, hx + 0.04, mz + 0.04, mh + 1.8 - Math.min(mh - 6, height * 0.4), mh + 1.8, STEEL_DARK, NO_WIN, null);
    }
  }

  // Site clutter: spoil heap, stacked timber, a cabin.
  const sx = -W / 2 + 2.2;
  const sz = D / 2 - 2.6;
  if (W >= 12) {
    g.cyl(sx, sz, 1.7, 0.1, 0, 1.3, 9, DIRT, null);
    g.box(W / 2 - 4, D / 2 - 2.4, W / 2 - 1.2, D / 2 - 1.2, 0, 0.5 + r.next() * 0.5, WOOD);
  }
  if (W >= 20) {
    g.box(W / 2 - 7, -D / 2 + 1, W / 2 - 1.2, -D / 2 + 3.4, 0.1, 2.6, mat(Layer.Metal, [1.5, 1.5, 1.45], 1.4));
  }
}
