import { expect, test, type Page } from '@playwright/test';
import { spawn, type ChildProcess } from 'node:child_process';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { WorkspacePreviewMetadata } from '@intellifin/application';
import { PostgresWorkspacePreviewStore, createDb } from '@intellifin/infrastructure';
import { ACCOUNTS, AUTH_STATE, signIn } from './accounts';
import { CREDENTIAL_TOKENS, EXCEPTION_FINGERPRINT_KEY, EXCEPTION_FINGERPRINT_KEY_ID } from './credentials';
import { preparePreviewWorkerFixture, closePreviewWorkerFixture, startPreviewRun, sql, storage } from '../fixtures/workspace-preview-worker';

type Marker = { previewProof: true; pid: number; kind: string; id?: number; runId?: string;
  pageId?: number; preview?: boolean; digest?: string; runtimeId?: string; revision?: number; epoch?: number; pagesClosed?: boolean };
let worker: ChildProcess;
let markers: Marker[] = [];
let ready = false;
let expectedExit = false;
let failed = false;
let closed = true;
let exit: Promise<void>;
const startedRuns = new Set<string>();
const consumed = new Set<number>();
const stage = (page: Page) => page.getByLabel('Near-live workspace preview', { exact: true });
const image = (page: Page) => stage(page).getByAltText('Near-live synthetic workspace sample');

