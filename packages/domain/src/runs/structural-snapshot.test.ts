import { describe, expect, it } from 'vitest';

import { utf8Bytes } from '../sha256.js';
import {
  observationCorroborationState,
  OBSERVATION_CHECK_DIAGNOSTICS,
  type ObservationAttribute,
  type ObservationRecord,
} from './observation.js';
import {
  corroborateAttribute,
  corroborateObservation,
  IMPLEMENTED_SNAPSHOT_SUBSTRATES,
  parseSnapshotLocator,
  readSnapshotCell,
  readStructuralSnapshot,
  SHEET_COLLECTION,
  SNAPSHOT_CORROBORATION_FAILURES,
  SNAPSHOT_SUBSTRATES,
  snapshotCorroborationDiagnostic,
  snapshotSubstrateForMediaType,
  type ParsedSnapshot,
  type SnapshotCorroborationFailure,
  type SnapshotSubstrate,
} from './structural-snapshot.js';
import {
  isWebTreeDocument,
  parseWebTree,
  readWebTreeCell,
  WEB_TREE_COLLECTION,
  WEB_TREE_LIMITS,
  WEB_TREE_MEDIA_TYPE,
  WEB_TREE_SCHEMA_VERSION,
  WEB_TREE_VALUE_FIELD,
  webTreeValueLocator,
} from './web-tree.js';

/**
 * The extractor's behaviour that a golden vector cannot pin.
 *
 * `tests/unit/snapshot-extraction.test.ts` checks the re-read and the per-attribute
 * verdict against vectors Python produced. What is here instead is everything ABOUT a
 * snapshot rather than inside one: the unimplemented substrates, a snapshot nothing can
 * read, a grounding naming Evidence the caller did not supply, and the record-level rules
 * — the identity that has to re-read to the population record key, and the rollup the
 * database pins.
 */

const EVIDENCE = '01990000-0000-7000-8000-00000000c001';

const ACCOUNTS = JSON.stringify({
  complete: true,
  returned: 2,
  schema: ['account_id', 'roles'],
  accounts: [
    { account_id: 'AG-1001', roles: ['AP_CLERK'] },
    { account_id: '007', roles: ['OPS_CLERK'] },
  ],
});

const SHEET = 'entry,role,permission\n1,AP_CLERK,CREATE_PAYMENT\n2,LOAN_VIEWER,VIEW_LOAN\n';

const WEB_TREE = JSON.stringify({
  schemaVersion: WEB_TREE_SCHEMA_VERSION,
  nodes: [
    { group: 'record:0', role: 'datum', label: 'Employee ID', value: 'E-000105', target: null },
    { group: 'record:0', role: 'datum', label: 'Full name', value: 'Esther Kabwe', target: null },
    { group: 'record:0', role: 'status', label: 'Status', value: 'Disabled', target: null },
    { group: 'page', role: 'input', label: 'Username', value: 'e.kabwe', target: 'username' },
    { group: 'record:0', role: 'datum', label: 'Roles', value: ['COLLECTIONS_AGENT'], target: null },
  ],
});

function view(substrate: SnapshotSubstrate, text: string): ReadonlyMap<string, ParsedSnapshot> {
  return new Map([
    [EVIDENCE, readStructuralSnapshot({ evidenceId: EVIDENCE, substrate, bytes: utf8Bytes(text) })],
  ]);
}

function attribute(over: Partial<ObservationAttribute> = {}): ObservationAttribute {
  return {
    name: 'account_id',
    originalValue: 'AG-1001',
    normalizedValue: 'AG-1001',
    grounding: {
      evidenceId: EVIDENCE,
      locator: '$.accounts[0].account_id',
      label: 'account_id',
      extractedText: 'AG-1001',
    },
    corroboration: null,
    ...over,
  };
}

