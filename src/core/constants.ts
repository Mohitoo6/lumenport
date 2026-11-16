/** World layout. One cell is 8 m; the playable map is MAP x MAP cells with its corner at the origin. */
export const CELL = 8;
export const MAP = 256;
export const VERTS = MAP + 1;
export const WORLD = MAP * CELL;
export const CHUNK = 32;
export const CHUNKS = MAP / CHUNK;
export const WATER_LEVEL = 0;

/**
 * Simulation clock. There is one clock: the sun, the HUD clock, the rush hour, the budget
 * and the calendar all read it.
 *
 * 20 ticks pass in a real second at normal speed. The economy moves people and recomputes
 * demand once per step (2 seconds). 30 steps make a game hour, a real minute, and the
 * budget settles on the hour, so every money figure in the game is "per hour". 24 hours
 * make a day: 24 real minutes at normal speed, 6 at the fastest.
 */
export const TICK_MS = 50;
export const TICKS_PER_STEP = 40;
export const STEPS_PER_HOUR = 30;
export const TICKS_PER_HOUR = TICKS_PER_STEP * STEPS_PER_HOUR;
export const HOURS_PER_DAY = 24;
export const TICKS_PER_DAY = TICKS_PER_HOUR * HOURS_PER_DAY;
/** A new city wakes up at eight in the morning. */
export const START_HOUR = 8;
/**
 * The calendar is compressed so that the year turns within a few sittings: each day
 * stands for one month, and two months make a season.
 */
export const DAYS_PER_MONTH = 1;
export const MONTHS_PER_YEAR = 12;
export const START_YEAR = 2030;
/** Ticks advanced per frame-second at each speed setting: paused, normal, fast, fastest. */
export const SPEED_FACTOR = [0, 1, 2, 4] as const;

/** The months of the Indian national calendar, starting with Chaitra (March to April). */
export const MONTH_NAMES = ['Chaitra', 'Vaishakha', 'Jyeshtha', 'Ashadha', 'Shravana', 'Bhadrapada', 'Ashwin', 'Kartika', 'Margashirsha', 'Pausha', 'Magha', 'Phalguna'] as const;

/** The six seasons (ritu), two months each, in calendar order. */
export const SEASONS = [
  { id: 'vasant', name: 'Vasant', english: 'Spring' },
  { id: 'grishma', name: 'Grishma', english: 'Summer' },
  { id: 'varsha', name: 'Varsha', english: 'Monsoon' },
  { id: 'sharad', name: 'Sharad', english: 'Autumn' },
  { id: 'hemant', name: 'Hemant', english: 'Early winter' },
  { id: 'shishir', name: 'Shishir', english: 'Winter' },
] as const;
export type SeasonId = (typeof SEASONS)[number]['id'];
