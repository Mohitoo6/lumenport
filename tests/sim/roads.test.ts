import { describe, expect, it } from 'vitest';
import { CELL, MAP, VERTS } from '../../src/core/constants';
import { bezLength, crossings, flatten, subControl, bezX } from '../../src/sim/roads/geometry';
import { countEdges, countNodes, edgePolyline } from '../../src/sim/roads/graph';
import { edgeAt, snapToNetwork } from '../../src/sim/roads/plan';
import { ROAD_BED_DROP } from '../../src/sim/roads/terraform';
import { RoadType } from '../../src/sim/roads/types';
import { Sim } from '../../src/sim/sim';

/** A sim with flat dry ground, so road rules can be tested without terrain getting in the way. */
function flatSim(height = 5): Sim {
  const sim = Sim.create(1);
  sim.state.heights.fill(height);
  sim.state.trees.fill(0);
  return sim;
}

function build(sim: Sim, ax: number, az: number, bx: number, bz: number, road = RoadType.Street, cx?: number, cz?: number) {
  return sim.apply({ type: 'buildRoad', road, ax, az, bx, bz, cx, cz });
}

describe('curve geometry', () => {
  it('measures a straight Bezier exactly', () => {
    expect(bezLength(0, 0, 50, 0, 100, 0)).toBeCloseTo(100, 6);
  });

  it('finds where two lines cross', () => {
    const a = flatten(0, 50, 50, 50, 100, 50, 3, true);
    const b = flatten(40, 0, 40, 50, 40, 100, 3, true);
    const out = crossings(a, b, []);
    expect(out.length).toBe(1);
    expect(out[0]!.x).toBeCloseTo(40, 6);
    expect(out[0]!.z).toBeCloseTo(50, 6);
    expect(out[0]!.tA).toBeCloseTo(0.4, 6);
    expect(out[0]!.tB).toBeCloseTo(0.5, 6);
  });

  it('subdivides a curve into pieces that lie on the original', () => {
    const [a, c, b] = [0, 80, 100];
    const c1 = subControl(a, c, b, 0.25, 0.75);
    const p0 = bezX(a, c, b, 0.25);
    const p1 = bezX(a, c, b, 0.75);
    // Midpoint of the sub-curve equals the original at t = 0.5.
    expect(bezX(p0, c1, p1, 0.5)).toBeCloseTo(bezX(a, c, b, 0.5), 9);
  });
});

