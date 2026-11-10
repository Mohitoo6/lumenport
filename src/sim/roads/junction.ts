import { bezTangent, type Pt } from './geometry';
import { ROAD_SPECS, type RoadEdge, type RoadNetwork } from './types';

export const enum NodeKind {
  /** One edge: a dead end. */
  End = 0,
  /** Two edges of the same type meeting at a gentle angle: the road just continues. */
  Joint = 1,
  /** Anything else: a real junction with its own surface. */
  Junction = 2,
}

/** One road arriving at a node. */
export interface NodeArm {
  edge: number;
  /** Unit direction leaving the node along the edge. */
  dx: number;
  dz: number;
  /** Half of the full road width. */
  hw: number;
  /** Half of the carriageway (curb to curb). */
  rw: number;
  /** Distance along the edge from the node to where the edge's own surface begins. */
  setback: number;
  /** True if the edge leaves the node from its `a` end. */
  fromA: boolean;
}

export interface NodeLayout {
  kind: NodeKind;
  /** Arms in clockwise order seen from above. */
  arms: NodeArm[];
}

/** Extra distance past the corner so the curb can round off before the crosswalk. */
const CORNER_MARGIN = 1.5;
const tmp: Pt = { x: 0, z: 0 };

function cross(ax: number, az: number, bx: number, bz: number): number {
  return ax * bz - az * bx;
}

/**
 * Distances along two neighbouring arms at which their facing borders meet.
 * `i` is the arm and `j` is the next arm clockwise, so the borders are i's right and j's
 * left. `wi` / `wj` are the lateral offsets of those borders. Returns [along i, along j],
 * or null when the borders do not form a convex corner (near-straight or reflex).
 */
export function cornerDistances(i: NodeArm, j: NodeArm, wi: number, wj: number): [number, number] | null {
  const det = cross(i.dx, i.dz, j.dx, j.dz);
  // Clockwise-next arm lies to the right, which makes det positive for a convex corner.
  if (det < 0.12) return null;
  // Right of i is (-dz, dx); left of j is (dz, -dx).
  const ex = j.dz * wj - -i.dz * wi;
  const ez = -j.dx * wj - i.dx * wi;
  const s = cross(ex, ez, j.dx, j.dz) / det;
  const r = cross(ex, ez, i.dx, i.dz) / det;
  if (s <= 0 || r <= 0) return null;
  return [s, r];
}

/**
 * Describes how the roads at a node fit together: whether it is a dead end, a plain joint
 * or a junction, the clockwise order of its arms, and how far each edge is cut back to
 * make room for the junction surface. Used by the road mesher and by vehicle routing.
 */
export function nodeLayout(net: RoadNetwork, nodeId: number): NodeLayout {
  const node = net.nodes[nodeId]!;
  const arms: NodeArm[] = [];
  for (const id of node.edges) {
    const e = net.edges[id]!;
    const a = net.nodes[e.a]!;
    const b = net.nodes[e.b]!;
    const fromA = e.a === nodeId;
    bezTangent(a.x, a.z, e.cx, e.cz, b.x, b.z, fromA ? 0 : 1, tmp);
    let dx = tmp.x;
    let dz = tmp.z;
    if (!fromA) {
      dx = -dx;
      dz = -dz;
    }
    const len = Math.hypot(dx, dz) || 1;
    const spec = ROAD_SPECS[e.type];
    arms.push({ edge: id, dx: dx / len, dz: dz / len, hw: spec.width / 2, rw: spec.width / 2 - spec.sidewalk, setback: 0, fromA });
  }
  // atan2(z, x) grows clockwise when seen from above, because +z points south.
  arms.sort((p, q) => Math.atan2(p.dz, p.dx) - Math.atan2(q.dz, q.dx));

  if (arms.length <= 1) return { kind: NodeKind.End, arms };

  if (arms.length === 2) {
    const [p, q] = arms as [NodeArm, NodeArm];
    const sameType = net.edges[p.edge]!.type === net.edges[q.edge]!.type;
    // Directions leave the node, so a straight-through road has them opposed.
    const straightness = -(p.dx * q.dx + p.dz * q.dz);
    if (sameType && straightness > Math.cos((50 * Math.PI) / 180)) return { kind: NodeKind.Joint, arms };
  }

  const n = arms.length;
  for (let k = 0; k < n; k++) {
    const i = arms[k]!;
    const j = arms[(k + 1) % n]!;
    const c = cornerDistances(i, j, i.hw, j.hw);
    if (!c) continue;
    if (c[0] > i.setback) i.setback = c[0];
    if (c[1] > j.setback) j.setback = c[1];
  }
  for (const arm of arms) {
    const e = net.edges[arm.edge]!;
    const min = arm.rw * 0.5;
    arm.setback = Math.max(min, Math.min(arm.setback + CORNER_MARGIN, e.length * 0.45));
  }
  return { kind: NodeKind.Junction, arms };
}

/** How far edge `e` is cut back at its `a` end (index 0) and `b` end (index 1). */
export function edgeSetbacks(e: RoadEdge, layoutOf: (node: number) => NodeLayout): [number, number] {
  const find = (node: number): number => {
    const l = layoutOf(node);
    if (l.kind !== NodeKind.Junction) return 0;
    for (const arm of l.arms) if (arm.edge === e.id) return arm.setback;
    return 0;
  };
  return [find(e.a), find(e.b)];
}
