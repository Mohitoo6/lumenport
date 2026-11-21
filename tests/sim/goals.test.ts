import { describe, expect, it } from 'vitest';
import { TICKS_PER_STEP } from '../../src/core/constants';
import { FacilityKind } from '../../src/sim/facilities';
import { GOALS, advanceGoals, currentGoal } from '../../src/sim/goals';
import { RoadType } from '../../src/sim/roads/types';
import { Sim } from '../../src/sim/sim';
import { cloneState } from '../../src/sim/save/serialize';
import { ZoneType, zoneCode } from '../../src/sim/zoning/zones';

function step(sim: Sim, steps = 1): void {
  for (let i = 0; i < steps * TICKS_PER_STEP; i++) sim.tick();
}

describe('goals', () => {
  it('have unique ids and start at the first street', () => {
    expect(new Set(GOALS.map((g) => g.id)).size).toBe(GOALS.length);
    const sim = Sim.create(3);
    expect(currentGoal(sim.state)?.id).toBe('street');
    expect(sim.state.goalsDone).toBe(0);
  });

  it('walk a new player through street, homes, power and water, in order, with events', () => {
    const sim = Sim.create(5);
    sim.state.heights.fill(5);
    sim.state.trees.fill(0);
    const reached: string[] = [];
    sim.events.on('goalReached', (g) => reached.push(g.id));
    // Zoning first does not skip the street goal: goals are taken in order.
    step(sim);
    expect(reached).toEqual([]);
    expect(sim.apply({ type: 'buildRoad', road: RoadType.Street, ax: 400, az: 400, bx: 880, bz: 400 }).ok).toBe(true);
    step(sim);
    expect(reached).toEqual(['street']);
    expect(sim.apply({ type: 'zoneRect', x0: 50, y0: 51, x1: 100, y1: 53, zone: zoneCode(ZoneType.Residential, 1) }).ok).toBe(true);
    step(sim);
    expect(reached).toEqual(['street', 'homes']);
    expect(sim.apply({ type: 'placeFacility', kind: FacilityKind.CoalPlant, x: 104, y: 52 }).ok).toBe(true);
    expect(sim.apply({ type: 'placeFacility', kind: FacilityKind.WaterTower, x: 100, y: 51 }).ok).toBe(true);
    step(sim, 30);
    expect(reached.slice(0, 4)).toEqual(['street', 'homes', 'power', 'water']);
  });

  it('pays the grant once, and not in sandbox', () => {
    const sim = Sim.create(7);
    const s = sim.state;
    s.goalsDone = GOALS.findIndex((g) => g.id === 'residents100');
    s.stats.population = 150;
    const before = s.funds;
    const got = advanceGoals(s);
    expect(got.map((g) => g.id)).toEqual(['residents100']);
    expect(s.funds).toBe(before + 3000);
    expect(advanceGoals(s)).toEqual([]);
    expect(s.funds).toBe(before + 3000);

    const box = cloneState(s);
    box.sandbox = true;
    box.goalsDone = GOALS.findIndex((g) => g.id === 'town500');
    box.stats.population = 600;
    const fundsBox = box.funds;
    expect(advanceGoals(box).map((g) => g.id)).toEqual(['town500']);
    expect(box.funds).toBe(fundsBox);
  });

  it('counts an approved council decision', () => {
    const sim = Sim.create(9);
    sim.state.goalsDone = GOALS.findIndex((g) => g.id === 'council');
    expect(advanceGoals(sim.state)).toEqual([]);
    expect(sim.apply({ type: 'recordCouncilDecision' }).ok).toBe(true);
    expect(advanceGoals(sim.state).map((g) => g.id)).toEqual(['council']);
  });

  it('lets an older save without goals pick up where its city stands', () => {
    const sim = Sim.create(11);
    delete sim.state.goalsDone;
    expect(currentGoal(sim.state)?.id).toBe('street');
  });
});

describe('an empty treasury', () => {
  it('costs happiness while the funds are below zero, and the HUD says why', async () => {
    const { EMPTY_TREASURY_MOOD } = await import('../../src/sim/sim');
    const { cityAlerts } = await import('../../src/game/assistant/situation');
    const sim = Sim.create(13);
    sim.apply({ type: 'buildRoad', road: RoadType.Street, ax: 400, az: 400, bx: 880, bz: 400 });
    sim.refreshFields();
    const fine = sim.state.stats.happiness;
    sim.state.funds = -500;
    sim.refreshFields();
    expect(fine - sim.state.stats.happiness).toBeCloseTo(EMPTY_TREASURY_MOOD, 5);
    expect(cityAlerts(sim)[0]).toMatch(/treasury is empty/);
  });
});
