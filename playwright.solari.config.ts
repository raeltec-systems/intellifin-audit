import { defineConfig } from '@playwright/test';

/** Explicit live acceptance only. No local browser, sign-in setup, target server or recording. */
export default defineConfig({
  testDir: './tests/e2e',
  testMatch: /solari-audit-acceptance\.spec\.ts$/,
  fullyParallel: false,
  forbidOnly: true,
  workers: 1,
  retries: 0,
  timeout: 720_000,
  reporter: [['list']],
  use: { trace: 'off', video: 'off', screenshot: 'off' },
});
