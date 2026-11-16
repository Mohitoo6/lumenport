import { mkdirSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import { advance, buildTown, openGame, zoneTown } from './helpers';

const DIR = 'screenshots/inspector';

async function grownCity(page: Page, query: string): Promise<void> {
  mkdirSync(DIR, { recursive: true });
  await openGame(page, query);
  await buildTown(page);
  await zoneTown(page);
  expect(await page.evaluate(() => window.__game!.townHall())).toBe(true);
  await advance(page, 3600);
  await page.evaluate(async () => {
    window.__game!.time(18);
    window.__game!.camera({ x: 1360, z: 600, yaw: 0.35, pitch: 0.8, dist: 520 }, true);
    window.__game!.exec({ type: 'setSpeed', speed: 1 });
  });
  await advance(page, 1600);
}

async function finishDebate(page: Page): Promise<void> {
  for (let i = 0; i < 240; i++) {
    if (await page.locator('.verdict').count()) return;
    await page.evaluate(() => window.__game!.council.skip());
    await page.waitForTimeout(250);
  }
  throw new Error('no verdict');
}

/**
 * A stand-in for the AI server, so the live path (schemas, token counts, latency, cache,
 * repair, flags) can be exercised and photographed without spending a single real token.
 * It answers like a model would, including two deliberate faults: one reply wrapped in a
 * code fence with a renamed key, and one figure that is in nobody's facts.
 */
async function stubModel(page: Page): Promise<{ calls: () => number }> {
  let calls = 0;
  let reactions = 0;
  await page.route('**/api/llm/status', (route) => route.fulfill({ json: { ready: true, providers: ['Stub · model-x'], health: [] } }));
  await page.route('**/api/llm', async (route) => {
    calls++;
    const body = route.request().postDataJSON() as { system: string; user: string };
    const chair = body.system.includes('Chief Secretary');
    const lead = body.user.includes('You raised this') || body.user.includes('challenged your proposal');
    const final = body.user.includes('Final round');
    // The second minister to react in round 1 is the faulty one.
    const faulty = !chair && !lead && !final && ++reactions === 2;
    let text: string;
    if (chair) {
      text = JSON.stringify({ option: 'B', summary: 'The council settles on option B: a relief street gives drivers a second route and displaces nobody. It is the cheapest option that adds capacity.', dissent: 'Roads would still rather widen the road itself.', conditions: '' });
    } else if (lead) {
      text = JSON.stringify({ speak: true, stance: 'propose', option: final ? 'B' : 'A', say: final ? 'I hear the objections. A relief street still adds capacity, so I can back option B.' : 'This segment is past its jam point at rush hour. I propose option A: widening is the only fix that doubles capacity here.', condition: '' });
    } else if (faulty) {
      // A fenced reply with a renamed key, and a figure nobody was shown.
      text = '```json\n' + JSON.stringify({ speak: true, stance: 'concern', option: 'B', statement: 'Option A costs us tax every hour. Option B is cheaper and saves about $48,750 over the decade, so I back B.', condition: '' }) + '\n```';
    } else {
      text = JSON.stringify({ speak: true, stance: 'oppose', option: 'B', say: 'Option A demolishes a workplace when open land is available. I back option B, which displaces nobody.', condition: 'no demolition' });
    }
    await new Promise((r) => setTimeout(r, 350 + Math.random() * 500));
    const prompt = Math.round((body.system.length + body.user.length) / 4);
    await route.fulfill({ json: { text, provider: 'Stub · model-x', usage: { prompt, completion: Math.round(text.length / 4), reasoning: 0 }, latencyMs: 600 + Math.round(Math.random() * 900), finish: 'stop', attempts: 1 } });
  });
  return { calls: () => calls };
}

test('inspector: live pipeline, payloads, guardrails and the mayor’s decision (stubbed model)', async ({ page }) => {
  test.setTimeout(300_000);
  const model = await stubModel(page);
  await grownCity(page, 'shots=1');
  await page.evaluate(() => window.__game!.council.convene('traffic'));
  await page.locator('.brief-card').waitFor({ timeout: 60_000 });
  await page.waitForTimeout(1200);
  // Before anyone speaks: triage and payloads are already computed, with no model call.
  expect(model.calls()).toBe(0);
  await page.screenshot({ path: `${DIR}/01-brief-triage.png` });
  await page.evaluate(() => window.__game!.council.inspector(true));
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${DIR}/02-inspector-before-debate.png` });

  await page.getByRole('button', { name: 'Begin the meeting' }).click();
  await page.locator('.subtitle').waitFor({ timeout: 30_000 });
  await page.waitForTimeout(2500);
  await page.screenshot({ path: `${DIR}/03-inspector-live.png` });

  await finishDebate(page);
  await page.waitForTimeout(800);
  const trace = await page.evaluate(() => window.__game!.council.trace());
  console.log('calls', model.calls(), 'totals', JSON.stringify(trace!.totals), 'graph', trace!.transitions.map((t) => t.to).join(' > '));
  expect(trace!.node).toBe('hitl');
  expect(trace!.totals.llmCalls).toBe(model.calls());
  expect(trace!.totals.llmCalls).toBeLessThanOrEqual(8);
  expect(trace!.totals.schemaRepaired).toBeGreaterThan(0);
  expect(trace!.totals.guardrailFlags).toBeGreaterThan(0);
  await page.screenshot({ path: `${DIR}/04-inspector-verdict.png` });

  // One agent's turn opened up: the validated JSON and what was repaired.
  await page.locator('.ins-span', { has: page.locator('.ins-schema.is-repaired') }).first().click();
  await page.locator('.ins-span-detail').scrollIntoViewIfNeeded();
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${DIR}/05-span-json.png` });
  await page.locator('.ins-tabs button', { hasText: 'Checks' }).click();
  await page.waitForTimeout(200);
  await page.screenshot({ path: `${DIR}/06-span-checks.png` });
  await page.locator('.ins-tabs button', { hasText: 'Prompt' }).click();
  await page.waitForTimeout(200);
  await page.screenshot({ path: `${DIR}/07-span-prompt.png` });

  // Without the inspector: the verdict as the player sees it.
  await page.evaluate(() => window.__game!.council.inspector(false));
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${DIR}/08-verdict-checks.png` });

  const funds = await page.evaluate(() => window.__game!.game.sim.state.funds);
  await page.locator('.verdict .btn-go').click();
  await page.locator('.council-result').waitFor();
  const after = await page.evaluate(() => ({ funds: window.__game!.game.sim.state.funds, trace: window.__game!.council.trace() }));
  expect(after.trace!.node).toBe('done');
  expect(after.trace!.execution!.drift).toEqual([]);
  expect(after.funds).toBe(funds + after.trace!.execution!.observed!.budgetDelta);
  expect(after.trace!.attribution!.followedChair).toBe(true);
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${DIR}/09-enacted.png` });
  await page.evaluate(() => window.__game!.council.inspector(true));
  await page.locator('.ins-section', { hasText: 'Mayor’s decision' }).scrollIntoViewIfNeeded();
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${DIR}/10-inspector-decision.png` });
  await page.evaluate(() => window.__game!.council.inspector(false));

  // Back in the city, the next meeting on the same problem remembers this one.
  await page.getByRole('button', { name: 'Back to the city' }).click();
  await page.waitForFunction(() => window.__game!.council.phase() === 'off', undefined, { timeout: 60_000 });
  await page.evaluate(() => window.__game!.council.inspector(true));
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${DIR}/11-inspector-in-city.png` });
});

