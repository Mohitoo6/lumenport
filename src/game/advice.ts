import { MAP } from '../core/constants';
import type { Sim } from '../sim/sim';
import { frontageOf } from '../sim/zoning/lots';
import { ZoneType } from '../sim/zoning/zones';

/** Below this demand, zoned land of that type stops developing. */
const STALLED = 0.02;

/** Plain-language reasons for each zone type not growing for lack of demand. */
export const STALL_REASON: Record<number, string> = {
  [ZoneType.Residential]: 'Homes have stopped growing: people need jobs. Zone some Industry or Shops',
  [ZoneType.Commercial]: 'Shops have stopped growing: they need more customers. Zone more Homes',
  [ZoneType.Industrial]: 'Industry has stopped growing: it needs workers. Zone more Homes',
};

/** Whether zoned land of this type is currently held back by low demand (sandbox never is). */
export function stalledByDemand(sim: Sim, type: ZoneType): boolean {
  return !sim.state.sandbox && sim.state.stats.demand[type]! <= STALLED;
}

/**
 * Zone types that have empty road-side land waiting to develop but no demand to fill it.
 * These are the cases a player cannot tell apart from a bug, so the HUD calls them out.
 */
export function stalledZones(sim: Sim): ZoneType[] {
  const s = sim.state;
  if (s.sandbox) return [];
  const waiting = [false, false, false, false];
  for (let j = 1; j < MAP - 1; j++) {
    for (let i = 1; i < MAP - 1; i++) {
      const k = j * MAP + i;
      const z = s.zone[k]!;
      if (z === 0 || s.buildingCell[k]! >= 0 || waiting[z >> 2]) continue;
      if (frontageOf(s, i, j) >= 0) waiting[z >> 2] = true;
    }
  }
  const out: ZoneType[] = [];
  for (const t of [ZoneType.Residential, ZoneType.Commercial, ZoneType.Industrial]) {
    if (waiting[t] && stalledByDemand(sim, t)) out.push(t);
  }
  return out;
}
