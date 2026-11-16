import { FACILITIES, FacilityKind } from '../facilities';
import { clamp } from '../../core/math';
import { POWERED, WATERED } from '../utilities/network';
import { ZoneType, zoneType, type Building } from '../zoning/zones';
import { capacityOf } from './capacity';

/** Share of residents who work. */
export const LABOR_SHARE = 0.55;
/** Tax rate (percent) at which taxes neither attract nor repel. */
export const NEUTRAL_TAX = 9;

export interface CityStats {
  population: number;
  /** Homes for this many people exist or are being built. */
  housing: number;
  jobsC: number;
  jobsI: number;
  employed: number;
  /** Demand per zone type in -1..1: [unused, residential, commercial, industrial]. */
  demand: [number, number, number, number];
  powerSupply: number;
  powerDemand: number;
  waterSupply: number;
  waterDemand: number;
  /** Finished zoned buildings currently without power or without water. */
  unpowered: number;
  unwatered: number;
  /** Share of road speed lost to queues, 0..1, smoothed. */
  congestion: number;
  /** Vehicles on the road right now. */
  vehicles: number;
  /** Resident-weighted average happiness, 0..1. */
  happiness: number;
  /** Residents who ride the metro instead of driving (optional for older saves). */
  metroRiders?: number;
  /** Residents who take the bus instead of driving, and buses in service. */
  busRiders?: number;
  buses?: number;
}

export function emptyStats(): CityStats {
  return {
    population: 0,
    housing: 0,
    jobsC: 0,
    jobsI: 0,
    employed: 0,
    demand: [0, 0.65, 0.15, 0.6],
    powerSupply: 0,
    powerDemand: 0,
    waterSupply: 0,
    waterDemand: 0,
    unpowered: 0,
    unwatered: 0,
    congestion: 0,
    vehicles: 0,
    happiness: 0.5,
    metroRiders: 0,
    busRiders: 0,
    buses: 0,
  };
}

function taxEffect(rate: number): number {
  return (NEUTRAL_TAX - rate) * 0.05;
}

/**
 * Daily economic step. People move into served homes and out of unserved ones, workers
 * are shared out among workplaces, and demand for each zone type is recomputed:
 *
 *   homes want jobs to exist, shops want customers, industry wants a workforce,
 *
 * with small constant terms so an empty city can get started.
 */
export function economyStep(buildings: ReadonlyArray<Building | null>, tax: readonly number[], stats: CityStats): void {
  let population = 0;
  let housing = 0;
  let jobsC = 0;
  let jobsI = 0;
  let plannedC = 0;
  let plannedI = 0;
  let unpowered = 0;
  let unwatered = 0;

  for (const b of buildings) {
    if (!b) continue;
    if (b.kind !== 0) {
      // Office and campus jobs count with the shops'.
      const jobs = FACILITIES[b.kind]?.jobs ?? 0;
      if (jobs > 0) {
        plannedC += jobs;
        if (b.progress >= 1) jobsC += jobs;
      }
      continue;
    }
    const t = zoneType(b.zone);
    const cap = capacityOf(b);
    const done = b.progress >= 1;
    const served = (b.flags & (POWERED | WATERED)) === (POWERED | WATERED);
    if (done) {
      if (!(b.flags & POWERED)) unpowered++;
      if (!(b.flags & WATERED)) unwatered++;
    }
    if (t === ZoneType.Residential) {
      housing += cap;
      if (done) {
        // Move in over about a week; drain faster when the utilities are off.
        const target = served ? cap : Math.floor(cap * 0.1);
        const step = Math.max(1, Math.ceil(Math.abs(target - b.pop) * (target > b.pop ? 0.18 : 0.3)));
        b.pop = target > b.pop ? Math.min(target, b.pop + step) : Math.max(target, b.pop - step);
        population += b.pop;
      }
    } else if (t === ZoneType.Commercial) {
      plannedC += cap;
      if (done && served) jobsC += cap;
    } else {
      plannedI += cap;
      if (done && served) jobsI += cap;
    }
  }

  // Share the workforce among workplaces in proportion to their size.
  const labor = population * LABOR_SHARE;
  const jobs = jobsC + jobsI;
  const fill = jobs > 0 ? Math.min(1, labor / jobs) : 0;
  let employed = 0;
  for (const b of buildings) {
    if (!b) continue;
    if (b.kind !== 0) {
      const jobs = FACILITIES[b.kind]?.jobs ?? 0;
      if (jobs > 0) {
        b.pop = b.progress >= 1 ? Math.round(jobs * fill) : 0;
        employed += b.pop;
      }
      continue;
    }
    if (zoneType(b.zone) === ZoneType.Residential) continue;
    const served = b.progress >= 1 && (b.flags & (POWERED | WATERED)) === (POWERED | WATERED);
    b.pop = served ? Math.round(capacityOf(b) * fill) : 0;
    employed += b.pop;
  }

  // Demand. Planned capacity (including sites under construction) is used on the supply
  // side so growth does not overshoot while buildings are still going up.
  const plannedLabor = housing * LABOR_SHARE;
  const plannedJobs = plannedC + plannedI;
  // A very happy city attracts people; a miserable one puts them off. In between, it does
  // not matter, so a young town is not held back by happiness it has had no chance to earn.
  const mood = Math.max(0, stats.happiness - 0.6) - Math.max(0, 0.3 - stats.happiness);
  // The constant lets a starter town of a couple of hundred people grow on shops alone.
  const dR = (plannedJobs * 1.15 + 100 - plannedLabor) / Math.max(60, plannedLabor) + taxEffect(tax[1]!) + mood * 0.8;
  const targetC = population * 0.22 + 4;
  // Shops suffer when customers are stuck in traffic.
  // An airport brings tourists to the shops and export markets to the factories.
  const airport = buildings.some((b) => b && b.kind === FacilityKind.Airport && b.progress >= 1);
  const dC = (targetC - plannedC) / Math.max(30, targetC) + taxEffect(tax[2]!) - stats.congestion * 0.5 + (airport ? 0.15 : 0);
  const targetI = population * 0.33 + 25;
  const dI = (targetI - plannedI) / Math.max(40, targetI) + taxEffect(tax[3]!) + (airport ? 0.1 : 0);

  stats.population = population;
  stats.housing = housing;
  stats.jobsC = jobsC;
  stats.jobsI = jobsI;
  stats.employed = employed;
  stats.demand[1] = clamp(dR, -1, 1);
  stats.demand[2] = clamp(dC, -1, 1);
  stats.demand[3] = clamp(dI, -1, 1);
  stats.unpowered = unpowered;
  stats.unwatered = unwatered;
}

/** How eagerly a zone type develops, 0..1, from its demand. */
export function growthRateFor(demand: number): number {
  return demand <= 0.02 ? 0 : clamp(0.08 + demand * 0.9, 0, 1);
}
