import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/browser',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 90_000,
  expect: { timeout: 12_000 },
  outputDir: process.env.ZOBBA_BROWSER_OUTPUT_DIR ?? join(tmpdir(), 'zobba-browser-results'),
  reporter: 'list',
  use: {
    browserName: 'chromium',
    headless: true,
    viewport: { width: 1280, height: 800 },
    screenshot: 'only-on-failure',
    launchOptions: process.env.ZOBBA_BROWSER_EXECUTABLE
      ? { executablePath: process.env.ZOBBA_BROWSER_EXECUTABLE }
      : {},
  },
});