function record(over: Partial<ObservationRecord> = {}): ObservationRecord {
  return {
    schemaVersion: 1,
    observationId: '0f9a1a3d-2f2c-8a1b-9f0c-6b4e2d1c8a70',
    workItemId: '01990000-0000-7000-8000-00000000a001',
    populationRecordKey: 'AG-1001',
    targetSystem: 'accessgate',
    found: 'true',
    observedAt: '2026-09-05T00:00:00.000Z',
    stepExecutionId: '01990000-0000-7000-8000-00000000b001',
    captureMethod: 'adapter',
    matchOrigin: 'platform',
    identity: attribute(),
    attributes: [
      attribute({
        name: 'roles',
        originalValue: ['AP_CLERK'],
        normalizedValue: ['AP_CLERK'],
        grounding: {
          evidenceId: EVIDENCE,
          locator: '$.accounts[0].roles',
          label: 'roles',
          extractedText: '["AP_CLERK"]',
        },
      }),
    ],
    evidenceIds: [EVIDENCE],
    ...over,
  };
}

describe('the four substrates', () => {
  it('names exactly four, and implements web_tree, sheet and json', () => {
    expect([...SNAPSHOT_SUBSTRATES]).toEqual(['web_tree', 'desktop_tree', 'sheet', 'json']);
    expect([...IMPLEMENTED_SNAPSHOT_SUBSTRATES]).toEqual(['web_tree', 'sheet', 'json']);
  });

  it('refuses the desktop substrate BY NAME rather than falling through it', () => {
    const judged = corroborateAttribute(attribute(), view('desktop_tree', ACCOUNTS));
    expect(judged.failure).toBe('substrate-unsupported');
    // Not `contradictory`: nothing read it, so nothing disagreed with it.
    expect(judged.corroboration).toBeNull();
    expect(snapshotCorroborationDiagnostic(judged.failure!)).toBe('corroboration-unsupported');
  });

  it('derives the substrate from the media type registration recorded', () => {
    expect(snapshotSubstrateForMediaType('application/json')).toBe('json');
    expect(snapshotSubstrateForMediaType('application/json; charset=utf-8')).toBe('json');
    expect(snapshotSubstrateForMediaType('text/csv')).toBe('sheet');
    expect(snapshotSubstrateForMediaType('TEXT/CSV; charset=utf-8')).toBe('sheet');
    expect(snapshotSubstrateForMediaType(WEB_TREE_MEDIA_TYPE)).toBe('web_tree');
    expect(snapshotSubstrateForMediaType(`${WEB_TREE_MEDIA_TYPE}; charset=utf-8`)).toBe('web_tree');
    expect(snapshotSubstrateForMediaType(WEB_TREE_MEDIA_TYPE.toUpperCase())).toBe('web_tree');
    expect(snapshotSubstrateForMediaType('image/png')).toBeNull();
    expect(snapshotSubstrateForMediaType(null)).toBeNull();
  });
});

