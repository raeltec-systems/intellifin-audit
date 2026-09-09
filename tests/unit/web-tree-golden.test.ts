import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  isWebTreeDocument,
  parseSnapshotLocator,
  parseWebTree,
  readSnapshotCell,
  readStructuralSnapshot,
  utf8Bytes,
  WEB_TREE_ROLES,
  type ParsedSnapshot,
} from '@intellifin/domain';

interface GoldenCell {
  readonly name: string;
  readonly locator: string;
  readonly resolves: boolean;
  readonly value: unknown;
  readonly label: string | null;
}

interface GoldenMutation {
  readonly name: string;
  readonly document: unknown;
  readonly valid: boolean;
}

interface Golden {
  readonly producer: string;
  readonly producedBy: string;
  readonly document: string;
  readonly cells: readonly GoldenCell[];
  readonly mutations: readonly GoldenMutation[];
}

const golden = JSON.parse(
  readFileSync(
    fileURLToPath(new URL('../fixtures/web-tree-golden.json', import.meta.url)),
    'utf8',
  ),
) as Golden;

const parsed = readStructuralSnapshot({
  evidenceId: 'web-tree-golden',
  substrate: 'web_tree',
  bytes: utf8Bytes(golden.document),
});

describe('the independent Story 4.4 web-tree vectors', () => {
  it('were produced by Python rather than the TypeScript parser', () => {
    expect(golden.producer.startsWith('Python')).toBe(true);
    expect(golden.producedBy).toBe('scripts/make-web-tree-golden.py');
  });

  it('reads every Python locator through the structural snapshot seam', () => {
    expect(parsed.ok).toBe(true);
    if (!parsed.ok || parsed.substrate !== 'web_tree') return;
    expect(parsed.document.completion).toEqual({ complete: true, returned: null });
    expect(parsed.document.nodes[0]?.group).toBe('record:0');
    expect(parsed.document.nodes[3]?.target).toBe('username');
    const snapshots = new Map<string, ParsedSnapshot>([['web-tree-golden', parsed]]);
    for (const cell of golden.cells) {
      const locator = parseSnapshotLocator(cell.locator);
      const found = locator === null ? null : readSnapshotCell(parsed, locator);
      expect(found !== null, cell.name).toBe(cell.resolves);
      if (found !== null) {
        expect(found.value, cell.name).toEqual(cell.value);
        expect(found.label, cell.name).toBe(cell.label);
      }
    }
    // Keep this reference in the test so a future refactor cannot accidentally remove the
    // map-shaped input the registration corroboration seam consumes.
    expect(snapshots.get('web-tree-golden')?.ok).toBe(true);
  });

  it('rejects Python mutations and keeps the role vocabulary closed', () => {
    for (const mutation of golden.mutations) {
      expect(isWebTreeDocument(mutation.document), mutation.name).toBe(mutation.valid);
    }
    expect([...WEB_TREE_ROLES]).toEqual(['datum', 'link', 'input', 'button', 'status']);
  });

  it('rejects a forged direct object outside JSON values', () => {
    class ForgedDocument {
      schemaVersion = 1 as const;
      complete = true;
      returned = 1;
      nodes = [{ group: 'record:0', role: 'datum', label: 'Status', value: 'Active', target: null }];
    }
    expect(isWebTreeDocument(new ForgedDocument())).toBe(false);
    expect(
      isWebTreeDocument({
        schemaVersion: 1,
        complete: true,
        returned: 1,
        nodes: [{ group: 'record:0', role: 'datum', label: 'Status', value: () => 'Active', target: null }],
      }),
    ).toBe(false);
    const cyclic: { self?: unknown } = {};
    cyclic.self = cyclic;
    expect(
      isWebTreeDocument({
        schemaVersion: 1,
        nodes: [{ group: 'record:0', role: 'datum', label: 'Status', value: cyclic, target: null }],
      }),
    ).toBe(false);
  });
});
