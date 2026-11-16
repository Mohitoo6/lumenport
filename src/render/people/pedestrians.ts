import { BufferAttribute, CapsuleGeometry, DynamicDrawUsage, InstancedBufferAttribute, InstancedMesh, MeshStandardMaterial, SphereGeometry, type BufferGeometry, type Scene } from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { CELL } from '../../core/constants';
import { FacilityKind } from '../../sim/facilities';
import { bezPoint, bezTangent, paramAtArc, type Pt } from '../../sim/roads/geometry';
import { edgePolyline } from '../../sim/roads/graph';
import { ROAD_SPECS, type RoadEdge } from '../../sim/roads/types';
import type { Sim } from '../../sim/sim';
import { rushFactor } from '../../sim/traffic/traffic';
import { FACING_DX, FACING_DY } from '../../sim/zoning/zones';

const MAX = 900;
/** How far from the camera's point of interest people are kept, as a share of the viewing distance. */
const REACH = 1.15;
/** Beyond this camera distance people are too small to see, so none are drawn. */
const FAR = 420;

/** A person about 1.7 m tall: a body and a head. Skin is the vertex colour; clothes are tinted per person. */
function person(): BufferGeometry {
  const body = new CapsuleGeometry(0.24, 0.9, 3, 8);
  body.translate(0, 0.72, 0);
  const head = new SphereGeometry(0.15, 10, 8);
  head.translate(0, 1.55, 0);
  const paint = (g: BufferGeometry, c: [number, number, number]): BufferGeometry => {
    const n = g.getAttribute('position').count;
    const col = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) col.set(c, i * 3);
    g.setAttribute('color', new BufferAttribute(col, 3));
    g.deleteAttribute('uv');
    return g.toNonIndexed();
  };
  // White body so the instance colour shows as clothing; the head keeps a skin tone.
  const g = mergeGeometries([paint(body, [1, 1, 1]), paint(head, [0.62, 0.42, 0.3])])!;
  g.computeBoundingSphere();
  return g;
}

const CLOTHES: Array<[number, number, number]> = [
  [0.75, 0.75, 0.72],
  [0.05, 0.06, 0.08],
  [0.12, 0.2, 0.45],
  [0.55, 0.08, 0.06],
  [0.6, 0.45, 0.1],
  [0.08, 0.32, 0.18],
  [0.55, 0.2, 0.45],
  [0.85, 0.55, 0.25],
  [0.28, 0.3, 0.32],
];

interface Walker {
  edge: number;
  /** Arc length from the edge's `a` node. */
  s: number;
  /** +1 walking toward `b`, -1 toward `a`. */
  dir: number;
  /** Which pavement: +1 right of the centreline, -1 left. */
  side: number;
  speed: number;
  phase: number;
  colour: number;
  /** A person standing at a bus stop: the stop's building id, and where they wait. */
  stop?: number;
  wait?: { x: number; z: number; y: number; h: number };
}

const pt: Pt = { x: 0, z: 0 };
const tan: Pt = { x: 0, z: 0 };

/**
 * People on the pavements. They are scenery, not simulation: drawn only near the camera,
 * more of them in a busy city, at the rush hours and in daylight, fewer in the rain. Each
 * walks along a pavement and carries on to a connected street at the corner. People also
 * wait at bus stops that a line serves.
 */
export class Pedestrians {
  private readonly mesh: InstancedMesh;
  private readonly walkers: Walker[] = [];
  private time = 0;

  constructor(scene: Scene) {
    const mat = new MeshStandardMaterial({ vertexColors: true, roughness: 0.85, metalness: 0 });
    this.mesh = new InstancedMesh(person(), mat, MAX);
    this.mesh.count = 0;
    this.mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    this.mesh.instanceColor = new InstancedBufferAttribute(new Float32Array(MAX * 3), 3);
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = true;
    scene.add(this.mesh);
  }

