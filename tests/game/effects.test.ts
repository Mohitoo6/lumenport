import { beforeAll, describe, expect, it } from 'vitest';
import { execute, feasibility, fiscalLimits, forkSim, project, snapshot } from '../../src/game/council/effects';
import { detectIssues, type CityIssue } from '../../src/game/council/issues';
import { optionsFor, type CouncilOption } from '../../src/game/council/options';
import { LOAN_TIERS, emptyReport, projectBudget } from '../../src/sim/economy/budget';
import type { Sim } from '../../src/sim/sim';
import { grownTown, jamWithDemolition, runTicks } from './town';

let sim: Sim;
let table: Array<{ issue: CityIssue; options: CouncilOption[] }>;

beforeAll(() => {
  sim = grownTown(150);
  sim.traffic.hour = 18;
  runTicks(sim, 1500);
  const t0 = performance.now();
  table = detectIssues(sim).map((issue) => ({ issue, options: optionsFor(sim, issue) }));
  console.log(`options for ${table.length} issues measured on forks in ${(performance.now() - t0).toFixed(0)} ms`);
});

describe('option effect payloads', () => {
  it('measures every option on a fork without touching the city', () => {
    const before = JSON.stringify(snapshot(sim));
    const all = table.flatMap((t) => optionsFor(sim, t.issue));
    expect(all.length).toBeGreaterThan(6);
    expect(JSON.stringify(snapshot(sim))).toBe(before);
  });

  it('is the single source of the money figures on the option', () => {
    for (const { issue, options } of table) {
      for (const o of options) {
        const label = `${issue.kind} ${o.id} ${o.title}`;
        expect(-o.effects.budgetDelta + 0, `${label}: upfront`).toBe(o.cost + 0);
        expect(-o.effects.hourlyNetDelta + 0, `${label}: hourly`).toBe(o.hourly + 0);
        expect(o.effects.residentsDisplaced, `${label}: residents`).toBe(o.impact.displacedResidents);
      }
    }
  });

  it('counts the tax lost from demolished buildings, which a per-option estimate would miss', () => {
    const demolishing = optionsFor(sim, jamWithDemolition(sim)).filter((o) => o.effects.jobsLost > 0 || o.effects.residentsDisplaced > 0);
    expect(demolishing.length).toBeGreaterThan(0);
    for (const o of demolishing) expect(o.facts.join(' ')).toMatch(/tax lost/);
  });

  it('projects the same hourly balance as the budget panel for an untouched city', () => {
    const s = sim.state;
    const hud = projectBudget(s.buildings, s.roads, s.tax, s.loans, s.stats, emptyReport(), s.policies, s.metro).net;
    expect(snapshot(sim).hourlyNet).toBe(hud);
  });

  it('gives "take no action" an empty payload and keeps it last', () => {
    for (const { options } of table) {
      const last = options[options.length - 1]!;
      expect(last.actions).toEqual([]);
      expect(last.effects.budgetDelta).toBe(0);
      expect(last.feasibility.status).toBe('ok');
    }
  });

  it('reports tax, debt and supply changes from the game rules', () => {
    const fork = forkSim(sim);
    fork.state.loans = [];
    const loan = project(fork, [{ type: 'takeLoan', tier: 1 }]);
    expect(loan.ok && loan.delta.budgetDelta).toBe(LOAN_TIERS[1]!.amount);
    expect(loan.ok && loan.delta.debtDelta).toBeGreaterThan(LOAN_TIERS[1]!.amount);
    expect(loan.ok && loan.delta.hourlyNetDelta).toBeLessThan(0);
    const tax = project(fork, [{ type: 'setTax', zone: 1, rate: fork.state.tax[1] + 2 }], { withApproval: true, baseline: snapshot(forkSim(fork), true) });
    expect(tax.ok && tax.delta.taxRateDelta).toEqual([2, 0, 0]);
    expect(tax.ok && tax.delta.hourlyNetDelta).toBeGreaterThan(0);
    // Higher taxes make residents less happy: the approval projection has to show it.
    expect(tax.ok && tax.delta.approvalDelta).toBeLessThan(0);
    const flex = project(fork, [{ type: 'setPolicy', policy: 'flexHours', on: true }]);
    expect(flex.ok && flex.delta.trafficImpact.rushPeakFactor).toBeLessThan(0.8);
  });
});

describe('hard money rules', () => {
  it('separates affordable, loan-dependent and impossible spending', () => {
    const fork = forkSim(sim);
    fork.state.loans = [{ tier: 0, payment: 900, hoursLeft: 10 }];
    fork.state.funds = 5000;
    const limits = fiscalLimits(fork);
    expect(limits.loanHeadroom).toBe(LOAN_TIERS[1]!.amount + LOAN_TIERS[2]!.amount);
    expect(limits.spendCeiling).toBe(5000 + limits.loanHeadroom);
    const spend = (cost: number) => feasibility(limits, { ok: true, delta: { ...project(fork, []).ok && { budgetDelta: -cost } } as never });
    expect(spend(4000).status).toBe('ok');
    expect(spend(9000).status).toBe('needs_loan');
    expect(spend(9000).shortfall).toBe(4000);
    expect(spend(limits.spendCeiling + 1).status).toBe('unaffordable');
    expect(feasibility(limits, { ok: false, reason: 'In the way', failedAt: 0 }).status).toBe('blocked');
  });
});

describe('transactional execution', () => {
  it('commits an option and the city changes exactly as the payload said', () => {
    const { options } = table.find((t) => t.options.some((o) => o.actions.length > 0 && o.cost > 0))!;
    const option = options.find((o) => o.actions.length > 0 && o.cost > 0)!;
    const city = forkSim(sim);
    city.state.funds = 500_000;
    const funds = city.state.funds;
    const report = execute(city, option.actions);
    expect(report.ok).toBe(true);
    expect(report.stage).toBe('done');
    expect(report.drift).toEqual([]);
    expect(city.state.funds).toBe(funds + option.effects.budgetDelta);
    expect(report.observed!.budgetDelta).toBe(option.effects.budgetDelta);
  });

  it('refuses in the pre-flight and leaves the city untouched when a command would fail', () => {
    const { options } = table.find((t) => t.options.some((o) => o.actions.length > 0 && o.cost > 0))!;
    const option = options.find((o) => o.actions.length > 0 && o.cost > 0)!;
    const city = forkSim(sim);
    city.state.funds = 0;
    const before = JSON.stringify(snapshot(city));
    // A tax change that would succeed, followed by a build the city cannot pay for.
    const report = execute(city, [{ type: 'setTax', zone: 1, rate: 15 }, ...option.actions]);
    expect(report.ok).toBe(false);
    expect(report.stage).toBe('preflight');
    expect(report.reason).toMatch(/money/i);
    expect(JSON.stringify(snapshot(city))).toBe(before);
  });
});
