import { describe, expect, it } from 'vitest';
import { SEASONS, START_HOUR, TICKS_PER_DAY, TICKS_PER_HOUR } from '../../src/core/constants';
import { detectIssues } from '../../src/game/council/issues';
import { forkSim } from '../../src/game/council/effects';
import { SEASON_SPECS, seasonAt, skyAt, weatherAt } from '../../src/sim/seasons';
import { Sim } from '../../src/sim/sim';
import { grownTown, runTicks } from '../game/town';

/** The tick at a given hour of a given month's day, in the first year. */
const at = (month: number, hour: number): number => (month * 24 + hour - START_HOUR) * TICKS_PER_HOUR;

describe('the Indian year', () => {
  it('has six seasons of two months, starting with spring in March', () => {
    expect(SEASONS.map((s) => s.id)).toEqual(['vasant', 'grishma', 'varsha', 'sharad', 'hemant', 'shishir']);
    for (let month = 0; month < 12; month++) expect(seasonAt(at(month, 12)).id).toBe(SEASONS[Math.floor(month / 2)]!.id);
    // The year comes round again.
    expect(seasonAt(at(12, 12)).id).toBe('vasant');
  });

  it('keeps spring neutral, so a new city starts with no weather working on it', () => {
    const w = weatherAt(0, 1337);
    expect(w).toMatchObject({ season: 'vasant', rain: 0, mist: 0, powerDemand: 1, waterDemand: 1, roadSpeed: 1, mood: 0 });
    for (let h = 0; h < 40; h++) expect(weatherAt(h * TICKS_PER_HOUR, 7).roadSpeed).toBe(1);
  });

  it('gives each season its own character', () => {
    const summer = weatherAt(at(2, 15), 1);
    const winter = weatherAt(at(10, 15), 1);
    expect(summer.temperature).toBeGreaterThan(38);
    expect(winter.temperature).toBeLessThan(22);
    expect(summer.powerDemand).toBe(1.25);
    expect(summer.waterDemand).toBe(1.2);
    expect(winter.powerDemand).toBeGreaterThan(1);
    expect(weatherAt(at(4, 12), 1).waterDemand).toBeLessThan(1);
    // Coldest before dawn, warmest mid-afternoon.
    expect(weatherAt(at(10, 5), 1).temperature).toBeLessThan(weatherAt(at(10, 15), 1).temperature);
    // Winter mornings are foggy and it lifts by noon.
    expect(weatherAt(at(10, 6.5), 1).mist).toBeGreaterThan(0.7);
    expect(weatherAt(at(10, 13), 1).mist).toBe(0);
    expect(weatherAt(at(10, 6.5), 1).roadSpeed).toBeLessThan(0.92);
  });

  it('rains through much of the monsoon and hardly at all in spring and summer', () => {
    const rainyHours = (month: number, seed: number): number => {
      let n = 0;
      for (let h = 0; h < 48; h++) if (weatherAt(at(month, h), seed).rain > 0.1) n++;
      return n / 48;
    };
    const seeds = [1, 2, 3, 4, 5, 6, 7, 8];
    const mean = (month: number): number => seeds.reduce((a, s) => a + rainyHours(month, s), 0) / seeds.length;
    expect(mean(4)).toBeGreaterThan(0.4);
    expect(mean(4)).toBeLessThan(0.9);
    expect(mean(0)).toBe(0);
    expect(mean(2)).toBeLessThan(0.12);
    // Rain is weather, not flicker: it does not change much from one tick to the next.
    for (let t = at(4, 0); t < at(4, 6); t += 400) expect(Math.abs(weatherAt(t + 20, 3).rain - weatherAt(t, 3).rain)).toBeLessThan(0.05);
  });

  it('is the same weather every time for the same city, and different for another', () => {
    const series = (seed: number): number[] => Array.from({ length: 48 }, (_, h) => weatherAt(at(4, h), seed).rain);
    expect(series(42)).toEqual(series(42));
    expect(series(42)).not.toEqual(series(43));
  });
});

