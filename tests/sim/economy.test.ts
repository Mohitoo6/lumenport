import { describe, expect, it } from 'vitest';
import { MAP, STEPS_PER_HOUR, TICKS_PER_STEP, VERTS } from '../../src/core/constants';
import { LOAN_TIERS, emptyReport, loanPayment, projectBudget } from '../../src/sim/economy/budget';
import { capacityOf } from '../../src/sim/economy/capacity';
import { growthRateFor } from '../../src/sim/economy/economy';
import { FACILITIES, FacilityKind } from '../../src/sim/facilities';
import { ROAD_SPECS, RoadType } from '../../src/sim/roads/types';
import { Sim } from '../../src/sim/sim';
import { START_FUNDS } from '../../src/sim/state';
import { POWERED, WATERED, labelRoads } from '../../src/sim/utilities/network';
import { ZoneType, zoneCode, zoneType, type Building } from '../../src/sim/zoning/zones';

const R1 = zoneCode(ZoneType.Residential, 1);
const R2 = zoneCode(ZoneType.Residential, 2);
const C1 = zoneCode(ZoneType.Commercial, 1);
const I1 = zoneCode(ZoneType.Industrial, 1);

/** Flat dry map with a street along z = 400 from x = 400 to 880, real economy rules. */
function city(): Sim {
  const sim = Sim.create(5);
  sim.state.heights.fill(5);
  sim.state.trees.fill(0);
  sim.apply({ type: 'buildRoad', road: RoadType.Street, ax: 400, az: 400, bx: 880, bz: 400 });
  return sim;
}

function run(sim: Sim, days: number): void {
  for (let i = 0; i < days * TICKS_PER_STEP; i++) sim.tick();
}

const alive = (sim: Sim): Building[] => sim.state.buildings.filter((b): b is Building => b !== null);
const zoned = (sim: Sim): Building[] => alive(sim).filter((b) => b.kind === 0);

function utilities(sim: Sim): void {
  expect(sim.apply({ type: 'placeFacility', kind: FacilityKind.CoalPlant, x: 104, y: 52 }).ok).toBe(true);
  expect(sim.apply({ type: 'placeFacility', kind: FacilityKind.WaterTower, x: 100, y: 51 }).ok).toBe(true);
}

