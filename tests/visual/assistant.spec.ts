import { mkdirSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { openGame } from './helpers';

const DIR = 'screenshots/assistant';

// The model's reply is stubbed so the run is repeatable; tests/eval/assistant.eval.ts
// checks real answers.
test('assistant: answers from the city and offers working buttons', async ({ page }) => {
  mkdirSync(DIR, { recursive: true });
  let lastPrompt = '';
  await page.route('**/api/llm', async (route) => {
    lastPrompt = (route.request().postDataJSON() as { user: string }).user;
    await route.fulfill({
      json: {
        provider: 'stub',
        text: JSON.stringify({
          answer:
            'Your homes are zoned beside Canal Street, but the city has no power plant and no water source, and buildings only appear on streets with spare power and water. Build a Water tower ($2,800) and a Wind turbine ($3,200) next to the street.',
          actions: [
            { type: 'tool', tool: 'place', facility: 4, label: 'Place a water tower' },
            { type: 'tool', tool: 'place', facility: 2, label: 'Place a wind turbine' },
            { type: 'view', overlay: 'power', label: 'Show power' },
          ],
        }),
      },
    });
  });
  await openGame(page, 'shots=1');
  await page.evaluate(() => {
    const g = window.__game!;
    g.exec({ type: 'buildRoad', road: 0, ax: 1040, az: 584, bx: 1300, bz: 584 });
    g.exec({ type: 'zoneRect', x0: 131, y0: 74, x1: 160, y1: 76, zone: 5 });
    g.exec({ type: 'zoneRect', x0: 131, y0: 100, x1: 140, y1: 104, zone: 5 });
    g.advance(300);
    g.camera({ x: 1170, z: 640, yaw: 0.3, pitch: 0.9, dist: 380 }, true);
  });
  await page.getByRole('button', { name: 'Ask', exact: true }).first().click();
  await page.screenshot({ path: `${DIR}/01-empty.png` });
  await page.getByPlaceholder(/Why can't I build/).fill('Why are my homes not being built?');
  await page.keyboard.press('Enter');
  await page.locator('.bubble.is-assistant').waitFor();
  // The prompt carried the live city: no power, land waiting by an unserved road and land too far from roads.
  expect(lastPrompt).toContain('No power');
  expect(lastPrompt).toMatch(/cells by a road without spare power or water/);
  expect(lastPrompt).toMatch(/cells too far from any road/);
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${DIR}/02-answer.png` });
  await page.getByRole('button', { name: 'Place a water tower' }).click();
  // The button picked up the placement tool with the water tower selected.
  await expect(page.locator('.tool-btn[aria-pressed="true"]', { hasText: 'Water tower' })).toHaveCount(1);
  await expect(page.getByText(/Water tower\s+·\s+\$2,800\s+·\s+place beside a road/)).toBeVisible();

  // Without the AI the assistant still answers from the city's warnings.
  await page.unroute('**/api/llm');
  await page.route('**/api/llm', (route) => route.fulfill({ status: 503, json: { error: 'down' } }));
  await page.getByPlaceholder(/Why can't I build/).fill('शहर क्यों नहीं बढ़ रहा?');
  await page.keyboard.press('Enter');
  await page.locator('.bubble-note').waitFor();
  await page.waitForTimeout(600);
  await page.screenshot({ path: `${DIR}/03-offline-hindi.png` });
});
