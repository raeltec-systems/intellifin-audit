import { describe, expect, it } from 'vitest';
import { utf8Bytes, WEB_TREE_MEDIA_TYPE } from '@intellifin/domain';
import { AGENT_CAPTURE_EVENT, freezeAgentCapture } from './agent-capture.js';
import { NO_CREDENTIALS } from './credential-guard.js';
import type { AgentWorkContext } from './agent-work-ports.js';
import { PopulationAcquisitionError, type AdapterEvidenceRecord, type BrowserActionArtifact, type EvidenceStore } from './execution-ports.js';

const runId = '01a06fd8-0000-7000-8000-0000000001f1';
const bytes = utf8Bytes('{"schemaVersion":1,"nodes":[]}');
function harness() {
  const rows: AdapterEvidenceRecord[] = [];
  const bindings: unknown[] = [];
  const objects = new Map<string, Uint8Array>();
  const store: EvidenceStore = {
    async putIfAbsent(key, value) { if (!objects.has(key)) objects.set(key, value.slice()); },
    async read(key) { return objects.get(key)?.slice() ?? null; },
  };
  const events: { eventType: string; aggregateId: string; correlationId: string; sessionId: string; payload: Record<string, unknown> }[] = [];
  const notified: number[] = [];
  const context = { evidence: rows,
    run: { runId, correlationId: 'correlation-1f1', sessionId: 'session-1f1', state: 'RUNNING' },
    async saveEvidence(row: AdapterEvidenceRecord) { const i = rows.findIndex(r => r.evidenceId === row.evidenceId); if (i < 0) rows.push(row); else rows[i] = row; },
    async saveCapture(binding: { evidenceId: string }) { expect(rows.find(row => row.evidenceId === binding.evidenceId)?.state).toBe('REGISTERED'); bindings.push(binding); },
    auditEvents: { async append(event: (typeof events)[number]) { events.push(event); return { sequence: events.length }; } },
    async notifyTimeline(sequence: number) { notified.push(sequence); },
  } as unknown as AgentWorkContext;
  const input = { runId, targetSystem: 'loancore', templateId: 'P-1', toolActionId: 'action-1', sourceLocation: 'https://approved.invalid/loancore/users',
    artifacts: [{ kind: 'structural-snapshot' as const, bytes, mediaType: WEB_TREE_MEDIA_TYPE, location: 'https://approved.invalid/loancore/users' }],
    store, guard: NO_CREDENTIALS, budget: () => 1000, now: () => '2026-09-07T00:00:00.000Z',
    commit: async (work: (c: AgentWorkContext) => Promise<void>) => { await work(context); return true; },
  };
  return { input, rows, bindings, objects, events, notified };
}

