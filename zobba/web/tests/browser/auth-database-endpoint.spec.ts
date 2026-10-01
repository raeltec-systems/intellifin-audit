import { spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { Worker } from 'node:worker_threads';
import { expect, test } from '@playwright/test';
import { startAuthRuntime } from './auth-runtime';
import type { AuthRuntime } from './auth-runtime';
import { restoreAndClose } from './cleanup';

test.use({ ignoreHTTPSErrors: true });
const root = fileURLToPath(new URL('../../..', import.meta.url));
const databaseNames = ['ZOBBA_TEST_MIGRATION_DATABASE_URL', 'ZOBBA_TEST_RUNTIME_DATABASE_URL', 'ZOBBA_TEST_ADMIN_DATABASE_URL'] as const;
const restoreAuthority = `
UPDATE public.identities SET active=true WHERE id='actor-a';
UPDATE public.organisation_memberships SET active=true,expires_at=NULL,roles=ARRAY['auditor'] WHERE actor_id='actor-a' AND organisation_id='org-a';
UPDATE public.engagement_assignments SET active=true,expires_at=NULL WHERE actor_id='actor-a' AND organisation_id='org-a';`;

test('portless PGPORT routes actual migration, admin SQL and authenticated recovery through an owned relay', async ({ page }) => {
  // Validate the original targets before a relay could hide a development alias.
  const guarded = spawnSync('python3', ['-c', "import sys; sys.path.insert(0, 'scripts'); import smoke; smoke.test_urls()"], {
    cwd: root, env: process.env, encoding: 'utf8',
  });
  if (guarded.error || guarded.status !== 0) throw new Error('Original disposable browser database targets were refused.');
  const previous = new Map([...databaseNames, 'PGPORT'].map(name => [name, process.env[name]]));
  if (databaseNames.some(name => !previous.get(name))) throw new Error('Set all three disposable browser database bindings.');

  // Synchronous migration/psql children block the test's event loop. The relay
  // therefore runs independently and acknowledges controls before each probe.
  const relay = new Worker(new URL('./auth-database-relay.ts', import.meta.url), { workerData: {
    source: previous.get('ZOBBA_TEST_RUNTIME_DATABASE_URL'),
  } });
  relay.on('error', () => { /* Observations below use a fixed, secret-safe failure. */ });
  let relayExited = false;
  relay.on('exit', () => { relayExited = true; });
  const exchange = async (action?: 'disconnect' | 'restore' | 'close'): Promise<unknown> => {
    if (relayExited) throw new Error('Owned database relay exited unexpectedly.');
    const response = once(relay, 'message', { signal: AbortSignal.timeout(5000) });
    if (action) relay.postMessage(action);
    let message: unknown;
    try { [message] = await response; } catch { throw new Error('Owned database relay did not respond.'); }
    if (action && message !== action) throw new Error('Owned database relay control failed.');
    return message;
  };
  let runtime: AuthRuntime | undefined;
  try {
    const relayPort = await exchange();
    if (typeof relayPort !== 'number' || !Number.isInteger(relayPort) || relayPort <= 0 || relayPort > 65535 || relayPort === 5432) {
      throw new Error('Expected an owned nondefault database relay port.');
    }
    process.env.PGPORT = String(relayPort);
    for (const name of databaseNames) {
      const url = new URL(previous.get(name)!);
      url.hostname = '127.0.0.1';
      url.port = '';
      process.env[name] = url.toString();
    }

    await exchange('disconnect');
    let startupFailure: unknown;
    try { runtime = await startAuthRuntime(); } catch (error) { startupFailure = error; }
    finally {
      await exchange('restore');
      if (runtime) { await runtime.close(); runtime = undefined; }
    }
    // On CI's default upstream port, bypassing the relay could still migrate.
    // Require the actual migration command to fail, not a later API startup.
    expect(startupFailure instanceof Error && /^Owned browser fixture command failed: .*\/zobba-cli migrate$/.test(startupFailure.message),
      'The disconnected relay must block the actual migration command.').toBe(true);

    runtime = await startAuthRuntime();
    runtime.sql(restoreAuthority);
    await exchange('disconnect');
    try { expect(() => runtime!.sql('SELECT 1;')).toThrow('Synthetic browser database mutation failed.'); }
    finally { await exchange('restore'); }
    runtime.sql('SELECT 1;');

    await page.goto(runtime.url);
    await page.getByRole('link', { name: 'Sign in to Zobba' }).click();
    await page.getByLabel('Account', { exact: true }).selectOption('auditor-a');
    await page.getByLabel('Password', { exact: true }).fill(runtime.password);
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await page.getByRole('button', { name: /FY2026 audit/ }).click();
    await expect(page.locator('.scope-panel > summary')).toBeVisible();

    runtime.sql("UPDATE public.organisation_memberships SET roles=ARRAY['admin'] WHERE actor_id='actor-a' AND organisation_id='org-a';");
    await page.getByRole('button', { name: 'Refresh access' }).click();
    await expect(page.getByRole('heading', { name: 'No assigned engagements' })).toBeVisible();
    await expect(page.locator('.scope-panel > summary')).toHaveCount(0);
    runtime.sql(restoreAuthority);
    await page.getByRole('button', { name: 'Refresh access' }).click();
    await page.getByRole('button', { name: /FY2026 audit/ }).click();
    await expect(page.locator('.scope-panel > summary')).toBeVisible();
  } finally {
    await page.getByLabel('Password', { exact: true }).fill('', { timeout: 250 }).catch(() => {});
    try { if (runtime) await restoreAndClose(runtime, restoreAuthority); }
    finally {
      try { if (!relayExited) await exchange('close'); }
      finally {
        await relay.terminate();
        for (const [name, value] of previous) {
          if (value === undefined) delete process.env[name];
          else process.env[name] = value;
        }
      }
    }
  }
});
