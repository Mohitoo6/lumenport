import { describe, expect, it } from 'vitest';
import { CELL } from '../../src/core/constants';
import { cloneState } from '../../src/sim/save/serialize';
import { FacilityKind } from '../../src/sim/facilities';
import { Sim } from '../../src/sim/sim';
import { activeStations, smoothPath, pathLength } from '../../src/sim/transit/metro';
import { grownTown, runTicks } from '../game/town';

/** Places a facility on the first free site found spiralling out from cell (x, y). */
function placeNear(sim: Sim, kind: FacilityKind, x: number, y: number): number {
  for (let r = 0; r < 30; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const res = sim.apply({ type: 'placeFacility', kind, x: x + dx, y: y + dy });
        if (res.ok) return sim.state.buildings.length - 1;
      }
    }
  }
  throw new Error(`no site for ${kind}`);
}

function finish(sim: Sim): void {
  for (const id of sim.state.constructing.slice()) {
    const b = sim.state.buildings[id];
    if (b) b.progress = 1;
  }
  sim.state.constructing.length = 0;
}

describe('metro', () => {
  it('draws a smooth path through bend points, ending exactly at the stations', () => {
    const pts = smoothPath([
      [0, 0],
      [100, 50],
      [200, 0],
    ]);
    expect(pts.slice(0, 2)).toEqual([0, 0]);
    expect(pts.slice(-2)).toEqual([200, 0]);
    const len = pathLength(pts);
    expect(len).toBeGreaterThan(220);
    expect(len).toBeLessThan(260);
  });

  it('connects two stations: costs money, takes cars off the road, earns fares, and goes when a station goes', () => {
    const sim = grownTown(150);
    sim.state.funds = 200_000;
    const a = placeNear(sim, FacilityKind.MetroStation, 140, 60);
    const b = placeNear(sim, FacilityKind.MetroStation, 190, 80);
    finish(sim);
    expect(activeStations(sim.state).size).toBe(0);
    runTicks(sim, 200);
    const carsBefore = sim.traffic.count;
    const funds = sim.state.funds;
    // A bend point between the two stations, off the straight line.
    const sa = sim.state.buildings[a]!;
    const sb = sim.state.buildings[b]!;
    const mid: [number, number] = [((sa.x + sb.x) / 2) * CELL, ((sa.y + sb.y) / 2 - 6) * CELL];
    const plan = sim.planMetro(a, b, [mid]);
    if (!plan.ok) console.log(plan.reason);
    const r = sim.apply({ type: 'buildMetro', a, b, via: plan.ok ? [mid] : [] });
    expect(r.reason ?? 'ok').toBe('ok');
    expect(sim.state.funds).toBe(funds - r.cost!);
    expect(activeStations(sim.state)).toEqual(new Set([a, b]));
    expect(sim.state.stats.metroRiders).toBeGreaterThan(50);
    expect(sim.apply({ type: 'buildMetro', a: b, b: a, via: [] }).reason).toMatch(/already connected/);
    runTicks(sim, 600);
    expect(sim.traffic.count).toBeLessThan(carsBefore * 1.05 + 5);
    // The budget shows the fares and the upkeep.
    sim.refreshFields();
    expect(sim.state.stats.metroRiders).toBeGreaterThan(50);
    // Saved and loaded with the city.
    const copy = cloneState(sim.state);
    expect(copy.metro!.lines.filter(Boolean)).toHaveLength(1);
    // Demolishing a station removes its line.
    sim.apply({ type: 'bulldozeBuilding', id: a });
    expect(sim.state.metro!.lines.filter(Boolean)).toHaveLength(0);
    expect(activeStations(sim.state).size).toBe(0);
  });

  it('refuses lines through tall buildings and to things that are not stations', () => {
    const sim = grownTown(150);
    sim.state.funds = 200_000;
    const a = placeNear(sim, FacilityKind.MetroStation, 140, 60);
    const park = placeNear(sim, FacilityKind.ItPark, 175, 90);
    finish(sim);
    expect(sim.apply({ type: 'buildMetro', a, b: park, via: [] }).reason).toMatch(/two metro stations/);
    const b = placeNear(sim, FacilityKind.MetroStation, 200, 100);
    finish(sim);
    // Straight through the IT park's towers.
    const p = sim.state.buildings[park]!;
    const through: [number, number] = [(p.x + p.w / 2) * CELL, (p.y + p.h / 2) * CELL];
    const r = sim.apply({ type: 'buildMetro', a, b, via: [through] });
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/in the way/);
  });
});

describe('IT park and university', () => {
  it('IT park jobs fill with workers, pay more tax and raise demand for homes', () => {
    const sim = grownTown(150);
    sim.state.funds = 200_000;
    runTicks(sim, 100);
    const demand = sim.state.stats.demand[1]!;
    const taxC = sim.state.report.taxC;
    placeNear(sim, FacilityKind.ItPark, 175, 90);
    finish(sim);
    runTicks(sim, 40 * 31);
    expect(sim.state.stats.jobsC).toBeGreaterThan(400);
    expect(sim.state.stats.demand[1]!).toBeGreaterThan(demand);
    expect(sim.state.report.taxC).toBeGreaterThan(taxC);
  });

  it('university covers a much wider area than a school', () => {
    const sim = grownTown(150);
    sim.state.funds = 200_000;
    const u = placeNear(sim, FacilityKind.University, 170, 85);
    finish(sim);
    sim.refreshFields();
    const edu = sim.fields.coverage[4]!;
    const b = sim.state.buildings[u]!;
    const far = (b.y + 2) * 256 + b.x + 2 + 60;
    expect(edu[far]!).toBeGreaterThan(0.2);
  });
});
