import { heightAt } from '../../sim/map/terrain';
import { ROAD_BED_DROP } from '../../sim/roads/terraform';
import { bezPoint, bezTangent, type Polyline, type Pt } from '../../sim/roads/geometry';
import { edgePolyline } from '../../sim/roads/graph';
import { NodeKind, cornerDistances, type NodeArm, type NodeLayout } from '../../sim/roads/junction';
import { ROAD_SPECS, RoadType, type RoadEdge, type RoadNetwork, type RoadNode } from '../../sim/roads/types';
import { MeshBuilder } from './meshBuilder';

/** Sidewalk height above the carriageway. */
export const CURB = 0.15;
const CURB_TOP = 0.3;
const SKIRT = 0.55;
const MEDIAN_TOP = 0.22;
const PAVE_UV = 1 / 3.2;
const ASPHALT_UV = 1 / 5;
const FAR = 1e4;
/** The median stops short of a junction so crosswalks and turning traffic can pass. */
const MEDIAN_GAP = 5;
const PARAPET = 0.95;
const DECK = 1.3;

export const enum LaneKind {
  Street = 0,
  Avenue = 1,
  Plain = 2,
}

export interface PropSpot {
  x: number;
  y: number;
  z: number;
  /** Yaw in radians. For lamps, the arm points this way. */
  rot: number;
}

export interface RoadBuckets {
  asphalt: MeshBuilder;
  pavement: MeshBuilder;
  concrete: MeshBuilder;
  grass: MeshBuilder;
  lamps: PropSpot[];
  trees: PropSpot[];
}

export function newBuckets(): RoadBuckets {
  return {
    asphalt: new MeshBuilder('aLane', 5),
    pavement: new MeshBuilder(),
    concrete: new MeshBuilder(),
    grass: new MeshBuilder(),
    lamps: [],
    trees: [],
  };
}

/** A cross-section of an edge: where it is, which way it runs and which way is sideways. */
interface Station {
  x: number;
  y: number;
  z: number;
  /** Unit forward direction (a to b). */
  fx: number;
  fz: number;
  /** Lateral axis pointing right. Longer than unit at mitred joints. */
  lx: number;
  lz: number;
  /** Arc length from the edge's `a` node. */
  s: number;
  /** Distance to the junction mouth at each end, or FAR when that end has no junction. */
  dA: number;
  dB: number;
  bridge: boolean;
}

const p: Pt = { x: 0, z: 0 };
const q: Pt = { x: 0, z: 0 };

function tAtArc(poly: Polyline, s: number): number {
  if (s <= 0) return 0;
  if (s >= poly.length) return 1;
  let lo = 0;
  let hi = poly.n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (poly.s[mid]! <= s) lo = mid;
    else hi = mid;
  }
  const span = poly.s[hi]! - poly.s[lo]!;
  const k = span > 0 ? (s - poly.s[lo]!) / span : 0;
  return poly.t[lo]! + (poly.t[hi]! - poly.t[lo]!) * k;
}

const ARC_TMP = { x: 0, z: 0, y: 0 };
/** Share of the outer-bend sweep spent on each straight run in to and out of the turn. */
const ELBOW_IN = 0.2;
const cross2 = (ax: number, az: number, bx: number, bz: number): number => ax * bz - az * bx;

export class RoadMesher {
  constructor(
    private readonly net: RoadNetwork,
    private readonly heights: Float32Array,
    private readonly layoutOf: (node: number) => NodeLayout,
  ) {}

  /** Position, height and forward direction of an edge at arc length s from its `a` end. */
  private sample(e: RoadEdge, poly: Polyline, s: number, out: Station): Station {
    const a = this.net.nodes[e.a]!;
    const b = this.net.nodes[e.b]!;
    const t = tAtArc(poly, s);
    bezPoint(a.x, a.z, e.cx, e.cz, b.x, b.z, t, p);
    bezTangent(a.x, a.z, e.cx, e.cz, b.x, b.z, t, q);
    const len = Math.hypot(q.x, q.z) || 1;
    out.x = p.x;
    out.z = p.z;
    out.y = a.y + (b.y - a.y) * t;
    out.fx = q.x / len;
    out.fz = q.z / len;
    out.lx = -out.fz;
    out.lz = out.fx;
    out.s = s;
    return out;
  }

