import { mkdirSync } from 'node:fs';
import { test, type Page } from '@playwright/test';
import { advance, buildTown, openGame, zoneTown } from './helpers';

const DIR = 'screenshots/hospital';
const HOSPITAL = 17;

async function place(page: Page, kind: number, ci: number, cj: number): Promise<number> {
  return page.evaluate(
    ([kind, ci, cj]) => {
      const g = window.__game!.game;
      for (let r = 0; r <= 40; r++) {
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

/** The hospital in the grown test town: from the road, from above, and at dusk. */
test('a hospital beside the town', async ({ page }) => {
  test.setTimeout(300_000);
  mkdirSync(DIR, { recursive: true });
  await openGame(page, 'shots=1');
  await buildTown(page);
  await zoneTown(page);
  await advance(page, 3000);
  const id = await place(page, HOSPITAL, 176, 100);
  await advance(page, 2400);
  const b = await page.evaluate((id) => {
    const b = window.__game!.game.sim.state.buildings[id]!;
    return { x: (b.x + b.w / 2) * 8, z: (b.y + b.h / 2) * 8, facing: b.facing, w: b.w, h: b.h, progress: b.progress };
  }, id);
  console.log('hospital', id, JSON.stringify(b));
  // Facing: 0 north, 1 east, 2 south, 3 west. Look at the front from the road side.
  const front = Math.atan2(-[0, 1, 0, -1][b.facing]!, [-1, 0, 1, 0][b.facing]!);
  const shots: Array<[name: string, yaw: number, pitch: number, dist: number, hour: number]> = [
    ['01-front', front + 0.5, 0.35, 75, 10],
    ['02-front-left', front - 0.6, 0.42, 85, 15],
    ['03-above', front + 0.9, 0.85, 120, 11],
    ['04-in-town', front + 0.4, 0.55, 260, 11],
    ['05-dusk', front + 0.5, 0.4, 90, 19.4],
  ];
  for (const [name, yaw, pitch, dist, hour] of shots) {
    await page.evaluate(([h]) => window.__game!.season(7, h), [hour] as const);
    await page.evaluate(([x, z, yaw, pitch, dist]) => window.__game!.camera({ x, z, yaw, pitch, dist }, true), [b.x, b.z, yaw, pitch, dist] as const);
    await page.evaluate(() => window.__game!.frames(60));
    await page.screenshot({ path: `${DIR}/${name}.png` });
  }
  // The Services menu lists it beside the clinic.
  await page.evaluate(() => window.__game!.season(7, 11));
  await page.getByRole('button', { name: 'Services' }).click();
  await page.getByRole('button', { name: /^Hospital/ }).click();
  await page.evaluate(() => window.__game!.frames(10));
  await page.screenshot({ path: `${DIR}/06-services-menu.png`, clip: { x: 300, y: 700, width: 1000, height: 200 } });
});
