import type { Command } from '../../sim/commands';
import { LOAN_TIERS, creditView, emptyReport, loanOffer, loansAvailable, projectBudget } from '../../sim/economy/budget';
import { FACILITIES } from '../../sim/facilities';
import { cloneState } from '../../sim/save/serialize';
import { Sim } from '../../sim/sim';
import { rushFactor } from '../../sim/traffic/traffic';
import { ZoneType, zoneType } from '../../sim/zoning/zones';

/**
 * The state-mutation payload of a council option, and the machinery that makes it
 * trustworthy.
 *
 * An option is a list of ordinary game commands. Nothing here guesses what those commands
 * will do: the payload is *measured* by running them on a fork (a deep copy of the world)
 * and diffing the fork against the original. The same fork run is the pre-flight before
 * the mayor's approval is committed, and after the commit the real city is diffed again
 * and reconciled with what was promised. So a number on an option card is never the
 * model's claim; it is the simulation's own answer.
 */
export interface StateDelta {
  /** Treasury change the moment the option is approved (negative = money spent). */
  budgetDelta: number;
  /** Change to the projected hourly balance (negative = the city is worse off each hour). */
  hourlyNetDelta: number;
  /** Tax change in percentage points: homes, shops, industry. */
  taxRateDelta: [number, number, number];
  /** New debt to repay, interest included. */
  debtDelta: number;
  /** Installed power (MW) and water (units) added or removed. */
  powerSupplyDelta: number;
  waterSupplyDelta: number;
  /** People who lose their home, jobs that disappear, buildings pulled down. */
  residentsDisplaced: number;
  jobsLost: number;
  buildingsDemolished: number;
  /** Metres of road added. */
  roadLengthDelta: number;
  trafficImpact: {
    /** Extra vehicles the network can hold before it jams. */
    capacityDelta: number;
    /** Rush-hour demand as a share of today's peak (1 = unchanged). */
    rushPeakFactor: number;
    /** Residents who would switch from the car to the bus or metro. */
    transitRidersDelta: number;
  };
  /**
   * Change in city happiness, in points out of 100, once anything the option builds is
   * finished. Happiness is the city's approval measure. This one is a projection: the
   * game's happiness model re-run on the fork, with everything else held still.
   */
  approvalDelta: number;
}

/** Cars per 100 m at which each road type jams (street, avenue). */
const JAM_PER_100M: Record<number, number> = { 0: 7, 1: 11 };

/** The scalar facts of a world that an option can change. */
export interface Snapshot {
  funds: number;
  hourlyNet: number;
  tax: [number, number, number];
  debt: number;
  power: number;
  water: number;
  residents: number;
  jobs: number;
  buildings: number;
  roadLength: number;
  roadCapacity: number;
  flexHours: boolean;
  /** 0..100, or null when the data layers were not refreshed for this snapshot. */
  happiness: number | null;
  /** Bus and metro riders, or null when the data layers were not refreshed. */
  riders: number | null;
}

/** Reads the scalar state. `withHappiness` re-runs the data layers first (slower). */
export function snapshot(sim: Sim, withHappiness = false): Snapshot {
  const s = sim.state;
  let power = 0;
  let water = 0;
  let residents = 0;
  let jobs = 0;
  let buildings = 0;
  for (const b of s.buildings) {
    if (!b) continue;
    if (b.kind !== 0) {
      const spec = FACILITIES[b.kind];
      power += spec?.power ?? 0;
      water += spec?.water ?? 0;
      if (spec?.jobs) jobs += b.pop;
      continue;
    }
    buildings++;
    if (zoneType(b.zone) === ZoneType.Residential) residents += b.pop;
    else jobs += b.pop;
  }
  let roadLength = 0;
  let roadCapacity = 0;
  for (const e of s.roads.edges) {
    if (!e) continue;
    roadLength += e.length;
    roadCapacity += (e.length / 100) * (JAM_PER_100M[e.type] ?? 7);
  }
  let debt = 0;
  for (const l of s.loans) debt += l.payment * l.hoursLeft;
  if (withHappiness) {
    sim.refreshUtilities();
    sim.refreshFields();
  }
  return {
    funds: s.funds,
    // Taxed on the people actually housed, so residents who lose their home stop counting
    // at once (the city's own population figure only catches up at the next day's census).
    hourlyNet: projectBudget(s.buildings, s.roads, s.tax, s.loans, { ...s.stats, population: Math.min(s.stats.population, residents) }, emptyReport(), s.policies, s.metro).net,
    tax: [s.tax[1], s.tax[2], s.tax[3]],
    debt,
    power,
    water,
    residents,
    jobs,
    buildings,
    roadLength,
    roadCapacity,
    flexHours: s.policies?.flexHours === true,
    happiness: withHappiness ? s.stats.happiness * 100 : null,
    riders: withHappiness ? (s.stats.metroRiders ?? 0) + (s.stats.busRiders ?? 0) : null,
  };
}

