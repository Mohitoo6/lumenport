import { test } from '@playwright/test';

// Opens the deployed game in a browser and records how long it takes to become playable.
test.use({ baseURL: process.env.LIVE_URL ?? 'https://metropolis-city.vercel.app' });

test('the deployed game loads and runs', async ({ page }) => {
  test.setTimeout(180_000);
  let bytes = 0;
  page.on('response', async (r) => {
    const len = Number(r.headers()['content-length'] ?? 0);
    bytes += len;
  });
  const t0 = Date.now();
  await page.goto('/');
  await page.waitForFunction(() => window.__game?.ready === true, undefined, { timeout: 150_000 });
  const ready = (Date.now() - t0) / 1000;
  await page.waitForTimeout(1500);
  const stats = await page.evaluate(() => window.__game!.stats());
  console.log(`LIVE ready in ${ready.toFixed(1)} s, ${(bytes / 1e6).toFixed(1)} MB (content-length), ${stats.fps.toFixed(0)} fps`);
  await page.screenshot({ path: 'screenshots/welcome/05-live.png' });
});
