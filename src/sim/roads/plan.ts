import { CELL, MAP, WORLD } from '../../core/constants';
import { heightAt } from '../map/terrain';
import {
  bezPoint,
  bezTangent,
  closestOnPolyline,
  crossings,
  flatten,
  newClosest,
  subControl,
  type Crossing,
  type Polyline,
  type Pt,
} from './geometry';
import { POLY_STEP, addEdge, addNode, edgePolyline, halfWidth, removeEdge, splitEdge } from './graph';
import { clearTreesUnderEdge, emptyRect, growRect, levelUnderEdge, rasterRoads, relock, type Rect } from './terraform';
import { ROAD_SPECS, type RoadEdge, type RoadNetwork, type RoadType } from './types';

/** Cursor points this close to a node attach to it. */
const NODE_SNAP = 10;
/** Junctions (and ends) must be at least this far apart along a road. */
const MIN_SPACING = 12;
const MIN_LENGTH = 8;
const MIN_ANGLE = (30 * Math.PI) / 180;
const MAX_SLOPE = 0.14;
const MAX_BRIDGE = 240;
const MIN_LAND = 0.3;
const MIN_DECK = 1.2;
const BORDER = 24;
/** Bridges cost this many times the normal rate over water. */
const BRIDGE_COST = 4;

export interface RoadRequest {
  road: RoadType;
  ax: number;
  az: number;
  bx: number;
  bz: number;
  /** Bezier control point. Omit for a straight road. */
  cx?: number;
  cz?: number;
}

/** A point on the planned road where it starts, ends, or meets an existing road. */
export interface Via {
  /** Parameter along the planned curve. */
  t: number;
  x: number;
  z: number;
  y: number;
  /** Existing node to connect to, or -1. */
  node: number;
  /** Existing edge to split here, or -1. */
  splitEdge: number;
  splitT: number;
}

export interface RoadPlan {
  ok: boolean;
  /** Why the road cannot be built, for the player. Empty when ok. */
  reason: string;
  type: RoadType;
  ax: number;
  az: number;
  cx: number;
  cz: number;
  bx: number;
  bz: number;
  curved: boolean;
  length: number;
  cost: number;
  /** Metres of the road that cross water. */
  bridgeLength: number;
  /** Sorted by t; first and last are the ends. */
  vias: Via[];
}

export interface SnapResult {
  x: number;
  z: number;
  node: number;
  edge: number;
  t: number;
}

const hit = newClosest();
const pt: Pt = { x: 0, z: 0 };

/**
 * Resolves a ground point against the network: onto a nearby node, else onto a nearby
 * road's centreline, else left where it is.
 */
export function snapToNetwork(net: RoadNetwork, x: number, z: number): SnapResult {
  let best = NODE_SNAP;
  let node = -1;
  for (const n of net.nodes) {
    if (!n) continue;
    const d = Math.hypot(n.x - x, n.z - z);
    if (d < best) {
      best = d;
      node = n.id;
    }
  }
  if (node >= 0) {
    const n = net.nodes[node]!;
    return { x: n.x, z: n.z, node, edge: -1, t: 0 };
  }

  let bestEdge: RoadEdge | null = null;
  let bestDist = Infinity;
  let bx = 0;
  let bz = 0;
  let bt = 0;
  let bs = 0;
  for (const e of net.edges) {
    if (!e) continue;
    const poly = edgePolyline(net, e);
    const reach = halfWidth(e) * 0.8;
    if (x < poly.minX - reach || x > poly.maxX + reach || z < poly.minZ - reach || z > poly.maxZ + reach) continue;
    closestOnPolyline(poly, x, z, hit);
    if (hit.dist < reach && hit.dist < bestDist) {
      bestDist = hit.dist;
      bestEdge = e;
      bx = hit.x;
      bz = hit.z;
      bt = hit.t;
      bs = hit.s;
    }
  }
  if (bestEdge) {
    const poly = edgePolyline(net, bestEdge);
    // Close to an end of that road: use its node rather than making a sliver.
    if (bs < MIN_SPACING) {
      const n = net.nodes[bestEdge.a]!;
      return { x: n.x, z: n.z, node: n.id, edge: -1, t: 0 };
    }
    if (poly.length - bs < MIN_SPACING) {
      const n = net.nodes[bestEdge.b]!;
      return { x: n.x, z: n.z, node: n.id, edge: -1, t: 0 };
    }
    // Prefer a lattice point on the road if one is right there, so blocks stay regular.
    const gx = Math.round(bx / CELL) * CELL;
    const gz = Math.round(bz / CELL) * CELL;
    if (Math.hypot(gx - bx, gz - bz) < CELL * 0.75) {
      closestOnPolyline(poly, gx, gz, hit);
      if (hit.dist < 0.05 && hit.s >= MIN_SPACING && poly.length - hit.s >= MIN_SPACING) {
        return { x: hit.x, z: hit.z, node: -1, edge: bestEdge.id, t: hit.t };
      }
    }
    return { x: bx, z: bz, node: -1, edge: bestEdge.id, t: bt };
  }
  return { x, z, node: -1, edge: -1, t: 0 };
}

