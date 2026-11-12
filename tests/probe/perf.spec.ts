// Performance probe (not part of npm run shots): measures uncapped frame rates under
// different settings. Run with: npx playwright test --config tests/probe/pw.config.ts

import { test } from '@playwright/test';
import { advance, buildTown, openGame, zoneTown } from '../visual/helpers';

test.use({ viewport: { width: 1470, height: 900 }, deviceScaleFactor: 2, launchOptions: { args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--disable-gpu-vsync', '--disable-frame-rate-limit'] } });

test('perf probe', async ({ page }) => {
  test.setTimeout(300_000);
  await openGame(page, 'shots=1');
  await buildTown(page);
  await zoneTown(page);
  await advance(page, 3600);
  await page.evaluate(() => {
    window.__game!.camera({ x: 1300, z: 650, yaw: 0.5, pitch: 0.75, dist: 600 }, true);
    window.__game!.exec({ type: 'setSpeed', speed: 1 });
  });
  const measure = async (label: string): Promise<void> => {
    await page.waitForTimeout(2500);
    const r = await page.evaluate(async () => {
      const g = window.__game!.game;
      const f0 = g.frameCount;
      const t0 = performance.now();
      // JS time per frame, excluding the GPU: wrap the engine render.
      await new Promise((res) => setTimeout(res, 3000));
      const fps = ((g.frameCount - f0) * 1000) / (performance.now() - t0);
      const s = g.stats();
      return { fps: Math.round(fps), dpr: g.engine.pixelRatio, draws: s.drawCalls, tris: Math.round(s.triangles / 1000) + 'k' };
    });
    console.log(label.padEnd(34), JSON.stringify(r));
  };
  await measure('default (dpr 1.5)');
  await page.evaluate(() => { const g = window.__game!.game; (g.engine.ao as unknown as { enabled: boolean }).enabled = false; });
  await measure('no AO');
  await page.evaluate(() => { const g = window.__game!.game; (g.engine.ao as unknown as { enabled: boolean }).enabled = true; g.atmosphere.sun.castShadow = false; });
  await measure('no shadows');
  await page.evaluate(() => { const g = window.__game!.game; g.atmosphere.sun.castShadow = true; g.atmosphere.sun.shadow.mapSize.set(2048, 2048); g.atmosphere.sun.shadow.map?.dispose(); (g.atmosphere.sun.shadow as unknown as { map: null }).map = null; });
  await measure('shadow 2048');
  await page.evaluate(() => { const g = window.__game!.game; g.engine.pixelRatio = 1; g.engine.resize(); });
  await measure('shadow 2048, dpr 1');
  await page.evaluate(() => { const g = window.__game!.game; g.engine.pixelRatio = 1.5; g.engine.resize(); g.atmosphere.sun.shadow.mapSize.set(4096, 4096); g.atmosphere.sun.shadow.map?.dispose(); (g.atmosphere.sun.shadow as unknown as { map: null }).map = null; g.exec({ type: 'setSpeed', speed: 0 }); });
  await measure('paused, default');
});
