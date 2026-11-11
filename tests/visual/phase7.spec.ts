import { test } from '@playwright/test';
import { advance, buildTown, openGame, pose, shoot, zoneTown } from './helpers';

test('phase 7: day and night', async ({ page }) => {
  await openGame(page);
  await buildTown(page);
  await zoneTown(page);
  await advance(page, 3600);

  const wide = pose(1350, 600, 25, 40, 640);
  const hours: Array<[number, string]> = [
    [6.6, '01-dawn'],
    [10, '02-morning'],
    [14.5, '03-afternoon'],
    [17.6, '04-golden-hour'],
    [18.6, '05-dusk'],
    [22, '06-night'],
  ];
  for (const [hour, name] of hours) {
    await page.evaluate((h) => window.__game!.time(h), hour);
    await shoot(page, 7, name, wide, 20);
  }
  await shoot(page, 7, '07-night-avenue', pose(1312, 584, 180, 44, 150), 20);
  await shoot(page, 7, '08-night-street', pose(1200, 488, 100, 30, 70), 20);
  await shoot(page, 7, '09-night-skyline', pose(1330, 640, 200, 14, 520), 20);
  await page.evaluate((h) => window.__game!.time(h), 18.2);
  await shoot(page, 7, '10-sunset-skyline', pose(1330, 640, 110, 12, 520), 20);
});

test('phase 7: save, load and new city', async ({ page }) => {
  await openGame(page);
  await buildTown(page);
  await zoneTown(page);
  await advance(page, 2400);
  const before = await page.evaluate(() => {
    // Paused, so the saved and loaded cities can be compared tick for tick.
    window.__game!.exec({ type: 'setSpeed', speed: 0 });
    const s = window.__game!.game.sim.state;
    return { buildings: s.buildings.filter(Boolean).length, edges: s.roads.edges.filter(Boolean).length, tick: s.tick, seed: s.seed };
  });

  await page.getByRole('button', { name: 'Menu' }).click();
  await page.locator('.menu .loan', { hasText: 'Slot 1' }).getByRole('button', { name: 'Save' }).click();
  await page.getByText('City saved.').waitFor();
  await page.screenshot({ path: 'screenshots/phase-7/11-menu.png' });

  // Start a different city, then load the saved one back.
  await page.getByPlaceholder('Random').fill('4242');
  await page.getByRole('button', { name: 'Start new city' }).click();
  await page.getByText('New city started').waitFor();
  const fresh = await page.evaluate(async () => {
    await window.__game!.frames(20);
    const s = window.__game!.game.sim.state;
    return { buildings: s.buildings.filter(Boolean).length, edges: s.roads.edges.filter(Boolean).length, seed: s.seed };
  });
  console.log('new city:', JSON.stringify(fresh));
  await page.getByRole('button', { name: 'Close menu' }).click();
  await shoot(page, 7, '12-new-city', pose(1024, 1024, 30, 40, 900));

  await page.getByRole('button', { name: 'Menu' }).click();
  await page.locator('.menu .loan', { hasText: 'Slot 1' }).getByRole('button', { name: 'Load' }).click();
  await page.getByText('City loaded.').waitFor();
  await page.getByRole('button', { name: 'Close menu' }).click();
  const after = await page.evaluate(async () => {
    await window.__game!.frames(30);
    const s = window.__game!.game.sim.state;
    return { buildings: s.buildings.filter(Boolean).length, edges: s.roads.edges.filter(Boolean).length, tick: s.tick, seed: s.seed };
  });
  console.log('saved:', JSON.stringify(before), 'loaded:', JSON.stringify(after));
  if (JSON.stringify(before) !== JSON.stringify(after)) throw new Error('Loaded city does not match the saved one');
  await shoot(page, 7, '13-loaded', pose(1350, 600, 25, 46, 620));
});

test('phase 7: performance on a larger city', async ({ page }) => {
  await openGame(page);
  const built = await page.evaluate(() => {
    const g = window.__game!;
    g.exec({ type: 'setSandbox', on: true });
    let roads = 0;
    const xs: number[] = [];
    const zs: number[] = [];
    for (let x = 960; x <= 1728; x += 128) xs.push(x);
    for (let z = 296; z <= 936; z += 128) zs.push(z);
    for (const z of zs) if (g.exec({ type: 'buildRoad', road: z === 552 ? 1 : 0, ax: xs[0]!, az: z, bx: xs[xs.length - 1]!, bz: z }).ok) roads++;
    for (const x of xs) if (g.exec({ type: 'buildRoad', road: x === 1344 ? 1 : 0, ax: x, az: zs[0]!, bx: x, bz: zs[zs.length - 1]! }).ok) roads++;
    // Zone every block: homes in the north, shops in the middle, industry in the south.
    const codes = [5, 6, 7, 9, 10, 11, 13, 14];
    let n = 0;
    for (let bz = 0; bz < zs.length - 1; bz++) {
      for (let bx = 0; bx < xs.length - 1; bx++) {
        const zone = bz < 2 ? codes[n % 3]! : bz < 4 ? codes[3 + (n % 3)]! : codes[6 + (n % 2)]!;
        n++;
        g.exec({ type: 'zoneRect', x0: xs[bx]! / 8 + 1, y0: zs[bz]! / 8 + 1, x1: xs[bx + 1]! / 8 - 2, y1: zs[bz + 1]! / 8 - 2, zone });
      }
    }
    g.game.sim.growthRate = 1;
    return roads;
  });
  console.log('roads built:', built);
  await advance(page, 7000);
  const perf = await page.evaluate(async () => {
    const g = window.__game!;
    g.camera({ x: 1344, z: 620, yaw: 0.5, pitch: 0.7, dist: 800 }, true);
    await g.frames(150);
    const sim = g.game.sim;
    const t0 = performance.now();
    for (let i = 0; i < 200; i++) sim.tick();
    const tickMs = (performance.now() - t0) / 200;
    await g.frames(60);
    return { ...g.stats(), tickMs: +tickMs.toFixed(3), buildings: sim.state.buildings.filter(Boolean).length, population: sim.state.stats.population };
  });
  console.log('large city:', JSON.stringify(perf));
  await shoot(page, 7, '14-large-city', pose(1344, 620, 30, 40, 900));
  await page.evaluate(() => window.__game!.time(21.5));
  await shoot(page, 7, '15-large-city-night', pose(1344, 620, 30, 34, 760), 20);
});
