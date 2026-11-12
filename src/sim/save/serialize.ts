import { MAP, VERTS } from '../../core/constants';
import { STATE_VERSION, type GameState } from '../state';

const json = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

/** A deep copy of the game: safe to store, or to keep while the original plays on. */
export function cloneState(s: GameState): GameState {
  return {
    ...s,
    heights: s.heights.slice(),
    trees: s.trees.slice(),
    roads: json(s.roads),
    roadCell: s.roadCell.slice(),
    roadLock: s.roadLock.slice(),
    zone: s.zone.slice(),
    buildings: json(s.buildings),
    buildingCell: s.buildingCell.slice(),
    constructing: s.constructing.slice(),
    tax: [s.tax[0], s.tax[1], s.tax[2], s.tax[3]],
    loans: json(s.loans),
    report: { ...s.report },
    policies: { ...(s.policies ?? {}) },
    stats: { ...s.stats, demand: [s.stats.demand[0], s.stats.demand[1], s.stats.demand[2], s.stats.demand[3]] },
  };
}

/**
 * Checks that something read back from storage is a game this build can run. Returns the
 * state, or a message saying why not.
 */
export function validateState(v: unknown): GameState | string {
  if (typeof v !== 'object' || v === null) return 'Not a saved city';
  const s = v as Partial<GameState>;
  if (s.version !== STATE_VERSION) return `Saved by a different version of the game (save format ${String(s.version)}, expected ${STATE_VERSION})`;
  const cells = MAP * MAP;
  const verts = VERTS * VERTS;
  const ok =
    s.heights instanceof Float32Array &&
    s.heights.length === verts &&
    s.trees instanceof Uint8Array &&
    s.trees.length === cells &&
    s.roadCell instanceof Int32Array &&
    s.roadCell.length === cells &&
    s.roadLock instanceof Uint8Array &&
    s.roadLock.length === verts &&
    s.zone instanceof Uint8Array &&
    s.zone.length === cells &&
    s.buildingCell instanceof Int32Array &&
    s.buildingCell.length === cells &&
    Array.isArray(s.buildings) &&
    Array.isArray(s.constructing) &&
    Array.isArray(s.loans) &&
    typeof s.roads === 'object' &&
    s.roads !== null &&
    Array.isArray(s.roads.nodes) &&
    Array.isArray(s.roads.edges) &&
    typeof s.funds === 'number' &&
    typeof s.tick === 'number';
  return ok ? (s as GameState) : 'The saved city is damaged';
}

export interface SaveMeta {
  slot: string;
  cityName: string;
  population: number;
  funds: number;
  tick: number;
  /** Milliseconds since the epoch. */
  savedAt: number;
}

export function metaOf(slot: string, s: GameState, savedAt: number): SaveMeta {
  return { slot, cityName: s.cityName, population: s.stats.population, funds: Math.floor(s.funds), tick: s.tick, savedAt };
}
