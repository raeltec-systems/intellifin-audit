import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { RunEvidenceItem, RunObservationRow } from '@intellifin/infrastructure';

const calls = vi.hoisted(() => ({
  openRun: vi.fn(), runtime: vi.fn(), evidence: vi.fn(), observations: vi.fn(),
  evidenceByIds: vi.fn(), observationsByIds: vi.fn(),
}));
vi.mock('@intellifin/infrastructure', () => ({
  DrizzleRunDetailRepository: class {
    readEvidenceItems = calls.evidence;
    readObservations = calls.observations;
    readEvidenceItemsByIds = calls.evidenceByIds;
    readObservationsByIds = calls.observationsByIds;
  },
  PostgresPopulationRepository: class { readPopulation = async () => null; },
  PostgresSealedPackageRepository: class { readSealedPackage = async () => null; },
}));
vi.mock('../../../../../../src/bootstrap', () => ({ getRuntime: calls.runtime }));
vi.mock('../../../../../../src/runs/detail', () => ({
  openRun: calls.openRun,
  RunDenied: () => React.createElement('p', null, 'Run denied'),
  RunDetailFrame: ({ children }: { children: React.ReactNode }) => React.createElement(React.Fragment, null, children),
}));

import Page from './page';

const RUN = '01990000-0000-7000-8000-00000000d401';
const SNAPSHOT = '01990000-0000-7000-8000-00000000d402';
const OBSERVATION = '01990000-0000-7000-8000-00000000d403';
const PREFIX_EVIDENCE = '01990000-0000-7000-8000-00000000d404';
const PREFIX_OBSERVATION = '01990000-0000-7000-8000-00000000d405';

function evidence(evidenceId: string): RunEvidenceItem {
  return { evidenceId, kind: 'structural-snapshot', registrationId: 'loancore',
    objectKey: `runs/${RUN}/${evidenceId}`, mediaType: 'application/vnd.intellifin.web-tree+json',
    digest: 'a'.repeat(64), size: 123, state: 'REGISTERED', required: true,
    stepId: null, displayName: null, workItemId: null,
    capturedAt: '2026-09-06T09:02:00.000Z', captureMethod: 'agent', captureTimeSource: 'registration' };
}
function observation(observationId: string, evidenceIds: readonly string[] = [SNAPSHOT]): RunObservationRow {
  return { observationId, workItemId: '01990000-0000-7000-8000-00000000d406',
    populationRecordKey: observationId === OBSERVATION ? 'E-099' : 'E-001', targetSystem: 'loancore',
    found: 'true', coverage: 'COVERED', corroboration: 'MATCHED',
    observedAt: '2026-09-06T09:02:00.000Z', observedAtSource: '2026-09-06T09:02:00Z',
    captureMethod: 'agent', matchOrigin: 'human-matched', digest: 'b'.repeat(64),
    identity: { name: 'employee_id', originalValue: 'E-099', normalizedValue: 'E-099',
      grounding: { evidenceId: SNAPSHOT, locator: '$.nodes[0].value', label: 'Employee ID', extractedText: 'E-099' },
      corroboration: 'matched' }, attributes: [], evidenceIds, checks: [] };
}
async function render(query: { evidence?: string | string[]; observation?: string | string[] } = {}): Promise<string> {
  return renderToStaticMarkup(await Page({ params: Promise.resolve({ id: RUN }), searchParams: Promise.resolve(query) }));
}

beforeEach(() => {
  vi.resetAllMocks();
  calls.openRun.mockResolvedValue({ allowed: true, run: { runId: RUN, state: 'COMPLETED' }, readAt: new Date() });
  calls.runtime.mockResolvedValue({ db: {} });
  calls.evidence.mockResolvedValue([evidence(PREFIX_EVIDENCE)]);
  calls.observations.mockResolvedValue({ total: 100, rows: [observation(PREFIX_OBSERVATION, [PREFIX_EVIDENCE])] });
  calls.evidenceByIds.mockResolvedValue([]);
  calls.observationsByIds.mockResolvedValue([]);
});

