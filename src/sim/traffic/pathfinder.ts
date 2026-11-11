import { otherEnd } from '../roads/graph';
import { ROAD_SPECS, type RoadNetwork } from '../roads/types';

/**
 * Finds the quickest route between two points on the road network.
 *
 * A trip starts part-way along `fromEdge` (at arc length `fromArc` from its `a` node) and
 * ends part-way along `toEdge`. The result is the list of nodes to drive through, in
 * order; it is empty when both points are on the same edge, and null when there is no
 * route. `slow` optionally gives a per-edge time multiplier (congestion).
 */
export function findPath(net: RoadNetwork, fromEdge: number, fromArc: number, toEdge: number, toArc: number, slow?: Float32Array): number[] | null {
  if (fromEdge === toEdge) return [];
  const eo = net.edges[fromEdge];
  const ed = net.edges[toEdge];
  if (!eo || !ed) return null;
  const n = net.nodes.length;
  const dist = new Float64Array(n).fill(Infinity);
  const prev = new Int32Array(n).fill(-1);
  const done = new Uint8Array(n);
  const time = (edgeId: number, metres: number): number => {
    const e = net.edges[edgeId]!;
    return (metres / ROAD_SPECS[e.type].speed) * (slow ? 1 + (slow[edgeId] ?? 0) : 1);
  };

  // Binary heap of [distance, node] pairs stored flat.
  const heap: number[] = [];
  const push = (d: number, node: number): void => {
    let i = heap.length;
    heap.push(d, node);
    while (i > 0) {
      const p = (((i >> 1) - 1) >> 1) << 1;
      if (heap[p]! <= d) break;
      heap[i] = heap[p]!;
      heap[i + 1] = heap[p + 1]!;
      i = p;
    }
    heap[i] = d;
    heap[i + 1] = node;
  };
  const pop = (): number => {
    const top = heap[1]!;
    const d = heap[heap.length - 2]!;
    const node = heap[heap.length - 1]!;
    heap.length -= 2;
    const len = heap.length;
    if (len > 0) {
      let i = 0;
      for (;;) {
        let c = i * 2 + 2;
        if (c >= len) break;
        if (c + 2 < len && heap[c + 2]! < heap[c]!) c += 2;
        if (heap[c]! >= d) break;
        heap[i] = heap[c]!;
        heap[i + 1] = heap[c + 1]!;
        i = c;
      }
      heap[i] = d;
      heap[i + 1] = node;
    }
    return top;
  };

  dist[eo.a] = time(fromEdge, fromArc);
  dist[eo.b] = time(fromEdge, eo.length - fromArc);
  push(dist[eo.a]!, eo.a);
  push(dist[eo.b]!, eo.b);

  const endA = time(toEdge, toArc);
  const endB = time(toEdge, ed.length - toArc);
  let best = Infinity;
  let bestNode = -1;
  while (heap.length > 0) {
    const d = heap[0]!;
    if (d >= best) break;
    const u = pop();
    if (done[u]) continue;
    done[u] = 1;
    if (u === ed.a && d + endA < best) {
      best = d + endA;
      bestNode = u;
    }
    if (u === ed.b && d + endB < best) {
      best = d + endB;
      bestNode = u;
    }
    for (const id of net.nodes[u]!.edges) {
      // The destination edge is only ever entered as the final leg.
      if (id === toEdge) continue;
      const e = net.edges[id]!;
      const v = otherEnd(e, u);
      const nd = d + time(id, e.length);
      if (nd < dist[v]!) {
        dist[v] = nd;
        prev[v] = u;
        push(nd, v);
      }
    }
  }
  if (bestNode < 0) return null;
  const path: number[] = [];
  for (let u = bestNode; u >= 0; u = prev[u]!) path.push(u);
  path.reverse();
  return path;
}
