import { describe, expect, it } from 'vitest';
import { MAP, TICKS_PER_STEP, VERTS } from '../../src/core/constants';
import { FACILITIES, FacilityKind, Service } from '../../src/sim/facilities';
import { RoadType } from '../../src/sim/roads/types';
import { Sim } from '../../src/sim/sim';
import { ZoneType, zoneCode } from '../../src/sim/zoning/zones';

const R2 = zoneCode(ZoneType.Residential, 2);
const I2 = zoneCode(ZoneType.Industrial, 2);
const C1 = zoneCode(ZoneType.Commercial, 1);

/** Flat sandbox map with a long street along z = 400 (road cells j = 49, 50). */
function town(): Sim {
  const sim = Sim.create(21);
  sim.state.heights.fill(5);
  sim.state.trees.fill(0);
  sim.state.sandbox = true;
  sim.growthRate = 1;
  sim.apply({ type: 'buildRoad', road: RoadType.Street, ax: 240, az: 400, bx: 1200, bz: 400 });
  return sim;
}

function run(sim: Sim, days: number): void {
  for (let i = 0; i < days * TICKS_PER_STEP; i++) sim.tick();
}

const at = (a: Float32Array, i: number, j: number): number => a[j * MAP + i]!;
const place = (sim: Sim, kind: FacilityKind, x: number, y: number) => sim.apply({ type: 'placeFacility', kind, x, y });

describe('service coverage', () => {
  it('is strongest at the building and fades to nothing at its radius', () => {
    const sim = town();
    expect(place(sim, FacilityKind.Police, 80, 51).ok).toBe(true);
    run(sim, 8);
    const cov = sim.fields.coverage[Service.Police]!;
    const r = FACILITIES[FacilityKind.Police]!.radius;
    expect(at(cov, 80, 51)).toBeGreaterThan(0.95);
    expect(at(cov, 80 + r / 2, 51)).toBeCloseTo(0.5, 1);
    expect(at(cov, 80 + r + 3, 51)).toBe(0);
    expect(at(sim.fields.coverage[Service.Fire]!, 80, 51)).toBe(0);
  });

  it('only counts once the building is finished', () => {
    const sim = town();
    place(sim, FacilityKind.Clinic, 80, 51);
    sim.refreshFields();
    expect(at(sim.fields.coverage[Service.Health]!, 80, 51)).toBe(0);
  });

  it('reaches much further from a hospital than from a clinic', () => {
    const sim = town();
    expect(place(sim, FacilityKind.Hospital, 80, 53).ok).toBe(true);
    run(sim, 8);
    const b = sim.state.buildings.find((x) => x && x.kind === FacilityKind.Hospital)!;
    const cx = Math.round(b.x + b.w / 2);
    const cy = Math.round(b.y + b.h / 2);
    const cov = sim.fields.coverage[Service.Health]!;
    const clinicReach = FACILITIES[FacilityKind.Clinic]!.radius;
    expect(at(cov, cx, cy)).toBeGreaterThan(0.95);
    expect(at(cov, cx + clinicReach + 5, cy)).toBeGreaterThan(0.3);
    expect(FACILITIES[FacilityKind.Hospital]!.jobs).toBeGreaterThan(0);
  });

  it('is paid for under services, not utilities', () => {
    const sim = town();
    sim.state.sandbox = false;
    place(sim, FacilityKind.School, 80, 52);
    place(sim, FacilityKind.Park, 90, 51);
    run(sim, 30);
    expect(sim.state.report.services).toBe(FACILITIES[FacilityKind.School]!.upkeep + FACILITIES[FacilityKind.Park]!.upkeep);
    expect(sim.state.report.utilities).toBe(0);
  });
});

