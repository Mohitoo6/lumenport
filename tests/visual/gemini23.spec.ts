import { mkdirSync } from 'node:fs';
import { test, type Page } from '@playwright/test';
import { advance, buildTown, openGame, zoneTown } from './helpers';

const DIR = process.env.SHOTS_DIR ?? 'screenshots/gemini-23';

/** Places a facility on the nearest valid site to a cell, ring by ring; returns its id. */
async function place(page: Page, kind: number, ci: number, cj: number): Promise<number> {
  return page.evaluate(
    ([kind, ci, cj]) => {
      const g = window.__game!.game;
      for (let r = 0; r <= 45; r++) {
        for (let j = cj - r; j <= cj + r; j++) {
          for (let i = ci - r; i <= ci + r; i++) {
            if (Math.max(Math.abs(i - ci), Math.abs(j - cj)) !== r) continue;
            if (!g.sim.planFacility(kind, i, j).ok) continue;
            const id = g.sim.state.buildings.length;
            if (window.__game!.exec({ type: 'placeFacility', kind, x: i, y: j }).ok) return id;
          }
        }
      }
      return -1;
    },
    [kind, ci, cj] as const,
  );
}

/** Shops, offices, the mall, multiplex, bazaar, upgraded civic buildings, and the new lighting. */
test('commercial and civic buildings in the test town', async ({ page }) => {
  test.setTimeout(600_000);
  mkdirSync(DIR, { recursive: true });
  await openGame(page, 'shots=1');
  await buildTown(page);
  await zoneTown(page);
  await advance(page, 3000);
  const sites: Array<[name: string, kind: number, ci: number, cj: number, dist: number]> = [
    ['mall', 19, 176, 104, 120],
    ['multiplex', 20, 150, 102, 70],
    ['bazaar', 21, 162, 97, 55],
    ['it-park', 12, 214, 50, 95],
    ['university', 13, 214, 80, 110],
    ['police', 6, 128, 96, 45],
    ['fire-station', 7, 192, 96, 50],
    ['school', 9, 122, 60, 60],
    ['bus-stop', 15, 160, 73, 22],
  ];
  const placed: Array<{ name: string; x: number; z: number; facing: number; dist: number }> = [];
  for (const [name, kind, ci, cj, dist] of sites) {
    const id = await place(page, kind, ci, cj);
    if (id < 0) {
      console.log('NOT PLACED', name);
      continue;
    }
    const b = await page.evaluate((id) => {
      const b = window.__game!.game.sim.state.buildings[id]!;
      return { x: (b.x + b.w / 2) * 8, z: (b.y + b.h / 2) * 8, facing: b.facing };
    }, id);
    placed.push({ name, ...b, dist });
  }
  await advance(page, 2400);
  const shot = async (name: string, x: number, z: number, yaw: number, pitch: number, dist: number, hour: number): Promise<void> => {
    await page.evaluate(([h]) => window.__game!.season(9, h), [hour] as const);
    await page.evaluate(([x, z, yaw, pitch, dist]) => window.__game!.camera({ x, z, yaw, pitch, dist }, true), [x, z, yaw, pitch, dist] as const);
    await page.evaluate(() => window.__game!.frames(50));
    await page.screenshot({ path: `${DIR}/${name}.png` });
  };
  for (const p of placed) {
    const front = Math.atan2(-[0, 1, 0, -1][p.facing]!, [-1, 0, 1, 0][p.facing]!);
    await shot(p.name, p.x, p.z, front + 0.45, 0.38, p.dist, 11);
  }
  const mall = placed.find((p) => p.name === 'mall');
  if (mall) await shot('mall-night', mall.x, mall.z, Math.atan2(-[0, 1, 0, -1][mall.facing]!, [-1, 0, 1, 0][mall.facing]!) + 0.45, 0.38, 130, 20.5);
  const bazaar = placed.find((p) => p.name === 'bazaar');
  if (bazaar) await shot('bazaar-night', bazaar.x, bazaar.z, Math.atan2(-[0, 1, 0, -1][bazaar.facing]!, [-1, 0, 1, 0][bazaar.facing]!) + 0.45, 0.4, 60, 20.5);
  // The commercial streets of the test town (zones C1-C3), day, golden hour and night.
  await shot('shops-street', 1300, 520, 3.4, 0.32, 75, 11);
  await shot('shops-street-night', 1300, 520, 3.4, 0.32, 75, 20.5);
  await shot('offices-day', 1420, 640, 2.4, 0.42, 230, 11);
  await shot('offices-golden', 1420, 640, 2.4, 0.42, 230, 17.6);
  await shot('offices-night', 1420, 640, 2.4, 0.42, 230, 21);
  await shot('town-overview', 1340, 640, 0.5, 0.62, 650, 11);
  await shot('town-night', 1340, 640, 0.5, 0.55, 650, 21.5);
  const perf = await page.evaluate(async () => {
    window.__game!.camera({ x: 1340, z: 640, yaw: 0.5, pitch: 0.55, dist: 650 }, true);
    await window.__game!.frames(120);
    return window.__game!.stats();
  });
  console.log('PERF', JSON.stringify(perf));
});
