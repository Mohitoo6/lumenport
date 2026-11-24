import { mkdirSync } from 'node:fs';
import { test, type Page } from '@playwright/test';
import { advance, buildTown, openGame, zoneTown } from './helpers';

// The big service buildings: police headquarters, central fire station, indoor stadium.
// Frames go to test-results/levels (ignored by git) to be looked at by eye.
const DIR = 'test-results/levels';
const KINDS = { policeHQ: 22, fireHQ: 23, stadium: 24 } as const;

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

test('police headquarters, central fire station and indoor stadium beside the town', async ({ page }) => {
  test.setTimeout(300_000);
  mkdirSync(DIR, { recursive: true });
  await openGame(page, 'shots=1');
  await buildTown(page);
  await zoneTown(page);
  await advance(page, 3000);
  const ids = {
    policeHQ: await place(page, KINDS.policeHQ, 128, 96),
    fireHQ: await place(page, KINDS.fireHQ, 140, 100),
    stadium: await place(page, KINDS.stadium, 214, 62),
  };
  await advance(page, 2400);
  for (const [name, id] of Object.entries(ids)) {
    const b = await page.evaluate((id) => {
      const b = window.__game!.game.sim.state.buildings[id]!;
      return { x: (b.x + b.w / 2) * 8, z: (b.y + b.h / 2) * 8, facing: b.facing, w: b.w };
    }, id);
    const front = Math.atan2(-[0, 1, 0, -1][b.facing]!, [-1, 0, 1, 0][b.facing]!);
    const near = b.w * 8 * 1.9 + 25;
    const shots: Array<[string, number, number, number, number]> = [
      ['front', front + 0.35, 0.32, near, 10],
      ['above', front + 0.9, 0.95, near * 1.3, 12],
      ['night', front + 0.45, 0.38, near, 20.5],
    ];
    for (const [shot, yaw, pitch, dist, hour] of shots) {
      await page.evaluate(([h]) => window.__game!.season(7, h), [hour] as const);
      await page.evaluate(([x, z, yaw, pitch, dist]) => window.__game!.camera({ x, z, yaw, pitch, dist }, true), [b.x, b.z, yaw, pitch, dist] as const);
      await page.evaluate(() => window.__game!.frames(60));
      await page.screenshot({ path: `${DIR}/${name}-${shot}.png` });
    }
  }
  await page.evaluate(() => window.__game!.season(7, 11));
  await page.getByRole('button', { name: 'Services' }).click();
  await page.evaluate(() => window.__game!.frames(10));
  await page.screenshot({ path: `${DIR}/services-menu.png`, clip: { x: 0, y: 680, width: 1600, height: 220 } });
});
