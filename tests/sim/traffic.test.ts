import { describe, expect, it } from 'vitest';
import { RoadType } from '../../src/sim/roads/types';
import { Sim } from '../../src/sim/sim';
import { findPath } from '../../src/sim/traffic/pathfinder';
import { ZoneType, zoneCode } from '../../src/sim/zoning/zones';

const R2 = zoneCode(ZoneType.Residential, 2);
const I1 = zoneCode(ZoneType.Industrial, 1);
const C1 = zoneCode(ZoneType.Commercial, 1);

function flat(): Sim {
  const sim = Sim.create(11);
  sim.state.heights.fill(5);
  sim.state.trees.fill(0);
  sim.state.sandbox = true;
  return sim;
}

const road = (sim: Sim, ax: number, az: number, bx: number, bz: number, type = RoadType.Street) =>
  sim.apply({ type: 'buildRoad', road: type, ax, az, bx, bz });

/**
 * A ladder: two long east-west streets joined by three cross streets, homes at the west
 * end and workplaces at the east end, so every trip has to cross junctions.
 */
function commuterTown(): Sim {
  const sim = flat();
  road(sim, 400, 400, 1040, 400);
  road(sim, 400, 560, 1040, 560);
  road(sim, 480, 400, 480, 560);
  road(sim, 720, 400, 720, 560);
  road(sim, 960, 400, 960, 560);
  sim.growthRate = 1;
  sim.apply({ type: 'zoneRect', x0: 51, y0: 45, x1: 82, y1: 48, zone: R2 });
  sim.apply({ type: 'zoneRect', x0: 51, y0: 72, x1: 82, y1: 75, zone: R2 });
  sim.apply({ type: 'zoneRect', x0: 96, y0: 45, x1: 128, y1: 48, zone: I1 });
  sim.apply({ type: 'zoneRect', x0: 96, y0: 72, x1: 128, y1: 75, zone: C1 });
  return sim;
}

function run(sim: Sim, ticks: number): void {
  for (let i = 0; i < ticks; i++) sim.tick();
}

describe('pathfinding', () => {
  it('returns the node sequence of the shortest route', () => {
    const sim = flat();
    // A square block 400..720 with one diagonal-free detour: path must go round a corner.
    road(sim, 400, 400, 720, 400); // edge 0 (top)
    road(sim, 720, 400, 720, 720); // right
    road(sim, 400, 400, 400, 720); // left
    road(sim, 400, 720, 720, 720); // bottom
    const net = sim.state.roads;
    const top = 0;
    const bottom = net.edges.findIndex((e) => e && net.nodes[e.a]!.z === 720 && net.nodes[e.b]!.z === 720);
    // From near the left end of the top street to near the left end of the bottom one:
    // the quick way is via the top-left and bottom-left corners.
    const path = findPath(net, top, 40, bottom, 40)!;
    expect(path.length).toBe(2);
    expect(net.nodes[path[0]!]).toMatchObject({ x: 400, z: 400 });
    expect(net.nodes[path[1]!]).toMatchObject({ x: 400, z: 720 });
    // And from the right ends it goes round the right side.
    const right = findPath(net, top, 290, bottom, 290)!;
    expect(net.nodes[right[0]!]).toMatchObject({ x: 720, z: 400 });
    expect(findPath(net, top, 10, top, 200)).toEqual([]);
  });

  it('returns null when the destination cannot be reached', () => {
    const sim = flat();
    road(sim, 400, 400, 720, 400);
    road(sim, 400, 800, 720, 800);
    expect(findPath(sim.state.roads, 0, 50, 1, 50)).toBeNull();
  });

  it('avoids congested edges when a detour is quicker', () => {
    const sim = flat();
    road(sim, 400, 400, 720, 400);
    road(sim, 720, 400, 720, 720);
    road(sim, 400, 400, 400, 720);
    road(sim, 400, 720, 720, 720);
    const net = sim.state.roads;
    const bottom = net.edges.findIndex((e) => e && net.nodes[e.a]!.z === 720 && net.nodes[e.b]!.z === 720);
    const left = net.edges.findIndex((e) => e && net.nodes[e.a]!.x === 400 && net.nodes[e.b]!.x === 400);
    const slow = new Float32Array(net.edges.length);
    slow[left] = 20;
    const path = findPath(net, 0, 140, bottom, 140, slow)!;
    expect(net.nodes[path[0]!]).toMatchObject({ x: 720, z: 400 });
  });
});

