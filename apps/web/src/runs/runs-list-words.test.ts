import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { STATUS_COLUMN_WORDS } from '../design/status-words';
import { RUNS_CAPTION, RUNS_COLUMNS, RUNS_COLUMN_ORDER, RUNS_LEDE, RUNS_TITLE } from './runs-list-words';

/**
 * The Runs register's own sentences (UI cleanup 2026-09-22, UX-17).
 *
 * The finding was a ten-column table whose first cell was a raw UUID and which scrolled
 * the WHOLE PAGE sideways at a laptop's width. What is pinned here is the revised column
 * set, that three of its headers are the SHARED status questions, and that the caption
 * says out loud which column was removed and why.
 */

const experience = readFileSync(
  fileURLToPath(
    new URL(
      '../../../../_bmad-output/planning-artifacts/ux-designs/ux-IntelliFin Audit-2026-09-01/EXPERIENCE.md',
      import.meta.url,
    ),
  ),
  'utf8',
);

describe('the Runs register words', () => {
  it("is EXPERIENCE.md's revised column set, in its order", () => {
    // Read off disk, never compared with a copy of itself: the contract's own Data tables
    // row now names these six for the Runs table.
    expect(experience).toContain(
      'Runs: Run (the Procedure name, with the short reference and the effective period beneath it) · Execution · Assessment · Evidence checks · Started (by whom, when, and elapsed) · Change',
    );
    expect(RUNS_COLUMN_ORDER.map((key) => RUNS_COLUMNS[key])).toEqual([
      'Run',
      'Execution',
      'Assessment',
      'Evidence checks',
      'Started',
      'Change',
    ]);
  });

  it('uses the shared status questions, so three families cannot read as one thing', () => {
    // A copy of these words here would let the Runs table and the Run header disagree
    // about which question a column answers.
    expect(RUNS_COLUMNS.execution).toBe(STATUS_COLUMN_WORDS.execution);
    expect(RUNS_COLUMNS.assessment).toBe(STATUS_COLUMN_WORDS.assessment);
    expect(RUNS_COLUMNS.evidenceChecks).toBe(STATUS_COLUMN_WORDS.evidenceChecks);
  });

  it('says in the caption that the Review column is absent, and why', () => {
    // A column silently removed is a reader wondering where it went. EXPERIENCE.md's own
    // row says the Review column "joins the table when Result review exists".
    expect(experience).toContain('the Review column joins the table when Result review exists');
    expect(RUNS_CAPTION).toContain('A Review column joins this table when a Result can be sent for review');
    expect(RUNS_CAPTION).toContain('this release cannot send one');
  });

  it("is the cleanup plan's own lede for the register", () => {
    expect(RUNS_TITLE).toBe('Runs');
    expect(RUNS_LEDE).toBe(
      'Every Run, newest first: what it tested, how it ended, and whether its evidence can be relied on.',
    );
  });

  it('is rendered from this module by the page and the table, never retyped', () => {
    for (const path of ['../../app/runs/page.tsx', './RunsTable.tsx']) {
      // Comments stripped first: both files QUOTE the old column names to explain what
      // changed, and a scan that matched prose would fail on the explanation.
      const source = readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^\s*\/\/.*$/gm, '');
      expect(source, path).not.toContain(RUNS_LEDE);
      expect(source, path).not.toContain("'Lifecycle'");
      expect(source, path).not.toContain("'Result outcome'");
      expect(source, path).not.toContain("'Gate'");
    }
  });
});
