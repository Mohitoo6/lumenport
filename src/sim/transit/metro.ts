import { CELL, MAP } from '../../core/constants';
import { FACILITIES, FacilityKind } from '../facilities';
import { zoneDensity, type Building } from '../zoning/zones';

/**
 * The elevated metro. A line runs between two stations along a smooth path the player
 * draws (straight, or bent through any number of points), on a viaduct high enough to
 * pass over roads, houses and small shops. Stations joined into a network of two or more
 * take riders off the roads, raise land value nearby and earn fares.
 */

export interface MetroLine {
  id: number;
  /** Station building ids at each end. */
  a: number;
  b: number;
  /** The centreline, sampled every few metres: x0, z0, x1, z1, ... */
  pts: number[];
  length: number;
}

export interface MetroState {
  lines: Array<MetroLine | null>;
}

export const METRO = {
  /** Build cost: per metre of viaduct, plus a fixed cost per line. */
  costPerMetre: 30,
  baseCost: 1500,
  /** Hourly upkeep per metre of line. */
  upkeepPerMetre: 0.05,
  /** Hourly fare income per regular rider. */
  fare: 1.2,
  /** Share of residents in full station reach who ride instead of driving. */
  uptake: 0.35,
  /** Deck height above the ground, metres: clear of walk-up apartments and mid-rise shops. */
  height: 19,
  maxLength: 4500,
  step: 6,
} as const;

export function emptyMetro(): MetroState {
  return { lines: [] };
}

export function isStation(b: Building | null | undefined): b is Building {
  return !!b && b.kind === FacilityKind.MetroStation;
}

export function stationCentre(b: Building): [number, number] {
  return [(b.x + b.w / 2) * CELL, (b.y + b.h / 2) * CELL];
}

/**
 * A smooth path through the control points (centripetal Catmull-Rom), sampled about every
 * `METRO.step` metres. The ends are exactly the first and last points.
 */
export function smoothPath(points: ReadonlyArray<readonly [number, number]>): number[] {
  const p = points.filter((q, i) => i === 0 || Math.hypot(q[0] - points[i - 1]![0], q[1] - points[i - 1]![1]) > 1);
  if (p.length < 2) return p.length ? [p[0]![0], p[0]![1]] : [];
  const out: number[] = [p[0]![0], p[0]![1]];
  for (let i = 0; i + 1 < p.length; i++) {
    const p0 = p[Math.max(0, i - 1)]!;
    const p1 = p[i]!;
    const p2 = p[i + 1]!;
    const p3 = p[Math.min(p.length - 1, i + 2)]!;
    const seg = Math.hypot(p2[0] - p1[0], p2[1] - p1[1]);
    const n = Math.max(1, Math.ceil(seg / METRO.step));
    // Uniform Catmull-Rom tangents, scaled down a little so bends stay gentle.
    const t1x = (p2[0] - p0[0]) * 0.5;
    const t1z = (p2[1] - p0[1]) * 0.5;
    const t2x = (p3[0] - p1[0]) * 0.5;
    const t2z = (p3[1] - p1[1]) * 0.5;
    for (let k = 1; k <= n; k++) {
      const t = k / n;
      const t2 = t * t;
      const t3 = t2 * t;
      const h00 = 2 * t3 - 3 * t2 + 1;
      const h10 = t3 - 2 * t2 + t;
      const h01 = -2 * t3 + 3 * t2;
      const h11 = t3 - t2;
      out.push(h00 * p1[0] + h10 * t1x + h01 * p2[0] + h11 * t2x, h00 * p1[1] + h10 * t1z + h01 * p2[1] + h11 * t2z);
    }
  }
  return out;
}

export function pathLength(pts: readonly number[]): number {
  let len = 0;
  for (let i = 2; i < pts.length; i += 2) len += Math.hypot(pts[i]! - pts[i - 2]!, pts[i + 1]! - pts[i - 1]!);
  return len;
}

export interface MetroPlan {
  ok: boolean;
  reason: string;
  pts: number[];
  length: number;
  cost: number;
}

