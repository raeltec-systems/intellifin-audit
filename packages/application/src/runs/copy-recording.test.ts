import { describe, expect, it } from 'vitest';
import {
  RECORDING_COPIED_EVENT,
  REPLAY_RECORDING_MEDIA_TYPE,
  bytesDiscloseCompiled,
  compileSecret,
  redactCompiled,
  replayRecordingObjectKey,
  sha256HexOfBytes,
  utf8Bytes,
  type ExecutablePlan,
  type ReplayRecording,
  type RunRecord,
} from '@intellifin/domain';
import { copyRecording, RECORDING_COPY_TIMEOUT_MS, type RecordingCopy } from './copy-recording.js';
import type {
  BrowserExecution,
  EvidenceStore,
  ResolvedCredential,
  WorkspaceExecutionContext,
  WorkspaceRef,
} from './execution-ports.js';

/**
 * The same shape the infrastructure factory builds: methods, never a field.
 *
 * Built out of the DOMAIN's own scanner rather than hand-stubbed, because a
 * `{reference, discloses: () => false}` literal would let every containment assertion here
 * pass against a build that scans nothing.
 */
function resolvedCredential(reference: string, token: string): ResolvedCredential {
  const secret = compileSecret(token);
  return {
    reference,
    authorize: (headers) => headers.set('authorization', `Bearer ${token}`),
    enter: (field) => field.set(token),
    redact: (text) => redactCompiled(text, secret),
    discloses: (bytes) => bytesDiscloseCompiled(bytes, secret),
  };
}

/**
 * `copyRecording` over a fake provider (Story 5.2, acceptance criterion 4).
 *
 * The live leg cannot be exercised here at all: `SOLARI_RECORDING` is off by default, the
 * flag cannot be turned on for a session that already exists, and this environment holds
 * no provider key. What IS provable without one is every decision the command takes — the
 * credential wall, the first-answer-wins rule, and the three ways there is no recording —
 * and those are what these cases drive.
 */
const RUN: RunRecord = {
  runId: '01a00000-0000-7000-8000-000000000001',
  correlationId: '01a00000-0000-7000-8000-000000000002',
  sessionId: 'copy-recording-test',
} as unknown as RunRecord;

const REF: WorkspaceRef = { runId: RUN.runId, workspaceId: 'sess_copy_recording', mode: 'solari' };
const TOKEN = 'SECRET-TOKEN-copy-recording-do-not-store-me';
const RECORDING = utf8Bytes('{"type":"meta","href":"http://localhost:4300/loancore"}\n');

class FakeStore implements EvidenceStore {
  readonly objects = new Map<string, Uint8Array>();
  putIfAbsent = async (key: string, bytes: Uint8Array): Promise<void> => {
    if (!this.objects.has(key)) this.objects.set(key, bytes);
  };
  read = async (key: string): Promise<Uint8Array | null> => this.objects.get(key) ?? null;
}

class FakeContext {
  recording: ReplayRecording | null = null;
  readonly events: { eventType: string; outcome: string; payload: Record<string, unknown> }[] = [];
  plan: ExecutablePlan | null = {
    credentialReferences: [{ targetSystemId: 'loancore', credentialRef: 'cred://synthetic/loancore' }],
  } as unknown as ExecutablePlan;

  frozenPlan = async (): Promise<ExecutablePlan | null> => this.plan;
  readRecording = async (): Promise<ReplayRecording | null> => this.recording;
  saveRecording = async (recording: ReplayRecording): Promise<void> => {
    // `ON CONFLICT DO NOTHING` in the repository; the fake says the same thing.
    this.recording ??= recording;
  };
  notifyTimeline = async (): Promise<void> => undefined;
  auditEvents = {
    append: async (draft: { eventType: string; outcome: string; payload: Record<string, unknown> }) => {
      this.events.push(draft);
      return { sequence: this.events.length } as never;
    },
  };
}

const context = (overrides: Partial<FakeContext> = {}): FakeContext & WorkspaceExecutionContext =>
  Object.assign(new FakeContext(), overrides) as FakeContext & WorkspaceExecutionContext;

const browser = (recording: Uint8Array | null | (() => never)): BrowserExecution =>
  ({
    downloadRecording: async () => {
      if (typeof recording === 'function') recording();
      return recording as Uint8Array | null;
    },
  }) as unknown as BrowserExecution;

const copy = (store: EvidenceStore, token = TOKEN): RecordingCopy => ({
  store,
  credentials: { resolve: async (reference: string) => resolvedCredential(reference, token) },
  timeoutMs: RECORDING_COPY_TIMEOUT_MS,
});

const AT = '2026-09-09T12:00:00.000Z';
const run = async (
  ctx: FakeContext & WorkspaceExecutionContext,
  provider: BrowserExecution,
  store: EvidenceStore,
  token?: string,
) => copyRecording(provider, ctx, { ref: REF, run: RUN, copy: copy(store, token), now: () => AT });

