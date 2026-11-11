import { test } from '@playwright/test';
import { advance, buildTown, openGame, pose, shoot, zoneTown } from './helpers';

test('phase 6: services, data views and inspection', async ({ page }) => {
  await openGame(page);
  await buildTown(page);
  await zoneTown(page);
  const placed = await page.evaluate(() => {
    const g = window.__game!;
    const out: string[] = [];
    const place = (kind: number, x: number, y: number): void => {
      const r = g.exec({ type: 'placeFacility', kind, x, y });
      if (!r.ok) out.push(`${kind}@${x},${y}: ${r.reason}`);
    };
    // Along the road south of town and on the east loop: all five service kinds.
    place(6, 173, 96); // police
    place(7, 173, 100); // fire station
    place(8, 169, 96); // clinic
    place(9, 174, 105); // school
    place(10, 169, 100); // park
    place(10, 169, 118);
    place(1, 174, 112); // coal plant, to show pollution
    return out;
  });
  for (const p of placed) console.log('place', p);

  await advance(page, 3800);
  const stats = await page.evaluate(() => window.__game!.game.sim.state.stats);
  console.log('happiness:', stats.happiness.toFixed(2), 'pop:', stats.population, 'employed:', stats.employed, 'congestion:', stats.congestion.toFixed(2));
  const sample = await page.evaluate(() => {
    const s = window.__game!.game.sim;
    const f = s.fields;
    const acc = { n: 0, lv: 0, pol: 0, crime: 0, hap: 0 };
    for (const b of s.state.buildings) {
      if (!b || b.kind !== 0 || b.zone >> 2 !== 1 || b.progress < 1) continue;
      const k = (b.y + (b.h >> 1)) * 256 + b.x + (b.w >> 1);
      acc.n++;
      acc.lv += f.landValue[k]!;
      acc.pol += f.pollution[k]!;
      acc.crime += f.crime[k]!;
      acc.hap += f.happiness[k]!;
    }
    return Object.fromEntries(Object.entries(acc).map(([k, v]) => [k, k === 'n' ? v : +(v / acc.n).toFixed(3)]));
  });
  console.log('home averages:', JSON.stringify(sample));

  await shoot(page, 6, '01-services', pose(1390, 810, -60, 34, 150));
  await shoot(page, 6, '02-school-park', pose(1380, 840, 120, 36, 110));

  const views: Array<[string, string]> = [
    ['Pollution', '03-view-pollution'],
    ['Land value', '04-view-land-value'],
    ['Crime', '05-view-crime'],
    ['Happiness', '06-view-happiness'],
    ['Traffic', '07-view-traffic'],
    ['Police cover', '08-view-police'],
    ['Power', '09-view-power'],
  ];
  await page.evaluate(async () => {
    window.__game!.camera({ x: 1360, z: 660, yaw: 0.4, pitch: 0.95, dist: 780 }, true);
    await window.__game!.frames(10);
  });
  for (const [name, file] of views) {
    await page.getByRole('button', { name: /Views|view|cover|Pollution|Land value|Crime|Happiness|Traffic|Power|Water/ }).first().click();
    await page.getByRole('menuitemradio', { name, exact: true }).click();
    await page.evaluate(() => window.__game!.frames(40));
    await page.screenshot({ path: `screenshots/phase-6/${file}.png` });
  }
  await page.locator('.views-btn').click();
  await page.getByRole('menuitemradio', { name: 'Normal view' }).click();

  // Click a building with no tool selected: the inspect panel opens.
  await page.evaluate(async () => {
    window.__game!.camera({ x: 1200, z: 470, yaw: 0.3, pitch: 0.8, dist: 150 }, true);
    await window.__game!.frames(30);
  });
  await page.mouse.click(800, 450);
  await page.evaluate(() => window.__game!.frames(30));
  await page.screenshot({ path: 'screenshots/phase-6/10-inspect.png' });

  const perf = await page.evaluate(async () => {
    window.__game!.camera({ x: 1340, z: 600, yaw: 0.5, pitch: 0.75, dist: 600 }, true);
    await window.__game!.frames(90);
    return window.__game!.stats();
  });
  console.log('stats @600m:', JSON.stringify(perf));
});
