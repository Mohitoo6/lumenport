import { defineConfig } from '@playwright/test';

// Screenshot runs, not assertions-heavy tests: each spec builds a scripted scene through
// window.__game and saves PNGs into screenshots/phase-N/ for manual review.
export default defineConfig({
  testDir: 'tests/visual',
  timeout: 180_000,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:5199',
    viewport: { width: 1600, height: 900 },
    deviceScaleFactor: 1,
    launchOptions: {
      args: ['--use-angle=metal', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-webgl'],
    },
  },
  webServer: {
    command: 'npx vite --port 5199 --strictPort',
    url: 'http://localhost:5199',
    reuseExistingServer: true,
    timeout: 60_000,
  },
});
