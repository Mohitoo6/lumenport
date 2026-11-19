import { CELL, MAP, TICK_MS } from '../../core/constants';
import { Rng } from '../../core/rng';
import { bezLength, bezPoint, bezTangent, closestOnPolyline, newClosest, paramAtArc, type Pt } from '../roads/geometry';
import { edgePolyline, otherEnd } from '../roads/graph';
import { NodeKind, nodeLayout, type NodeLayout } from '../roads/junction';
import { ROAD_SPECS, RoadType, type RoadEdge, type RoadNetwork } from '../roads/types';
import { FACILITIES, FacilityKind } from '../facilities';
import { ZoneType, zoneType, type Building } from '../zoning/zones';
import { findPath } from './pathfinder';
import { frontCell } from '../roads/frontage';

export const MAX_CARS = 2400;
/** Body styles: saloon, SUV, van, and the bus (kind 3). */
export const CAR_KINDS = 4;
export const BUS_KIND = 3;
export const CAR_COLORS = 10;

const DT = TICK_MS / 1000;
/** Share of trips that are not commutes but people driving about town: visits, errands, deliveries. */
const THROUGH_SHARE = 0.2;
/** Cars a quiet network still carries, per metre of road, whatever the population. */
const BASELINE_PER_M = 1 / 140;
const BASELINE_MAX = 70;
/**
 * How strongly a workplace draws traffic, per worker, against a shop's 1. Campuses and
 * offices pull in people from all over the city; factories run shifts and deliveries.
 */
function draw(b: Building): number {
  if (b.kind === FacilityKind.ItPark || b.kind === FacilityKind.University) return 1.6;
  if (b.kind === FacilityKind.Airport) return 1.4;
  if (b.kind !== 0) return 1.2;
  return zoneType(b.zone) === ZoneType.Industrial ? 1.25 : 1;
}

/** Bumper-to-bumper spacing a stopped car keeps from the one ahead, plus its own length. */
const CAR_SPACE = 5.6;
const ACCEL = 3;
const BRAKE = 7;
const COMFORT_BRAKE = 3.6;
const TURN_SPEED = 6.5;
/** Extra room a car leaves behind a bus, which is about 7 m longer than a car. */
const BUS_EXTRA = 7;
/** Ticks a bus waits at a stop: about eight seconds at normal speed. */
const BUS_DWELL = 160;
/** A junction arm keeps right of way for at most this long once others are waiting. */
const GREEN_TICKS = 220;
/** A junction held by an approach that is not using it is handed on after this long. */
const IDLE_TICKS = 8;
/** Lane centre offsets to the right of the centreline, innermost first. */
const LANES: Record<number, readonly number[]> = {
  [RoadType.Street]: [1.75],
  [RoadType.Avenue]: [3.7, 7.15],
};

/**
 * How busy the roads are at a time of day, relative to an ordinary midday (1.0). Two
 * commuter peaks around 9:00 and 18:00, a quiet night.
 */
export function rushFactor(hour: number, flexHours = false): number {
  const h = ((hour % 24) + 24) % 24;
  const bump = (centre: number, width: number): number => {
    let d = Math.abs(h - centre);
    if (d > 12) d = 24 - d;
    return Math.exp(-(d * d) / (2 * width * width));
  };
  // Daytime baseline: low at night, full from mid-morning to evening.
  const day = 0.18 + 0.82 / (1 + Math.exp(-(h - 6.5) * 2.2)) - 0.65 / (1 + Math.exp(-(h - 21.5) * 2));
  // Staggered hours spread the same commuters over a longer, lower peak.
  const peak = flexHours ? 0.45 : 1;
  const width = flexHours ? 2 : 1;
  return Math.max(0.12, day + 1.7 * peak * bump(8.75, 1.0 * width) + 1.9 * peak * bump(18, 1.1 * width));
}

/** Morning trips mostly go to work, evening trips mostly come home. 0..1: share home to work. */
export function commuteBias(hour: number): number {
  const h = ((hour % 24) + 24) % 24;
  if (h >= 6 && h < 11) return 0.85;
  if (h >= 16 && h < 20.5) return 0.15;
  return 0.5;
}

const enum Mode {
  Edge = 0,
  Junction = 1,
}

export interface TrafficSource {
  policies?: { flexHours?: boolean };
  stats?: { metroRiders?: number; busRiders?: number };
  roads: RoadNetwork;
  buildings: ReadonlyArray<Building | null>;
  roadCell: Int32Array;
  seed: number;
}

interface Anchor {
  edge: number;
  /** Arc length from the edge's `a` node. */
  arc: number;
}

const p: Pt = { x: 0, z: 0 };
const q: Pt = { x: 0, z: 0 };
const hit = newClosest();

/**
 * Vehicles. Each car has a route across the road graph, keeps to its lane, follows the
 * car ahead at a safe gap, and takes turns with other approaches at junctions.
 *
 * Cars are stored in dense parallel arrays (index 0..count-1) so the renderer can read
 * them without allocation. Traffic is derived from the city, not saved with it: after a
 * load the streets simply fill up again.
 */
