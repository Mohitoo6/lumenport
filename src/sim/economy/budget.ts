import { BUS } from '../transit/bus';
import { METRO, metroLength, type MetroState } from '../transit/metro';
import { FacilityKind, FACILITIES, Service } from '../facilities';
import { ROAD_SPECS, type RoadNetwork } from '../roads/types';
import { ZoneType, zoneType, type Building } from '../zoning/zones';
import type { CityStats } from './economy';

export interface Policies {
  /** Staggered office hours: flattens the morning and evening rush. */
  flexHours?: boolean;
}

/** Hourly cost of each policy while it is in force. */
export const POLICY_COST: Record<keyof Policies, number> = { flexHours: 350 };

export interface Loan {
  tier: number;
  /** Fixed hourly payment (principal plus interest). */
  payment: number;
  hoursLeft: number;
}

export interface LoanTier {
  amount: number;
  hours: number;
  /** Simple annual interest rate. */
  rate: number;
}

export const LOAN_TIERS: readonly LoanTier[] = [
  { amount: 20000, hours: 24, rate: 0.06 },
  { amount: 50000, hours: 36, rate: 0.08 },
  { amount: 120000, hours: 48, rate: 0.1 },
];

export function loanPayment(t: LoanTier): number {
  return Math.round((t.amount * (1 + (t.rate * t.hours) / 12)) / t.hours);
}

/** One hour's money in and out. */
export interface BudgetReport {
  taxR: number;
  taxC: number;
  taxI: number;
  roads: number;
  utilities: number;
  services: number;
  /** Metro stations and lines. */
  transit: number;
  /** Metro and bus fares. */
  fares: number;
  /** The airport's earnings: cargo from exports, passenger fees and tourist spending. */
  airport: number;
  loans: number;
  income: number;
  expense: number;
  net: number;
}

export function emptyReport(): BudgetReport {
  return { taxR: 0, taxC: 0, taxI: 0, roads: 0, utilities: 0, services: 0, transit: 0, fares: 0, airport: 0, loans: 0, income: 0, expense: 0, net: 0 };
}

/**
 * What an airport earns each hour: cargo for every industrial worker (their goods are
 * exported), fees for every resident (some of them travel), and tourist spending in
 * proportion to the shops and offices there are to spend it in.
 */
export const AIRPORT = { cargo: 0.6, passengers: 0.04, tourism: 0.14 };

/** Hourly tax per resident or worker at a 1% rate. */
const TAX_BASE = { r: 0.15, c: 0.26, i: 0.2 };

/**
 * What the city would earn and spend in an hour as it stands today. Called at each hour
 * end to settle the books, and by the HUD at any time to show a projection.
 */
export function projectBudget(
  buildings: ReadonlyArray<Building | null>,
  roads: RoadNetwork,
  tax: readonly number[],
  loans: readonly Loan[],
  stats: CityStats,
  out: BudgetReport,
  policies: Policies = {},
  metro?: MetroState,
): BudgetReport {
  let workersC = 0;
  let workersI = 0;
  let utilities = 0;
  let services = 0;
  let transit = 0;
  let airport = false;
  for (const b of buildings) {
    if (!b) continue;
    if (b.kind === FacilityKind.Airport && b.progress >= 1) airport = true;
    if (b.kind !== 0) {
      const spec = FACILITIES[b.kind]!;
      const line = spec.budget ?? (spec.service === Service.None ? 'utility' : 'service');
      if (line === 'utility') utilities += spec.upkeep;
      else if (line === 'transit') transit += spec.upkeep;
      else services += spec.upkeep;
      // Office jobs pay better than shop jobs, so they bring in more tax.
      if (spec.jobs) workersC += b.pop * (b.kind === FacilityKind.ItPark ? 1.8 : 1.2);
    } else if (zoneType(b.zone) === ZoneType.Commercial) {
      workersC += b.pop;
    } else if (zoneType(b.zone) === ZoneType.Industrial) {
      workersI += b.pop;
    }
  }
  let roadCost = 0;
  for (const e of roads.edges) if (e) roadCost += e.length * ROAD_SPECS[e.type].upkeep;
  let loanCost = 0;
  for (const l of loans) loanCost += l.payment;

  out.taxR = Math.round(stats.population * TAX_BASE.r * tax[1]!);
  out.taxC = Math.round(workersC * TAX_BASE.c * tax[2]!);
  out.taxI = Math.round(workersI * TAX_BASE.i * tax[3]!);
  out.roads = Math.round(roadCost);
  out.utilities = utilities;
  if (policies.flexHours) services += POLICY_COST.flexHours;
  out.services = services;
  out.transit = Math.round(transit + metroLength(metro) * METRO.upkeepPerMetre + (stats.buses ?? 0) * BUS.upkeepPerBus);
  out.fares = Math.round((stats.metroRiders ?? 0) * METRO.fare + (stats.busRiders ?? 0) * BUS.fare);
  out.loans = loanCost;
  out.airport = airport ? Math.round(workersI * AIRPORT.cargo + stats.population * AIRPORT.passengers + workersC * AIRPORT.tourism) : 0;
  out.income = out.taxR + out.taxC + out.taxI + out.fares + out.airport;
  out.expense = out.roads + out.utilities + out.services + out.transit + out.loans;
  out.net = out.income - out.expense;
  return out;
}
