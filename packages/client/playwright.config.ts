import { defineConfig } from '@playwright/test';

/**
 * 端到端测试：起真实游戏服务器（:3210）+ Vite dev server（:5174，/socket.io 代理到 :3210），
 * 用真实浏览器跑完整对局交互。不进默认 npm test（需要起服务，慢）：npm run test:e2e。
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 60_000,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:5174',
  },
  webServer: [
    {
      command: 'npx tsx ../server/src/index.ts',
      port: 3210,
      env: { PORT: '3210', ASK_TIMEOUT_MS: '15000', DB_PATH: ':memory:' },
      reuseExistingServer: false,
      timeout: 30_000,
    },
    {
      command: 'npx vite --port 5174 --strictPort',
      port: 5174,
      env: { VITE_PROXY_TARGET: 'http://localhost:3210' },
      reuseExistingServer: false,
      timeout: 30_000,
    },
  ],
});