export class Traffic {
  count = 0;
  /** Current and previous positions, for interpolation between ticks. */
  readonly x = new Float32Array(MAX_CARS);
  readonly y = new Float32Array(MAX_CARS);
  readonly z = new Float32Array(MAX_CARS);
  readonly heading = new Float32Array(MAX_CARS);
  readonly px = new Float32Array(MAX_CARS);
  readonly py = new Float32Array(MAX_CARS);
  readonly pz = new Float32Array(MAX_CARS);
  readonly pheading = new Float32Array(MAX_CARS);
  readonly kind = new Uint8Array(MAX_CARS);
  readonly color = new Uint8Array(MAX_CARS);
  /** Speed in metres per second. */
  readonly v = new Float32Array(MAX_CARS);
  /** For a bus: its line (an index into `busLines`); -1 for a car. */
  readonly busLine = new Int16Array(MAX_CARS).fill(-1);
  /** For a bus: the position in its line of the stop it is heading to or waiting at. */
  readonly busNext = new Int16Array(MAX_CARS);
  /** For a bus: ticks left waiting at the stop; 0 while driving. */
  readonly dwell = new Uint16Array(MAX_CARS);
  /** Buses in service now. */
  buses = 0;
  /** Bus lines, as stop building ids in visiting order. Set by the sim. */
  private busLines: number[][] = [];
  private busTargets: number[] = [];
  private busesStale = false;

  /** Cars on the road per resident. Tests raise it to load the network. */
  carsPerPerson = 0.022;
  /**
   * Time of day the player sees, in hours. Set by the game every frame; it drives the
   * morning and evening rush. It is not part of the saved game, and tests leave it at noon.
   */
  hour = 12;
  /** Share of the speed limit cars drive at: below 1 on wet or foggy roads. Set by the sim from the weather. */
  speedFactor = 1;
  /** Trips completed since the last reset, and the smoothed share of speed lost to queues. */
  arrived = 0;
  congestion = 0;
  /** Smoothed cars per 100 m on each edge, for overlays and route choice. */
  density = new Float32Array(0);

  private readonly edge = new Int32Array(MAX_CARS);
  private readonly dir = new Uint8Array(MAX_CARS);
  private readonly lane = new Uint8Array(MAX_CARS);
  /** Distance travelled along the current edge from the node the car entered at. */
  private readonly s = new Float32Array(MAX_CARS);
  private readonly mode = new Uint8Array(MAX_CARS);
  private readonly path: Array<number[]> = [];
  private readonly pathIdx = new Int32Array(MAX_CARS);
  private readonly destEdge = new Int32Array(MAX_CARS);
  private readonly destArc = new Float32Array(MAX_CARS);
  // Junction crossing: a quadratic curve from the stop line to the next lane.
  private readonly jt = new Float32Array(MAX_CARS);
  private readonly jlen = new Float32Array(MAX_CARS);
  private readonly jx0 = new Float32Array(MAX_CARS);
  private readonly jz0 = new Float32Array(MAX_CARS);
  private readonly jcx = new Float32Array(MAX_CARS);
  private readonly jcz = new Float32Array(MAX_CARS);
  private readonly jx1 = new Float32Array(MAX_CARS);
  private readonly jz1 = new Float32Array(MAX_CARS);
  private readonly jy0 = new Float32Array(MAX_CARS);
  private readonly jy1 = new Float32Array(MAX_CARS);
  private readonly jnode = new Int32Array(MAX_CARS);
  /** Speed to cross the junction at: road speed straight on, slower for turns. */
  private readonly jv = new Float32Array(MAX_CARS);
  private readonly nextEdge = new Int32Array(MAX_CARS);
  private readonly nextDir = new Uint8Array(MAX_CARS);
  private readonly nextLane = new Uint8Array(MAX_CARS);
  private readonly nextS = new Float32Array(MAX_CARS);

  private rng: Rng;
  private layouts = new Map<number, NodeLayout>();
  private anchors = new Map<number, Anchor | null>();
  private paths = new Map<number, number[] | null>();
  // Junction right of way. Approaches are grouped into phases, like signal stages:
  // opposite arms share a phase and move together; left turns give way to oncoming cars.
  private phases = new Map<number, Int8Array>();
  /** Per node: the arm whose cars are inside (-1 none, -2 more than one arm). */
  private users = new Int32Array(0);
  /** Per node: cars inside that are turning left, and the arm they came from. */
  private leftCount = new Int32Array(0);
  private leftArm = new Int32Array(0);
  private readonly jleft = new Uint8Array(MAX_CARS);
  private lockArm = new Int32Array(0);
  private lockCount = new Int32Array(0);
  private lockAge = new Int32Array(0);
  private wantArm = new Int32Array(0);
  private lockIdle = new Int32Array(0);
  /** Cars currently crossing a junction toward each lane. */
  private inbound = new Int16Array(0);
  // Per-lane buckets rebuilt each tick.
  private bucketStart = new Int32Array(0);
  private bucketFill = new Int32Array(0);
  private order = new Int32Array(MAX_CARS);
  private edgeCars = new Float32Array(0);
  private homes: number[] = [];
  private works: number[] = [];
  /** Running totals of each list's weights, for weighted picks. */
  private homeW: number[] = [];
  private workW: number[] = [];
  /** Every road edge with a running total of length, to pick a point anywhere on the network. */
  private roadIds: number[] = [];
  private roadW: number[] = [];
  private roadLength = 0;
  private listsAge = 9999;

  constructor(private src: TrafficSource) {
    this.rng = new Rng(src.seed ^ 0x51ed270b);
    for (let i = 0; i < MAX_CARS; i++) this.path.push([]);
  }

