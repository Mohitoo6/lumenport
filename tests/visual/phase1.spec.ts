import { test } from '@playwright/test';
import { openGame, pose, shoot } from './helpers';

test('phase 1: empty landscape', async ({ page }) => {
  await openGame(page);
  const info = await page.evaluate(() => window.__game!.stats());
  console.log('GPU:', info.gpu, '| trees:', info.trees);

  await shoot(page, 1, '01-wide', pose(1024, 1100, 35, 30, 1500));
  await shoot(page, 1, '02-mid-river', pose(1050, 1330, 20, 42, 520));
  await shoot(page, 1, '03-close-shore', pose(700, 760, 140, 30, 110));
  await shoot(page, 1, '04-top-down', pose(1024, 1024, 0, 85, 1100));
  await shoot(page, 1, '05-forest-low', pose(1300, 760, -60, 22, 160));
  await shoot(page, 1, '06-horizon', pose(1024, 1024, 200, 16, 900));

  const stats = await page.evaluate(async () => {
    window.__game!.camera({ x: 1024, z: 1100, yaw: 0.6, pitch: 0.7, dist: 700 }, true);
    await window.__game!.frames(90);
    return window.__game!.stats();
  });
  console.log('stats @700m:', JSON.stringify(stats));
});

test('phase 1: hud', async ({ page }) => {
  await openGame(page, 'dev=1');
  await page.evaluate(() => window.__game!.frames(40));
  await page.screenshot({ path: 'screenshots/phase-1/07-hud.png' });
});
