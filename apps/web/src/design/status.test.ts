import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { ICON_GLYPHS } from './icons';
import {
  NEEDS_A_HUMAN,
  STATUS_FAMILIES,
  STATUS_TREATMENTS,
  STATUS_VOCABULARY,
  statusPresentation,
  type StatusFamily,
} from './status';

/**
 * The status vocabulary against DESIGN.md.
 *
 * `status.ts` is a transcription of one nine-row markdown table. A transcription tested
 * against itself proves nothing, so this reads the table off disk and compares row by
 * row, cell by cell. Reword a state, move a treatment, or swap an icon in the contract
 * and this fails naming the row.
 */

const DESIGN_PATH = fileURLToPath(
  new URL(
    '../../../../_bmad-output/planning-artifacts/ux-designs/ux-IntelliFin Audit-2026-09-01/DESIGN.md',
    import.meta.url,
  ),
);

const design = readFileSync(DESIGN_PATH, 'utf8');

interface ContractRow {
  readonly family: string;
  readonly states: readonly string[];
  readonly treatments: readonly string[];
  readonly icons: readonly string[];
}

/**
 * The rows of the "Status" table: the first table after the `# Colors` heading whose
 * header is `| Family | States | Badge treatment | Icon |`. Cells list their values
 * separated by ` · `, and the bold markers around a treatment are emphasis, not value.
 */
function contractRows(markdown: string): ContractRow[] {
  const colors = markdown.slice(markdown.indexOf('\n# Colors'));
  const lines = colors.split('\n');
  const header = lines.findIndex((line) =>
    /^\|\s*Family\s*\|\s*States\s*\|\s*Badge treatment\s*\|\s*Icon\s*\|$/.test(line.trim()),
  );
  if (header < 0) throw new Error('DESIGN.md has no status table under # Colors');

  const rows: ContractRow[] = [];
  for (const line of lines.slice(header + 2)) {
    if (!line.trim().startsWith('|')) break;
    const cells = line
      .trim()
      .replace(/^\|/, '')
      .replace(/\|$/, '')
      .split('|')
      .map((cell) => cell.trim());
    if (cells.length !== 4) throw new Error(`status row has ${cells.length} cells: ${line}`);
    const split = (cell: string): string[] =>
      cell.split('·').map((value) => value.replace(/\*\*/g, '').trim());
    rows.push({
      family: cells[0] as string,
      states: split(cells[1] as string),
      treatments: split(cells[2] as string),
      icons: split(cells[3] as string),
    });
  }
  return rows;
}

const rows = contractRows(design);

/** The transcription, flattened the same way the contract reads. */
const transcribed = STATUS_FAMILIES.map((family) => ({
  family: STATUS_VOCABULARY[family].label,
  states: Object.keys(STATUS_VOCABULARY[family].states),
  treatments: Object.values(
    STATUS_VOCABULARY[family].states as Readonly<Record<string, { treatment: string }>>,
  ).map((state) => state.treatment),
  icons: Object.values(
    STATUS_VOCABULARY[family].states as Readonly<Record<string, { icon: string }>>,
  ).map((state) => state.icon),
}));

describe('the status vocabulary against DESIGN.md', () => {
  it('finds nine rows in the contract and holds nine families', () => {
    expect(rows).toHaveLength(9);
    expect(transcribed).toHaveLength(9);
  });

  it('names the families in the contract’s order and spelling', () => {
    expect(transcribed.map((row) => row.family)).toEqual(rows.map((row) => row.family));
  });

  it.each(rows.map((row) => [row.family, row] as const))(
    '%s carries the contract’s states, treatments and icons',
    (family, row) => {
      const mine = transcribed.find((candidate) => candidate.family === family);
      expect(mine, `no family transcribed for "${family}"`).toBeDefined();
      expect(mine?.states).toEqual(row.states);
      expect(mine?.treatments).toEqual(row.treatments);
      expect(mine?.icons).toEqual(row.icons);
    },
  );

  it('uses only the treatments the contract’s resolution sentence defines', () => {
    const used = new Set(rows.flatMap((row) => row.treatments));
    for (const treatment of used) {
      expect(STATUS_TREATMENTS as readonly string[]).toContain(treatment);
    }
  });

  it('ships a glyph for every icon the table names', () => {
    for (const icon of new Set(rows.flatMap((row) => row.icons))) {
      expect(Object.hasOwn(ICON_GLYPHS, icon), `no self-hosted glyph for "${icon}"`).toBe(true);
    }
  });

  it('gives the four "needs a human" states info-solid and the user icon', () => {
    // DESIGN.md: "Awaiting Auditor, Pending Confirmation, Agent-Judged pending, and a
    // Work Item awaiting an Escalation answer all use {colors.info-solid} with the
    // `user` icon. It is the only solid blue in the product."
    expect(NEEDS_A_HUMAN).toHaveLength(4);
    for (const { family, state } of NEEDS_A_HUMAN) {
      const presentation = statusPresentation(family, state as never);
      expect(presentation.treatment).toBe('info-solid');
      expect(presentation.icon).toBe('user');
    }
  });

  it('gives info-solid to those four states and to nothing else', () => {
    const solids: string[] = [];
    for (const family of STATUS_FAMILIES) {
      for (const [state, definition] of Object.entries(
        STATUS_VOCABULARY[family].states as Readonly<Record<string, { treatment: string }>>,
      )) {
        if (definition.treatment === 'info-solid') solids.push(`${family}:${state}`);
      }
    }
    expect(solids.sort()).toEqual(
      NEEDS_A_HUMAN.map(({ family, state }) => `${family}:${state}`).sort(),
    );
  });

  it('keeps Completed neutral, never green', () => {
    const completed = statusPresentation('run-lifecycle', 'Completed');
    expect(completed.treatment).toBe('neutral');
    expect(completed.icon).toBe('check');
    expect(design).toContain('**Completed is neutral.**');
  });

  it('reserves success for a Result outcome, a passed Gate, Compliant, and Observed', () => {
    const green: string[] = [];
    for (const family of STATUS_FAMILIES) {
      for (const [state, definition] of Object.entries(
        STATUS_VOCABULARY[family].states as Readonly<Record<string, { treatment: string }>>,
      )) {
        if (definition.treatment === 'success') green.push(`${family}:${state}`);
      }
    }
    expect(green.sort()).toEqual([
      'evaluation-value:Compliant',
      'evidence-quality-gate:Passed',
      'result-outcome:Pass',
      'work-item:Observed',
    ]);
  });

  it('gives every state a word and an icon, with no silent grey fallback', () => {
    for (const family of STATUS_FAMILIES) {
      for (const state of Object.keys(STATUS_VOCABULARY[family].states)) {
        const presentation = statusPresentation(family, state as never);
        expect(presentation.word).toBe(state);
        expect(presentation.icon.length).toBeGreaterThan(0);
      }
    }
  });

  it('throws rather than rendering a badge for a state outside the family', () => {
    expect(() => statusPresentation('run-lifecycle' as StatusFamily, 'Approved' as never)).toThrow(
      /Unknown run-lifecycle state/,
    );
  });

  it('shows no Rejected state on the Auditor Review family', () => {
    // "Rejected is never a review state": rejection is history, not a badge.
    expect(Object.keys(STATUS_VOCABULARY['auditor-review'].states)).not.toContain('Rejected');
    expect(Object.keys(STATUS_VOCABULARY['procedure-version'].states)).toContain('Rejected');
  });
});