  /** Drops every car and cached route. Call when roads change or a new city is loaded. */
  reset(src: TrafficSource = this.src): void {
    this.src = src;
    this.count = 0;
    this.layouts.clear();
    this.phases.clear();
    this.anchors.clear();
    this.paths.clear();
    this.listsAge = 9999;
    this.buses = 0;
    const n = src.roads.nodes.length;
    this.users = new Int32Array(n).fill(-1);
    this.leftCount = new Int32Array(n);
    this.leftArm = new Int32Array(n).fill(-1);
    this.lockArm = new Int32Array(n).fill(-1);
    this.lockCount = new Int32Array(n);
    this.lockAge = new Int32Array(n);
    this.wantArm = new Int32Array(n).fill(-1);
    this.lockIdle = new Int32Array(n);
    const e = src.roads.edges.length;
    this.inbound = new Int16Array(e * 4);
    this.bucketStart = new Int32Array(e * 4 + 1);
    this.bucketFill = new Int32Array(e * 4);
    this.edgeCars = new Float32Array(e);
    this.density = new Float32Array(e);
  }

  private layout(node: number): NodeLayout {
    let l = this.layouts.get(node);
    if (!l) {
      l = nodeLayout(this.src.roads, node);
      this.layouts.set(node, l);
    }
    return l;
  }

  /** How far edge `e` is cut back at `node` (0 unless the node is a real junction). */
  private setback(e: RoadEdge, node: number): number {
    const l = this.layout(node);
    if (l.kind !== NodeKind.Junction) return 0;
    for (const arm of l.arms) if (arm.edge === e.id) return arm.setback;
    return 0;
  }

  /** World position and heading of a point in a lane. `s` runs along the travel direction. */
  private lanePoint(e: RoadEdge, dir: number, lane: number, s: number, out: { x: number; y: number; z: number; h: number }): void {
    const net = this.src.roads;
    const a = net.nodes[e.a]!;
    const b = net.nodes[e.b]!;
    const arc = dir === 0 ? s : e.length - s;
    const t = paramAtArc(edgePolyline(net, e), arc);
    bezPoint(a.x, a.z, e.cx, e.cz, b.x, b.z, t, p);
    bezTangent(a.x, a.z, e.cx, e.cz, b.x, b.z, t, q);
    const len = Math.hypot(q.x, q.z) || 1;
    let fx = q.x / len;
    let fz = q.z / len;
    if (dir === 1) {
      fx = -fx;
      fz = -fz;
    }
    const lanes = LANES[e.type]!;
    const off = lanes[Math.min(lane, lanes.length - 1)]!;
    out.x = p.x - fz * off;
    out.z = p.z + fx * off;
    out.y = a.y + (b.y - a.y) * t;
    out.h = Math.atan2(fx, fz);
  }

  /** Where a building meets the road: the edge along its front and the arc length there. */
  private anchor(b: Building): Anchor | null {
    const cached = this.anchors.get(b.id);
    if (cached !== undefined) return cached;
    let found: Anchor | null = null;
    const { roads, roadCell } = this.src;
    const cell = frontCell(b, roadCell);
    const e = cell >= 0 ? roads.edges[roadCell[cell]!] : null;
    if (e) {
      const poly = edgePolyline(roads, e);
      closestOnPolyline(poly, ((cell % MAP) + 0.5) * CELL, (Math.floor(cell / MAP) + 0.5) * CELL, hit);
      found = { edge: e.id, arc: Math.min(Math.max(hit.s, 1), e.length - 1) };
    }
    this.anchors.set(b.id, found);
    return found;
  }

  private route(from: Anchor, to: Anchor): number[] | null {
    const key = from.edge * 65536 + to.edge;
    let path = this.paths.get(key);
    if (path === undefined) {
      if (this.paths.size > 6000) this.paths.clear();
      path = findPath(this.src.roads, from.edge, from.arc, to.edge, to.arc);
      this.paths.set(key, path);
    }
    return path;
  }

  /**
   * Who travels where. Homes and workplaces are weighted by the square root of the people
   * in them: a tower still draws more trips than a cottage, but not so many more that the
   * traffic all piles onto one street. Offices, campuses and civic buildings with staff
   * count as workplaces, weighted by how far they draw people from.
   */
  private refreshLists(): void {
    this.listsAge = 0;
    this.homes.length = 0;
    this.works.length = 0;
    this.homeW.length = 0;
    this.workW.length = 0;
    let hw = 0;
    let ww = 0;
    for (const b of this.src.buildings) {
      if (!b || b.pop <= 0 || b.progress < 1) continue;
      if (b.kind !== 0 && !(FACILITIES[b.kind]?.jobs ?? 0)) continue;
      const w = Math.sqrt(b.pop) * draw(b);
      if (b.kind === 0 && zoneType(b.zone) === ZoneType.Residential) {
        this.homes.push(b.id);
        this.homeW.push((hw += Math.sqrt(b.pop)));
      } else {
        this.works.push(b.id);
        this.workW.push((ww += w));
      }
    }
    this.roadIds.length = 0;
    this.roadW.length = 0;
    let len = 0;
    for (const e of this.src.roads.edges) {
      if (!e || e.length < 12) continue;
      this.roadIds.push(e.id);
      this.roadW.push((len += e.length));
    }
    this.roadLength = len;
  }