  private blank(): Station {
    return { x: 0, y: 0, z: 0, fx: 0, fz: 0, lx: 0, lz: 0, s: 0, dA: FAR, dB: FAR, bridge: false };
  }

  private setbackAt(e: RoadEdge, node: number): { cut: number; layout: NodeLayout } {
    const layout = this.layoutOf(node);
    let cut = 0;
    if (layout.kind === NodeKind.Junction) for (const arm of layout.arms) if (arm.edge === e.id) cut = arm.setback;
    return { cut, layout };
  }

  /** Cross-sections along an edge between two arc lengths. */
  private stations(e: RoadEdge, s0: number, s1: number, mouthA: number, mouthB: number, hasA: boolean, hasB: boolean): Station[] {
    const poly = edgePolyline(this.net, e);
    const len = s1 - s0;
    if (len <= 0.01) return [];
    // Is any of it over water? Then it needs enough stations to place deck and piers.
    let wet = false;
    for (let s = s0; s <= s1 + 0.01; s += 8) {
      const st = this.sample(e, poly, Math.min(s, s1), this.blank());
      if (heightAt(this.heights, st.x, st.z) < st.y - 1.0) {
        wet = true;
        break;
      }
    }
    const step = e.curved ? 3 : wet ? 6 : len;
    const n = Math.max(1, Math.ceil(len / step));
    const out: Station[] = [];
    for (let i = 0; i <= n; i++) {
      const st = this.sample(e, poly, s0 + (len * i) / n, this.blank());
      st.dA = hasA ? st.s - mouthA : FAR;
      st.dB = hasB ? mouthB - st.s : FAR;
      st.bridge = wet && heightAt(this.heights, st.x, st.z) < st.y - 1.0;
      out.push(st);
    }
    return out;
  }

  /** At a plain joint both edges must share one cross-section: the mitre line. */
  private mitre(st: Station, layout: NodeLayout): void {
    if (layout.kind !== NodeKind.Joint) return;
    const [a, b] = layout.arms as [NodeArm, NodeArm];
    let mx = a.dx - b.dx;
    let mz = a.dz - b.dz;
    const ml = Math.hypot(mx, mz) || 1;
    mx /= ml;
    mz /= ml;
    const jx = -mz;
    const jz = mx;
    const d = jx * st.lx + jz * st.lz;
    const k = 1 / Math.max(0.5, Math.abs(d));
    const sign = d < 0 ? -1 : 1;
    st.lx = jx * sign * k;
    st.lz = jz * sign * k;
  }

  /**
   * Sweeps a line from (uA, yA) to (uB, yB) in the cross-section along the stations.
   * The surface faces up when A is left of B, and its normal follows from that.
   */
  private strip(mb: MeshBuilder, st: Station[], uA: number, yA: number, uB: number, yB: number, vertical: boolean, lane?: LaneKind): void {
    const du = uB - uA;
    const dy = yB - yA;
    const nl = Math.hypot(du, dy) || 1;
    let prevA = -1;
    let prevB = -1;
    for (let i = 0; i < st.length; i++) {
      const c = st[i]!;
      const ll = Math.hypot(c.lx, c.lz) || 1;
      // normal = (-dy) * right + du * up
      const nx = ((-dy / nl) * c.lx) / ll;
      const ny = du / nl;
      const nz = ((-dy / nl) * c.lz) / ll;
      const ax = c.x + c.lx * uA;
      const az = c.z + c.lz * uA;
      const bx = c.x + c.lx * uB;
      const bz = c.z + c.lz * uB;
      let a: number;
      let b: number;
      if (lane !== undefined) {
        a = mb.v(ax, c.y + yA, az, nx, ny, nz, ax * ASPHALT_UV, az * ASPHALT_UV, uA, c.s, c.dA, c.dB, lane);
        b = mb.v(bx, c.y + yB, bz, nx, ny, nz, bx * ASPHALT_UV, bz * ASPHALT_UV, uB, c.s, c.dA, c.dB, lane);
      } else if (vertical) {
        a = mb.v(ax, c.y + yA, az, nx, ny, nz, c.s * PAVE_UV, yA * PAVE_UV);
        b = mb.v(bx, c.y + yB, bz, nx, ny, nz, c.s * PAVE_UV, yB * PAVE_UV);
      } else {
        a = mb.v(ax, c.y + yA, az, nx, ny, nz, ax * PAVE_UV, az * PAVE_UV);
        b = mb.v(bx, c.y + yB, bz, nx, ny, nz, bx * PAVE_UV, bz * PAVE_UV);
      }
      if (i > 0) mb.quad(prevA, prevB, a, b);
      prevA = a;
      prevB = b;
    }
  }

