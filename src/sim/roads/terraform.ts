import { CELL, MAP, VERTS, WATER_LEVEL } from '../../core/constants';
import { clamp, smoothstep } from '../../core/math';
import { closestOnPolyline, newClosest } from './geometry';
import { edgeHeight, edgePolyline, halfWidth } from './graph';
import type { RoadEdge, RoadNetwork } from './types';

/** The terrain sits this far below the road surface, so the two never z-fight. */
export const ROAD_BED_DROP = 0.12;
/**
 * Every terrain vertex within this distance of the road edge is flattened. A terrain
 * triangle that touches the road footprint has all its vertices within one cell diagonal
 * of it, so this guarantees no terrain pokes through the road.
 */
const FLAT_MARGIN = CELL * Math.SQRT2 + 0.2;
const BLEND = 14;
/** Do not fill ground that is under water: roads cross it as bridges. */
const WET = WATER_LEVEL + 0.3;

export interface Rect {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export function emptyRect(): Rect {
  return { x0: Infinity, y0: Infinity, x1: -Infinity, y1: -Infinity };
}

export function growRect(r: Rect, x0: number, y0: number, x1: number, y1: number): void {
  if (x0 < r.x0) r.x0 = x0;
  if (y0 < r.y0) r.y0 = y0;
  if (x1 > r.x1) r.x1 = x1;
  if (y1 > r.y1) r.y1 = y1;
}

const hit = newClosest();

/**
 * Grades the terrain under one edge to the road's height profile and marks the flattened
 * vertices as locked so later roads leave them alone. Returns the vertex rectangle changed.
 */
export function levelUnderEdge(heights: Float32Array, lock: Uint8Array, net: RoadNetwork, e: RoadEdge, out: Rect): void {
  const poly = edgePolyline(net, e);
  const inner = halfWidth(e) + FLAT_MARGIN;
  const outer = inner + BLEND;
  const i0 = clamp(Math.floor((poly.minX - outer) / CELL), 0, MAP);
  const i1 = clamp(Math.ceil((poly.maxX + outer) / CELL), 0, MAP);
  const j0 = clamp(Math.floor((poly.minZ - outer) / CELL), 0, MAP);
  const j1 = clamp(Math.ceil((poly.maxZ + outer) / CELL), 0, MAP);
  for (let j = j0; j <= j1; j++) {
    for (let i = i0; i <= i1; i++) {
      closestOnPolyline(poly, i * CELL, j * CELL, hit);
      if (hit.dist >= outer) continue;
      const k = j * VERTS + i;
      const cur = heights[k]!;
      if (cur < WET) continue;
      const target = edgeHeight(net, e, hit.t) - ROAD_BED_DROP;
      if (hit.dist < inner) {
        if (!lock[k]) heights[k] = target;
        lock[k] = 1;
      } else if (!lock[k]) {
        heights[k] = cur + (target - cur) * smoothstep(outer, inner, hit.dist);
      }
    }
  }
  growRect(out, i0, j0, i1, j1);
}

/** Rebuilds the lock flags inside a vertex rectangle from the roads that still exist. */
export function relock(lock: Uint8Array, net: RoadNetwork, r: Rect): void {
  const i0 = clamp(r.x0, 0, MAP);
  const i1 = clamp(r.x1, 0, MAP);
  const j0 = clamp(r.y0, 0, MAP);
  const j1 = clamp(r.y1, 0, MAP);
  for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) lock[j * VERTS + i] = 0;
  for (const e of net.edges) {
    if (!e) continue;
    const poly = edgePolyline(net, e);
    const inner = halfWidth(e) + FLAT_MARGIN;
    if (poly.maxX + inner < i0 * CELL || poly.minX - inner > i1 * CELL || poly.maxZ + inner < j0 * CELL || poly.minZ - inner > j1 * CELL) continue;
    const a0 = Math.max(i0, Math.floor((poly.minX - inner) / CELL));
    const a1 = Math.min(i1, Math.ceil((poly.maxX + inner) / CELL));
    const b0 = Math.max(j0, Math.floor((poly.minZ - inner) / CELL));
    const b1 = Math.min(j1, Math.ceil((poly.maxZ + inner) / CELL));
    for (let j = b0; j <= b1; j++) {
      for (let i = a0; i <= a1; i++) {
        if (closestOnPolyline(poly, i * CELL, j * CELL, hit).dist < inner) lock[j * VERTS + i] = 1;
      }
    }
  }
}

/**
 * Recomputes which cells are road inside a cell rectangle. A cell is road when its centre
 * lies within the road's half width of the centreline. Stores the edge id, or -1.
 */
export function rasterRoads(roadCell: Int32Array, net: RoadNetwork, r: Rect): void {
  const i0 = clamp(r.x0, 0, MAP - 1);
  const i1 = clamp(r.x1, 0, MAP - 1);
  const j0 = clamp(r.y0, 0, MAP - 1);
  const j1 = clamp(r.y1, 0, MAP - 1);
  for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) roadCell[j * MAP + i] = -1;
  for (const e of net.edges) {
    if (!e) continue;
    const poly = edgePolyline(net, e);
    const hw = halfWidth(e);
    if (poly.maxX + hw < i0 * CELL || poly.minX - hw > (i1 + 1) * CELL || poly.maxZ + hw < j0 * CELL || poly.minZ - hw > (j1 + 1) * CELL) continue;
    const a0 = Math.max(i0, Math.floor((poly.minX - hw) / CELL));
    const a1 = Math.min(i1, Math.floor((poly.maxX + hw) / CELL));
    const b0 = Math.max(j0, Math.floor((poly.minZ - hw) / CELL));
    const b1 = Math.min(j1, Math.floor((poly.maxZ + hw) / CELL));
    for (let j = b0; j <= b1; j++) {
      for (let i = a0; i <= a1; i++) {
        if (closestOnPolyline(poly, (i + 0.5) * CELL, (j + 0.5) * CELL, hit).dist < hw) roadCell[j * MAP + i] = e.id;
      }
    }
  }
}

/** Removes trees from cells the edge covers or brushes. Returns true if any were removed. */
export function clearTreesUnderEdge(trees: Uint8Array, net: RoadNetwork, e: RoadEdge, out: Rect): boolean {
  const poly = edgePolyline(net, e);
  const reach = halfWidth(e) + 3.5;
  const i0 = clamp(Math.floor((poly.minX - reach) / CELL), 0, MAP - 1);
  const i1 = clamp(Math.floor((poly.maxX + reach) / CELL), 0, MAP - 1);
  const j0 = clamp(Math.floor((poly.minZ - reach) / CELL), 0, MAP - 1);
  const j1 = clamp(Math.floor((poly.maxZ + reach) / CELL), 0, MAP - 1);
  let any = false;
  for (let j = j0; j <= j1; j++) {
    for (let i = i0; i <= i1; i++) {
      const k = j * MAP + i;
      if (trees[k] === 0) continue;
      if (closestOnPolyline(poly, (i + 0.5) * CELL, (j + 0.5) * CELL, hit).dist < reach) {
        trees[k] = 0;
        any = true;
      }
    }
  }
  if (any) growRect(out, i0, j0, i1, j1);
  return any;
}