function arcAt(p: Polyline, t: number): number {
  const f = t * (p.n - 1);
  const i = Math.min(p.n - 2, Math.max(0, Math.floor(f)));
  return p.s[i]! + (p.s[i + 1]! - p.s[i]!) * (f - i);
}

function fail(plan: RoadPlan, reason: string): RoadPlan {
  plan.ok = false;
  plan.reason = reason;
  return plan;
}

function angleBetween(ax: number, az: number, bx: number, bz: number): number {
  const d = (ax * bx + az * bz) / (Math.hypot(ax, az) * Math.hypot(bx, bz) || 1);
  return Math.acos(Math.max(-1, Math.min(1, d)));
}

/** Outward unit-ish direction of an existing edge as it leaves `nodeId`. */
function edgeDirFrom(net: RoadNetwork, e: RoadEdge, nodeId: number, out: Pt): Pt {
  const a = net.nodes[e.a]!;
  const b = net.nodes[e.b]!;
  if (e.a === nodeId) {
    bezTangent(a.x, a.z, e.cx, e.cz, b.x, b.z, 0, out);
  } else {
    bezTangent(a.x, a.z, e.cx, e.cz, b.x, b.z, 1, out);
    out.x = -out.x;
    out.z = -out.z;
  }
  return out;
}

/**
 * Works out whether a requested road can be built and exactly how: where it attaches to
 * the existing network, which edges it splits, its heights, length and cost. Does not
 * change anything, so the road tool calls it on every mouse move for the live preview.
 */
