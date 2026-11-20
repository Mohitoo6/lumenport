import { test } from '@playwright/test';
import { advance, buildTown, openGame, zoneTown } from './helpers';

/** Frame cost of the grown test town from above, logged for a before/after comparison. */
test('frame cost of the grown town', async ({ page }) => {
  test.setTimeout(300_000);
  await openGame(page, 'shots=1');
  await buildTown(page);
  await zoneTown(page);
  await advance(page, 5200);
  for (const [name, dist] of [['overview', 360], ['street', 90]] as const) {
    await page.evaluate(([d]) => window.__game!.camera({ x: 1320, z: 520, yaw: 0.7, pitch: 0.6, dist: d }, true), [dist] as const);
    await page.evaluate(() => window.__game!.frames(120));
    const s = await page.evaluate(() => window.__game!.stats());
    console.log(`PERF ${name}: tris ${s.triangles} draws ${s.drawCalls} frame ${s.frameMs.toFixed(2)}ms fps ${s.fps.toFixed(0)}`);
  }
});
