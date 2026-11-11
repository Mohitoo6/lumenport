import { test } from '@playwright/test';
import { advance, buildTown, openGame, pose, shoot, zoneTown } from './helpers';

test('phase 7: day and night', async ({ page }) => {
  await openGame(page);
  await buildTown(page);
  await zoneTown(page);
  await advance(page, 3600);

  const wide = pose(1350, 600, 25, 40, 640);
  const hours: Array<[number, string]> = [
    [6.6, '01-dawn'],
    [10, '02-morning'],
    [14.5, '03-afternoon'],
    [17.6, '04-golden-hour'],
    [18.6, '05-dusk'],
    [22, '06-night'],
  ];
  for (const [hour, name] of hours) {
    await page.evaluate((h) => window.__game!.time(h), hour);
    await shoot(page, 7, name, wide, 20);
  }
  await shoot(page, 7, '07-night-avenue', pose(1312, 584, 180, 44, 150), 20);
  await shoot(page, 7, '08-night-street', pose(1200, 488, 100, 30, 70), 20);
  await shoot(page, 7, '09-night-skyline', pose(1330, 640, 200, 14, 520), 20);
  await page.evaluate((h) => window.__game!.time(h), 18.2);
  await shoot(page, 7, '10-sunset-skyline', pose(1330, 640, 110, 12, 520), 20);
});