describe('money', () => {
  it('charges for roads and refuses what the city cannot afford', () => {
    const sim = city();
    expect(sim.state.funds).toBe(START_FUNDS - 480 * 10);
    sim.state.funds = 100;
    const r = sim.apply({ type: 'buildRoad', road: RoadType.Street, ax: 400, az: 480, bx: 880, bz: 480 });
    expect(r).toMatchObject({ ok: false, reason: 'Not enough money' });
    expect(sim.state.funds).toBe(100);
    expect(sim.state.roads.edges.filter(Boolean).length).toBe(1);
  });

  it('sandbox mode builds for free', () => {
    const sim = city();
    sim.apply({ type: 'setSandbox', on: true });
    sim.state.funds = 0;
    expect(sim.apply({ type: 'buildRoad', road: RoadType.Street, ax: 400, az: 480, bx: 880, bz: 480 }).ok).toBe(true);
    expect(sim.state.funds).toBe(0);
  });

  it('lends each loan tier once and collects fixed payments until it is repaid', () => {
    const sim = city();
    const before = sim.state.funds;
    expect(sim.apply({ type: 'takeLoan', tier: 0 }).ok).toBe(true);
    expect(sim.state.funds).toBe(before + LOAN_TIERS[0]!.amount);
    expect(sim.apply({ type: 'takeLoan', tier: 0 }).ok).toBe(false);
    expect(sim.apply({ type: 'takeLoan', tier: 9 }).ok).toBe(false);
    const pay = loanPayment(LOAN_TIERS[0]!);
    expect(pay * LOAN_TIERS[0]!.hours).toBeGreaterThan(LOAN_TIERS[0]!.amount);
    run(sim, STEPS_PER_HOUR);
    expect(sim.state.report.loans).toBe(pay);
    expect(sim.state.loans[0]!.hoursLeft).toBe(LOAN_TIERS[0]!.hours - 1);
    run(sim, STEPS_PER_HOUR * (LOAN_TIERS[0]!.hours - 1));
    expect(sim.state.loans.length).toBe(0);
  });

  it('settles the budget hourly: funds move by exactly the reported net', () => {
    const sim = city();
    utilities(sim);
    const before = sim.state.funds;
    let hours = 0;
    sim.events.on('hourPassed', () => hours++);
    run(sim, STEPS_PER_HOUR);
    expect(hours).toBe(1);
    const r = sim.state.report;
    expect(r.utilities).toBe(FACILITIES[FacilityKind.CoalPlant]!.upkeep + FACILITIES[FacilityKind.WaterTower]!.upkeep);
    expect(r.roads).toBe(Math.round(480 * ROAD_SPECS[RoadType.Street].upkeep));
    expect(r.net).toBe(r.income - r.expense);
    expect(sim.state.funds).toBe(before + r.net);
  });

  it('validates tax rates and scales tax income with them', () => {
    const sim = city();
    expect(sim.apply({ type: 'setTax', zone: 1, rate: 25 }).ok).toBe(false);
    expect(sim.apply({ type: 'setTax', zone: 0, rate: 5 }).ok).toBe(false);
    expect(sim.apply({ type: 'setTax', zone: 1, rate: 12 }).ok).toBe(true);
    sim.state.stats.population = 1000;
    const a = projectBudget([], sim.state.roads, [0, 6, 9, 9], [], sim.state.stats, emptyReport());
    const b = projectBudget([], sim.state.roads, [0, 12, 9, 9], [], sim.state.stats, emptyReport());
    expect(b.taxR).toBe(a.taxR * 2);
  });
});

describe('facilities', () => {
  it('must touch a road, stay off roads, buildings and water', () => {
    const sim = city();
    expect(sim.planFacility(FacilityKind.WindTurbine, 60, 30).reason).toBe('Must be next to a road');
    expect(sim.planFacility(FacilityKind.WindTurbine, 60, 49).reason).toBe('A road is in the way');
    const ok = sim.planFacility(FacilityKind.WindTurbine, 60, 51);
    expect(ok.ok).toBe(true);
    expect(ok).toMatchObject({ x: 60, y: 51, size: 2 });
    expect(sim.apply({ type: 'placeFacility', kind: FacilityKind.WindTurbine, x: 60, y: 51 }).ok).toBe(true);
    expect(sim.planFacility(FacilityKind.WindTurbine, 61, 51).reason).toBe('A building is in the way');
    for (let j = 51; j <= 56; j++) for (let i = 70; i <= 76; i++) sim.state.heights[j * VERTS + i] = -3;
    expect(sim.planFacility(FacilityKind.WindTurbine, 72, 51).reason).toBe('Cannot build in water');
  });

  it('pumps need water nearby', () => {
    const sim = city();
    expect(sim.planFacility(FacilityKind.WaterPump, 60, 51).reason).toBe('Must be close to water');
    for (let j = 55; j <= 58; j++) for (let i = 58; i <= 64; i++) sim.state.heights[j * VERTS + i] = -3;
    expect(sim.planFacility(FacilityKind.WaterPump, 60, 51).ok).toBe(true);
  });

  it('costs money and clears zoning under it', () => {
    const sim = city();
    sim.apply({ type: 'zoneRect', x0: 58, y0: 51, x1: 66, y1: 54, zone: R1 });
    const before = sim.state.funds;
    sim.apply({ type: 'placeFacility', kind: FacilityKind.WindTurbine, x: 60, y: 51 });
    expect(sim.state.funds).toBe(before - FACILITIES[FacilityKind.WindTurbine]!.cost);
    expect(sim.state.zone[51 * MAP + 60]).toBe(0);
    expect(sim.state.zone[51 * MAP + 64]).toBe(R1);
  });
});

