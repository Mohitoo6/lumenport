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
  Police = 6,
  FireStation = 7,
  Clinic = 8,
  School = 9,
  Park = 10,
  /** The seat of the city council: placed by the game at the start, cannot be removed. */
  TownHall = 11,
  ItPark = 12,
  University = 13,
  MetroStation = 14,
  /** A bus shelter. Two or more on connected roads make a bus line. */
  BusStop = 15,
  /** Runway, terminal and cargo apron: trade, tourists and travel. One per city. */
  Airport = 16,
}

/** Which coverage layer a service facility feeds. */
export const enum Service {
  None = 0,
  Police = 1,
  Fire = 2,
  Health = 3,
  Education = 4,
  Park = 5,
  /** Reach of metro stations that are connected to at least one other station. */
  Transit = 6,
  /** Walking reach of bus stops that a bus line serves. */
  Bus = 7,
}

export interface FacilitySpec {
  name: string;
  /** Footprint side in cells. */
  size: number;
  /**
   * For a long facility (the airport): the footprint is `size` by `length` cells, turned
   * whichever way fits the site and puts more of it along a road.
   */
  length?: number;
  cost: number;
  /** Hourly running cost. */
  upkeep: number;
  /** Megawatts supplied. */
  power: number;
  /** Water units supplied. */
  water: number;
  /** Must stand within a few cells of open water. */
  needsShore: boolean;
  blurb: string;
  service: Service;
  /** Service reach in cells; coverage falls off linearly to zero at this distance. */
  radius: number;
  /** A landmark: needs no road, one per city, cannot be demolished or built over. */
  landmark?: boolean;
  /** Office or campus jobs it offers once built (filled like shop jobs, taxed at a higher wage). */
  jobs?: number;
  /** Where its running cost appears in the budget. Defaults: utility without a service, else service. */
  budget?: 'utility' | 'service' | 'transit';
  /** Steepest rise allowed across the site, metres (default 6). */
  maxRelief?: number;
}

export const FACILITIES: Record<number, FacilitySpec> = {
  [FacilityKind.CoalPlant]: { name: 'Coal power plant', size: 4, cost: 14000, upkeep: 620, power: 45, water: 0, needsShore: false, blurb: 'Cheap, plentiful power. Dirty.', service: Service.None, radius: 0 },
  [FacilityKind.WindTurbine]: { name: 'Wind turbine', size: 2, cost: 3200, upkeep: 90, power: 4, water: 0, needsShore: false, blurb: 'Clean power in small amounts.', service: Service.None, radius: 0 },
  [FacilityKind.SolarFarm]: { name: 'Solar farm', size: 3, cost: 7500, upkeep: 130, power: 9, water: 0, needsShore: false, blurb: 'Clean power, needs space.', service: Service.None, radius: 0 },
  [FacilityKind.WaterTower]: { name: 'Water tower', size: 2, cost: 2800, upkeep: 110, power: 0, water: 1600, needsShore: false, blurb: 'Supplies a small district.', service: Service.None, radius: 0 },
  [FacilityKind.WaterPump]: { name: 'Pumping station', size: 2, cost: 6500, upkeep: 260, power: 0, water: 7000, needsShore: true, blurb: 'High output. Build by the water.', service: Service.None, radius: 0 },
  [FacilityKind.Police]: { name: 'Police station', size: 2, cost: 5000, upkeep: 320, power: 0, water: 0, needsShore: false, blurb: 'Keeps crime down nearby.', service: Service.Police, radius: 42 },
  [FacilityKind.FireStation]: { name: 'Fire station', size: 2, cost: 5500, upkeep: 340, power: 0, water: 0, needsShore: false, blurb: 'Makes the district safer.', service: Service.Fire, radius: 42 },
  [FacilityKind.Clinic]: { name: 'Clinic', size: 2, cost: 6000, upkeep: 380, power: 0, water: 0, needsShore: false, blurb: 'Healthier, happier residents.', service: Service.Health, radius: 38 },
  [FacilityKind.School]: { name: 'School', size: 3, cost: 7000, upkeep: 420, power: 0, water: 0, needsShore: false, blurb: 'Educated residents; lets homes improve.', service: Service.Education, radius: 38 },
  [FacilityKind.Park]: { name: 'Park', size: 2, cost: 1200, upkeep: 40, power: 0, water: 0, needsShore: false, blurb: 'Raises land value around it.', service: Service.Park, radius: 14 },
  [FacilityKind.ItPark]: { name: 'IT park', size: 4, cost: 28000, upkeep: 350, power: 0, water: 0, needsShore: false, blurb: 'Well-paid office jobs: draws new residents and raises tax income.', service: Service.None, radius: 0, jobs: 480, budget: 'service' },
  [FacilityKind.University]: { name: 'University', size: 5, cost: 32000, upkeep: 1100, power: 0, water: 0, needsShore: false, blurb: 'Educates a wide area, lifts land value and offers campus jobs.', service: Service.Education, radius: 90, jobs: 120 },
  [FacilityKind.MetroStation]: { name: 'Metro station', size: 2, cost: 9000, upkeep: 160, power: 0, water: 0, needsShore: false, blurb: 'Connect two or more with a metro line: fewer cars, higher land value, fare income.', service: Service.Transit, radius: 55, budget: 'transit' },
  [FacilityKind.BusStop]: { name: 'Bus stop', size: 1, cost: 600, upkeep: 15, power: 0, water: 0, needsShore: false, blurb: 'Two or more on connected roads start a bus line: fewer cars, fare income.', service: Service.Bus, radius: 24, budget: 'transit' },
  [FacilityKind.Airport]: { name: 'Airport', size: 14, length: 34, cost: 65000, upkeep: 900, power: 0, water: 0, needsShore: false, blurb: 'Exports from your industry, visiting tourists and trips for residents. Noisy near the runway.', service: Service.None, radius: 0, jobs: 260, budget: 'transit', landmark: false, maxRelief: 9 },
  [FacilityKind.TownHall]: { name: 'Town Hall', size: 4, cost: 0, upkeep: 0, power: 0, water: 0, needsShore: false, blurb: 'Seat of the city council. A civic square that lifts the land around it.', service: Service.Park, radius: 22, landmark: true },
};

