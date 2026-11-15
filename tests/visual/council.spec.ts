import { mkdirSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { advance, buildTown, openGame, zoneTown } from './helpers';

const DIR = 'screenshots/council';

async function grownCity(page: Page, query: string): Promise<void> {
  mkdirSync(DIR, { recursive: true });
  await openGame(page, query);
  await buildTown(page);
  await zoneTown(page);
  // The town hall stands from the start in real games; scripted runs found it here.
  expect(await page.evaluate(() => window.__game!.townHall())).toBe(true);
  await advance(page, 3600);
  // Evening rush: the clock is held at 18:00 so traffic builds up.
  await page.evaluate(async () => {
    window.__game!.time(18);
    window.__game!.camera({ x: 1360, z: 600, yaw: 0.35, pitch: 0.8, dist: 520 }, true);
    window.__game!.exec({ type: 'setSpeed', speed: 1 });
  });
  await advance(page, 1600);
}

async function cineAt(page: Page, phase: string, seconds: number): Promise<void> {
  await page.waitForFunction(([p, s]) => window.__game!.council.phase() === p && window.__game!.council.cineTime() >= (s as number), [phase, seconds] as const, { timeout: 60_000 });
}

/** Fast-forwards the debate until the Chief Secretary's verdict is on screen. */
async function finishDebate(page: Page): Promise<void> {
  for (let i = 0; i < 200; i++) {
    if (await page.locator('.verdict').count()) return;
    await page.evaluate(() => window.__game!.council.skip());
    await page.waitForTimeout(250);
  }
  throw new Error('no verdict');
}

test('council: town hall entrance, debate in the chamber, decision (demo ministers)', async ({ page }) => {
  test.setTimeout(300_000);
  await grownCity(page, 'shots=1&council=demo');
  const issues = await page.evaluate(() => window.__game!.council.issues());
  console.log('issues:', issues.map((i) => `${i.kind} ${i.severity.toFixed(2)}`).join(', '));
  expect(issues.some((i) => i.kind === 'traffic')).toBe(true);

  // The lead minister asks for a meeting; residents are talking.
  await page.locator('.request').waitFor({ timeout: 30_000 });
  await page.locator('.post').first().waitFor({ timeout: 40_000 });
  await page.screenshot({ path: `${DIR}/01-request-and-feed.png` });

  // Convene on the traffic jam: the camera flies to the town hall and the doors open.
  await page.evaluate(() => window.__game!.council.convene('traffic'));
  await cineAt(page, 'enter', 2.5);
  await page.screenshot({ path: `${DIR}/02-approach.png` });
  await cineAt(page, 'enter', 4.8);
  await page.screenshot({ path: `${DIR}/03-doors-open.png` });
  await page.locator('.brief-card').waitFor({ timeout: 30_000 });
  await page.waitForTimeout(1500);
  await page.getByPlaceholder(/Don't demolish homes/).fill('Do not demolish any homes. Keep it under $5,000.');
  await page.screenshot({ path: `${DIR}/04-chamber-briefing.png` });

  await page.getByRole('button', { name: 'Begin the meeting' }).click();
  await page.locator('.subtitle').waitFor({ timeout: 30_000 });
  await page.waitForTimeout(2500);
  await page.screenshot({ path: `${DIR}/05-minister-speaking.png` });
  // When the first minister finishes, the next speaker gets the next shot.
  const first = await page.evaluate(() => window.__game!.game.council && document.querySelector('.subtitle strong')?.textContent);
  await page.waitForFunction((name) => {
    const now = document.querySelector('.subtitle strong')?.textContent;
    return !!now && now !== name;
  }, first, { timeout: 60_000 });
  await page.waitForTimeout(2500);
  await page.screenshot({ path: `${DIR}/06-next-speaker.png` });

  await finishDebate(page);
  await page.waitForTimeout(1200);
  await page.screenshot({ path: `${DIR}/07-verdict.png` });

  const speed = await page.evaluate(() => window.__game!.game.sim.state.speed);
  expect(speed).toBe(0);
  await page.locator('.verdict .btn-go').click();
  await page.locator('.council-result').waitFor();
  await page.screenshot({ path: `${DIR}/08-enacted.png` });
  await page.getByRole('button', { name: 'Back to the city' }).click();
  await cineAt(page, 'exit', 1.4);
  await page.screenshot({ path: `${DIR}/09-leaving.png` });
  await page.waitForFunction(() => window.__game!.council.phase() === 'off', undefined, { timeout: 60_000 });
  await expect(page.locator('.chamber-ui')).toHaveCount(0);
  await page.evaluate(() => window.__game!.frames(40));
  await page.screenshot({ path: `${DIR}/10-after.png` });
});

test('council: Hindi debate (demo ministers)', async ({ page }) => {
  test.setTimeout(240_000);
  await grownCity(page, 'shots=1&council=demo');
  await page.evaluate(() => window.__game!.council.convene('health'));
  await page.locator('.brief-card').waitFor({ timeout: 30_000 });
  await page.getByRole('button', { name: 'हिन्दी' }).click();
  await page.getByRole('button', { name: 'Begin the meeting' }).click();
  await page.locator('.subtitle').waitFor({ timeout: 30_000 });
  await page.waitForTimeout(3000);
  await page.screenshot({ path: `${DIR}/11-hindi-speaking.png` });
  await finishDebate(page);
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${DIR}/12-hindi-verdict.png` });
});

// The real thing: ministers speak through the AI providers in .env. Spends free-tier
// requests, so it only runs with REAL_COUNCIL=1.
test('council: real AI debate', async ({ page }) => {
  test.skip(process.env.REAL_COUNCIL !== '1', 'set REAL_COUNCIL=1 to run against the real AI');
  test.setTimeout(480_000);
  await grownCity(page, 'shots=1');
  expect(await page.evaluate(() => window.__game!.council.convene((window as unknown as { KIND?: string }).KIND ?? 'traffic'))).toBe(true);
  await page.locator('.brief-card').waitFor({ timeout: 30_000 });
  if (process.env.COUNCIL_LANG === 'hi') await page.getByRole('button', { name: 'हिन्दी' }).click();
  await page.getByRole('button', { name: 'Begin the meeting' }).click();
  await page.locator('.subtitle').first().waitFor({ timeout: 180_000 });
  await page.waitForTimeout(3000);
  await page.screenshot({ path: `${DIR}/13-real-speaking.png` });
  await page.locator('.verdict, .council-alert').first().waitFor({ timeout: 420_000 });
  await page.waitForTimeout(800);
  await page.screenshot({ path: `${DIR}/14-real-verdict.png` });
  await page.getByRole('button', { name: /^Minutes/ }).click();
  const transcript = await page.locator('.msg').allInnerTexts();
  console.log(transcript.join('\n---\n'));
});

test('council: a new game starts with the town hall', async ({ page }) => {
  mkdirSync(DIR, { recursive: true });
  await openGame(page, 'council=demo');
  const hall = await page.evaluate(() => {
    const b = window.__game!.game.sim.state.buildings.find((x) => x && x.kind === 11);
    return b ? { x: b.x, y: b.y, w: b.w, progress: b.progress } : null;
  });
  expect(hall).not.toBeNull();
  expect(hall!.progress).toBe(1);
  await page.evaluate(([x, y]) => window.__game!.camera({ x: (x + 2) * 8, z: (y + 2) * 8, yaw: 0.6, pitch: 0.55, dist: 140 }, true), [hall!.x, hall!.y] as const);
  await page.evaluate(() => window.__game!.frames(30));
  await page.screenshot({ path: `${DIR}/00-town-hall-new-game.png` });
  // Reinstalling the state (as loading does) keeps exactly one town hall.
  await page.evaluate(() => window.__game!.game.loadState(window.__game!.game.sim.state));
  const after = await page.evaluate(() => window.__game!.game.sim.state.buildings.filter((x) => x && x.kind === 11).length);
  expect(after).toBe(1);
});
