import { describe, expect, it } from 'vitest';
import { CELL, VERTS } from '../../src/core/constants';
import { SCULPT } from '../../src/sim/map/sculpt';
import { RoadType } from '../../src/sim/roads/types';
import { Sim } from '../../src/sim/sim';
import { ZoneType, zoneCode } from '../../src/sim/zoning/zones';

function flat(): Sim {
  const sim = Sim.create(5);
  sim.state.heights.fill(5);
  sim.state.trees.fill(0);
  return sim;
}

const h = (sim: Sim, x: number, z: number): number => sim.state.heights[Math.round(z / CELL) * VERTS + Math.round(x / CELL)]!;

/** Holds the brush down: `n` strokes at full strength. */
function strokes(sim: Sim, n: number, x: number, z: number, mode: 'raise' | 'lower' | 'flatten' | 'smooth', radius = 64, target?: number): void {
  for (let k = 0; k < n; k++) sim.apply({ type: 'sculpt', x, z, radius, mode, strength: 1, target });
}

describe('the terrain brush', () => {
  it('raises a smooth hill, highest in the middle, and charges for the earth moved', () => {
    const sim = flat();
    const funds = sim.state.funds;
    const r = sim.apply({ type: 'sculpt', x: 800, z: 800, radius: 64, mode: 'raise', strength: 1 });
    expect(r.ok).toBe(true);
    expect(r.cost).toBeGreaterThan(0);
    expect(sim.state.funds).toBe(funds - r.cost!);
    strokes(sim, 40, 800, 800, 'raise');
    expect(h(sim, 800, 800)).toBeGreaterThan(h(sim, 800, 832));
    expect(h(sim, 800, 832)).toBeGreaterThan(h(sim, 800, 856));
    expect(h(sim, 800, 900)).toBe(5);
    expect(h(sim, 800, 800)).toBeGreaterThan(15);
  });

  it('keeps every slope it makes walkable', () => {
    const sim = flat();
    strokes(sim, 200, 800, 800, 'raise', 24);
    const H = sim.state.heights;
    let worst = 0;
    for (let j = 90; j < 110; j++) for (let i = 90; i < 110; i++) worst = Math.max(worst, Math.abs(H[j * VERTS + i]! - H[j * VERTS + i + 1]!), Math.abs(H[j * VERTS + i]! - H[(j + 1) * VERTS + i]!));
    expect(worst).toBeLessThanOrEqual(SCULPT.maxStep + 1e-3);
  });

  it('leaves the ground under roads alone, so a hill banks up beside a road instead of burying it', () => {
    const sim = flat();
    sim.apply({ type: 'buildRoad', road: RoadType.Street, ax: 640, az: 800, bx: 960, bz: 800 });
    const lock = sim.state.roadLock;
    const before = sim.state.heights.slice();
    strokes(sim, 40, 800, 810, 'raise');
    for (let k = 0; k < lock.length; k++) if (lock[k]) expect(sim.state.heights[k]).toBe(before[k]);
    expect(h(sim, 800, 840)).toBeGreaterThan(6);
  });

  it('never digs new water', () => {
    const sim = flat();
    strokes(sim, 80, 800, 800, 'lower');
    let low = Infinity;
    for (const v of sim.state.heights) low = Math.min(low, v);
    expect(low).toBeGreaterThanOrEqual(SCULPT.minLand - 1e-6);
    expect(sim.apply({ type: 'sculpt', x: 800, z: 800, radius: 24, mode: 'lower', strength: 1 }).ok).toBe(false);
  });

  it('flattens a hilltop into a terrace that a road can climb to and houses can grow on', () => {
    const sim = flat();
    sim.state.sandbox = true;
    sim.growthRate = 1;
    strokes(sim, 60, 800, 800, 'raise', 64);
    const top = h(sim, 800, 800);
    // Cut the peak down to a terrace: everything within reach that stood above it comes down.
    const level = top - 8;
    strokes(sim, 30, 800, 800, 'flatten', 40, level);
    expect(Math.abs(h(sim, 800, 800) - level)).toBeLessThan(0.5);
    expect(Math.abs(h(sim, 816, 800) - level)).toBeLessThan(0.5);
    expect(Math.abs(h(sim, 800, 784) - level)).toBeLessThan(0.5);
    // A road climbs onto it at an angle, and homes grow beside the road up there.
    const road = sim.apply({ type: 'buildRoad', road: RoadType.Street, ax: 800, az: 680, bx: 800, bz: 820 });
    expect(road.ok, road.reason).toBe(true);
    sim.apply({ type: 'zoneRect', x0: 101, y0: 92, x1: 103, y1: 102, zone: zoneCode(ZoneType.Residential, 1) });
    for (let t = 0; t < 4000; t++) sim.tick();
    const up = sim.state.buildings.filter((b) => b && b.baseY > 8);
    expect(up.length).toBeGreaterThan(0);
  });
});
