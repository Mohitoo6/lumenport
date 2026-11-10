import { describe, expect, it } from 'vitest';
import { MAP, TICKS_PER_DAY, VERTS } from '../../src/core/constants';
import { Rng } from '../../src/core/rng';
import { RoadType } from '../../src/sim/roads/types';
import { Sim } from '../../src/sim/sim';
import { buildFrontier } from '../../src/sim/zoning/growth';
import { findLot, frontageOf } from '../../src/sim/zoning/lots';
import { Facing, ZoneType, buildDays, stageOf, zoneCode, zoneDensity, zoneType, type Building } from '../../src/sim/zoning/zones';

const R1 = zoneCode(ZoneType.Residential, 1);
const C3 = zoneCode(ZoneType.Commercial, 3);

/** Flat dry map with one east-west street along z = 400 (cells j = 49 and 50). */
function town(): Sim {
  const sim = Sim.create(3);
  sim.state.heights.fill(5);
  sim.state.trees.fill(0);
  sim.apply({ type: 'buildRoad', road: RoadType.Street, ax: 400, az: 400, bx: 720, bz: 400 });
  return sim;
}

function run(sim: Sim, ticks: number): void {
  for (let i = 0; i < ticks; i++) sim.tick();
}

const alive = (sim: Sim): Building[] => sim.state.buildings.filter((b): b is Building => b !== null);

describe('zone codes', () => {
  it('round-trip type and density', () => {
    expect(zoneType(C3)).toBe(ZoneType.Commercial);
    expect(zoneDensity(C3)).toBe(3);
    expect(zoneCode(ZoneType.None, 2)).toBe(0);
    expect(stageOf(0)).toBe(0);
    expect(stageOf(0.5)).toBe(2);
    expect(stageOf(1)).toBe(4);
  });
});

describe('zoning', () => {
  it('paints cells but never roads or water', () => {
    const sim = town();
    const h = sim.state.heights;
    for (let j = 60; j <= 62; j++) for (let i = 0; i < VERTS; i++) h[j * VERTS + i] = -2;
    expect(sim.apply({ type: 'zoneRect', x0: 52, y0: 46, x1: 60, y1: 64, zone: R1 }).ok).toBe(true);
    const z = sim.state.zone;
    expect(z[47 * MAP + 55]).toBe(R1);
    expect(z[49 * MAP + 55]).toBe(0); // road
    expect(z[50 * MAP + 55]).toBe(0); // road
    expect(z[60 * MAP + 55]).toBe(0); // water
    expect(z[64 * MAP + 55]).toBe(R1);
  });

  it('rejects invalid codes and empty paints', () => {
    const sim = town();
    expect(sim.apply({ type: 'zoneRect', x0: 52, y0: 46, x1: 60, y1: 48, zone: 3 }).ok).toBe(false);
    expect(sim.apply({ type: 'zoneRect', x0: 52, y0: 49, x1: 60, y1: 50, zone: R1 }).ok).toBe(false);
  });
});

describe('lots', () => {
  it('finds frontage on the side that touches the road', () => {
    const sim = town();
    sim.apply({ type: 'zoneRect', x0: 52, y0: 44, x1: 80, y1: 55, zone: R1 });
    expect(frontageOf(sim.state, 55, 48)).toBe(Facing.South);
    expect(frontageOf(sim.state, 55, 51)).toBe(Facing.North);
    expect(frontageOf(sim.state, 55, 46)).toBe(-1);
  });

  it('returns lots that face the road, stay in their zone and avoid roads', () => {
    const sim = town();
    sim.apply({ type: 'zoneRect', x0: 52, y0: 44, x1: 80, y1: 55, zone: R1 });
    const rng = new Rng(9);
    for (let i = 54; i < 78; i += 3) {
      const lot = findLot(sim.state, i, 48, rng)!;
      expect(lot).not.toBeNull();
      expect(lot.facing).toBe(Facing.South);
      // Front row is the row next to the road.
      expect(lot.y + lot.h - 1).toBe(48);
      expect(lot.h).toBeLessThanOrEqual(4);
      for (let y = lot.y; y < lot.y + lot.h; y++) {
        for (let x = lot.x; x < lot.x + lot.w; x++) {
          expect(sim.state.zone[y * MAP + x]).toBe(R1);
          expect(sim.state.roadCell[y * MAP + x]).toBe(-1);
        }
      }
    }
    expect(findLot(sim.state, 55, 46, rng)).toBeNull();
  });

  it('lists only road-side zoned cells as frontier', () => {
    const sim = town();
    sim.apply({ type: 'zoneRect', x0: 52, y0: 44, x1: 61, y1: 48, zone: R1 });
    const frontier = buildFrontier(sim.state);
    expect(frontier.length).toBe(10);
    for (const k of frontier) expect((k / MAP) | 0).toBe(48);
  });
});

