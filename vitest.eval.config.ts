import { defineConfig } from 'vitest/config';

// AI evaluations. eval:offline is free (no model calls, about 10 s); eval:council and
// eval:assistant use real providers, are slow and spend free-tier quota.
// EVAL_COUNCIL=1 npx vitest run --config vitest.eval.config.ts
export default defineConfig({
  test: {
    include: ['tests/eval/**/*.eval.ts'],
    testTimeout: 4 * 60 * 60_000,
  },
});
