import { BUS } from '../transit/bus';
import { METRO, metroLength, type MetroState } from '../transit/metro';
import { FacilityKind, FACILITIES, Service } from '../facilities';
import { ROAD_SPECS, type RoadNetwork } from '../roads/types';
import { ZoneType, zoneType, type Building } from '../zoning/zones';
import type { CityStats } from './economy';
import type { GameState } from '../state';

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
  /** Simple annual interest rate, before any risk premium. */
  rate: number;
  /** The bank lends this much only to a city of at least this many residents. */
  minPopulation: number;
}

export const LOAN_TIERS: readonly LoanTier[] = [
  { amount: 15000, hours: 36, rate: 0.09, minPopulation: 500 },
  { amount: 40000, hours: 48, rate: 0.11, minPopulation: 2500 },
  { amount: 100000, hours: 60, rate: 0.13, minPopulation: 8000 },
];

/** At most this share of the city's hourly income may go on loan repayments. */
export const DEBT_SERVICE_LIMIT = 0.35;
/** Each loan the city already holds adds this to the interest rate of the next. */
export const RISK_PREMIUM = 0.02;

export function loanPayment(t: LoanTier, rate = t.rate): number {
  return Math.round((t.amount * (1 + (rate * t.hours) / 12)) / t.hours);
}

/** What the bank looks at: the city's size and its hourly books as they stand. */
export interface CreditView {
  population: number;
  /** Hourly income before spending. */
  income: number;
  /** Hourly balance after spending, existing loan payments included. */
  net: number;
  loans: readonly Loan[];
}

export interface LoanOffer {
  ok: boolean;
  /** Why the bank says no (empty when it says yes). */
  reason: string;
  rate: number;
  payment: number;
}

/**
 * Whether the bank would lend tier `tier` to this city, and on what terms. The rules, in
 * the order the bank checks them: one loan of each size at a time; a minimum city size for
 * each size of loan; a city losing money each hour gets only the smallest loan; and all
 * repayments together, this one included, may take at most 35% of hourly income. Every
 * loan already held adds two points to the interest rate.
 */
export function loanOffer(tier: number, city: CreditView): LoanOffer {
  const t = LOAN_TIERS[tier];
  if (!t) return { ok: false, reason: 'No such loan', rate: 0, payment: 0 };
  const rate = t.rate + RISK_PREMIUM * city.loans.length;
  const payment = loanPayment(t, rate);
  const no = (reason: string): LoanOffer => ({ ok: false, reason, rate, payment });
  if (city.loans.some((l) => l.tier === tier)) return no('Already borrowed: repay it first');
  if (city.population < t.minPopulation) {
    return no(`For cities of ${t.minPopulation.toLocaleString('en-US')} residents or more (you have ${Math.floor(city.population).toLocaleString('en-US')})`);
  }
  if (city.net < 0 && tier > 0) return no('The city loses money every hour: only the smallest loan is offered');
  let repaying = payment;
  for (const l of city.loans) repaying += l.payment;
  const limit = city.income * DEBT_SERVICE_LIMIT;
  if (repaying > limit) {
    const share = city.income > 0 ? Math.round((repaying / city.income) * 100) : null;
    return no(
      share === null
        ? 'The city has no income to repay from yet'
        : `Repayments would take ${share}% of hourly income; the bank allows ${Math.round(DEBT_SERVICE_LIMIT * 100)}%`,
    );
  }
  return { ok: true, reason: '', rate, payment };
}

/** The bank's view of a city as it stands now (or with `loans` in place of its own). */
export function creditView(s: Pick<GameState, 'buildings' | 'roads' | 'tax' | 'loans' | 'stats' | 'policies' | 'metro'>, loans: readonly Loan[] = s.loans): CreditView {
  const b = projectBudget(s.buildings, s.roads, s.tax, loans, s.stats, emptyReport(), s.policies, s.metro);
  return { population: s.stats.population, income: b.income, net: b.net, loans };
}

/**
 * The loans the bank would grant if the city took them one after another, smallest first
 * (each one taken makes the next harder to get). What the council plans with.
 */
export function loansAvailable(s: Pick<GameState, 'buildings' | 'roads' | 'tax' | 'loans' | 'stats' | 'policies' | 'metro'>): { tier: number; amount: number; payment: number }[] {
  const loans: Loan[] = [...s.loans];
  const out: { tier: number; amount: number; payment: number }[] = [];
  LOAN_TIERS.forEach((t, tier) => {
    const offer = loanOffer(tier, creditView(s, loans));
    if (!offer.ok) return;
    out.push({ tier, amount: t.amount, payment: offer.payment });
    loans.push({ tier, payment: offer.payment, hoursLeft: t.hours });
  });
  return out;
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