describe('building roads', () => {
  it('creates two nodes and an edge for a first road', () => {
    const sim = flatSim();
    const r = build(sim, 400, 400, 560, 400);
    expect(r.ok).toBe(true);
    expect(r.cost).toBe(160 * 20);
    const net = sim.state.roads;
    expect(countNodes(net)).toBe(2);
    expect(countEdges(net)).toBe(1);
    expect(net.edges[0]!.length).toBeCloseTo(160, 6);
  });

  it('rejects roads that are too short, off the map or in water', () => {
    const sim = flatSim();
    expect(build(sim, 400, 400, 404, 400).reason).toBe('Too short');
    expect(build(sim, 4, 400, 200, 400).reason).toBe('Outside the city limits');
    sim.state.heights.fill(-3);
    expect(build(sim, 400, 400, 560, 400).reason).toBe('Roads must start and end on dry land');
  });

  it('splits a road it crosses and makes a four-way junction', () => {
    const sim = flatSim();
    build(sim, 400, 400, 720, 400);
    expect(build(sim, 560, 240, 560, 560).ok).toBe(true);
    const net = sim.state.roads;
    expect(countEdges(net)).toBe(4);
    expect(countNodes(net)).toBe(5);
    const centre = net.nodes.find((n) => n && n.x === 560 && n.z === 400)!;
    expect(centre.edges.length).toBe(4);
    // The split halves keep the original length between them.
    const lens = centre.edges.map((id) => net.edges[id]!.length).sort((a, b) => a - b);
    expect(lens).toEqual([160, 160, 160, 160]);
  });

  it('makes a T-junction when a road ends on another', () => {
    const sim = flatSim();
    build(sim, 400, 400, 720, 400);
    expect(build(sim, 560, 600, 560, 402).ok).toBe(true);
    const net = sim.state.roads;
    expect(countEdges(net)).toBe(3);
    const tee = net.nodes.find((n) => n && n.edges.length === 3)!;
    expect(tee.x).toBeCloseTo(560, 6);
    expect(tee.z).toBeCloseTo(400, 6);
  });

  it('attaches to an existing end node instead of making a sliver', () => {
    const sim = flatSim();
    build(sim, 400, 400, 720, 400);
    // Starts 5 m from the end node: snaps onto it.
    expect(build(sim, 724, 403, 724, 600).ok).toBe(true);
    const net = sim.state.roads;
    expect(countNodes(net)).toBe(3);
    expect(net.nodes[1]!.edges.length).toBe(2);
  });

  it('passes through an existing node without duplicating it', () => {
    const sim = flatSim();
    build(sim, 400, 400, 560, 400);
    build(sim, 560, 400, 720, 400);
    expect(build(sim, 560, 240, 560, 560).ok).toBe(true);
    const net = sim.state.roads;
    expect(countNodes(net)).toBe(5);
    expect(countEdges(net)).toBe(4);
    expect(net.nodes[1]!.edges.length).toBe(4);
  });

  it('handles several crossings in one stroke', () => {
    const sim = flatSim();
    build(sim, 400, 300, 400, 700);
    build(sim, 560, 300, 560, 700);
    build(sim, 720, 300, 720, 700);
    expect(build(sim, 320, 500, 800, 500).ok).toBe(true);
    const net = sim.state.roads;
    expect(countEdges(net)).toBe(3 * 2 + 4);
    expect(net.nodes.filter((n) => n && n.edges.length === 4).length).toBe(3);
  });

  it('refuses overlapping, too-close and too-sharp roads', () => {
    const sim = flatSim();
    build(sim, 400, 400, 720, 400);
    expect(build(sim, 440, 408, 680, 408).ok).toBe(false);
    expect(build(sim, 400, 400, 720, 430).reason).toBe('Too sharp an angle with the existing road');
    // A parallel street one road-width away is fine.
    expect(build(sim, 400, 416, 720, 416).ok).toBe(true);
  });

  it('refuses slopes that are too steep', () => {
    const sim = flatSim();
    const h = sim.state.heights;
    for (let j = 0; j < VERTS; j++) for (let i = 0; i < VERTS; i++) h[j * VERTS + i] = 5 + i * CELL * 0.3;
    expect(build(sim, 400, 400, 560, 400).reason).toBe('Too steep here');
    expect(build(sim, 400, 400, 400, 560).ok).toBe(true);
  });

  it('builds curved roads and splits them exactly', () => {
    const sim = flatSim();
    expect(build(sim, 400, 400, 600, 600, RoadType.Street, 600, 400).ok).toBe(true);
    const net = sim.state.roads;
    const before = net.edges[0]!.length;
    expect(before).toBeGreaterThan(Math.hypot(200, 200));
    expect(build(sim, 480, 300, 480, 600).ok).toBe(true);
    const parts = net.edges.filter((e) => e && e.curved).map((e) => e!.length);
    expect(parts.length).toBe(2);
    expect(parts[0]! + parts[1]!).toBeCloseTo(before, 1);
  });

  it('bridges water between two banks and charges more for it', () => {
    const sim = flatSim(4);
    const h = sim.state.heights;
    for (let j = 0; j < VERTS; j++) for (let i = 60; i <= 66; i++) h[j * VERTS + i] = -4;
    const plan = sim.planRoad({ road: RoadType.Street, ax: 400, az: 400, bx: 600, bz: 400 });
    expect(plan.ok).toBe(true);
    expect(plan.bridgeLength).toBeGreaterThan(40);
    expect(plan.cost).toBeGreaterThan(200 * 20);
    expect(build(sim, 400, 400, 600, 400).ok).toBe(true);
    // The river bed was not filled in.
    expect(h[50 * VERTS + 63]).toBe(-4);
  });
});