async function launch() {
  ready = false; failed = false; closed = false; expectedExit = false;
  markers = []; consumed.clear();
  worker = spawn(process.execPath, ['--import', pathToFileURL(resolve('tests/fixtures/workspace-preview-worker-preload.mjs')).href,
    resolve('apps/worker/dist/main.js')], {
    cwd: process.cwd(), windowsHide: true, detached: process.platform !== 'win32', stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
    env: { ...process.env, ...storage.env, SERVICE_NAME: 'worker', MODEL_PROVIDER: '', MODEL_ID: '', MODEL_API_KEY: '',
      ANTHROPIC_API_KEY: 'synthetic-agent-abuse-interception', AGENT_ANTHROPIC_MODEL: 'synthetic-agent-evaluation-journey',
      AGENT_OPENAI_MODEL: '', MODEL_MAX_OUTPUT_TOKENS: '1024', OPENAI_API_KEY: '', SOLARI_API_KEY: '',
      CREDENTIAL_TOKENS, EXCEPTION_FINGERPRINT_KEY, EXCEPTION_FINGERPRINT_KEY_ID },
  });
  let pending = '';
  worker.stdout!.on('data', data => {
    pending += String(data);
    const lines = pending.split('\n'); pending = lines.pop() ?? '';
    if (lines.some(line => line.includes('Heartbeat loop started'))) ready = true;
    // Provider output is deliberately discarded, including the inherited fixture markers.
  });
  worker.stderr!.on('data', () => undefined);
  worker.on('error', () => { failed = true; });
  worker.on('message', message => {
    if (message && typeof message === 'object' && 'previewProof' in message && message.previewProof === true) markers.push(message as Marker);
  });
  exit = new Promise<void>(resolveExit => worker.once('close', () => { closed = true; if (!expectedExit) failed = true; resolveExit(); }));
  await expect.poll(() => { if (failed) throw new Error('Synthetic preview worker failed to start'); return ready; }, { timeout: 60_000 }).toBe(true);
}
async function shutdown(signal: 'SIGTERM' | 'SIGKILL' = 'SIGTERM') {
  if (closed) return;
  expectedExit = true;
  if (signal === 'SIGTERM') worker.send({ type: 'release-all' });
  worker.kill(signal);
  try { await expect.poll(() => closed, { timeout: 35_000 }).toBe(true); }
  finally {
    if (!closed) worker.kill('SIGKILL');
    await exit;
    // A killed Node process cannot run browser teardown. Reap only this fixture's
    // process group after observing actual worker death, leaving no orphan Chromium.
    if (process.platform !== 'win32' && worker.pid) {
      try { process.kill(-worker.pid, 'SIGKILL'); } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error;
      }
    }
  }
}
async function nextGate(kind: string, runId?: string): Promise<Marker> {
  let found: Marker | undefined;
  await expect.poll(() => {
    if (failed) throw new Error('Synthetic preview worker exited unexpectedly');
    found = markers.find(row => row.kind === kind && row.id !== undefined && !consumed.has(row.id) && (!runId || row.runId === runId));
    return !!found;
  }, { timeout: 60_000 }).toBe(true);
  consumed.add(found!.id!);
  return found!;
}
const release = (gate: Marker) => worker.send({ type: 'release', id: gate.id });
const previewRequests = new WeakMap<Page, string[]>();
function observePreviewRequests(page: Page) {
  const outcomes: string[] = [];
  previewRequests.set(page, outcomes);
  const record = (value: string) => { outcomes.push(value); if (outcomes.length > 20) outcomes.shift(); };
  page.on('requestfailed', request => { if (request.url().includes('/preview?')) record(request.failure()?.errorText ?? 'failed'); });
  page.on('response', response => { if (response.url().includes('/preview?')) record(String(response.status())); });
}
async function metadata(runId: string) {
  const [row] = await sql`SELECT p.run_id,p.runtime_id,p.workspace_revision,p.privacy_epoch,p.mode,p.sequence,w.workspace_id,w.status,w.revision
    FROM run_workspace_preview p JOIN run_workspace w USING(run_id) WHERE p.run_id=${runId}`;
  return row;
}
async function sample(page: Page, runId: string) {
  const response = await page.request.get(`/api/runs/${runId}/preview?image=1`);
  if (!response.ok()) return null;
  const body = await response.json() as { metadata: WorkspacePreviewMetadata; image: string | null };
  return { metadata: body.metadata, digest: body.image ? createHash('sha256').update(Buffer.from(body.image, 'base64')).digest('hex') : null };
}
async function waitForFrame(page: Page, runId: string, timeout = 10_000) {
  try { await expect(image(page)).toBeVisible({ timeout }); }
  catch (cause) {
    // Fixed product status plus metadata/digests only: no cookies, DOM or pixels.
    const diagnostic = { status: await stage(page).textContent(), hidden: await page.evaluate(() => document.hidden),
      requests: previewRequests.get(page), response: await sample(page, runId), owner: await metadata(runId) };
    throw new Error(`Preview frame unavailable: ${JSON.stringify(diagnostic)}`, { cause });
  }
}
async function privateProof(page: Page, runId: string) {
  const gate = await nextGate('private-input', runId);
  await page.goto(`/runs/${runId}/workspace`);
  await expect(stage(page)).toContainText('Private step');
  await expect(image(page)).toHaveCount(0);
  const before = await metadata(runId);
  expect(before?.mode).toBe('private');
  for (let i = 0; i < 3; i++) {
    const result = await sample(page, runId);
    expect(result?.metadata.mode).toBe('private');
    expect(result?.digest).toBeNull();
  }
  expect(markers.filter(row => row.kind === 'capture' && row.runId === runId)).toHaveLength(0);
  release(gate);
  const model = await nextGate('model-turn');
  await waitForFrame(page, runId, 30_000);
  const after = await metadata(runId);
  expect(after?.mode).toBe('public');
  expect(Number(after?.privacy_epoch)).toBeGreaterThan(Number(before?.privacy_epoch));
  expect((await sql`SELECT status FROM run_agent_execution WHERE run_id=${runId}`)[0]?.status).toBe('SIGNED_IN');
  return model;
}
async function requestStop(page: Page, runId: string, model: Marker) {
  // The workspace's Stop conversation command shares the authoritative cancellation path.
  await page.getByLabel('Message the Run', { exact: true }).fill('Stop');
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
  await page.getByRole('button', { name: 'Review Stop', exact: true }).click();
  await page.getByRole('dialog', { name: 'Stop this Run?', exact: true }).getByRole('button', { name: 'Stop Run', exact: true }).click();
  release(model);
  await expect.poll(async () => (await sql`SELECT state FROM audit_run WHERE run_id=${runId}`)[0]?.state, { timeout: 60_000 }).toBe('CANCELED');
  await expect.poll(() => markers.some(row => row.kind === 'released' && row.runId === runId && row.pagesClosed), { timeout: 30_000 }).toBe(true);
  await expect(image(page)).toHaveCount(0);
  expect(await sample(page, runId)).toBeNull();
}

test.use({ storageState: AUTH_STATE.auditor, trace: 'off', screenshot: 'off', video: 'off' });

