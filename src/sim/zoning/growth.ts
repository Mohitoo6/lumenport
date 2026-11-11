import { MAP, TICKS_PER_DAY, VERTS } from '../../core/constants';
import type { Rng } from '../../core/rng';
import type { Rect } from '../roads/terraform';
import { findLot, frontageOf, type Lot } from './lots';
import { FACING_DX, FACING_DY, buildDays, stageOf, type Building } from './zones';

export interface ZoningLayers {
  zone: Uint8Array;
  buildings: Array<Building | null>;
  buildingCell: Int32Array;
  constructing: number[];
  roadCell: Int32Array;
  roadLock: Uint8Array;
  heights: Float32Array;
  trees: Uint8Array;
}

/** Zoned, empty cells that touch a road: the places a building could start. */
export function buildFrontier(s: ZoningLayers): number[] {
  const out: number[] = [];
  for (let j = 1; j < MAP - 1; j++) {
    for (let i = 1; i < MAP - 1; i++) {
      const k = j * MAP + i;
      if (s.zone[k] === 0 || s.buildingCell[k]! >= 0 || s.roadCell[k]! >= 0) continue;
      if (frontageOf(s, i, j) >= 0) out.push(k);
    }
  }
  return out;
}

/** Creates a building on a lot: claims the cells, clears trees and levels a pad. */
export function spawnBuilding(s: ZoningLayers, lot: Lot, zone: number, rng: Rng, kind = 0): Building {
  const b: Building = {
    id: s.buildings.length,
    kind,
    zone,
    x: lot.x,
    y: lot.y,
    w: lot.w,
    h: lot.h,
    facing: lot.facing,
    level: 1,
    progress: 0,
    seed: (rng.next() * 0x7fffffff) | 0,
    baseY: 0,
    pop: 0,
    flags: 0,
  };
  s.buildings.push(b);
  s.constructing.push(b.id);
  for (let j = lot.y; j < lot.y + lot.h; j++) {
    for (let i = lot.x; i < lot.x + lot.w; i++) {
      s.buildingCell[j * MAP + i] = b.id;
      s.trees[j * MAP + i] = 0;
    }
  }

  // Pad height: the ground along the road edge of the lot.
  const dx = FACING_DX[lot.facing]!;
  const dy = FACING_DY[lot.facing]!;
  let sum = 0;
  let n = 0;
  if (dy !== 0) {
    const j = dy < 0 ? lot.y : lot.y + lot.h;
    for (let i = lot.x; i <= lot.x + lot.w; i++) {
      sum += s.heights[j * VERTS + i]!;
      n++;
    }
  } else {
    const i = dx < 0 ? lot.x : lot.x + lot.w;
    for (let j = lot.y; j <= lot.y + lot.h; j++) {
      sum += s.heights[j * VERTS + i]!;
      n++;
    }
  }
  const pad = sum / n;
  let top = -Infinity;
  for (let j = lot.y; j <= lot.y + lot.h; j++) {
    for (let i = lot.x; i <= lot.x + lot.w; i++) {
      const k = j * VERTS + i;
      // Vertices already fixed by a road or a neighbour's pad stay as they are.
      if (!s.roadLock[k]) {
        s.heights[k] = pad;
        s.roadLock[k] = 1;
      }
      if (s.heights[k]! > top) top = s.heights[k]!;
    }
  }
  b.baseY = top + 0.03;
  return b;
}

export function removeBuilding(s: ZoningLayers, id: number): Building | null {
  const b = s.buildings[id];
  if (!b) return null;
  for (let j = b.y; j < b.y + b.h; j++) for (let i = b.x; i < b.x + b.w; i++) s.buildingCell[j * MAP + i] = -1;
  s.buildings[id] = null;
  const c = s.constructing.indexOf(id);
  if (c >= 0) s.constructing.splice(c, 1);
  return b;
}

export function lotRect(b: { x: number; y: number; w: number; h: number }): Rect {
  return { x0: b.x, y0: b.y, x1: b.x + b.w, y1: b.y + b.h };
}

/** Advances every building site by one tick. Ids whose visible stage changed go to `changed`. */
export function advanceConstruction(s: ZoningLayers, changed: number[]): void {
  const list = s.constructing;
  for (let n = list.length - 1; n >= 0; n--) {
    const b = s.buildings[list[n]!];
    if (!b) {
      list.splice(n, 1);
      continue;
    }
    const before = stageOf(b.progress);
    b.progress = Math.min(1, b.progress + 1 / ((b.kind !== 0 ? 3 : buildDays(b.zone)) * TICKS_PER_DAY));
    if (stageOf(b.progress) !== before) changed.push(b.id);
    if (b.progress >= 1) list.splice(n, 1);
  }
}

export interface GrowthResult {
  spawned: Building[];
  upgraded: Building[];
}

/**
 * One growth step: start a few buildings on frontier cells and occasionally upgrade a
 * finished one. `rates` gives eagerness 0..1 per zone type; `canGrow` can veto a cell
 * (for example, no power or water on its street).
 */
export function growthStep(
  s: ZoningLayers,
  frontier: number[],
  rng: Rng,
  rates: readonly number[],
  out: GrowthResult,
  canGrow?: (i: number, j: number) => boolean,
  landValue?: Float32Array,
): void {
  const attempts = Math.min(4, Math.ceil(frontier.length / 12));
  for (let a = 0; a < attempts; a++) {
    if (frontier.length === 0) break;
    const pick = rng.int(frontier.length);
    const k = frontier[pick]!;
    const i = k % MAP;
    const j = (k / MAP) | 0;
    if (!rng.chance(rates[s.zone[k]! >> 2]!)) continue;
    if (canGrow && !canGrow(i, j)) continue;
    const lot = findLot(s, i, j, rng);
    if (!lot) {
      // Nothing fits here now; drop it so it is not retried every step.
      frontier[pick] = frontier[frontier.length - 1]!;
      frontier.pop();
      continue;
    }
    out.spawned.push(spawnBuilding(s, lot, s.zone[k]!, rng));
    // Remove the lot's cells from the frontier.
    for (let n = frontier.length - 1; n >= 0; n--) {
      if (s.buildingCell[frontier[n]!]! >= 0) {
        frontier[n] = frontier[frontier.length - 1]!;
        frontier.pop();
      }
    }
  }

  // Upgrades: a slow drift toward higher levels.
  const total = s.buildings.length;
  for (let a = 0; a < 2 && total > 0; a++) {
    const b = s.buildings[rng.int(total)];
    if (!b || b.kind !== 0 || b.progress < 1 || b.level >= 3) continue;
    if (!rng.chance(0.012 * rates[b.zone >> 2]!)) continue;
    // Better buildings need better land: level 2 from 0.4, level 3 from 0.55.
    if (landValue && landValue[(b.y + (b.h >> 1)) * MAP + b.x + (b.w >> 1)]! < 0.25 + 0.15 * b.level) continue;
    b.level++;
    b.progress = 0.46;
    s.constructing.push(b.id);
    out.upgraded.push(b);
  }
}
