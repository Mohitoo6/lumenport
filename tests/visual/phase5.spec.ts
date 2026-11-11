import { test } from '@playwright/test';
import { advance, buildTown, openGame, pose, shoot, zoneTown } from './helpers';

test('phase 5: traffic', async ({ page }) => {
  await openGame(page);
  await buildTown(page);
  await zoneTown(page);
  await advance(page, 3600);
  const info = await page.evaluate(() => {
    const s = window.__game!.game.sim;
    return { pop: s.state.stats.population, cars: s.traffic.count, arrived: s.traffic.arrived, congestion: s.traffic.congestion };
  });
  console.log('traffic:', JSON.stringify(info));

  await shoot(page, 5, '01-town-wide', pose(1350, 600, 25, 46, 620));
  await shoot(page, 5, '02-avenue', pose(1312, 584, 180, 50, 130));
  await shoot(page, 5, '03-junction', pose(1376, 584, 180, 58, 80));
  await shoot(page, 5, '04-street', pose(1200, 488, 100, 40, 60));
  await shoot(page, 5, '05-cars-close', pose(1300, 590, 80, 42, 26));
  await shoot(page, 5, '06-residential', pose(1200, 440, 150, 38, 120));

  // Load test: far more cars than this town would normally have.
  const perf = await page.evaluate(async () => {
    const g = window.__game!;
    g.game.sim.traffic.carsPerPerson = 0.3;
    g.exec({ type: 'setSpeed', speed: 1 });
    for (let i = 0; i < 40 && g.game.sim.traffic.count < 1100; i++) {
      g.advance(100);
      await g.frames(2);
    }
    g.camera({ x: 1340, z: 600, yaw: 0.5, pitch: 0.75, dist: 600 }, true);
    await g.frames(150);
    const t = g.game.sim.traffic;
    // Cost of one traffic tick, averaged.
    const t0 = performance.now();
    for (let i = 0; i < 200; i++) t.tick();
    const tickMs = (performance.now() - t0) / 200;
    return { ...g.stats(), arrived: t.arrived, congestion: t.congestion, tickMs };
  });
  console.log('load test:', JSON.stringify(perf));
  await shoot(page, 5, '07-heavy-traffic', pose(1350, 600, 25, 46, 520));
  await shoot(page, 5, '08-jam', pose(1376, 584, 180, 55, 130));
});
