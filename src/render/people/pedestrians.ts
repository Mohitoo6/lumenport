import { BufferAttribute, CapsuleGeometry, DynamicDrawUsage, InstancedBufferAttribute, InstancedMesh, MeshStandardMaterial, SphereGeometry, type BufferGeometry, type Scene } from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { CELL, MAP } from '../../core/constants';
import { FacilityKind } from '../../sim/facilities';
import { activeStations } from '../../sim/transit/metro';
import { servedStops } from '../../sim/transit/bus';
import { bezPoint, bezTangent, closestOnPolyline, newClosest, paramAtArc, type Pt } from '../../sim/roads/geometry';
import { frontCell } from '../../sim/roads/frontage';
import { edgePolyline } from '../../sim/roads/graph';
import { ROAD_SPECS, type RoadEdge } from '../../sim/roads/types';
import type { Sim } from '../../sim/sim';
import { rushFactor } from '../../sim/traffic/traffic';
import { FACING_DX, FACING_DY, ZoneType, zoneType, type Building } from '../../sim/zoning/zones';

const MAX = 600;
/** Seconds between recounts of where people walk. */
const FOOTFALL_EVERY = 3;
/** A quiet street still has someone on it now and then: people per 100 m of road. */
const QUIET_PER_100M = 0.35;
/** Chance a walker reaching a corner goes indoors instead, and someone appears where people gather. */
const GO_INSIDE = 0.3;

/**
 * How many people a building puts on the pavement in front of it in the daytime.
 * Shops, offices, campuses and stations draw crowds; homes and factories very few.
 */
function footfall(b: Building, stations: Set<number>, stops: Set<number>): number {
  switch (b.kind) {
    case 0: {
      const z = zoneType(b.zone);
      const root = Math.sqrt(Math.max(0, b.pop));
      if (z === ZoneType.Commercial) return 0.45 * root + 0.6;
      if (z === ZoneType.Industrial) return 0.08 * root;
      return 0.07 * root;
    }
    case FacilityKind.ItPark:
      return 16;
    case FacilityKind.University:
      return 18;
    case FacilityKind.School:
      return 6;
    case FacilityKind.MetroStation:
      return stations.has(b.id) ? 8 : 0.5;
    case FacilityKind.BusStop:
      return stops.has(b.id) ? 3 : 0.3;
    case FacilityKind.Park:
      return 2.5;
    case FacilityKind.Hospital:
      return 10;
    case FacilityKind.SportsGround:
      return 9;
    case FacilityKind.Clinic:
    case FacilityKind.TownHall:
      return 2;
    case FacilityKind.Airport:
      return 3;
    default:
      return 0.2;
  }
}
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
const HIT = newClosest();
const tan: Pt = { x: 0, z: 0 };

/**
 * People on the pavements. They are scenery, not simulation: drawn only near the camera.
 * Where they walk follows what is on each street: crowds outside shops, offices, campuses
 * and stations, a few on residential streets, more in daylight and fewer in the rain. Each
 * walks along a pavement, and at a corner either goes indoors or carries on, preferring
 * the busier street. People also wait at served bus stops and metro stations.
 */
export class Pedestrians {
  private readonly mesh: InstancedMesh;
  private readonly walkers: Walker[] = [];
  private time = 0;
  /** People each road edge carries in daylight, recounted every few seconds. */
  private foot = new Float32Array(0);
  private footAge = Infinity;
  /** Where along each edge the crowds are: the doors of the buildings that draw them. */
  private spots = new Map<number, { arc: number[]; cum: number[] }>();
  /** Edges in view and a running total of their footfall, for weighted picks. */
  private readonly nearIds: number[] = [];
  private readonly nearCum: number[] = [];

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
    this.footAge += Math.max(dt, 1 / 60);
    if (this.footAge >= FOOTFALL_EVERY || this.foot.length !== net.edges.length) this.recount(sim);
    // How many to show: what is on the streets in view, the hour and the weather.
    const day = Math.min(1, rushFactor(hour) * 0.7);
    this.nearIds.length = 0;
    this.nearCum.length = 0;
    let total = 0;
    for (const e of net.edges) {
      if (!e || e.length < 12 || !this.near(net, e, focus, reach)) continue;
      total += this.foot[e.id]!;
      this.nearIds.push(e.id);
      this.nearCum.push(total);
    }
    const target = Math.min(MAX, Math.round(total * day * (1 - 0.75 * rain)));

