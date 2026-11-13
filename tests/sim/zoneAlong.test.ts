import { describe, expect, it } from 'vitest';
import { MAP } from '../../src/core/constants';
import { RoadType } from '../../src/sim/roads/types';
import { Sim } from '../../src/sim/sim';
import { ZoneType, zoneCode } from '../../src/sim/zoning/zones';

/** A sandbox city (no utilities needed) with one road laid as the given polyline. */
function cityWith(points: Array<[number, number]>): Sim {
  const sim = Sim.create(1337);
  sim.state.sandbox = true;
  for (let n = 0; n + 1 < points.length; n++) {
    const [ax, az] = points[n]!;
    const [bx, bz] = points[n + 1]!;
    const r = sim.apply({ type: 'buildRoad', road: RoadType.Street, ax, az, bx, bz });
    expect(r.reason ?? 'ok').toBe('ok');
  }
  return sim;
}

function edges(sim: Sim): number[] {
  return sim.state.roads.edges.filter((e) => e).map((e) => e!.id);
}

function grow(sim: Sim, ticks = 2500): { zoned: number; built: number } {
  for (let i = 0; i < ticks; i++) sim.tick();
  let zoned = 0;
  let built = 0;
  for (let k = 0; k < MAP * MAP; k++) {
    if (sim.state.zone[k] === 0) continue;
    zoned++;
    if (sim.state.buildingCell[k]! >= 0) built++;
  }
  return { zoned, built };
}

describe('zoning along a road', () => {
  it('zones both sides of a diagonal road and the land fills with homes', () => {
    const sim = cityWith([[1100, 450], [1380, 730]]);
    const r = sim.apply({ type: 'zoneAlong', edges: edges(sim), zone: zoneCode(ZoneType.Residential, 1) });
    expect(r.ok).toBe(true);
    expect(r.count).toBeGreaterThan(80);
    const { zoned, built } = grow(sim);
    expect(built / zoned).toBeGreaterThan(0.7);
  });

  it('fills a zigzag road', () => {
    const sim = cityWith([[900, 1000], [1000, 1060], [1100, 990], [1200, 1070], [1300, 1000]]);
    sim.apply({ type: 'zoneAlong', edges: edges(sim), zone: zoneCode(ZoneType.Commercial, 1) });
    const { zoned, built } = grow(sim);
    expect(zoned).toBeGreaterThan(100);
    expect(built / zoned).toBeGreaterThan(0.6);
  });

  it('never demolishes, and clears zoning with zone 0', () => {
    const sim = cityWith([[960, 1000], [1240, 1000]]);
    const e = edges(sim);
    sim.apply({ type: 'zoneAlong', edges: e, zone: zoneCode(ZoneType.Residential, 1) });
    grow(sim, 150);
    const before = sim.state.buildings.filter((b) => b).length;
    expect(before).toBeGreaterThan(0);
    sim.apply({ type: 'zoneAlong', edges: e, zone: zoneCode(ZoneType.Industrial, 1) });
    expect(sim.state.buildings.filter((b) => b).length).toBe(before);
    const free = (): number => {
      let n = 0;
      for (let k = 0; k < MAP * MAP; k++) if (sim.state.zone[k] !== 0 && sim.state.buildingCell[k]! < 0 && sim.state.roadCell[k]! < 0) n++;
      return n;
    };
    const waiting = free();
    const clear = sim.apply({ type: 'zoneAlong', edges: e, zone: 0 });
    expect(clear.ok).toBe(waiting > 0);
    expect(free()).toBe(0);
    expect(sim.state.buildings.filter((b) => b).length).toBe(before);
  });
});
