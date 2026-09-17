from pathlib import Path
r = Path('.')
def edit(p,a,b,n=1):
 f=r/p; s=f.read_text(); assert s.count(a)==n,(p,a[:80],s.count(a)); f.write_text(s.replace(a,b))
def write(p,s):
 f=r/p; f.parent.mkdir(parents=True,exist_ok=True); f.write_text(s)
write('packages/domain/src/runs/workspace-reference.ts', '''import type { JsonObject, JsonValue } from '../canonical-json.js';
import { AuditEventValidationError } from '../audit-event.js';

/** Public platform identity only. Never derive a viewer reference from a provider handle. */
export function workspaceReference(runId: string): string {
  return `workspace-${runId}`;
}

const CAPABILITY_KEYS = new Set([
  'workspaceid', 'providersessionid', 'signedsessionid', 'wsendpoint', 'cdpendpoint',
  'observerendpoint', 'controlendpoint', 'streamendpoint', 'replayurl',
]);

/** Append-time policy only: old immutable events must still verify unchanged. */
export function assertNoWorkspaceCapabilities(payload: JsonObject): void {
  const visit = (value: JsonValue): void => {
    if (value === null || typeof value !== 'object') return;
    if (Array.isArray(value)) { for (const item of value) visit(item); return; }
    for (const [key, child] of Object.entries(value)) {
      if (CAPABILITY_KEYS.has(key.toLowerCase().replace(/[^a-z0-9]/g, ''))) {
        throw new AuditEventValidationError('payload', 'workspace connection capabilities are forbidden');
      }
      visit(child);
    }
  };
  visit(payload);
}
''')
edit('packages/domain/src/index.ts',"export * from './runs/web-tree.js';", "export * from './runs/web-tree.js';\nexport * from './runs/workspace-reference.js';")
edit('packages/infrastructure/src/db/audit-events.ts','  ZERO_HASH,','  ZERO_HASH,\n  assertNoWorkspaceCapabilities,')
edit('packages/infrastructure/src/db/audit-events.ts','  validateAuditEventDraft(draft);','  validateAuditEventDraft(draft);\n  assertNoWorkspaceCapabilities(draft.payload);')
p='packages/application/src/runs/provision-workspace.ts'
edit(p,'  workspaceRequirement,','  workspaceRequirement,\n  workspaceReference,')
edit(p,'  readonly workspaceId?: string;','  readonly workspaceReference?: string;')
edit(p,'''      // The provider session identifier, so a provider-side session is correlatable with
      // this Run. Opaque and not a capability — releasing a Solari session still needs the
      // deployment's API key — and the endpoint that WOULD be one is never recorded.
      ...(checkpoint.workspaceId === null ? {} : { workspaceId: checkpoint.workspaceId }),''','''      // Solari signed session IDs are capabilities. Only the platform reference may
      // enter the immutable chain; the provider handle stays on the worker checkpoint.
      workspaceReference: workspaceReference(run.runId),''')
edit(p,''' * Nothing in this file can carry a secret. `WorkspaceRef` holds a Run id, an opaque
 * provider session identifier and the mode; there is no field for an API key, a session
 * token or a wire-protocol endpoint, so no checkpoint, audit payload, Timeline event, log
 * field or error message here has anywhere to pick one up from.''',''' * `WorkspaceRef.workspaceId` is secret operational state: Solari signs session IDs
 * used as connection capabilities. Keep it on the worker checkpoint for reattach and
 * release, never in audit payloads, telemetry, public read models or viewer props.''')
p='packages/application/src/runs/execute-agent-steps.ts'
edit(p,'  workspaceRequirement,','  workspaceRequirement,\n  workspaceReference,')
edit(p,'  readonly workspaceId?: string;','  readonly workspaceReference?: string;')
edit(p,"await event(context, 'agent-execution-started', 'RUNNING', checkpoint, {\n      workspaceId: context.workspace!.workspaceId,", "await event(context, 'agent-execution-started', 'RUNNING', checkpoint, {\n      workspaceReference: workspaceReference(run.runId),")
p='packages/application/src/runs/copy-recording.ts'
edit(p,'  replayRecordingObjectKey,','  replayRecordingObjectKey,\n  workspaceReference,')
edit(p,'''      workspaceId: input.ref.workspaceId,
      state: recording.state,''','''      workspaceReference: workspaceReference(input.run.runId),
      state: recording.state,''')
