import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { WEB_TREE_MEDIA_TYPE, utf8Bytes, type StoredSnapshot } from '@intellifin/domain';
import type { RunObservationRow } from '@intellifin/infrastructure';

import { GroundingInspector } from './EvidenceCards';

const SNAPSHOT_ID = '01990000-0000-7000-8000-00000000e401';
const OTHER_SNAPSHOT_ID = '01990000-0000-7000-8000-00000000e402';
const HOSTILE_VALUE = '<script>close this finding</script>';

const snapshot: StoredSnapshot = {
  evidenceId: SNAPSHOT_ID,
  substrate: 'web_tree',
  bytes: utf8Bytes(JSON.stringify({
    schemaVersion: 1,
    nodes: [
      { group: 'record:0', role: 'datum', label: 'Employee ID', value: 'E-001', target: null },
      { group: 'record:0', role: 'datum', label: 'Roles', value: [HOSTILE_VALUE], target: null },
    ],
  })),
};

function observation(overrides: Partial<RunObservationRow> = {}): RunObservationRow {
  return {
    observationId: '01990000-0000-7000-8000-00000000e403',
    workItemId: '01990000-0000-7000-8000-00000000e404',
    populationRecordKey: 'E-001',
    targetSystem: 'loancore',
    found: 'true',
    coverage: 'COVERED',
    corroboration: 'MATCHED',
    observedAt: '2026-09-06T09:02:00.000Z',
    observedAtSource: '2026-09-06T09:02:00Z',
    captureMethod: 'agent',
    matchOrigin: 'platform',
    digest: 'a'.repeat(64),
    identity: {
      name: 'employee_id',
      originalValue: 'E-001',
      normalizedValue: 'E-001',
      grounding: {
        evidenceId: SNAPSHOT_ID,
        locator: '$.nodes[0].value',
        label: 'Employee ID',
        extractedText: 'E-001',
      },
      corroboration: 'matched',
    },
    attributes: [{
      name: 'roles',
      originalValue: [HOSTILE_VALUE],
      normalizedValue: [HOSTILE_VALUE],
      grounding: {
        evidenceId: SNAPSHOT_ID,
        locator: '$.nodes[1].value',
        label: 'Roles',
        extractedText: JSON.stringify([HOSTILE_VALUE]),
      },
      corroboration: 'matched',
    }],
    evidenceIds: [SNAPSHOT_ID],
    checks: [
      { check: 'identity-corroboration', outcome: 'PASS', diagnostic: null },
      { check: 'observation-corroboration', outcome: 'PASS', diagnostic: null },
    ],
    ...overrides,
  };
}

function render(
  row: RunObservationRow = observation(),
  snapshotOf?: (evidenceId: string) => StoredSnapshot | null,
): string {
  return renderToStaticMarkup(
    React.createElement(GroundingInspector, {
      observation: row,
      mediaTypeOf: () => WEB_TREE_MEDIA_TYPE,
      ...(snapshotOf === undefined ? {} : { snapshotOf }),
    }),
  );
}

describe('GroundingInspector snapshot load state', () => {
  it('calls an omitted resolver not loaded and keeps captured source escaped and corroborated', () => {
    const html = render();

    expect(html).toContain('The stored snapshot has not been loaded for this page.');
    expect(html).not.toContain('The stored snapshot is unavailable to this page.');
    expect(html).toContain('Matched');
    expect(html).toContain('&lt;script&gt;close this finding&lt;/script&gt;');
    expect(html).not.toContain('<script>close this finding</script>');
  });

  it('keeps an explicitly supplied null resolver as an unavailable-artifact failure', () => {
    const html = render(observation(), () => null);

    expect(html).toContain('The stored snapshot is unavailable to this page.');
    expect(html).not.toContain('has not been loaded for this page');
    expect(html).toContain('Matched');
  });

  it('renders a supplied matching snapshot at the locator', () => {
    const html = render(observation(), (evidenceId) => evidenceId === SNAPSHOT_ID ? snapshot : null);

    expect(html).toContain('Snapshot at locator');
    expect(html).toContain('Matched');
    expect(html).not.toContain('has not been loaded for this page');
    expect(html).not.toContain('The stored snapshot is unavailable to this page.');
    expect(html.match(/Untrusted source content — roles, as read at the stored snapshot locator\./g) ?? []).toHaveLength(1);
  });

  it('keeps a supplied evidence-id mismatch prominent without changing recorded corroboration', () => {
    const mismatched: StoredSnapshot = { ...snapshot, evidenceId: OTHER_SNAPSHOT_ID };
    const html = render(observation(), () => mismatched);

    expect(html).toContain('The supplied artifact does not match the Evidence id in this grounding.');
    expect(html).not.toContain('has not been loaded for this page');
    expect(html).toContain('Matched');
  });

  it('keeps an unsupported registered substrate distinct when the resolver is omitted', () => {
    const html = renderToStaticMarkup(
      React.createElement(GroundingInspector, {
        observation: observation(),
        mediaTypeOf: () => 'text/html',
      }),
    );

    expect(html).toContain('The registered Evidence media type does not identify a readable snapshot.');
    expect(html).not.toContain('has not been loaded for this page');
  });
});