describe('the bounded web tree', () => {
  it('parses grouped semantic nodes and addresses values by stable index', () => {
    const document = parseWebTree(WEB_TREE);
    expect(document).toEqual({
      schemaVersion: 1,
      nodes: [
        { group: 'record:0', role: 'datum', label: 'Employee ID', value: 'E-000105', target: null },
        { group: 'record:0', role: 'datum', label: 'Full name', value: 'Esther Kabwe', target: null },
        { group: 'record:0', role: 'status', label: 'Status', value: 'Disabled', target: null },
        { group: 'page', role: 'input', label: 'Username', value: 'e.kabwe', target: 'username' },
        { group: 'record:0', role: 'datum', label: 'Roles', value: ['COLLECTIONS_AGENT'], target: null },
      ],
    });
    expect(webTreeValueLocator(2)).toBe('$.nodes[2].value');
    expect(readWebTreeCell(document!, 2)).toEqual({ value: 'Disabled', label: 'Status' });
    expect(readSnapshotCell(readStructuralSnapshot({
      evidenceId: EVIDENCE,
      substrate: 'web_tree',
      bytes: utf8Bytes(WEB_TREE),
    }), parseSnapshotLocator('$.nodes[2].value')!)).toEqual({ value: 'Disabled', label: 'Status' });
  });

  it('accepts an empty page and target-specific completion metadata, but rejects malformed shapes', () => {
    expect(isWebTreeDocument({ schemaVersion: 1, nodes: [] })).toBe(true);
    expect(isWebTreeDocument({ schemaVersion: 1, nodes: [], completion: { complete: false, returned: null } })).toBe(true);
    const invalid = [
      null,
      { schemaVersion: 2, nodes: [] },
      { schemaVersion: 1, nodes: {}, },
      { schemaVersion: 1, nodes: [{ group: 'record:0', role: 'datum', label: 'Status', value: 'Disabled' }] },
      { schemaVersion: 1, nodes: [{ group: 'record:0', role: 'text', label: 'Status', value: 'Disabled', target: null }] },
      { schemaVersion: 1, nodes: [{ group: 'record:0', role: 'datum', label: 'Status', value: 'Disabled', target: 'unexpected' }] },
      { schemaVersion: 1, nodes: [{ group: '', role: 'datum', label: 'Status', value: 'Disabled', target: null }] },
      { schemaVersion: 1, nodes: [{ group: 'record:0', role: 'datum', label: '', value: 'Disabled', target: null }] },
      { schemaVersion: 1, nodes: [{ group: 'record:0', role: 'datum', label: '   ', value: 'Disabled', target: null }] },
      { schemaVersion: 1, nodes: [{ group: 'record:0', role: 'datum', label: 'Status', value: Number.NaN, target: null }] },
      { schemaVersion: 1, nodes: [{ group: 'record:0', role: 'datum', label: 'Status', value: 'x'.repeat(WEB_TREE_LIMITS.value + 1), target: null }] },
      { schemaVersion: 1, nodes: Array.from({ length: WEB_TREE_LIMITS.nodes + 1 }, () => ({ group: 'record:0', role: 'datum', label: 'Status', value: 'x', target: null })) },
      { schemaVersion: 1, nodes: [], completion: { complete: true, returned: null, extra: true } },
      { schemaVersion: 1, nodes: [], completion: { complete: 'true', returned: 0 } },
      { schemaVersion: 1, nodes: [], completion: { complete: false, returned: -1 } },
      { schemaVersion: 1, nodes: [], completion: { complete: false, returned: WEB_TREE_LIMITS.returned + 1 } },
    ];
    for (const value of invalid) expect(isWebTreeDocument(value), JSON.stringify(value)).toBe(false);
    expect(parseWebTree('{"schemaVersion":1,"complete":true,"returned":0,"nodes":')).toBeNull();
  });

  it('requires the web-tree locator to name the nodes value field', () => {
    const parsed = readStructuralSnapshot({ evidenceId: EVIDENCE, substrate: 'web_tree', bytes: utf8Bytes(WEB_TREE) });
    expect(parsed.ok).toBe(true);
    for (const locator of [
      { collection: 'rows', index: 2, field: WEB_TREE_VALUE_FIELD },
      { collection: WEB_TREE_COLLECTION, index: 2, field: 'label' },
      { collection: WEB_TREE_COLLECTION, index: 99, field: WEB_TREE_VALUE_FIELD },
    ]) {
      expect(readSnapshotCell(parsed, locator)).toBeNull();
    }
  });

  it('corroborates values with the node accessible label and catches mutations', () => {
    const source = {
      evidenceId: EVIDENCE,
      substrate: 'web_tree' as const,
      bytes: utf8Bytes(WEB_TREE),
    };
    const faithful = attribute({
      name: 'account_status',
      originalValue: 'Disabled',
      normalizedValue: 'Disabled',
      grounding: {
        evidenceId: EVIDENCE,
        locator: '$.nodes[2].value',
        label: 'Status',
        extractedText: 'Disabled',
      },
    });
    expect(corroborateAttribute(faithful, new Map([[EVIDENCE, readStructuralSnapshot(source)]]))).toMatchObject({
      corroboration: 'matched',
      failure: null,
    });
    const wrongLabel = { ...faithful, grounding: { ...faithful.grounding!, label: 'Filter status' } };
    expect(corroborateAttribute(wrongLabel, new Map([[EVIDENCE, readStructuralSnapshot(source)]]))).toMatchObject({
      corroboration: 'contradictory',
      failure: 'label-drift',
    });
    const wrongValue = { ...faithful, originalValue: 'Active', normalizedValue: 'Active' };
    expect(corroborateAttribute(wrongValue, new Map([[EVIDENCE, readStructuralSnapshot(source)]]))).toMatchObject({
      corroboration: 'contradictory',
      failure: 'value-contradicted',
    });
  });
});

