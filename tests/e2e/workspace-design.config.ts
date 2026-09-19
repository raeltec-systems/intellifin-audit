import { defineConfig } from '@playwright/test';

/** Fast P0 feedback; the same spec also runs in the normal application browser gate. */
export default defineConfig({
  testDir: '.',
  testMatch: 'auditor-workspace-prototype.spec.ts',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: Boolean(process.env['CI']),
  reporter: [['list'], ['html', { outputFolder: 'workspace-design-report', open: 'never' }]],
  use: { viewport: { width: 1440, height: 900 }, screenshot: 'only-on-failure' },
});
