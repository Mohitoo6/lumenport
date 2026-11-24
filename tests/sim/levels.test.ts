import { describe, expect, it } from 'vitest';
import { FACILITIES, FacilityKind, SERVICE_FACILITIES, Service, lockedReason } from '../../src/sim/facilities';
import { RoadType } from '../../src/sim/roads/types';
import { Sim } from '../../src/sim/sim';

/** Flat dry map with a long street, real economy rules. */
function city(): Sim {
  const sim = Sim.create(9);
  sim.state.heights.fill(5);
  sim.state.trees.fill(0);
  sim.apply({ type: 'buildRoad', road: RoadType.Street, ax: 400, az: 400, bx: 1200, bz: 400 });
  return sim;
}

describe('small and big service buildings', () => {
  it('pairs each small station with a bigger one that reaches more than twice as far', () => {
    for (const [small, big, service] of [
      [FacilityKind.Police, FacilityKind.PoliceHQ, Service.Police],
      [FacilityKind.FireStation, FacilityKind.FireHQ, Service.Fire],
      [FacilityKind.Clinic, FacilityKind.Hospital, Service.Health],
    ] as const) {
      expect(FACILITIES[small]!.service).toBe(service);
      expect(FACILITIES[big]!.service).toBe(service);
      expect(FACILITIES[big]!.radius).toBeGreaterThan(FACILITIES[small]!.radius * 2);
      expect(FACILITIES[big]!.cost).toBeGreaterThan(FACILITIES[small]!.cost * 2);
      expect(FACILITIES[big]!.minPopulation).toBeGreaterThan(0);
      expect(FACILITIES[small]!.minPopulation).toBeUndefined();
      // The menu lists the big one right after the small one.
      expect(SERVICE_FACILITIES.indexOf(big as never)).toBe(SERVICE_FACILITIES.indexOf(small as never) + 1);
    }
    expect(SERVICE_FACILITIES).toContain(FacilityKind.IndoorStadium);
  });

  it('unlocks the big ones when the city is big enough, and always in sandbox', () => {
    const sim = city();
    const need = FACILITIES[FacilityKind.PoliceHQ]!.minPopulation!;
    const plan = sim.planFacility(FacilityKind.PoliceHQ, 60, 52);
    expect(plan.ok).toBe(false);
    expect(plan.reason).toMatch(/Unlocks at 3,000 residents/);
    const refused = sim.apply({ type: 'placeFacility', kind: FacilityKind.PoliceHQ, x: 60, y: 52 });
    expect(refused).toMatchObject({ ok: false });
    expect(refused.reason).toMatch(/Unlocks at/);
    sim.state.stats.population = need;
    expect(sim.planFacility(FacilityKind.PoliceHQ, 60, 52).ok).toBe(true);
    const funds = sim.state.funds;
    expect(sim.apply({ type: 'placeFacility', kind: FacilityKind.PoliceHQ, x: 60, y: 52 }).ok).toBe(true);
    expect(sim.state.funds).toBe(funds - FACILITIES[FacilityKind.PoliceHQ]!.cost);
    expect(lockedReason(FacilityKind.IndoorStadium, 10, true)).toBeNull();
    expect(lockedReason(FacilityKind.Police, 0, false)).toBeNull();
  });
});
