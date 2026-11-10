import { bezLength, bezX, flatten, subControl, type Polyline } from './geometry';
import { ROAD_SPECS, type RoadEdge, type RoadNetwork, type RoadNode, type RoadType } from './types';

/** Step used for collision, snapping and terrain work. */
export const POLY_STEP = 3;

// Flattened curves are derived data, cached per edge object and dropped when it changes.
const polyCache = new WeakMap<RoadEdge, Polyline>();

export function edgePolyline(net: RoadNetwork, e: RoadEdge): Polyline {
  let p = polyCache.get(e);
  if (!p) {
    const a = net.nodes[e.a]!;
    const b = net.nodes[e.b]!;
    p = flatten(a.x, a.z, e.cx, e.cz, b.x, b.z, POLY_STEP, !e.curved);
    polyCache.set(e, p);
  }
  return p;
}

export function invalidateEdge(e: RoadEdge): void {
  polyCache.delete(e);
}

export function halfWidth(e: RoadEdge): number {
  return ROAD_SPECS[e.type].width / 2;
}

/** Road surface height at Bezier parameter t. */
export function edgeHeight(net: RoadNetwork, e: RoadEdge, t: number): number {
  const ya = net.nodes[e.a]!.y;
  return ya + (net.nodes[e.b]!.y - ya) * t;
}

export function addNode(net: RoadNetwork, x: number, z: number, y: number): RoadNode {
  const node: RoadNode = { id: net.nodes.length, x, z, y, edges: [] };
  net.nodes.push(node);
  return node;
}

export function addEdge(net: RoadNetwork, a: number, b: number, type: RoadType, cx: number, cz: number, curved: boolean): RoadEdge {
  const na = net.nodes[a]!;
  const nb = net.nodes[b]!;
  const edge: RoadEdge = { id: net.edges.length, a, b, type, cx, cz, curved, length: bezLength(na.x, na.z, cx, cz, nb.x, nb.z) };
  net.edges.push(edge);
  na.edges.push(edge.id);
  nb.edges.push(edge.id);
  return edge;
}

/**
 * Splits an edge at parameter t. The original edge keeps the first part (and its id); a
 * new edge takes the second. Returns the new node.
 */
export function splitEdge(net: RoadNetwork, edgeId: number, t: number): RoadNode {
  const e = net.edges[edgeId]!;
  const a = net.nodes[e.a]!;
  const b = net.nodes[e.b]!;
  const mx = bezX(a.x, e.cx, b.x, t);
  const mz = bezX(a.z, e.cz, b.z, t);
  const mid = addNode(net, mx, mz, a.y + (b.y - a.y) * t);

  const c1x = subControl(a.x, e.cx, b.x, 0, t);
  const c1z = subControl(a.z, e.cz, b.z, 0, t);
  const c2x = subControl(a.x, e.cx, b.x, t, 1);
  const c2z = subControl(a.z, e.cz, b.z, t, 1);

  // Second half becomes a new edge from the midpoint to the old end.
  b.edges.splice(b.edges.indexOf(edgeId), 1);
  const second: RoadEdge = { id: net.edges.length, a: mid.id, b: b.id, type: e.type, cx: c2x, cz: c2z, curved: e.curved, length: 0 };
  second.length = bezLength(mid.x, mid.z, c2x, c2z, b.x, b.z);
  net.edges.push(second);
  mid.edges.push(second.id);
  b.edges.push(second.id);

  // First half reuses the original edge.
  e.b = mid.id;
  e.cx = c1x;
  e.cz = c1z;
  e.length = bezLength(a.x, a.z, c1x, c1z, mid.x, mid.z);
  mid.edges.push(e.id);
  invalidateEdge(e);
  return mid;
}

/** Removes an edge and any node left with no edges. Returns the ids of its two end nodes. */
export function removeEdge(net: RoadNetwork, edgeId: number): [number, number] {
  const e = net.edges[edgeId]!;
  for (const id of [e.a, e.b]) {
    const n = net.nodes[id]!;
    const i = n.edges.indexOf(edgeId);
    if (i >= 0) n.edges.splice(i, 1);
    if (n.edges.length === 0) net.nodes[id] = null;
  }
  net.edges[edgeId] = null;
  invalidateEdge(e);
  return [e.a, e.b];
}

/** The node at the other end of an edge. */
export function otherEnd(e: RoadEdge, node: number): number {
  return e.a === node ? e.b : e.a;
}

export function countEdges(net: RoadNetwork): number {
  let n = 0;
  for (const e of net.edges) if (e) n++;
  return n;
}

export function countNodes(net: RoadNetwork): number {
  let n = 0;
  for (const e of net.nodes) if (e) n++;
  return n;
}
