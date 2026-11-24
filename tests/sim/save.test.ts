import { describe, expect, it } from 'vitest';
import { RoadType } from '../../src/sim/roads/types';
import { cloneState, metaOf, validateState } from '../../src/sim/save/serialize';
import { Sim } from '../../src/sim/sim';
import { ZoneType, zoneCode } from '../../src/sim/zoning/zones';

function played(): Sim {
  const sim = Sim.create(31);
  sim.state.heights.fill(5);
  sim.state.trees.fill(0);
  sim.state.sandbox = true;
  sim.growthRate = 1;
  sim.apply({ type: 'buildRoad', road: RoadType.Street, ax: 400, az: 400, bx: 880, bz: 400 });
  sim.apply({ type: 'buildRoad', road: RoadType.Street, ax: 640, az: 400, bx: 640, bz: 640 });
  sim.apply({ type: 'zoneRect', x0: 52, y0: 45, x1: 100, y1: 48, zone: zoneCode(ZoneType.Residential, 2) });
  sim.apply({ type: 'zoneRect', x0: 52, y0: 51, x1: 78, y1: 54, zone: zoneCode(ZoneType.Commercial, 1) });
  // A bank lends by city size: pretend the town is big enough for the small loan.
  sim.state.stats.population = 2000;
  sim.apply({ type: 'takeLoan', tier: 0 });
  for (let i = 0; i < 1500; i++) sim.tick();
  return sim;
}

/** Field-by-field comparison that understands typed arrays. */
function same(a: unknown, b: unknown): boolean {
  if (ArrayBuffer.isView(a) && ArrayBuffer.isView(b)) {
    const x = a as unknown as ArrayLike<number>;
    const y = b as unknown as ArrayLike<number>;
    if (x.length !== y.length) return false;
    for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return false;
    return true;
  }
  return JSON.stringify(a) === JSON.stringify(b);
}

describe('save and load', () => {
  it('a copy matches the original field for field and shares nothing with it', () => {
    const sim = played();
    const copy = cloneState(sim.state);
    for (const key of Object.keys(sim.state) as Array<keyof typeof copy>) expect(same(copy[key], sim.state[key]), key).toBe(true);
    // Playing on must not touch the copy.
    const tick = copy.tick;
    const funds = copy.funds;
    const firstHeight = copy.heights[0];
    sim.apply({ type: 'buildRoad', road: RoadType.Street, ax: 400, az: 720, bx: 880, bz: 720 });
    for (let i = 0; i < 200; i++) sim.tick();
    sim.state.heights[0] = 99;
    expect(copy.tick).toBe(tick);
    expect(copy.funds).toBe(funds);
    expect(copy.heights[0]).toBe(firstHeight);
    expect(copy.roads.edges.length).toBeLessThan(sim.state.roads.edges.length);
  });

  it('a loaded city carries on: buildings, money and roads intact, simulation running', () => {
    const sim = played();
    const saved = cloneState(sim.state);
    const loaded = validateState(saved);
    expect(typeof loaded).toBe('object');
    const other = Sim.create(1);
    let replaced = 0;
    other.events.on('stateReplaced', () => replaced++);
    other.replaceState(loaded as typeof saved);
    expect(replaced).toBe(1);
    expect(other.state.buildings.filter(Boolean).length).toBe(sim.state.buildings.filter(Boolean).length);
    expect(other.state.loans.length).toBe(1);
    const before = other.state.tick;
    for (let i = 0; i < 800; i++) other.tick();
    expect(other.state.tick).toBe(before + 800);
    // Traffic is rebuilt from the city rather than saved.
    expect(other.traffic.count).toBeGreaterThan(0);
    expect(other.fields.landValue.some((v) => v > 0)).toBe(true);
  });

  it('rejects saves from another version and damaged data', () => {
    const sim = played();
    const old = { ...cloneState(sim.state), version: 1 };
    expect(validateState(old)).toMatch(/different version/);
    const broken = { ...cloneState(sim.state), heights: new Float32Array(10) };
    expect(validateState(broken)).toBe('The saved city is damaged');
    expect(validateState(null)).toBe('Not a saved city');
    expect(validateState('city')).toBe('Not a saved city');
  });

  it('describes a save for the load menu', () => {
    const sim = played();
    const meta = metaOf('slot1', sim.state, 1234);
    expect(meta).toMatchObject({ slot: 'slot1', cityName: 'New Haven', tick: 1500, savedAt: 1234 });
    expect(meta.population).toBe(sim.state.stats.population);
  });
});
