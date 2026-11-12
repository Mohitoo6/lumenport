import { CELL, MAP } from '../../core/constants';
import { hash32 } from '../../core/rng';
import { capacityOf } from '../../sim/economy/capacity';
import { FACILITIES, FacilityKind } from '../../sim/facilities';
import { closestOnPolyline, newClosest } from '../../sim/roads/geometry';
import { edgePolyline } from '../../sim/roads/graph';
import { ROAD_SPECS, type RoadEdge } from '../../sim/roads/types';
import type { Sim } from '../../sim/sim';
import { ZoneType, zoneType, type Building } from '../../sim/zoning/zones';

/**
 * Helpers that turn simulation data into the plain facts ministers argue from: street
 * names, places, distances to clinics and schools, how many people live nearby.
 */

const STREET_NAMES = [
  'Station Road', 'Market Street', 'Lake View Avenue', 'Mill Road', 'Park Lane', 'Church Street',
  'Hill Road', 'Canal Street', 'College Road', 'Temple Road', 'Riverside Drive', 'King Street',
  'Bridge Road', 'Garden Avenue', 'Factory Lane', 'Harbour Road', 'Oak Street', 'Cedar Avenue',
  'Victoria Road', 'Gandhi Road', 'Nehru Avenue', 'Tagore Street', 'Ashoka Road', 'Lotus Lane',
];

const hit = newClosest();

/**
 * A stable name for a road. Straight roads are named by the line they lie on, so every
 * segment of one long road shares a name even after junctions split it.
 */
export function streetName(sim: Sim, edgeId: number): string {
  const net = sim.state.roads;
  const e = net.edges[edgeId];
  if (!e) return 'an old road';
  const a = net.nodes[e.a]!;
  const b = net.nodes[e.b]!;
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  let key: number;
  if (!e.curved && Math.abs(dz) < Math.abs(dx) * 0.08) key = 1000 + Math.round((a.z + b.z) / 2 / 16);
  else if (!e.curved && Math.abs(dx) < Math.abs(dz) * 0.08) key = 5000 + Math.round((a.x + b.x) / 2 / 16);
  else key = 9000 + Math.round((a.x + b.x) / 64) * 97 + Math.round((a.z + b.z) / 64);
  return STREET_NAMES[hash32(Math.imul(key, 2654435761) + sim.state.seed) % STREET_NAMES.length]!;
}

export function edgeMid(sim: Sim, e: RoadEdge): { x: number; z: number } {
  const p = edgePolyline(sim.state.roads, e);
  const k = Math.floor(p.n / 2);
  return { x: p.x[k]!, z: p.z[k]! };
}

/** Centre of the city: where people live, weighted by population. */
export function cityCentre(sim: Sim): { x: number; z: number } {
  let x = 0;
  let z = 0;
  let w = 0;
  for (const b of sim.state.buildings) {
    if (!b || b.kind !== 0 || b.pop <= 0) continue;
    x += (b.x + b.w / 2) * CELL * b.pop;
    z += (b.y + b.h / 2) * CELL * b.pop;
    w += b.pop;
  }
  return w > 0 ? { x: x / w, z: z / w } : { x: (MAP * CELL) / 2, z: (MAP * CELL) / 2 };
}

const COMPASS = ['east', 'south-east', 'south', 'south-west', 'west', 'north-west', 'north', 'north-east'];

/** "in the city centre" or "about 600 m north-east of the centre". */
export function describePlace(sim: Sim, x: number, z: number): string {
  const c = cityCentre(sim);
  const d = Math.hypot(x - c.x, z - c.z);
  if (d < 180) return 'in the city centre';
  // +x is east, +z is south.
  const a = Math.atan2(z - c.z, x - c.x);
  const dir = COMPASS[((Math.round(a / (Math.PI / 4)) % 8) + 8) % 8]!;
  return `about ${Math.round(d / 50) * 50} m ${dir} of the centre`;
}

export function buildingCentre(b: Building): { x: number; z: number } {
  return { x: (b.x + b.w / 2) * CELL, z: (b.y + b.h / 2) * CELL };
}

/** Distance in metres to the nearest finished facility of a kind, or Infinity. */
export function nearestFacility(sim: Sim, kind: FacilityKind, x: number, z: number): number {
  let best = Infinity;
  for (const b of sim.state.buildings) {
    if (!b || b.kind !== kind || b.progress < 1) continue;
    const c = buildingCentre(b);
    best = Math.min(best, Math.hypot(c.x - x, c.z - z));
  }
  return best;
}

/** Shortest distance from a facility of a kind to a road edge, or Infinity. */
export function facilityNearEdge(sim: Sim, kind: FacilityKind, e: RoadEdge): number {
  const p = edgePolyline(sim.state.roads, e);
  let best = Infinity;
  for (const b of sim.state.buildings) {
    if (!b || b.kind !== kind || b.progress < 1) continue;
    const c = buildingCentre(b);
    best = Math.min(best, closestOnPolyline(p, c.x, c.z, hit).dist);
  }
  return best;
}

/** Residents living within `r` metres of a point. */
export function residentsNear(sim: Sim, x: number, z: number, r: number): number {
  let n = 0;
  for (const b of sim.state.buildings) {
    if (!b || b.kind !== 0 || zoneType(b.zone) !== ZoneType.Residential) continue;
    const c = buildingCentre(b);
    if (Math.hypot(c.x - x, c.z - z) <= r) n += b.pop;
  }
  return n;
}

/** Distance in metres from a point to the nearest home, or Infinity. */
export function nearestHome(sim: Sim, x: number, z: number): number {
  let best = Infinity;
  for (const b of sim.state.buildings) {
    if (!b || b.kind !== 0 || zoneType(b.zone) !== ZoneType.Residential) continue;
    const c = buildingCentre(b);
    best = Math.min(best, Math.hypot(c.x - x, c.z - z));
  }
  return best;
}

/** Plain-language distance: "right next to it", "120 m away", "none in the city". */
export function metres(d: number): string {
  if (!Number.isFinite(d)) return 'none in the city';
  if (d < 40) return 'right next to it';
  return `${Math.round(d / 10) * 10} m away`;
}

export function money(n: number): string {
  return `${n < 0 ? '-' : ''}$${Math.abs(Math.round(n)).toLocaleString('en-US')}`;
}

/** What a set of buildings is: "3 homes (41 residents) and 1 workplace (6 jobs)". */
export function describeBuildings(sim: Sim, ids: readonly number[]): { text: string; homes: number; residents: number; jobs: number } {
  let homes = 0;
  let residents = 0;
  let work = 0;
  let jobs = 0;
  let facilities = 0;
  for (const id of ids) {
    const b = sim.state.buildings[id];
    if (!b) continue;
    if (b.kind !== 0) facilities++;
    else if (zoneType(b.zone) === ZoneType.Residential) {
      homes++;
      residents += b.progress >= 1 ? b.pop : capacityOf(b);
    } else {
      work++;
      jobs += b.pop;
    }
  }
  const parts: string[] = [];
  if (homes) parts.push(`${homes} home${homes > 1 ? 's' : ''} (${residents} residents)`);
  if (work) parts.push(`${work} workplace${work > 1 ? 's' : ''} (${jobs} jobs)`);
  if (facilities) parts.push(`${facilities} public building${facilities > 1 ? 's' : ''}`);
  return { text: parts.length ? parts.join(' and ') : 'no buildings', homes, residents, jobs };
}

export function roadTypeName(e: RoadEdge): string {
  return ROAD_SPECS[e.type].name.toLowerCase();
}

export function facilityName(kind: number): string {
  return FACILITIES[kind]?.name ?? 'facility';
}