const round1 = (v: number): number => Math.round(v * 10) / 10;

/** What changed between two snapshots, as an option payload. */
export function diff(before: Snapshot, after: Snapshot): StateDelta {
  const flexOn = !before.flexHours && after.flexHours;
  const flexOff = before.flexHours && !after.flexHours;
  // The share of today's 18:00 peak that staggered hours leave, from the traffic model itself.
  const flexFactor = rushFactor(18, true) / rushFactor(18);
  return {
    budgetDelta: Math.round(after.funds - before.funds),
    hourlyNetDelta: Math.round(after.hourlyNet - before.hourlyNet),
    taxRateDelta: [after.tax[0] - before.tax[0], after.tax[1] - before.tax[1], after.tax[2] - before.tax[2]],
    debtDelta: Math.round(after.debt - before.debt),
    powerSupplyDelta: round1(after.power - before.power),
    waterSupplyDelta: Math.round(after.water - before.water),
    residentsDisplaced: Math.max(0, before.residents - after.residents),
    jobsLost: Math.max(0, before.jobs - after.jobs),
    buildingsDemolished: Math.max(0, before.buildings - after.buildings),
    roadLengthDelta: Math.round(after.roadLength - before.roadLength),
    trafficImpact: {
      capacityDelta: Math.round(after.roadCapacity - before.roadCapacity),
      rushPeakFactor: flexOn ? Math.round(flexFactor * 100) / 100 : flexOff ? Math.round((1 / flexFactor) * 100) / 100 : 1,
      transitRidersDelta: before.riders !== null && after.riders !== null ? Math.round(after.riders - before.riders) : 0,
    },
    approvalDelta: before.happiness !== null && after.happiness !== null ? round1(after.happiness - before.happiness) : 0,
  };
}

export const NO_DELTA: StateDelta = {
  budgetDelta: 0,
  hourlyNetDelta: 0,
  taxRateDelta: [0, 0, 0],
  debtDelta: 0,
  powerSupplyDelta: 0,
  waterSupplyDelta: 0,
  residentsDisplaced: 0,
  jobsLost: 0,
  buildingsDemolished: 0,
  roadLengthDelta: 0,
  trafficImpact: { capacityDelta: 0, rushPeakFactor: 1, transitRidersDelta: 0 },
  approvalDelta: 0,
};

/** A private copy of the world. Whatever is done to it, the real city never knows. */
export function forkSim(sim: Sim): Sim {
  return new Sim(cloneState(sim.state));
}

export type Projection = { ok: true; delta: StateDelta } | { ok: false; reason: string; failedAt: number };

/**
 * Runs an option's commands on a fork and measures the result.
 *
 * `unlimitedFunds` separates "the game refuses this" from "the city cannot pay for this":
 * the fork is given money so the commands run, and affordability is judged afterwards
 * against the real treasury (see `feasibility`). `baseline` lets several options share one
 * measurement of the untouched city.
 */