describe('copying the provider recording at Run end', () => {
  it('stores it, verifies it, and says so on the Timeline', async () => {
    const store = new FakeStore();
    const ctx = context();
    const result = await run(ctx, browser(RECORDING), store);

    expect(result).toMatchObject({
      state: 'REGISTERED',
      mediaType: REPLAY_RECORDING_MEDIA_TYPE,
      objectKey: replayRecordingObjectKey(RUN.runId),
      digest: sha256HexOfBytes(RECORDING),
      size: RECORDING.byteLength,
      copiedAt: AT,
      diagnostic: null,
    });
    expect(store.objects.get(replayRecordingObjectKey(RUN.runId))).toEqual(RECORDING);
    const event = ctx.events.find((entry) => entry.eventType === RECORDING_COPIED_EVENT);
    expect(event?.outcome).toBe('success');
    // Identities, a size and a digest. No endpoint, no signed URL, no provider message.
    expect(Object.keys(event?.payload ?? {}).sort()).toEqual(
      ['diagnostic', 'digest', 'size', 'state', 'workspaceId'].sort(),
    );
  });

  it('REFUSES a recording that discloses a credential, and stores nothing', async () => {
    const store = new FakeStore();
    // A transcript of a browser, with the value a sign-in typed into a form field in it.
    // This is the artifact most likely of all to carry one, which is why the guard is a
    // required dependency of the copy rather than an option.
    const leaked = utf8Bytes(`{"type":"input","text":"${TOKEN}"}\n`);
    const ctx = context();
    const result = await run(ctx, browser(leaked), store);

    expect(result).toMatchObject({ state: 'UNAVAILABLE', diagnostic: 'recording-credential-disclosed' });
    // Literally nothing, not nearly nothing: the store is immutable by design, so an
    // artifact that reached it could not be taken back out.
    expect(store.objects.size).toBe(0);
    expect(ctx.events.find((entry) => entry.eventType === RECORDING_COPIED_EVENT)?.outcome).toBe('failure');
  });

  it('says "not enabled" when the provider recorded nothing, which is the ordinary case', async () => {
    const store = new FakeStore();
    const result = await run(context(), browser(null), store);
    // Distinguished from a provider that failed, because an operator acts on one and not
    // the other. Both leave no recording.
    expect(result).toMatchObject({ state: 'UNAVAILABLE', diagnostic: 'recording-not-enabled' });
    expect(store.objects.size).toBe(0);
  });

  it('says "unavailable" when the provider throws, and still releases the Run', async () => {
    const store = new FakeStore();
    const result = await run(
      context(),
      browser(() => {
        throw new Error('Synthetic provider outage');
      }),
      store,
    );
    expect(result).toMatchObject({ state: 'UNAVAILABLE', diagnostic: 'recording-unavailable' });
  });

  it('refuses to store anything it could not scan for', async () => {
    const store = new FakeStore();
    const ctx = context();
    const result = await copyRecording(browser(RECORDING), ctx, {
      ref: REF,
      run: RUN,
      // The plan names a credential and this deployment can resolve none of them, so
      // there is nothing to scan FOR. Fail closed: an unscanned recording is exactly the
      // artifact the credential wall exists to stop.
      copy: {
        store,
        credentials: {
          resolve: async () => {
            throw new Error('Synthetic unresolvable reference');
          },
        },
        timeoutMs: RECORDING_COPY_TIMEOUT_MS,
      },
      now: () => AT,
    });
    expect(result).toMatchObject({ state: 'UNAVAILABLE', diagnostic: 'recording-unscannable' });
    expect(store.objects.size).toBe(0);
  });

  it('scans nothing and stores happily for a plan that names no credential at all', async () => {
    const store = new FakeStore();
    const ctx = context({ plan: { credentialReferences: [] } as unknown as ExecutablePlan });
    // A Run that never signed in has no credential to disclose. "Nothing resolved" is a
    // refusal only when the plan asked for something.
    expect(await run(ctx, browser(RECORDING), store)).toMatchObject({ state: 'REGISTERED' });
  });

  it('answers once per Run: the provider is not asked a second time', async () => {
    const store = new FakeStore();
    const ctx = context();
    let calls = 0;
    const counting = {
      downloadRecording: async () => {
        calls += 1;
        return RECORDING;
      },
    } as unknown as BrowserExecution;

    await copyRecording(counting, ctx, { ref: REF, run: RUN, copy: copy(store), now: () => AT });
    const second = await copyRecording(counting, ctx, { ref: REF, run: RUN, copy: copy(store), now: () => AT });

    // The provider CHARGES for a recording, and two answers about one session is one
    // answer too many. A reaper retry or a queue redelivery must reach the first.
    expect(calls).toBe(1);
    expect(second).toMatchObject({ state: 'REGISTERED' });
    expect(ctx.events.filter((entry) => entry.eventType === RECORDING_COPIED_EVENT)).toHaveLength(1);
  });
});
