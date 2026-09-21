import { expect, test as base, type Page } from '@playwright/test';
import type { WorkspacePreviewMetadata } from '@intellifin/application';
import { ACCOUNTS, AUTH_STATE, signIn } from './accounts';
import { createPreviewBrowserFixture, digest, type PreviewBrowserFixture } from '../fixtures/workspace-preview-browser';

interface Display { url: string; at: number; capturedAt: number; width: number; height: number }
interface Probe {
  displays: Display[]; revoked: string[]; holdNextDecode: boolean; waiting: string | null; release: (() => void) | null;
}
declare global { interface Window { __previewProof: Probe } }
interface Delivery { metadata: WorkspacePreviewMetadata; digest: string; receivedAt: number; viewer: string }

/** Instrument the real decoder and rendered stage. Frames and responses stay real.
 * A race test can hold ONE completed decode; it never replaces decoding with success.
 */
async function observeViewer(page: Page) {
  await page.addInitScript(() => {
    const probe: Probe = { displays: [], revoked: [], holdNextDecode: false, waiting: null, release: null };
    window.__previewProof = probe;
    const decode = HTMLImageElement.prototype.decode;
    HTMLImageElement.prototype.decode = async function () {
      await decode.call(this);
      if (probe.holdNextDecode && this.src.startsWith('blob:')) {
        probe.holdNextDecode = false; probe.waiting = this.src;
        await new Promise<void>(resolve => { probe.release = resolve; });
        probe.waiting = null; probe.release = null;
      }
    };
    const revoke = URL.revokeObjectURL.bind(URL);
    URL.revokeObjectURL = value => { probe.revoked.push(value); revoke(value); };
    const seen = new Set<string>();
    const inspect = () => {
      const stage = document.querySelector('[aria-label="Near-live workspace preview"]');
      const image = stage?.querySelector<HTMLImageElement>('img');
      if (!image?.complete || image.naturalWidth === 0 || seen.has(image.src)) return;
      const stamp = stage?.textContent?.match(/Sample started ([^.]+\.\d{3}Z)/)?.[1];
      if (!stamp) return;
      seen.add(image.src);
      probe.displays.push({ url: image.src, at: performance.timeOrigin + performance.now(), capturedAt: Date.parse(stamp),
        width: image.naturalWidth, height: image.naturalHeight });
    };
    new MutationObserver(inspect).observe(document, { subtree: true, childList: true, attributes: true, attributeFilter: ['src'] });
    document.addEventListener('load', inspect, true);
  });
}
function trackDeliveries(page: Page, viewer: string, output: Delivery[]) {
  const pending = new Set<Promise<void>>();
  const failures: unknown[] = [];
  page.on('response', response => {
    if (!response.url().includes('/preview?image=1') || !response.ok()) return;
    const job = response.json().then((body: { metadata?: WorkspacePreviewMetadata; image?: string | null }) => {
      // The response event means headers arrived; delivery age needs the complete body.
      if (body.metadata && body.image) output.push({ metadata: body.metadata, digest: digest(Buffer.from(body.image, 'base64')), receivedAt: Date.now(), viewer });
    }).catch(error => { failures.push(error); });
    pending.add(job); void job.finally(() => pending.delete(job));
  });
  return async () => { await Promise.all(pending); return failures; };
}
const stage = (page: Page) => page.locator('[aria-label="Near-live workspace preview"]');
const visibleFrame = (page: Page) => stage(page).getByAltText('Near-live synthetic workspace sample');
const percentile = (values: number[], fraction: number) => [...values].sort((a, b) => a - b)[Math.max(0, Math.ceil(values.length * fraction) - 1)] ?? null;
const summary = (values: number[]) => ({ count: values.length, p50: percentile(values, .5), p95: percentile(values, .95), max: values.length ? Math.max(...values) : null });

const test = base.extend<{ preview: PreviewBrowserFixture; viewer: Page }>({
  preview: async ({}, use, info) => {
    const fixture = await createPreviewBrowserFixture(ACCOUNTS.auditor.email);
    try { await use(fixture); }
    finally {
      const errors = await fixture.close();
      if (errors.length) {
        await info.attach('preview-cleanup-errors', { body: Buffer.from(JSON.stringify({ count: errors.length,
          errors: errors.map(error => error instanceof Error ? error.name : 'Cleanup failure') })), contentType: 'application/json' });
        if (info.status === 'passed') throw new AggregateError(errors, 'Preview fixture cleanup failed');
      }
    }
  },
  viewer: async ({ browser, preview }, use) => {
    const context = await browser.newContext({ storageState: AUTH_STATE.auditor });
    const page = await context.newPage();
    await observeViewer(page);
    try { await use(page); }
    finally {
      // Always unblock an injected decoder before context teardown, without masking an assertion.
      await page.evaluate(() => window.__previewProof?.release?.()).catch(() => {});
      await context.close().catch(() => {});
    }
    void preview;
  },
});

