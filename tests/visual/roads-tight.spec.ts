import { mkdirSync } from 'node:fs';
import { test } from '@playwright/test';
import { openGame } from './helpers';

const DIR = 'screenshots/roads-tight';

type Road = { road: number; ax: number; az: number; bx: number; bz: number; cx?: number; cz?: number };

/**
 * Tight shapes a player draws: U-turns as one curve, hairpins from two curves, sharp
 * corners from two straights, on streets and avenues. Prints what the game accepted and
 * photographs each from above and at an angle.
 */
test('roads: U-turns, hairpins and sharp corners', async ({ page }) => {
  test.setTimeout(200_000);
  mkdirSync(DIR, { recursive: true });
  await openGame(page, 'shots=1');
  await page.evaluate(() => window.__game!.exec({ type: 'setSandbox', on: true }));
  const cases: Array<{ name: string; x: number; z: number; roads: Road[] }> = [
    { name: '01-u-street', x: 700, z: 700, roads: [{ road: 0, ax: 660, az: 660, bx: 660, bz: 740, cx: 800, cz: 700 }] },
    { name: '02-u-avenue', x: 1000, z: 700, roads: [{ road: 1, ax: 940, az: 640, bx: 940, bz: 760, cx: 1120, cz: 700 }] },
    {
      name: '03-hairpin-street',
      x: 700,
      z: 1000,
      roads: [
        { road: 0, ax: 600, az: 960, bx: 720, bz: 960 },
        { road: 0, ax: 720, az: 960, bx: 720, bz: 1040, cx: 790, cz: 1000 },
        { road: 0, ax: 720, az: 1040, bx: 600, bz: 1040 },
      ],
    },
    {
      name: '04-sharp-corner',
      x: 1000,
      z: 1000,
      roads: [
        { road: 0, ax: 900, az: 1000, bx: 1040, bz: 1000 },
        { road: 0, ax: 1040, az: 1000, bx: 920, bz: 1060 },
      ],
    },
    {
      name: '05-sharp-corner-avenue',
      x: 1300,
      z: 1000,
      roads: [
        { road: 1, ax: 1180, az: 1000, bx: 1340, bz: 1000 },
        { road: 1, ax: 1340, az: 1000, bx: 1210, bz: 1080 },
      ],
    },
    {
      name: '06-s-bend-chain',
      x: 1300,
      z: 700,
      roads: [
        { road: 0, ax: 1200, az: 640, bx: 1300, bz: 700, cx: 1290, cz: 620 },
        { road: 0, ax: 1300, az: 700, bx: 1400, bz: 760, cx: 1310, cz: 780 },
      ],
    },
  ];
  // Corners of several sharpnesses: an arm from (x - 120, z) to (x, z), then one leaving at `deg` from straight on.
  for (const [k, deg, road] of [
    [7, 90, 0],
    [8, 90, 1],
    [9, 120, 0],
    [10, 120, 1],
    [11, 135, 1],
  ] as const) {
    const x = 400 + k * 160;
    const z = 1400;
    const a = (deg * Math.PI) / 180;
    cases.push({ name: `${String(k).padStart(2, '0')}-turn-${deg}-${road ? 'avenue' : 'street'}`, x, z, roads: [{ road, ax: x - 120, az: z, bx: x, bz: z }, { road, ax: x, az: z, bx: x + Math.cos(a) * 110, bz: z + Math.sin(a) * 110 }] });
  }
  for (const c of cases) {
    const results = await page.evaluate((roads) => roads.map((r) => window.__game!.exec({ type: 'buildRoad', ...r })), c.roads);
    console.log(c.name, JSON.stringify(results.map((r) => (r.ok ? 'ok' : r.reason))));
  }
  await page.evaluate(() => window.__game!.frames(20));
  for (const c of cases) {
    await page.evaluate(([x, z]) => window.__game!.camera({ x, z, yaw: 0, pitch: 1.45, dist: 230 }, true), [c.x, c.z] as const);
    await page.evaluate(() => window.__game!.frames(14));
    await page.screenshot({ path: `${DIR}/${c.name}-top.png` });
    await page.evaluate(([x, z]) => window.__game!.camera({ x, z, yaw: 0.7, pitch: 0.55, dist: 150 }, true), [c.x, c.z] as const);
    await page.evaluate(() => window.__game!.frames(14));
    await page.screenshot({ path: `${DIR}/${c.name}-angle.png` });
  }
});