describe('a snapshot that cannot be read', () => {
  it('reports bytes that are not the substrate they claim, and judges nothing', () => {
    for (const [substrate, text] of [
      ['json', 'not json at all'],
      ['sheet', 'a,a\n1,2\n'],
      ['sheet', 'entry,role\n1\n'],
    ] as const) {
      const parsed = view(substrate, text);
      expect(parsed.get(EVIDENCE)!.ok).toBe(false);
      const judged = corroborateAttribute(attribute(), parsed);
      expect(judged).toMatchObject({ corroboration: null, failure: 'snapshot-unreadable' });
    }
  });

  it('reports a grounding naming Evidence the caller did not supply', () => {
    const judged = corroborateAttribute(attribute(), new Map());
    expect(judged).toMatchObject({ corroboration: null, failure: 'snapshot-unavailable' });
    expect(snapshotCorroborationDiagnostic('snapshot-unavailable')).toBe('corroboration-unavailable');
  });

  it('judges nothing for an attribute that was never grounded', () => {
    // §B.1 already treats an ungrounded attribute as not captured, and
    // `required-evidence` records that. There is nothing to re-read and nothing to
    // contradict, so this is not a corroboration failure.
    const judged = corroborateAttribute(attribute({ grounding: null }), view('json', ACCOUNTS));
    expect(judged).toEqual({ name: 'account_id', corroboration: null, failure: null });
  });
});

describe('the locator', () => {
  it('parses only the anchored grammar', () => {
    expect(parseSnapshotLocator('$.accounts[12].account_id')).toEqual({
      collection: 'accounts',
      index: 12,
      field: 'account_id',
    });
    for (const bad of [
      '$.accounts[0]',
      '$.accounts.0.account_id',
      'accounts[0].account_id',
      '$.accounts[01].account_id',
      '$.accounts[-1].account_id',
      '$.accounts[0].a.b',
      '$.[0].a',
      '$.accounts[0].',
      42,
      null,
    ]) {
      expect(parseSnapshotLocator(bad as never)).toBeNull();
    }
  });

  it('never returns an inherited property for a field named like one', () => {
    // A plain index would answer `constructor` with a function. Fifth occurrence in this
    // codebase, and here the key comes out of a stored locator.
    const parsed = view('json', ACCOUNTS).get(EVIDENCE)!;
    for (const field of ['constructor', 'toString', '__proto__']) {
      expect(readSnapshotCell(parsed, parseSnapshotLocator(`$.accounts[0].${field}`)!)).toBeNull();
    }
  });

  it('addresses a sheet only through its one collection segment', () => {
    const parsed = view('sheet', SHEET).get(EVIDENCE)!;
    expect(readSnapshotCell(parsed, { collection: SHEET_COLLECTION, index: 1, field: 'role' })).toEqual(
      { value: 'LOAN_VIEWER', label: 'role' },
    );
    expect(readSnapshotCell(parsed, { collection: 'sheet', index: 1, field: 'role' })).toBeNull();
  });
});

