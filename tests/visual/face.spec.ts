import { mkdirSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { advance, buildTown, openGame, zoneTown } from './helpers';

// The speaking minister's portrait: it should blink, look around and move its lips with
// the subtitle. Frames go to test-results/face (ignored by git) for a look by eye.
const DIR = 'test-results/face';

test.use({ deviceScaleFactor: 2 });

test('council: the speaker blinks, looks around and moves their lips (demo ministers)', async ({ page }) => {
  test.setTimeout(240_000);
  mkdirSync(DIR, { recursive: true });
  await openGame(page, 'shots=1&council=demo');
  await buildTown(page);
  await zoneTown(page);
  await advance(page, 3600);
  await page.evaluate(() => window.__game!.time(18));
  await advance(page, 1600);
  expect(await page.evaluate(() => window.__game!.council.convene('traffic'))).toBe(true);
  await page.getByRole('button', { name: 'Begin the meeting' }).click({ timeout: 60_000 });
  await page.locator('.subtitle').waitFor({ timeout: 30_000 });

  const ring = page.locator('.subtitle-ring svg');
  const mouths = new Set<string>();
  const lids = new Set<string>();
  for (let i = 0; i < 40; i++) {
    const state = await ring.evaluate((svg) => ({
      mouth: svg.querySelector('path[fill="#5b1d22"]')?.getAttribute('d') ?? '',
      lid: svg.querySelector('rect[width="4.6"]')?.getAttribute('height') ?? '',
    }));
    mouths.add(state.mouth);
    lids.add(state.lid);
    await page.locator('.subtitle').screenshot({ path: `${DIR}/frame-${String(i).padStart(2, '0')}.png` });
    await page.waitForTimeout(60);
  }
  // The mouth takes many shapes while the statement is typed.
  expect(mouths.size).toBeGreaterThan(10);
  expect(lids.size).toBeGreaterThan(1);
});
