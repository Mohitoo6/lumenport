import { CELL } from '../../core/constants';
import { emptyReport, projectBudget } from '../../sim/economy/budget';
import { FacilityKind, Service } from '../../sim/facilities';
import type { Sim } from '../../sim/sim';
import { homesAbove, uncovered } from './briefs';
import type { CityIssue } from './issues';
import { MINISTERS, type MinistryId } from './ministries';
import type { CouncilOption } from './options';

/**
 * Department triage. Before anyone speaks, every ministry scores how urgent this trigger
 * is for its own portfolio, in code, from two things: how much the issue and the options
 * on the table touch that portfolio (exposure), and how strained the department already is
 * by its own figures (stress). The lead and the highest scorers are seated; the rest stay
 * on standby and cost nothing. Each score keeps the signals that produced it, so the
 * choice of who is in the room can be inspected rather than taken on trust.
 */

export interface Seat {
  id: MinistryId;
  /** Why this minister was called in: shown to them, so they speak to it. */
  reason: string;
}

export interface TriageSignal {
  label: string;
  /** Points out of 5 this signal contributes to exposure. */
  weight: number;
}

export interface TriageEntry {
  ministry: MinistryId;
  /** 0..1: the score the seating is decided on. */
  urgency: number;
  /** 0..1: how much this issue and its options touch the portfolio. */
  exposure: number;
  /** 0..1: how strained the department already is, from its own figures. */
  stress: number;
  /** The department's own headline figure behind `stress`. */
  kpi: string;
  role: 'lead' | 'seated' | 'standby';
  reason: string;
  signals: TriageSignal[];
}

/** The lead plus three: enough for a real disagreement, few enough for a free tier. */
export const MAX_SEATS = 4;
/** Below this a ministry is not called in even when a seat is free. */
export const SEAT_THRESHOLD = 0.25;

const clamp01 = (v: number): number => Math.max(0, Math.min(1, v));
const pct = (v: number): string => `${Math.round(v * 100)}%`;

/** Each department's own strain, 0..1, with the figure it comes from. */
export function departmentStress(sim: Sim): Record<MinistryId, { stress: number; kpi: string }> {
  const s = sim.state;
  const st = s.stats;
  const pop = Math.max(1, st.population);
  const labor = st.population * 0.55;
  const unemployment = labor > 0 ? Math.max(0, 1 - st.employed / labor) : 0;
  const power = st.powerSupply > 0 ? st.powerDemand / st.powerSupply : 0;
  const water = st.waterSupply > 0 ? st.waterDemand / st.waterSupply : 0;
  const polluted = homesAbove(sim, sim.fields.pollution, 0.3) / pop;
  const noClinic = uncovered(sim, Service.Health);
  const noSchool = uncovered(sim, Service.Education);
  const noPolice = uncovered(sim, Service.Police);
  // Today's projection, not last month's books: the same figure every agent is shown.
  const net = projectBudget(s.buildings, s.roads, s.tax, s.loans, st, emptyReport(), s.policies, s.metro).net;
  const runway = net < 0 ? s.funds / -net : Infinity;
  const demand = Math.max(st.demand[1], st.demand[2], st.demand[3]);
  return {
    roads: { stress: clamp01(st.congestion * 1.5), kpi: `${pct(st.congestion)} of speed lost to queues` },
    energy: { stress: s.sandbox ? 0 : clamp01((Math.max(power, water) - 0.7) / 0.3), kpi: `power ${pct(power)} used, water ${pct(water)} used` },
    health: { stress: clamp01(noClinic), kpi: `${pct(noClinic)} of residents without a clinic` },
    safety: { stress: clamp01(noPolice), kpi: `${pct(noPolice)} of residents without police cover` },
    education: { stress: clamp01(noSchool), kpi: `${pct(noSchool)} of residents without a school` },
    environment: { stress: clamp01(polluted * 2), kpi: `${pct(polluted)} of residents in polluted air` },
    finance: { stress: s.sandbox ? 0 : net < 0 ? clamp01(1 - runway / 18) : s.funds < 10000 ? 0.4 : 0, kpi: net < 0 ? `losing $${Math.round(-net).toLocaleString('en-US')} a month` : `monthly balance +$${Math.round(net).toLocaleString('en-US')}` },
    planning: { stress: clamp01(demand), kpi: `unmet demand ${Math.round(demand * 100)} of 100` },
    welfare: { stress: clamp01((0.6 - st.happiness) / 0.6 + unemployment * 0.5), kpi: `happiness ${pct(st.happiness)}, unemployment ${pct(unemployment)}` },
  };
}

function nearest(sim: Sim, kind: FacilityKind, issue: CityIssue): number {
  let best = Infinity;
  for (const b of sim.state.buildings) {
    if (!b || b.kind !== kind || b.progress < 1) continue;
    best = Math.min(best, Math.hypot((b.x + b.w / 2) * CELL - issue.x, (b.y + b.h / 2) * CELL - issue.z));
  }
  return best;
}

