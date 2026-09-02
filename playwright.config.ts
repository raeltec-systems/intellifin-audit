import { defineConfig, devices } from '@playwright/test';

import { CREDENTIAL_CAPABILITIES } from './tests/e2e/credentials';

/**
 * The browser gate.
 *
 * NFR-11 makes automated WCAG 2.1 AA checks a CI requirement, and axe against a real
 * browser is the only check that means anything: a jsdom approximation passes things a
 * browser fails, so the accessibility floor would be an intention rather than a gate.
 * `@playwright/test` was pinned in Story 1.1 with no config, no script and no CI step;
 * this file closes that.
 *
 * The web server is `next dev`, not `next build && next start`, for one specific
 * reason: a production build sets `NODE_ENV=production`, where `loadConfig` refuses a
 * plain-http `BETTER_AUTH_URL` because Better Auth would not mark the session cookie
 * `Secure`. A local run and a CI run both serve over http on localhost, so both run the
 * development server. The story under test is markup, styling and server-side
 * authorization, none of which the build mode changes.
 *
 * Everything the server needs comes from the environment, so a run against an already
 * running server (`PLAYWRIGHT_BASE_URL` set) skips the server entirely.
 */

/** A non-numeric or out-of-range value would become `http://localhost:NaN`. */
function port(): number {
  const raw = process.env['PLAYWRIGHT_PORT'];
  if (raw === undefined || raw === '') return 3000;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
    throw new Error(`PLAYWRIGHT_PORT must be a port number, found "${raw}"`);
  }
  return parsed;
}

const PORT = port();
// `localhost`, never `127.0.0.1`: Next's dev server blocks cross-origin requests to
// its own dev resources, and it does not treat the two spellings as one host, so a
// browser on 127.0.0.1 is refused the HMR endpoint and the client runtime never boots
// — every page then renders server-side only and no button does anything.
const baseURL = process.env['PLAYWRIGHT_BASE_URL'] ?? `http://localhost:${PORT}`;
const externalServer = process.env['PLAYWRIGHT_BASE_URL'] !== undefined;

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  forbidOnly: Boolean(process.env['CI']),
  // No retries, in CI or out of it. This suite's whole point is a deterministic
  // accessibility gate: an axe violation does not become non-violating on a second run,
  // so a retry can only hide flakiness in the one place flakiness must be visible.
  retries: 0,
  // One worker: the specs sign in as different roles against one database, so parallel
  // workers would race each other's session cookies for no wall-clock gain on three files.
  workers: 1,
  reporter: process.env['CI']
    ? // The HTML report is what the failure artifact contains; without it the upload
      // step has nothing to upload.
      [['github'], ['list'], ['html', { open: 'never' }]]
    : [['list'], ['html', { open: 'never' }]],
  timeout: 30_000,
  expect: { timeout: 10_000 },
  use: {
    baseURL,
    trace: 'on-first-retry',
    // The product is desktop-first, optimised for 1280-1600px. Specs that test the
    // breakpoints set their own viewport.
    viewport: { width: 1440, height: 900 },
  },
  projects: [
    // Two real sign-ins, once, before anything else. See `tests/e2e/accounts.ts`.
    { name: 'setup', testMatch: /auth\.setup\.ts$/, use: { ...devices['Desktop Chrome'] } },
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
      dependencies: ['setup'],
      testIgnore: /auth\.setup\.ts$/,
    },
  ],
  ...(externalServer
    ? {}
    : {
        webServer: {
          command: `pnpm --filter @intellifin/web exec next dev --port ${PORT}`,
          url: `${baseURL}/api/health`,
          reuseExistingServer: !process.env['CI'],
          timeout: 180_000,
          stdout: 'pipe',
          stderr: 'pipe',
          env: {
            SERVICE_NAME: 'web',
            BETTER_AUTH_URL: baseURL,
            /**
             * What this deployment has been told about the credential references the
             * registration specs use (Story 1.6). It holds no secret — a reference and a
             * verdict — and it is declared here rather than left to the environment so
             * that a CI run needs no extra configuration to exercise both the accepted
             * and the refused path.
             */
            CREDENTIAL_CAPABILITIES,
          },
        },
      }),
});