p='packages/infrastructure/src/runs/run-detail-repository.ts'
edit(p,"import { isObservationAbsenceProof, isObservationQueryKey, isRunResultPublication }", "import { isObservationAbsenceProof, isObservationQueryKey, isRunResultPublication, workspaceReference }")
edit(p,'''        /** The provider's opaque session identity (Story 4.1): correlatable, never a capability. */
        readonly workspaceId: string | null;''','''        /** Public platform reference. Provider handles never leave the worker-side store. */
        readonly reference: string;''')
edit(p,'    const [workspace] = await this.db.select().from(runWorkspace).where(eq(runWorkspace.runId, runId));','''    // Explicit projection: do not even read the provider capability for an auditor surface.
    const [workspace] = await this.db.select({
      status: runWorkspace.status, attempts: runWorkspace.attempts, diagnostic: runWorkspace.diagnostic,
      stepId: runWorkspace.stepId, mode: runWorkspace.mode,
      startedAt: runWorkspace.startedAt, releasedAt: runWorkspace.releasedAt,
    }).from(runWorkspace).where(eq(runWorkspace.runId, runId));''')
edit(p,'            workspaceId: workspace.workspaceId,','            reference: workspaceReference(runId),')
for p in ['apps/web/src/runs/LiveViewer.tsx','apps/web/src/runs/ReplayViewer.tsx','apps/web/app/runs/[id]/live/page.tsx','apps/web/app/runs/[id]/replay/page.tsx']:
 f=r/p; f.write_text(f.read_text().replace('workspaceId','reference'))
for p in ['apps/web/src/runs/LiveViewer.test.ts','apps/web/src/runs/ReplayViewer.test.ts','apps/web/src/runs/RunDetail.test.ts']:
 f=r/p; s=f.read_text().replace('workspaceId:','reference:').replace('reference: null', "reference: 'workspace-test-run'").replace('sess_5f2a','workspace-test-run').replace("reference: 'ws-1'", "reference: 'workspace-test-run'").replace("reference: 'sess_9'", "reference: 'workspace-test-run'"); f.write_text(s)
p='packages/application/src/runs/provision-workspace.test.ts'
edit(p,"diagnostic: 'workspace-created',\n      workspaceId: 'ws-1',", "diagnostic: 'workspace-created',\n      workspaceReference: `workspace-${RUN.runId}`,")
edit(p,"diagnostic: 'workspace-expired',\n      workspaceId: 'ws-1',", "diagnostic: 'workspace-expired',\n      workspaceReference: `workspace-${RUN.runId}`,")
edit('packages/application/src/runs/copy-recording.test.ts',"['diagnostic', 'digest', 'size', 'state', 'workspaceId']", "['diagnostic', 'digest', 'size', 'state', 'workspaceReference']")
p='tests/integration/agent-workspace.test.ts'
edit(p,'  DrizzleRunRepository,','  DrizzleRunRepository,\n  DrizzleRunDetailRepository,\n  PostgresAuditChainReader,')
edit(p,'      workspaceId: stored?.workspace_id,', '      workspaceReference: `workspace-${job.runId}`,')
edit(p,"    expect(await row(job.runId)).toMatchObject({ status: 'RELEASED', workspace_id: workspaceId });\n  });",'''    expect(await row(job.runId)).toMatchObject({ status: 'RELEASED', workspace_id: workspaceId });
    const publicTimeline = await new DrizzleRunDetailRepository(db).readTimeline(job.runId);
    expect(publicTimeline.workspace).toMatchObject({ reference: `workspace-${job.runId}`, status: 'RELEASED' });
    expect(JSON.stringify(publicTimeline)).not.toContain(workspaceId);
    expect(JSON.stringify(await events(job.runId))).not.toContain(workspaceId);
    expect((await new PostgresAuditChainReader(db).verify(job.runId)).valid).toBe(true);
  });''')
