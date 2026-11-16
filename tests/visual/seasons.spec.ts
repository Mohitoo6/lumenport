import { mkdirSync } from 'node:fs';
import { test } from '@playwright/test';
import { advance, buildTown, openGame, zoneTown } from './helpers';

const DIR = 'screenshots/seasons';

/** The same view of the town through the year: each season's light, sky and land. */
test('seasons: the town through the Indian year', async ({ page }) => {
  test.setTimeout(300_000);
  mkdirSync(DIR, { recursive: true });
  await openGame(page, 'shots=1');
  await buildTown(page);
  await zoneTown(page);
  await advance(page, 3600);
  await page.evaluate(() => window.__game!.camera({ x: 1300, z: 640, yaw: 0.5, pitch: 0.62, dist: 380 }, true));
  const shots: Array<[string, number, number]> = [
    ['01-vasant-spring', 1, 11],
    ['02-grishma-summer', 3, 13],
    ['03-varsha-monsoon', 5, 12],
    ['04-sharad-autumn', 7, 16],
    ['05-hemant-early-winter', 9, 7],
    ['06-shishir-winter-fog', 11, 7.2],
    ['07-shishir-winter-noon', 11, 13],
  ];
  for (const [name, month, hour] of shots) {
    await page.evaluate(([m, h]) => window.__game!.season(m, h), [month, hour] as const);
    await page.evaluate(() => window.__game!.frames(50));
    await page.waitForTimeout(600);
    await page.screenshot({ path: `${DIR}/${name}.png` });
  }
  // Monsoon rain up close: the streaks need a near camera.
  await page.evaluate(() => window.__game!.camera({ x: 1250, z: 600, yaw: 0.4, pitch: 0.35, dist: 110 }, true));
  await page.evaluate(() => window.__game!.season(5, 12));
  await page.evaluate(() => window.__game!.frames(50));
  await page.screenshot({ path: `${DIR}/08-monsoon-street.png` });
});
