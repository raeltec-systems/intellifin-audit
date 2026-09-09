import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';
import {
  auditEvents,
  runEvidence,
  runEvidenceCapture,
  runSessionStep,
  runStepExecution,
  runReplayRecording,
  runToolAction,
  runWait,
} from '@intellifin/infrastructure/db';

/**
 * The Replay asset set, checked against the SCHEMA rather than against a copy of itself.
 *
 * `docs/contracts/replay-asset-set-v1.md` names every column a terminal Run is replayed
 * from. That document is a promise about durable storage, and a promise nothing compares
 * with the storage is one that drifts the first time a column is renamed — silently,
 * because Replay is the one surface that reads all of them together and it is the last
 * thing anybody runs.
 *
 * This is the `gate-vocabulary.test.ts` discipline one contract along: read the table off
 * disk, and require the code to agree with it.
 */
const CONTRACT = fileURLToPath(
  new URL('../../docs/contracts/replay-asset-set-v1.md', import.meta.url),
);

/**
 * SQL table name to its schema object.
 *
 * Hand-kept, and safe to be: a contract row naming a table that is not here FAILS rather
 * than being skipped, and the asset list is pinned separately — so a table cannot be
 * quietly dropped from either side without a red test.
 */
const TABLES: Readonly<Record<string, object>> = {
  audit_events: auditEvents,
  run_evidence: runEvidence,
  run_evidence_capture: runEvidenceCapture,
  run_replay_recording: runReplayRecording,
  run_session_step: runSessionStep,
  run_step_execution: runStepExecution,
  run_tool_action: runToolAction,
  run_wait: runWait,
};

/** Every SQL column name a Drizzle table object carries. */
const columnsOf = (table: string): readonly string[] | null => {
  if (!Object.hasOwn(TABLES, table)) return null;
  return Object.values(TABLES[table]!)
    .map((column) => (column as { name?: unknown }).name)
    .filter((name): name is string => typeof name === 'string');
};

/** The `| asset | table | columns |` rows of the contract's own table. */
function contractRows(): { asset: string; table: string; columns: string[] }[] {
  const markdown = readFileSync(CONTRACT, 'utf8');
  return markdown
    .split('\n')
    .filter((line) => line.startsWith('| ') && line.includes('` |'))
    .map((line) => line.split('|').map((cell) => cell.trim()))
    .filter((cells) => cells.length === 5)
    .map((cells) => ({
      asset: cells[1]!,
      table: cells[2]!.replaceAll('`', ''),
      columns: cells[3]!
        .split(',')
        .map((column) => column.trim().replaceAll('`', ''))
        .filter((column) => column.length > 0),
    }));
}

describe('the Replay asset set contract', () => {
  const rows = contractRows();

  it('names every asset the story delivers', () => {
    // A row silently dropped from the table would take its columns out of this check with
    // it, and the suite would stay green over a contract that had stopped saying anything.
    expect(rows.map((row) => row.asset)).toEqual([
      'Frame',
      'Frame binding',
      'Sanitized action',
      'Session Step',
      'Step Execution',
      'Escalation',
      'Observation delta',
      'Session recording',
    ]);
  });

  it.each(contractRows().map((row) => [row.asset, row.table, row.columns] as const))(
    '%s reads %s, and every column it names exists',
    (_asset, table, columns) => {
      const actual = columnsOf(table);
      expect(actual, `the contract names a table the schema does not have: ${table}`).not.toBeNull();
      expect(columns.length).toBeGreaterThan(0);
      for (const column of columns) {
        expect(actual, `${table}.${column} is named by the contract and is not in the schema`).toContain(column);
      }
    },
  );
});
