import { CELL } from '../../core/constants';
import { FacilityKind } from '../facilities';
import { homeNetwork, type Networks } from '../utilities/network';
import type { Building } from '../zoning/zones';

/**
 * Buses. The player places stops; the city runs the lines. Every group of two or more
 * stops on the same connected road network becomes one line, which visits its stops in a
 * nearest-neighbour loop. There is nothing to draw and nothing to schedule: a stop on a
 * road is served, a stop on an isolated road is not, and the inspect panel says which.
 */
export const BUS = {
  /** Hourly fare income per regular rider. */
  fare: 0.8,
  /** Share of residents in full walking reach of a stop who take the bus instead of driving. */
  uptake: 0.2,
  /** Hourly running cost of each bus in service (driver and fuel). */
  upkeepPerBus: 45,
  /** Buses per line: about one for every two stops, at least one, at most six. */
  maxPerLine: 6,
};

export interface BusLine {
  /** Building ids of the stops, in the order the buses visit them (a loop). */
  stops: number[];
  /** Buses running on it. */
  buses: number;
}

export function busesFor(stops: number): number {
  return Math.max(1, Math.min(BUS.maxPerLine, Math.ceil(stops / 2)));
}

const isStop = (b: Building | null | undefined): b is Building => !!b && b.kind === FacilityKind.BusStop && b.progress >= 1;

/** The bus lines of a city: one per road network with two or more stops. */
export function busLines(buildings: ReadonlyArray<Building | null>, net: Networks): BusLine[] {
  const groups = new Map<number, Building[]>();
  for (const b of buildings) {
    if (!isStop(b)) continue;
    const c = homeNetwork(b, net.comp);
    if (c < 0) continue;
    const list = groups.get(c) ?? [];
    list.push(b);
    groups.set(c, list);
  }
  const lines: BusLine[] = [];
  // Deterministic order: by the lowest stop id in each group.
  const ordered = [...groups.values()].filter((g) => g.length >= 2).sort((a, b) => a[0]!.id - b[0]!.id);
  for (const group of ordered) {
    // Nearest-neighbour loop from the oldest stop: short legs, no zigzag across town.
    const left = group.slice(1);
    const tour = [group[0]!];
    while (left.length) {
      const last = tour[tour.length - 1]!;
      let best = 0;
      let bestD = Infinity;
      for (let k = 0; k < left.length; k++) {
        const d = Math.hypot((left[k]!.x - last.x) * CELL, (left[k]!.y - last.y) * CELL);
        if (d < bestD) {
          bestD = d;
          best = k;
        }
      }
      tour.push(left.splice(best, 1)[0]!);
    }
    lines.push({ stops: tour.map((b) => b.id), buses: busesFor(tour.length) });
  }
  return lines;
}

/** Ids of every stop a line serves. */
export function servedStops(lines: readonly BusLine[]): Set<number> {
  const out = new Set<number>();
  for (const l of lines) for (const id of l.stops) out.add(id);
  return out;
}
