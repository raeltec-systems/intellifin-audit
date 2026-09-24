import { describe, expect, it, vi } from 'vitest';
import type { Transaction } from '../db/client.js';
import { readLockedConversationQuestion } from './run-conversation-question.js';
const options = [{ id: 'retry', label: 'Retry' }];
const row = { revision: 2, wait_id: '01990000-0000-7000-8000-000000000002', kind: 'retry-or-skip',
  opened_at: '2026-09-20T00:00:00.000Z', deadline: '2026-09-20T04:00:00.000Z', options,
  event_id: '01990000-0000-7000-8000-000000000003', payload: { kind: 'retry-or-skip', optionIds: ['retry'],
    deadline: '2026-09-20T04:00:00.000Z', stepId: 'inspect', supportingEvidenceIds: [] },
  work_item_id: '01990000-0000-7000-8000-000000000004', subject_key: 'Record', registration_id: 'target',
  step_id: 'inspect', evidence_id: null, pending_wait: { kind: 'retry-or-skip', options } };
describe('conversation question provenance', () => {
  it('requires exact raised option order and deadline', async () => {
    for (const patch of [{ optionIds: ['other'] }, { optionIds: [null] }, { deadline: null }, { deadline: '2030-01-01T00:00:00.000Z' }]) {
      const tx = { execute: vi.fn().mockResolvedValue([{ ...row, payload: { ...row.payload, ...patch } }]) };
      expect(await readLockedConversationQuestion(tx as unknown as Transaction, 'run')).toBeNull();
    }
  });
  it('refuses malformed source types without throwing', async () => {
    for (const patch of [{ options: [null] }, { payload: null }, { pending_wait: null }, { pending_wait: { kind: row.kind } }, { options: [1] }]) {
      const tx = { execute: vi.fn().mockResolvedValue([{ ...row, ...patch }]) };
      expect(await readLockedConversationQuestion(tx as unknown as Transaction, 'run')).toBeNull();
    }
    const tx = { execute: vi.fn().mockResolvedValueOnce([row]).mockResolvedValueOnce([{ response: null, sequence: 1,
      snapshot_evidence_id: 'evidence', step_execution_id: 'step' }]) };
    expect((await readLockedConversationQuestion(tx as unknown as Transaction, 'run'))?.question).toBe('Retry or skip this inspection?');
  });
});
