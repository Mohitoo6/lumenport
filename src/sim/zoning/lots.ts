import { MAP, VERTS } from '../../core/constants';
import type { Rng } from '../../core/rng';
import { FACING_DX, FACING_DY, Facing, ZoneType, zoneDensity, zoneType } from './zones';

export interface Lot {
  x: number;
  y: number;
  w: number;
  h: number;
  facing: Facing;
}

export interface LotLayers {
  zone: Uint8Array;
  buildingCell: Int32Array;
  roadCell: Int32Array;
  heights: Float32Array;
}

/** Deepest a lot may reach from its road, in cells. */
export const MAX_DEPTH = 4;
const MAX_RELIEF = 5;
const MIN_HEIGHT = 0.5;

/** Lot shapes to try, as [frontage, depth] in cells, most wanted first. */
function shapes(zone: number): Array<[number, number]> {
  const t = zoneType(zone);
  const d = zoneDensity(zone);
  if (t === ZoneType.Residential) {
    if (d === 1) return [[2, 3], [2, 2], [3, 3], [3, 2], [2, 4], [1, 2], [1, 3], [1, 1]];
    if (d === 2) return [[3, 3], [2, 3], [4, 3], [3, 4], [2, 2], [3, 2], [1, 2], [1, 1]];
    return [[4, 4], [3, 4], [3, 3], [4, 3], [2, 3], [2, 2], [1, 2], [1, 1]];
  }
  if (t === ZoneType.Commercial) {
    if (d === 1) return [[2, 2], [3, 2], [2, 3], [3, 3], [1, 2], [1, 1]];
    if (d === 2) return [[3, 3], [2, 3], [4, 3], [3, 4], [2, 2], [1, 2], [1, 1]];
    return [[4, 4], [3, 4], [3, 3], [4, 3], [2, 3], [2, 2], [1, 1]];
  }
  if (d === 1) return [[3, 3], [4, 3], [2, 3], [3, 4], [2, 2], [1, 2], [1, 1]];
  if (d === 2) return [[4, 4], [4, 3], [3, 4], [3, 3], [2, 3], [2, 2], [1, 1]];
  return [[4, 4], [4, 3], [3, 4], [3, 3], [2, 2], [1, 1]];
}

function isRoad(l: LotLayers, i: number, j: number): boolean {
  return i >= 0 && j >= 0 && i < MAP && j < MAP && l.roadCell[j * MAP + i]! >= 0;
}

/**
 * True if a road lies within MAX_DEPTH cells of (i, j) straight along one of the four
 * axes, so a lot facing that road could reach this cell. Only such cells can be zoned:
 * anything further back could never be built on.
 */
export function reachesRoad(l: Pick<LotLayers, 'roadCell'>, i: number, j: number): boolean {
  for (let f = 0; f < 4; f++) {
    const dx = FACING_DX[f]!;
    const dy = FACING_DY[f]!;
    for (let k = 1; k <= MAX_DEPTH; k++) {
      const x = i + dx * k;
      const y = j + dy * k;
      if (x < 0 || y < 0 || x >= MAP || y >= MAP) break;
      if (l.roadCell[y * MAP + x]! >= 0) return true;
    }
  }
  return false;
}

/** The side of cell (i, j) that touches a road, or -1. With several, the pick is stable. */
export function frontageOf(l: LotLayers, i: number, j: number): Facing | -1 {
  // Prefer the side whose road continues: it is more likely the main frontage.
  let best: Facing | -1 = -1;
  let bestScore = 0;
  for (let f = 0 as Facing; f < 4; f++) {
    const dx = FACING_DX[f]!;
    const dy = FACING_DY[f]!;
    if (!isRoad(l, i + dx, j + dy)) continue;
    // Count road cells along the frontage on both sides.
    let score = 1;
    if (isRoad(l, i + dx - dy, j + dy + dx)) score++;
    if (isRoad(l, i + dx + dy, j + dy - dx)) score++;
    if (score > bestScore) {
      bestScore = score;
      best = f;
    }
  }
  return best;
}

