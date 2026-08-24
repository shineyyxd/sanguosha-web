import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // e2e 由 Playwright 跑（npm run test:e2e --workspace @sanguosha/client），不进默认 vitest
    exclude: ['**/node_modules/**', '**/dist/**', '**/e2e/**'],
  },
});
