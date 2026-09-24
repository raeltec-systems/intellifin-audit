import type { WorkspacePreviewIdentity, WorkspacePreviewMetadata, WorkspacePreviewMetadataStore, WorkspacePreviewViewer } from '@intellifin/application';
import { WorkspacePrivacyCoordinator, type WorkspacePrivateToken, type WorkspaceRuntimeIdentity } from './workspace-privacy-coordinator.js';

/** One instance and one timer belong to the existing Page, regardless of viewer count. */
export class WorkspacePreviewSession {
  private static active = 0;
  private closed = false;
  readonly coordinator: WorkspacePrivacyCoordinator;
  private readonly viewers = new Map<string, number>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private ticking = false;
  private publishing: Promise<void> = Promise.resolve();
  private sample = { sequence: 0, capturedAt: null as number | null, captureCompletedAt: null as number | null };
  private sampleEpoch = 0;
  private privateToken: WorkspacePrivateToken | null = null;
  constructor(
    readonly identity: WorkspaceRuntimeIdentity,
    private readonly store: WorkspacePreviewMetadataStore,
    private readonly capture: () => Promise<Uint8Array | null>,
    private readonly dispose: () => void,
  ) {
    if (WorkspacePreviewSession.active >= 16) throw new Error('Preview capacity unavailable');
    WorkspacePreviewSession.active++;
    // A two-per-second hard ceiling leaves room for ordinary scheduling jitter.
    // The slower 600 ms sampler avoids landing on the admission threshold itself.
    this.coordinator = new WorkspacePrivacyCoordinator(identity, { intervalMs: 500 });
    this.timer = setInterval(() => { void this.tick().catch(() => this.close()); }, 600);
    this.timer.unref();
  }
  metadata(): WorkspacePreviewMetadata {
    const status = this.coordinator.status();
    if (this.sampleEpoch !== status.fence.privacyEpoch) {
      this.sample = { sequence: 0, capturedAt: null, captureCompletedAt: null }; this.sampleEpoch = status.fence.privacyEpoch;
    }
    return { runId: this.identity.runId, workspaceRevision: this.identity.workspaceRevision, runtimeId: this.identity.runtimeId,
      privacyEpoch: status.fence.privacyEpoch,
      mode: status.mode.startsWith('private') ? 'private' : status.mode === 'public' ? 'public' : status.mode === 'closed' ? 'closed' : 'unavailable',
      ...this.sample, expiresAt: Date.now() + 4000 };
  }
  publish(): Promise<void> {
    const next = this.publishing.then(async () => {
      if (!(await this.store.publish(this.metadata()))) { this.close(); throw new Error('Preview ownership unavailable'); }
    });
    this.publishing = next.catch(() => {});
    return next;
  }
  /** Invalidate synchronously, persist the new epoch, THEN admit private browser input. */
  async enterPrivate(): Promise<WorkspacePrivateToken> {
    if (this.privateToken !== null && this.coordinator.status().mode === 'private') return this.privateToken;
    const entered = this.coordinator.beginPrivate(this.coordinator.status().fence);
    // Observe draining rejection while persistence is pending.
    void entered.catch(() => {});
    try { await this.publish(); this.privateToken = await entered; return this.privateToken; }
    catch (error) { this.close(); throw error; }
  }
  async handback(token: WorkspacePrivateToken, verify: () => Promise<boolean>): Promise<void> {
    const fence = await this.coordinator.handback(token, verify);
    if (fence !== null) this.privateToken = null;
    await this.publish();
  }
  async read(expected: WorkspacePreviewIdentity, viewer: WorkspacePreviewViewer) {
    const key = `${viewer.actorId}:${viewer.sessionId}`, now = Date.now();
    for (const [id, seen] of this.viewers) if (seen + 5000 < now) this.viewers.delete(id);
    if (!this.viewers.has(key) && this.viewers.size >= 8) return null;
    this.viewers.set(key, now);
    const frame = this.coordinator.readLatest({ ...this.identity, privacyEpoch: expected.privacyEpoch });
    if (!frame) return { metadata: this.metadata(), bytes: null };
    if (!(await this.store.current(expected)) || this.coordinator.status().fence.privacyEpoch !== expected.privacyEpoch) {
      frame.bytes.fill(0); return null;
    }
    return { metadata: { ...this.metadata(), sequence: frame.sequence, capturedAt: frame.captureStartedAt, captureCompletedAt: frame.captureCompletedAt }, bytes: frame.bytes };
  }
  private async tick(): Promise<void> {
    if (this.ticking || this.timer === null) return;
    this.ticking = true;
    try {
      const now = Date.now();
      for (const [id, seen] of this.viewers) if (seen + 5000 < now) this.viewers.delete(id);
      await this.publish();
      if (this.viewers.size === 0 || this.coordinator.status().mode !== 'public') return;
      const expected = this.coordinator.status().fence;
      if (!(await this.store.current(expected))) { this.close(); return; }
      let unsafe = false;
      const outcome = await this.coordinator.capturePreview(expected, async () => {
        const bytes = await this.capture();
        if (bytes === null) { unsafe = true; return new Uint8Array(); }
        return bytes;
      });
      if (unsafe) { await this.enterPrivate(); return; }
      if (outcome === 'published') {
        const frame = this.coordinator.readLatest(expected);
        if (frame) {
          this.sampleEpoch = expected.privacyEpoch;
          this.sample = { sequence: frame.sequence, capturedAt: frame.captureStartedAt, captureCompletedAt: frame.captureCompletedAt };
          frame.bytes.fill(0); await this.publish();
        }
      }
    } finally { this.ticking = false; }
  }
  close(): void {
    if (this.closed) return;
    this.closed = true; WorkspacePreviewSession.active--;
    if (this.timer !== null) clearInterval(this.timer);
    this.timer = null; this.viewers.clear(); this.coordinator.close(); this.privateToken = null;
    this.dispose();
  }
}