export function project(sim: Sim, actions: readonly Command[], opts: { unlimitedFunds?: boolean; withApproval?: boolean; baseline?: Snapshot } = {}): Projection {
  if (actions.length === 0) return { ok: true, delta: { ...NO_DELTA, taxRateDelta: [0, 0, 0], trafficImpact: { ...NO_DELTA.trafficImpact } } };
  const fork = forkSim(sim);
  if (opts.unlimitedFunds) fork.state.funds += 1e9;
  const before = opts.baseline && !opts.unlimitedFunds ? opts.baseline : snapshot(fork, false);
  const known = fork.state.buildings.length;
  for (let i = 0; i < actions.length; i++) {
    const r = fork.apply(actions[i]!);
    if (!r.ok) return { ok: false, reason: r.reason ?? 'refused', failedAt: i };
  }
  let happinessBefore: number | null = null;
  let ridersBefore: number | null = null;
  if (opts.withApproval) {
    happinessBefore = opts.baseline?.happiness ?? null;
    ridersBefore = opts.baseline?.riders ?? null;
    // "Once built": what the option adds counts as finished for the projection.
    for (let id = known; id < fork.state.buildings.length; id++) {
      const b = fork.state.buildings[id];
      if (b && b.kind !== 0) b.progress = 1;
    }
    // New stops join a bus line when the network is next refreshed.
    fork.refreshUtilities();
    // The city's census runs once a day. Bring it up to date on the fork, so people who
    // lost a home or a job count as such when happiness is recomputed.
    const now = snapshot(fork, false);
    const st = fork.state.stats;
    st.population = Math.max(0, st.population - Math.max(0, before.residents - now.residents));
    st.employed = Math.max(0, st.employed - Math.max(0, before.jobs - now.jobs));
  }
  const after = snapshot(fork, opts.withApproval === true);
  return { ok: true, delta: diff({ ...before, happiness: happinessBefore, riders: ridersBefore }, after) };
}

/** The same world, untouched, measured the way `project` measures: the shared baseline. */
export function baselineOf(sim: Sim, withApproval: boolean): Snapshot {
  return snapshot(forkSim(sim), withApproval);
}

// ---------------------------------------------------------------------------------------
// Hard money rules

/** The city's money limits, straight from the game's rules. Every agent is shown these. */
export interface FiscalLimits {
  sandbox: boolean;
  treasury: number;
  hourlyNet: number;
  /** Money the city could still borrow: the loans the bank would grant, one after another. */
  loanHeadroom: number;
  /** The most that could be spent today: treasury plus every loan still available. */
  spendCeiling: number;
  /** Hours until the treasury is empty at the current hourly loss; null when not losing money. */
  runwayHours: number | null;
}

export function fiscalLimits(sim: Sim): FiscalLimits {
  const s = sim.state;
  const net = projectBudget(s.buildings, s.roads, s.tax, s.loans, s.stats, emptyReport(), s.policies, s.metro).net;
  let headroom = 0;
  for (const l of loansAvailable(s)) headroom += l.amount;
  return {
    sandbox: s.sandbox,
    treasury: Math.floor(s.funds),
    hourlyNet: net,
    loanHeadroom: headroom,
    spendCeiling: s.sandbox ? Infinity : Math.floor(s.funds) + headroom,
    runwayHours: net < 0 && !s.sandbox ? Math.max(0, Math.floor(s.funds / -net)) : null,
  };
}

export interface Feasibility {
  /**
   * ok: can be approved now. needs_loan: costs more than the treasury but less than the
   * treasury plus available loans. unaffordable: beyond even that. blocked: the game
   * refuses the commands (the city changed, or the plan is invalid).
   */
  status: 'ok' | 'needs_loan' | 'unaffordable' | 'blocked';
  /** Money missing from the treasury. */
  shortfall: number;
  reason: string;
}

const usd = (n: number): string => `$${Math.abs(Math.round(n)).toLocaleString('en-US')}`;

export function feasibility(limits: FiscalLimits, projection: Projection): Feasibility {
  if (!projection.ok) return { status: 'blocked', shortfall: 0, reason: `The game refuses this plan: ${projection.reason}.` };
  const spend = Math.max(0, -projection.delta.budgetDelta);
  if (limits.sandbox || spend <= limits.treasury) return { status: 'ok', shortfall: 0, reason: '' };
  const shortfall = spend - limits.treasury;
  if (spend <= limits.spendCeiling) {
    return { status: 'needs_loan', shortfall, reason: `Costs ${usd(spend)}; the treasury holds ${usd(limits.treasury)}. A loan would have to cover ${usd(shortfall)} first.` };
  }
  return { status: 'unaffordable', shortfall, reason: `Costs ${usd(spend)}: more than the treasury (${usd(limits.treasury)}) plus every loan still available (${usd(limits.loanHeadroom)}).` };
}

