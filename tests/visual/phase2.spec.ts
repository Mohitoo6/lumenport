import { test } from '@playwright/test';
import { buildTown, openGame, pose, shoot } from './helpers';

test('phase 2: roads', async ({ page }) => {
  await openGame(page);
  await buildTown(page);
  await shoot(page, 2, '01-town-wide', pose(1390, 624, 25, 48, 760));
  await shoot(page, 2, '02-grid-mid', pose(1310, 564, -30, 40, 300));
  await shoot(page, 2, '03-avenue-junction', pose(1376, 584, 40, 38, 110));
  await shoot(page, 2, '04-street-junction', pose(1248, 488, 200, 30, 62));
  await shoot(page, 2, '05-skewed', pose(1248, 744, 10, 55, 110));
  await shoot(page, 2, '06-curves', pose(1700, 564, -70, 45, 240));
  await shoot(page, 2, '07-bridge', pose(1376, 1370, 60, 24, 170));
  await shoot(page, 2, '08-top-down', pose(1320, 584, 0, 86, 420));
  await shoot(page, 2, '09-dead-end', pose(1504, 800, 150, 35, 70));
  const stats = await page.evaluate(async () => {
    window.__game!.camera({ x: 1360, z: 600, yaw: 0.5, pitch: 0.75, dist: 600 }, true);
    await window.__game!.frames(90);
    return window.__game!.stats();
  });
  console.log('stats @600m:', JSON.stringify(stats));
});

test('phase 2: road tool', async ({ page }) => {
  await openGame(page);
  await buildTown(page);
  await page.evaluate(async () => {
    window.__game!.camera({ x: 1300, z: 800, yaw: 0.35, pitch: 0.85, dist: 330 }, true);
    await window.__game!.frames(10);
  });
  await page.getByRole('button', { name: 'Street' }).click();
  // Draw one street by hand, then leave a second one half-drawn so the preview shows.
  await page.mouse.click(560, 420);
  await page.mouse.move(900, 470, { steps: 6 });
  await page.mouse.click(900, 470);
  await page.mouse.move(1010, 300, { steps: 8 });
  await page.evaluate(() => window.__game!.frames(20));
  await page.screenshot({ path: 'screenshots/phase-2/10-tool-straight.png' });

  await page.mouse.click(1010, 300, { button: 'right' });
  await page.getByRole('button', { name: 'Curved' }).click();
  await page.mouse.click(500, 600);
  await page.mouse.move(760, 640, { steps: 5 });
  await page.mouse.click(760, 640);
  await page.mouse.move(900, 760, { steps: 8 });
  await page.evaluate(() => window.__game!.frames(20));
  await page.screenshot({ path: 'screenshots/phase-2/11-tool-curve.png' });

  await page.getByRole('button', { name: 'Bulldoze' }).click();
  await page.mouse.move(700, 440, { steps: 5 });
  await page.evaluate(() => window.__game!.frames(20));
  await page.screenshot({ path: 'screenshots/phase-2/12-tool-bulldoze.png' });
  const roads = await page.evaluate(() => window.__game!.game.sim.state.roads.edges.filter(Boolean).length);
  console.log('edges after manual drawing:', roads);
});
