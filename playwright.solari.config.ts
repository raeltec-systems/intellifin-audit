import { defineConfig } from '@playwright/test';

/** Explicit live acceptance only. No local browser, sign-in setup, target server or recording. */
export default defineConfig({
  testDir: './tests/e2e',
  testMatch: /solari-(?:audit-acceptance|workspace-isolation)\.spec\.ts$/,
  fullyParallel: false,
  forbidOnly: true,
  workers: 1,
  retries: 0,
  // Do not allocate the paired sessions after a failed audit/cleanup gate.
  maxFailures: 1,
  timeout: 720_000,
  reporter: [['list']],
  use: { trace: 'off', video: 'off', screenshot: 'off' },
});
