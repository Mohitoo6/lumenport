export const enum RoadType {
  Street = 0,
  Avenue = 1,
}

export interface RoadSpec {
  name: string;
  /** Full width including sidewalks, metres. */
  width: number;
  /** Sidewalk width on each side. */
  sidewalk: number;
  /** Raised planted median width (0 for none). */
  median: number;
  /** Driving lanes per direction. */
  lanes: number;
  laneWidth: number;
  /** Speed limit, metres per second. */
  speed: number;
  /** Build cost per metre. */
  cost: number;
  /** Monthly upkeep per metre. */
  upkeep: number;
}

export const ROAD_SPECS: Record<RoadType, RoadSpec> = {
  [RoadType.Street]: { name: 'Street', width: 16, sidewalk: 3, median: 0, lanes: 1, laneWidth: 3.2, speed: 11, cost: 10, upkeep: 0.035 },
  [RoadType.Avenue]: { name: 'Avenue', width: 32, sidewalk: 4.5, median: 3, lanes: 2, laneWidth: 3.4, speed: 16, cost: 26, upkeep: 0.09 },
};

export interface RoadNode {
  id: number;
  x: number;
  z: number;
  /** Road surface height at the node. */
  y: number;
  /** Ids of the edges that end here. */
  edges: number[];
}

/**
 * A road segment between two nodes. Every edge is a quadratic Bezier; a straight edge
 * simply has its control point at the midpoint. Surface height along the edge is
 * lerp(a.y, b.y, t) in the Bezier parameter.
 */
export interface RoadEdge {
  id: number;
  a: number;
  b: number;
  type: RoadType;
  cx: number;
  cz: number;
  curved: boolean;
  length: number;
}

/** Ids are array indices; removed entries are null and ids are never reused. */
export interface RoadNetwork {
  nodes: Array<RoadNode | null>;
  edges: Array<RoadEdge | null>;
}

export function emptyNetwork(): RoadNetwork {
  return { nodes: [], edges: [] };
}