describe('exact technical Evidence selections beyond the overview', () => {
  it('renders the selected Observation and its supporting Evidence outside the prefix, retaining the exact total', async () => {
    calls.observationsByIds.mockResolvedValue([observation(OBSERVATION)]);
    calls.evidenceByIds.mockResolvedValue([evidence(SNAPSHOT)]);
    const html = await render({ observation: OBSERVATION });
    expect(calls.observationsByIds).toHaveBeenCalledWith(RUN, [OBSERVATION]);
    expect(calls.evidenceByIds).toHaveBeenCalledWith(RUN, [SNAPSHOT]);
    expect(html).toContain(`id="observation-${OBSERVATION}"`);
    expect(html).toContain(`id="observation-${PREFIX_OBSERVATION}"`);
    expect(html).toContain(`id="evidence-${SNAPSHOT}"`);
    expect(html).toContain(`id="evidence-${PREFIX_EVIDENCE}"`);
    // Supporting metadata keeps the exact snapshot locator link inspectable.
    expect(html).toContain(`/runs/${RUN}/evidence/${SNAPSHOT}?locator=`);
    expect(html).toContain('100 Observations');
    expect(html).not.toContain('the first 2 are listed');
  });

  it('resolves an adapter artifact by exact identity even when the overview contains other artifacts', async () => {
    calls.evidenceByIds.mockResolvedValue([evidence(SNAPSHOT)]);
    const html = await render({ evidence: SNAPSHOT });
    expect(calls.evidenceByIds).toHaveBeenCalledWith(RUN, [SNAPSHOT]);
    expect(calls.observationsByIds).not.toHaveBeenCalled();
    expect(html).toContain(`id="evidence-${SNAPSHOT}"`);
    expect(html).toContain(`id="evidence-${PREFIX_EVIDENCE}"`);
  });

  it('deduplicates overview selections and supporting ids, with at most 64 Evidence ids per exact read', async () => {
    const supporting = Array.from({ length: 70 }, (_, index) => `01990000-0000-7000-8000-${String(index).padStart(12, '0')}`);
    calls.observationsByIds.mockResolvedValue([observation(PREFIX_OBSERVATION, [PREFIX_EVIDENCE, ...supporting])]);
    calls.evidenceByIds.mockResolvedValue([evidence(PREFIX_EVIDENCE)]);
    const html = await render({ observation: PREFIX_OBSERVATION, evidence: PREFIX_EVIDENCE });
    expect(calls.evidenceByIds).toHaveBeenCalledWith(RUN, [PREFIX_EVIDENCE, ...supporting.slice(0, 63)]);
    expect(html.split(`id="evidence-${PREFIX_EVIDENCE}"`)).toHaveLength(2);
    expect(html.split(`id="observation-${PREFIX_OBSERVATION}"`)).toHaveLength(2);
    expect(html).toContain('100 Observations');
  });

  it('leaves the overview intact when exact reads find no same-Run selection', async () => {
    const html = await render({ evidence: SNAPSHOT, observation: OBSERVATION });
    expect(calls.observationsByIds).toHaveBeenCalledWith(RUN, [OBSERVATION]);
    expect(calls.evidenceByIds).toHaveBeenCalledWith(RUN, [SNAPSHOT]);
    expect(html).not.toContain(`id="observation-${OBSERVATION}"`);
    expect(html).not.toContain(`id="evidence-${SNAPSHOT}"`);
    expect(html).toContain(`id="observation-${PREFIX_OBSERVATION}"`);
  });

  it('ignores repeated selectors instead of broadening the exact read', async () => {
    await render({ evidence: [SNAPSHOT, PREFIX_EVIDENCE], observation: [OBSERVATION, PREFIX_OBSERVATION] });
    expect(calls.evidenceByIds).not.toHaveBeenCalled();
    expect(calls.observationsByIds).not.toHaveBeenCalled();
  });

  it('authorizes the Run before any overview or exact metadata read', async () => {
    calls.openRun.mockResolvedValue({ allowed: false, reason: 'unauthorized' });
    expect(await render({ evidence: SNAPSHOT, observation: OBSERVATION })).toContain('Run denied');
    expect(calls.runtime).not.toHaveBeenCalled();
    expect(calls.evidence).not.toHaveBeenCalled();
    expect(calls.observations).not.toHaveBeenCalled();
    expect(calls.evidenceByIds).not.toHaveBeenCalled();
    expect(calls.observationsByIds).not.toHaveBeenCalled();
  });
});
