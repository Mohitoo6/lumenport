import { MAP, VERTS } from '../core/constants';
import { FACING_DX, FACING_DY, Facing } from './zoning/zones';

/** Things the player places directly, as opposed to buildings that grow on zoned land. */
export const enum FacilityKind {
  None = 0,
  CoalPlant = 1,
  WindTurbine = 2,
  SolarFarm = 3,
  WaterTower = 4,
  WaterPump = 5,
}

export interface FacilitySpec {
  name: string;
  /** Footprint side in cells (all footprints are square). */
  size: number;
  cost: number;
  /** Monthly running cost. */
  upkeep: number;
  /** Megawatts supplied. */
  power: number;
  /** Water units supplied. */
  water: number;
  /** Must stand within a few cells of open water. */
  needsShore: boolean;
  blurb: string;
}

export const FACILITIES: Record<number, FacilitySpec> = {
  [FacilityKind.CoalPlant]: { name: 'Coal power plant', size: 4, cost: 14000, upkeep: 620, power: 45, water: 0, needsShore: false, blurb: 'Cheap, plentiful power. Dirty.' },
  [FacilityKind.WindTurbine]: { name: 'Wind turbine', size: 2, cost: 3200, upkeep: 90, power: 4, water: 0, needsShore: false, blurb: 'Clean power in small amounts.' },
  [FacilityKind.SolarFarm]: { name: 'Solar farm', size: 3, cost: 7500, upkeep: 130, power: 9, water: 0, needsShore: false, blurb: 'Clean power, needs space.' },
  [FacilityKind.WaterTower]: { name: 'Water tower', size: 2, cost: 2800, upkeep: 110, power: 0, water: 1600, needsShore: false, blurb: 'Supplies a small district.' },
  [FacilityKind.WaterPump]: { name: 'Pumping station', size: 2, cost: 6500, upkeep: 260, power: 0, water: 7000, needsShore: true, blurb: 'High output. Build by the water.' },
};

export const POWER_FACILITIES = [FacilityKind.CoalPlant, FacilityKind.WindTurbine, FacilityKind.SolarFarm] as const;
export const WATER_FACILITIES = [FacilityKind.WaterTower, FacilityKind.WaterPump] as const;

export interface FacilityPlan {
  ok: boolean;
  reason: string;
  kind: FacilityKind;
  x: number;
  y: number;
  size: number;
  facing: Facing;
  cost: number;
}

interface PlaceLayers {
  heights: Float32Array;
  roadCell: Int32Array;
  buildingCell: Int32Array;
}

const SHORE_REACH = 4;
const MAX_RELIEF = 6;

/**
 * Works out where a facility would go if placed with its centre on cell (ci, cj), and
 * whether that is allowed. Used both for the placement preview and by the command.
 */
export function planFacility(s: PlaceLayers, kind: FacilityKind, ci: number, cj: number): FacilityPlan {
  const spec = FACILITIES[kind];
  const plan: FacilityPlan = { ok: false, reason: '', kind, x: 0, y: 0, size: spec?.size ?? 1, facing: Facing.South, cost: spec?.cost ?? 0 };
  if (!spec) {
    plan.reason = 'Unknown facility';
    return plan;
  }
  const n = spec.size;
  const x = ci - Math.floor((n - 1) / 2);
  const y = cj - Math.floor((n - 1) / 2);
  plan.x = x;
  plan.y = y;
  if (x < 2 || y < 2 || x + n > MAP - 2 || y + n > MAP - 2) {
    plan.reason = 'Outside the city limits';
    return plan;
  }
  let lo = Infinity;
  let hi = -Infinity;
  for (let j = y; j <= y + n; j++) {
    for (let i = x; i <= x + n; i++) {
      const h = s.heights[j * VERTS + i]!;
      if (h < lo) lo = h;
      if (h > hi) hi = h;
    }
  }
  if (lo < 0.5) {
    plan.reason = 'Cannot build in water';
    return plan;
  }
  if (hi - lo > MAX_RELIEF) {
    plan.reason = 'Ground is too steep';
    return plan;
  }
  for (let j = y; j < y + n; j++) {
    for (let i = x; i < x + n; i++) {
      const k = j * MAP + i;
      if (s.roadCell[k]! >= 0) {
        plan.reason = 'A road is in the way';
        return plan;
      }
      if (s.buildingCell[k]! >= 0) {
        plan.reason = 'A building is in the way';
        return plan;
      }
    }
  }
  // Face the side with the most road along it.
  let best = 0;
  for (let f = 0 as Facing; f < 4; f++) {
    const dx = FACING_DX[f]!;
    const dy = FACING_DY[f]!;
    let touching = 0;
    for (let t = 0; t < n; t++) {
      const i = dx === 0 ? x + t : dx < 0 ? x - 1 : x + n;
      const j = dy === 0 ? y + t : dy < 0 ? y - 1 : y + n;
      if (s.roadCell[j * MAP + i]! >= 0) touching++;
    }
    if (touching > best) {
      best = touching;
      plan.facing = f;
    }
  }
  if (best === 0) {
    plan.reason = 'Must be next to a road';
    return plan;
  }
  if (spec.needsShore) {
    let wet = false;
    for (let j = y - SHORE_REACH; j <= y + n + SHORE_REACH && !wet; j++) {
      for (let i = x - SHORE_REACH; i <= x + n + SHORE_REACH; i++) {
        if (i < 0 || j < 0 || i > MAP || j > MAP) continue;
        if (s.heights[j * VERTS + i]! < -0.3) {
          wet = true;
          break;
        }
      }
    }
    if (!wet) {
      plan.reason = 'Must be close to water';
      return plan;
    }
  }
  plan.ok = true;
  return plan;
}
