import { mkdirSync } from 'node:fs';
import { test } from '@playwright/test';
import { advance, openGame } from './helpers';

const DIR = 'screenshots/terrain';

/**
 * The terrain brush: a hill raised from flat land, a terrace levelled on it, a road that
 * winds up and homes that grow beside it.
 */
test('terrain: raise a hill, build a road and homes on it', async ({ page }) => {
  test.setTimeout(300_000);
  mkdirSync(DIR, { recursive: true });
  await openGame(page, 'shots=1');
  await page.evaluate(() => window.__game!.exec({ type: 'setSandbox', on: true }));
  const cx = 1500;
  const cz = 980;
  const info = await page.evaluate(([cx, cz]) => {
    const g = window.__game!;
    const s = (x: number, z: number, radius: number, mode: string, n: number, target?: number) => {
      let cost = 0;
      for (let k = 0; k < n; k++) {
        const r = g.exec({ type: 'sculpt', x, z, radius, mode, strength: 0.5, target } as never);
        cost += r.cost ?? 0;
      }
      return cost;
    };
    // A long ridge from three overlapping hills, then a softer shape.
    let cost = 0;
    cost += s(cx, cz, 64, 'raise', 90);
    cost += s(cx + 70, cz + 30, 64, 'raise', 60);
    cost += s(cx - 60, cz - 20, 64, 'raise', 50);
    cost += s(cx, cz, 64, 'smooth', 30);
    cost += s(cx + 20, cz + 10, 40, 'flatten', 40, 26);
    const H = g.game.sim.state.heights;
    const top = H[Math.round(cz / 8) * 257 + Math.round(cx / 8)]!;
    // A road climbing the slope in two legs, and one across the terrace.
    const roads = [
      g.exec({ type: 'buildRoad', road: 0, ax: cx - 220, az: cz + 120, bx: cx - 40, bz: cz + 40, cx: cx - 120, cz: cz + 120 }),
      g.exec({ type: 'buildRoad', road: 0, ax: cx - 40, az: cz + 40, bx: cx + 80, bz: cz + 10 }),
      g.exec({ type: 'buildRoad', road: 0, ax: cx + 80, az: cz + 10, bx: cx + 200, bz: cz - 90, cx: cx + 190, cz: cz + 20 }),
    ].map((r) => (r.ok ? 'ok' : r.reason));
    return { cost, top, roads };
  }, [cx, cz] as const);
  console.log('terrain', JSON.stringify(info));
  await page.evaluate(() => {
    const g = window.__game!.game;
    const net = g.sim.state.roads;
    const edges = net.edges.filter((e) => e).map((e) => e!.id);
    window.__game!.exec({ type: 'zoneAlong', edges, zone: 5 } as never);
    g.sim.growthRate = 1;
  });
  await advance(page, 2400);
  const homes = await page.evaluate(() => window.__game!.game.sim.state.buildings.filter((b) => b && b.baseY > 8).length);
  console.log('homes on the hill', homes);
  await page.evaluate(([x, z]) => window.__game!.camera({ x, z, yaw: 0.6, pitch: 0.5, dist: 360 }, true), [cx - 40, cz + 60] as const);
  await page.evaluate(() => window.__game!.frames(30));
  await page.screenshot({ path: `${DIR}/01-hill.png` });
  await page.evaluate(([x, z]) => window.__game!.camera({ x, z, yaw: 2.2, pitch: 0.35, dist: 200 }, true), [cx, cz + 30] as const);
  await page.evaluate(() => window.__game!.frames(30));
  await page.screenshot({ path: `${DIR}/02-road-up.png` });
  // The tool itself, with its brush options open.
  await page.getByRole('button', { name: 'Terrain' }).click();
  await page.mouse.move(800, 420);
  await page.evaluate(() => window.__game!.frames(10));
  await page.screenshot({ path: `${DIR}/03-tool.png` });
});
