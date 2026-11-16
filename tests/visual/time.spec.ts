import { mkdirSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { advance, openGame } from './helpers';

const DIR = 'screenshots/time';
const HOUR = 1200;

test('time: the date, the clock and the sky run on one clock', async ({ page }) => {
  test.setTimeout(240_000);
  mkdirSync(DIR, { recursive: true });
  // A real game, not a scripted run: the clock follows the simulation.
  await openGame(page, 'council=demo');
  await page.evaluate(() => window.__game!.exec({ type: 'setSpeed', speed: 0 }));
  const hud = async () => {
    await page.evaluate(() => window.__game!.frames(20));
    await page.waitForTimeout(400);
    return { date: await page.locator('.city-date').innerText(), clock: await page.locator('.clock-time').innerText(), night: await page.evaluate(() => window.__game!.game.atmosphere.night) };
  };

  // A new city wakes at eight on a Chaitra morning.
  const start = await hud();
  expect(start.date).toBe('Chaitra, Year 1');
  expect(start.clock).toBe('08:00');
  expect(start.night).toBeLessThan(0.2);
  await page.screenshot({ path: `${DIR}/01-morning.png` });

  // Paused, nothing moves: not the clock, not the sun.
  await page.waitForTimeout(1500);
  expect((await hud()).clock).toBe('08:00');

  // Ten game hours on it is six in the evening, the same day.
  await advance(page, HOUR * 10);
  const evening = await hud();
  expect(evening.clock).toBe('18:00');
  expect(evening.date).toBe('Chaitra, Year 1');
  await page.screenshot({ path: `${DIR}/02-evening-rush.png` });

  // Four more hours: night has fallen, and the date has not moved.
  await advance(page, HOUR * 4);
  // The sky glides to the new hour rather than snapping.
  await page.waitForTimeout(2500);
  const night = await hud();
  expect(night.clock).toBe('22:00');
  expect(night.date).toBe('Chaitra, Year 1');
  expect(night.night).toBeGreaterThan(0.8);
  await page.screenshot({ path: `${DIR}/03-night.png` });

  // Midnight: the day turns, and with it the month.
  await advance(page, HOUR * 2);
  const midnight = await hud();
  expect(midnight.clock).toBe('00:00');
  expect(midnight.date).toBe('Vaishakha, Year 1');

  // Running, the clock moves at a game hour per real minute: about a game minute a second.
  await page.evaluate(() => window.__game!.exec({ type: 'setSpeed', speed: 1 }));
  await page.waitForTimeout(6000);
  const later = await hud();
  const minutes = Number(later.clock.slice(0, 2)) * 60 + Number(later.clock.slice(3));
  expect(minutes).toBeGreaterThanOrEqual(4);
  expect(minutes).toBeLessThanOrEqual(12);

  // Twelve days make a year.
  await page.evaluate(() => window.__game!.exec({ type: 'setSpeed', speed: 0 }));
  await advance(page, HOUR * 24 * 11);
  expect((await hud()).date).toBe('Chaitra, Year 2');
});