  /** A flat wall across the road at one station, between two lateral offsets. */
  private endFace(mb: MeshBuilder, c: Station, u0: number, u1: number, y0: number, y1: number, facingForward: boolean): void {
    const s = facingForward ? 1 : -1;
    const a = mb.v(c.x + c.lx * u0, c.y + y0, c.z + c.lz * u0, c.fx * s, 0, c.fz * s, u0 * PAVE_UV, y0 * PAVE_UV);
    const b = mb.v(c.x + c.lx * u1, c.y + y0, c.z + c.lz * u1, c.fx * s, 0, c.fz * s, u1 * PAVE_UV, y0 * PAVE_UV);
    const d = mb.v(c.x + c.lx * u0, c.y + y1, c.z + c.lz * u0, c.fx * s, 0, c.fz * s, u0 * PAVE_UV, y1 * PAVE_UV);
    const e = mb.v(c.x + c.lx * u1, c.y + y1, c.z + c.lz * u1, c.fx * s, 0, c.fz * s, u1 * PAVE_UV, y1 * PAVE_UV);
    if (facingForward) mb.quad(b, a, e, d);
    else mb.quad(a, b, d, e);
  }

  buildEdge(e: RoadEdge, out: RoadBuckets): void {
    const spec = ROAD_SPECS[e.type];
    const hw = spec.width / 2;
    const rw = hw - spec.sidewalk;
    const A = this.setbackAt(e, e.a);
    const B = this.setbackAt(e, e.b);
    const s0 = A.cut;
    const s1 = e.length - B.cut;
    const hasA = A.layout.kind === NodeKind.Junction && A.layout.arms.length >= 3;
    const hasB = B.layout.kind === NodeKind.Junction && B.layout.arms.length >= 3;
    const st = this.stations(e, s0, s1, s0, s1, hasA, hasB);
    if (st.length < 2) return;
    this.mitre(st[0]!, A.layout);
    this.mitre(st[st.length - 1]!, B.layout);

    const lane = e.type === RoadType.Avenue ? LaneKind.Avenue : LaneKind.Street;
    this.strip(out.asphalt, st, -rw, 0, rw, 0, false, lane);
    for (const side of [1, -1]) {
      // Curb face, curb top, sidewalk, outer skirt. Point order keeps every face outward.
      if (side > 0) {
        this.strip(out.concrete, st, rw, 0, rw, CURB, true);
        this.strip(out.concrete, st, rw, CURB, rw + CURB_TOP, CURB, false);
        this.strip(out.pavement, st, rw + CURB_TOP, CURB, hw, CURB, false);
        this.strip(out.concrete, st, hw, CURB, hw, -SKIRT, true);
      } else {
        this.strip(out.concrete, st, -rw, CURB, -rw, 0, true);
        this.strip(out.concrete, st, -rw - CURB_TOP, CURB, -rw, CURB, false);
        this.strip(out.pavement, st, -hw, CURB, -rw - CURB_TOP, CURB, false);
        this.strip(out.concrete, st, -hw, -SKIRT, -hw, CURB, true);
      }
    }

    if (spec.median > 0) this.buildMedian(e, spec.median / 2, s0, s1, A.layout, B.layout, out);
    this.buildBridge(st, hw, rw, out);
    this.placeProps(e, st, s0, s1, rw, out);
  }