describe('road side effects', () => {
  it('grades the terrain just below the road and marks road cells', () => {
    const sim = flatSim();
    const h = sim.state.heights;
    for (let j = 0; j < VERTS; j++) for (let i = 0; i < VERTS; i++) h[j * VERTS + i] = 5 + Math.sin(i * 0.7) * 0.8 + Math.cos(j * 0.9) * 0.8;
    expect(build(sim, 400, 400, 560, 400).ok).toBe(true);
    const net = sim.state.roads;
    const e = net.edges[0]!;
    const ya = net.nodes[e.a]!.y;
    const yb = net.nodes[e.b]!.y;
    for (let i = 50; i <= 70; i++) {
      const t = (i * CELL - 400) / 160;
      const road = ya + (yb - ya) * t;
      for (let j = 49; j <= 51; j++) expect(h[j * VERTS + i]).toBeCloseTo(road - ROAD_BED_DROP, 4);
    }
    const cell = sim.state.roadCell;
    expect(cell[49 * MAP + 55]).toBe(e.id);
    expect(cell[50 * MAP + 55]).toBe(e.id);
    expect(cell[48 * MAP + 55]).toBe(-1);
    expect(cell[51 * MAP + 55]).toBe(-1);
  });

  it('clears trees under the road', () => {
    const sim = flatSim();
    sim.state.trees.fill(5);
    build(sim, 400, 400, 560, 400);
    expect(sim.state.trees[49 * MAP + 55]).toBe(0);
    expect(sim.state.trees[50 * MAP + 55]).toBe(0);
    expect(sim.state.trees[40 * MAP + 55]).toBe(5);
  });

  it('keeps existing roads level when a later road is graded next to them', () => {
    const sim = flatSim();
    build(sim, 400, 400, 720, 400);
    const snapshot = Array.from(sim.state.heights);
    build(sim, 560, 400, 560, 640);
    for (let i = 52; i <= 88; i++) expect(sim.state.heights[50 * VERTS + i]).toBe(snapshot[50 * VERTS + i]);
  });

  it('emits change events', () => {
    const sim = flatSim();
    const seen: string[] = [];
    sim.events.on('roadsChanged', () => seen.push('roads'));
    sim.events.on('terrainChanged', () => seen.push('terrain'));
    build(sim, 400, 400, 560, 400);
    expect(seen).toEqual(['terrain', 'roads']);
  });
});

describe('bulldozing roads', () => {
  it('removes an edge, its orphaned nodes and its cells', () => {
    const sim = flatSim();
    build(sim, 400, 400, 720, 400);
    build(sim, 560, 400, 560, 640);
    const net = sim.state.roads;
    const spur = edgeAt(net, 560, 520);
    expect(spur).toBeGreaterThanOrEqual(0);
    expect(sim.apply({ type: 'bulldozeRoad', edge: spur }).ok).toBe(true);
    expect(countEdges(net)).toBe(2);
    expect(countNodes(net)).toBe(3);
    expect(sim.state.roadCell[65 * MAP + 69]).toBe(-1);
    expect(sim.state.roadCell[49 * MAP + 60]).not.toBe(-1);
    expect(sim.apply({ type: 'bulldozeRoad', edge: spur }).ok).toBe(false);
  });

  it('lets a new road reuse the ground afterwards', () => {
    const sim = flatSim();
    build(sim, 400, 400, 720, 400);
    sim.apply({ type: 'bulldozeRoad', edge: 0 });
    expect(countNodes(sim.state.roads)).toBe(0);
    expect(build(sim, 400, 400, 720, 400).ok).toBe(true);
  });
});

describe('snapping', () => {
  it('prefers nodes, then roads, then leaves the point alone', () => {
    const sim = flatSim();
    build(sim, 400, 400, 720, 400);
    const net = sim.state.roads;
    expect(snapToNetwork(net, 405, 396).node).toBe(0);
    const onRoad = snapToNetwork(net, 561, 404);
    expect(onRoad.edge).toBe(0);
    expect(onRoad.x).toBeCloseTo(560, 6);
    expect(onRoad.z).toBeCloseTo(400, 6);
    const free = snapToNetwork(net, 560, 460);
    expect(free.node).toBe(-1);
    expect(free.edge).toBe(-1);
    expect(edgePolyline(net, net.edges[0]!).length).toBeCloseTo(320, 6);
  });
});