/** Facilities with parts taller than the deck. */
const TALL = new Set<number>([FacilityKind.CoalPlant, FacilityKind.WindTurbine, FacilityKind.WaterTower, FacilityKind.TownHall, FacilityKind.ItPark, FacilityKind.University]);

/** What the viaduct may not pass over: towers and tall facilities. Everything else is lower than the deck. */
function blocks(b: Building): boolean {
  if (b.kind !== 0) return TALL.has(b.kind);
  return zoneDensity(b.zone) >= 3;
}

/** Checks a line between two stations through `via` points, without building it. */
export function planMetro(
  s: { buildings: ReadonlyArray<Building | null>; buildingCell: Int32Array; metro?: MetroState },
  a: number,
  b: number,
  via: ReadonlyArray<readonly [number, number]>,
): MetroPlan {
  const plan: MetroPlan = { ok: false, reason: '', pts: [], length: 0, cost: 0 };
  const sa = s.buildings[a];
  const sb = s.buildings[b];
  if (!isStation(sa) || !isStation(sb)) {
    plan.reason = 'A metro line runs between two metro stations';
    return plan;
  }
  if (a === b) {
    plan.reason = 'Pick a different station for the other end';
    return plan;
  }
  if (sa.progress < 1 || sb.progress < 1) {
    plan.reason = 'Wait for both stations to finish building';
    return plan;
  }
  if (s.metro?.lines.some((l) => l && ((l.a === a && l.b === b) || (l.a === b && l.b === a)))) {
    plan.reason = 'These stations are already connected';
    return plan;
  }
  plan.pts = smoothPath([stationCentre(sa), ...via, stationCentre(sb)]);
  plan.length = pathLength(plan.pts);
  if (plan.length > METRO.maxLength) {
    plan.reason = `Too long: lines can be up to ${METRO.maxLength / 1000} km between stations`;
    return plan;
  }
  for (let i = 0; i < plan.pts.length; i += 2) {
    const ci = Math.floor(plan.pts[i]! / CELL);
    const cj = Math.floor(plan.pts[i + 1]! / CELL);
    if (ci < 1 || cj < 1 || ci >= MAP - 1 || cj >= MAP - 1) {
      plan.reason = 'The line leaves the city limits';
      return plan;
    }
    const id = s.buildingCell[cj * MAP + ci]!;
    const hit = id >= 0 ? s.buildings[id] : null;
    if (hit && hit.id !== a && hit.id !== b && blocks(hit)) {
      plan.reason = `${hit.kind !== 0 ? `The ${FACILITIES[hit.kind]!.name.toLowerCase()}` : 'A tall building'} is in the way: bend the line around it, or along a road`;
      return plan;
    }
  }
  plan.cost = Math.round(METRO.baseCost + plan.length * METRO.costPerMetre);
  plan.ok = true;
  return plan;
}

/** Stations that are joined to at least one other station. */
export function activeStations(s: { buildings: ReadonlyArray<Building | null>; metro?: MetroState }): Set<number> {
  const out = new Set<number>();
  for (const l of s.metro?.lines ?? []) {
    if (!l || !isStation(s.buildings[l.a]) || !isStation(s.buildings[l.b])) continue;
    out.add(l.a);
    out.add(l.b);
  }
  return out;
}

/** Drops lines whose stations are gone. Returns true if any were removed. */
export function pruneMetro(s: { buildings: ReadonlyArray<Building | null>; metro?: MetroState }): boolean {
  const m = s.metro;
  if (!m) return false;
  let changed = false;
  for (let i = 0; i < m.lines.length; i++) {
    const l = m.lines[i];
    if (l && (!isStation(s.buildings[l.a]) || !isStation(s.buildings[l.b]))) {
      m.lines[i] = null;
      changed = true;
    }
  }
  return changed;
}

export function metroLength(m: MetroState | undefined): number {
  let len = 0;
  for (const l of m?.lines ?? []) if (l) len += l.length;
  return len;
}
