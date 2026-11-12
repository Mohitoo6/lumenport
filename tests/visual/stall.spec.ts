import { test } from '@playwright/test';
import { advance, openGame } from './helpers';

test('zoning far from roads and stalled demand are explained', async ({ page }) => {
  await openGame(page);
  await page.evaluate(() => {
    const g = window.__game!;
    g.exec({ type: 'buildRoad', road: 0, ax: 1040, az: 552, bx: 1600, bz: 552 });
    g.exec({ type: 'placeFacility', kind: 2, x: 131, y: 70 });
    g.exec({ type: 'placeFacility', kind: 4, x: 134, y: 70 });
    // A big drag far deeper than four cells, homes only: the interior is not zoned.
    g.exec({ type: 'zoneRect', x0: 137, y0: 50, x1: 199, y1: 80, zone: 5 });
  });
  await advance(page, 40 * 200);
  const s = await page.evaluate(() => {
    const st = window.__game!.game.sim.state;
    return { pop: st.stats.population, demandR: +st.stats.demand[1].toFixed(2), alerts: [...document.querySelectorAll('.alerts li')].map((e) => e.textContent) };
  });
  console.log('stalled town:', JSON.stringify(s));
  if (!s.alerts.some((a) => a?.startsWith('Homes have stopped growing'))) throw new Error('No stall advice shown');
  await page.evaluate(async () => {
    window.__game!.camera({ x: 1300, z: 560, yaw: 0.17, pitch: 0.9, dist: 330 }, true);
    await window.__game!.frames(12);
  });
  await page.screenshot({ path: 'screenshots/fixes/homes-only-stalled.png' });
});
