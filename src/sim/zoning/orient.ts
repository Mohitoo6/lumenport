import { CELL, MAP } from '../../core/constants';
import { edgePolyline } from '../roads/graph';
import { closestOnPolyline, newClosest } from '../roads/geometry';
import type { RoadNetwork } from '../roads/types';
import { FACING_DX, FACING_DY, type Building } from './zones';

const scratch = newClosest();
const STRAIGHT = Math.cos((8 * Math.PI) / 180);
const TOO_FAR = Math.cos((55 * Math.PI) / 180);

/**
 * Which way a new building should face so it looks at its road, as an angle (the facing
 * vector is (sin a, cos a)), or undefined when the road runs along the grid anyway. Lots
 * stay on the grid; only the building drawn on them turns, so diagonal and curved streets
 * are lined with buildings that face the street instead of a jagged staircase.
 */
export function roadAngle(roads: RoadNetwork, roadCell: Int32Array, b: Building): number | undefined {
  const cx = (b.x + b.w / 2) * CELL;
  const cz = (b.y + b.h / 2) * CELL;
  const ids = new Set<number>();
  for (let j = Math.max(0, b.y - 3); j <= Math.min(MAP - 1, b.y + b.h + 2); j++) {
    for (let i = Math.max(0, b.x - 3); i <= Math.min(MAP - 1, b.x + b.w + 2); i++) {
      const id = roadCell[j * MAP + i]!;
      if (id >= 0) ids.add(id);
    }
  }
  let best = Infinity;
  let qx = 0;
  let qz = 0;
  for (const id of ids) {
    const e = roads.edges[id];
    if (!e) continue;
    const c = closestOnPolyline(edgePolyline(roads, e), cx, cz, scratch);
    if (c.dist < best) {
      best = c.dist;
      qx = c.x;
      qz = c.z;
    }
  }
  if (!Number.isFinite(best) || best < 1) return undefined;
  const dx = (qx - cx) / best;
  const dz = (qz - cz) / best;
  const dot = dx * FACING_DX[b.facing]! + dz * FACING_DY[b.facing]!;
  if (dot > STRAIGHT || dot < TOO_FAR) return undefined;
  return Math.atan2(dx, dz);
}
