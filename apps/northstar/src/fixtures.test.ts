import { createHash, createHmac } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { ARTIFACTS } from './files.js';

import {
  FIXTURES_ROOT,
  SYNTHETIC_MARKER,
  apiDeclaration,
  countDeclaration,
  datasets,
} from './fixtures.js';

/**
 * The generated declarations reconcile with the datasets they were generated from.
 *
 * `fixtures/northstar/generate.py` writes every count and every digest in Python. This
 * file recomputes them in TypeScript with `node:crypto`. Two implementations, so a drift
 * between `datasets/` and `generated/` fails here rather than being discovered by an Epic
 * 2 Adapter reconciling against a stale declaration — and a count "checked" by the code
 * that produced it would prove only that it equals itself.
 */

const GENERATED = join(FIXTURES_ROOT, 'generated');

/** Published on purpose; see fixtures/northstar/README.md. Not a security control. */
const SIGNING_KEY = 'northstar-synthetic-cover-sheet-key-2026';

interface CoverSheet {
  readonly synthetic: { readonly marker: string };
  readonly source: string;
  readonly covers: string;
  readonly generation: string;
  readonly generated_at: string;
  readonly effective_period: unknown;
  readonly complete: boolean;
  readonly row_count: number;
  readonly declared_schema: readonly string[];
  readonly content_digest: { readonly algorithm: string; readonly value: string };
  readonly format: Record<string, unknown>;
  readonly signature: { readonly scheme: string; readonly value: string };
  readonly seeded_case?: string;
}

function coverSheetNames(): readonly string[] {
  return readdirSync(GENERATED)
    .filter((name) => name.endsWith('.cover-sheet.json'))
    .sort();
}

function readSheet(name: string): CoverSheet {
  return JSON.parse(readFileSync(join(GENERATED, name), 'utf8')) as CoverSheet;
}

function sha256(payload: Buffer): string {
  return createHash('sha256').update(payload).digest('hex');
}

