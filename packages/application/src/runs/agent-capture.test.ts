import { describe, expect, it } from 'vitest';
import { utf8Bytes, WEB_TREE_MEDIA_TYPE } from '@intellifin/domain';
import { freezeAgentCapture } from './agent-capture.js';
import { NO_CREDENTIALS } from './credential-guard.js';
import type { AgentWorkContext } from './agent-work-ports.js';
import type { AdapterEvidenceRecord, EvidenceStore } from './execution-ports.js';

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
  const context = { evidence: rows,
    async saveEvidence(row: AdapterEvidenceRecord) { const i = rows.findIndex(r => r.evidenceId === row.evidenceId); if (i < 0) rows.push(row); else rows[i] = row; },
    async saveCapture(binding: unknown) { expect(rows.every(r => r.state === 'REGISTERED')).toBe(true); bindings.push(binding); },
  } as unknown as AgentWorkContext;
  const input = { runId, targetSystem: 'loancore', templateId: 'P-1', toolActionId: 'action-1', sourceLocation: 'https://approved.invalid/loancore/users',
    artifacts: [{ kind: 'structural-snapshot' as const, bytes, mediaType: WEB_TREE_MEDIA_TYPE, location: 'https://approved.invalid/loancore/users' }],
    store, guard: NO_CREDENTIALS, budget: () => 1000, now: () => '2026-09-07T00:00:00.000Z',
    commit: async (work: (c: AgentWorkContext) => Promise<void>) => { await work(context); return true; },
  };
  return { input, rows, bindings, objects };
}

describe('agent capture through the shared evidence mechanism', () => {
  it('re-reads frozen bytes and binds registered evidence to the actual action', async () => {
    const h = harness(); const result = await freezeAgentCapture(h.input);
    expect(result?.snapshot.bytes).toEqual(bytes);
    expect(result?.snapshot.bytes).not.toBe(bytes);
    expect(result?.screenshotEvidenceId).toBeNull();
    expect(h.rows[0]).toMatchObject({ state: 'REGISTERED', captureMethod: 'agent', captureTimeSource: 'registration' });
    expect(h.bindings).toEqual([{ evidenceId: result!.snapshot.evidenceId, toolActionId: 'action-1', sourceLocation: h.input.sourceLocation }]);
  });
  it('retains a reservation and refuses a read-back integrity mismatch', async () => {
    const h = harness(); h.input.store.read = async () => utf8Bytes('different');
    await expect(freezeAgentCapture(h.input)).rejects.toThrow();
    expect(h.rows[0]?.state).toBe('RESERVED'); expect(h.bindings).toEqual([]);
  });
  it('refuses secret bytes before storage or registration', async () => {
    const h = harness(); h.input.guard = { held: 1, redact: s => s, discloses: () => true };
    await expect(freezeAgentCapture(h.input)).rejects.toThrow();
    expect(h.objects.size).toBe(0); expect(h.bindings).toEqual([]);
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
