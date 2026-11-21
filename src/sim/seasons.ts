import { SEASONS, TICKS_PER_DAY, TICKS_PER_HOUR, type SeasonId } from '../core/constants';
import { hash2 } from '../core/rng';
import { dateOf } from './state';

/**
 * The six seasons of the Indian year and the weather they bring.
 *
 * Everything here is a pure function of the tick and the city's seed, so the weather is
 * part of the deterministic simulation: the same city replays the same monsoon. Two
 * things come out. `weatherAt` is what the simulation feels (demand for power and water,
 * road speed, mood) and steps cleanly at each season's start. `skyAt` is what the player
 * sees (day length, sun height, overcast, haze, mist, the colour of grass and leaves) and
 * glides from one season into the next.
 */
export interface SeasonSpec {
  id: SeasonId;
  /** Afternoon high and pre-dawn low, in degrees Celsius. */
  high: number;
  low: number;
  /** Clock hours of sunrise and sunset. */
  sunrise: number;
  sunset: number;
  /** How high the noon sun climbs, in degrees. */
  sunHeight: number;
  /** Demand for power and water, as a multiple of the spring baseline. */
  power: number;
  water: number;
  /** 0..1: the share of hours with rain. */
  rain: number;
  /** 0..1: how thick the morning mist gets. */
  mist: number;
  /** 0..1: dust and heat haze through the day. */
  haze: number;
  /** Added to the city's happiness (0..1 scale). */
  mood: number;
  /** Grass and leaf colour, as a multiplier on the spring colours (r, g, b). */
  foliage: [number, number, number];
  /** One line saying what the season does to the city, for the HUD and the council. */
  effect: string;
}

/**
 * Spring is the baseline: every multiplier is 1 and there is no rain or mist, so a new
 * city (founded in March) starts in neutral weather.
 */
export const SEASON_SPECS: Record<SeasonId, SeasonSpec> = {
  vasant: { id: 'vasant', high: 31, low: 17, sunrise: 6.2, sunset: 18.5, sunHeight: 62, power: 1, water: 1, rain: 0, mist: 0, haze: 0.05, mood: 0, foliage: [1, 1, 1], effect: 'Mild and clear. Nothing strains the city.' },
  grishma: { id: 'grishma', high: 42, low: 27, sunrise: 5.4, sunset: 19.2, sunHeight: 78, power: 1.25, water: 1.2, rain: 0.03, mist: 0, haze: 0.55, mood: -0.02, foliage: [1.16, 0.98, 0.72], effect: 'Heat: cooling adds 25% to power demand and 20% to water demand.' },
  varsha: { id: 'varsha', high: 32, low: 25, sunrise: 5.8, sunset: 18.9, sunHeight: 72, power: 1.05, water: 0.85, rain: 0.62, mist: 0.1, haze: 0, mood: 0, foliage: [0.82, 1.08, 0.86], effect: 'Monsoon: rain slows traffic by up to 15% and cuts water demand by 15%.' },
  sharad: { id: 'sharad', high: 31, low: 19, sunrise: 6.3, sunset: 17.9, sunHeight: 56, power: 1, water: 1, rain: 0.04, mist: 0.1, haze: 0.05, mood: 0.03, foliage: [1.02, 1.02, 0.94], effect: 'Clear skies and the festival season: residents are a little happier.' },
  hemant: { id: 'hemant', high: 25, low: 11, sunrise: 6.8, sunset: 17.5, sunHeight: 46, power: 1.05, water: 0.95, rain: 0.02, mist: 0.45, haze: 0.15, mood: 0, foliage: [1.05, 0.98, 0.86], effect: 'Cool, with morning mist that slows the early rush a little.' },
  shishir: { id: 'shishir', high: 20, low: 6, sunrise: 7.1, sunset: 17.7, sunHeight: 44, power: 1.12, water: 0.9, rain: 0.06, mist: 0.9, haze: 0.2, mood: -0.01, foliage: [1.04, 0.95, 0.82], effect: 'Cold: heating adds 12% to power demand, and dense morning fog slows traffic.' },
};

export function seasonAt(tick: number): SeasonSpec {
  return SEASON_SPECS[SEASONS[dateOf(tick).season]!.id];
}

const clamp01 = (v: number): number => Math.max(0, Math.min(1, v));
const smooth = (t: number): number => t * t * (3 - 2 * t);

/** Smooth noise in 0..1 over whole hours: weather that comes and goes, not flickers. */
function hourNoise(hours: number, seed: number, salt: number): number {
  const h = Math.floor(hours);
  const a = hash2(h, salt, seed);
  const b = hash2(h + 1, salt, seed);
  return a + (b - a) * smooth(hours - h);
}

