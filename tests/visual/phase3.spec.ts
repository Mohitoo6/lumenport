import { test } from '@playwright/test';
import { advance, buildTown, openGame, pose, shoot, zoneTown } from './helpers';

test('phase 3: zoning and buildings', async ({ page }) => {
  await openGame(page);
  await buildTown(page);
  await zoneTown(page);

  await advance(page, 260);
  await shoot(page, 3, '01-construction', pose(1320, 600, 30, 42, 420));

  await advance(page, 3200);
  const n = await page.evaluate(() => window.__game!.game.sim.state.buildings.filter(Boolean).length);
  console.log('buildings:', n);

  await shoot(page, 3, '02-town-wide', pose(1350, 600, 25, 46, 720));
  await shoot(page, 3, '03-houses', pose(1200, 455, 160, 34, 120));
  await shoot(page, 3, '04-terraces-apartments', pose(1200, 540, 20, 34, 130));
  await shoot(page, 3, '05-shops', pose(1312, 530, 200, 30, 110));
  await shoot(page, 3, '06-midrise', pose(1440, 600, 30, 30, 170));
  await shoot(page, 3, '07-towers', pose(1312, 640, 150, 26, 260));
  await shoot(page, 3, '08-res-towers', pose(1184, 640, 200, 30, 190));
  await shoot(page, 3, '09-warehouses', pose(1184, 730, 20, 34, 140));
  await shoot(page, 3, '10-factory', pose(1312, 730, 200, 32, 150));
  await shoot(page, 3, '11-heavy', pose(1440, 730, 30, 30, 170));
  await shoot(page, 3, '12-street-level', pose(1376, 560, 80, 16, 70));
  await shoot(page, 3, '13-top-down', pose(1320, 600, 0, 86, 520));

  const stats = await page.evaluate(async () => {
    window.__game!.camera({ x: 1340, z: 600, yaw: 0.5, pitch: 0.75, dist: 600 }, true);
    await window.__game!.frames(90);
    return window.__game!.stats();
  });
  console.log('stats @600m:', JSON.stringify(stats));
});

test('phase 3: zone tool', async ({ page }) => {
  await openGame(page);
  await buildTown(page);
  await page.evaluate(async () => {
    window.__game!.game.sim.growthRate = 0;
    // Some zoning already in place, so the overlay colours are visible.
    window.__game!.exec({ type: 'zoneRect', x0: 141, y0: 54, x1: 154, y1: 59, zone: 5 });
    window.__game!.exec({ type: 'zoneRect', x0: 157, y0: 62, x1: 170, y1: 70, zone: 10 });
    window.__game!.exec({ type: 'zoneRect', x0: 141, y0: 86, x1: 154, y1: 92, zone: 14 });
    window.__game!.camera({ x: 1300, z: 600, yaw: 0.3, pitch: 0.95, dist: 380 }, true);
    await window.__game!.frames(10);
  });
  await page.getByRole('button', { name: 'Homes' }).click();
  await page.getByRole('button', { name: 'High density' }).click();
  await page.mouse.move(720, 500);
  await page.mouse.down();
  await page.mouse.move(1010, 600, { steps: 8 });
  await page.evaluate(() => window.__game!.frames(25));
  await page.screenshot({ path: 'screenshots/phase-3/14-zone-tool.png' });
  await page.mouse.up();
  const zoned = await page.evaluate(() => window.__game!.game.sim.state.zone.reduce((n, z) => n + (z === 7 ? 1 : 0), 0));
  console.log('cells zoned by drag:', zoned);

  // Let it grow, then demolish one building with the bulldozer.
  await page.evaluate(() => (window.__game!.game.sim.growthRate = 1));
  await advance(page, 900);
  await page.getByRole('button', { name: 'Bulldoze' }).click();
  await page.mouse.move(820, 520, { steps: 4 });
  await page.evaluate(() => window.__game!.frames(20));
  await page.screenshot({ path: 'screenshots/phase-3/15-bulldoze-building.png' });
});
