import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

import { expect, test, type Page } from '@playwright/test';

import { createSqlClient } from '@intellifin/infrastructure';

import { AUTH_STATE, assertThrowawayDatabase } from './accounts';
import { READ_ONLY_CREDENTIAL } from './credentials';
import { NORTHSTAR_BASE_URL, READ_ONLY_RULE, UNREACHABLE_BASE_URL } from './northstar';

/**
 * The synthetic Northstar systems, end to end (Story 1.8, FR-3, FR-8, AD-10).
 *
 * Three things only a real run can prove:
 *
 *   1. the systems are reachable and serve what the addendum says they serve;
 *   2. a write is refused BY THE SYSTEM, with a denial a Run can record — not by the
 *      registration allowlist alone, and not as a silent 404;
 *   3. the worker's probe entry point writes connectivity that the Administration surface
 *      then reads, so the column stops saying "Never probed".
 *
 * The probe is started as its own PROCESS, which is the point of it: nothing under `apps/`
 * may import the prober, and `pnpm boundaries` fails the build if anything does.
 */

/** Unique per run, and obviously synthetic, so a re-run does not collide with the last. */
const stamp = `${Date.now()}`;
const reachableName = `E2E Northstar LoanCore ${stamp}`;
const unreachableName = `E2E Northstar Offline ${stamp}`;

const PROBE_ENTRY_POINT = fileURLToPath(
  new URL('../../packages/infrastructure/dist/registrations/probe-runner.js', import.meta.url),
);

test.afterAll(async () => {
  const databaseUrl = process.env['DATABASE_URL'];
  if (databaseUrl === undefined || databaseUrl === '') return;
  assertThrowawayDatabase(databaseUrl);
  const sql = createSqlClient(databaseUrl, { max: 1 });
  try {
    // `target_system_probe` references the registration with ON DELETE CASCADE, so the
    // rows this file's probe wrote go with it. The audit events stay: they are exactly
    // what must survive.
    await sql`DELETE FROM target_system_registration WHERE display_name LIKE ${`E2E Northstar %${stamp}%`}`;
  } finally {
    await sql.end({ timeout: 5 });
  }
});