describe('utilities', () => {
  it('labels separate road networks separately', () => {
    const sim = city();
    sim.apply({ type: 'buildRoad', road: RoadType.Street, ax: 400, az: 800, bx: 880, bz: 800 });
    const comp = new Int32Array(MAP * MAP);
    expect(labelRoads(sim.state.roadCell, comp)).toBe(2);
    expect(comp[49 * MAP + 60]).not.toBe(comp[99 * MAP + 60]);
    expect(comp[20 * MAP + 20]).toBe(-1);
  });

  it('nothing grows without power and water, and it does once both are connected', () => {
    const sim = city();
    sim.apply({ type: 'zoneRect', x0: 52, y0: 45, x1: 90, y1: 48, zone: R1 });
    run(sim, 20);
    expect(zoned(sim).length).toBe(0);
    sim.apply({ type: 'placeFacility', kind: FacilityKind.CoalPlant, x: 104, y: 52 });
    run(sim, 20);
    expect(zoned(sim).length).toBe(0);
    sim.apply({ type: 'placeFacility', kind: FacilityKind.WaterTower, x: 100, y: 51 });
    run(sim, 30);
    expect(zoned(sim).length).toBeGreaterThan(3);
    expect(sim.state.stats.powerSupply).toBe(45);
    expect(sim.state.stats.waterSupply).toBe(1600);
  });

  it('a network on its own island gets nothing from the main grid', () => {
    const sim = city();
    utilities(sim);
    sim.apply({ type: 'buildRoad', road: RoadType.Street, ax: 400, az: 800, bx: 880, bz: 800 });
    sim.apply({ type: 'zoneRect', x0: 52, y0: 95, x1: 90, y1: 98, zone: R1 });
    run(sim, 40);
    expect(zoned(sim).length).toBe(0);
  });

  it('shortages leave a share of buildings unserved and stop new growth', () => {
    const sim = city();
    sim.apply({ type: 'placeFacility', kind: FacilityKind.WindTurbine, x: 104, y: 51 });
    sim.apply({ type: 'placeFacility', kind: FacilityKind.WaterTower, x: 100, y: 51 });
    sim.apply({ type: 'zoneRect', x0: 52, y0: 45, x1: 98, y1: 48, zone: R2 });
    sim.apply({ type: 'zoneRect', x0: 52, y0: 51, x1: 96, y1: 54, zone: R2 });
    run(sim, 240);
    const s = sim.state.stats;
    // Growth stopped close to what one turbine can carry.
    expect(s.powerDemand).toBeGreaterThan(2);
    expect(s.powerDemand).toBeLessThan(4 + 1.5);
    // Remove the supply: everything goes dark and people leave.
    const turbine = alive(sim).find((b) => b.kind === FacilityKind.WindTurbine)!;
    const peak = s.population;
    sim.apply({ type: 'bulldozeBuilding', id: turbine.id });
    run(sim, 30);
    expect(zoned(sim).every((b) => (b.flags & POWERED) === 0)).toBe(true);
    expect(zoned(sim).every((b) => (b.flags & WATERED) !== 0)).toBe(true);
    expect(sim.state.stats.unpowered).toBe(zoned(sim).length);
    expect(sim.state.stats.population).toBeLessThan(peak * 0.3);
  });
});