/** The generator's canonical bytes: sorted keys, no insignificant space. */
function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
    a < b ? -1 : a > b ? 1 : 0,
  );
  return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(',')}}`;
}

/** Data rows: everything after the comment line and the header line. */
function dataRowCount(payload: Buffer): number {
  const lines = payload.toString('utf8').split('\n');
  const trimmed = lines[lines.length - 1] === '' ? lines.slice(0, -1) : lines;
  return trimmed.length - 2;
}

describe('cover sheets', () => {
  it('found some to check', () => {
    // A directory read that silently returned nothing would make every case below vacuous.
    expect(coverSheetNames().length).toBeGreaterThanOrEqual(5);
  });

  for (const name of coverSheetNames()) {
    describe(name, () => {
      const sheet = readSheet(name);
      const covered = readFileSync(join(GENERATED, sheet.covers));

      it('carries the synthetic marker', () => {
        expect(sheet.synthetic.marker).toBe(SYNTHETIC_MARKER);
      });

      it('is signed with the published key over its own fields', () => {
        const signed = {
          source: sheet.source,
          covers: sheet.covers,
          generation: sheet.generation,
          generated_at: sheet.generated_at,
          effective_period: sheet.effective_period,
          complete: sheet.complete,
          row_count: sheet.row_count,
          declared_schema: sheet.declared_schema,
          content_digest: sheet.content_digest,
          format: sheet.format,
        };
        const expected = createHmac('sha256', SIGNING_KEY).update(canonical(signed), 'utf8').digest('hex');
        expect(sheet.signature.value).toBe(expected);
      });

      if (sheet.seeded_case === 'declared-count-mismatch') {
        it('deliberately disagrees with the file it covers — that IS the seeded case', () => {
          // Addendum D: one stale or incomplete population. The sheet declares the FULL
          // export while the file it names is short, so the Gate must catch the truncation.
          expect(sha256(covered)).not.toBe(sheet.content_digest.value);
          expect(dataRowCount(covered)).toBeLessThan(sheet.row_count);
        });
      } else {
        it('declares the digest of the bytes actually served', () => {
          expect(sheet.content_digest.algorithm).toBe('sha256');
          expect(sha256(covered)).toBe(sheet.content_digest.value);
        });

        it('declares the number of data rows the file holds', () => {
          expect(dataRowCount(covered)).toBe(sheet.row_count);
        });
      }

      it('declares a schema that matches the file header', () => {
        const header = covered.toString('utf8').split('\n')[1] ?? '';
        expect(header.split(',')).toEqual([...sheet.declared_schema]);
      });

      it('carries explicit producer freshness and completeness metadata', () => {
        expect(sheet.generated_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/);
        expect(sheet.complete).toBe(true);
      });
    });
  }
});

describe('API population declarations', () => {
  /** Recomputed here in TypeScript from the datasets, never from the declaration. */
  const cases = [
    {
      file: 'accessgate-accounts.count.json',
      source: 'accessgate-accounts',
      key: 'account_id',
      schema: datasets.accessgate().declared_schema,
      rows: () => datasets.accessgate().accounts.filter((row) => row.status === 'Active'),
    },
    {
      file: 'coredirectory-accounts.count.json',
      source: 'coredirectory-accounts',
      key: 'account_id',
      schema: datasets.coredirectory().declared_schema,
      // Both published populations: the extraction endpoint is the Target System and
      // lists every account, while each CSV publishes one population.
      rows: () => datasets.coredirectory().populations.flatMap((group) => group.accounts),
    },
    {
      file: 'approvenow-approvals.count.json',
      source: 'approvenow-approvals',
      key: 'approval_id',
      schema: datasets.approvenow().declared_schema,
      rows: () => datasets.approvenow().approvals,
    },
    {
      file: 'peoplehub-employees.count.json',
      source: 'peoplehub-employees',
      key: 'employee_id',
      schema: datasets.peoplehub().declared_schema,
      rows: () => datasets.peoplehub().employees,
    },
    {
      file: 'ledgerflow-transactions.count.json',
      source: 'ledgerflow-transactions',
      key: 'transaction_id',
      schema: datasets.ledgerflow().declared_schema,
      rows: () => datasets.ledgerflow().transactions,
    },
  ] as const;

  for (const item of cases) {
    it(`${item.file} carries an independently generated rows digest`, () => {
      const declaration = apiDeclaration(item.file);
      const rows = [...item.rows()].sort((left, right) => {
        const a = String(left[item.key as keyof typeof left]);
        const b = String(right[item.key as keyof typeof right]);
        return a < b ? -1 : a > b ? 1 : 0;
      });
      const canonicalRows = canonical({ schema_version: 1, rows });
      expect(createHash('sha256').update(canonicalRows, 'utf8').digest('hex')).toBe(
        declaration.sha256,
      );
      expect(declaration.schema_version).toBe(1);
      expect(declaration.representation).toBe('population-rows-v1');
      expect(declaration.source).toBe(item.source);
      expect(declaration.schema).toEqual([...item.schema]);
      expect(declaration.count).toBe(rows.length);
      expect(declaration.declared_count).toBe(rows.length);
      expect(declaration.complete).toBe(true);
      expect(declaration.generated_at).toBe('2026-09-01T00:00:00Z');
      expect(declaration.effective_period).toEqual({ from: '2026-08-01', to: '2026-08-31' });
      expect(declaration.produced_by).toMatch(/^Python /);
    });
  }

  it('has no untested API declaration file', () => {
    const onDisk = readdirSync(GENERATED)
      .filter((name) => name.endsWith('.count.json'))
      .filter((name) => apiDeclarationNames.has(name))
      .sort();
    expect(onDisk).toEqual(cases.map((item) => item.file).sort());
  });
});

const apiDeclarationNames = new Set([
  'accessgate-accounts.count.json',
  'coredirectory-accounts.count.json',
  'approvenow-approvals.count.json',
  'peoplehub-employees.count.json',
  'ledgerflow-transactions.count.json',
]);

describe('AccessGate versioned-file equivalent', () => {
  it('serves the sorted Active population with roles preserved as JSON text', () => {
    const lines = readFileSync(join(GENERATED, 'accessgate-active-accounts.csv'), 'utf8')
      .trimEnd()
      .split('\n');
    const ids = lines.slice(2).map((line) => line.split(',')[0]);
    expect(ids).toHaveLength(12);
    expect(ids).toEqual([...ids].sort());
    expect(ids.filter((id) => id === 'AG-1007')).toHaveLength(2);
    expect(lines.find((line) => line.startsWith('AG-1002,'))).toContain(
      '"[""LOAN_VIEWER"",""REPORT_READER""]"',
    );
    expect(lines.every((line) => !line.startsWith('AG-1012,'))).toBe(true);
  });

  it('keeps a full cover over the deliberately truncated Active file', () => {
    const sheet = JSON.parse(
      readFileSync(join(GENERATED, 'accessgate-active-accounts-truncated.cover-sheet.json'), 'utf8'),
    ) as { row_count: number; seeded_case: string };
    const lines = readFileSync(join(GENERATED, 'accessgate-active-accounts-truncated.csv'), 'utf8')
      .trimEnd()
      .split('\n');
    expect(sheet.seeded_case).toBe('declared-count-mismatch');
    expect(lines.length - 2).toBeLessThan(sheet.row_count);
  });
});

describe('the CoreDirectory clean source', () => {
  /**
   * The properties that make Pass and Control Failure REACHABLE, checked against the
   * dataset rather than assumed.
   *
   * Neither golden population can produce either outcome, and that is the golden datasets
   * working as designed: AccessGate lists AG-1007 twice and LedgerFlow carries a
   * transaction with no processed time, and both of those §H rows read the SOURCE rather
   * than the included set. This source seeds none of that, so an edit that quietly
   * introduces a duplicate key, an empty role list or an undeclared role would turn a
   * Pass case into an Inconclusive one for a reason nobody would look for. Each of these
   * is that edit failing here instead.
   *
   * Nothing below evaluates a Compliance Rule or validates a Result. The prohibited pairs
   * come from `rolematrix.json`, which is the same DATA the Run's Reference Source is
   * generated from — never from the Template or from anything a Run computes.
   */
  const dataset = datasets.coredirectory();
  const matrix = JSON.parse(
    readFileSync(join(FIXTURES_ROOT, 'datasets', 'rolematrix.json'), 'utf8'),
  ) as {
    prohibited_pairs: readonly (readonly string[])[];
    entries: readonly { role: string; permissions: readonly string[] }[];
  };

  it('publishes two populations and no more', () => {
    expect(dataset.populations.map((group) => group.population_id)).toEqual([
      'coredirectory-accounts-compliant',
      'coredirectory-accounts-conflict',
    ]);
  });

  it('gives every account across both populations a distinct primary key', () => {
    // §H counts duplicate Source primary keys over EVERY parsed row, so one repeat
    // anywhere in a published file is Inconclusive whatever the records say.
    const ids = dataset.populations.flatMap((group) =>
      group.accounts.map((account) => account.account_id),
    );
    expect(ids).toHaveLength(8);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('leaves no mandatory evaluation value empty', () => {
    for (const group of dataset.populations) {
      for (const account of group.accounts) {
        expect(account.status, account.account_id).toBe('Active');
        expect(account.roles.length, account.account_id).toBeGreaterThan(0);
      }
    }
  });

  it('names only roles RoleMatrix declares exactly once', () => {
    // An unknown role is `rule does not name value <v>`, and a role declared twice with
    // different permissions is `duplicate conflicting policy entries`. Both are
    // Unevaluated, and either would make a clean population Inconclusive.
    for (const group of dataset.populations) {
      for (const account of group.accounts) {
        for (const role of account.roles) {
          const declared = matrix.entries.filter((entry) => entry.role === role);
          expect(declared.length, `${account.account_id} ${role}`).toBe(1);
        }
      }
    }
  });

  it('seeds exactly one prohibited pair, and it is in the conflict population', () => {
    const expansionOf = (roles: readonly string[]): ReadonlySet<string> =>
      new Set(
        roles.flatMap(
          (role) => matrix.entries.find((entry) => entry.role === role)?.permissions ?? [],
        ),
      );
    const conflicting = dataset.populations.map((group) =>
      group.accounts
        .filter((account) => {
          const permissions = expansionOf(account.roles);
          return matrix.prohibited_pairs.some(([a, b]) => permissions.has(a!) && permissions.has(b!));
        })
        .map((account) => account.account_id),
    );
    expect(conflicting).toEqual([[], ['CD-3103']]);
  });

  it('keeps a near miss on each side of the boundary in the compliant population', () => {
    // One permission short of a pair. A rule that flags any single member of the conflict
    // vocabulary reports an Exception here, and the Pass case is what catches it.
    const compliant = dataset.populations[0]!.accounts;
    const rolesOf = (id: string): readonly string[] =>
      compliant.find((account) => account.account_id === id)!.roles;
    expect(rolesOf('CD-3001')).toEqual(['AP_CLERK']);
    expect(rolesOf('CD-3003')).toEqual(['VENDOR_MAINTAINER']);
    const halves = new Set(matrix.prohibited_pairs.flat());
    expect(halves.has('CREATE_PAYMENT') && halves.has('CREATE_VENDOR')).toBe(true);
  });

  it('serves each population as its own sorted CSV with roles preserved as JSON text', () => {
    for (const group of dataset.populations) {
      const lines = readFileSync(join(GENERATED, group.covers), 'utf8').trimEnd().split('\n');
      const ids = lines.slice(2).map((line) => line.split(',')[0]);
      expect(ids, group.population_id).toEqual(
        [...group.accounts.map((account) => account.account_id)].sort(),
      );
      expect(lines[1]).toBe(dataset.declared_schema.join(','));
    }
    expect(
      readFileSync(join(GENERATED, 'coredirectory-accounts-conflict.csv'), 'utf8'),
    ).toContain('"[""VENDOR_MAINTAINER"",""VENDOR_APPROVER""]"');
  });

  it('lists every published account in the one extraction endpoint', () => {
    // P-2's coverage rule is `must-appear`: an account of the bound population that the
    // extraction does not carry is UNINSPECTED, however honestly its absence was proven.
    const declaration = apiDeclaration('coredirectory-accounts.count.json');
    expect(declaration.count).toBe(8);
    expect(declaration.schema).toEqual([...dataset.declared_schema]);
  });
});

describe('declared counts', () => {
  /** Recomputed in TypeScript from the dataset — never read back from the declaration. */
  const cases: readonly { readonly file: string; readonly count: () => number }[] = [
    {
      file: 'accessgate-accounts.count.json',
      count: () => datasets.accessgate().accounts.filter((a) => a.status === 'Active').length,
    },
    {
      file: 'coredirectory-accounts.count.json',
      count: () =>
        datasets.coredirectory().populations.reduce((total, group) => total + group.accounts.length, 0),
    },
    { file: 'approvenow-approvals.count.json', count: () => datasets.approvenow().approvals.length },
    { file: 'peoplehub-employees.count.json', count: () => datasets.peoplehub().employees.length },
    {
      file: 'ledgerflow-transactions.count.json',
      count: () => datasets.ledgerflow().transactions.length,
    },
    {
      file: 'prodconsole-parameters.count.json',
      count: () => datasets.prodconsole().observed_parameters.length,
    },
    { file: 'loancore-accounts.count.json', count: () => datasets.loancore().accounts.length },
  ];

  for (const item of cases) {
    it(`${item.file} declares the count the dataset holds`, () => {
      const declaration = countDeclaration(item.file);
      expect(declaration.declared_count).toBe(item.count());
      expect(declaration.synthetic.marker).toBe(SYNTHETIC_MARKER);
      // The declaration must say it came from somewhere other than the product. A count
      // produced by whatever later counts the rows proves nothing about truncation.
      expect(declaration.produced_by).toMatch(/^Python /);
      expect(declaration.counted_from).toMatch(/^datasets\//);
    });
  }

  it('covers every count file in the generated folder', () => {
    // Otherwise a generated count added later is unchecked, and the suite still looks
    // complete because every case it names passes.
    const onDisk = readdirSync(GENERATED)
      .filter((name) => name.endsWith('.count.json'))
      .sort();
    expect(onDisk).toEqual(cases.map((item) => item.file).sort());
  });
});

describe('the leavers export', () => {
  it('keeps the hero population at or below 20 records', () => {
    // The spec's constraint, and it is about observability: a live Run of more than 20
    // records is not something a person can watch.
    const rows = datasets.leavers().rows.filter(
      (row) =>
        row.employment_status === 'Terminated' &&
        row.termination_effective_date >= '2026-08-01' &&
        row.termination_effective_date <= '2026-08-31',
    );
    expect(rows.length).toBeLessThanOrEqual(20);
    expect(new Set(rows.map((row) => row.employee_id)).size).toBeLessThanOrEqual(20);
  });

  it('preserves leading zeros by keeping every identifier a string', () => {
    for (const row of datasets.leavers().rows) {
      expect(typeof row.employee_id).toBe('string');
    }
  });

  it('carries the duplicate primary key the golden dataset requires', () => {
    const ids = datasets.leavers().rows.map((row) => row.employee_id);
    expect(ids.length).toBeGreaterThan(new Set(ids).size);
  });
});

describe('the published artifact map', () => {
  it('keys every artifact by the file it serves', () => {
    // `ARTIFACTS` stores a `file` beside a key that must equal it. Nothing asserted
    // that, so a copy-paste divergence would serve one artifact's bytes under another
    // artifact's name — with a 200 and a cover sheet that does not match, which is the
    // one failure a Gate would report as tampering.
    for (const [key, artifact] of ARTIFACTS) {
      expect(artifact.file, `ARTIFACTS key ${key}`).toBe(key);
    }
  });
});