test.describe('composed compiled-worker near-live preview', () => {
  test.skip(process.env['WORKSPACE_PREVIEW_PROOF'] !== '1', 'Requires isolated synthetic-local preview broker and database.');
  test.describe.configure({ mode: 'serial' });
  test.setTimeout(240_000);
  test.beforeAll(async () => { await preparePreviewWorkerFixture(); await launch(); });
  test.afterAll(async () => { await shutdown(); await closePreviewWorkerFixture(); });

  test('actual saved sign-in, two sessions, safe Pause/Resume, revoked/disconnected viewer and Stop', async ({ page, browser }, info) => {
    const originalSessions = await sql`SELECT id FROM auth_session`;
    const secondContext = await browser.newContext({ storageState: { cookies: [], origins: [] } });
    const second = await secondContext.newPage();
    observePreviewRequests(page); observePreviewRequests(second);
    try {
      await signIn(second, ACCOUNTS.auditor.email);
      const [a, b] = await Promise.all([page.context().cookies(), secondContext.cookies()]);
      expect(a.find(row => row.name.includes('session_token'))?.value).toBeTruthy();
      expect(Boolean(b.find(row => row.name.includes('session_token'))?.value) &&
        b.find(row => row.name.includes('session_token'))?.value !== a.find(row => row.name.includes('session_token'))?.value,
        'Viewers must use distinct authenticated sessions').toBe(true);
      const runId = await startPreviewRun(page);
      expect(startedRuns.has(runId)).toBe(false); startedRuns.add(runId);
      let model = await privateProof(page, runId);
      await second.goto(`/runs/${runId}/workspace`);
      await waitForFrame(second, runId);
      const owner = await metadata(runId);
      expect(owner).toMatchObject({ run_id: runId, status: 'OPEN' });
      expect(owner?.workspace_revision).toBe(owner?.revision);
      expect(Number(owner?.workspace_revision)).toBeGreaterThan(0);
      let pair: Awaited<ReturnType<typeof sample>>[] = [];
      await expect.poll(async () => {
        pair = await Promise.all([sample(page, runId), sample(second, runId)]);
        return !!pair[0]?.digest && pair[0]?.metadata.sequence === pair[1]?.metadata.sequence;
      }).toBe(true);
      expect(pair[0]!.digest).toBe(pair[1]!.digest);
      expect(pair[0]!.metadata).toMatchObject({ runId, runtimeId: owner?.runtime_id, workspaceRevision: owner?.workspace_revision });
      expect(markers.some(row => row.kind === 'capture' && row.preview && row.runId === runId && row.digest === pair[0]!.digest && row.runtimeId === owner?.runtime_id)).toBe(true);
      expect(markers.filter(row => row.kind === 'page-created' && row.runId === runId)).toHaveLength(1);
      const firstSequence = pair[0]!.metadata.sequence;
      await expect.poll(async () => (await sample(page, runId))?.metadata.sequence).toBeGreaterThan(firstSequence);

      await secondContext.setOffline(true);
      await expect(image(second)).toHaveCount(0);
      await expect(stage(second)).toContainText(/unavailable|stale/);
      await waitForFrame(page, runId);
      await secondContext.setOffline(false);
      await waitForFrame(second, runId);
      const sessions = await sql`SELECT id FROM auth_session`;
      const disposable = sessions.filter(row => !originalSessions.some(old => old.id === row.id));
      expect(disposable).toHaveLength(1);
      await sql`UPDATE auth_session SET expires_at=clock_timestamp()-interval '1 second' WHERE id=${disposable[0]!.id}`;
      await expect(image(second)).toHaveCount(0);
      expect(await sample(second, runId)).toBeNull();
      await waitForFrame(page, runId);

      await page.getByRole('button', { name: 'Pause', exact: true }).click();
      await page.getByRole('dialog').getByRole('button', { name: 'Pause Run', exact: true }).click();
      release(model);
      await expect.poll(async () => (await sql`SELECT state FROM audit_run WHERE run_id=${runId}`)[0]?.state, { timeout: 60_000 }).toBe('PAUSED');
      await page.reload();
      const controller = page.getByRole('region', { name: 'Run controller', exact: true });
      for (let attempt = 0; attempt < 2 && !(await controller.textContent())?.includes('You control this Run.'); attempt++) {
        const acquire = page.getByRole('button', { name: 'Acquire control', exact: true })
          .and(page.locator(':not([aria-disabled="true"])'));
        await expect(acquire).toBeVisible();
        await acquire.click();
        // A stale post-Pause read can produce a definite epoch refusal. Its refresh
        // exposes the current epoch and leaves Acquire explicitly eligible for one
        // retry; never retry an unknown or still-pending outcome.
        await expect(controller).toHaveAttribute('data-control-ready', 'false');
        await expect(controller).toHaveAttribute('data-control-ready', 'true');
      }
      await expect(controller).toContainText('You control this Run.');
      await page.getByRole('button', { name: 'Resume', exact: true }).and(page.locator(':not([aria-disabled="true"])')).click();
      await page.getByRole('dialog').getByRole('button', { name: 'Resume Run', exact: true }).click();
      // Safe-pause restart may replace the workspace. Allow the real fresh sign-in,
      // while retaining the original revision for explicit rejection below.
      await expect.poll(() => markers.some(row => row.kind === 'model-turn' && !consumed.has(row.id!)) || markers.some(row => row.kind === 'private-input' && !consumed.has(row.id!)), { timeout: 60_000 }).toBe(true);
      const auth = markers.find(row => row.kind === 'private-input' && !consumed.has(row.id!));
      if (auth) { consumed.add(auth.id!); release(auth); }
      model = await nextGate('model-turn');
      await waitForFrame(page, runId, 30_000);
      const resumed = await metadata(runId);
      const store = new PostgresWorkspacePreviewStore(createDb(sql));
      if (resumed?.workspace_id !== owner?.workspace_id) {
        expect(Number(resumed?.workspace_revision)).toBeGreaterThan(Number(owner?.workspace_revision));
        expect(await store.current(pair[0]!.metadata)).toBe(false);
      } else {
        expect(Number(resumed?.revision)).toBeGreaterThan(Number(owner?.revision));
        expect(resumed?.workspace_revision).toBe(owner?.workspace_revision);
        expect(resumed?.runtime_id).toBe(owner?.runtime_id);
      }
      expect((await sample(page, runId))?.metadata.workspaceRevision).toBe(resumed?.workspace_revision);
      await requestStop(page, runId, model);
      await info.attach('compiled-worker-preview.json', { body: Buffer.from(JSON.stringify({ runId, pid: worker.pid,
        firstRuntime: owner?.runtime_id, firstRevision: owner?.workspace_revision, resumedRuntime: resumed?.runtime_id,
        resumedRevision: resumed?.workspace_revision, privateSuppressed: true, distinctSessions: true, samePageSamples: true,
        pausedAndResumed: true, revokedAndDisconnectedCleared: true, terminalRelease: true })), contentType: 'application/json' });
    } finally {
      await secondContext.close();
      const sessions = await sql`SELECT id FROM auth_session`;
      const disposable = sessions.filter(row => !originalSessions.some(old => old.id === row.id));
      for (const session of disposable) await sql`DELETE FROM auth_session WHERE id=${session.id}`;
    }
  });

  test('SIGKILL expires a real worker runtime and a new process cannot revive its missing Page', async ({ page }, info) => {
    const runId = await startPreviewRun(page);
      expect(startedRuns.has(runId)).toBe(false); startedRuns.add(runId);
    await privateProof(page, runId);
    const before = await metadata(runId);
    const oldSample = await sample(page, runId);
    expect(oldSample?.digest).toBeTruthy();
    const pid = worker.pid;
    await shutdown('SIGKILL');
    await expect(image(page)).toHaveCount(0);
    await expect(stage(page)).toContainText(/unavailable|stale/);
    await expect.poll(async () => await sample(page, runId)).toBeNull();
    const store = new PostgresWorkspacePreviewStore(createDb(sql));
    await expect.poll(() => store.current(oldSample!.metadata)).toBe(false);
    await launch();
    expect(worker.pid).not.toBe(pid);
    expect(await store.current(oldSample!.metadata)).toBe(false);
    expect(await sample(page, runId)).toBeNull();
    await info.attach('compiled-worker-loss.json', { body: Buffer.from(JSON.stringify({ runId, killedPid: pid,
      replacementPid: worker.pid, runtimeId: before?.runtime_id, revision: before?.workspace_revision,
      processSignal: 'SIGKILL', expired: true, oldRuntimeRefused: true })), contentType: 'application/json' });
  });
});