/** Register one Target System through the real interface and its confirmation dialog. */
async function registerSystem(page: Page, name: string, origin: string): Promise<void> {
  await page.goto('/administration/registrations');
  await page.getByLabel('Display name').fill(name);
  await page.getByLabel('System kind').selectOption('web');
  await page.getByLabel('Allowed origins').fill(origin);
  await page.getByLabel('Credential reference').fill(READ_ONLY_CREDENTIAL);
  await page.getByRole('checkbox', { name: 'Navigate' }).check();
  await page.getByRole('checkbox', { name: 'Read an attribute' }).check();
  await page.getByRole('button', { name: 'Register system' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Register system' }).click();
  await expect(page.getByRole('status')).toContainText(`Registered ${name}.`);
}

test.describe('the synthetic Northstar systems', () => {
  test('serve every surface the addendum names', async ({ request }) => {
    // The eight the acceptance criterion names, plus LedgerFlow, which addendum A.1 names
    // as the P-3 population and the story spec's execution list omits.
    const surfaces = [
      '/loancore',
      '/prodconsole/configuration',
      '/accessgate/accounts',
      '/accessgate/accounts/count',
      '/approvenow/approvals',
      '/approvenow/approvals/count',
      '/peoplehub/employees',
      '/peoplehub/employees/count',
      '/ledgerflow/transactions',
      '/ledgerflow/transactions/count',
      '/files/leavers-export.csv',
      '/files/leavers-export.cover-sheet.json',
      '/files/role-matrix.csv',
      '/files/config-registry.csv',
    ];
    for (const surface of surfaces) {
      const response = await request.get(`${NORTHSTAR_BASE_URL}${surface}`);
      expect(response.status(), surface).toBe(200);
    }
  });

  test('render a LoanCore account page with the declared attribute labels', async ({ page }) => {
    await page.goto(`${NORTHSTAR_BASE_URL}/loancore/users/E-000103`);
    for (const label of ['Employee ID', 'Username', 'Status', 'Roles']) {
      await expect(page.getByText(label, { exact: true })).toBeVisible();
    }
    await expect(page.getByText('E-000103', { exact: true })).toBeVisible();
  });

  test('render a not-found page for a missing employee, never a 500', async ({ page, request }) => {
    const response = await request.get(`${NORTHSTAR_BASE_URL}/loancore/users/E-999999`);
    expect(response.status()).toBe(404);
    await page.goto(`${NORTHSTAR_BASE_URL}/loancore/users/E-999999`);
    await expect(page.getByRole('heading', { name: 'Account not found' })).toBeVisible();
  });

  test('refuse every write with an explicit denial that names the rule', async ({ request }) => {
    const attempts = [
      { method: 'post' as const, path: '/loancore/users/E-000103' },
      { method: 'put' as const, path: '/prodconsole/configuration' },
      { method: 'patch' as const, path: '/accessgate/accounts' },
      { method: 'delete' as const, path: '/files/leavers-export.csv' },
      // A write to a path no route serves is REFUSED, not 404'd. "There is nothing here"
      // and "this system does not accept that" are different statements to a Run.
      { method: 'post' as const, path: '/nothing/is/served/here' },
    ];
    for (const attempt of attempts) {
      const response = await request[attempt.method](`${NORTHSTAR_BASE_URL}${attempt.path}`);
      expect(response.status(), `${attempt.method} ${attempt.path}`).toBe(405);
      expect(response.headers()['allow'], attempt.path).toBe('GET, HEAD');
      const body = (await response.json()) as Record<string, unknown>;
      expect(body['rule'], attempt.path).toBe(READ_ONLY_RULE);
      expect(body['allowed'], attempt.path).toEqual(['GET', 'HEAD']);
    }
  });

  test('publish a cover sheet whose digest covers the bytes served', async ({ request }) => {
    const sheet = (await (
      await request.get(`${NORTHSTAR_BASE_URL}/files/leavers-export.cover-sheet.json`)
    ).json()) as { row_count: number; content_digest: { value: string } };
    const csv = await (await request.get(`${NORTHSTAR_BASE_URL}/files/leavers-export.csv`)).body();
    // Recomputed here, over the bytes this test actually fetched. A digest read back from
    // the sheet and compared with itself would prove nothing about what was served.
    expect(createHash('sha256').update(csv).digest('hex')).toBe(sheet.content_digest.value);
    // And the declared row count is the file's, computed here rather than read back from
    // the declaration that is under test.
    const lines = csv.toString('utf8').trimEnd().split('\n');
    expect(lines.length - 2).toBe(sheet.row_count);
  });

  test('answer a count endpoint that reconciles against the bound population', async ({
    request,
  }) => {
    const declared = (await (
      await request.get(`${NORTHSTAR_BASE_URL}/accessgate/accounts/count`)
    ).json()) as { declared_count: number };
    const population = (await (
      await request.get(`${NORTHSTAR_BASE_URL}/accessgate/accounts?status=Active`)
    ).json()) as { accounts: unknown[] };
    expect(population.accounts.length).toBe(declared.declared_count);
  });

  test('answer the same bytes twice, so a Run is reproducible', async ({ request }) => {
    const first = await (await request.get(`${NORTHSTAR_BASE_URL}/ledgerflow/transactions`)).text();
    const second = await (await request.get(`${NORTHSTAR_BASE_URL}/ledgerflow/transactions`)).text();
    expect(second).toBe(first);
  });
});

test.describe('the probe entry point', () => {
  test.use({ storageState: AUTH_STATE.administrator });
  // Registering twice through a confirmation dialog, then a child process, then two
  // reloads. The default 30 seconds is not enough for the whole journey.
  test.setTimeout(120_000);

  test('writes connectivity the Administration surface then reads', async ({ page }) => {
    const databaseUrl = process.env['DATABASE_URL'];
    test.skip(
      databaseUrl === undefined || databaseUrl === '',
      'DATABASE_URL is required to run the probe entry point',
    );

    await registerSystem(page, reachableName, `${NORTHSTAR_BASE_URL}/loancore`);
    await registerSystem(page, unreachableName, `${UNREACHABLE_BASE_URL}/nothing`);

    // Before the probe, both say so in words. A dash or an empty cell is something a
    // reader takes for "fine".
    await page.reload();
    for (const name of [reachableName, unreachableName]) {
      await expect(page.getByRole('row', { name: new RegExp(name) })).toContainText('Never probed');
    }

    // The entry point, started as its own process — which is the whole design. Nothing
    // under `apps/` may import the prober; `pnpm boundaries` fails the build if it does,
    // and `tests/unit/boundaries.test.ts` plants that violation to prove the rule fires.
    // This is what `pnpm --filter @intellifin/worker probe` runs, without the rebuild.
    const output = execFileSync(process.execPath, [PROBE_ENTRY_POINT], {
      encoding: 'utf8',
      env: {
        ...process.env,
        DATABASE_URL: databaseUrl as string,
        // Registrations left behind by other specs point at hosts that never resolve.
        // Without a shorter deadline the sweep waits five seconds for each of them.
        PROBE_TIMEOUT_MS: '2000',
      },
      timeout: 90_000,
    });
    expect(output).toContain('Probe sweep complete');

    await page.reload();
    const reachableRow = page.getByRole('row', { name: new RegExp(reachableName) });
    await expect(reachableRow).toContainText('Reachable');
    await expect(reachableRow).not.toContainText('Never probed');
    // The observation carries when it was made, in UTC, so "reachable" is a statement
    // about a moment rather than a standing claim.
    await expect(reachableRow).toContainText('UTC');

    const unreachableRow = page.getByRole('row', { name: new RegExp(unreachableName) });
    await expect(unreachableRow).toContainText('Unreachable');
    await expect(unreachableRow).not.toContainText('Never probed');
  });

  test('records what it saw and nothing about what it read', async () => {
    const databaseUrl = process.env['DATABASE_URL'];
    test.skip(databaseUrl === undefined || databaseUrl === '', 'DATABASE_URL is required');
    const sql = createSqlClient(databaseUrl as string, { max: 1 });
    try {
      // NFR-6: no response body, header, redirect target or error string from a Target
      // System is in this product's data. The table has four columns and none of them
      // could hold one — asserted against the database, not against the writer.
      const columns = await sql<{ column_name: string }[]>`
        SELECT column_name FROM information_schema.columns
        WHERE table_schema = 'public' AND table_name = 'target_system_probe'
        ORDER BY column_name
      `;
      expect(columns.map((row) => row.column_name)).toEqual([
        'observed_at',
        'observed_by',
        'registration_id',
        'state',
      ]);
    } finally {
      await sql.end({ timeout: 5 });
    }
  });
});