  /** An index picked with probability proportional to its weight (running totals in `cum`). */
  private weighted(cum: number[]): number {
    const total = cum[cum.length - 1] ?? 0;
    if (total <= 0) return -1;
    const r = this.rng.next() * total;
    let lo = 0;
    let hi = cum.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (cum[mid]! < r) lo = mid + 1;
      else hi = mid;
    }
    return lo;
  }

  private pick(list: number[], cum: number[]): Building | null {
    const k = this.weighted(cum);
    return k < 0 ? null : (this.src.buildings[list[k]!] ?? null);
  }

  /** A point somewhere on the network, any road equally likely per metre. */
  private roadPoint(): Anchor | null {
    const k = this.weighted(this.roadW);
    if (k < 0) return null;
    const e = this.src.roads.edges[this.roadIds[k]!];
    if (!e) return null;
    // Keep clear of the junction mouths at both ends, where cars come out of the turn.
    const lo = this.setback(e, e.a) + 10;
    const hi = e.length - this.setback(e, e.b) - 10;
    if (hi <= lo) return null;
    return { edge: e.id, arc: lo + this.rng.next() * (hi - lo) };
  }

  /**
   * Sets the bus lines and how many buses each runs. When the lines change, buses in
   * service finish where they are and new ones start on the new lines.
   */
  setBusLines(lines: ReadonlyArray<{ stops: number[]; buses: number }>): void {
    const next = lines.map((l) => l.stops.slice());
    const same = next.length === this.busLines.length && next.every((l, i) => l.join(',') === this.busLines[i]!.join(','));
    this.busTargets = lines.map((l) => l.buses);
    if (same) return;
    this.busLines = next;
    this.busesStale = true;
  }

  /**
   * Room in a lane at `s`: nothing within `gap` ahead, and nothing behind that could not
   * stop in time for a vehicle pulling out in front of it.
   */
  private laneFree(edge: number, dir: number, lane: number, s: number, gap: number): boolean {
    for (let k = 0; k < this.count; k++) {
      if (this.mode[k] !== Mode.Edge || this.edge[k] !== edge || this.dir[k] !== dir || this.lane[k] !== lane) continue;
      const d = this.s[k]! - s;
      if (d >= 0 && d < gap) return false;
      if (d < 0) {
        const v = this.v[k]!;
        const stopping = (v * v) / (2 * COMFORT_BRAKE) + CAR_SPACE + BUS_EXTRA;
        if (-d < Math.max(gap, stopping)) return false;
      }
    }
    return true;
  }

  /** Puts a bus in service at stop `k` of line `line`, bound for the stop after it. */
  private spawnBus(line: number, k: number): boolean {
    const stops = this.busLines[line]!;
    const here = this.src.buildings[stops[k]!];
    if (this.count >= MAX_CARS || !here) return false;
    const from = this.anchor(here);
    if (!from) return false;
    const e = this.src.roads.edges[from.edge]!;
    const lane = LANES[e.type]!.length - 1;
    if (!this.laneFree(from.edge, 0, lane, from.arc, CAR_SPACE + BUS_EXTRA + 3)) return false;
    const i = this.count++;
    this.edge[i] = from.edge;
    this.dir[i] = 0;
    this.lane[i] = lane;
    this.s[i] = from.arc;
    this.v[i] = 0;
    this.mode[i] = Mode.Edge;
    this.kind[i] = BUS_KIND;
    this.color[i] = 0;
    this.busLine[i] = line;
    this.busNext[i] = k;
    this.dwell[i] = 0;
    this.path[i]!.length = 0;
    // Head for the next stop straight away.
    if (!this.nextStop(i)) {
      this.count--;
      this.busLine[i] = -1;
      return false;
    }
    this.place(i);
    this.px[i] = this.x[i]!;
    this.py[i] = this.y[i]!;
    this.pz[i] = this.z[i]!;
    this.pheading[i] = this.heading[i]!;
    return true;
  }

  /**
   * Sends bus `i` on to the next stop of its line, from wherever it is. A stop it cannot
   * reach is skipped. Returns false if the line has nowhere left to go (the bus is retired).
   */
  private nextStop(i: number): boolean {
    const stops = this.busLines[this.busLine[i]!];
    if (!stops || stops.length < 2) return false;
    const net = this.src.roads;
    const e = net.edges[this.edge[i]!];
    if (!e) return false;
    const arc = this.dir[i] === 0 ? this.s[i]! : e.length - this.s[i]!;
    const from: Anchor = { edge: e.id, arc };
    for (let tries = 1; tries < stops.length; tries++) {
      const k = (this.busNext[i]! + tries) % stops.length;
      const stop = this.src.buildings[stops[k]!];
      const to = stop ? this.anchor(stop) : null;
      if (!to) continue;
      const path = findPath(net, from.edge, from.arc, to.edge, to.arc);
      if (!path) continue;
      let dir: number;
      if (path.length > 0) dir = path[0] === e.b ? 0 : 1;
      else dir = to.arc >= from.arc ? 0 : 1;
      // Turning round means crossing to the other carriageway.
      if (dir !== this.dir[i]) {
        this.dir[i] = dir;
        this.s[i] = e.length - this.s[i]!;
        this.lane[i] = LANES[e.type]!.length - 1;
      }
      const mine = this.path[i]!;
      mine.length = 0;
      for (const nd of path) mine.push(nd);
      this.pathIdx[i] = 0;
      this.destEdge[i] = to.edge;
      this.destArc[i] = to.arc;
      this.busNext[i] = k;
      return true;
    }
    return false;
  }

  /** Keeps each line running its share of buses: one new bus per tick at most. */
  private serviceBuses(): void {
    if (this.busesStale) {
      for (let i = 0; i < this.count; i++) if (this.busLine[i]! >= 0) this.mode[i] = 255;
      this.busesStale = false;
      return;
    }
    const running = new Array<number>(this.busLines.length).fill(0);
    for (let i = 0; i < this.count; i++) if (this.busLine[i]! >= 0 && this.mode[i] !== 255) running[this.busLine[i]!]!++;
    for (let line = 0; line < this.busLines.length; line++) {
      const target = this.busTargets[line] ?? 1;
      const have = running[line]!;
      if (have >= target) continue;
      const stops = this.busLines[line]!;
      // Spread the buses round the loop.
      if (this.spawnBus(line, Math.floor((have * stops.length) / target) % stops.length)) return;
    }
  }

  /**
   * Starts one trip. Returns false if it could not. Most are commutes (to work in the
   * morning, home in the evening, between workplaces in the day); a fifth are people
   * driving about town between any two points on the network, so every road that is built
   * sees some traffic, and a network with nobody living on it yet still has a few cars.
   */
  private spawn(through = false): boolean {
    if (this.count >= MAX_CARS || this.roadIds.length === 0) return false;
    let from: Anchor | null;
    let to: Anchor | null;
    const commute = !through && this.homes.length > 0 && this.works.length > 0 && this.rng.next() >= THROUGH_SHARE;
    if (commute) {
      const r = this.rng.next();
      const toWork = commuteBias(this.hour);
      const a = r < toWork ? this.pick(this.homes, this.homeW) : this.pick(this.works, this.workW);
      const b = r < toWork || r > 0.92 ? this.pick(this.works, this.workW) : this.pick(this.homes, this.homeW);
      if (!a || !b || a === b) return false;
      from = this.anchor(a);
      to = this.anchor(b);
    } else {
      // From somewhere a resident lives (when there is anyone), to anywhere.
      const home = this.homes.length > 0 && this.rng.next() < 0.5 ? this.pick(this.homes, this.homeW) : null;
      from = home ? this.anchor(home) : this.roadPoint();
      to = this.roadPoint();
    }
    if (!from || !to || (from.edge === to.edge && Math.abs(from.arc - to.arc) < 30)) return false;
    const path = this.route(from, to);
    if (!path) return false;
    const net = this.src.roads;
    const e = net.edges[from.edge]!;
    let dir: number;
    if (path.length > 0) dir = path[0] === e.b ? 0 : 1;
    else dir = to.arc >= from.arc ? 0 : 1;
    const s = dir === 0 ? from.arc : e.length - from.arc;
    const lane = LANES[e.type]!.length - 1;

    // Only pull out if there is room in the lane.
    if (!this.laneFree(from.edge, dir, lane, s, CAR_SPACE + 3)) return false;

    const i = this.count++;
    this.busLine[i] = -1;
    this.dwell[i] = 0;
    this.edge[i] = from.edge;
    this.dir[i] = dir;
    this.lane[i] = lane;
    this.s[i] = s;
    this.v[i] = 0;
    this.mode[i] = Mode.Edge;
    const mine = this.path[i]!;
    mine.length = 0;
    for (const nd of path) mine.push(nd);
    this.pathIdx[i] = 0;
    this.destEdge[i] = to.edge;
    this.destArc[i] = to.arc;
    this.kind[i] = this.rng.next() < 0.62 ? 0 : this.rng.next() < 0.7 ? 1 : 2;
    this.color[i] = this.rng.int(CAR_COLORS);
    this.place(i);
    this.px[i] = this.x[i]!;
    this.py[i] = this.y[i]!;
    this.pz[i] = this.z[i]!;
    this.pheading[i] = this.heading[i]!;
    return true;
  }

  private remove(i: number): void {
    const last = --this.count;
    if (i === last) return;
    for (const arr of this.fields) arr[i] = arr[last]!;
    const tmp = this.path[i]!;
    this.path[i] = this.path[last]!;
    this.path[last] = tmp;
  }

  private readonly fields: Array<Float32Array | Int32Array | Int16Array | Uint16Array | Uint8Array> = [
    this.x, this.y, this.z, this.heading, this.px, this.py, this.pz, this.pheading, this.kind, this.color, this.v,
    this.busLine, this.busNext, this.dwell,
    this.edge, this.dir, this.lane, this.s, this.mode, this.pathIdx, this.destEdge, this.destArc,
    this.jt, this.jlen, this.jx0, this.jz0, this.jcx, this.jcz, this.jx1, this.jz1, this.jy0, this.jy1, this.jnode, this.jv, this.jleft,
    this.nextEdge, this.nextDir, this.nextLane, this.nextS,
  ];

  private readonly pt = { x: 0, y: 0, z: 0, h: 0 };

  /** Writes the world position of car `i` from its lane or junction state. */
  private place(i: number): void {
    if (this.mode[i] === Mode.Edge) {
      const e = this.src.roads.edges[this.edge[i]!]!;
      this.lanePoint(e, this.dir[i]!, this.lane[i]!, this.s[i]!, this.pt);
      this.x[i] = this.pt.x;
      this.y[i] = this.pt.y;
      this.z[i] = this.pt.z;
      this.heading[i] = this.pt.h;
    } else {
      const t = Math.min(1, this.jt[i]! / this.jlen[i]!);
      bezPoint(this.jx0[i]!, this.jz0[i]!, this.jcx[i]!, this.jcz[i]!, this.jx1[i]!, this.jz1[i]!, t, p);
      bezTangent(this.jx0[i]!, this.jz0[i]!, this.jcx[i]!, this.jcz[i]!, this.jx1[i]!, this.jz1[i]!, t, q);
      this.x[i] = p.x;
      this.z[i] = p.z;
      this.y[i] = this.jy0[i]! + (this.jy1[i]! - this.jy0[i]!) * t;
      if (Math.abs(q.x) + Math.abs(q.z) > 1e-4) this.heading[i] = Math.atan2(q.x, q.z);
    }
  }

  /** The node car `i` is driving toward on its current edge. */
  private aheadNode(i: number): number {
    const e = this.src.roads.edges[this.edge[i]!]!;
    return this.dir[i] === 0 ? e.b : e.a;
  }

  /**
   * Works out what car `i` does at the node ahead: which edge, direction and lane it
   * takes next. Returns false if this edge is the last of its trip.
   */
  private plan(i: number): boolean {
    const path = this.path[i]!;
    const idx = this.pathIdx[i]!;
    if (idx >= path.length) return false;
    const net = this.src.roads;
    const node = path[idx]!;
    let next = -1;
    if (idx + 1 < path.length) {
      const target = path[idx + 1]!;
      for (const id of net.nodes[node]!.edges) {
        if (id !== this.edge[i] && otherEnd(net.edges[id]!, node) === target) {
          next = id;
          break;
        }
      }
    } else {
      next = this.destEdge[i]!;
    }
    const ne = next >= 0 ? net.edges[next] : null;
    if (!ne || (ne.a !== node && ne.b !== node)) return false;
    this.nextEdge[i] = next;
    this.nextDir[i] = ne.a === node ? 0 : 1;
    const lanes = LANES[ne.type]!.length;
    this.nextLane[i] = lanes === 1 ? 0 : (this.lane[i]! + this.color[i]!) % lanes;
    this.nextS[i] = this.setback(ne, node);
    return true;
  }

  /** Sets up the curve car `i` follows across the junction ahead. */
  private enterJunction(i: number, node: number, stop: number): void {
    const net = this.src.roads;
    const e = net.edges[this.edge[i]!]!;
    const ne = net.edges[this.nextEdge[i]!]!;
    const a = this.pt;
    this.lanePoint(e, this.dir[i]!, this.lane[i]!, stop, a);
    const x0 = a.x;
    const z0 = a.z;
    const y0 = a.y;
    const h0 = a.h;
    this.lanePoint(ne, this.nextDir[i]!, this.nextLane[i]!, this.nextS[i]!, a);
    const x1 = a.x;
    const z1 = a.z;
    const d0x = Math.sin(h0);
    const d0z = Math.cos(h0);
    const d1x = Math.sin(a.h);
    const d1z = Math.cos(a.h);
    // Control point: where the incoming and outgoing lane lines cross.
    let cx = (x0 + x1) / 2;
    let cz = (z0 + z1) / 2;
    const det = d0x * d1z - d0z * d1x;
    if (Math.abs(det) > 0.15) {
      const t = ((x1 - x0) * d1z - (z1 - z0) * d1x) / det;
      const u = ((x1 - x0) * d0z - (z1 - z0) * d0x) / det;
      if (t > 0 && u < 0) {
        cx = x0 + d0x * t;
        cz = z0 + d0z * t;
      }
    }
    this.jx0[i] = x0;
    this.jz0[i] = z0;
    this.jcx[i] = cx;
    this.jcz[i] = cz;
    this.jx1[i] = x1;
    this.jz1[i] = z1;
    this.jy0[i] = y0;
    this.jy1[i] = a.y;
    this.jlen[i] = Math.max(0.5, bezLength(x0, z0, cx, cz, x1, z1, 8));
    const straight = d0x * d1x + d0z * d1z > 0.93;
    this.jv[i] = (straight ? Math.min(ROAD_SPECS[e.type].speed, ROAD_SPECS[ne.type].speed) : TURN_SPEED) * this.speedFactor;
    this.inbound[this.nextEdge[i]! * 4 + this.nextDir[i]! * 2 + this.nextLane[i]!]!++;
    this.lockIdle[node] = 0;
    this.jt[i] = 0;
    this.jnode[i] = node;
    this.mode[i] = Mode.Junction;
  }

  /** Signal phase of each arm at a node: opposite arms share one. */
  private phaseOf(node: number, edgeId: number): number {
    let ph = this.phases.get(node);
    const arms = this.layout(node).arms;
    if (!ph) {
      ph = new Int8Array(arms.length);
      if (arms.length === 4) {
        for (let k = 0; k < 4; k++) ph[k] = k % 2;
      } else if (arms.length === 3) {
        // The two arms that most nearly face each other are the through road.
        let best = 0;
        let bestDot = Infinity;
        for (let k = 0; k < 3; k++) {
          const a = arms[k]!;
          const b = arms[(k + 1) % 3]!;
          const d = a.dx * b.dx + a.dz * b.dz;
          if (d < bestDot) {
            bestDot = d;
            best = k;
          }
        }
        ph[best] = 0;
        ph[(best + 1) % 3] = 0;
        ph[(best + 2) % 3] = 1;
      } else {
        for (let k = 0; k < arms.length; k++) ph[k] = k;
      }
      this.phases.set(node, ph);
    }
    for (let k = 0; k < arms.length; k++) if (arms[k]!.edge === edgeId) return ph[k]!;
    return 0;
  }

  /** True if going from edge `from` to edge `to` at `node` is a left turn. */
  private isLeft(node: number, from: number, to: number): boolean {
    const arms = this.layout(node).arms;
    let a = null;
    let b = null;
    for (const arm of arms) {
      if (arm.edge === from) a = arm;
      if (arm.edge === to) b = arm;
    }
    if (!a || !b) return false;
    // Travel direction into the node is the reverse of the arm's outward direction.
    const cross = -a.dx * b.dz + a.dz * b.dx;
    const dot = -a.dx * b.dx - a.dz * b.dz;
    return cross < -0.35 && dot < 0.8;
  }

  /** True if there is room for car `i` at the start of the lane it wants to turn into. */
  private exitClear(i: number): boolean {
    const key = this.nextEdge[i]! * 4 + this.nextDir[i]! * 2 + this.nextLane[i]!;
    const lo = this.bucketStart[key]!;
    const cnt = this.bucketFill[key]!;
    let tail = Infinity;
    for (let a = lo; a < lo + cnt; a++) {
      const s = this.s[this.order[a]!]!;
      if (s < tail) tail = s;
    }
    return tail - this.nextS[i]! > (this.inbound[key]! + 1) * CAR_SPACE + 1;
  }

  /**
   * Asks for right of way at `node` for car `i` arriving on edge `arm`. The junction is
   * held by one phase at a time; within a phase, a left turn waits for oncoming cars to
   * clear, and oncoming cars wait for a left turn already in progress.
   */
  private mayEnter(node: number, arm: number, i: number): boolean {
    const phase = this.phaseOf(node, arm);
    const holder = this.lockArm[node]!;
    if (holder === -1) {
      const want = this.wantArm[node]!;
      if (want !== -1 && want !== phase) return false;
      this.lockArm[node] = phase;
      this.lockAge[node] = 0;
      this.lockIdle[node] = 0;
      this.wantArm[node] = -1;
    } else if (holder === phase) {
      if (this.wantArm[node] !== -1 && this.lockAge[node]! >= GREEN_TICKS) {
        // Time is up and someone else is waiting: hand over once the junction is clear.
        if (this.lockCount[node] === 0) this.lockArm[node] = -1;
        return false;
      }
    } else {
      if (this.wantArm[node] === -1) this.wantArm[node] = phase;
      return false;
    }
    const left = this.isLeft(node, arm, this.nextEdge[i]!);
    if (left) {
      if (this.lockCount[node]! > 0 && this.users[node] !== arm) return false;
    } else if (this.leftCount[node]! > 0 && this.leftArm[node] !== arm) {
      return false;
    }
    this.jleft[i] = left ? 1 : 0;
    return true;
  }

  /** Target number of cars on the road for the current population. */
  private wanted(): number {
    let people = 0;
    for (const id of this.homes) people += this.src.buildings[id]?.pop ?? 0;
    // Metro and bus riders leave their cars at home.
    people = Math.max(0, people - (this.src.stats?.metroRiders ?? 0) - (this.src.stats?.busRiders ?? 0));
    const rush = rushFactor(this.hour, this.src.policies?.flexHours === true);
    // A built network always carries a little traffic, quieter at night.
    const baseline = Math.min(BASELINE_MAX, this.roadLength * BASELINE_PER_M) * Math.min(1, 0.35 + 0.65 * rush);
    return Math.min(MAX_CARS, Math.round(Math.max(people * this.carsPerPerson * rush, baseline)));
  }

  /** Advances all traffic by one simulation tick. */
  tick(): void {
    const net = this.src.roads;
    if (this.lockArm.length !== net.nodes.length || this.edgeCars.length !== net.edges.length) this.reset();

    if (++this.listsAge > 200) this.refreshLists();
    this.serviceBuses();
    let buses = 0;
    for (let i = 0; i < this.count; i++) if (this.busLine[i]! >= 0) buses++;
    this.buses = buses;
    const want = this.wanted();
    // At the start of a rush the roads fill quickly.
    const cars = this.count - buses;
    const burst = want > cars * 1.3 ? 6 : 3;
    for (let k = 0; k < burst && this.count - buses < want; k++) this.spawn();

    const n = this.count;
    for (let i = 0; i < n; i++) {
      this.px[i] = this.x[i]!;
      this.py[i] = this.y[i]!;
      this.pz[i] = this.z[i]!;
      this.pheading[i] = this.heading[i]!;
    }

    // Bucket cars by lane (edge, direction, lane) with a counting sort.
    const start = this.bucketStart;
    start.fill(0);
    for (let i = 0; i < n; i++) {
      if (this.mode[i] === Mode.Edge) start[this.edge[i]! * 4 + this.dir[i]! * 2 + this.lane[i]! + 1]!++;
    }
    for (let k = 1; k < start.length; k++) start[k]! += start[k - 1]!;
    const fill = this.bucketFill;
    fill.fill(0);
    const order = this.order;
    for (let i = 0; i < n; i++) {
      if (this.mode[i] !== Mode.Edge) continue;
      const key = this.edge[i]! * 4 + this.dir[i]! * 2 + this.lane[i]!;
      order[start[key]! + fill[key]!++] = i;
    }

    this.edgeCars.fill(0);
    let speedSum = 0;
    let limitSum = 0;

    for (let key = 0; key < fill.length; key++) {
      const cnt = fill[key]!;
      if (cnt === 0) continue;
      const lo = start[key]!;
      // Front car first: insertion sort by distance along the edge, descending.
      for (let a = lo + 1; a < lo + cnt; a++) {
        const c = order[a]!;
        let b = a - 1;
        while (b >= lo && this.s[order[b]!]! < this.s[c]!) {
          order[b + 1] = order[b]!;
          b--;
        }
        order[b + 1] = c;
      }
      const e = net.edges[key >> 2]!;
      const vmax = ROAD_SPECS[e.type].speed * this.speedFactor;
      this.edgeCars[e.id]! += cnt;
      let leadS = Infinity;
      let leadExtra = 0;
      for (let a = lo; a < lo + cnt; a++) {
        const i = order[a]!;
        const bus = this.busLine[i]! >= 0;
        // A bus at its stop: it holds its place (so the traffic behind waits), then moves on.
        if (bus && this.dwell[i]! > 0) {
          this.v[i] = 0;
          // The queue behind sees it where it stands this tick, even if it turns round next.
          leadS = this.s[i]!;
          leadExtra = BUS_EXTRA;
          if (--this.dwell[i]! === 0 && !this.nextStop(i)) this.mode[i] = 255;
          this.place(i);
          continue;
        }
        const node = this.aheadNode(i);
        const last = this.pathIdx[i]! >= this.path[i]!.length;
        const stop = e.length - this.setback(e, node);
        let room = leadS - this.s[i]! - CAR_SPACE - leadExtra;
        let goal = Infinity;
        let enter = false;
        if (last) {
          // Final edge: drive to the destination's kerb.
          const arc = this.destArc[i]!;
          goal = this.dir[i] === 0 ? arc : e.length - arc;
        } else if (a === lo) {
          const l = this.layout(node);
          if (l.kind === NodeKind.Junction && l.arms.length >= 3) {
            // Hold at the stop line unless this approach has right of way.
            if (this.s[i]! >= stop - 30 && this.plan(i) && this.exitClear(i) && this.mayEnter(node, e.id, i)) enter = true;
            else room = Math.min(room, stop - this.s[i]! - 0.4);
          } else {
            enter = true;
          }
        }
        const limit = room === Infinity ? vmax : Math.min(vmax, Math.sqrt(2 * COMFORT_BRAKE * Math.max(0, room - 0.5)));
        let v = this.v[i]!;
        v = v < limit ? Math.min(limit, v + ACCEL * DT) : Math.max(limit, v - BRAKE * DT);
        this.v[i] = v;
        let s = this.s[i]! + v * DT;
        speedSum += v;
        limitSum += vmax;
        leadS = s;
        leadExtra = bus ? BUS_EXTRA : 0;

        if (last && s >= goal - 0.5) {
          if (bus) {
            // At the stop: pull up and wait for passengers.
            this.s[i] = Math.min(s, goal);
            this.v[i] = 0;
            this.dwell[i] = BUS_DWELL;
            this.place(i);
            continue;
          }
          this.mode[i] = 255; // arrived: removed below
          continue;
        }
        if (!last && s >= stop) {
          if (!enter || !this.plan(i)) {
            // Lost its route (the network changed under it) or no right of way: wait.
            s = Math.min(s, stop - 0.05);
            if (!enter) {
              this.s[i] = s;
              this.place(i);
              continue;
            }
            this.mode[i] = 255;
            continue;
          }
          const l = this.layout(node);
          if (l.kind === NodeKind.Junction) {
            this.users[node] = this.lockCount[node] === 0 || this.users[node] === e.id ? e.id : -2;
            this.lockCount[node]!++;
            if (l.arms.length < 3) this.jleft[i] = 0;
            if (this.jleft[i]) {
              this.leftCount[node]!++;
              this.leftArm[node] = e.id;
            }
            this.enterJunction(i, node, stop);
            this.jt[i] = s - stop;
          } else {
            // A plain joint: carry straight on to the next edge.
            this.edge[i] = this.nextEdge[i]!;
            this.dir[i] = this.nextDir[i]!;
            this.s[i] = s - stop;
            this.pathIdx[i]!++;
            this.place(i);
            continue;
          }
          this.place(i);
          continue;
        }
        this.s[i] = s;
        this.place(i);
      }
    }

    // Cars crossing junctions.
    for (let i = 0; i < n; i++) {
      if (this.mode[i] !== Mode.Junction) continue;
      let v = this.v[i]!;
      const jv = this.jv[i]!;
      v = v < jv ? Math.min(jv, v + ACCEL * DT) : Math.max(jv, v - COMFORT_BRAKE * DT);
      this.v[i] = v;
      this.jt[i]! += v * DT;
      if (this.jt[i]! >= this.jlen[i]!) {
        const node = this.jnode[i]!;
        if (this.jleft[i]) this.leftCount[node] = Math.max(0, this.leftCount[node]! - 1);
        if (--this.lockCount[node]! <= 0) {
          this.lockCount[node] = 0;
          this.users[node] = -1;
          // Keep the phase while its own queue is still discharging, so cars cross in
          // platoons. It is handed on when its time is up or (see the idle check) when
          // nobody on this phase follows.
          if (this.wantArm[node] !== -1 && this.lockAge[node]! >= GREEN_TICKS) this.lockArm[node] = -1;
        }
        this.inbound[this.nextEdge[i]! * 4 + this.nextDir[i]! * 2 + this.nextLane[i]!]!--;
        this.mode[i] = Mode.Edge;
        this.edge[i] = this.nextEdge[i]!;
        this.dir[i] = this.nextDir[i]!;
        this.lane[i] = this.nextLane[i]!;
        this.s[i] = this.nextS[i]! + (this.jt[i]! - this.jlen[i]!);
        this.pathIdx[i]!++;
      }
      this.place(i);
    }
    for (let k = 0; k < this.lockAge.length; k++) {
      if (this.lockArm[k] === -1) continue;
      this.lockAge[k]!++;
      // An approach that holds the junction but cannot use it (its exit is blocked) lets go.
      if (this.lockCount[k] === 0 && ++this.lockIdle[k]! > IDLE_TICKS) this.lockArm[k] = -1;
    }

    // Remove cars that arrived.
    for (let i = this.count - 1; i >= 0; i--) {
      if (this.mode[i] === 255) {
        if (this.busLine[i]! < 0) this.arrived++;
        this.remove(i);
      }
    }

    const slow = limitSum > 0 ? 1 - speedSum / limitSum : 0;
    this.congestion += (slow - this.congestion) * 0.01;
    for (let k = 0; k < this.density.length; k++) {
      const e = net.edges[k];
      const d = e ? (this.edgeCars[k]! / Math.max(20, e.length)) * 100 : 0;
      this.density[k]! += (d - this.density[k]!) * 0.02;
    }
  }

  /** For tests: lane state of car `i`. */
  debug(i: number): { edge: number; dir: number; lane: number; s: number; mode: number } {
    return { edge: this.edge[i]!, dir: this.dir[i]!, lane: this.lane[i]!, s: this.s[i]!, mode: this.mode[i]! };
  }
}