export function planRoad(net: RoadNetwork, heights: Float32Array, req: RoadRequest): RoadPlan {
  const curved = req.cx !== undefined && req.cz !== undefined;
  const plan: RoadPlan = {
    ok: true,
    reason: '',
    type: req.road,
    ax: req.ax,
    az: req.az,
    cx: 0,
    cz: 0,
    bx: req.bx,
    bz: req.bz,
    curved,
    length: 0,
    cost: 0,
    bridgeLength: 0,
    vias: [],
  };
  const spec = ROAD_SPECS[req.road];
  const hw = spec.width / 2;

  const start = snapToNetwork(net, req.ax, req.az);
  const end = snapToNetwork(net, req.bx, req.bz);
  plan.ax = start.x;
  plan.az = start.z;
  plan.bx = end.x;
  plan.bz = end.z;
  plan.cx = curved ? req.cx! : (start.x + end.x) / 2;
  plan.cz = curved ? req.cz! : (start.z + end.z) / 2;

  if (start.node >= 0 && start.node === end.node) return fail(plan, 'Start and end are the same junction');
  const poly = flatten(plan.ax, plan.az, plan.cx, plan.cz, plan.bx, plan.bz, POLY_STEP, !curved);
  plan.length = poly.length;
  if (poly.length < MIN_LENGTH) return fail(plan, 'Too short');
  if (poly.minX < BORDER || poly.minZ < BORDER || poly.maxX > WORLD - BORDER || poly.maxZ > WORLD - BORDER) {
    return fail(plan, 'Outside the city limits');
  }
  if (curved) {
    // A control point nearly on the chord folds the curve back on itself.
    const bend = angleBetween(plan.cx - plan.ax, plan.cz - plan.az, plan.bx - plan.cx, plan.bz - plan.cz);
    if (bend > (150 * Math.PI) / 180) return fail(plan, 'Curve is too tight');
  }

  const mkVia = (t: number, s: SnapResult | null, x: number, z: number): Via => ({
    t,
    x,
    z,
    y: 0,
    node: s ? s.node : -1,
    splitEdge: s ? s.edge : -1,
    splitT: s ? s.t : 0,
  });
  const vias: Via[] = [mkVia(0, start, start.x, start.z), mkVia(1, end, end.x, end.z)];

  // Existing nodes the new road runs straight through become junctions on it.
  for (const n of net.nodes) {
    if (!n || n.id === start.node || n.id === end.node) continue;
    if (n.x < poly.minX - 2 || n.x > poly.maxX + 2 || n.z < poly.minZ - 2 || n.z > poly.maxZ + 2) continue;
    closestOnPolyline(poly, n.x, n.z, hit);
    if (hit.dist < 1.5) vias.push({ t: hit.t, x: n.x, z: n.z, y: 0, node: n.id, splitEdge: -1, splitT: 0 });
  }

  const touches = (e: RoadEdge, v: Via): boolean => v.splitEdge === e.id || (v.node >= 0 && (e.a === v.node || e.b === v.node));

  // Crossings with existing roads become new junctions.
  const found: Crossing[] = [];
  for (const e of net.edges) {
    if (!e) continue;
    const ep = edgePolyline(net, e);
    found.length = 0;
    crossings(poly, ep, found);
    for (const c of found) {
      // Already accounted for by an end point or a pass-through node on this edge?
      let covered = false;
      for (const v of vias) {
        if (touches(e, v) && Math.hypot(v.x - c.x, v.z - c.z) < MIN_SPACING) {
          covered = true;
          break;
        }
      }
      if (covered) continue;
      const sNew = arcAt(poly, c.tA);
      if (sNew < MIN_SPACING || poly.length - sNew < MIN_SPACING) return fail(plan, 'Ends too close to another road');
      const sOld = arcAt(ep, c.tB);
      if (sOld < MIN_SPACING || ep.length - sOld < MIN_SPACING) return fail(plan, 'Crosses too close to a junction');
      vias.push({ t: c.tA, x: c.x, z: c.z, y: 0, node: -1, splitEdge: e.id, splitT: c.tB });
    }
  }

  vias.sort((p, q) => p.t - q.t);
  for (let i = 1; i < vias.length; i++) {
    if (arcAt(poly, vias[i]!.t) - arcAt(poly, vias[i - 1]!.t) < MIN_SPACING && vias.length > 2) {
      return fail(plan, 'Junctions would be too close together');
    }
  }
  plan.vias = vias;

  // Heights at every via.
  for (let i = 0; i < vias.length; i++) {
    const v = vias[i]!;
    if (v.node >= 0) {
      v.y = net.nodes[v.node]!.y;
    } else if (v.splitEdge >= 0) {
      const e = net.edges[v.splitEdge]!;
      const ya = net.nodes[e.a]!.y;
      v.y = ya + (net.nodes[e.b]!.y - ya) * v.splitT;
    } else {
      const ground = heightAt(heights, v.x, v.z);
      if (ground < MIN_LAND) return fail(plan, 'Roads must start and end on dry land');
      v.y = Math.max(ground, MIN_DECK);
    }
  }

  // Angles against the roads already meeting at each via.
  const dir: Pt = { x: 0, z: 0 };
  const other: Pt = { x: 0, z: 0 };
  for (let i = 0; i < vias.length; i++) {
    const v = vias[i]!;
    if (v.node < 0 && v.splitEdge < 0) continue;
    bezTangent(plan.ax, plan.az, plan.cx, plan.cz, plan.bx, plan.bz, v.t, dir);
    const check = (ox: number, oz: number): boolean => {
      // The new road leaves the via forward (unless it is the end) and backward (unless the start).
      if (i < vias.length - 1 && angleBetween(dir.x, dir.z, ox, oz) < MIN_ANGLE) return false;
      if (i > 0 && angleBetween(-dir.x, -dir.z, ox, oz) < MIN_ANGLE) return false;
      return true;
    };
    if (v.node >= 0) {
      for (const id of net.nodes[v.node]!.edges) {
        edgeDirFrom(net, net.edges[id]!, v.node, other);
        if (!check(other.x, other.z)) return fail(plan, 'Too sharp an angle with the existing road');
      }
    } else {
      const e = net.edges[v.splitEdge]!;
      const a = net.nodes[e.a]!;
      const b = net.nodes[e.b]!;
      bezTangent(a.x, a.z, e.cx, e.cz, b.x, b.z, v.splitT, other);
      if (!check(other.x, other.z) || !check(-other.x, -other.z)) return fail(plan, 'Too sharp an angle with the existing road');
    }
  }

  // Running alongside or on top of another road.
  for (let k = 0; k < poly.n; k++) {
    const px = poly.x[k]!;
    const pz = poly.z[k]!;
    // Which piece is this sample on?
    let piece = 0;
    while (piece < vias.length - 2 && poly.t[k]! > vias[piece + 1]!.t) piece++;
    const v0 = vias[piece]!;
    const v1 = vias[piece + 1]!;
    for (const e of net.edges) {
      if (!e || touches(e, v0) || touches(e, v1)) continue;
      const ep = edgePolyline(net, e);
      const need = hw + halfWidth(e) - 0.5;
      if (px < ep.minX - need || px > ep.maxX + need || pz < ep.minZ - need || pz > ep.maxZ + need) continue;
      if (closestOnPolyline(ep, px, pz, hit).dist < need) {
        // Fine if this is right at a crossing with that edge.
        if (Math.hypot(v0.x - px, v0.z - pz) < need * 2.2 || Math.hypot(v1.x - px, v1.z - pz) < need * 2.2) continue;
        return fail(plan, 'Too close to an existing road');
      }
    }
  }

  // Slope and water along each piece.
  let cost = 0;
  let bridge = 0;
  for (let i = 0; i < vias.length - 1; i++) {
    const v0 = vias[i]!;
    const v1 = vias[i + 1]!;
    const s0 = arcAt(poly, v0.t);
    const s1 = arcAt(poly, v1.t);
    const len = s1 - s0;
    if (Math.abs(v1.y - v0.y) / len > MAX_SLOPE) return fail(plan, 'Too steep here');
    let wet = 0;
    const steps = Math.max(2, Math.ceil(len / 4));
    for (let k = 0; k <= steps; k++) {
      const t = v0.t + ((v1.t - v0.t) * k) / steps;
      bezPoint(plan.ax, plan.az, plan.cx, plan.cz, plan.bx, plan.bz, t, pt);
      if (heightAt(heights, pt.x, pt.z) < MIN_LAND) wet += len / steps;
    }
    if (wet > MAX_BRIDGE) return fail(plan, 'Too far to bridge');
    bridge += wet;
    cost += (len - wet) * spec.cost + wet * spec.cost * BRIDGE_COST;
  }
  plan.bridgeLength = bridge;
  plan.cost = Math.round(cost);
  return plan;
}