/** How heavily it is raining (0..1) in a season with this share of rainy hours. */
function rainNow(share: number, hours: number, seed: number): number {
  if (share <= 0) return 0;
  // Slow swells (showers lasting a few hours) with a quicker ripple on top.
  const n = hourNoise(hours / 3, seed, 911) * 0.75 + hourNoise(hours, seed, 913) * 0.25;
  return clamp01((n - (1 - share)) / 0.22);
}

/** Mist: thickest before dawn, gone by mid-morning. */
function mistNow(strength: number, hour: number, sunrise: number): number {
  if (strength <= 0) return 0;
  const sinceDawn = hour - sunrise;
  const morning = sinceDawn < -3 ? 0.6 : sinceDawn < 0.5 ? 1 : clamp01(1 - (sinceDawn - 0.5) / 3);
  // A thinner mist returns late in the evening.
  const evening = hour > 21 ? clamp01((hour - 21) / 3) * 0.6 : 0;
  return strength * Math.max(morning, evening);
}

export interface Weather {
  season: SeasonId;
  /** Degrees Celsius now. */
  temperature: number;
  /** 0..1 now. */
  rain: number;
  mist: number;
  /** Multipliers the simulation applies. */
  powerDemand: number;
  waterDemand: number;
  /** Cars drive at this share of the speed limit (wet roads, fog). */
  roadSpeed: number;
  /** Added to the city's happiness (0..1 scale). */
  mood: number;
}

/** The weather the simulation feels at a tick. */
export function weatherAt(tick: number, seed: number): Weather {
  const d = dateOf(tick);
  const spec = SEASON_SPECS[SEASONS[d.season]!.id];
  const hours = tick / TICKS_PER_HOUR;
  const rain = rainNow(spec.rain, hours, seed);
  const mist = mistNow(spec.mist, d.hour, spec.sunrise);
  // Warmest at three in the afternoon, coolest just before dawn.
  const warmth = 0.5 + 0.5 * Math.cos(((d.hour - 15) / 24) * Math.PI * 2);
  return {
    season: spec.id,
    temperature: Math.round(spec.low + (spec.high - spec.low) * warmth - rain * 3),
    rain,
    mist,
    powerDemand: spec.power,
    waterDemand: spec.water,
    roadSpeed: 1 - 0.15 * rain - 0.12 * mist,
    mood: spec.mood - 0.01 * rain,
  };
}

export interface Sky {
  sunrise: number;
  sunset: number;
  /** Radians above the horizon at noon. */
  sunHeight: number;
  /** 0..1: cloud cover dimming the sun and greying the sky. */
  overcast: number;
  rain: number;
  mist: number;
  haze: number;
  /** 0..1: how wet the ground is; lags the rain. */
  wet: number;
  foliage: [number, number, number];
}

const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;

/**
 * What the sky and the land look like at a tick. Seasonal values glide: each season is at
 * full strength at its middle and blends into its neighbour across the boundary, so day
 * length and the colour of the land never jump at midnight.
 */
export function skyAt(tick: number, seed: number, fraction = 0): Sky {
  const d = dateOf(tick, fraction);
  const hours = (tick + fraction) / TICKS_PER_HOUR;
  // Position in the year, in seasons, measured from the middle of the first season.
  const seasonLength = (TICKS_PER_DAY * 12) / SEASONS.length;
  const yearTick = (((d.totalDays % 12) * TICKS_PER_DAY + d.hour * TICKS_PER_HOUR) % (TICKS_PER_DAY * 12)) / seasonLength - 0.5;
  const i = ((Math.floor(yearTick) % 6) + 6) % 6;
  const t = smooth(yearTick - Math.floor(yearTick));
  const a = SEASON_SPECS[SEASONS[i]!.id];
  const b = SEASON_SPECS[SEASONS[(i + 1) % 6]!.id];
  const now = SEASON_SPECS[SEASONS[d.season]!.id];
  const rain = rainNow(now.rain, hours, seed);
  // The ground stays wet for a while after a shower.
  const wet = Math.max(rain, rainNow(now.rain, hours - 1, seed) * 0.7, rainNow(now.rain, hours - 2, seed) * 0.4);
  const cover = lerp(a.rain, b.rain, t);
  return {
    sunrise: lerp(a.sunrise, b.sunrise, t),
    sunset: lerp(a.sunset, b.sunset, t),
    sunHeight: (lerp(a.sunHeight, b.sunHeight, t) * Math.PI) / 180,
    // A rainy season is cloudy between showers too; rain itself closes the sky.
    overcast: clamp01(cover * 0.75 + rain * 0.6),
    rain,
    mist: mistNow(now.mist, d.hour, now.sunrise),
    haze: lerp(a.haze, b.haze, t),
    wet,
    foliage: [lerp(a.foliage[0], b.foliage[0], t), lerp(a.foliage[1], b.foliage[1], t), lerp(a.foliage[2], b.foliage[2], t)],
  };
}
