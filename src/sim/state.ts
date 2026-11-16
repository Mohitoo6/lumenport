import { emptyMetro, type MetroState } from './transit/metro';
import { DAYS_PER_MONTH, MAP, MONTHS_PER_YEAR, START_HOUR, START_YEAR, TICKS_PER_DAY, TICKS_PER_HOUR, VERTS } from '../core/constants';
import { generateHeights } from './map/terrain';
import { generateTrees } from './map/trees';
import { emptyNetwork, type RoadNetwork } from './roads/types';
import { emptyReport, type BudgetReport, type Loan, type Policies } from './economy/budget';
export type { Policies } from './economy/budget';
import { emptyStats, type CityStats } from './economy/economy';
import type { Building } from './zoning/zones';

export const STATE_VERSION = 4;
export const START_FUNDS = 90000;

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
  roads: RoadNetwork;
  /** Per cell: id of the road edge covering it, or -1. */
  roadCell: Int32Array;
  /** Per vertex: 1 where a road or building pad fixed the terrain, so later work leaves it alone. */
  roadLock: Uint8Array;
  /** Per cell: zone code (see zoning/zones.ts), 0 = unzoned. */
  zone: Uint8Array;
  /** Ids are array indices; removed entries are null. */
  buildings: Array<Building | null>;
  /** Per cell: id of the building whose lot covers it, or -1. */
  buildingCell: Int32Array;
  /** Ids of buildings still under construction. */
  constructing: number[];
  /** Sandbox: unlimited money, no utilities needed, constant demand. */
  sandbox: boolean;
  funds: number;
  /** Tax rate in percent per zone type: [unused, residential, commercial, industrial]. */
  tax: [number, number, number, number];
  loans: Loan[];
  /** The books for the last completed month. */
  report: BudgetReport;
  stats: CityStats;
  /** City policies the council can adopt. Optional so older saves load unchanged. */
  policies?: Policies;
  /** Metro lines. Optional so older saves load unchanged. */
  metro?: MetroState;
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
    roads: emptyNetwork(),
    roadCell: new Int32Array(MAP * MAP).fill(-1),
    roadLock: new Uint8Array(VERTS * VERTS),
    zone: new Uint8Array(MAP * MAP),
    buildings: [],
    buildingCell: new Int32Array(MAP * MAP).fill(-1),
    constructing: [],
    sandbox: false,
    funds: START_FUNDS,
    tax: [0, 9, 9, 9],
    loans: [],
    report: emptyReport(),
    stats: emptyStats(),
    policies: {},
    metro: emptyMetro(),
  };
}

export interface CalendarDate {
  /** Time of day, 0 up to 24, with fractions. */
  hour: number;
  /** Day of the month, from 1. */
  day: number;
  /** 0..11: an index into MONTH_NAMES. */
  month: number;
  /** 0..5: an index into SEASONS. */
  season: number;
  year: number;
  /** Whole days since the city was founded (the first day is 0). */
  totalDays: number;
  /** Whole hours since the city was founded: how many times the budget has settled. */
  totalHours: number;
}

/**
 * The date and time at a tick. A city is founded at START_HOUR on the first day, and the
 * day turns at midnight. `fraction` adds a part of a tick, so the clock can move smoothly
 * between ticks.
 */
export function dateOf(tick: number, fraction = 0): CalendarDate {
  const t = tick + fraction + START_HOUR * TICKS_PER_HOUR;
  const totalDays = Math.floor(t / TICKS_PER_DAY);
  const totalMonths = Math.floor(totalDays / DAYS_PER_MONTH);
  const month = totalMonths % MONTHS_PER_YEAR;
  return {
    hour: (t % TICKS_PER_DAY) / TICKS_PER_HOUR,
    day: (totalDays % DAYS_PER_MONTH) + 1,
    month,
    season: Math.floor(month / 2),
    year: START_YEAR + Math.floor(totalMonths / MONTHS_PER_YEAR),
    totalDays,
    totalHours: Math.floor(tick / TICKS_PER_HOUR),
  };
}