describe('the record-level verdict', () => {
  it('passes a faithful Observation and marks every attribute matched', () => {
    const result = corroborateObservation(record(), view('json', ACCOUNTS));
    expect(result).toMatchObject({ outcome: 'PASS', diagnostic: null });
    expect(result.identity?.corroboration).toBe('matched');
    expect(result.attributes.map((entry) => entry.corroboration)).toEqual(['matched']);
  });

  it('contradicts an identity that does not re-read to the population record key', () => {
    // The row at that locator holds `007`; the Observation says the record key is `7`.
    // Nothing coerces one to the other, in either direction.
    const result = corroborateObservation(
      record({
        populationRecordKey: '7',
        identity: attribute({
          originalValue: '007',
          normalizedValue: '007',
          grounding: {
            evidenceId: EVIDENCE,
            locator: '$.accounts[1].account_id',
            label: 'account_id',
            extractedText: '007',
          },
        }),
        attributes: [],
      }),
      view('json', ACCOUNTS),
    );
    expect(result).toMatchObject({ outcome: 'FAIL', diagnostic: 'identity-mismatch' });
    expect(result.identity).toMatchObject({
      corroboration: 'contradictory',
      failure: 'identity-key-mismatch',
    });
  });

  it('does not judge the identity of an Observation that resolved no match', () => {
    for (const found of ['false', 'ambiguous'] as const) {
      const result = corroborateObservation(
        record({ found, identity: null, attributes: [] }),
        view('json', ACCOUNTS),
      );
      // Nothing was grounded, so nothing was contradicted; `ambiguous-match` and
      // `search-completeness` are where those two Observations are judged.
      expect(result).toMatchObject({ outcome: 'PASS', diagnostic: null, identity: null });
      expect(result.attributes).toEqual([]);
    }
  });

  it('reports the FIRST failure, identity before attributes, so two builds agree', () => {
    const result = corroborateObservation(
      record({
        identity: attribute({ grounding: { evidenceId: EVIDENCE, locator: '$.accounts[0].account_id', label: 'Account', extractedText: 'AG-1001' } }),
        attributes: [attribute({ name: 'roles', originalValue: 'wrong', normalizedValue: 'wrong', grounding: { evidenceId: EVIDENCE, locator: '$.accounts[0].roles', label: 'roles', extractedText: 'wrong' } })],
      }),
      view('json', ACCOUNTS),
    );
    expect(result.diagnostic).toBe('corroboration-label-drift');
    expect(result.attributes[0]?.failure).toBe('value-contradicted');
  });

  it('gives an identity and a same-named attribute their own verdicts', () => {
    // §B.1 allows the collision, and a verdict list keyed by name alone would hand one of
    // them the other's answer.
    const result = corroborateObservation(
      record({
        attributes: [
          attribute({
            name: 'account_id',
            originalValue: 'AG-9999',
            normalizedValue: 'AG-9999',
            grounding: { evidenceId: EVIDENCE, locator: '$.accounts[1].account_id', label: 'account_id', extractedText: 'AG-9999' },
          }),
        ],
      }),
      view('json', ACCOUNTS),
    );
    expect(result.identity?.corroboration).toBe('matched');
    expect(result.attributes[0]?.corroboration).toBe('contradictory');
  });

  it('maps every failure to a diagnostic the check row may carry', () => {
    for (const failure of SNAPSHOT_CORROBORATION_FAILURES) {
      expect(OBSERVATION_CHECK_DIAGNOSTICS as readonly string[]).toContain(
        snapshotCorroborationDiagnostic(failure as SnapshotCorroborationFailure),
      );
    }
  });
});

describe('the rollup the database pins', () => {
  it('is CONTRADICTORY when anything disagreed, MATCHED when nothing did', () => {
    const judged = (over: Partial<ObservationRecord>) =>
      observationCorroborationState(
        (() => {
          const base = record(over);
          const result = corroborateObservation(base, view('json', ACCOUNTS));
          return {
            ...base,
            identity: base.identity === null ? null : { ...base.identity, corroboration: result.identity?.corroboration ?? null },
            attributes: base.attributes.map((entry, index) => ({
              ...entry,
              corroboration: result.attributes[index]?.corroboration ?? null,
            })),
          };
        })(),
      );
    expect(judged({})).toBe('MATCHED');
    expect(
      judged({
        attributes: [
          attribute({ name: 'roles', originalValue: 'wrong', normalizedValue: 'wrong', grounding: { evidenceId: EVIDENCE, locator: '$.accounts[0].roles', label: 'roles', extractedText: 'wrong' } }),
        ],
      }),
    ).toBe('CONTRADICTORY');
    // Nothing grounded, nothing judged: an absence Observation is UNJUDGED, not a pass.
    expect(judged({ found: 'false', identity: null, attributes: [] })).toBe('UNJUDGED');
  });
});
