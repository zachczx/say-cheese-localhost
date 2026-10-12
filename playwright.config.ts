import { defineConfig } from '@playwright/test';

export const FIXTURE_ORIGIN = 'http://127.0.0.1:5199';

export default defineConfig({
  testDir: './e2e',
  timeout: 120_000,
  workers: 1,
  reporter: process.env.CI ? 'github' : 'list',
  webServer: {
    command: 'pnpm exec vite preview --host 127.0.0.1 --port 5199 --strictPort',
    url: `${FIXTURE_ORIGIN}/fixture/`,
    reuseExistingServer: !process.env.CI,
  },
});
