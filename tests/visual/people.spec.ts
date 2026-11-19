import { mkdirSync } from 'node:fs';
import { test, type Page } from '@playwright/test';
import { advance, buildTown, openGame, zoneTown } from './helpers';

const DIR = 'screenshots/people';

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

const drawn = (page: Page) => page.evaluate(() => (window.__game!.game as unknown as { people?: { mesh: { count: number } } }).people?.mesh.count ?? 0);

/**
 * Where people walk and cars drive: a quiet residential street, a shopping street, an
 * IT park, a metro station, and the whole town from above. Logs the people in each view.
 */
test('people and traffic follow what is on each street', async ({ page }) => {
  test.setTimeout(300_000);
  mkdirSync(DIR, { recursive: true });
  await openGame(page, 'shots=1');
  await buildTown(page);
  await zoneTown(page);
  await advance(page, 3600);
  const it = await place(page, 12, 150, 98);
  const s1 = await place(page, 14, 126, 72);
  const s2 = await place(page, 14, 202, 72);
  await advance(page, 1500);
  const metro = await page.evaluate(([a, b]) => window.__game!.exec({ type: 'buildMetro', a, b, via: [[1060, 584], [1580, 584]] } as never), [s1, s2] as const);
  console.log('placed', it, s1, s2, JSON.stringify(metro));
  await advance(page, 200);
  const at = async (id: number) => page.evaluate((id) => {
    const b = window.__game!.game.sim.state.buildings[id]!;
    return [(b.x + b.w / 2) * 8, (b.y + b.h / 2) * 8] as const;
  }, id);
  const shots: Array<[string, number, number, number]> = [
    ['01-residential', 1300, 400, 70],
    ['02-shops', 1376, 640, 90],
    ['03-it-park', ...(await at(it)), 75],
    ['04-metro', ...(await at(s1)), 50],
  ];
  for (const [name, x, z, dist] of shots) {
    const yaw = name === '04-metro' ? -0.8 : 0.8;
    await page.evaluate(([x, z, dist, yaw]) => window.__game!.camera({ x, z, yaw, pitch: 0.55, dist }, true), [x, z, dist, yaw] as const);
    await page.evaluate(() => window.__game!.frames(90));
    console.log(name, 'people', await drawn(page));
    await page.screenshot({ path: `${DIR}/${name}.png` });
  }
  await page.evaluate(() => window.__game!.camera({ x: 1320, z: 600, yaw: 0.3, pitch: 1.0, dist: 520 }, true));
  await page.evaluate(() => window.__game!.frames(20));
  const cars = await page.evaluate(() => {
    const g = window.__game!.game.sim;
    const net = g.state.roads;
    const t = g.traffic;
    const per = new Map<number, number>();
    for (let i = 0; i < t.count; i++) {
      const e = t.debug(i).edge;
      per.set(e, (per.get(e) ?? 0) + 1);
    }
    const edges = net.edges.filter((e) => e && e.length >= 12);
    return { cars: t.count, edges: edges.length, withCars: edges.filter((e) => per.has(e!.id)).length };
  });
  console.log('traffic', JSON.stringify(cars));
  await page.screenshot({ path: `${DIR}/05-town-traffic.png` });
});