describe('agent capture through the shared evidence mechanism', () => {
  it('re-reads frozen bytes and binds registered evidence to the actual action', async () => {
    const h = harness(); const result = await freezeAgentCapture(h.input);
    expect(result?.snapshot.bytes).toEqual(bytes);
    expect(result?.snapshot.bytes).not.toBe(bytes);
    expect(result?.screenshotEvidenceId).toBeNull();
    expect(h.rows[0]).toMatchObject({ state: 'REGISTERED', captureMethod: 'agent', captureTimeSource: 'registration' });
    expect(h.bindings).toEqual([{ evidenceId: result!.snapshot.evidenceId, toolActionId: 'action-1', sourceLocation: h.input.sourceLocation }]);
    // Story 5.3: the registration announces itself on the Run's chain, in the same commit,
    // so a Live View following the channel learns of the frame without waiting for the
    // next checkpoint. Ids only: no bytes, no destination, no credential-shaped key.
    expect(h.events).toEqual([expect.objectContaining({
      eventType: AGENT_CAPTURE_EVENT, aggregateId: runId, correlationId: 'correlation-1f1', sessionId: 'session-1f1',
      payload: { toolActionId: 'action-1', targetSystem: 'loancore', structuralSnapshotEvidenceId: result!.snapshot.evidenceId, screenshotEvidenceId: null, registered: 1 },
    })]);
    expect(h.notified).toEqual([1]);
  });
  it('names the registered screenshot as the frame in the capture event', async () => {
    const h = harness();
    const screenshot: BrowserActionArtifact = { kind: 'screenshot', bytes: new Uint8Array([137,80,78,71]), mediaType: 'image/png', location: h.input.sourceLocation };
    const result = await freezeAgentCapture({ ...h.input, artifacts: [...h.input.artifacts, screenshot] });
    expect(result?.screenshotEvidenceId).not.toBeNull();
    expect(h.events).toHaveLength(1);
    expect(h.events[0]?.payload).toMatchObject({ screenshotEvidenceId: result!.screenshotEvidenceId, registered: 2 });
    expect(h.notified).toEqual([1]);
  });
  it('registers the verified snapshot for a typed screenshot transport failure and retains its reservation', async () => {
    const h = harness();
    const screenshot: BrowserActionArtifact = { kind: 'screenshot', bytes: new Uint8Array([137,80,78,71]), mediaType: 'image/png', location: h.input.sourceLocation };
    const put = h.input.store.putIfAbsent;
    h.input.store.putIfAbsent = async (key, value, timeout) => { if (value[0] === 137) throw new PopulationAcquisitionError('transport'); await put(key, value, timeout); };
    const result = await freezeAgentCapture({ ...h.input, artifacts: [screenshot, ...h.input.artifacts] });
    expect(result?.snapshot.bytes).toEqual(bytes); expect(result?.screenshotEvidenceId).toBeNull();
    expect(h.rows.map(row => [row.kind, row.state])).toEqual([['structural-snapshot','REGISTERED'],['screenshot','RESERVED']]);
    expect(h.bindings).toHaveLength(1);
  });
  it.each(['integrity', 'unknown'] as const)('does not downgrade screenshot %s failure into partial success', async mode => {
    const h = harness();
    const screenshot: BrowserActionArtifact = { kind: 'screenshot', bytes: new Uint8Array([137,80,78,71]), mediaType: 'image/png', location: h.input.sourceLocation };
    const put = h.input.store.putIfAbsent, read = h.input.store.read;
    h.input.store.putIfAbsent = async (key, value, timeout) => { if (mode === 'unknown' && value[0] === 137) throw new Error('Unknown screenshot failure'); await put(key, value, timeout); };
    h.input.store.read = async (key, timeout) => { const value = await read(key, timeout); return mode === 'integrity' && value?.[0] === 137 ? new Uint8Array([0]) : value; };
    await expect(freezeAgentCapture({ ...h.input, artifacts: [...h.input.artifacts, screenshot] })).rejects.toThrow();
    expect(h.rows.every(row => row.state === 'RESERVED')).toBe(true); expect(h.bindings).toEqual([]);
  });
  it('retains a reservation and refuses a read-back integrity mismatch', async () => {
    const h = harness(); h.input.store.read = async () => utf8Bytes('different');
    await expect(freezeAgentCapture(h.input)).rejects.toThrow();
    expect(h.rows[0]?.state).toBe('RESERVED'); expect(h.bindings).toEqual([]); expect(h.events).toEqual([]);
  });
  it('refuses secret bytes before storage or registration', async () => {
    const h = harness(); h.input.guard = { held: 1, redact: s => s, discloses: () => true };
    await expect(freezeAgentCapture(h.input)).rejects.toThrow();
    expect(h.objects.size).toBe(0); expect(h.bindings).toEqual([]);
  });
  it('does not downgrade a screenshot credential disclosure into partial success', async () => {
    const h = harness(); h.input.guard = { held: 1, redact: s => s, discloses: value => typeof value !== 'string' && value[0] === 137 };
    const screenshot: BrowserActionArtifact = { kind: 'screenshot', bytes: new Uint8Array([137,80,78,71]), mediaType: 'image/png', location: h.input.sourceLocation };
    await expect(freezeAgentCapture({ ...h.input, artifacts: [...h.input.artifacts, screenshot] })).rejects.toThrow();
    expect(h.bindings).toEqual([]); expect([...h.objects.values()].some(value => value[0] === 137)).toBe(false);
  });
  it('refuses an artifact from a different page before reserving it', async () => {
    const h = harness(); h.input.sourceLocation = 'https://other.invalid';
    await expect(freezeAgentCapture(h.input)).rejects.toThrow();
    expect(h.rows).toEqual([]); expect(h.objects.size).toBe(0);
  });
  it('does no I/O after losing its Run claim', async () => {
    const h = harness(); h.input.commit = async () => false;
    expect(await freezeAgentCapture(h.input)).toBeNull(); expect(h.objects.size).toBe(0);
  });
});