describe('traffic', () => {
  it('puts cars on the road once people have somewhere to go, and they arrive', () => {
    const sim = commuterTown();
    run(sim, 2600);
    const t = sim.traffic;
    expect(sim.state.stats.population).toBeGreaterThan(100);
    expect(t.count).toBeGreaterThan(5);
    expect(t.arrived).toBeGreaterThan(10);
    for (let i = 0; i < t.count; i++) {
      expect(Number.isFinite(t.x[i]!)).toBe(true);
      expect(Number.isFinite(t.heading[i]!)).toBe(true);
      expect(t.y[i]).toBeCloseTo(5, 1);
    }
  });

  it('keeps cars to the right of the centreline', () => {
    const sim = commuterTown();
    run(sim, 2600);
    const t = sim.traffic;
    const net = sim.state.roads;
    let checked = 0;
    for (let i = 0; i < t.count; i++) {
      const d = t.debug(i);
      if (d.mode !== 0) continue;
      const e = net.edges[d.edge]!;
      const a = net.nodes[e.a]!;
      const b = net.nodes[e.b]!;
      // Only straight edges here: side of the a->b line the car is on.
      const cross = (b.x - a.x) * (t.z[i]! - a.z) - (b.z - a.z) * (t.x[i]! - a.x);
      // Travelling a->b the car is on the right (positive cross with +z south); b->a, left.
      expect(Math.sign(cross)).toBe(d.dir === 0 ? 1 : -1);
      expect(Math.abs(cross) / e.length).toBeCloseTo(1.75, 1);
      checked++;
    }
    expect(checked).toBeGreaterThan(3);
  });

  it('never lets two cars in one lane overlap', () => {
    const sim = commuterTown();
    let worst = Infinity;
    for (let step = 0; step < 60; step++) {
      run(sim, 50);
      const t = sim.traffic;
      const lanes = new Map<string, number[]>();
      for (let i = 0; i < t.count; i++) {
        const d = t.debug(i);
        if (d.mode !== 0) continue;
        const key = `${d.edge}:${d.dir}:${d.lane}`;
        (lanes.get(key) ?? lanes.set(key, []).get(key)!).push(d.s);
      }
      for (const list of lanes.values()) {
        list.sort((a, b) => a - b);
        for (let k = 1; k < list.length; k++) worst = Math.min(worst, list[k]! - list[k - 1]!);
      }
    }
    // Car bodies are 4.4 m long.
    expect(worst).toBeGreaterThan(4.4);
  });

  it('queues at junctions without gridlock: trips keep completing', () => {
    const sim = commuterTown();
    run(sim, 3000);
    const before = sim.traffic.arrived;
    run(sim, 2000);
    expect(sim.traffic.arrived - before).toBeGreaterThan(8);
    expect(sim.traffic.congestion).toBeGreaterThanOrEqual(0);
    expect(sim.traffic.congestion).toBeLessThan(0.9);
  });

  it('is deterministic and clears when the roads change', () => {
    const a = commuterTown();
    const b = commuterTown();
    run(a, 2200);
    run(b, 2200);
    expect(a.traffic.count).toBe(b.traffic.count);
    expect(Array.from(a.traffic.x.subarray(0, a.traffic.count))).toEqual(Array.from(b.traffic.x.subarray(0, b.traffic.count)));
    expect(a.traffic.count).toBeGreaterThan(0);
    road(a, 400, 720, 1040, 720);
    expect(a.traffic.count).toBe(0);
    run(a, 400);
    expect(a.traffic.count).toBeGreaterThan(0);
  });
});
