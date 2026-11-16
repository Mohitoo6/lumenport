import { mkdirSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { advance, buildTown, openGame, zoneTown } from './helpers';

const DIR = 'screenshots/transit';

/** Places a facility on the nearest valid site to a cell; returns its building id. */
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

test('transit: a bus line, buses at the stops, and the airport', async ({ page }) => {
  test.setTimeout(300_000);
  mkdirSync(DIR, { recursive: true });
  await openGame(page, 'shots=1');
  await buildTown(page);
  await zoneTown(page);
  await advance(page, 3600);
  const stops: number[] = [];
  for (const [i, j] of [
    [140, 60],
    [185, 60],
    [160, 84],
    [150, 74],
  ] as const)
    stops.push(await place(page, 15, i, j));
  expect(stops.every((id) => id >= 0)).toBe(true);
  const airport = await place(page, 16, 165, 116);
  expect(airport).toBeGreaterThanOrEqual(0);
  // Let construction finish and the buses get going.
  await advance(page, 1500);
  const status = await page.evaluate(() => {
    const g = window.__game!.game;
    return { lines: g.sim.busLines.map((l) => l.stops.length), buses: g.sim.traffic.buses, riders: g.sim.state.stats.busRiders, airport: g.sim.state.buildings.some((b) => b && b.kind === 16 && b.progress >= 1) };
  });
  console.log('transit', JSON.stringify(status));
  expect(status.lines).toEqual([4]);
  expect(status.buses).toBeGreaterThan(0);
  expect(status.airport).toBe(true);

  // A bus waiting at a stop, close up.
  const at = await page.evaluate(() => {
    const t = window.__game!.game.sim.traffic;
    for (let i = 0; i < t.count; i++) if (t.busLine[i]! >= 0) return { x: t.x[i]!, z: t.z[i]!, h: t.heading[i]! };
    return null;
  });
  expect(at).not.toBeNull();
  await page.evaluate((p) => window.__game!.camera({ x: p.x, z: p.z, yaw: p.h + 2.1, pitch: 0.42, dist: 46 }, true), at!);
  await page.evaluate(() => window.__game!.frames(30));
  await page.screenshot({ path: `${DIR}/01-bus.png` });

  // People waiting at a stop the line serves, and walking the pavements.
  const stop = await page.evaluate((id) => window.__game!.game.sim.state.buildings[id]!, stops[0]!);
  await page.evaluate(([x, z]) => window.__game!.camera({ x, z, yaw: 0.9, pitch: 0.38, dist: 34 }, true), [(stop.x + 0.5) * 8, (stop.y + 0.5) * 8] as const);
  await page.evaluate(() => window.__game!.frames(60));
  await page.screenshot({ path: `${DIR}/04-stop-and-people.png` });
  const people = await page.evaluate(() => (window.__game!.game as unknown as { people?: { mesh: { count: number } } }).people?.mesh.count ?? 0);
  console.log('people drawn', people);
  expect(people).toBeGreaterThan(5);

  // The airport from above, with a plane on approach or rolling.
  const b = await page.evaluate((id) => window.__game!.game.sim.state.buildings[id]!, airport);
  await page.evaluate(([x, z]) => window.__game!.camera({ x, z, yaw: 0.6, pitch: 0.6, dist: 340 }, true), [(b.x + b.w / 2) * 8, (b.y + b.h / 2) * 8] as const);
  // Step until a plane is low over the airfield: on short final or just after take-off.
  const centre = [(b.x + b.w / 2) * 8, (b.y + b.h / 2) * 8] as const;
  for (let k = 0; k < 300; k++) {
    await advance(page, 12);
    await page.evaluate(() => window.__game!.frames(1));
    const low = await page.evaluate(([cx, cz]) => {
      const g = window.__game!.game as unknown as { planes?: { group: { children: Array<{ visible: boolean; position: { x: number; y: number; z: number } }> } } };
      return g.planes?.group.children.some((c) => c.visible && c.position.y > 12 && c.position.y < 70 && Math.hypot(c.position.x - cx, c.position.z - cz) < 260) ?? false;
    }, centre);
    if (low) break;
  }
  await page.evaluate(() => window.__game!.frames(20));
  await page.screenshot({ path: `${DIR}/02-airport.png` });

  // Where buses and the metro reach.
  await page.evaluate(() => window.__game!.camera({ x: 1300, z: 600, yaw: 0.4, pitch: 0.9, dist: 620 }, true));
  await page.locator('.views-btn').click();
  await page.getByRole('menuitemradio', { name: 'Transit reach', exact: true }).click();
  await page.evaluate(() => window.__game!.frames(20));
  await page.screenshot({ path: `${DIR}/03-transit-reach.png` });
});