test('inspector: rate limit mid-meeting, the offline council takes over (stubbed model)', async ({ page }) => {
  test.setTimeout(300_000);
  let calls = 0;
  await page.route('**/api/llm/status', (route) => route.fulfill({ json: { ready: true, providers: ['Stub · model-x'], health: [] } }));
  await page.route('**/api/llm', async (route) => {
    calls++;
    // The first call answers; after that the free tier is exhausted.
    if (calls > 1) return route.fulfill({ status: 429, json: { error: 'All AI providers failed. Stub model-x: 429 quota exceeded', rateLimited: true } });
    const body = route.request().postDataJSON() as { system: string; user: string };
    const text = JSON.stringify({ speak: true, stance: 'propose', option: 'A', say: 'This segment is past its jam point at rush hour. I propose option A.', condition: '' });
    await route.fulfill({ json: { text, provider: 'Stub · model-x', usage: { prompt: Math.round((body.system.length + body.user.length) / 4), completion: 40, reasoning: 0 }, latencyMs: 800, finish: 'stop', attempts: 1 } });
  });
  await grownCity(page, 'shots=1');
  await page.evaluate(() => window.__game!.council.convene('traffic'));
  await page.locator('.brief-card').waitFor({ timeout: 60_000 });
  await page.getByRole('button', { name: 'Begin the meeting' }).click();
  await finishDebate(page);
  await page.evaluate(() => window.__game!.council.inspector(true));
  await page.waitForTimeout(600);
  const trace = await page.evaluate(() => window.__game!.council.trace());
  console.log('calls', calls, 'totals', JSON.stringify(trace!.totals));
  // The lead's call succeeded; the three reactions went out together and all hit the
  // limit; the breaker then stopped round 2 and the chair from calling at all.
  expect(calls).toBeLessThanOrEqual(4);
  expect(trace!.totals.llmCalls).toBe(1);
  expect(trace!.totals.policyTurns).toBeGreaterThan(2);
  expect(trace!.node).toBe('hitl');
  await expect(page.locator('.council-notice')).toBeVisible();
  await page.screenshot({ path: `${DIR}/12-rate-limit-fallback.png` });
});
