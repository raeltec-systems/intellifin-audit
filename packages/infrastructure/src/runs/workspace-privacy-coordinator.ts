/**
 * Process-local coordination for the ONE Page owned by a LiveWorkspace.
 *
 * This is neither viewer authorization nor an authentication lease. The adapter must
 * prove recording is disabled and the page is safe before public admission/capture;
 * the broker must check current durable ownership and actor/session authority on every
 * delivery/input. No browser handle, URL, credentials or persistence belongs here.
 *
 * Every callback MUST remain pending until all underlying browser I/O has settled.
 * Racing a Playwright promise against a timeout and returning early breaks draining.
 * AbortSignal is advisory: a timeout fences the workspace and requires its disposal,
 * never claims that browser work stopped. Stored sign-in enters the private path at
 * dispatch, outside runAction, to avoid waiting for its own public action to drain.
 */

export interface WorkspaceRuntimeIdentity {
  readonly runId: string;
  readonly workspaceId: string;
  readonly workspaceRevision: number;
  readonly runtimeId: string;
}

export interface WorkspacePrivacyFence extends WorkspaceRuntimeIdentity {
  readonly privacyEpoch: number;
}

export type WorkspacePrivacyMode =
  | 'unavailable' | 'public' | 'private-draining' | 'private'
  | 'blocked' | 'private-blocked' | 'closed';

const PRIVATE_TOKEN = Symbol('workspace-private-token');

/** Opaque, process-local capability; not serializable broker authorization. */
export interface WorkspacePrivateToken {
  readonly fence: WorkspacePrivacyFence;
  readonly [PRIVATE_TOKEN]: true;
}

export interface WorkspacePreviewFrame {
  readonly fence: WorkspacePrivacyFence;
  readonly sequence: number;
  readonly captureStartedAt: number;
  readonly captureCompletedAt: number;
  /** Caller owns this transient copy. Never write it to evidence, jobs or logs. */
  readonly bytes: Uint8Array;
}

export class WorkspaceCoordinationError extends Error {
  constructor(readonly code: 'unavailable' | 'busy' | 'fenced' | 'drain-timeout') {
    super(`Workspace coordination refused: ${code}`);
    this.name = 'WorkspaceCoordinationError';
  }
}

interface ActiveOperation {
  readonly abort: AbortController;
  readonly settled: Promise<void>;
}

interface BufferedFrame extends WorkspacePreviewFrame {
  readonly startedMonotonic: number;
}

type PreviewOutcome = 'published' | 'unavailable' | 'busy' | 'throttled' | 'discarded' | 'oversized';

export class WorkspacePrivacyCoordinator {
  private readonly identity: WorkspaceRuntimeIdentity;
  private readonly intervalMs: number;
  private readonly drainTimeoutMs: number;
  private readonly maxFrameBytes: number;
  private readonly maxFrameAgeMs: number;
  private readonly monotonic: () => number;
  private readonly wallTime: () => number;
  private mode: WorkspacePrivacyMode = 'unavailable';
  private epoch = 0;
  private sequence = 0;
  private active: ActiveOperation | null = null;
  private actionReserved = false;
  private privateToken: WorkspacePrivateToken | null = null;
  private latest: BufferedFrame | null = null;
  private lastCaptureStarted = -Infinity;

  constructor(identity: WorkspaceRuntimeIdentity, options: {
    readonly intervalMs?: number;
    readonly drainTimeoutMs?: number;
    readonly maxFrameBytes?: number;
    readonly maxFrameAgeMs?: number;
    readonly monotonic?: () => number;
    readonly wallTime?: () => number;
  } = {}) {
    for (const value of [identity.runId, identity.workspaceId, identity.runtimeId]) {
      if (typeof value !== 'string' || value.length === 0 || value.length > 128) {
        throw new TypeError('Invalid workspace runtime identity');
      }
    }
    if (!Number.isSafeInteger(identity.workspaceRevision) || identity.workspaceRevision < 0) {
      throw new TypeError('Invalid workspace revision');
    }
    this.identity = Object.freeze({
      runId: identity.runId, workspaceId: identity.workspaceId,
      workspaceRevision: identity.workspaceRevision, runtimeId: identity.runtimeId,
    });
    this.intervalMs = bounded(options.intervalMs ?? 1_000, 1_000, 60_000);
    this.drainTimeoutMs = bounded(options.drainTimeoutMs ?? 10_000, 1, 30_000);
    this.maxFrameBytes = bounded(options.maxFrameBytes ?? 512 * 1024, 1, 8 * 1024 * 1024);
    this.maxFrameAgeMs = bounded(options.maxFrameAgeMs ?? 3_000, 1, 60_000);
    this.monotonic = options.monotonic ?? (() => performance.now());
    this.wallTime = options.wallTime ?? Date.now;
  }

