/** World layout. One cell is 8 m; the playable map is MAP x MAP cells with its corner at the origin. */
export const CELL = 8;
export const MAP = 256;
export const VERTS = MAP + 1;
export const WORLD = MAP * CELL;
export const CHUNK = 32;
export const CHUNKS = MAP / CHUNK;
export const WATER_LEVEL = 0;

/** Simulation clock. */
export const TICK_MS = 50;
export const TICKS_PER_DAY = 40;
export const DAYS_PER_MONTH = 30;
export const MONTHS_PER_YEAR = 12;
export const START_YEAR = 2030;

export const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;
