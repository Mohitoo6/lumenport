import { mkdirSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { advance, buildTown, openGame, zoneTown } from './helpers';

const DIR = 'screenshots/metro';

test('metro line, stations, IT park and university', async ({ page }) => {
  test.setTimeout(240_000);
  mkdirSync(DIR, { recursive: true });
  await openGame(page, 'shots=1');
  await buildTown(page);
  await zoneTown(page);
  await advance(page, 3600);
  const info = await page.evaluate(() => {
    const g = window.__game!;
    const s = g.game.sim.state;
    s.funds = 400_000;
    const placeNear = (kind: number, x: number, y: number): number => {
      for (let r = 0; r < 30; r++) {
        for (let dy = -r; dy <= r; dy++) {
          for (let dx = -r; dx <= r; dx++) {
            if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
            if (g.exec({ type: 'placeFacility', kind, x: x + dx, y: y + dy } as never).ok) return s.buildings.length - 1;
          }
        }
      }
      return -1;
    };
    // Stations at both ends of the avenue (z = 584) and at the south end of the street at x = 1376.
    const a = placeNear(14, 126, 72);
    const b = placeNear(14, 202, 72);
    const c = placeNear(14, 174, 127);
    const it = placeNear(12, 205, 95);
    const uni = placeNear(13, 120, 112);
    for (const id of s.constructing.slice()) s.buildings[id]!.progress = 1;
    s.constructing.length = 0;
    g.exec({ type: 'setSpeed', speed: 1 });
    const sa = s.buildings[a]!;
    const sb = s.buildings[b]!;
    const sc = s.buildings[c]!;
    // Over the avenue that runs through the town, as a real elevated line would.
    const l1 = g.exec({ type: 'buildMetro', a, b, via: [[1060, 584], [1580, 584]] } as never);
    // Back along the avenue, then turning south down the street at x = 1376.
    const l2 = g.exec({ type: 'buildMetro', a: b, b: c, via: [[1560, 588], [1420, 590], [1378, 640], [1376, 900]] } as never);
    void sa;
    void sc;
    g.advance(200);
    return { a, b, c, it, uni, l1: l1.reason ?? 'ok', l2: l2.reason ?? 'ok', riders: s.stats.metroRiders, stations: [sa.x, sa.y, sb.x, sb.y] };
  });
  console.log('metro:', JSON.stringify(info));
  expect(info.l1).toBe('ok');
  await page.evaluate(() => window.__game!.frames(60));
  const [ax, ay, bx, by] = info.stations;
  const cx = ((ax! + bx!) / 2) * 8;
  const cz = ((ay! + by!) / 2) * 8;
  const shots: Array<[string, object]> = [
    ['01-overview', { x: cx, z: cz + 40, yaw: 0.35, pitch: 0.75, dist: 520 }],
    ['02-viaduct', { x: cx, z: cz - 40, yaw: 1.2, pitch: 0.4, dist: 160 }],
    ['03-station', { x: ax! * 8 + 8, z: ay! * 8 + 8, yaw: 2.3, pitch: 0.42, dist: 90 }],
  ];
  for (const [name, pose] of shots) {
    await page.evaluate((p) => window.__game!.camera(p, true), pose);
    await page.evaluate(() => window.__game!.frames(30));
    await page.screenshot({ path: `${DIR}/${name}.png` });
  }
  const campus = await page.evaluate(({ it, uni }) => {
    const s = window.__game!.game.sim.state;
    return [s.buildings[it], s.buildings[uni]].map((b) => (b ? [b.x * 8 + b.w * 4, b.y * 8 + b.h * 4] : null));
  }, info);
  if (campus[0]) {
    await page.evaluate(([x, z]) => window.__game!.camera({ x, z, yaw: 0.8, pitch: 0.5, dist: 140 }, true), campus[0]);
    await page.evaluate(() => window.__game!.frames(30));
    await page.screenshot({ path: `${DIR}/04-it-park.png` });
  }
  if (campus[1]) {
    await page.evaluate(([x, z]) => window.__game!.camera({ x, z, yaw: 2.6, pitch: 0.5, dist: 160 }, true), campus[1]);
    await page.evaluate(() => window.__game!.frames(30));
    await page.screenshot({ path: `${DIR}/05-university.png` });
  }
  // Night: lit train windows.
  await page.evaluate(() => {
    window.__game!.time(21.5);
  });
  await page.evaluate((p) => window.__game!.camera(p, true), shots[1]![1]);
  await page.evaluate(() => window.__game!.frames(40));
  await page.screenshot({ path: `${DIR}/06-night.png` });
  // The metro reach view and the budget.
  await page.evaluate(() => window.__game!.time(14.5));
  await page.evaluate((p) => window.__game!.camera(p, true), shots[0]![1]);
  await page.getByRole('button', { name: 'Views' }).click();
  await page.getByRole('menuitemradio', { name: 'Metro reach' }).click();
  await page.evaluate(() => window.__game!.frames(30));
  await page.screenshot({ path: `${DIR}/07-metro-reach.png` });
  await page.keyboard.press('KeyV');
  await page.getByRole('menuitemradio', { name: 'Normal view' }).click();
  await page.getByRole('button', { name: 'Metro', exact: true }).click();
  await page.keyboard.press('KeyB');
  await page.evaluate(() => window.__game!.frames(10));
  await page.screenshot({ path: `${DIR}/08-toolbar-budget.png` });
});