  status(): { readonly mode: WorkspacePrivacyMode; readonly fence: WorkspacePrivacyFence } {
    return Object.freeze({ mode: this.mode, fence: this.fence() });
  }

  /** Initial admission only, after external capability and safe-page checks. */
  admitPublic(expected: WorkspacePrivacyFence): WorkspacePrivacyFence {
    this.assertFence(expected);
    if (this.mode !== 'unavailable') throw new WorkspaceCoordinationError('unavailable');
    this.advance('public');
    return this.fence();
  }

  /**
   * Ordinary actions have priority over preview. Only one action can reserve admission.
   * Include its registered captures in work. The optional discard hook clears artifacts
   * returned after fencing; nothing from an invalidated action is returned to its caller.
   */
  async runAction<T>(
    expected: WorkspacePrivacyFence,
    work: (signal: AbortSignal) => Promise<T>,
    discard?: (value: T) => void,
  ): Promise<T> {
    this.assertPublic(expected);
    if (this.actionReserved) throw new WorkspaceCoordinationError('busy');
    this.actionReserved = true;
    try {
      await this.drain(expected, false);
      this.assertPublic(expected);
      return await this.perform(expected, 'public', work, discard);
    } finally {
      this.actionReserved = false;
    }
  }

  /**
   * One transient sample, with no queue. The callback transfers byte ownership here;
   * its bytes are zeroed after copying or rejection. Validate page state in the callback
   * before screenshotting; this coordinator cannot recognize credential-bearing pixels.
   */
  async capturePreview(
    expected: WorkspacePrivacyFence,
    capture: (signal: AbortSignal) => Promise<Uint8Array>,
  ): Promise<PreviewOutcome> {
    if (!this.isPublic(expected)) return 'unavailable';
    if (this.active !== null || this.actionReserved) return 'busy';
    const startedMonotonic = this.monotonic();
    if (startedMonotonic - this.lastCaptureStarted < this.intervalMs) return 'throttled';
    this.lastCaptureStarted = startedMonotonic;
    const captureStartedAt = this.wallTime();
    let bytes: Uint8Array;
    try {
      bytes = await this.perform(expected, 'public', capture, (value) => value.fill(0));
    } catch (error) {
      if (error instanceof WorkspaceCoordinationError && error.code === 'fenced') return 'discarded';
      throw error;
    }
    try {
      // No await between this check, copy and publication: private entry cannot interleave.
      if (!this.isPublic(expected)
        || this.monotonic() - startedMonotonic > this.maxFrameAgeMs) return 'discarded';
      if (bytes.byteLength === 0 || bytes.byteLength > this.maxFrameBytes) return 'oversized';
      this.clearFrame();
      this.latest = {
        fence: this.fence(), sequence: ++this.sequence, captureStartedAt,
        captureCompletedAt: this.wallTime(), startedMonotonic, bytes: new Uint8Array(bytes),
      };
      return 'published';
    } finally {
      bytes.fill(0);
    }
  }

  /**
   * Synchronous publication fence. Reauthorize before calling, then apply another fence
   * at transport write and client decode; a copy legitimately delivered cannot be erased.
   */
  readLatest(expected: WorkspacePrivacyFence): WorkspacePreviewFrame | null {
    if (!this.isPublic(expected) || this.latest === null) return null;
    if (this.monotonic() - this.latest.startedMonotonic > this.maxFrameAgeMs) {
      this.clearFrame();
      return null;
    }
    const { startedMonotonic: _ignored, bytes, ...metadata } = this.latest;
    return { ...metadata, bytes: new Uint8Array(bytes) };
  }

  /** Epoch/buffer invalidation happens synchronously, before the first await. */
  async beginPrivate(expected: WorkspacePrivacyFence): Promise<WorkspacePrivateToken> {
    this.assertFence(expected);
    if (this.mode !== 'public' && this.mode !== 'unavailable') {
      throw new WorkspaceCoordinationError('unavailable');
    }
    this.advance('private-draining');
    const privateFence = this.fence();
    await this.drain(privateFence, true);
    this.assertFence(privateFence);
    if (this.status().mode !== 'private-draining') throw new WorkspaceCoordinationError('fenced');
    this.mode = 'private';
    const token: WorkspacePrivateToken = Object.freeze({ fence: privateFence, [PRIVATE_TOKEN]: true as const });
    this.privateToken = token;
    return token;
  }