  private buildMedian(e: RoadEdge, half: number, s0: number, s1: number, la: NodeLayout, lb: NodeLayout, out: RoadBuckets): void {
    const m0 = s0 + (la.kind === NodeKind.Junction ? MEDIAN_GAP : 0);
    const m1 = s1 - (lb.kind === NodeKind.Junction ? MEDIAN_GAP : 0);
    if (m1 - m0 < 4) return;
    const st = this.stations(e, m0, m1, 0, 0, false, false);
    if (st.length < 2) return;
    if (la.kind === NodeKind.Joint) this.mitre(st[0]!, la);
    if (lb.kind === NodeKind.Joint) this.mitre(st[st.length - 1]!, lb);
    const inner = half - 0.28;
    this.strip(out.concrete, st, half, MEDIAN_TOP, half, 0, true);
    this.strip(out.concrete, st, -half, 0, -half, MEDIAN_TOP, true);
    this.strip(out.concrete, st, inner, MEDIAN_TOP, half, MEDIAN_TOP, false);
    this.strip(out.concrete, st, -half, MEDIAN_TOP, -inner, MEDIAN_TOP, false);
    this.strip(out.grass, st, -inner, MEDIAN_TOP + 0.02, inner, MEDIAN_TOP + 0.02, false);
    if (la.kind !== NodeKind.Joint) this.endFace(out.concrete, st[0]!, -half, half, 0, MEDIAN_TOP + 0.02, false);
    if (lb.kind !== NodeKind.Joint) this.endFace(out.concrete, st[st.length - 1]!, -half, half, 0, MEDIAN_TOP + 0.02, true);

    // A tree every so often along the median, not on bridges or right at the ends.
    const poly = edgePolyline(this.net, e);
    for (let s = m0 + 7; s < m1 - 5; s += 13) {
      const c = this.sample(e, poly, s, this.blank());
      if (heightAt(this.heights, c.x, c.z) < c.y - 1.0) continue;
      out.trees.push({ x: c.x, y: c.y + MEDIAN_TOP, z: c.z, rot: s * 1.7 });
    }
  }

  /** Over water the road becomes a deck: deeper fascia, underside, parapets and piers. */
  private buildBridge(st: Station[], hw: number, rw: number, out: RoadBuckets): void {
    const emit = (run: Station[]): void => {
      const mb = out.concrete;
      const top = CURB + PARAPET;
      // Parapets: inner face, top, outer face down to the deck soffit.
      this.strip(mb, run, hw - 0.3, CURB, hw - 0.3, top, true);
      this.strip(mb, run, hw - 0.3, top, hw, top, false);
      this.strip(mb, run, hw, top, hw, -DECK, true);
      this.strip(mb, run, -hw + 0.3, top, -hw + 0.3, CURB, true);
      this.strip(mb, run, -hw, top, -hw + 0.3, top, false);
      this.strip(mb, run, -hw, -DECK, -hw, top, true);
      this.strip(mb, run, hw, -DECK, -hw, -DECK, false);
      let last = -Infinity;
      for (let i = 1; i < run.length - 1; i++) {
        const c = run[i]!;
        if (c.s - last < 22) continue;
        const ground = heightAt(this.heights, c.x, c.z);
        if (ground > c.y - 2.2) continue;
        last = c.s;
        this.box(mb, c, 1.0, rw * 0.72, ground - 1.5, c.y - DECK - 0.55);
        this.box(mb, c, 1.5, rw * 0.9, c.y - DECK - 0.55, c.y - DECK);
      }
    };
    let i = 0;
    while (i < st.length) {
      if (!st[i]!.bridge) {
        i++;
        continue;
      }
      let j = i;
      while (j + 1 < st.length && st[j + 1]!.bridge) j++;
      // One dry station at each end so the deck reaches the bank.
      emit(st.slice(Math.max(0, i - 1), Math.min(st.length, j + 2)));
      i = j + 1;
    }
  }