export interface RoadChange {
  /** Every node touched: ends of added, split or removed edges (some may no longer exist). */
  nodes: number[];
  edges: number[];
  /** World-space bounds of everything that changed. */
  x0: number;
  z0: number;
  x1: number;
  z1: number;
  /** Vertex rectangle whose heights changed, or null. */
  terrain: Rect | null;
  /** Cell rectangle whose trees changed, or null. */
  trees: Rect | null;
}

interface RoadLayers {
  heights: Float32Array;
  trees: Uint8Array;
  roadCell: Int32Array;
  roadLock: Uint8Array;
  buildings?: ReadonlyArray<{ x: number; y: number; w: number; h: number } | null>;
}

function cellRectOf(x0: number, z0: number, x1: number, z1: number, pad: number): Rect {
  return {
    x0: Math.max(0, Math.floor((x0 - pad) / CELL)),
    y0: Math.max(0, Math.floor((z0 - pad) / CELL)),
    x1: Math.min(MAP, Math.ceil((x1 + pad) / CELL)),
    y1: Math.min(MAP, Math.ceil((z1 + pad) / CELL)),
  };
}

/** Carries out a plan that planRoad accepted: splits, new nodes and edges, grading. */
export function executePlan(net: RoadNetwork, layers: RoadLayers, plan: RoadPlan): RoadChange {
  const vias = plan.vias;
  const touched = new Set<number>();

  // Split existing edges. Several vias may land on one edge: go from the far end back, so
  // the part that keeps the original id still contains the remaining split points.
  const byEdge = new Map<number, Via[]>();
  for (const v of vias) {
    if (v.node >= 0 || v.splitEdge < 0) continue;
    const list = byEdge.get(v.splitEdge);
    if (list) list.push(v);
    else byEdge.set(v.splitEdge, [v]);
  }
  for (const [edgeId, list] of byEdge) {
    list.sort((p, q) => q.splitT - p.splitT);
    const e = net.edges[edgeId]!;
    touched.add(e.a).add(e.b);
    let span = 1;
    for (const v of list) {
      const node = splitEdge(net, edgeId, v.splitT / span);
      span = v.splitT;
      v.node = node.id;
    }
  }
  for (const v of vias) {
    if (v.node < 0) v.node = addNode(net, v.x, v.z, v.y).id;
    touched.add(v.node);
  }

  const added: RoadEdge[] = [];
  for (let i = 0; i < vias.length - 1; i++) {
    const v0 = vias[i]!;
    const v1 = vias[i + 1]!;
    let cx = (v0.x + v1.x) / 2;
    let cz = (v0.z + v1.z) / 2;
    if (plan.curved) {
      cx = subControl(plan.ax, plan.cx, plan.bx, v0.t, v1.t);
      cz = subControl(plan.az, plan.cz, plan.bz, v0.t, v1.t);
    }
    added.push(addEdge(net, v0.node, v1.node, plan.type, cx, cz, plan.curved));
  }

  const change: RoadChange = { nodes: [...touched], edges: added.map((e) => e.id), x0: Infinity, z0: Infinity, x1: -Infinity, z1: -Infinity, terrain: null, trees: null };
  const terrain = emptyRect();
  const trees = emptyRect();
  for (const e of added) {
    const p = edgePolyline(net, e);
    change.x0 = Math.min(change.x0, p.minX);
    change.z0 = Math.min(change.z0, p.minZ);
    change.x1 = Math.max(change.x1, p.maxX);
    change.z1 = Math.max(change.z1, p.maxZ);
    levelUnderEdge(layers.heights, layers.roadLock, net, e, terrain);
    clearTreesUnderEdge(layers.trees, net, e, trees);
  }
  for (const id of touched) {
    const n = net.nodes[id];
    if (!n) continue;
    change.x0 = Math.min(change.x0, n.x);
    change.z0 = Math.min(change.z0, n.z);
    change.x1 = Math.max(change.x1, n.x);
    change.z1 = Math.max(change.z1, n.z);
  }
  rasterRoads(layers.roadCell, net, cellRectOf(change.x0, change.z0, change.x1, change.z1, 40));
  if (terrain.x1 >= terrain.x0) change.terrain = terrain;
  if (trees.x1 >= trees.x0) change.trees = trees;
  return change;
}