    // Retire people who walked out of view (or whose street was removed).
    for (let i = this.walkers.length - 1; i >= 0; i--) {
      const w = this.walkers[i]!;
      if (w.wait) continue;
      const e = net.edges[w.edge];
      if (!e || !this.near(net, e, focus, reach * 1.05)) this.walkers.splice(i, 1);
    }
    // Far more people than the streets in view call for (the camera moved from a busy
    // street to a quiet one): the ones farthest away go first, so the view settles in seconds.
    let walking0 = 0;
    for (const w of this.walkers) if (!w.wait) walking0++;
    if (walking0 > target * 1.3 + 4) {
      const out = Math.min(walking0 - Math.round(target * 1.3), 8);
      const far = this.walkers.filter((w) => !w.wait).map((w) => ({ w, d: this.distTo(net, w, focus) })).sort((a, b) => b.d - a.d).slice(0, out);
      const drop = new Set(far.map((f) => f.w));
      for (let i = this.walkers.length - 1; i >= 0; i--) if (drop.has(this.walkers[i]!)) this.walkers.splice(i, 1);
    }
    this.syncWaiting(sim, focus, reach, day, rain);
    // Bring in new ones on streets in view, a few each frame.
    const walking = this.walkers.filter((w) => !w.wait).length;
    for (let k = 0; k < 12 && walking + k < target && this.walkers.length < MAX; k++) this.spawn(net);
    // Too many for the hour (the evening, a shower): people go indoors at the corners.
    const excess = walking > target * 1.15 + 2;

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
        if (w.s < 0 || w.s > e.length) {
          if (excess || Math.random() < GO_INSIDE) {
            w.edge = -2;
            continue;
          }
          this.turnCorner(net, w, e);
        }
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
    // Those who went indoors this frame.
    for (let i = this.walkers.length - 1; i >= 0; i--) if (this.walkers[i]!.edge === -2) this.walkers.splice(i, 1);
    this.mesh.instanceMatrix.needsUpdate = true;
    this.mesh.instanceColor!.needsUpdate = true;
  }

  /** Rough distance from a walker's street to the point of interest. */
  private distTo(net: Sim['state']['roads'], w: Walker, focus: { x: number; z: number }): number {
    const e = net.edges[w.edge];
    if (!e) return Infinity;
    const a = net.nodes[e.a]!;
    const b = net.nodes[e.b]!;
    const t = Math.max(0, Math.min(1, w.s / Math.max(1, e.length)));
    return Math.hypot(a.x + (b.x - a.x) * t - focus.x, a.z + (b.z - a.z) * t - focus.z);
  }

  private near(net: Sim['state']['roads'], e: RoadEdge, focus: { x: number; z: number }, r: number): boolean {
    const a = net.nodes[e.a]!;
    const b = net.nodes[e.b]!;
    return Math.hypot((a.x + b.x) / 2 - focus.x, (a.z + b.z) / 2 - focus.z) < r + e.length / 2;
  }

  /** Someone steps out onto a street in view, busier streets more likely. */
  private spawn(net: Sim['state']['roads']): void {
    const total = this.nearCum[this.nearCum.length - 1] ?? 0;
    if (total <= 0) return;
    const r = Math.random() * total;
    let lo = 0;
    let hi = this.nearCum.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (this.nearCum[mid]! < r) lo = mid + 1;
      else hi = mid;
    }
    const e = net.edges[this.nearIds[lo]!];
    if (!e) return;
    // Mostly near a door that draws people; otherwise anywhere along the street.
    let s = 4 + Math.random() * (e.length - 8);
    const spots = this.spots.get(e.id);
    const quiet = (QUIET_PER_100M * e.length) / 100;
    if (spots && Math.random() * this.foot[e.id]! > quiet) {
      const total = spots.cum[spots.cum.length - 1]!;
      const r = Math.random() * total;
      let k = 0;
      while (k < spots.cum.length - 1 && spots.cum[k]! < r) k++;
      const spread = (Math.random() + Math.random() + Math.random() - 1.5) * 16;
      s = Math.max(2, Math.min(e.length - 2, spots.arc[k]! + spread));
    }
    this.walkers.push({
      edge: e.id,
      s,
      dir: Math.random() < 0.5 ? 1 : -1,
      side: Math.random() < 0.5 ? 1 : -1,
      speed: 1.1 + Math.random() * 0.5,
      phase: Math.random() * 6.28,
      colour: Math.floor(Math.random() * CLOTHES.length),
    });
  }

  /**
   * People per road edge in daylight: a little for any street, plus what the buildings
   * along it draw. Half of a building's pull spills onto the streets meeting its own at
   * either end, so a busy block's corners are busy too.
   */
  private recount(sim: Sim): void {
    this.footAge = 0;
    const net = sim.state.roads;
    const foot = new Float32Array(net.edges.length);
    for (const e of net.edges) if (e) foot[e.id] = (QUIET_PER_100M * e.length) / 100;
    const stations = activeStations(sim.state);
    const stops = servedStops(sim.busLines);
    const add = (id: number, v: number): void => {
      if (id >= 0 && id < foot.length && net.edges[id]) foot[id] = foot[id]! + v;
    };
    const spots = new Map<number, { arc: number[]; cum: number[] }>();
    const roadCell = sim.state.roadCell;
    for (const b of sim.state.buildings) {
      if (!b || b.progress < 1) continue;
      const v = footfall(b, stations, stops);
      if (v <= 0) continue;
      const cell = frontCell(b, roadCell);
      if (cell < 0) continue;
      const id = roadCell[cell]!;
      const e = net.edges[id];
      if (!e) continue;
      add(id, v);
      // The door: the point on the street nearest the building's front.
      closestOnPolyline(edgePolyline(net, e), ((cell % MAP) + 0.5) * CELL, (Math.floor(cell / MAP) + 0.5) * CELL, HIT);
      let list = spots.get(id);
      if (!list) spots.set(id, (list = { arc: [], cum: [] }));
      list.arc.push(HIT.s);
      list.cum.push((list.cum[list.cum.length - 1] ?? 0) + v);
      for (const node of [e.a, e.b]) {
        const others = net.nodes[node]!.edges.filter((o) => o !== id && net.edges[o]);
        for (const o of others) add(o, (v * 0.25) / Math.max(1, others.length / 2));
      }
    }
    this.foot = foot;
    this.spots = spots;
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
    // Busier streets are likelier.
    let sum = 0;
    for (const id of options) sum += 0.3 + (this.foot[id] ?? 0) / Math.max(1, net.edges[id]!.length / 100);
    let r = Math.random() * sum;
    let pick = options[options.length - 1]!;
    for (const id of options) {
      r -= 0.3 + (this.foot[id] ?? 0) / Math.max(1, net.edges[id]!.length / 100);
      if (r <= 0) {
        pick = id;
        break;
      }
    }
    const next = net.edges[pick]!;
    w.edge = next.id;
    // Walk away from the corner on the new street.
    w.dir = next.a === node ? 1 : -1;
    w.s = w.dir > 0 ? 0.5 : next.length - 0.5;
  }

  /** A small knot of people at each served bus stop in view, and a crowd at each metro station on a line. */
  private syncWaiting(sim: Sim, focus: { x: number; z: number }, reach: number, day: number, rain: number): void {
    const want = new Map<number, number>();
    const consider = (id: number, count: number): void => {
      const b = sim.state.buildings[id];
      if (!b) return;
      const x = (b.x + b.w / 2) * CELL;
      const z = (b.y + b.h / 2) * CELL;
      if (Math.hypot(x - focus.x, z - focus.z) > reach) return;
      // Under the shelter in the rain; fewer at night.
      want.set(id, Math.max(1, Math.round(count * (0.35 + 0.65 * day))));
    };
    for (const id of servedStops(sim.busLines)) if (sim.state.buildings[id]?.kind === FacilityKind.BusStop) consider(id, 2 + (id % 4));
    for (const id of activeStations(sim.state)) if (sim.state.buildings[id]?.kind === FacilityKind.MetroStation) consider(id, Math.round((7 + (id % 5)) * (1 - 0.3 * rain)));
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
        // Stand along the shelter, or in loose rows outside the station entrance, facing the road.
        const fx = FACING_DX[b.facing]!;
        const fz = FACING_DY[b.facing]!;
        const station = b.kind === FacilityKind.MetroStation;
        const row = station ? k % 6 : k;
        const depth = station ? 1.2 * Math.floor(k / 6) + (Math.random() - 0.5) * 0.4 : 0;
        const along = (row - (station ? 3 : count / 2)) * (station ? 1.4 : 0.9) + (station ? (Math.random() - 0.5) * 0.5 : 0);
        const front = (station ? (fx !== 0 ? b.w : b.h) * CELL * 0.5 + 0.4 : 2.2) - depth;
        const x = (b.x + b.w / 2) * CELL + fx * front + fz * along;
        const z = (b.y + b.h / 2) * CELL + fz * front - fx * along;
        this.walkers.push({ edge: -1, s: 0, dir: 1, side: 1, speed: 0, phase: Math.random() * 6.28, colour: Math.floor(Math.random() * CLOTHES.length), stop: id, wait: { x, z, y: b.baseY + 0.12, h: Math.atan2(fx, fz) } });
      }
    }
  }
}