/**
 * The smallest set of loans still available that covers a shortfall, as commands to run
 * before the option itself. Null when no combination is enough.
 */
export function financing(sim: Sim, shortfall: number): { tiers: number[]; amount: number } | null {
  const free = loansAvailable(sim.state);
  // One loan the bank would grant on its own, if one is big enough.
  const single = LOAN_TIERS.findIndex((t, tier) => t.amount >= shortfall && loanOffer(tier, creditView(sim.state)).ok);
  if (single >= 0) return { tiers: [single], amount: LOAN_TIERS[single]!.amount };
  const tiers: number[] = [];
  let amount = 0;
  for (const t of free) {
    tiers.push(t.tier);
    amount += t.amount;
    if (amount >= shortfall) return { tiers, amount };
  }
  return null;
}

// ---------------------------------------------------------------------------------------
// Execution: pre-flight, commit, reconcile

/** One payload field where the city did not do what the option card promised. */
export interface Drift {
  field: string;
  projected: number;
  observed: number;
}

export interface ExecutionReport {
  ok: boolean;
  /** Where it stopped: nothing was changed if the pre-flight failed. */
  stage: 'preflight' | 'commit' | 'done';
  reason?: string;
  spent: number;
  projected?: StateDelta;
  observed?: StateDelta;
  drift: Drift[];
}

/** The payload fields that take effect at once, and so can be checked after the commit. */
const IMMEDIATE: Array<[string, (d: StateDelta) => number]> = [
  ['budgetDelta', (d) => d.budgetDelta],
  ['hourlyNetDelta', (d) => d.hourlyNetDelta],
  ['taxRateDelta.homes', (d) => d.taxRateDelta[0]],
  ['taxRateDelta.shops', (d) => d.taxRateDelta[1]],
  ['taxRateDelta.industry', (d) => d.taxRateDelta[2]],
  ['debtDelta', (d) => d.debtDelta],
  ['powerSupplyDelta', (d) => d.powerSupplyDelta],
  ['waterSupplyDelta', (d) => d.waterSupplyDelta],
  ['residentsDisplaced', (d) => d.residentsDisplaced],
  ['jobsLost', (d) => d.jobsLost],
  ['roadLengthDelta', (d) => d.roadLengthDelta],
  ['trafficImpact.capacityDelta', (d) => d.trafficImpact.capacityDelta],
];

export function reconcile(projected: StateDelta, observed: StateDelta): Drift[] {
  const out: Drift[] = [];
  for (const [field, get] of IMMEDIATE) {
    const p = get(projected);
    const o = get(observed);
    if (Math.abs(p - o) > Math.max(1, Math.abs(p) * 0.001)) out.push({ field, projected: p, observed: o });
  }
  return out;
}

/**
 * Carries out an option as one transaction. The commands are first run on a fork with the
 * real treasury; if any is refused there, the city is not touched at all. Only then are
 * they applied for real, and the city is measured before and after so the result can be
 * compared with the payload the mayor was shown.
 */
export function execute(sim: Sim, actions: readonly Command[]): ExecutionReport {
  if (actions.length === 0) return { ok: true, stage: 'done', spent: 0, projected: { ...NO_DELTA }, observed: { ...NO_DELTA }, drift: [] };
  const pre = project(sim, actions);
  if (!pre.ok) return { ok: false, stage: 'preflight', reason: pre.reason, spent: 0, drift: [] };
  const before = snapshot(sim);
  let spent = 0;
  for (const action of actions) {
    const r = sim.apply(action);
    // The fork accepted this exact sequence on an identical world, so a refusal here means
    // the simulation is not deterministic. Report it loudly rather than hide it.
    if (!r.ok) return { ok: false, stage: 'commit', reason: r.reason ?? 'refused', spent, projected: pre.delta, drift: [] };
    spent += r.cost ?? 0;
  }
  const observed = diff(before, snapshot(sim));
  return { ok: true, stage: 'done', spent, projected: pre.delta, observed, drift: reconcile(pre.delta, observed) };
}
