import { defineConfig } from 'vitest/config';

// The AI council evaluation: real providers, slow, spends free-tier quota.
// EVAL_COUNCIL=1 npx vitest run --config vitest.eval.config.ts
export default defineConfig({
  test: {
    include: ['tests/eval/**/*.eval.ts'],
    testTimeout: 4 * 60 * 60_000,
  },
});
