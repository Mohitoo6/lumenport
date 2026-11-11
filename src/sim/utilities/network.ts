import { MAP } from '../../core/constants';
import { hash2 } from '../../core/rng';
import { capacityOf } from '../economy/capacity';
import { FACILITIES } from '../facilities';
import { FACING_DX, FACING_DY, ZoneType, zoneType, type Building } from '../zoning/zones';

/** Building status bits. */
export const POWERED = 1;
export const WATERED = 2;

export interface Networks {
  /** Per cell: id of the connected road network covering it, or -1. */
  comp: Int32Array;
  count: number;
  powerSupply: Float32Array;
  powerDemand: Float32Array;
  waterSupply: Float32Array;
  waterDemand: Float32Array;
}

/** Megawatts and water units a building needs, per resident or job of capacity. */
const POWER_PER: Record<number, number> = { [ZoneType.Residential]: 0.0032, [ZoneType.Commercial]: 0.006, [ZoneType.Industrial]: 0.011 };
const WATER_PER: Record<number, number> = { [ZoneType.Residential]: 1.0, [ZoneType.Commercial]: 0.8, [ZoneType.Industrial]: 1.5 };

/** Labels connected groups of road cells. Utilities travel along roads, so each group is one grid. */
export function labelRoads(roadCell: Int32Array, comp: Int32Array): number {
  comp.fill(-1);
  let count = 0;
  const stack: number[] = [];
  for (let start = 0; start < roadCell.length; start++) {
    if (roadCell[start]! < 0 || comp[start]! >= 0) continue;
    comp[start] = count;
    stack.push(start);
    while (stack.length > 0) {
      const k = stack.pop()!;
      const i = k % MAP;
      if (i > 0 && roadCell[k - 1]! >= 0 && comp[k - 1]! < 0) {
        comp[k - 1] = count;
        stack.push(k - 1);
      }
      if (i < MAP - 1 && roadCell[k + 1]! >= 0 && comp[k + 1]! < 0) {
        comp[k + 1] = count;
        stack.push(k + 1);
      }
      if (k >= MAP && roadCell[k - MAP]! >= 0 && comp[k - MAP]! < 0) {
        comp[k - MAP] = count;
        stack.push(k - MAP);
      }
      if (k < roadCell.length - MAP && roadCell[k + MAP]! >= 0 && comp[k + MAP]! < 0) {
        comp[k + MAP] = count;
        stack.push(k + MAP);
      }
    }
    count++;
  }
  return count;
}

/** The road network a building is connected to: the one along its front, else any side. */
export function homeNetwork(b: Building, comp: Int32Array): number {
  const scan = (f: number): number => {
    const dx = FACING_DX[f]!;
    const dy = FACING_DY[f]!;
    const n = dx === 0 ? b.w : b.h;
    for (let t = 0; t < n; t++) {
      const i = dx === 0 ? b.x + t : dx < 0 ? b.x - 1 : b.x + b.w;
      const j = dy === 0 ? b.y + t : dy < 0 ? b.y - 1 : b.y + b.h;
      if (i < 0 || j < 0 || i >= MAP || j >= MAP) continue;
      const c = comp[j * MAP + i]!;
      if (c >= 0) return c;
    }
    return -1;
  };
  const front = scan(b.facing);
  if (front >= 0) return front;
  for (let f = 0; f < 4; f++) {
    if (f === b.facing) continue;
    const c = scan(f);
    if (c >= 0) return c;
  }
  return -1;
}

export function newNetworks(): Networks {
  return {
    comp: new Int32Array(MAP * MAP).fill(-1),
    count: 0,
    powerSupply: new Float32Array(0),
    powerDemand: new Float32Array(0),
    waterSupply: new Float32Array(0),
    waterDemand: new Float32Array(0),
  };
}

export interface UtilityTotals {
  powerSupply: number;
  powerDemand: number;
  waterSupply: number;
  waterDemand: number;
}

/**
 * Recomputes supply and demand on every road network and sets each building's POWERED /
 * WATERED bits. When a network is short, a rotating share of its buildings goes without.
 */
export function computeUtilities(
  buildings: ReadonlyArray<Building | null>,
  roadCell: Int32Array,
  net: Networks,
  relabel: boolean,
  day: number,
  totals: UtilityTotals,
): void {
  if (relabel) net.count = labelRoads(roadCell, net.comp);
  const n = net.count;
  if (net.powerSupply.length !== n) {
    net.powerSupply = new Float32Array(n);
    net.powerDemand = new Float32Array(n);
    net.waterSupply = new Float32Array(n);
    net.waterDemand = new Float32Array(n);
  } else {
    net.powerSupply.fill(0);
    net.powerDemand.fill(0);
    net.waterSupply.fill(0);
    net.waterDemand.fill(0);
  }
  totals.powerSupply = totals.powerDemand = totals.waterSupply = totals.waterDemand = 0;

  for (const b of buildings) {
    if (!b || b.progress < 1) continue;
    const c = homeNetwork(b, net.comp);
    if (c < 0) continue;
    if (b.kind !== 0) {
      const spec = FACILITIES[b.kind]!;
      net.powerSupply[c]! += spec.power;
      net.waterSupply[c]! += spec.water;
      totals.powerSupply += spec.power;
      totals.waterSupply += spec.water;
    } else {
      const t = zoneType(b.zone);
      const cap = capacityOf(b);
      const p = cap * POWER_PER[t]!;
      const w = cap * WATER_PER[t]!;
      net.powerDemand[c]! += p;
      net.waterDemand[c]! += w;
      totals.powerDemand += p;
      totals.waterDemand += w;
    }
  }

  const period = Math.floor(day / 3);
  for (const b of buildings) {
    if (!b) continue;
    if (b.kind !== 0) {
      b.flags |= POWERED | WATERED;
      continue;
    }
    const c = homeNetwork(b, net.comp);
    let flags = 0;
    if (c >= 0) {
      const ps = net.powerSupply[c]!;
      const pd = net.powerDemand[c]!;
      if (ps > 0 && (ps >= pd || hash2(b.id, period, 7001) < ps / pd)) flags |= POWERED;
      const ws = net.waterSupply[c]!;
      const wd = net.waterDemand[c]!;
      if (ws > 0 && (ws >= wd || hash2(b.id, period, 7003) < ws / wd)) flags |= WATERED;
    }
    b.flags = (b.flags & ~(POWERED | WATERED)) | flags;
  }
}
