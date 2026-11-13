import { mkdirSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { openGame } from './helpers';

const DIR = 'screenshots/zoning';

// Zoning along roads of any shape: diagonal, zigzag and curved streets fill with buildings
// that face the street.
test('zoning along diagonal, zigzag and curved roads', async ({ page }) => {
  mkdirSync(DIR, { recursive: true });
  await openGame(page, 'shots=1');
  const stats = await page.evaluate(() => {
    const g = window.__game!;
    const s = g.game.sim.state;
    s.sandbox = true;
    const roads: Array<[number, number, number, number, number?, number?]> = [
      [1100, 450, 1380, 730],
      [1380, 730, 1520, 600],
      [900, 820, 1000, 880],
      [1000, 880, 1100, 810],
      [1100, 810, 1200, 890],
      [1200, 890, 1300, 820],
    ];
    for (const [ax, az, bx, bz] of roads) g.exec({ type: 'buildRoad', road: 0, ax, az, bx, bz });
    // A curve: start, control, end.
    g.exec({ type: 'buildRoad', road: 0, ax: 1450, az: 900, bx: 1700, bz: 700, cx: 1680, cz: 920 } as never);
    const edges = s.roads.edges.filter((e) => e).map((e) => e!.id);
    const r1 = g.exec({ type: 'zoneAlong', edges: edges.slice(0, 2), zone: 5 });
    const r2 = g.exec({ type: 'zoneAlong', edges: edges.slice(2, 6), zone: 9 });
    const r3 = g.exec({ type: 'zoneAlong', edges: edges.slice(6), zone: 6 });
    g.advance(3000);
    let zoned = 0;
    let built = 0;
    for (let k = 0; k < s.zone.length; k++) {
      if (s.zone[k] === 0) continue;
      zoned++;
      if (s.buildingCell[k]! >= 0) built++;
    }
    return { r1: r1.ok, r2: r2.ok, r3: r3.ok, zoned, built, turned: s.buildings.filter((b) => b && b.dir !== undefined).length };
  });
  console.log('zoning:', JSON.stringify(stats));
  expect(stats.built / stats.zoned).toBeGreaterThan(0.6);
  await page.evaluate(() => window.__game!.frames(30));
  for (const [name, pose] of [
    ['01-diagonal', { x: 1250, z: 600, yaw: 0.2, pitch: 0.85, dist: 330 }],
    ['02-zigzag', { x: 1100, z: 850, yaw: 0.0, pitch: 0.9, dist: 330 }],
    ['03-curve', { x: 1580, z: 800, yaw: -0.3, pitch: 0.8, dist: 330 }],
    ['04-street-level', { x: 1240, z: 600, yaw: 2.4, pitch: 0.35, dist: 110 }],
    ['05-curve-close', { x: 1600, z: 850, yaw: 0.9, pitch: 0.45, dist: 120 }],
  ] as const) {
    await page.evaluate((p) => window.__game!.camera(p, true), pose);
    await page.evaluate(() => window.__game!.frames(20));
    await page.screenshot({ path: `${DIR}/${name}.png` });
  }
});

test('zone tool: along-road brush preview', async ({ page }) => {
  mkdirSync(DIR, { recursive: true });
  await openGame(page, 'shots=1');
  await page.evaluate(() => {
    const g = window.__game!;
    g.game.sim.state.sandbox = true;
    g.exec({ type: 'buildRoad', road: 0, ax: 1100, az: 450, bx: 1380, bz: 730 });
    g.camera({ x: 1240, z: 590, yaw: 0, pitch: 1.2, dist: 300 }, true);
  });
  await page.getByRole('button', { name: 'Homes' }).click();
  await expect(page.getByRole('button', { name: 'Along road' })).toHaveAttribute('aria-pressed', 'true');
  // Hover the road at the centre of the view.
  const box = (await page.locator('canvas').boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.evaluate(() => window.__game!.frames(10));
  await page.screenshot({ path: `${DIR}/06-brush-preview.png` });
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 20, box.y + box.height / 2 + 20, { steps: 4 });
  await page.mouse.up();
  await page.evaluate(() => window.__game!.frames(10));
  const zoned = await page.evaluate(() => Array.from(window.__game!.game.sim.state.zone).filter((z) => z !== 0).length);
  expect(zoned).toBeGreaterThan(60);
  await page.screenshot({ path: `${DIR}/07-brush-zoned.png` });
});