write('packages/domain/src/runs/workspace-reference.test.ts', '''import { describe, expect, it } from 'vitest';
import { canonicalizeAuditEvent, createCanonicalAuditEvent } from '../audit-event.js';
import { assertNoWorkspaceCapabilities, workspaceReference } from './workspace-reference.js';

describe('workspace capability containment', () => {
  it('identifies a workspace with platform-owned data only', () => {
    expect(workspaceReference('018f0000-0000-7000-8000-000000000001'))
      .toBe('workspace-018f0000-0000-7000-8000-000000000001');
  });
  it.each(['workspaceId', 'workspace_id', 'providerSessionId', 'signedSessionId', 'wsEndpoint', 'cdpEndpoint', 'observerEndpoint', 'controlEndpoint', 'streamEndpoint', 'replayUrl'])
    ('refuses %s before a new immutable event is appended', key => {
      expect(() => assertNoWorkspaceCapabilities({ nested: [{ [key]: 'synthetic-capability' }] })).toThrow('capabilities are forbidden');
      expect(() => assertNoWorkspaceCapabilities({ workspaceReference: 'workspace-run-1' })).not.toThrow();
    });
  it('does not invalidate canonical bytes of an historical event', () => {
    const event = createCanonicalAuditEvent({
      actor: { type: 'system', id: 'workspace-worker' }, eventType: 'lifecycle.agent-workspace',
      source: 'worker', outcome: 'success', sessionId: 'historical-session', correlationId: 'historical-correlation',
      payload: { workspaceId: 'historical-expired-capability' },
    }, { eventId: '018f0000-0000-7000-8000-000000000001', occurredAt: '2026-09-01T00:00:00.000Z', sequence: 1 });
    expect(canonicalizeAuditEvent(event)).toContain('historical-expired-capability');
    expect(() => assertNoWorkspaceCapabilities(event.payload)).toThrow('capabilities are forbidden');
  });
});
''')
f=r/'CLAUDE.md'; f.write_text('''## 2026-09-17 — Provider workspace handles are capabilities, not display IDs

Solari's browser connection URLs use the signed session ID as their capability. Keep
`WorkspaceRef.workspaceId` only in operational worker state for reattach/release.
Public Timeline reads explicitly exclude that column and expose `workspace-<run-id>`;
Live and Replay receive only that platform reference. New workspace/access/recording
events carry the reference, and the append writer rejects capability-shaped payload
keys. This policy is append-only: canonicalization and historical chain verification
are unchanged. Do not rewrite old immutable events to hide an expired handle. Existing
public event reads project selected fields (the live channel sends sequence numbers),
not arbitrary historical payloads. Never enable a raw provider-control URL as a viewer.

''' + f.read_text())
write('docs/contracts/workspace-capability-v1.md', '''# Workspace capability containment — 17 September 2026

`WorkspaceRef.workspaceId` is sensitive operational state. Solari signed session IDs
in connection URLs are bearer capabilities, not harmless correlation identifiers.
Source: https://docs.getsolari.com/api-reference (Authentication).

The platform reference is `workspace-<run-id>`. It permits correlation within IntelliFin,
not provider access. Public read models must not SELECT the provider handle or serialize
it into HTML, React Server Component payloads, JSON, logs, audit events or exports.

The worker retains the complete provider handle for reattach/release. It is not truncated
or hashed in operational state. The append-time audit writer refuses capability-shaped
payload fields without changing historical canonicalization. Historical events remain
unchanged and private; public readers use explicit safe projections. Operators must
treat existing historical database values as credential material.

A viewer is read-only and server-authorized. It must never receive a provider connection
URL or accept arbitrary browser-control commands. Credential entry is hidden before
transmission, not masked after delivery. Provider recording remains disabled.
''')
