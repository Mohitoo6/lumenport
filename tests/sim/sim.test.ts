import { describe, expect, it } from 'vitest';
import { DAYS_PER_MONTH, START_YEAR, TICKS_PER_DAY } from '../../src/core/constants';
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
  it('advances the calendar on a fixed tick', () => {
    const sim = Sim.create(1);
    let days = 0;
    sim.events.on('dayPassed', () => days++);
    for (let i = 0; i < TICKS_PER_DAY * (DAYS_PER_MONTH + 2); i++) sim.tick();
    expect(days).toBe(DAYS_PER_MONTH + 2);
    const d = dateOf(sim.state.tick);
    expect(d).toMatchObject({ day: 3, month: 1, year: START_YEAR });
  });

  it('rolls the year over', () => {
    expect(dateOf(TICKS_PER_DAY * DAYS_PER_MONTH * 12).year).toBe(START_YEAR + 1);
    expect(dateOf(0)).toMatchObject({ day: 1, month: 0, year: START_YEAR });
  });

  it('accepts and validates speed commands', () => {
    const sim = Sim.create(1);
    expect(sim.apply({ type: 'setSpeed', speed: 3 }).ok).toBe(true);
    expect(sim.state.speed).toBe(3);
    expect(sim.apply({ type: 'setSpeed', speed: 9 as never }).ok).toBe(false);
    expect(sim.state.speed).toBe(3);
  });
});
