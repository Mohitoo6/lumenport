import { describe, expect, it } from 'vitest';
import { CELL, MAP } from '../../src/core/constants';
import { FacilityKind } from '../../src/sim/facilities';
import { RoadType } from '../../src/sim/roads/types';
import { Sim } from '../../src/sim/sim';
import { ZoneType, zoneCode } from '../../src/sim/zoning/zones';

function founded(): { sim: Sim; id: number } {
  const sim = Sim.create(1337);
  expect(sim.apply({ type: 'foundTownHall' }).ok).toBe(true);
  const b = sim.state.buildings.find((x) => x && x.kind === FacilityKind.TownHall)!;
  return { sim, id: b.id };
}

describe('town hall', () => {
  it('stands, finished, on flat dry land near the centre without needing a road', () => {
    const { sim, id } = founded();
    const b = sim.state.buildings[id]!;
    expect(b.progress).toBe(1);
    expect(b.w).toBe(4);
    expect(sim.state.constructing).not.toContain(id);
    expect(Math.hypot((b.x + 2 - MAP / 2) * CELL, (b.y + 2 - MAP / 2) * CELL)).toBeLessThan(500);
    expect(b.baseY).toBeGreaterThan(1);
    expect(sim.state.roads.edges.length).toBe(0);
  });

  it('is one per city and cannot be demolished', () => {
    const { sim, id } = founded();
    expect(sim.apply({ type: 'foundTownHall' }).ok).toBe(false);
    expect(sim.apply({ type: 'placeFacility', kind: FacilityKind.TownHall, x: 40, y: 40 }).ok).toBe(false);
    const r = sim.apply({ type: 'bulldozeBuilding', id });
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/cannot be demolished/);
    expect(sim.state.buildings[id]).not.toBeNull();
  });

  it('cannot be zoned over or run through by a road', () => {
    const { sim, id } = founded();
    const b = sim.state.buildings[id]!;
    // A road alongside, so zoning there is allowed in principle.
    const z = (b.y + b.h + 2) * CELL;
    const along = sim.apply({ type: 'buildRoad', road: RoadType.Street, ax: (b.x - 6) * CELL, az: z, bx: (b.x + 10) * CELL, bz: z });
    expect(along.reason ?? 'ok').toBe('ok');
    sim.apply({ type: 'zoneRect', x0: b.x - 2, y0: b.y - 2, x1: b.x + 6, y1: b.y + 6, zone: zoneCode(ZoneType.Residential, 1) });
    expect(sim.state.buildings[id]).not.toBeNull();
    expect(sim.state.zone[(b.y + 1) * MAP + b.x + 1]).toBe(0);
    const through = sim.apply({ type: 'buildRoad', road: RoadType.Street, ax: (b.x + 2) * CELL, az: (b.y - 10) * CELL, bx: (b.x + 2) * CELL, bz: (b.y - 1) * CELL + 20 });
    expect(through.ok).toBe(false);
    expect(through.reason).toMatch(/town hall/);
  });
});