describe('population and demand', () => {
  it('bigger, denser, higher-level buildings hold more', () => {
    const base = { id: 0, kind: 0, x: 0, y: 0, facing: 0, progress: 1, seed: 1, baseY: 0, pop: 0, flags: 0 } as const;
    const small = capacityOf({ ...base, zone: R1, w: 2, h: 2, level: 1 });
    expect(capacityOf({ ...base, zone: R1, w: 3, h: 3, level: 1 })).toBeGreaterThan(small);
    expect(capacityOf({ ...base, zone: R2, w: 2, h: 2, level: 1 })).toBeGreaterThan(small);
    expect(capacityOf({ ...base, zone: R1, w: 2, h: 2, level: 3 })).toBeGreaterThan(small);
    expect(capacityOf({ ...base, kind: FacilityKind.CoalPlant, zone: 0, w: 4, h: 4, level: 1 })).toBe(0);
  });

  it('maps demand to a growth rate', () => {
    expect(growthRateFor(-0.5)).toBe(0);
    expect(growthRateFor(0)).toBe(0);
    expect(growthRateFor(1)).toBeCloseTo(0.98, 5);
    expect(growthRateFor(0.5)).toBeGreaterThan(growthRateFor(0.2));
  });

  it('homes alone stall for lack of jobs; adding workplaces restarts growth', () => {
    const sim = city();
    utilities(sim);
    sim.apply({ type: 'zoneRect', x0: 52, y0: 45, x1: 98, y1: 48, zone: R1 });
    run(sim, 200);
    const stalled = sim.state.stats.housing;
    expect(stalled).toBeGreaterThan(20);
    expect(sim.state.stats.demand[1]).toBeLessThan(0.1);
    run(sim, 60);
    expect(sim.state.stats.housing).toBeLessThanOrEqual(stalled * 1.15);
    // Industry and shops want the workers and customers that are now there.
    expect(sim.state.stats.demand[3]).toBeGreaterThan(0.3);
    sim.apply({ type: 'zoneRect', x0: 52, y0: 51, x1: 76, y1: 54, zone: I1 });
    sim.apply({ type: 'zoneRect', x0: 78, y0: 51, x1: 96, y1: 54, zone: C1 });
    run(sim, 200);
    const s = sim.state.stats;
    expect(s.jobsI).toBeGreaterThan(10);
    expect(s.jobsC).toBeGreaterThan(3);
    expect(s.employed).toBeGreaterThan(0);
    expect(s.employed).toBeLessThanOrEqual(Math.ceil(s.population * 0.55) + zoned(sim).length);
    expect(zoned(sim).filter((b) => zoneType(b.zone) === ZoneType.Residential).reduce((n, b) => n + b.pop, 0)).toBe(s.population);
  });

  it('high taxes hold growth back', () => {
    const grow = (rate: number): number => {
      const sim = city();
      utilities(sim);
      sim.apply({ type: 'setTax', zone: 1, rate });
      sim.apply({ type: 'zoneRect', x0: 52, y0: 45, x1: 98, y1: 48, zone: R1 });
      run(sim, 120);
      return sim.state.stats.housing;
    };
    expect(grow(20)).toBeLessThan(grow(4));
  });

  it('a working town turns a hourly profit and stays deterministic', () => {
    const play = (): Sim => {
      const sim = city();
      utilities(sim);
      sim.apply({ type: 'buildRoad', road: RoadType.Street, ax: 400, az: 480, bx: 880, bz: 480 });
      sim.apply({ type: 'buildRoad', road: RoadType.Street, ax: 640, az: 400, bx: 640, bz: 480 });
      sim.apply({ type: 'zoneRect', x0: 52, y0: 45, x1: 98, y1: 48, zone: R2 });
      sim.apply({ type: 'zoneRect', x0: 52, y0: 51, x1: 78, y1: 58, zone: R1 });
      sim.apply({ type: 'zoneRect', x0: 82, y0: 51, x1: 96, y1: 58, zone: C1 });
      sim.apply({ type: 'zoneRect', x0: 52, y0: 61, x1: 108, y1: 64, zone: I1 });
      run(sim, 360);
      return sim;
    };
    const a = play();
    const s = a.state.stats;
    expect(s.population).toBeGreaterThan(300);
    expect(a.state.report.net).toBeGreaterThan(0);
    expect(a.state.report.taxR).toBeGreaterThan(0);
    expect(a.state.report.taxC + a.state.report.taxI).toBeGreaterThan(0);
    const b = play();
    expect(b.state.funds).toBe(a.state.funds);
    expect(JSON.stringify(b.state.buildings)).toBe(JSON.stringify(a.state.buildings));
  });
});
