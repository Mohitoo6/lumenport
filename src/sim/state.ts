import { DAYS_PER_MONTH, MONTHS_PER_YEAR, START_YEAR, TICKS_PER_DAY } from '../core/constants';
import { generateHeights } from './map/terrain';
import { generateTrees } from './map/trees';

export const STATE_VERSION = 1;

export type Speed = 0 | 1 | 2 | 3;

/**
 * The whole game. Everything in here is plain data (numbers, strings, typed arrays, plain
 * objects) so it can be structured-cloned into IndexedDB or posted to a Worker unchanged.
 */
export interface GameState {
  version: number;
  cityName: string;
  seed: number;
  /** PRNG state for simulation decisions. */
  rng: number;
  tick: number;
  speed: Speed;
  /** Vertex heights, VERTS x VERTS, metres. */
  heights: Float32Array;
  /** One byte per cell, see map/trees.ts. */
  trees: Uint8Array;
}

export function createState(seed: number, cityName = 'New Haven'): GameState {
  const heights = generateHeights(seed);
  return {
    version: STATE_VERSION,
    cityName,
    seed,
    rng: seed ^ 0x5f3759df,
    tick: 0,
    speed: 1,
    heights,
    trees: generateTrees(heights, seed),
  };
}

export interface CalendarDate {
  day: number; // 1..30
  month: number; // 0..11
  year: number;
  /** Total days elapsed since the start. */
  totalDays: number;
}

export function dateOf(tick: number): CalendarDate {
  const totalDays = Math.floor(tick / TICKS_PER_DAY);
  const totalMonths = Math.floor(totalDays / DAYS_PER_MONTH);
  return {
    day: (totalDays % DAYS_PER_MONTH) + 1,
    month: totalMonths % MONTHS_PER_YEAR,
    year: START_YEAR + Math.floor(totalMonths / MONTHS_PER_YEAR),
    totalDays,
  };
}
