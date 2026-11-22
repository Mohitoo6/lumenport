import { expect, test, type Page, type Route } from '@playwright/test';

const user = { id: '11111111-2222-3333-4444-555555555555', email: 'player@example.com', aud: 'authenticated', role: 'authenticated', app_metadata: {}, user_metadata: {}, created_at: '2026-11-22T00:00:00Z' };
const b64 = (o: object): string => Buffer.from(JSON.stringify(o)).toString('base64url');
const token = `${b64({ alg: 'HS256', typ: 'JWT' })}.${b64({ sub: user.id, email: user.email, exp: 4102444800, role: 'authenticated' })}.sig`;
const session = { access_token: token, refresh_token: 'refresh', token_type: 'bearer', expires_in: 3600, expires_at: 4102444800, user };

/** A stand-in for the Supabase REST API: one table, rows kept in memory. */
function standIn(page: Page, rows: Map<string, Record<string, unknown>>, uploads: string[]): Promise<unknown> {
  return page.route('https://stand-in.supabase.co/**', async (route: Route) => {
    const req = route.request();
    const url = new URL(req.url());
    const json = (body: unknown, status = 200): Promise<void> => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
    if (url.pathname.startsWith('/auth/v1/user')) return json(user);
    if (url.pathname.startsWith('/auth/v1/')) return json({});
    if (url.pathname === '/rest/v1/city_saves') {
      // Every request must carry the player's token, as the real database requires.
      expect(req.headers()['authorization']).toBe(`Bearer ${token}`);
      if (req.method() === 'POST') {
        const row = JSON.parse(req.postData() ?? '{}') as Record<string, unknown>;
        rows.set(String(row.slot), row);
        uploads.push(String(row.slot));
        return route.fulfill({ status: 201, body: '' });
      }
      const slot = url.searchParams.get('slot')?.replace('eq.', '');
      if (slot) return json(rows.has(slot) ? { data: rows.get(slot)!.data } : null);
      return json([...rows.values()].map(({ data: _d, ...r }) => r));
    }
    return json({});
  });
}

test('sign-in state, saving to the account, loading, and continuing after a reload', async ({ page }) => {
  test.setTimeout(240_000);
  const rows = new Map<string, Record<string, unknown>>();
  const uploads: string[] = [];
  await standIn(page, rows, uploads);
  await page.addInitScript((s) => {
    localStorage.setItem('metropolis.auth', JSON.stringify(s));
    localStorage.setItem('metropolis.welcome.v1', '1');
  }, session);
  await page.goto('/?fresh=1');
  await page.waitForFunction(() => window.__game?.ready === true, undefined, { timeout: 120_000 });

  // Build something, then save it to the account.
  await page.evaluate(() => {
    window.__game!.exec({ type: 'buildRoad', road: 0, ax: 1120, az: 584, bx: 1500, bz: 584 });
    window.__game!.exec({ type: 'renameCity', name: 'Cloud Nagar' });
  });
  await page.keyboard.press('m');
  await expect(page.getByText('Signed in as player@example.com')).toBeVisible();
  await page.locator('.loan', { hasText: 'Cloud slot 1' }).getByRole('button', { name: 'Save' }).click();
  await expect(page.getByText('Saved to your account.')).toBeVisible();
  expect(uploads).toContain('cloud-1');
  expect(String(rows.get('cloud-1')!.city_name)).toBe('Cloud Nagar');
  await expect(page.locator('.loan', { hasText: 'Cloud slot 1: Cloud Nagar' })).toBeVisible();
  const roads = await page.evaluate(() => window.__game!.game.sim.state.roads.edges.filter((e) => e).length);

  // Start over, then load the city back from the account.
  await page.evaluate(() => window.__game!.exec({ type: 'renameCity', name: 'Somewhere else' }));
  await page.locator('.loan', { hasText: 'Cloud slot 1' }).getByRole('button', { name: 'Load' }).click();
  await expect(page.getByText('City loaded from your account.')).toBeVisible();
  expect(await page.evaluate(() => window.__game!.game.sim.state.cityName)).toBe('Cloud Nagar');
  expect(await page.evaluate(() => window.__game!.game.sim.state.roads.edges.filter((e) => e).length)).toBe(roads);
  await page.screenshot({ path: 'screenshots/welcome/03-account.png' });

  // Come back later: the game offers the latest city in the account.
  await page.reload();
  await page.waitForFunction(() => window.__game?.ready === true, undefined, { timeout: 120_000 });
  await expect(page.locator('.resume-card')).toBeVisible();
  await expect(page.locator('.resume-card')).toContainText('Continue Cloud Nagar?');
  await page.screenshot({ path: 'screenshots/welcome/04-continue.png' });
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.locator('.resume-card')).toHaveCount(0);
  await page.waitForFunction(() => window.__game!.game.sim.state.cityName === 'Cloud Nagar', undefined, { timeout: 15_000 });
});
