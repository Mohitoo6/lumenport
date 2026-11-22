import base from '../../playwright.config';

// The cloud-save flow against a stand-in Supabase (routes mocked in the spec). Its own dev
// server, so the accounts feature is switched on with dummy settings.
export default {
  ...base,
  testDir: '.',
  use: { ...base.use, baseURL: 'http://localhost:5197' },
  webServer: {
    command: 'npx vite --port 5197 --strictPort',
    url: 'http://localhost:5197',
    reuseExistingServer: true,
    timeout: 60_000,
    env: { VITE_SUPABASE_URL: 'https://stand-in.supabase.co', VITE_SUPABASE_ANON_KEY: 'stand-in-anon-key' },
  },
};
