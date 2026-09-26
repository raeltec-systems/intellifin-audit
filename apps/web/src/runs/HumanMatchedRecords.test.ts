import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { HumanMatchedRecordRow, RunObservationRow } from '@intellifin/infrastructure';
import { HumanMatchedRecords } from './ResultSections';
import { UNTRUSTED_CONTENT_SENTENCE, MASKED_VALUE } from '../design/copy';
const decision = { waitId: 'wait', answerOptionId: 'candidate-2', answerLabel: 'PRIVATE SECONDARY NAME', actorId: 'auditor', actorName: 'Audit Person', decidedAt: '2026-09-26T12:00:00Z' };
const observation = (target: string): RunObservationRow => ({ observationId: target, targetSystem: target, matchOrigin: 'human-matched', matchingDecision: decision } as RunObservationRow);
const record: HumanMatchedRecordRow = { sourceOrdinal: 700, populationRecordKey: 'key-700', observations: [observation('System A'), observation('System B')] };
describe('Result human matches count source records and retain each target decision', () => {
  it('links the exact source ordinal beyond the Evidence overview and counts one record for two targets', () => {
    const html = renderToStaticMarkup(React.createElement(HumanMatchedRecords, { runId: 'run', records: [record], total: 1, masked: false, systemName: id => id }));
    expect(html).toContain('1 record'); expect(html).not.toContain('2 records');
    expect(html).toContain('/runs/run/evidence?selected=700'); expect(html).toContain('System A'); expect(html).toContain('System B');
    expect(html).toContain('Audit Person'); expect(html).not.toContain('PRIVATE SECONDARY NAME');
    expect(html).toContain(MASKED_VALUE); expect(html).toContain(UNTRUSTED_CONTENT_SENTENCE);
  });
  it('does not disclose a frozen masked key', () => {
    const html = renderToStaticMarkup(React.createElement(HumanMatchedRecords, { runId: 'run', records: [record], total: 1, masked: true, systemName: id => id }));
    expect(html).not.toContain('key-700'); expect(html).toContain('selected=700');
  });
});
