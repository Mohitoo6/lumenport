import { mkdirSync } from 'node:fs';
import { test } from '@playwright/test';
import { advance, openGame, pose } from './helpers';

const DIR = 'screenshots/goals';

/** The goal card on a new city, the banner when a goal is reached, and a later goal with progress. */
test('goals and the calendar', async ({ page }) => {
  test.setTimeout(300_000);
  mkdirSync(DIR, { recursive: true });
  await openGame(page, 'shots=1');
  await page.evaluate(async (p) => {
    window.__game!.camera(p, true);
    await window.__game!.frames(10);
  }, pose(1300, 600, 20, 52, 520));
  await page.screenshot({ path: `${DIR}/01-new-city.png` });

  // First street: the banner announces the goal and names the next one.
  await page.evaluate(() => window.__game!.exec({ type: 'buildRoad', road: 0, ax: 1120, az: 584, bx: 1500, bz: 584 }));
  await advance(page, 120);
  await page.screenshot({ path: `${DIR}/02-goal-reached.png` });

  // A small working town: homes, shops, power and water, then let people move in.
  await page.evaluate(() => {
    const g = window.__game!;
    g.exec({ type: 'zoneRect', x0: 141, y0: 70, x1: 186, y1: 72, zone: 5 });
    g.exec({ type: 'zoneRect', x0: 141, y0: 74, x1: 160, y1: 75, zone: 9 });
    g.exec({ type: 'zoneRect', x0: 163, y0: 74, x1: 186, y1: 76, zone: 5 });
    const place = (kind: number, ci: number, cj: number): void => {
      for (let r = 0; r <= 30; r++)
        for (let j = cj - r; j <= cj + r; j++)
          for (let i = ci - r; i <= ci + r; i++) {
            if (Math.max(Math.abs(i - ci), Math.abs(j - cj)) !== r || !g.game.sim.planFacility(kind, i, j).ok) continue;
            if (g.exec({ type: 'placeFacility', kind, x: i, y: j }).ok) return;
          }
    };
    place(2, 145, 75);
    place(2, 150, 75);
    place(4, 155, 75);
    g.game.sim.growthRate = 1;
  });
  await advance(page, 30000);
  await page.screenshot({ path: `${DIR}/03-progress.png` });
  const state = await page.evaluate(() => {
    const s = window.__game!.game.sim.state;
    return { goals: s.goalsDone, pop: s.stats.population, date: document.querySelector('.city-date')?.textContent, goal: document.querySelector('.goal-title')?.textContent };
  });
  console.log('GOALS', JSON.stringify(state));
  // The card minimises to one line.
  await page.click('.goal .icon-btn');
  await page.evaluate(() => window.__game!.frames(4));
  await page.screenshot({ path: `${DIR}/04-minimised.png`, clip: { x: 0, y: 0, width: 800, height: 200 } });
});