  /** An upright block aligned with a station: half-length along the road, half-width across. */
  private box(mb: MeshBuilder, c: Station, halfLen: number, halfWid: number, y0: number, y1: number): void {
    const corners: Array<[number, number]> = [
      [-halfLen, -halfWid],
      [halfLen, -halfWid],
      [halfLen, halfWid],
      [-halfLen, halfWid],
    ];
    const ll = Math.hypot(c.lx, c.lz) || 1;
    const lx = c.lx / ll;
    const lz = c.lz / ll;
    const at = (f: number, l: number): [number, number] => [c.x + c.fx * f + lx * l, c.z + c.fz * f + lz * l];
    for (let i = 0; i < 4; i++) {
      const [f0, l0] = corners[i]!;
      const [f1, l1] = corners[(i + 1) % 4]!;
      const [x0, z0] = at(f0, l0);
      const [x1, z1] = at(f1, l1);
      // Outward normal of this side.
      const mf = (f0 + f1) / 2;
      const ml = (l0 + l1) / 2;
      const nl = Math.hypot(mf, ml) || 1;
      const nx = (c.fx * mf + lx * ml) / nl;
      const nz = (c.fz * mf + lz * ml) / nl;
      const w = Math.hypot(x1 - x0, z1 - z0);
      const a = mb.v(x0, y0, z0, nx, 0, nz, 0, y0 * PAVE_UV);
      const b = mb.v(x1, y0, z1, nx, 0, nz, w * PAVE_UV, y0 * PAVE_UV);
      const d = mb.v(x0, y1, z0, nx, 0, nz, 0, y1 * PAVE_UV);
      const e = mb.v(x1, y1, z1, nx, 0, nz, w * PAVE_UV, y1 * PAVE_UV);
      mb.quad(b, a, e, d);
    }
  }

  private placeProps(e: RoadEdge, st: Station[], s0: number, s1: number, rw: number, out: RoadBuckets): void {
    const poly = edgePolyline(this.net, e);
    const avenue = e.type === RoadType.Avenue;
    const spacing = avenue ? 30 : 34;
    const span = s1 - s0;
    if (span < 14 || st.length < 2) return;
    const n = Math.max(1, Math.round(span / spacing));
    const off = rw + 0.85;
    for (let i = 0; i < n; i++) {
      const s = s0 + ((i + 0.5) * span) / n;
      const c = this.sample(e, poly, s, this.blank());
      const sides = avenue ? [1, -1] : [(i + e.id) % 2 === 0 ? 1 : -1];
      for (const side of sides) {
        // Stagger the two sides of an avenue.
        const cs = avenue && side < 0 && n > 1 ? this.sample(e, poly, Math.min(s1 - 4, s + span / n / 2), this.blank()) : c;
        const yaw = Math.atan2(-cs.lx * side, -cs.lz * side);
        out.lamps.push({ x: cs.x + cs.lx * off * side, y: cs.y + CURB, z: cs.z + cs.lz * off * side, rot: yaw });
      }
    }
  }

