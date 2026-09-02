import { createHash, createHmac } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import { ARTIFACTS } from './files.js';

import { FIXTURES_ROOT, SYNTHETIC_MARKER, countDeclaration, datasets } from './fixtures.js';

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
  readonly effective_period: unknown;
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
          effective_period: sheet.effective_period,
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
    });
  }
});

describe('declared counts', () => {
  /** Recomputed in TypeScript from the dataset — never read back from the declaration. */
  const cases: readonly { readonly file: string; readonly count: () => number }[] = [
    {
      file: 'accessgate-accounts.count.json',
      count: () => datasets.accessgate().accounts.filter((a) => a.status === 'Active').length,
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
