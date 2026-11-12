import { FACILITIES, Service } from '../facilities';
import { ROAD_SPECS, type RoadNetwork } from '../roads/types';
import { ZoneType, zoneType, type Building } from '../zoning/zones';
import type { CityStats } from './economy';

export interface Policies {
  /** Staggered office hours: flattens the morning and evening rush. */
  flexHours?: boolean;
}

/** Monthly cost of each policy while it is in force. */
export const POLICY_COST: Record<keyof Policies, number> = { flexHours: 350 };

export interface Loan {
  tier: number;
  /** Fixed monthly payment (principal plus interest). */
  payment: number;
  monthsLeft: number;
}

export interface LoanTier {
  amount: number;
  months: number;
  /** Simple annual interest rate. */
  rate: number;
}

export const LOAN_TIERS: readonly LoanTier[] = [
  { amount: 20000, months: 24, rate: 0.06 },
  { amount: 50000, months: 36, rate: 0.08 },
  { amount: 120000, months: 48, rate: 0.1 },
];

export function loanPayment(t: LoanTier): number {
  return Math.round((t.amount * (1 + (t.rate * t.months) / 12)) / t.months);
}

/** One month's money in and out. */
export interface BudgetReport {
  taxR: number;
  taxC: number;
  taxI: number;
  roads: number;
  utilities: number;
  services: number;
  loans: number;
  income: number;
  expense: number;
  net: number;
}

export function emptyReport(): BudgetReport {
  return { taxR: 0, taxC: 0, taxI: 0, roads: 0, utilities: 0, services: 0, loans: 0, income: 0, expense: 0, net: 0 };
}

/** Monthly tax per resident or worker at a 1% rate. */
const TAX_BASE = { r: 0.15, c: 0.26, i: 0.2 };

/**
 * What the city would earn and spend in a month as it stands today. Called at each month
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
): BudgetReport {
  let workersC = 0;
  let workersI = 0;
  let utilities = 0;
  let services = 0;
  for (const b of buildings) {
    if (!b) continue;
    if (b.kind !== 0) {
      const spec = FACILITIES[b.kind]!;
      if (spec.service === Service.None) utilities += spec.upkeep;
      else services += spec.upkeep;
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
  out.loans = loanCost;
  out.income = out.taxR + out.taxC + out.taxI;
  out.expense = out.roads + out.utilities + out.services + out.loans;
  out.net = out.income - out.expense;
  return out;
}
