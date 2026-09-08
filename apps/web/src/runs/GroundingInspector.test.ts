import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import {
  WEB_TREE_MEDIA_TYPE,
  utf8Bytes,
  type StoredSnapshot,
} from '@intellifin/domain';
import type { RunObservationRow } from '@intellifin/infrastructure';

import { GroundingInspector } from './EvidenceCards';

const RUN_ID = '01990000-0000-7000-8000-00000000d401';
const SNAPSHOT_ID = '01990000-0000-7000-8000-00000000d402';

const WEB_SNAPSHOT: StoredSnapshot = {
  evidenceId: SNAPSHOT_ID,
  substrate: 'web_tree',
  bytes: utf8Bytes(JSON.stringify({
    schemaVersion: 1,
    nodes: [
      { group: 'record:0', role: 'datum', label: 'Employee ID', value: 'E-001', target: null },
      { group: 'record:0', role: 'datum', label: 'Roles', value: ['<script>close</script>'], target: null },
    ],
  })),
};

function observation(overrides: Partial<RunObservationRow> = {}): RunObservationRow {
  return {
    observationId: '01990000-0000-7000-8000-00000000d403',
    workItemId: '01990000-0000-7000-8000-00000000d404',
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
    attributes: [
      {
        name: 'roles',
        originalValue: ['<script>close</script>'],
        normalizedValue: ['<script>close</script>'],
        grounding: {
          evidenceId: SNAPSHOT_ID,
          locator: '$.nodes[1].value',
          label: 'Roles',
          extractedText: '["<script>close</script>"]',
        },
        corroboration: 'matched',
      },
    ],
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
  snapshot: StoredSnapshot | null = WEB_SNAPSHOT,
): string {
  return renderToStaticMarkup(
    React.createElement(GroundingInspector, {
      observation: row,
      mediaTypeOf: () => WEB_TREE_MEDIA_TYPE,
      snapshotOf: (evidenceId: string) => evidenceId === SNAPSHOT_ID ? snapshot : null,
      snapshotHrefOf: (evidenceId: string, locator: string) =>
        `/runs/${RUN_ID}/evidence/${encodeURIComponent(evidenceId)}?locator=${encodeURIComponent(locator)}`,
    }),
  );
}

describe('GroundingInspector web_tree support', () => {
  it('re-reads a stored web_tree cell, shows match provenance, and links the real artifact path', () => {
    const html = render();
    expect(html).toContain('Match provenance');
    expect(html).toContain('Platform key match');
    expect(html).toContain('Population record key');
    expect(html).toContain('Grounded attributes');
    expect(html).toContain('Snapshot at locator');
    expect(html).toContain('$.nodes[1].value');
    expect(html).toContain('Field label');
    expect(html).toContain(
      `href="/runs/${RUN_ID}/evidence/${SNAPSHOT_ID}?locator=%24.nodes%5B1%5D.value"`,
    );
    expect(html).toContain('Untrusted source content — roles, as read at the stored snapshot locator.');
    // Identity and role each expose original, normalized, label, snapshot value and text.
    expect(html.match(/<pre/g) ?? []).toHaveLength(10);
    expect(html).toContain('&lt;script&gt;close&lt;/script&gt;');
    expect(html).not.toContain('<script>close</script>');
  });

  it('preserves human-selected identity provenance rather than relabelling it as a platform match', () => {
    const html = render(observation({ matchOrigin: 'human-matched' }));
    expect(html).toContain('Human-selected match');
    expect(html).not.toContain('Platform key match');
  });

  it('explains a corroboration contradiction and exposes the re-read label as data', () => {
    const changed: StoredSnapshot = {
      ...WEB_SNAPSHOT,
      bytes: utf8Bytes(JSON.stringify({
        schemaVersion: 1,
        nodes: [
          { group: 'record:0', role: 'datum', label: 'Employee ID', value: 'E-001', target: null },
          { group: 'record:0', role: 'datum', label: 'Access roles', value: ['<script>close</script>'], target: null },
        ],
      })),
    };
    const row = observation({
      corroboration: 'CONTRADICTORY',
      attributes: [{
        ...observation().attributes[0]!,
        corroboration: 'contradictory',
      }],
      checks: [
        { check: 'identity-corroboration', outcome: 'PASS', diagnostic: null },
        { check: 'observation-corroboration', outcome: 'FAIL', diagnostic: 'corroboration-label-drift' },
      ],
    });
    const html = render(row, changed);
    expect(html).toContain('Contradictory');
    expect(html).toContain('The stored snapshot field label differs from the recorded label.');
    expect(html).toContain('Snapshot field label');
    expect(html).toContain('Access roles');
  });

  it('states when the registered web_tree artifact is unavailable', () => {
    const html = render(observation(), null);
    expect(html).toContain('The stored snapshot is unavailable to this page.');
    expect(html).toContain('Structural Snapshot');
    expect(html).not.toContain('Snapshot at locator</dt><dd><div class="ls-untrusted">');
  });
});