describe('pollution, crime and land value', () => {
  it('industry pollutes its surroundings and drags land value down', () => {
    const sim = town();
    sim.apply({ type: 'zoneRect', x0: 60, y0: 51, x1: 80, y1: 54, zone: I2 });
    run(sim, 40);
    const f = sim.fields;
    expect(at(f.pollution, 70, 52)).toBeGreaterThan(0.5);
    // A few cells away it is weaker; far away there is none.
    expect(at(f.pollution, 70, 60)).toBeGreaterThan(0);
    expect(at(f.pollution, 70, 60)).toBeLessThan(at(f.pollution, 70, 52));
    // Far away there is only a trace of exhaust from the passing traffic.
    expect(at(f.pollution, 130, 52)).toBeLessThan(0.05);
    expect(at(f.landValue, 70, 52)).toBeLessThan(at(f.landValue, 130, 52) - 0.2);
  });

  it('a coal plant is a strong source', () => {
    const sim = town();
    place(sim, FacilityKind.CoalPlant, 100, 52);
    run(sim, 8);
    expect(at(sim.fields.pollution, 101, 52)).toBeGreaterThan(0.8);
  });

  it('parks and water raise land value', () => {
    const sim = town();
    for (let j = 60; j < 70; j++) for (let i = 40; i < 60; i++) sim.state.heights[j * VERTS + i] = -3;
    place(sim, FacilityKind.Park, 110, 51);
    run(sim, 8);
    const lv = sim.fields.landValue;
    const plain = at(lv, 140, 30);
    expect(at(lv, 111, 53)).toBeGreaterThan(plain + 0.1);
    expect(at(lv, 50, 57)).toBeGreaterThan(plain + 0.1);
    expect(at(sim.fields.waterside, 140, 30)).toBe(0);
  });

  it('police cut crime where people are', () => {
    const measure = (withPolice: boolean): number => {
      const sim = town();
      sim.apply({ type: 'zoneRect', x0: 60, y0: 45, x1: 90, y1: 48, zone: R2 });
      sim.apply({ type: 'zoneRect', x0: 60, y0: 51, x1: 90, y1: 54, zone: C1 });
      if (withPolice) place(sim, FacilityKind.Police, 94, 51);
      run(sim, 80);
      return at(sim.fields.crime, 75, 52);
    };
    const without = measure(false);
    const guarded = measure(true);
    expect(without).toBeGreaterThan(0.02);
    expect(guarded).toBeLessThan(without * 0.7);
  });
});

describe('happiness', () => {
  it('is higher with services and a park than without', () => {
    const measure = (served: boolean): number => {
      const sim = town();
      sim.apply({ type: 'zoneRect', x0: 60, y0: 45, x1: 90, y1: 48, zone: R2 });
      sim.apply({ type: 'zoneRect', x0: 100, y0: 45, x1: 130, y1: 48, zone: C1 });
      if (served) {
        place(sim, FacilityKind.Clinic, 70, 51);
        place(sim, FacilityKind.School, 75, 52);
        place(sim, FacilityKind.Police, 80, 51);
        place(sim, FacilityKind.Park, 84, 51);
      }
      run(sim, 90);
      return sim.state.stats.happiness;
    };
    const plain = measure(false);
    const served = measure(true);
    expect(plain).toBeGreaterThan(0.2);
    expect(plain).toBeLessThan(0.75);
    expect(served).toBeGreaterThan(plain + 0.12);
  });

  it('living next to heavy industry makes people unhappy', () => {
    const sim = town();
    sim.apply({ type: 'zoneRect', x0: 60, y0: 45, x1: 90, y1: 48, zone: R2 });
    sim.apply({ type: 'zoneRect', x0: 60, y0: 51, x1: 90, y1: 54, zone: I2 });
    run(sim, 90);
    const dirty = sim.state.stats.happiness;
    const clean = town();
    clean.apply({ type: 'zoneRect', x0: 60, y0: 45, x1: 90, y1: 48, zone: R2 });
    clean.apply({ type: 'zoneRect', x0: 115, y0: 51, x1: 145, y1: 54, zone: I2 });
    run(clean, 90);
    expect(dirty).toBeLessThan(clean.state.stats.happiness - 0.1);
  });
});
