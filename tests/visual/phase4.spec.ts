import { test } from '@playwright/test';
import { advance, buildTown, openGame, pose, shoot } from './helpers';

/** Zone codes: type * 4 + density. */
const Z = { R1: 5, R2: 6, R3: 7, C1: 9, C2: 10, I1: 13, I2: 14 };

test('phase 4: a city that pays its way', async ({ page }) => {
  await openGame(page);

  // The empty map: the HUD should tell a new player what to do first.
  await shoot(page, 4, '01-start', pose(1320, 600, 25, 46, 620));

  await buildTown(page, false);
  await shoot(page, 4, '02-roads-no-utilities', pose(1320, 600, 25, 46, 620));

  const placed = await page.evaluate((Z) => {
    const g = window.__game!;
    const out: string[] = [];
    const place = (kind: number, x: number, y: number): void => {
      const r = g.exec({ type: 'placeFacility', kind, x, y });
      out.push(`${kind}@${x},${y}: ${r.ok ? 'ok' : r.reason}`);
    };
    // The road network cost most of the starting funds: borrow, as a player would.
    g.exec({ type: 'takeLoan', tier: 0 });
    g.exec({ type: 'takeLoan', tier: 1 });
    // Power and water along the road south of town, away from the homes.
    place(1, 174, 100); // coal plant
    place(2, 173, 106); // wind turbines
    place(2, 173, 110);
    place(3, 174, 115); // solar farm
    place(4, 173, 120); // water towers
    place(4, 173, 124);
    const zone = (x0: number, y0: number, x1: number, y1: number, zone: number): void => {
      g.exec({ type: 'zoneRect', x0, y0, x1, y1, zone });
    };
    zone(131, 47, 199, 51, Z.R1);
    zone(131, 54, 170, 59, Z.R1);
    zone(173, 54, 199, 59, Z.R2);
    zone(131, 62, 154, 70, Z.R2);
    zone(157, 62, 199, 70, Z.C1);
    zone(131, 75, 154, 83, Z.R3);
    zone(157, 75, 186, 83, Z.C2);
    zone(131, 86, 170, 92, Z.I1);
    zone(173, 86, 199, 92, Z.I2);
    return out;
  }, Z);
  for (const p of placed) if (!p.endsWith('ok')) console.log('place', p);

  await advance(page, 40 * 12);
  await shoot(page, 4, '03-utilities', pose(1400, 900, -50, 30, 230));
  await shoot(page, 4, '04-coal-plant', pose(1404, 800, 120, 28, 120));

  await advance(page, 40 * 400);
  const s = await page.evaluate(() => {
    const st = window.__game!.game.sim.state;
    return { funds: Math.round(st.funds), stats: st.stats, report: st.report, buildings: st.buildings.filter(Boolean).length };
  });
  console.log('after 412 days:', JSON.stringify(s));

  await page.keyboard.press('b');
  await shoot(page, 4, '05-city-budget', pose(1340, 600, 25, 46, 700));
  await page.keyboard.press('b');
  await shoot(page, 4, '06-city-mid', pose(1300, 620, -20, 36, 330));

  // Placement preview: valid beside a road, refused in open country.
  await page.getByRole('button', { name: 'Power', exact: true }).click();
  await page.evaluate(async () => {
    window.__game!.camera({ x: 1400, z: 1080, yaw: 0.2, pitch: 0.9, dist: 260 }, true);
    await window.__game!.frames(10);
  });
  await page.mouse.move(900, 430, { steps: 4 });
  await page.evaluate(() => window.__game!.frames(20));
  await page.screenshot({ path: 'screenshots/phase-4/07-place-tool.png' });

  const stats = await page.evaluate(async () => {
    window.__game!.camera({ x: 1340, z: 600, yaw: 0.5, pitch: 0.75, dist: 600 }, true);
    await window.__game!.frames(90);
    return window.__game!.stats();
  });
  console.log('stats @600m:', JSON.stringify(stats));
});