test.describe('protected preview through compiled adapter, PostgreSQL, broker and web route', () => {
  test.skip(process.env['WORKSPACE_PREVIEW_PROOF'] !== '1', 'Opt in to the isolated loopback browser proof; see p2-preview-handoff.md.');
  test.setTimeout(90_000);

  test('two authenticated sessions see changing samples from one unchanged agent Page, with measured performance', async ({ browser, preview: f, viewer }, info) => {
    const otherContext = await browser.newContext();
    const second = await otherContext.newPage();
    await observeViewer(second);
    const deliveries: Delivery[] = [];
    const flush = [trackDeliveries(viewer, 'first', deliveries), trackDeliveries(second, 'second', deliveries)];
    try {
      await signIn(second, ACCOUNTS.auditor.email);
      const [a, b] = await Promise.all([viewer.context().cookies(), otherContext.cookies()]);
      expect(a.find(cookie => cookie.name.includes('session_token'))?.value).toBeTruthy();
      expect(b.find(cookie => cookie.name.includes('session_token'))?.value).not.toBe(a.find(cookie => cookie.name.includes('session_token'))?.value);
      await Promise.all([viewer.goto(`/runs/${f.runId}/workspace`), second.goto(`/runs/${f.runId}/workspace`)]);
      await Promise.all([expect(visibleFrame(viewer)).toBeVisible(), expect(visibleFrame(second)).toBeVisible()]);
      const start = Date.now();
      // A measured wall-clock window, never synthetic timer advancement or inferred throughput.
      await expect.poll(() => Date.now() - start, { timeout: 17_000, intervals: [500] }).toBeGreaterThanOrEqual(15_000);
      const end = Date.now();
      const displays = await Promise.all([viewer.evaluate(() => window.__previewProof.displays), second.evaluate(() => window.__previewProof.displays)]);
      expect((await Promise.all(flush.map(work => work()))).flat()).toEqual([]);
      const scoped = deliveries.filter(row => row.receivedAt >= start && row.receivedAt <= end);
      const unique = new Map(scoped.map(row => [row.metadata.sequence, row]));
      const frames = [...unique.values()].sort((a, b) => a.metadata.sequence - b.metadata.sequence);
      const captureIntervals = frames.slice(1).map((row, i) => row.metadata.capturedAt! - frames[i]!.metadata.capturedAt!);
      const displayed = displays.map((rows, index) => {
        const byTime = new Map(scoped.filter(row => row.viewer === (index === 0 ? 'first' : 'second')).map(row => [row.metadata.capturedAt, row]));
        const matched = rows.filter(row => row.at >= start && row.at <= end).map(row => ({ row, sample: byTime.get(row.capturedAt) })).filter(value => value.sample !== undefined);
        const distinct = [...new Map(matched.map(value => [value.sample!.metadata.sequence, value])).values()].sort((a, b) => a.row.at - b.row.at);
        return { uniqueSequences: distinct.map(value => value.sample!.metadata.sequence),
          changingPixelDigests: new Set(distinct.map(value => value.sample!.digest)).size,
          observations: distinct.map(value => ({ sequence: value.sample!.metadata.sequence, digest: value.sample!.digest,
            capturedAt: value.sample!.metadata.capturedAt, captureCompletedAt: value.sample!.metadata.captureCompletedAt,
            receivedAt: value.sample!.receivedAt, displayedAt: value.row.at })),
          measuredFramesPerSecond: distinct.length < 2 ? 0 : (distinct.length - 1) * 1000 / (distinct.at(-1)!.row.at - distinct[0]!.row.at),
          captureToDisplayMs: summary(distinct.map(value => value.row.at - value.sample!.metadata.capturedAt!)),
          sampleAgeAtDeliveryMs: summary(distinct.map(value => value.sample!.receivedAt - value.sample!.metadata.capturedAt!)) };
      });
      const report = { scope: 'Compiled production browser adapter/broker and actual web route; no agent worker subprocess or provider/model',
        benchmark: '15 seconds, changing loopback page, two independent authenticated sessions, existing agent viewport',
        windowMs: end - start, runId: f.runId, workspaceId: f.ref.workspaceId, runtimeId: f.runtimeId,
        agentPageCount: f.context.pages().length, agentViewport: f.page.viewportSize(), newPageEvents: f.pageEvents.length,
        viewportMutations: f.viewportChanges.length, uniqueDeliveredSamples: frames.length,
        captureIntervalMs: summary(captureIntervals), captureDurationMs: summary(frames.map(row => row.metadata.captureCompletedAt! - row.metadata.capturedAt!)),
        actualScreenshotDurationMs: summary(f.screenshots.filter(row => row.kind === 'preview' && row.startedAt >= start).map(row => row.completedAt - row.startedAt)), displayed };
      await info.attach('preview-measured-performance.json', { body: Buffer.from(JSON.stringify(report, null, 2)), contentType: 'application/json' });
      expect(f.context.pages()).toEqual([f.page]); expect(f.pageEvents).toEqual([]); expect(f.viewportChanges).toEqual([]);
      expect(f.page.viewportSize()).toEqual(f.viewport);
      expect(await f.execution.downloadRecording(f.ref, 1000)).toBeNull(); expect(await f.page.video()).toBeNull();
      const [owner] = await f.sql`SELECT w.run_id,w.workspace_id,w.revision,p.workspace_revision,p.runtime_id FROM run_workspace w JOIN run_workspace_preview p USING(run_id) WHERE w.run_id=${f.runId}`;
      expect(owner).toMatchObject({ run_id: f.runId, workspace_id: f.ref.workspaceId, revision: 1, workspace_revision: 1, runtime_id: f.runtimeId });
      for (const row of scoped) {
        expect(row.metadata).toMatchObject({ runId: f.runId, runtimeId: f.runtimeId, workspaceRevision: 1, mode: 'public' });
        expect(f.screenshots.some(capture => capture.kind === 'preview' && capture.page === f.page && capture.digest === row.digest)).toBe(true);
      }
      const common = [...unique.keys()].filter(sequence => new Set(scoped.filter(row => row.metadata.sequence === sequence).map(row => row.viewer)).size === 2);
      expect(common.length).toBeGreaterThan(0);
      for (const sequence of common) expect(new Set(scoped.filter(row => row.metadata.sequence === sequence).map(row => row.digest)).size).toBe(1);
      expect(frames.length).toBeGreaterThan(5); expect(captureIntervals.every(value => value >= 990)).toBe(true);
      for (const rows of displays) for (const row of rows) expect({ width: row.width, height: row.height }).toEqual(f.viewport);
      expect(await f.sql`SELECT evidence_id FROM run_evidence WHERE run_id=${f.runId}`).toHaveLength(0);
      // Deliberately retain the normative gate: report misses, never relax it to the observed rate.
      for (const metrics of displayed) {
        expect.soft(metrics.changingPixelDigests).toBeGreaterThan(5);
        expect.soft(metrics.measuredFramesPerSecond, 'At least one unique displayed frame per second').toBeGreaterThanOrEqual(1);
        expect.soft(metrics.captureToDisplayMs.p95, 'p95 capture-to-display must be below 2 seconds').toBeLessThan(2000);
      }
    } finally { await otherContext.close().catch(() => {}); }
  });

  for (const kind of ['preview', 'registered'] as const) {
    test(`stored sign-in drains a real crossing ${kind} screenshot before credential entry`, async ({ preview: f, viewer }) => {
      await viewer.goto(`/runs/${f.runId}/workspace`);
      await expect(visibleFrame(viewer)).toBeVisible();
      const before = await f.metadata(), gate = f.holdScreenshot(kind), loginGate = f.holdSignIn();
      const capture = kind === 'registered' ? f.captureRegistered().then(value => ({ ok: true as const, value }), error => ({ ok: false as const, error })) : null;
      const bytes = await gate.arrived.promise;
      expect(bytes.length).toBeGreaterThan(100);
      const signInResult = f.signIn().then(value => ({ ok: true as const, value }), error => ({ ok: false as const, error }));
      await expect.poll(async () => (await f.metadata()).mode, { timeout: 1000, intervals: [10] }).toBe('private');
      expect(f.successfulPosts()).toBe(0);
      expect(f.page.url()).toBe(`${f.origin}/public`);
      const withdrawn = await viewer.request.get(`/api/runs/${f.runId}/preview?image=1`);
      const body: { image?: string | null; metadata?: WorkspacePreviewMetadata } = await withdrawn.json();
      expect(body.image ?? null).toBeNull();
      gate.release.resolve();
      if (capture) expect(await capture).toMatchObject({ ok: false });
      await loginGate.arrived;
      expect(f.successfulPosts()).toBe(1);
      await expect(visibleFrame(viewer)).toHaveCount(0);
      const during = f.screenshots.length;
      const privateRead = await viewer.request.get(`/api/runs/${f.runId}/preview?image=1`);
      expect((await privateRead.json()).image ?? null).toBeNull();
      expect(f.screenshots.length).toBe(during);
      expect(bytes.every(value => value === 0)).toBe(true);
      loginGate.release();
      const result = await signInResult;
      expect(result).toMatchObject({ ok: true, value: { session: true, artifacts: [] } });
      expect(f.page.url()).toBe(`${f.origin}/account`);
      await expect(f.page.getByRole('status', { name: 'Current signed-in account' })).toHaveText('Signed in as audit.readonly');
      expect((await f.metadata()).privacyEpoch).toBeGreaterThan(before.privacyEpoch);
      await expect(visibleFrame(viewer)).toBeVisible();
      expect(f.context.pages()).toEqual([f.page]); expect(f.pageEvents).toEqual([]); expect(f.viewportChanges).toEqual([]);
      // A later ordinary action still produces real capture artifacts; preview did not consume its capability.
      const registered = await f.captureRegistered();
      expect(registered.artifacts?.map(artifact => artifact.kind)).toEqual(expect.arrayContaining(['screenshot', 'structural-snapshot']));
    });
  }

  for (const transition of ['private', 'role', 'session', 'runtime', 'worker-loss'] as const) {
    test(`a real decoded image cannot enter the stage after ${transition} changes`, async ({ preview: f, viewer }) => {
      // Expired sessions may be deleted by auth; preserve shared saved-state sessions.
      if (transition === 'session') {
        await viewer.context().clearCookies();
        await signIn(viewer, ACCOUNTS.auditor.email);
      }
      await viewer.goto(`/runs/${f.runId}/workspace`);
      await expect(visibleFrame(viewer)).toBeVisible();
      await viewer.evaluate(() => { window.__previewProof.holdNextDecode = true; });
      await viewer.waitForFunction(() => window.__previewProof.waiting !== null);
      const heldUrl = await viewer.evaluate(() => window.__previewProof.waiting!);
      let login: Promise<unknown> | null = null;
      if (transition === 'private') {
        f.holdSignIn(); login = f.signIn().catch(error => error);
        await expect.poll(async () => (await f.metadata()).mode, { timeout: 700, intervals: [10] }).toBe('private');
      } else if (transition === 'role') await f.revokeRole();
      else if (transition === 'session') await f.expireNewSession();
      else if (transition === 'runtime') {
        const nextRuntime = await f.replaceRuntime();
        expect((await f.metadata()).runtimeId).toBe(nextRuntime);
      } else await f.expireRuntime();
      await viewer.evaluate(() => window.__previewProof.release?.());
      await expect.poll(() => viewer.evaluate(url => window.__previewProof.revoked.includes(url), heldUrl)).toBe(true);
      await expect(visibleFrame(viewer)).toHaveCount(0);
      expect(await viewer.evaluate(url => window.__previewProof.displays.some(row => row.url === url), heldUrl)).toBe(false);
      const response = await viewer.request.get(`/api/runs/${f.runId}/preview?image=1`, { maxRedirects: 0 });
      if (response.ok()) expect((await response.json()).image ?? null).toBeNull();
      // Login's held response is released by fixture cleanup; its rejection is observed above.
      void login;
    });
  }

  for (const transition of ['terminal', 'release'] as const) {
    test(`${transition} withdraws the visible preview and stops actual screenshots`, async ({ preview: f, viewer }) => {
      await viewer.goto(`/runs/${f.runId}/workspace`);
      await expect(visibleFrame(viewer)).toBeVisible();
      if (transition === 'terminal') {
        await f.cancelAtWorkerBoundary();
        expect(await f.sql`SELECT outcome,sealed FROM run_result WHERE run_id=${f.runId}`).toEqual([{ outcome: 'CANCELED', sealed: true }]);
      }
      else await f.execution.release(f.ref, 5000);
      await expect(visibleFrame(viewer)).toHaveCount(0);
      await expect(stage(viewer)).toContainText(/unavailable|stale/);
      const response = await viewer.request.get(`/api/runs/${f.runId}/preview?image=1`);
      expect(response.ok()).toBe(false);
      await expect.poll(() => f.page.isClosed()).toBe(true);
      const count = f.screenshots.length, observedAt = Date.now();
      await expect.poll(() => Date.now() - observedAt, { timeout: 3500, intervals: [100] }).toBeGreaterThan(2200);
      expect(f.screenshots).toHaveLength(count);
      await expect(viewer.getByText('Registered action-linked capture', { exact: false })).toBeVisible();
    });
  }
});