describe('growth', () => {
  it('fills zoned land along a road and nowhere else', () => {
    const sim = town();
    sim.apply({ type: 'zoneRect', x0: 52, y0: 40, x1: 86, y1: 59, zone: R1 });
    run(sim, 1200);
    const list = alive(sim);
    expect(list.length).toBeGreaterThan(8);
    const cell = sim.state.buildingCell;
    for (const b of list) {
      expect(b.zone).toBe(R1);
      // Within four cells of the street on its own side.
      if (b.facing === Facing.South) expect(b.y).toBeGreaterThanOrEqual(45);
      else expect(b.y + b.h).toBeLessThanOrEqual(55);
      for (let j = b.y; j < b.y + b.h; j++) for (let i = b.x; i < b.x + b.w; i++) expect(cell[j * MAP + i]).toBe(b.id);
    }
    // No two buildings share a cell: total claimed cells equals the sum of lot areas.
    let claimed = 0;
    for (const v of cell) if (v >= 0) claimed++;
    expect(claimed).toBe(list.reduce((n, b) => n + b.w * b.h, 0));
  });

  it('takes the stated number of days to build and reports stage changes', () => {
    const sim = town();
    sim.growthRate = 1;
    sim.apply({ type: 'zoneRect', x0: 52, y0: 46, x1: 60, y1: 48, zone: R1 });
    const stages: number[] = [];
    let first = -1;
    sim.events.on('buildingsChanged', (e) => {
      if (first < 0 && e.changed.length) first = e.changed[0]!;
      if (e.changed.includes(first)) stages.push(stageOf(sim.state.buildings[first]!.progress));
    });
    run(sim, 8);
    expect(first).toBeGreaterThanOrEqual(0);
    run(sim, buildDays(R1) * TICKS_PER_DAY + 2);
    expect(sim.state.buildings[first]!.progress).toBe(1);
    expect(stages).toEqual([0, 1, 2, 3, 4]);
    expect(sim.state.constructing.includes(first)).toBe(false);
  });

  it('levels a pad under each building', () => {
    const sim = town();
    const h = sim.state.heights;
    for (let j = 30; j < 47; j++) for (let i = 0; i < VERTS; i++) h[j * VERTS + i] = 5 + (47 - j) * 0.2;
    sim.growthRate = 1;
    sim.apply({ type: 'zoneRect', x0: 52, y0: 44, x1: 70, y1: 48, zone: R1 });
    run(sim, 200);
    const b = alive(sim)[0]!;
    let lo = Infinity;
    let hi = -Infinity;
    for (let j = b.y; j <= b.y + b.h; j++) {
      for (let i = b.x; i <= b.x + b.w; i++) {
        lo = Math.min(lo, h[j * VERTS + i]!);
        hi = Math.max(hi, h[j * VERTS + i]!);
      }
    }
    expect(hi - lo).toBeLessThan(0.5);
    expect(b.baseY).toBeGreaterThanOrEqual(hi);
  });

  it('is deterministic', () => {
    const a = town();
    const b = town();
    for (const sim of [a, b]) {
      sim.apply({ type: 'zoneRect', x0: 52, y0: 40, x1: 86, y1: 59, zone: C3 });
      run(sim, 900);
    }
    expect(JSON.stringify(a.state.buildings)).toBe(JSON.stringify(b.state.buildings));
    expect(a.state.rng).toBe(b.state.rng);
  });

  it('upgrades finished buildings over time', () => {
    const sim = town();
    sim.apply({ type: 'zoneRect', x0: 52, y0: 44, x1: 86, y1: 55, zone: R1 });
    run(sim, 9000);
    expect(alive(sim).some((b) => b.level > 1)).toBe(true);
  });
});

describe('clearing', () => {
  it('re-zoning or bulldozing removes buildings and frees their cells', () => {
    const sim = town();
    sim.growthRate = 1;
    sim.apply({ type: 'zoneRect', x0: 52, y0: 44, x1: 70, y1: 48, zone: R1 });
    run(sim, 400);
    const before = alive(sim).length;
    expect(before).toBeGreaterThan(2);
    const id = alive(sim)[0]!.id;
    expect(sim.apply({ type: 'bulldozeBuilding', id }).ok).toBe(true);
    expect(alive(sim).length).toBe(before - 1);
    expect(sim.state.buildingCell.includes(id)).toBe(false);
    expect(sim.apply({ type: 'bulldozeBuilding', id }).ok).toBe(false);

    sim.growthRate = 0;
    sim.apply({ type: 'zoneRect', x0: 52, y0: 44, x1: 70, y1: 48, zone: 0 });
    expect(alive(sim).length).toBe(0);
    expect(sim.state.zone[47 * MAP + 55]).toBe(0);
  });

  it('a new road clears the zoning and buildings in its way', () => {
    const sim = town();
    sim.growthRate = 1;
    sim.apply({ type: 'zoneRect', x0: 52, y0: 44, x1: 86, y1: 48, zone: R1 });
    run(sim, 600);
    const removed: number[] = [];
    sim.events.on('buildingsChanged', (e) => removed.push(...e.removed.map((b) => b.id)));
    expect(sim.apply({ type: 'buildRoad', road: RoadType.Street, ax: 560, az: 400, bx: 560, bz: 240 }).ok).toBe(true);
    expect(removed.length).toBeGreaterThan(0);
    for (let j = 40; j < 49; j++) {
      for (const i of [69, 70]) {
        expect(sim.state.zone[j * MAP + i]).toBe(0);
        expect(sim.state.buildingCell[j * MAP + i]).toBe(-1);
      }
    }
  });
});