/** Removes one edge and tidies the layers around it. */
export function demolishEdge(net: RoadNetwork, layers: RoadLayers, edgeId: number): RoadChange | null {
  const e = net.edges[edgeId];
  if (!e) return null;
  const p = edgePolyline(net, e);
  const change: RoadChange = { nodes: [e.a, e.b], edges: [edgeId], x0: p.minX, z0: p.minZ, x1: p.maxX, z1: p.maxZ, terrain: null, trees: null };
  removeEdge(net, edgeId);
  const cells = cellRectOf(change.x0, change.z0, change.x1, change.z1, 40);
  rasterRoads(layers.roadCell, net, cells);
  const verts = emptyRect();
  growRect(verts, cells.x0, cells.y0, cells.x1, cells.y1);
  relock(layers.roadLock, net, verts, layers.buildings);
  return change;
}

/** The edge whose surface contains (x, z), or -1. */
export function edgeAt(net: RoadNetwork, x: number, z: number, slack = 0): number {
  let best = -1;
  let bestDist = Infinity;
  for (const e of net.edges) {
    if (!e) continue;
    const p = edgePolyline(net, e);
    const reach = halfWidth(e) + slack;
    if (x < p.minX - reach || x > p.maxX + reach || z < p.minZ - reach || z > p.maxZ + reach) continue;
    closestOnPolyline(p, x, z, hit);
    if (hit.dist < reach && hit.dist < bestDist) {
      bestDist = hit.dist;
      best = e.id;
    }
  }
  return best;
}