describe('the sky through the year', () => {
  it('has long high days in summer and short low ones in winter', () => {
    const summer = skyAt(at(2, 12) + TICKS_PER_DAY / 2, 1);
    const winter = skyAt(at(10, 12) + TICKS_PER_DAY / 2, 1);
    expect(summer.sunset - summer.sunrise).toBeGreaterThan(13.5);
    expect(winter.sunset - winter.sunrise).toBeLessThan(11);
    expect(summer.sunHeight).toBeGreaterThan(winter.sunHeight + 0.4);
  });

  it('glides between seasons instead of jumping at midnight', () => {
    // An hour before and after the summer-to-monsoon boundary: nearly the same sky.
    const before = skyAt(at(4, 0) - TICKS_PER_HOUR, 1);
    const after = skyAt(at(4, 0) + TICKS_PER_HOUR, 1);
    expect(Math.abs(after.sunrise - before.sunrise)).toBeLessThan(0.05);
    expect(Math.abs(after.haze - before.haze)).toBeLessThan(0.06);
    for (let c = 0; c < 3; c++) expect(Math.abs(after.foliage[c]! - before.foliage[c]!)).toBeLessThan(0.03);
    // At the middle of a season the land is fully in that season's colours.
    const midSummer = skyAt(at(3, 0), 1);
    for (let c = 0; c < 3; c++) expect(midSummer.foliage[c]).toBeCloseTo(SEASON_SPECS.grishma.foliage[c]!, 2);
  });

  it('keeps the ground wet for a while after the rain stops', () => {
    let found = false;
    for (let t = at(4, 0); t < at(6, 0); t += 200) {
      const s = skyAt(t, 5);
      expect(s.wet).toBeGreaterThanOrEqual(s.rain);
      if (s.rain === 0 && s.wet > 0.1) found = true;
    }
    expect(found).toBe(true);
  });
});

describe('seasons in the simulation', () => {
  it('raises power and water demand in the summer heat, by the season’s multiplier', () => {
    const town = grownTown(150);
    const spring = { power: town.state.stats.powerDemand, water: town.state.stats.waterDemand };
    expect(spring.power).toBeGreaterThan(0);
    const summer = forkSim(town);
    // The same city, moved to the middle of summer.
    summer.state.tick = at(2, 12);
    summer.replaceState(summer.state);
    expect(summer.weather.season).toBe('grishma');
    expect(summer.state.stats.powerDemand).toBeCloseTo(spring.power * 1.25, 3);
    expect(summer.state.stats.waterDemand).toBeCloseTo(spring.water * 1.2, 1);
  });

  it('changes the demand when the season turns while the city runs', () => {
    const sim = grownTown(60);
    const before = sim.state.stats.powerDemand;
    // Jump to the last step of spring and run across the boundary.
    sim.state.tick = at(2, 0) - 80;
    sim.replaceState(sim.state);
    expect(sim.weather.season).toBe('vasant');
    runTicks(sim, 200);
    expect(sim.weather.season).toBe('grishma');
    expect(sim.state.stats.powerDemand).toBeGreaterThan(before * 1.1);
  });

  it('slows the cars in fog and rain', () => {
    const sim = Sim.create(3);
    sim.state.tick = at(10, 6.5);
    sim.replaceState(sim.state);
    expect(sim.traffic.speedFactor).toBeLessThan(0.92);
    sim.state.tick = at(0, 12);
    sim.replaceState(sim.state);
    expect(sim.traffic.speedFactor).toBe(1);
  });

  it('tells the council when the season is part of a shortage', () => {
    const town = grownTown(150);
    const summer = forkSim(town);
    summer.state.tick = at(2, 14);
    // Supply that was comfortable in spring is short in the heat.
    summer.replaceState(summer.state);
    const issues = detectIssues(summer);
    const utility = issues.find((i) => i.kind === 'power' || i.kind === 'water');
    if (utility) {
      const fact = utility.facts.find((f) => f.startsWith('Season:'));
      expect(fact).toMatch(/it is summer/);
      expect(fact).toMatch(utility.kind === 'power' ? /125% of its spring level/ : /120% of its spring level/);
    }
    // In spring the same detectors say nothing about the season.
    for (const i of detectIssues(town)) expect(i.facts.join(' ')).not.toMatch(/Season:|Weather:/);
  });
});