  /** The surface where three or more roads meet (or two at a sharp angle), or a dead-end cap. */
  buildNode(node: RoadNode, out: RoadBuckets): void {
    const layout = this.layoutOf(node.id);
    if (layout.kind === NodeKind.Joint || layout.arms.length === 0) return;
    if (layout.kind === NodeKind.End) {
      this.buildCap(node, layout.arms[0]!, out);
      return;
    }
    const arms = layout.arms;
    const n = arms.length;
    // Mouth cross-section of each arm, taken from the real curve so meshes meet exactly.
    const mouths: Station[] = [];
    for (const arm of arms) {
      const e = this.net.edges[arm.edge]!;
      const poly = edgePolyline(this.net, e);
      const st = this.sample(e, poly, arm.fromA ? arm.setback : e.length - arm.setback, this.blank());
      // Re-orient so "forward" leaves the node and "right" is the clockwise side.
      if (!arm.fromA) {
        st.fx = -st.fx;
        st.fz = -st.fz;
        st.lx = -st.lx;
        st.lz = -st.lz;
      }
      mouths.push(st);
    }

    const asphalt = out.asphalt;
    const centre = asphalt.v(node.x, node.y, node.z, 0, 1, 0, node.x * ASPHALT_UV, node.z * ASPHALT_UV, 0, 0, FAR, FAR, LaneKind.Plain);
    const rim: number[] = [];
    const rimPts: number[] = [];
    const addRim = (x: number, y: number, z: number): void => {
      rim.push(asphalt.v(x, y, z, 0, 1, 0, x * ASPHALT_UV, z * ASPHALT_UV, 0, 0, FAR, FAR, LaneKind.Plain));
      rimPts.push(x, y, z);
    };
    // Never below the graded ground: on a slope a flat fan between mouths of different
    // heights can dip under the terrain the edges were graded to.
    const lift = (x: number, y: number, z: number): number => Math.max(y, heightAt(this.heights, x, z) + ROAD_BED_DROP + 0.06);

    const Q = 7;
    for (let k = 0; k < n; k++) {
      const i = arms[k]!;
      const j = arms[(k + 1) % n]!;
      const mi = mouths[k]!;
      const mj = mouths[(k + 1) % n]!;

      // This arm's mouth: left curb point then right curb point (clockwise).
      addRim(mi.x - mi.lx * i.rw, mi.y, mi.z - mi.lz * i.rw);

      // Corner between i's right side and j's left side.
      const cix = mi.x + mi.lx * i.rw;
      const ciz = mi.z + mi.lz * i.rw;
      const cjx = mj.x - mj.lx * j.rw;
      const cjz = mj.z - mj.lz * j.rw;
      const oix = mi.x + mi.lx * i.hw;
      const oiz = mi.z + mi.lz * i.hw;
      const ojx = mj.x - mj.lx * j.hw;
      const ojz = mj.z - mj.lz * j.hw;

      // Control points: where the straight curb lines and outer lines would meet.
      let ccx = (cix + cjx) / 2;
      let ccz = (ciz + cjz) / 2;
      let ocx = (oix + ojx) / 2;
      let ocz = (oiz + ojz) / 2;
      const inner = cornerDistances(i, j, i.rw, j.rw);
      if (inner) {
        ccx = node.x - i.dz * i.rw + i.dx * inner[0];
        ccz = node.z + i.dx * i.rw + i.dz * inner[0];
      }
      const outer = cornerDistances(i, j, i.hw, j.hw);
      if (outer) {
        ocx = node.x - i.dz * i.hw + i.dx * outer[0];
        ocz = node.z + i.dx * i.hw + i.dz * outer[0];
      }

      // The outside of a sharp bend (the corner spans more than half a turn): there is no
      // corner point to aim for, and a chord or control point there makes a spike. Instead
      // the edge follows each road's own kerb line in to the node and turns round it at
      // the road's half-width, like the outside of a real elbow.
      const reflex = cross2(i.dx, i.dz, j.dx, j.dz) < -0.05;
      // Heights follow the path too: from the mouth up to the node's height, round at it, and back out.
      const elbow = (w: number, px: number, pz: number, qx: number, qz: number, u: number, out: { x: number; z: number; y: number }): void => {
        // In at i's right-hand kerb, round the node, out along j's left-hand kerb.
        const p1x = node.x - i.dz * w;
        const p1z = node.z + i.dx * w;
        const p2x = node.x + j.dz * w;
        const p2z = node.z - j.dx * w;
        const a0 = Math.atan2(p1z - node.z, p1x - node.x);
        let da = Math.atan2(p2z - node.z, p2x - node.x) - a0;
        while (da < 0) da += Math.PI * 2;
        // The kerb line and the outer edge are swept in step (in, round, out over the same
        // stretches of u), so the pavement between them never twists.
        if (u <= ELBOW_IN) {
          const k = u / ELBOW_IN;
          out.x = px + (p1x - px) * k;
          out.z = pz + (p1z - pz) * k;
          out.y = mi.y + (node.y - mi.y) * k;
          return;
        }
        if (u <= 1 - ELBOW_IN) {
          const a = a0 + ((u - ELBOW_IN) / (1 - 2 * ELBOW_IN)) * da;
          out.x = node.x + Math.cos(a) * w;
          out.z = node.z + Math.sin(a) * w;
          out.y = node.y;
          return;
        }
        const k = (u - (1 - ELBOW_IN)) / ELBOW_IN;
        out.x = p2x + (qx - p2x) * k;
        out.z = p2z + (qz - p2z) * k;
        out.y = node.y + (mj.y - node.y) * k;
      };

      let pOuter = -1;
      let pTopIn = -1;
      let pTopIn2 = -1;
      let pFaceTopC = -1;
      let pFaceTop = -1;
      let pFaceBot = -1;
      let pSkTop = -1;
      let pSkBot = -1;
      // A long sweep round the outside of a sharp bend needs more points to look round.
      const steps = reflex ? 20 : Q;
      for (let s = 0; s <= steps; s++) {
        const u = s / steps;
        const w = 1 - u;
        let ix = w * w * cix + 2 * w * u * ccx + u * u * cjx;
        let iz = w * w * ciz + 2 * w * u * ccz + u * u * cjz;
        let ox = w * w * oix + 2 * w * u * ocx + u * u * ojx;
        let oz = w * w * oiz + 2 * w * u * ocz + u * u * ojz;
        if (reflex) {
          elbow(i.rw, cix, ciz, cjx, cjz, u, ARC_TMP);
          ix = ARC_TMP.x;
          iz = ARC_TMP.z;
          elbow(i.hw, oix, oiz, ojx, ojz, u, ARC_TMP);
          ox = ARC_TMP.x;
          oz = ARC_TMP.z;
        }
        // The middle of a corner lies close to the node, where the ground was graded to the
        // node's height: lift it there, or on a slope the corner sinks under the grass.
        // Round the outside of a bend the surface is at the node's height throughout.
        const along = mi.y + (mj.y - mi.y) * u;
        const y0 = reflex ? ARC_TMP.y : along + (node.y - along) * Math.sin(Math.PI * u);
        // The mouths must meet the edges exactly; in between, keep clear of the ground.
        const y = s > 0 && s < steps && !this.isWet(ix, iz, y0) ? lift(ix, y0, iz) : y0;
        if (s < steps) addRim(ix, y, iz);

        // Direction from curb to outer edge at this sample.
        let rx = ox - ix;
        let rz = oz - iz;
        const rl = Math.hypot(rx, rz) || 1;
        rx /= rl;
        rz /= rl;
        const tx = ix + rx * Math.min(CURB_TOP, rl * 0.5);
        const tz = iz + rz * Math.min(CURB_TOP, rl * 0.5);

        const pv = out.pavement;
        const cc = out.concrete;
        const a = pv.v(ox, y + CURB, oz, 0, 1, 0, ox * PAVE_UV, oz * PAVE_UV);
        const b = pv.v(tx, y + CURB, tz, 0, 1, 0, tx * PAVE_UV, tz * PAVE_UV);
        const c1 = cc.v(tx, y + CURB, tz, 0, 1, 0, tx * PAVE_UV, tz * PAVE_UV);
        const c2 = cc.v(ix, y + CURB, iz, 0, 1, 0, ix * PAVE_UV, iz * PAVE_UV);
        const f1 = cc.v(ix, y + CURB, iz, -rx, 0, -rz, (ix + iz) * PAVE_UV, CURB * PAVE_UV);
        const f2 = cc.v(ix, y, iz, -rx, 0, -rz, (ix + iz) * PAVE_UV, 0);
        const k1 = cc.v(ox, y - SKIRT, oz, rx, 0, rz, (ox + oz) * PAVE_UV, -SKIRT * PAVE_UV);
        const k2 = cc.v(ox, y + CURB, oz, rx, 0, rz, (ox + oz) * PAVE_UV, CURB * PAVE_UV);
        if (s > 0) {
          pv.quad(pOuter, pTopIn, a, b);
          cc.quad(pTopIn2, pFaceTopC, c1, c2);
          cc.quad(pFaceTop, pFaceBot, f1, f2);
          cc.quad(pSkBot, pSkTop, k1, k2);
        }
        pOuter = a;
        pTopIn = b;
        pTopIn2 = c1;
        pFaceTopC = c2;
        pFaceTop = f1;
        pFaceBot = f2;
        pSkBot = k1;
        pSkTop = k2;
      }
    }

    // The surface: a fan from the centre in rings, each ring kept above the ground.
    const RINGS = 5;
    const ring: number[][] = [];
    for (let r = 1; r < RINGS; r++) {
      const t = r / RINGS;
      const row: number[] = [];
      for (let m = 0; m < rim.length; m++) {
        const x = node.x + (rimPts[m * 3]! - node.x) * t;
        const z = node.z + (rimPts[m * 3 + 2]! - node.z) * t;
        const y0 = node.y + (rimPts[m * 3 + 1]! - node.y) * t;
        const y = this.isWet(x, z, y0) ? y0 : lift(x, y0, z);
        row.push(asphalt.v(x, y, z, 0, 1, 0, x * ASPHALT_UV, z * ASPHALT_UV, 0, 0, FAR, FAR, LaneKind.Plain));
      }
      ring.push(row);
    }
    ring.push(rim);
    const n2 = rim.length;
    for (let m = 0; m < n2; m++) asphalt.tri(centre, ring[0]![(m + 1) % n2]!, ring[0]![m]!);
    for (let r = 1; r < ring.length; r++) {
      const inner = ring[r - 1]!;
      const outer = ring[r]!;
      for (let m = 0; m < n2; m++) {
        const m1 = (m + 1) % n2;
        asphalt.tri(inner[m]!, inner[m1]!, outer[m]!);
        asphalt.tri(inner[m1]!, outer[m1]!, outer[m]!);
      }
    }
  }

