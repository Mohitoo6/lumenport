import { mkdirSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { advance, buildTown, openGame, zoneTown } from './helpers';

const DIR = 'screenshots/council';

async function grownCity(page: Page, query: string): Promise<void> {
  mkdirSync(DIR, { recursive: true });
  await openGame(page, query);
  await buildTown(page);
  await zoneTown(page);
  await advance(page, 3600);
  // Evening rush: the clock is held at 18:00 so traffic builds up.
  await page.evaluate(async () => {
    window.__game!.time(18);
    window.__game!.camera({ x: 1360, z: 600, yaw: 0.35, pitch: 0.8, dist: 520 }, true);
    window.__game!.exec({ type: 'setSpeed', speed: 1 });
  });
  await advance(page, 1600);
}

test('council: request, debate, decision (demo ministers)', async ({ page }) => {
  await grownCity(page, 'shots=1&council=demo');
  const issues = await page.evaluate(() => window.__game!.council.issues());
  console.log('issues:', issues.map((i) => `${i.kind} ${i.severity.toFixed(2)}`).join(', '));
  expect(issues.some((i) => i.kind === 'traffic')).toBe(true);

  // The lead minister asks for a meeting; residents are talking.
  await page.locator('.request').waitFor({ timeout: 30_000 });
  await page.locator('.post').first().waitFor({ timeout: 40_000 });
  await page.screenshot({ path: `${DIR}/01-request-and-feed.png` });

  await page.locator('.issues-btn').click();
  await page.screenshot({ path: `${DIR}/02-issues-menu.png` });
  await page.locator('.issues-btn').click();

  // Convene on the traffic jam specifically.
  await page.evaluate(() => window.__game!.council.convene('traffic'));
  await page.locator('.council .brief').waitFor();
  await page.getByPlaceholder(/Don't demolish homes/).fill('Do not demolish any homes. Keep it under $5,000.');
  await page.screenshot({ path: `${DIR}/03-briefing.png` });

  await page.getByRole('button', { name: 'Begin the meeting' }).click();
  await page.locator('.verdict').waitFor({ timeout: 30_000 });
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${DIR}/04-debate-and-verdict.png` });

  const speed = await page.evaluate(() => window.__game!.game.sim.state.speed);
  expect(speed).toBe(0);
  await page.locator('.council-foot .btn-go').click();
  await page.locator('.council-result').waitFor();
  await page.screenshot({ path: `${DIR}/05-enacted.png` });
  await page.getByRole('button', { name: 'Back to the city' }).click();
  await expect(page.locator('.council')).toHaveCount(0);
  await page.evaluate(() => window.__game!.frames(40));
  await page.screenshot({ path: `${DIR}/06-after.png` });
});

test('council: Hindi debate (demo ministers)', async ({ page }) => {
  await grownCity(page, 'shots=1&council=demo');
  await page.evaluate(() => window.__game!.council.convene('health'));
  await page.locator('.council .brief').waitFor();
  await page.getByRole('button', { name: 'हिन्दी' }).click();
  await page.getByRole('button', { name: 'Begin the meeting' }).click();
  await page.locator('.verdict').waitFor({ timeout: 30_000 });
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${DIR}/07-hindi.png` });
});

// The real thing: ministers speak through the AI providers in .env. Spends free-tier
// requests, so it only runs with REAL_COUNCIL=1.
test('council: real AI debate', async ({ page }) => {
  test.skip(process.env.REAL_COUNCIL !== '1', 'set REAL_COUNCIL=1 to run against the real AI');
  test.setTimeout(420_000);
  await grownCity(page, 'shots=1');
  expect(await page.evaluate(() => window.__game!.council.convene((window as unknown as { KIND?: string }).KIND ?? 'traffic'))).toBe(true);
  await page.locator('.council .brief').waitFor();
  if (process.env.COUNCIL_LANG === 'hi') await page.getByRole('button', { name: 'हिन्दी' }).click();
  await page.getByRole('button', { name: 'Begin the meeting' }).click();
  await page.locator('.msg').first().waitFor({ timeout: 120_000 });
  await page.screenshot({ path: `${DIR}/08-real-in-progress.png` });
  await page.locator('.verdict, .council-alert').first().waitFor({ timeout: 360_000 });
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${DIR}/09-real-verdict.png` });
  const transcript = await page.locator('.msg').allInnerTexts();
  console.log(transcript.join('\n---\n'));
});
