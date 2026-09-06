import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';
import {
  OUTCOME_ROWS,
  PROCEDURE_TEMPLATE_IDS,
  RESULT_STATEMENTS,
  SYSTEM_OUTCOMES,
  TEMPLATE_RESULT_FIELDS,
  declaredObservationFields,
  systemOutcome,
  type OutcomeFacts,
  type SystemOutcome,
} from '@intellifin/domain';

/**
 * The §E.1 outcome table, checked against the ADDENDUM ON DISK.
 *
 * `OUTCOME_ROWS` is a transcription of a table somebody else wrote, and a transcription is
 * worth nothing unless something compares it with its source — "never assert a contract
 * against a copy of itself", now for the table that decides what an audit Run concluded.
 *
 * The rows are prose, so the comparison is cell by cell: the addendum's first, second and
 * fourth columns are required verbatim, and the third is required to NAME the outcome the
 * row produces. The order is required too, because the order is the contract.
 */

const ADDENDUM = fileURLToPath(
  new URL(
    '../../_bmad-output/planning-artifacts/prds/prd-IntelliFin Audit-2026-08-31/addendum.md',
    import.meta.url,
  ),
);

interface AddendumRow {
  readonly evidence: string;
  readonly evaluation: string;
  readonly outcome: string;
  readonly action: string;
}

function addendumSection(heading: string): string {
  const text = readFileSync(ADDENDUM, 'utf8');
  const start = text.indexOf(heading);
  expect(start, heading).toBeGreaterThan(0);
  const end = text.indexOf('\n## ', start + 1);
  return text.slice(start, end === -1 ? undefined : end);
}

/** The §E.1 table, in the addendum's own order. */
function outcomeRows(): readonly AddendumRow[] {
  const section = addendumSection('### E.1 Normative Outcome Rules');
  const rows: AddendumRow[] = [];
  for (const line of section.split('\n')) {
    if (!line.startsWith('| ')) continue;
    const cells = line.split('|').map((cell) => cell.trim());
    const evidence = cells[1] ?? '';
    if (evidence === '' || evidence === 'Evidence or execution state' || /^-+$/.test(evidence)) continue;
    rows.push({
      evidence,
      evaluation: cells[2] ?? '',
      outcome: cells[3] ?? '',
      action: cells[4] ?? '',
    });
  }
  return rows;
}

/** The addendum's own name for each outcome, as its "Result outcome" cell opens. */
const OUTCOME_NAMES: Readonly<Record<SystemOutcome, string>> = {
  CANCELED: 'Canceled',
  RUN_FAILED: 'Run Failed',
  INCONCLUSIVE: 'Inconclusive',
  PENDING_CONFIRMATION: 'Pending Confirmation',
  CONTROL_FAILURE: 'Control Failure',
  PASS: 'Pass',
};

describe('the §E.1 outcome table', () => {
  it('has exactly the addendum rows, in the addendum order', () => {
    const rows = outcomeRows();
    expect(rows).toHaveLength(OUTCOME_ROWS.length);
    for (const [index, row] of rows.entries()) {
      const transcribed = OUTCOME_ROWS[index]!;
      expect(row.evidence, `row ${String(index + 1)} evidence state`).toBe(transcribed.evidenceState);
      expect(row.evaluation, `row ${String(index + 1)} evaluation state`).toBe(
        transcribed.evaluationState,
      );
      expect(row.action, `row ${String(index + 1)} human action`).toBe(transcribed.humanAction);
      expect(row.outcome, `row ${String(index + 1)} outcome`).toContain(
        OUTCOME_NAMES[transcribed.outcome],
      );
    }
  });

  it('says "the first matching row wins", which is what the order is for', () => {
    expect(addendumSection('### E.1 Normative Outcome Rules')).toContain(
      'Rows apply in order; the first matching row wins.',
    );
  });

  it('marks exactly the row the addendum calls unsealed', () => {
    const rows = outcomeRows();
    for (const [index, row] of rows.entries()) {
      expect(OUTCOME_ROWS[index]!.sealed, row.outcome).toBe(!row.outcome.includes('(unsealed)'));
    }
  });

  it('reaches every sealing row only when the Gate passed', () => {
    // The three rows whose evidence cell reads "Gate passes, sealed", plus the Pending
    // Confirmation row's "Gate passes". None of them may be the FIRST match while the Gate
    // has not passed: that is what makes a passed Gate necessary for a Pass, and it is a
    // property of the ORDER rather than of any one predicate.
    const rows = outcomeRows();
    const facts: OutcomeFacts = {
      runState: 'COMPLETED',
      gatePassed: false,
      pending: 1,
      unevaluated: 1,
      exceptions: 1,
    };
    const decided = systemOutcome(facts);
    const matchedIndex = OUTCOME_ROWS.findIndex((row) => row.id === decided.row);
    expect(rows[matchedIndex]!.evidence.startsWith('Gate passes')).toBe(false);
    expect(decided.outcome).toBe('INCONCLUSIVE');
  });

  it('gives every outcome in the vocabulary a published sentence', () => {
    for (const outcome of SYSTEM_OUTCOMES) {
      expect(Object.hasOwn(RESULT_STATEMENTS, outcome)).toBe(true);
      expect(RESULT_STATEMENTS[outcome]).not.toBe('');
    }
    expect(Object.keys(RESULT_STATEMENTS).sort()).toEqual([...SYSTEM_OUTCOMES].sort());
  });

  it('preserves the §E sentence the Result seal implements', () => {
    expect(addendumSection('## E. State Models and Outcome Rules')).toContain(
      'The System Outcome is computed once at sealing and is immutable thereafter.',
    );
  });
});

describe('the §C control-specific fields the Result reports', () => {
  it('names only fields the Template itself declares', () => {
    // A field a Template does not declare is a field no Observation carries and no rule
    // reads, so publishing it would print an empty cell on every Result forever.
    for (const templateId of PROCEDURE_TEMPLATE_IDS) {
      const declared = declaredObservationFields(templateId);
      expect(declared.length).toBeGreaterThan(0);
      for (const field of TEMPLATE_RESULT_FIELDS[templateId]) {
        expect(declared, `${templateId} declares ${field}`).toContain(field);
      }
    }
  });

  it('reports what addendum §C says each control turns on', () => {
    // Read from §C on disk rather than asserted against a copy of the table: each
    // Template's own Compliant/Exception sentences name the values an auditor checks.
    const section = addendumSection('## C. Procedure Template Contracts');
    // P-2: "At least one prohibited pair exists; report every pair." The pairs come out of
    // the roles, which is why `roles` is the field the Result publishes for it.
    expect(section).toContain('At least one prohibited pair exists; report every pair.');
    expect(TEMPLATE_RESULT_FIELDS['P-2']).toEqual(['roles']);
    // P-3: "a matching `APPROVED` decision exists before processing and the approver's
    // limit is at least the transaction amount" — the decision and the limit.
    expect(section).toContain("the approver's limit is at least the transaction amount");
    expect(TEMPLATE_RESULT_FIELDS['P-3']).toEqual(['decision', 'approver_limit']);
    // P-1 turns on `account_status` and declares `username` and `roles` beside it.
    expect(section).toContain('Exception when `account_status = active`');
    expect(TEMPLATE_RESULT_FIELDS['P-1']).toEqual(['account_status', 'username', 'roles']);
    // P-4 compares the observed value with the approved baseline.
    expect(section).toContain('Observed and approved normalized values are equal.');
    expect(TEMPLATE_RESULT_FIELDS['P-4']).toEqual(['observed_value', 'approved_value']);
  });
});
