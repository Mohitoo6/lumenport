import { describe, expect, it } from 'vitest';
import { MONTH_NAMES, SEASONS, START_HOUR, START_YEAR, TICKS_PER_DAY, TICKS_PER_HOUR, TICK_MS } from '../../src/core/constants';
import { Rng, hash2 } from '../../src/core/rng';
import { Sim } from '../../src/sim/sim';
import { dateOf } from '../../src/sim/state';

describe('rng', () => {
  it('is reproducible from its state', () => {
    const a = new Rng(42);
    const b = new Rng(42);
    for (let i = 0; i < 100; i++) expect(a.next()).toBe(b.next());
    const resumed = new Rng(a.state);
    expect(resumed.next()).toBe(b.next());
  });

  it('stays in [0, 1) and is roughly uniform', () => {
    const r = new Rng(7);
    let sum = 0;
    for (let i = 0; i < 20000; i++) {
      const v = r.next();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
      sum += v;
    }
    expect(sum / 20000).toBeCloseTo(0.5, 1);
    expect(hash2(3, 4, 5)).toBe(hash2(3, 4, 5));
    expect(hash2(3, 4, 5)).not.toBe(hash2(4, 3, 5));
  });
});

describe('sim clock', () => {
  it('runs the budget, the calendar and the time of day from one tick count', () => {
    const sim = Sim.create(1);
    let hours = 0;
    let days = 0;
    sim.events.on('hourPassed', () => hours++);
    sim.events.on('dayPassed', () => days++);
    // Founded at 08:00. Thirty-six hours later it is 20:00 on the second day.
    for (let i = 0; i < TICKS_PER_HOUR * 36; i++) sim.tick();
    expect(hours).toBe(36);
    expect(days).toBe(1);
    expect(dateOf(sim.state.tick)).toMatchObject({ hour: 20, totalDays: 1, totalHours: 36, month: 1, year: START_YEAR });
  });

  it('starts at eight on a Chaitra morning, turns the day at midnight and the year after twelve days', () => {
    expect(dateOf(0)).toMatchObject({ hour: START_HOUR, day: 1, month: 0, season: 0, year: START_YEAR, totalDays: 0, totalHours: 0 });
    expect(dateOf(TICKS_PER_HOUR / 2).hour).toBe(START_HOUR + 0.5);
    // Part of a tick moves the clock, so it can be drawn smoothly between ticks.
    expect(dateOf(0, 0.5).hour).toBeGreaterThan(START_HOUR);
    expect(dateOf(0, 0.5).hour).toBeLessThan(dateOf(1).hour);
    expect(dateOf(TICKS_PER_HOUR * (24 - START_HOUR))).toMatchObject({ hour: 0, month: 1, totalDays: 1 });
    expect(dateOf(TICKS_PER_DAY * 12).year).toBe(START_YEAR + 1);
    // Each day stands for a month, and two months make a season: day five is Shravana, in the monsoon.
    const fifth = dateOf(TICKS_PER_DAY * 4);
    expect(MONTH_NAMES[fifth.month]).toBe('Shravana');
    expect(SEASONS[fifth.season]!.english).toBe('Monsoon');
    expect(TICKS_PER_HOUR * TICK_MS).toBe(60_000);
  });

  it('accepts and validates speed commands', () => {
    const sim = Sim.create(1);
    expect(sim.apply({ type: 'setSpeed', speed: 3 }).ok).toBe(true);
    expect(sim.state.speed).toBe(3);
    expect(sim.apply({ type: 'setSpeed', speed: 9 as never }).ok).toBe(false);
    expect(sim.state.speed).toBe(3);
  });
});