/** Scores all nine ministries for one issue. Lead first, then by urgency. */
export function triage(sim: Sim, issue: CityIssue, options: readonly CouncilOption[], max = MAX_SEATS): TriageEntry[] {
  const any = (f: (o: CouncilOption) => boolean): CouncilOption[] => options.filter(f);
  const ids = (list: CouncilOption[]): string => list.map((o) => o.id).join(', ');
  const signals = new Map<MinistryId, TriageSignal[]>();
  const add = (id: MinistryId, weight: number, label: string): void => {
    if (id === issue.lead || weight <= 0) return;
    const list = signals.get(id) ?? [];
    list.push({ label, weight: Math.round(weight * 10) / 10 });
    signals.set(id, list);
  };

  const costly = any((o) => o.cost > 0 || o.monthly > 0);
  if (costly.length) add('finance', 2 + Math.min(3, (Math.max(...costly.map((o) => o.cost)) / Math.max(1, sim.state.funds)) * 10), `options ${ids(costly)} cost money`);
  const unaffordable = any((o) => o.feasibility.status === 'unaffordable' || o.feasibility.status === 'needs_loan');
  if (unaffordable.length) add('finance', 5, `options ${ids(unaffordable)} cost more than the treasury holds`);
  if (issue.kind === 'budget') add('welfare', 3, 'tax rises fall on residents');

  const nearClinic = any((o) => o.impact.clinicM < 300);
  if (nearClinic.length) add('health', 4, `options ${ids(nearClinic)} bring traffic or pollution near a clinic`);
  if (issue.kind === 'pollution') add('health', 4, 'residents are breathing polluted air');
  const pollutes = any((o) => o.impact.pollutes);
  if (pollutes.length) {
    add('health', 3.5, `options ${ids(pollutes)} add a polluter near homes`);
    add('environment', 5, `options ${ids(pollutes)} add a polluter near homes`);
  }
  const nearSchool = any((o) => o.impact.schoolM < 250);
  if (nearSchool.length) add('education', 4, `options ${ids(nearSchool)} bring traffic or pollution near a school`);

  const displaced = any((o) => o.effects.residentsDisplaced > 0 || o.effects.jobsLost > 0);
  if (displaced.length) {
    add('welfare', 4.5, `options ${ids(displaced)} demolish homes or workplaces`);
    add('planning', 4, `options ${ids(displaced)} demolish buildings`);
  }
  const zoning = any((o) => o.impact.zoning);
  if (zoning.length) add('planning', 3, `options ${ids(zoning)} change land use`);
  const trees = any((o) => o.impact.treesCleared > 5);
  if (trees.length) add('environment', 2.5, `options ${ids(trees)} clear trees`);
  const green = any((o) => o.impact.green);
  if (green.length) add('environment', 2, `options ${ids(green)} are green options`);
  const cut = any((o) => o.effects.powerSupplyDelta < 0);
  if (cut.length) add('energy', 5, `options ${ids(cut)} cut power supply`);
  const tax = any((o) => o.effects.taxRateDelta.some((d) => d !== 0));
  if (tax.length) add('planning', 2.5, 'tax changes slow growth');

  if (issue.kind === 'traffic' && issue.edge !== undefined) {
    const emergency = Math.min(...[FacilityKind.FireStation, FacilityKind.Police, FacilityKind.Clinic].map((k) => nearest(sim, k, issue)));
    if (emergency < 450) add('safety', 3.5, 'emergency vehicles use this road');
    add('environment', 1.5, 'queuing traffic adds fumes');
  }
  if (issue.kind === 'jobs' || issue.kind === 'housing') {
    add('welfare', 3, 'jobs and homes for residents');
    if (zoning.length) add('roads', 1.8, 'new districts add traffic');
  }
  if (issue.kind === 'health' || issue.kind === 'education' || issue.kind === 'crime' || issue.kind === 'fire') add('welfare', 2.2, 'residents’ wellbeing');
  if (issue.kind === 'power' || issue.kind === 'water') add('planning', 1.5, 'shortages stop growth');

  const stress = departmentStress(sim);
  const entries: TriageEntry[] = MINISTERS.map((m) => {
    const list = (signals.get(m.id) ?? []).sort((a, b) => b.weight - a.weight);
    const top = list[0];
    const exposure = m.id === issue.lead ? 1 : clamp01((top?.weight ?? 0) / 5);
    const st = stress[m.id];
    const urgency = m.id === issue.lead ? clamp01(0.5 + 0.5 * issue.severity) : exposure > 0 ? clamp01(0.75 * exposure + 0.25 * st.stress) : 0;
    return {
      ministry: m.id,
      urgency: Math.round(urgency * 100) / 100,
      exposure: Math.round(exposure * 100) / 100,
      stress: Math.round(st.stress * 100) / 100,
      kpi: st.kpi,
      role: m.id === issue.lead ? 'lead' : 'standby',
      reason: m.id === issue.lead ? 'it is your portfolio and you raised it' : (top?.label ?? 'not affected by this issue'),
      signals: m.id === issue.lead ? [{ label: `raised the issue (severity ${pct(issue.severity)})`, weight: 5 }] : list,
    };
  });
  entries.sort((a, b) => Number(b.role === 'lead') - Number(a.role === 'lead') || b.urgency - a.urgency);
  let seated = 1;
  for (const e of entries) {
    if (e.role === 'lead' || seated >= max || e.exposure <= 0 || e.urgency < SEAT_THRESHOLD) continue;
    e.role = 'seated';
    seated++;
  }
  return entries;
}

export function seatsOf(entries: readonly TriageEntry[]): Seat[] {
  return entries.filter((e) => e.role !== 'standby').map((e) => ({ id: e.ministry, reason: e.reason }));
}

/** Who comes to the meeting: the lead, then the ministries with the most at stake. */
export function attendees(sim: Sim, issue: CityIssue, options: readonly CouncilOption[], max = MAX_SEATS): Seat[] {
  return seatsOf(triage(sim, issue, options, max));
}
