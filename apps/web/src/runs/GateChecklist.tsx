import Link from 'next/link';

import { GATE_CHECKS } from '@intellifin/domain';
import type { RunGateRow } from '@intellifin/infrastructure';

import { StatusBadge } from '../design/StatusBadge';
import { gateCount } from '../design/copy';
import { GATE_GROUPS, gateRowContract, type GateGroup } from './gate-rows';
import { countText } from './labels';

/**
 * The Evidence Quality Gate checklist (DESIGN.md → Evidence Quality Gate checklist).
 *
 * "Rows grouped under two `{typography.overline}` headers — *Per-Observation checks* and
 * *Run-level checks* — sourced from addendum §H. Each row: status icon, check name and
 * status word, diagnostic detail, and the rule applied. The header count is derived
 * ('18 of 20 checks passed'), never a fixed '9/9'."
 *
 * It reads what Story 3.8 stored and re-judges nothing. A Run that never reached the Gate
 * has NO rows, and that is said in words: an unrun Gate is not a passed Gate, and an empty
 * checklist rendered as though the Gate had run and found nothing is the one thing this
 * component must never do — a Run canceled while queued is exactly that case.
 */

export interface GateChecklistProps {
  readonly rows: readonly RunGateRow[];
  readonly runId: string;
  /**
   * Whether to lead with the failed rows.
   *
   * EXPERIENCE.md → Run Detail / Inconclusive: "Failed Gate rows first; Safe next action
   * panel." The two groups stay intact below it, so the checklist is still the §H table.
   */
  readonly failedFirst: boolean;
  /** Said when the Gate never ran, so an absence is never read as a pass. */
  readonly notEvaluatedReason: string;
}

export function GateChecklist({
  rows,
  runId,
  failedFirst,
  notEvaluatedReason,
}: GateChecklistProps): React.JSX.Element {
  if (rows.length === 0) {
    return (
      <section className="ls-card ls-stack" aria-labelledby="gate-heading">
        <h2 id="gate-heading">Evidence Quality Gate</h2>
        <StatusBadge family="evidence-quality-gate" state="Not evaluated" size="md" />
        <p>{notEvaluatedReason}</p>
      </section>
    );
  }

  const byCheck = new Map(rows.map((row) => [row.check, row]));
  const failed = rows.filter((row) => row.outcome === 'FAIL');
  const passed = rows.length - failed.length;

  return (
    <section className="ls-card ls-stack" aria-labelledby="gate-heading">
      <h2 id="gate-heading">Evidence Quality Gate</h2>
      <p className="ls-gate__count">{gateCount(passed, rows.length)}</p>
      {failedFirst && failed.length > 0 ? (
        <div className="ls-stack">
          <h3 className="ls-overline">Failed checks</h3>
          <ul className="ls-gate">
            {failed.map((row) => (
              <GateRow key={`failed-${row.check}`} row={row} runId={runId} />
            ))}
          </ul>
        </div>
      ) : null}
      {GATE_GROUPS.map((group) => (
        <GateGroupSection
          key={group.group}
          group={group.group}
          label={group.label}
          byCheck={byCheck}
          runId={runId}
        />
      ))}
    </section>
  );
}

function GateGroupSection({
  group,
  label,
  byCheck,
  runId,
}: {
  readonly group: GateGroup;
  readonly label: string;
  readonly byCheck: ReadonlyMap<string, RunGateRow>;
  readonly runId: string;
}): React.JSX.Element | null {
  // The addendum's own order, filtered to this group. Never the stored order: the read is
  // sorted by name so two Runs read the same, and §H's order is the auditor's.
  const rows = GATE_CHECKS.filter((check) => gateRowContract(check)?.group === group)
    .map((check) => byCheck.get(check))
    .filter((row): row is RunGateRow => row !== undefined);
  if (rows.length === 0) return null;
  const passed = rows.filter((row) => row.outcome === 'PASS').length;
  return (
    <div className="ls-stack">
      <h3 className="ls-overline">
        {label} · {gateCount(passed, rows.length)}
      </h3>
      <ul className="ls-gate">
        {rows.map((row) => (
          <GateRow key={row.check} row={row} runId={runId} />
        ))}
      </ul>
    </div>
  );
}

/**
 * One §H row.
 *
 * The diagnostics are a CLOSED vocabulary of constants from the domain — never an error
 * message, never a captured value, never a credential reference — so they are the
 * platform's own words and are rendered as the identifiers they are, in monospace. The
 * rule beside them is §H's own second cell, which is what tells a reader what the row
 * was actually checking.
 */
function GateRow({ row, runId }: { readonly row: RunGateRow; readonly runId: string }): React.JSX.Element {
  const contract = gateRowContract(row.check);
  const heading = contract?.heading ?? row.check;
  return (
    <li className={`ls-gate__row ls-gate__row--${row.outcome === 'PASS' ? 'pass' : 'fail'}`}>
      <StatusBadge
        family="evidence-quality-gate"
        state={row.outcome === 'PASS' ? 'Passed' : 'Not passed'}
      />
      <div className="ls-stack">
        <p className="ls-gate__name">{heading}</p>
        {row.diagnostics.length > 0 ? (
          <p className="ls-gate__diagnostic">
            {row.diagnostics.map((diagnostic) => (
              <code className="ls-mono" key={diagnostic}>
                {diagnostic}
              </code>
            ))}{' '}
            · {countText(row.total)} affected
          </p>
        ) : null}
        {contract === null ? null : <p className="ls-gate__rule">{contract.rule}</p>}
        <GateAffected row={row} runId={runId} />
      </div>
    </li>
  );
}

/**
 * The identities a failed row names.
 *
 * EXPERIENCE.md: "Each failed row links to the affected Work Items." The link is to the
 * Execution Timeline anchored at that Work Item, which is where a Work Item actually
 * exists on this surface — never to a page that does not exist. A passing row names
 * nothing at all, and generation 24 refuses one that does.
 */
function GateAffected({ row, runId }: { readonly row: RunGateRow; readonly runId: string }): React.JSX.Element | null {
  if (row.workItems.length === 0 && row.targetSystems.length === 0 && row.records.length === 0) return null;
  return (
    <div className="ls-gate__affected">
      {row.workItems.length > 0 ? (
        <p>
          Work Items:{' '}
          {row.workItems.map((workItemId, index) => (
            <span key={workItemId}>
              {index > 0 ? ', ' : ''}
              <Link className="ls-mono" href={`/runs/${runId}/timeline#work-item-${workItemId}`}>
                {workItemId}
              </Link>
            </span>
          ))}
        </p>
      ) : null}
      {row.targetSystems.length > 0 ? (
        <p>
          Target Systems: <span className="ls-mono">{row.targetSystems.join(', ')}</span>
        </p>
      ) : null}
      {row.records.length > 0 ? (
        <p>
          Records: <span className="ls-mono">{row.records.join(', ')}</span>
        </p>
      ) : null}
    </div>
  );
}