  /**
   * @param focus the camera's point of interest on the ground
   * @param dist camera distance from it, metres
   * @param hour time of day
   * @param rain 0..1
   * @param dt real seconds since the last frame, already scaled by game speed
   */
  update(sim: Sim, focus: { x: number; z: number }, dist: number, hour: number, rain: number, dt: number): void {
    if (dist > FAR) {
      this.mesh.count = 0;
      this.walkers.length = 0;
      return;
    }
    this.time += dt;
    const net = sim.state.roads;
    const reach = Math.max(80, dist * REACH);
    // How many to show: the city's size, the hour, the weather, and the area in view.
    const day = Math.min(1, rushFactor(hour) * 0.7);
    const crowd = Math.min(1, sim.state.stats.population / 6000);
    const target = Math.round(MAX * crowd * day * (1 - 0.75 * rain) * Math.min(1, (reach * reach) / (300 * 300)));

    // Retire people who walked out of view (or whose street was removed).
    for (let i = this.walkers.length - 1; i >= 0; i--) {
      const w = this.walkers[i]!;
      if (w.wait) continue;
      const e = net.edges[w.edge];
      if (!e || !this.near(net, e, focus, reach * 1.2)) this.walkers.splice(i, 1);
    }
    this.syncWaiting(sim, focus, reach);
    // Bring in new ones on streets in view, a few each frame.
    const walking = this.walkers.filter((w) => !w.wait).length;
    for (let k = 0; k < 12 && walking + k < target && this.walkers.length < MAX; k++) this.spawn(net, focus, reach);

    const m = this.mesh.instanceMatrix.array;
    const col = this.mesh.instanceColor!.array;
    let n = 0;
    for (const w of this.walkers) {
      let x: number;
      let y: number;
      let z: number;
      let h: number;
      if (w.wait) {
        ({ x, y, z, h } = w.wait);
        // Shifting weight while waiting.
        h += Math.sin(this.time * 0.4 + w.phase) * 0.3;
      } else {
        const e = net.edges[w.edge]!;
        w.s += w.dir * w.speed * dt;
        if (w.s < 0 || w.s > e.length) this.turnCorner(net, w, e);
        const e2 = net.edges[w.edge]!;
        const a = net.nodes[e2.a]!;
        const b = net.nodes[e2.b]!;
        const t = paramAtArc(edgePolyline(net, e2), Math.max(0, Math.min(e2.length, w.s)));
        bezPoint(a.x, a.z, e2.cx, e2.cz, b.x, b.z, t, pt);
        bezTangent(a.x, a.z, e2.cx, e2.cz, b.x, b.z, t, tan);
        const len = Math.hypot(tan.x, tan.z) || 1;
        const fx = tan.x / len;
        const fz = tan.z / len;
        const spec = ROAD_SPECS[e2.type];
        const off = w.side * (spec.width / 2 - spec.sidewalk / 2);
        x = pt.x - fz * off;
        z = pt.z + fx * off;
        y = a.y + (b.y - a.y) * t + 0.18 + Math.abs(Math.sin(this.time * w.speed * 5 + w.phase)) * 0.05;
        h = Math.atan2(fx * w.dir, fz * w.dir);
      }
      const c = Math.cos(h);
      const s = Math.sin(h);
      const o = n * 16;
      m[o] = c;
      m[o + 1] = 0;
      m[o + 2] = -s;
      m[o + 3] = 0;
      m[o + 4] = 0;
      m[o + 5] = 1;
      m[o + 6] = 0;
      m[o + 7] = 0;
      m[o + 8] = s;
      m[o + 9] = 0;
      m[o + 10] = c;
      m[o + 11] = 0;
      m[o + 12] = x;
      m[o + 13] = y;
      m[o + 14] = z;
      m[o + 15] = 1;
      col.set(CLOTHES[w.colour]!, n * 3);
      n++;
    }
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.mesh.instanceColor!.needsUpdate = true;
  }

  private near(net: Sim['state']['roads'], e: RoadEdge, focus: { x: number; z: number }, r: number): boolean {
    const a = net.nodes[e.a]!;
    const b = net.nodes[e.b]!;
    return Math.hypot((a.x + b.x) / 2 - focus.x, (a.z + b.z) / 2 - focus.z) < r + e.length / 2;
  }

  private spawn(net: Sim['state']['roads'], focus: { x: number; z: number }, reach: number): void {
    // A few tries to land on a street in view.
    for (let tries = 0; tries < 8; tries++) {
      const e = net.edges[Math.floor(Math.random() * net.edges.length)];
      if (!e || e.length < 12 || !this.near(net, e, focus, reach)) continue;
      this.walkers.push({
        edge: e.id,
        s: 4 + Math.random() * (e.length - 8),
        dir: Math.random() < 0.5 ? 1 : -1,
        side: Math.random() < 0.5 ? 1 : -1,
        speed: 1.1 + Math.random() * 0.5,
        phase: Math.random() * 6.28,
        colour: Math.floor(Math.random() * CLOTHES.length),
      });
      return;
    }
  }

  /** At the end of a street, carry on along another street from that corner (or turn back). */
  private turnCorner(net: Sim['state']['roads'], w: Walker, e: RoadEdge): void {
    const node = w.s > e.length ? e.b : e.a;
    const options = net.nodes[node]!.edges.filter((id) => id !== e.id && net.edges[id]);
    if (options.length === 0) {
      w.dir = -w.dir;
      w.s = Math.max(0, Math.min(e.length, w.s));
      return;
    }
    const next = net.edges[options[Math.floor(Math.random() * options.length)]!]!;
    w.edge = next.id;
    // Walk away from the corner on the new street.
    w.dir = next.a === node ? 1 : -1;
    w.s = w.dir > 0 ? 0.5 : next.length - 0.5;
  }

  /** A small knot of people at each served bus stop in view. */
  private syncWaiting(sim: Sim, focus: { x: number; z: number }, reach: number): void {
    const want = new Map<number, number>();
    for (const line of sim.busLines) {
      for (const id of line.stops) {
        const b = sim.state.buildings[id];
        if (!b || b.kind !== FacilityKind.BusStop) continue;
        const x = (b.x + 0.5) * CELL;
        const z = (b.y + 0.5) * CELL;
        if (Math.hypot(x - focus.x, z - focus.z) > reach) continue;
        want.set(id, 2 + (id % 4));
      }
    }
    // Drop people at stops that left the view, then fill the ones that came into it.
    for (let i = this.walkers.length - 1; i >= 0; i--) {
      const w = this.walkers[i]!;
      if (w.wait && !want.has(w.stop!)) this.walkers.splice(i, 1);
    }
    const have = new Map<number, number>();
    for (const w of this.walkers) if (w.wait) have.set(w.stop!, (have.get(w.stop!) ?? 0) + 1);
    for (const [id, count] of want) {
      const b = sim.state.buildings[id]!;
      for (let k = have.get(id) ?? 0; k < count; k++) {
        // Stand along the shelter, facing the road.
        const along = (k - count / 2) * 0.9;
        const fx = FACING_DX[b.facing]!;
        const fz = FACING_DY[b.facing]!;
        const x = (b.x + 0.5) * CELL + fx * 2.2 + fz * along;
        const z = (b.y + 0.5) * CELL + fz * 2.2 - fx * along;
        this.walkers.push({ edge: -1, s: 0, dir: 1, side: 1, speed: 0, phase: Math.random() * 6.28, colour: Math.floor(Math.random() * CLOTHES.length), stop: id, wait: { x, z, y: b.baseY + 0.12, h: Math.atan2(fx, fz) } });
      }
    }
  }
}