  /** Over water (a junction on a bridge): the surface is a deck, not something to lift off the river bed. */
  private isWet(x: number, z: number, y: number): boolean {
    return heightAt(this.heights, x, z) < y - 1.0;
  }

  /** Rounded end of a dead-end road. */
  private buildCap(node: RoadNode, arm: NodeArm, out: RoadBuckets): void {
    const N = 10;
    // Right of the outward direction, and straight back.
    const rx = -arm.dz;
    const rz = arm.dx;
    const bx = -arm.dx;
    const bz = -arm.dz;
    const y = node.y;
    const asphalt = out.asphalt;
    const centre = asphalt.v(node.x, y, node.z, 0, 1, 0, node.x * ASPHALT_UV, node.z * ASPHALT_UV, 0, 0, FAR, FAR, LaneKind.Plain);
    let prevRim = -1;
    let pOuter = -1;
    let pTopIn = -1;
    let pTopIn2 = -1;
    let pFaceTopC = -1;
    let pFaceTop = -1;
    let pFaceBot = -1;
    let pSkTop = -1;
    let pSkBot = -1;
    for (let i = 0; i <= N; i++) {
      const a = (i / N) * Math.PI;
      const dx = rx * Math.cos(a) + bx * Math.sin(a);
      const dz = rz * Math.cos(a) + bz * Math.sin(a);
      const ix = node.x + dx * arm.rw;
      const iz = node.z + dz * arm.rw;
      const tx = node.x + dx * (arm.rw + CURB_TOP);
      const tz = node.z + dz * (arm.rw + CURB_TOP);
      const ox = node.x + dx * arm.hw;
      const oz = node.z + dz * arm.hw;
      const rim = asphalt.v(ix, y, iz, 0, 1, 0, ix * ASPHALT_UV, iz * ASPHALT_UV, 0, 0, FAR, FAR, LaneKind.Plain);
      const pv = out.pavement;
      const cc = out.concrete;
      const o = pv.v(ox, y + CURB, oz, 0, 1, 0, ox * PAVE_UV, oz * PAVE_UV);
      const t = pv.v(tx, y + CURB, tz, 0, 1, 0, tx * PAVE_UV, tz * PAVE_UV);
      const c1 = cc.v(tx, y + CURB, tz, 0, 1, 0, tx * PAVE_UV, tz * PAVE_UV);
      const c2 = cc.v(ix, y + CURB, iz, 0, 1, 0, ix * PAVE_UV, iz * PAVE_UV);
      const f1 = cc.v(ix, y + CURB, iz, -dx, 0, -dz, a * arm.rw * PAVE_UV, CURB * PAVE_UV);
      const f2 = cc.v(ix, y, iz, -dx, 0, -dz, a * arm.rw * PAVE_UV, 0);
      const k1 = cc.v(ox, y - SKIRT, oz, dx, 0, dz, a * arm.hw * PAVE_UV, -SKIRT * PAVE_UV);
      const k2 = cc.v(ox, y + CURB, oz, dx, 0, dz, a * arm.hw * PAVE_UV, CURB * PAVE_UV);
      if (i > 0) {
        asphalt.tri(centre, rim, prevRim);
        pv.quad(pOuter, pTopIn, o, t);
        cc.quad(pTopIn2, pFaceTopC, c1, c2);
        cc.quad(pFaceTop, pFaceBot, f1, f2);
        cc.quad(pSkBot, pSkTop, k1, k2);
      }
      prevRim = rim;
      pOuter = o;
      pTopIn = t;
      pTopIn2 = c1;
      pFaceTopC = c2;
      pFaceTop = f1;
      pFaceBot = f2;
      pSkBot = k1;
      pSkTop = k2;
    }
  }
}