export function isLandmark(kind: number): boolean {
  return FACILITIES[kind]?.landmark === true;
}

export const POWER_FACILITIES = [FacilityKind.CoalPlant, FacilityKind.WindTurbine, FacilityKind.SolarFarm] as const;
export const WATER_FACILITIES = [FacilityKind.WaterTower, FacilityKind.WaterPump] as const;
export const SERVICE_FACILITIES = [FacilityKind.Police, FacilityKind.FireStation, FacilityKind.Clinic, FacilityKind.School, FacilityKind.Park] as const;
export const CAMPUS_FACILITIES = [FacilityKind.ItPark, FacilityKind.University] as const;
export const TRANSIT_FACILITIES = [FacilityKind.BusStop, FacilityKind.MetroStation, FacilityKind.Airport] as const;

export interface FacilityPlan {
  ok: boolean;
  reason: string;
  kind: FacilityKind;
  x: number;
  y: number;
  /** Footprint in cells along x and along y. */
  w: number;
  h: number;
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
 * whether that is allowed. Used both for the placement preview and by the command. A long
 * facility is tried both ways round; the way that fits wins, and if both fit, the one with
 * more of its long side along a road.
 */
export function planFacility(s: PlaceLayers, kind: FacilityKind, ci: number, cj: number): FacilityPlan {
  const spec = FACILITIES[kind];
  if (!spec) return { ok: false, reason: 'Unknown facility', kind, x: 0, y: 0, w: 1, h: 1, facing: Facing.South, cost: 0 };
  const a = spec.size;
  const b = spec.length ?? spec.size;
  if (a === b) return planFootprint(s, kind, ci, cj, a, a).plan;
  const across = planFootprint(s, kind, ci, cj, b, a);
  const along = planFootprint(s, kind, ci, cj, a, b);
  if (across.plan.ok !== along.plan.ok) return across.plan.ok ? across.plan : along.plan;
  return across.touching >= along.touching ? across.plan : along.plan;
}

function planFootprint(s: PlaceLayers, kind: FacilityKind, ci: number, cj: number, w: number, h: number): { plan: FacilityPlan; touching: number } {
  const spec = FACILITIES[kind]!;
  const x = ci - Math.floor((w - 1) / 2);
  const y = cj - Math.floor((h - 1) / 2);
  const plan: FacilityPlan = { ok: false, reason: '', kind, x, y, w, h, facing: Facing.South, cost: spec.cost };
  const fail = (reason: string): { plan: FacilityPlan; touching: number } => {
    plan.reason = reason;
    return { plan, touching: 0 };
  };
  if (x < 2 || y < 2 || x + w > MAP - 2 || y + h > MAP - 2) return fail('Outside the city limits');
  let lo = Infinity;
  let hi = -Infinity;
  for (let j = y; j <= y + h; j++) {
    for (let i = x; i <= x + w; i++) {
      const v = s.heights[j * VERTS + i]!;
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
  }
  if (lo < 0.5) return fail('Cannot build in water');
  if (hi - lo > (spec.maxRelief ?? MAX_RELIEF)) return fail('Ground is too steep');
  for (let j = y; j < y + h; j++) {
    for (let i = x; i < x + w; i++) {
      const k = j * MAP + i;
      if (s.roadCell[k]! >= 0) return fail('A road is in the way');
      if (s.buildingCell[k]! >= 0) return fail('A building is in the way');
    }
  }
  // Face the side with the most road along it.
  let best = 0;
  for (let f = 0 as Facing; f < 4; f++) {
    const dx = FACING_DX[f]!;
    const dy = FACING_DY[f]!;
    const n = dx === 0 ? w : h;
    let touching = 0;
    for (let t = 0; t < n; t++) {
      const i = dx === 0 ? x + t : dx < 0 ? x - 1 : x + w;
      const j = dy === 0 ? y + t : dy < 0 ? y - 1 : y + h;
      if (s.roadCell[j * MAP + i]! >= 0) touching++;
    }
    if (touching > best) {
      best = touching;
      plan.facing = f;
    }
  }
  if (best === 0 && !spec.landmark) return fail('Must be next to a road');
  if (spec.needsShore) {
    let wet = false;
    for (let j = y - SHORE_REACH; j <= y + h + SHORE_REACH && !wet; j++) {
      for (let i = x - SHORE_REACH; i <= x + w + SHORE_REACH; i++) {
        if (i < 0 || j < 0 || i > MAP || j > MAP) continue;
        if (s.heights[j * VERTS + i]! < -0.3) {
          wet = true;
          break;
        }
      }
    }
    if (!wet) return fail('Must be close to water');
  }
  plan.ok = true;
  return { plan, touching: best };
}

/**
 * Where the town hall goes: the flattest dry 4 x 4 site near `centre` (cells) with no roads,
 * zoning or buildings on it. Searches outward in rings; null if nothing fits.
 */
export function findTownHallSite(s: PlaceLayers & { zone: Uint8Array }, ci: number, cj: number): { x: number; y: number } | null {
  const size = FACILITIES[FacilityKind.TownHall]!.size;
  const found: { best: { x: number; y: number; score: number } | null } = { best: null };
  for (let r = 0; r <= 90; r += 2) {
    for (let dj = -r; dj <= r; dj += 2) {
      for (let di = -r; di <= r; di += 2) {
        if (Math.max(Math.abs(di), Math.abs(dj)) !== r) continue;
        const i = ci + di;
        const j = cj + dj;
        const plan = planFacility(s, FacilityKind.TownHall, i, j);
        if (!plan.ok) continue;
        let clear = true;
        let lo = Infinity;
        let hi = -Infinity;
        for (let y = plan.y - 1; y <= plan.y + size && clear; y++) {
          for (let x = plan.x - 1; x <= plan.x + size; x++) {
            if (s.zone[y * MAP + x] !== 0 || s.roadCell[y * MAP + x]! >= 0 || s.buildingCell[y * MAP + x]! >= 0) {
              clear = false;
              break;
            }
          }
        }
        if (!clear) continue;
        for (let y = plan.y; y <= plan.y + size; y++) {
          for (let x = plan.x; x <= plan.x + size; x++) {
            const h = s.heights[y * VERTS + x]!;
            lo = Math.min(lo, h);
            hi = Math.max(hi, h);
          }
        }
        if (lo < 1.5) continue;
        // Keep the civic square well back from the shore.
        let wet = false;
        for (let y = Math.max(0, plan.y - 10); y <= Math.min(MAP, plan.y + size + 10) && !wet; y += 2) {
          for (let x = Math.max(0, plan.x - 10); x <= Math.min(MAP, plan.x + size + 10); x += 2) {
            if (s.heights[y * VERTS + x]! < 0.8) {
              wet = true;
              break;
            }
          }
        }
        if (wet) continue;
        const score = (hi - lo) * 12 + r;
        if (!found.best || score < found.best.score) found.best = { x: i, y: j, score };
      }
    }
    // A close, flat site beats searching further out.
    if (found.best && found.best.score < r + 4) break;
  }
  return found.best ? { x: found.best.x, y: found.best.y } : null;
}