  /** External broker checks current actor/session lease BEFORE entering this method. */
  async runPrivate<T>(
    token: WorkspacePrivateToken,
    work: (signal: AbortSignal) => Promise<T>,
    discard?: (value: T) => void,
  ): Promise<T> {
    this.assertPrivate(token);
    if (this.active !== null) throw new WorkspaceCoordinationError('busy');
    return this.perform(token.fence, 'private', work, discard);
  }

  /**
   * Caller closes input first. Verify destination, expected identity, read-only rights
   * and cleared sensitive buffers inside this exclusive callback. Failure stays private.
   */
  async handback(
    token: WorkspacePrivateToken,
    verify: (signal: AbortSignal) => Promise<boolean>,
  ): Promise<WorkspacePrivacyFence | null> {
    this.assertPrivate(token);
    let publicFence: WorkspacePrivacyFence | null = null;
    await this.perform(token.fence, 'private', verify, undefined, (verified) => {
      // Transition before releasing the exclusive operation slot: another private
      // input cannot slip between successful verification and public admission.
      if (verified === true) {
        this.advance('public');
        publicFence = this.fence();
      }
    });
    return publicFence;
  }

  /** Expired/disconnected/revoked human input cannot reopen this workspace. */
  revokePrivate(token: WorkspacePrivateToken): void {
    this.assertPrivate(token);
    this.advance('private-blocked');
  }

  /** Fence immediately; the owner still has to discard/close its actual Page. */
  close(): void {
    if (this.mode !== 'closed') this.advance('closed');
  }

  private fence(): WorkspacePrivacyFence {
    return Object.freeze({ ...this.identity, privacyEpoch: this.epoch });
  }

  private matches(expected: WorkspacePrivacyFence): boolean {
    return expected.runId === this.identity.runId
      && expected.workspaceId === this.identity.workspaceId
      && expected.workspaceRevision === this.identity.workspaceRevision
      && expected.runtimeId === this.identity.runtimeId
      && expected.privacyEpoch === this.epoch;
  }

  private assertFence(expected: WorkspacePrivacyFence): void {
    if (!this.matches(expected)) throw new WorkspaceCoordinationError('fenced');
  }

  private isPublic(expected: WorkspacePrivacyFence): boolean {
    return this.mode === 'public' && this.matches(expected);
  }

  private assertPublic(expected: WorkspacePrivacyFence): void {
    this.assertFence(expected);
    if (this.mode !== 'public') throw new WorkspaceCoordinationError('unavailable');
  }

  private assertPrivate(token: WorkspacePrivateToken): void {
    if (this.mode !== 'private' || this.privateToken !== token || !this.matches(token.fence)) {
      throw new WorkspaceCoordinationError('fenced');
    }
  }

  private advance(mode: WorkspacePrivacyMode): void {
    this.mode = mode;
    this.epoch += 1;
    this.privateToken = null;
    this.clearFrame();
    this.active?.abort.abort();
  }

  private clearFrame(): void {
    this.latest?.bytes.fill(0);
    this.latest = null;
  }

  private async drain(expected: WorkspacePrivacyFence, privateBoundary: boolean): Promise<void> {
    const active = this.active;
    if (active === null) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        active.settled,
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(() => {
            if (this.matches(expected)) this.advance(privateBoundary ? 'private-blocked' : 'blocked');
            reject(new WorkspaceCoordinationError('drain-timeout'));
          }, this.drainTimeoutMs);
        }),
      ]);
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  }

  private async perform<T>(
    expected: WorkspacePrivacyFence,
    allowedMode: 'public' | 'private',
    work: (signal: AbortSignal) => Promise<T>,
    discard?: (value: T) => void,
    accept?: (value: T) => void,
  ): Promise<T> {
    if (this.active !== null) throw new WorkspaceCoordinationError('busy');
    const abort = new AbortController();
    const result = Promise.resolve().then(async () => {
      if (!this.matches(expected) || this.mode !== allowedMode) throw new WorkspaceCoordinationError('fenced');
      const value = await work(abort.signal);
      if (!this.matches(expected) || this.mode !== allowedMode) {
        discard?.(value);
        throw new WorkspaceCoordinationError('fenced');
      }
      accept?.(value);
      return value;
    });
    // Observe failures even when a drain timeout makes the caller stop awaiting this work.
    const operation: ActiveOperation = { abort, settled: result.then(() => {}, () => {}) };
    this.active = operation;
    try {
      return await result;
    } finally {
      if (this.active === operation) this.active = null;
    }
  }
}

function bounded(value: number, min: number, max: number): number {
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new TypeError('Invalid workspace coordination limit');
  }
  return value;
}
