import { describe, expect, it } from 'vitest';
import { CELL, TICKS_PER_HOUR } from '../../src/core/constants';
import { forkSim } from '../../src/game/council/effects';
import { AIRPORT, emptyReport, projectBudget } from '../../src/sim/economy/budget';
import { economyStep } from '../../src/sim/economy/economy';
import { FACILITIES, FacilityKind } from '../../src/sim/facilities';
import { BUS, busesFor } from '../../src/sim/transit/bus';
import { BUS_KIND } from '../../src/sim/traffic/traffic';
import type { Sim } from '../../src/sim/sim';
import { grownTown, runTicks } from '../game/town';

/** The nearest valid site for a facility to cell (ci, cj), searching outward. */
function site(sim: Sim, kind: FacilityKind, ci: number, cj: number, radius = 30): { x: number; y: number } | null {
  for (let r = 0; r <= radius; r++) {
    for (let j = cj - r; j <= cj + r; j++) {
      for (let i = ci - r; i <= ci + r; i++) {
        if (Math.max(Math.abs(i - ci), Math.abs(j - cj)) !== r) continue;
        if (sim.planFacility(kind, i, j).ok) return { x: i, y: j };
      }
    }
  }
  return null;
}

function place(sim: Sim, kind: FacilityKind, ci: number, cj: number): number {
  const at = site(sim, kind, ci, cj);
  expect(at, `a site for ${FACILITIES[kind]!.name} near ${ci},${cj}`).not.toBeNull();
  const before = sim.state.buildings.length;
  expect(sim.apply({ type: 'placeFacility', kind, x: at!.x, y: at!.y }).ok).toBe(true);
  return before;
}

/** Finishes construction of everything placed, so it works at once. */
function finish(sim: Sim): void {
  for (const b of sim.state.buildings) if (b && b.kind !== 0) b.progress = 1;
  sim.state.constructing = sim.state.constructing.filter((id) => (sim.state.buildings[id]?.kind ?? 0) === 0);
  sim.replaceState(sim.state);
}

describe('buses', () => {
  const town = grownTown(150);
  town.state.funds = 1e7;

  it('runs a line through stops on connected roads, and none for a lone stop', () => {
    const sim = forkSim(town);
    sim.state.funds = 1e7;
    place(sim, FacilityKind.BusStop, 140, 60);
    finish(sim);
    expect(sim.busLines).toEqual([]);
    place(sim, FacilityKind.BusStop, 185, 60);
    place(sim, FacilityKind.BusStop, 160, 84);
    finish(sim);
    expect(sim.busLines.length).toBe(1);
    expect(sim.busLines[0]!.stops.length).toBe(3);
    expect(sim.busLines[0]!.buses).toBe(busesFor(3));
    expect(sim.state.stats.buses).toBe(busesFor(3));
  });

  it('puts buses on the road that go from stop to stop and wait at each', () => {
    const sim = forkSim(town);
    sim.state.funds = 1e7;
    for (const [i, j] of [
      [140, 60],
      [185, 60],
      [160, 84],
      [150, 74],
    ] as const)
      place(sim, FacilityKind.BusStop, i, j);
    finish(sim);
    const line = sim.busLines[0]!;
    const visited = new Set<number>();
    let waited = 0;
    for (let t = 0; t < TICKS_PER_HOUR * 2; t++) {
      sim.tick();
      const tr = sim.traffic;
      for (let i = 0; i < tr.count; i++) {
        if (tr.busLine[i]! < 0) continue;
        expect(tr.kind[i]).toBe(BUS_KIND);
        if (tr.dwell[i]! > 0) {
          waited++;
          visited.add(line.stops[tr.busNext[i]!]!);
        }
      }
    }
    expect(sim.traffic.buses).toBe(line.buses);
    // Every stop on the line was served within two game hours.
    expect([...visited].sort()).toEqual([...line.stops].sort());
    expect(waited).toBeGreaterThan(0);
  });

  it('takes riders out of cars, earns fares and costs its running', () => {
    const sim = forkSim(town);
    sim.state.funds = 1e7;
    const s = sim.state;
    const before = projectBudget(s.buildings, s.roads, s.tax, s.loans, s.stats, emptyReport(), s.policies, s.metro);
    for (const [i, j] of [
      [140, 60],
      [185, 60],
      [160, 84],
    ] as const)
      place(sim, FacilityKind.BusStop, i, j);
    finish(sim);
    sim.refreshFields();
    const riders = s.stats.busRiders ?? 0;
    expect(riders).toBeGreaterThan(20);
    expect(riders).toBeLessThan(s.stats.population * BUS.uptake);
    const after = projectBudget(s.buildings, s.roads, s.tax, s.loans, s.stats, emptyReport(), s.policies, s.metro);
    expect(after.fares - before.fares).toBe(Math.round(riders * BUS.fare));
    expect(after.transit - before.transit).toBe(3 * FACILITIES[FacilityKind.BusStop]!.upkeep + busesFor(3) * BUS.upkeepPerBus);
  });
});

describe('the airport', () => {
  it('is a long site, turned to fit, and only one per city', () => {
    const sim = forkSim(grownTown(60));
    sim.state.funds = 1e7;
    const id = place(sim, FacilityKind.Airport, 165, 116);
    const b = sim.state.buildings[id]!;
    expect([b.w, b.h].sort((a, c) => a - c)).toEqual([14, 34]);
    const again = site(sim, FacilityKind.Airport, 120, 40, 60);
    if (again) expect(sim.apply({ type: 'placeFacility', kind: FacilityKind.Airport, x: again.x, y: again.y }).reason).toBe('The city already has one');
  });

  it('earns from exports, travellers and tourists, lifts demand for shops and industry, and is noisy', () => {
    const town = grownTown(150);
    const sim = forkSim(town);
    sim.state.funds = 1e7;
    const s = sim.state;
    const id = place(sim, FacilityKind.Airport, 165, 116);
    const near = { x: (s.buildings[id]!.x + s.buildings[id]!.w / 2) * CELL, z: (s.buildings[id]!.y + s.buildings[id]!.h / 2) * CELL };
    // Under construction it does nothing yet.
    expect(projectBudget(s.buildings, s.roads, s.tax, s.loans, s.stats, emptyReport(), s.policies, s.metro).airport).toBe(0);
    finish(sim);
    runTicks(sim, 400);
    const r = projectBudget(s.buildings, s.roads, s.tax, s.loans, s.stats, emptyReport(), s.policies, s.metro);
    expect(r.airport).toBeGreaterThan(s.stats.population * AIRPORT.passengers);
    expect(r.income).toBe(r.taxR + r.taxC + r.taxI + r.fares + r.airport);
    // Demand, controlled: the same city and the same step, with and without the airport.
    const without = forkSim(sim);
    without.state.buildings[id] = null;
    economyStep(s.buildings, s.tax, s.stats);
    economyStep(without.state.buildings, without.state.tax, without.state.stats);
    expect(s.stats.demand[3]! - without.state.stats.demand[3]!).toBeCloseTo(0.1, 5);
    sim.refreshFields();
    const k = Math.floor(near.z / CELL) * 256 + Math.floor(near.x / CELL);
    expect(sim.fields.pollution[k]).toBeGreaterThan(0.2);
  });
});
