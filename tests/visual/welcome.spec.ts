import { mkdirSync } from 'node:fs';
import { test } from '@playwright/test';
import { openGame } from './helpers';

const DIR = 'screenshots/welcome';

/** The first-visit card, and the evaluation scorecard in the AI inspector. */
test('welcome card and the evaluation scorecard', async ({ page }) => {
  test.setTimeout(300_000);
  mkdirSync(DIR, { recursive: true });
  await openGame(page, 'fresh=1');
  await page.waitForSelector('.welcome', { timeout: 30_000 });
  await page.waitForFunction(() => !document.querySelector('.welcome-ai')?.textContent?.startsWith('Checking'), undefined, { timeout: 30_000 });
  await page.evaluate(() => window.__game!.frames(10));
  await page.screenshot({ path: `${DIR}/01-welcome.png` });
  await page.click('.welcome-go');
  // Gone for good once dismissed.
  await page.reload();
  await page.waitForFunction(() => window.__game?.ready === true, undefined, { timeout: 120_000 });
  await page.evaluate(() => window.__game!.frames(10));
  const again = await page.locator('.welcome').count();
  console.log('WELCOME AFTER RELOAD', again);
  await page.keyboard.press('i');
  await page.waitForSelector('.inspector');
  await page.evaluate(() => {
    const body = document.querySelector('.ins-body');
    if (body) body.scrollTop = body.scrollHeight;
  });
  await page.evaluate(() => window.__game!.frames(4));
  await page.screenshot({ path: `${DIR}/02-inspector-evaluation.png` });
});
