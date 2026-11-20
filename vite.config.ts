import { defineConfig } from 'vitest/config';
import { loadEnv } from 'vite';
import preact from '@preact/preset-vite';
import { llmProxy } from './server/llmProxy';

export default defineConfig(({ mode }) => {
  // All variables from .env, including ones without the VITE_ prefix. They are read here,
  // on the server, and are never exposed to the page.
  const env = loadEnv(mode, process.cwd(), '');
  return {
    plugins: [preact(), llmProxy(env)],
    server: { port: 5173, strictPort: false },
    build: { target: 'es2022', chunkSizeWarningLimit: 1500 },
    test: {
      include: ['tests/sim/**/*.test.ts', 'tests/game/**/*.test.ts', 'tests/render/**/*.test.ts'],
      environment: 'node',
      // Some tests simulate years of game time.
      testTimeout: 30_000,
    },
  };
});
