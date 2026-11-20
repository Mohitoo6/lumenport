import { mkdirSync } from 'node:fs';
import { test } from '@playwright/test';
import { advance, buildTown, openGame, zoneTown } from './helpers';

/**
 * Homes at each density, close up and from above, by day and at night. Set SHOTS_DIR to
 * keep a before/after pair apart.
 */
test('homes at every density', async ({ page }) => {
  test.setTimeout(300_000);
  const dir = process.env.SHOTS_DIR ?? 'screenshots/houses';
  mkdirSync(dir, { recursive: true });
  await openGame(page, 'shots=1');
  await buildTown(page);
  await zoneTown(page);
  await advance(page, 5200);
  const shots: Array<[name: string, x: number, z: number, yaw: number, pitch: number, dist: number, hour: number]> = [
    ['01-low-density-street', 1300, 392, 0.6, 0.42, 55, 10],
    ['02-low-density-above', 1440, 392, -0.5, 0.75, 110, 10],
    ['03-medium-builder-floors', 1180, 528, 0.7, 0.45, 70, 10],
    ['04-medium-east', 1480, 452, -0.6, 0.45, 70, 10],
    ['05-high-towers', 1180, 632, 0.8, 0.4, 120, 10],
    ['06-high-towers-west', 1076, 528, -0.7, 0.45, 100, 10],
    ['07-overview', 1320, 520, 0.7, 0.6, 360, 11],
    ['08-dusk', 1300, 470, 0.6, 0.5, 200, 19.5],
  ];
  for (const [name, x, z, yaw, pitch, dist, hour] of shots) {
    await page.evaluate(([h]) => window.__game!.season(7, h), [hour] as const);
    await page.evaluate(([x, z, yaw, pitch, dist]) => window.__game!.camera({ x, z, yaw, pitch, dist }, true), [x, z, yaw, pitch, dist] as const);
    await page.evaluate(() => window.__game!.frames(60));
    await page.screenshot({ path: `${dir}/${name}.png` });
  }
});