function rectFor(i: number, j: number, facing: Facing, front: number, depth: number, offset: number): Lot {
  switch (facing) {
    case Facing.North:
      return { x: i - offset, y: j, w: front, h: depth, facing };
    case Facing.South:
      return { x: i - offset, y: j - depth + 1, w: front, h: depth, facing };
    case Facing.West:
      return { x: i, y: j - offset, w: depth, h: front, facing };
    default:
      return { x: i - depth + 1, y: j - offset, w: depth, h: front, facing };
  }
}

function valid(l: LotLayers, lot: Lot, zone: number): boolean {
  if (lot.x < 1 || lot.y < 1 || lot.x + lot.w > MAP - 1 || lot.y + lot.h > MAP - 1) return false;
  for (let j = lot.y; j < lot.y + lot.h; j++) {
    for (let i = lot.x; i < lot.x + lot.w; i++) {
      const k = j * MAP + i;
      if (l.zone[k] !== zone || l.buildingCell[k]! >= 0 || l.roadCell[k]! >= 0) return false;
    }
  }
  let lo = Infinity;
  let hi = -Infinity;
  for (let j = lot.y; j <= lot.y + lot.h; j++) {
    for (let i = lot.x; i <= lot.x + lot.w; i++) {
      const v = l.heights[j * VERTS + i]!;
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
  }
  if (lo < MIN_HEIGHT || hi - lo > MAX_RELIEF) return false;

  // At least half the front row must face road. On a diagonal or curved road the road
  // steps away from some front cells, so a road one or two cells ahead (straight or on
  // the diagonal) counts too: the lot then has a small forecourt instead of failing.
  const dx = FACING_DX[lot.facing]!;
  const dy = FACING_DY[lot.facing]!;
  const near = (i: number, j: number): boolean => {
    for (let k = 1; k <= 2; k++) {
      const x = i + dx * k;
      const y = j + dy * k;
      if (isRoad(l, x, y) || isRoad(l, x + dy, y + dx) || isRoad(l, x - dy, y - dx)) return true;
    }
    return false;
  };
  let front = 0;
  let touching = 0;
  if (dy !== 0) {
    const j = dy < 0 ? lot.y : lot.y + lot.h - 1;
    for (let i = lot.x; i < lot.x + lot.w; i++) {
      front++;
      if (near(i, j)) touching++;
    }
  } else {
    const i = dx < 0 ? lot.x : lot.x + lot.w - 1;
    for (let j = lot.y; j < lot.y + lot.h; j++) {
      front++;
      if (near(i, j)) touching++;
    }
  }
  return touching * 2 >= front;
}

/**
 * Finds a lot for the zoned cell (i, j), which must touch a road. Tries the preferred
 * shapes for the zone, sliding each along the frontage, and returns the first that fits.
 */
export function findLot(l: LotLayers, i: number, j: number, rng: Rng): Lot | null {
  const zone = l.zone[j * MAP + i]!;
  if (zone === 0 || l.buildingCell[j * MAP + i]! >= 0) return null;
  const facing = frontageOf(l, i, j);
  if (facing < 0) return null;
  // The shape lists give the preferred frontage widths. The depth is always as deep as the
  // zoned land allows (up to MAX_DEPTH), so no strip of zoning is left stranded behind a
  // shallow lot where nothing could ever reach a road.
  const fronts: number[] = [];
  for (const [front] of shapes(zone)) if (!fronts.includes(front)) fronts.push(front);
  // Usually take the best-fitting preferred width, sometimes skip ahead for variety.
  const skip = rng.chance(0.35) ? rng.int(3) : 0;
  for (let n = 0; n < fronts.length; n++) {
    const front = fronts[(n + skip) % fronts.length]!;
    const start = rng.int(front);
    for (let o = 0; o < front; o++) {
      for (let depth = MAX_DEPTH; depth >= 1; depth--) {
        const lot = rectFor(i, j, facing as Facing, front, depth, (start + o) % front);
        if (valid(l, lot, zone)) return lot;
      }
    }
  }
  return null;
}
