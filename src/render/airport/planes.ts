import { BoxGeometry, BufferAttribute, Group, Mesh, MeshStandardMaterial, type BufferGeometry, type Scene } from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { CELL, TICKS_PER_HOUR } from '../../core/constants';
import { FacilityKind } from '../../sim/facilities';
import type { GameState } from '../../sim/state';
import { FACING_DX, FACING_DY, Facing, type Building } from '../../sim/zoning/zones';

type RGB = [number, number, number];

function part(w: number, h: number, d: number, x: number, y: number, z: number, c: RGB): BufferGeometry {
  const g = new BoxGeometry(w, h, d);
  const col = new Float32Array(g.getAttribute('position').count * 3);
  for (let i = 0; i < col.length; i += 3) col.set(c, i);
  g.setAttribute('color', new BufferAttribute(col, 3));
  g.deleteAttribute('uv');
  g.translate(x, y, z);
  return g.toNonIndexed();
}

/** A twin-engine airliner about 34 m long, nose toward +z. */
function airliner(): BufferGeometry {
  const white: RGB = [0.9, 0.9, 0.9];
  const blue: RGB = [0.08, 0.2, 0.6];
  const dark: RGB = [0.08, 0.09, 0.1];
  const g = mergeGeometries([
    part(3.8, 3.8, 30, 0, 0, 0, white),
    part(3.2, 3.2, 3, 0, -0.1, 16.2, white),
    part(1.6, 1.0, 1.2, 0, 0.9, 17.2, dark),
    part(30, 0.5, 5.5, 0, -0.8, 1, white),
    part(2.2, 2.2, 4.2, -6.5, -1.9, 2.6, blue),
    part(2.2, 2.2, 4.2, 6.5, -1.9, 2.6, blue),
    part(11, 0.35, 3, 0, 0.6, -13.6, white),
    part(0.45, 6.5, 4.2, 0, 4.4, -13.3, blue),
    part(3.85, 0.7, 30, 0, -0.6, 0, blue),
  ])!;
  g.computeBoundingSphere();
  return g;
}

/** The runway as a line in the world: start, unit direction, length, ground height. */
interface Runway {
  x: number;
  z: number;
  dx: number;
  dz: number;
  length: number;
  y: number;
}

/**
 * The runway of an airport building, in world space. It mirrors the layout in the
 * airport model (`render/buildings/facilities.ts`): along the long side of the site,
 * 14 m in from the side away from the road.
 */
function runwayOf(b: Building): Runway {
  const alongX = b.facing === Facing.North || b.facing === Facing.South;
  const W = (alongX ? b.w : b.h) * CELL;
  const D = (alongX ? b.h : b.w) * CELL;
  const cx = (b.x + b.w / 2) * CELL;
  const cz = (b.y + b.h / 2) * CELL;
  // The lot frame: local +z toward the road, local +x a quarter turn from it.
  const zx = FACING_DX[b.facing]!;
  const zz = FACING_DY[b.facing]!;
  const xx = zz;
  const xz = -zx;
  const long = W >= D;
  const U = (long ? W : D) / 2;
  const V = (long ? D : W) / 2;
  const at = (u: number, v: number): [number, number] => {
    const [lx, lz] = long ? [u, v] : [v, -u];
    return [cx + lx * xx + lz * zx, cz + lx * xz + lz * zz];
  };
  const rv = -V + 14;
  const [ax, az] = at(-U + 10, rv);
  const [bx, bz] = at(U - 10, rv);
  const length = Math.hypot(bx - ax, bz - az);
  return { x: ax, z: az, dx: (bx - ax) / length, dz: (bz - az) / length, length, y: b.baseY + 2.2 };
}

const APPROACH = 900;
const smooth = (t: number): number => t * t * (3 - 2 * t);

/**
 * Aircraft at the city's airport: one landing and one taking off in each flight slot.
 * Flights run on the simulation clock (so they stop when the game is paused and hurry at
 * fast speed), and a bigger city has more of them.
 */
export class Planes {
  readonly group = new Group();
  private readonly planes: Mesh[] = [];
  private cachedId = -1;
  private runway: Runway | null = null;

  constructor(scene: Scene) {
    const geo = airliner();
    const mat = new MeshStandardMaterial({ vertexColors: true, roughness: 0.45, metalness: 0.25 });
    for (let i = 0; i < 2; i++) {
      const m = new Mesh(geo, mat);
      m.castShadow = true;
      m.visible = false;
      this.planes.push(m);
      this.group.add(m);
    }
    scene.add(this.group);
  }

  /** Flights an hour: one for a small town, up to six for a big city. */
  static flightsPerHour(population: number): number {
    return Math.max(1, Math.min(6, Math.round(population / 2500) + 1));
  }

  update(state: GameState, alpha: number): void {
    const b = this.find(state);
    if (!b || !this.runway) {
      for (const p of this.planes) p.visible = false;
      return;
    }
    const r = this.runway;
    const slot = TICKS_PER_HOUR / Planes.flightsPerHour(state.stats.population);
    const t = state.tick + alpha;
    // Landing: final approach down the glide path, touchdown, roll-out.
    this.fly(this.planes[0]!, r, (t % slot) / slot, false);
    // Take-off, half a slot later, the other way round the cycle.
    this.fly(this.planes[1]!, r, ((t + slot / 2) % slot) / slot, true);
  }

  private find(state: GameState): Building | null {
    const cached = state.buildings[this.cachedId];
    if (cached && cached.kind === FacilityKind.Airport) return cached.progress >= 1 ? cached : null;
    this.cachedId = -1;
    this.runway = null;
    for (const b of state.buildings) {
      if (b && b.kind === FacilityKind.Airport) {
        this.cachedId = b.id;
        this.runway = runwayOf(b);
        return b.progress >= 1 ? b : null;
      }
    }
    return null;
  }

  /** Places a plane for a point `p` (0..1) of its slot; the movement uses the first 45%. */
  private fly(m: Mesh, r: Runway, p: number, departing: boolean): void {
    const ACTIVE = 0.45;
    if (p > ACTIVE) {
      m.visible = false;
      return;
    }
    const k = p / ACTIVE;
    let s: number;
    let h: number;
    let pitch: number;
    if (!departing) {
      if (k < 0.62) {
        // Approach: from far out and high, straight down the glide path to the threshold.
        const a = k / 0.62;
        s = -APPROACH * (1 - a);
        h = 3 + 140 * (1 - a);
        pitch = 0.05;
      } else {
        // Roll-out: braking to a stop two thirds of the way down the runway.
        const a = (k - 0.62) / 0.38;
        s = r.length * 0.66 * (1 - (1 - a) * (1 - a));
        h = 0;
        pitch = 0;
      }
    } else if (k < 0.4) {
      // Take-off roll, accelerating.
      const a = k / 0.4;
      s = r.length * 0.6 * a * a;
      h = 0;
      pitch = 0;
    } else {
      // Rotate and climb out past the far end.
      const a = (k - 0.4) / 0.6;
      s = r.length * 0.6 + (r.length * 0.4 + APPROACH) * a;
      h = 220 * smooth(a) * a;
      pitch = -0.16;
    }
    m.visible = true;
    // Landings and take-offs use the runway in opposite directions.
    const dir = departing ? -1 : 1;
    const start = departing ? r.length : 0;
    const along = start + dir * s;
    m.position.set(r.x + r.dx * along, r.y + h, r.z + r.dz * along);
    m.rotation.set(0, Math.atan2(r.dx * dir, r.dz * dir), 0);
    m.rotateX(pitch);
  }
}
