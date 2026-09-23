import Link from 'next/link';

import { GATE_CHECKS } from '@intellifin/domain';
import type { RunGateRow } from '@intellifin/infrastructure';

import { Reference } from '../design/Reference';
import { StatusBadge } from '../design/StatusBadge';
import { TechnicalDetails } from '../design/TechnicalDetails';
import { countNoun } from '../design/words';
import { gateCount } from '../design/copy';
import { evidenceChecksMeaning } from '../design/status-words';
import { GATE_GROUPS, gateRowContract, type GateGroup } from './gate-rows';
import { gateWord } from './labels';
import { RESULT_WORDS, withoutSpecReference } from './result-words';

/**
 * The Evidence Quality Gate checklist (DESIGN.md → Evidence Quality Gate checklist;
 * UI cleanup 2026-09-22, UX-20).
 *
 * "Rows grouped under two `{typography.overline}` headers — *Per-Observation checks* and
 * *Run-level checks* — sourced from addendum §H. Each row: status icon, check name and
 * status word, diagnostic detail, and the rule applied. The header count is derived
 * ('18 of 20 checks passed'), never a fixed '9/9'."
 *
 * THE FINDING. All twenty rows were expanded on every Result, so a reader looking for the
 * two that failed scrolled through eighteen that did not, and each of those carried its
 * §H rule text with a specification citation in it. What FAILED is open; what PASSED is
 * one summary line and a disclosure. Nothing is deleted: the rule for every row is still
 * there, one click away, and the exact §H sentence — citation included — is under that
 * row's Technical details, because `gate-rows.test.ts` pins the constant against the
 * addendum on disk and the constant is not what changed.
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
   * panel." Failed rows lead on every Result now — a passed row is never what a reader
   * came for — and this decides only whether they are also repeated in their §H group.
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
        <h2 id="gate-heading">{RESULT_WORDS.gateHeading}</h2>
        <StatusBadge family="evidence-quality-gate" state="Not evaluated" size="md" />
        <p>{notEvaluatedReason}</p>
      </section>
    );
  }

  const byCheck = new Map(rows.map((row) => [row.check, row]));
  const failed = rows.filter((row) => row.outcome === 'FAIL');
  const passed = rows.length - failed.length;
  const word = gateWord(rows.length, failed.length);

  return (
    <section className="ls-card ls-stack" aria-labelledby="gate-heading">
      <h2 id="gate-heading">{RESULT_WORDS.gateHeading}</h2>
      {/* The summary line: the badge, the derived count and what the badge MEANS. A
          passed Gate says it is not a passed control in the same breath (UX-18). */}
      <p className="ls-gate__count">
        <StatusBadge family="evidence-quality-gate" state={word} />{' '}
        {gateCount(passed, rows.length)}
      </p>
      <p className="ls-gate__meaning">{evidenceChecksMeaning(word)}</p>
      {failed.length > 0 ? (
        <div className="ls-stack">
          <h3 className="ls-overline">{countNoun(failed.length, 'check')} that did not pass</h3>
          <ul className="ls-gate">
            {failed.map((row) => (
              <GateRow key={`failed-${row.check}`} row={row} runId={runId} />
            ))}
          </ul>
        </div>
      ) : null}
      {/* Everything that passed, behind one disclosure. It is native `<details>`, so it
          works before hydration and with no JavaScript at all — the standing rule here. */}
      <details className="ls-disclosure">
        <summary>
          {RESULT_WORDS.passedChecks} · {countNoun(passed, 'check')}
        </summary>
        <div className="ls-disclosure__body ls-stack">
          {GATE_GROUPS.map((group) => (
            <GateGroupSection
              key={group.group}
              group={group.group}
              label={group.label}
              byCheck={byCheck}
              runId={runId}
              // A failed row is already open above. Repeating it inside the disclosure
              // would make the summary's own count disagree with what is under it.
              only={failedFirst ? 'passed' : 'all'}
            />
          ))}
        </div>
      </details>
    </section>
  );
}

function GateGroupSection({
  group,
  label,
  byCheck,
  runId,
  only,
}: {
  readonly group: GateGroup;
  readonly label: string;
  readonly byCheck: ReadonlyMap<string, RunGateRow>;
  readonly runId: string;
  readonly only: 'passed' | 'all';
}): React.JSX.Element | null {
  // The addendum's own order, filtered to this group. Never the stored order: the read is
  // sorted by name so two Runs read the same, and §H's order is the auditor's.
  const rows = GATE_CHECKS.filter((check) => gateRowContract(check)?.group === group)
    .map((check) => byCheck.get(check))
    .filter((row): row is RunGateRow => row !== undefined)
    .filter((row) => only === 'all' || row.outcome === 'PASS');
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
 * platform's own words. They are under Technical details with the exact §H rule and the
 * check's stored name: a reader meets the check's name and its rule in ordinary prose,
 * with the code words a click away rather than in front of the sentence they qualify.
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
        {/* The rule, without its specification citation: `gate-rows.ts` still holds §H's
            own sentence and is still pinned against the addendum, and the exact text is
            one row down under Technical details. */}
        {contract === null ? null : <p className="ls-gate__rule">{withoutSpecReference(contract.rule)}</p>}
        {row.diagnostics.length > 0 ? (
          <p className="ls-gate__diagnostic">{countNoun(row.total, 'record')} affected</p>
        ) : null}
        <GateAffected row={row} runId={runId} />
        <TechnicalDetails
          items={[
            { label: 'Check name', value: row.check, mono: true },
            ...(contract === null ? [] : [{ label: 'Rule as the contract states it', value: contract.rule }]),
            ...(row.diagnostics.length === 0
              ? []
              : [{ label: 'Diagnostics', value: row.diagnostics.join(', '), mono: true }]),
            { label: 'Affected total', value: String(row.total), mono: true },
          ]}
        />
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
 *
 * A Work Item is a UUID and a reader never types one, so the LINK carries a short
 * reference and the full identifier rides in its `title` (UX-02).
 */
function GateAffected({ row, runId }: { readonly row: RunGateRow; readonly runId: string }): React.JSX.Element | null {
  if (row.workItems.length === 0 && row.targetSystems.length === 0 && row.records.length === 0) return null;
  return (
    <div className="ls-gate__affected">
      {row.records.length > 0 ? (
        <p>
          Records: <span className="ls-mono">{row.records.join(', ')}</span>
        </p>
      ) : null}
      {row.targetSystems.length > 0 ? (
        <p>
          Target Systems: <span className="ls-mono">{row.targetSystems.join(', ')}</span>
        </p>
      ) : null}
      {row.workItems.length > 0 ? (
        <p>
          {countNoun(row.workItems.length, 'inspection')}:{' '}
          {row.workItems.map((workItemId, index) => (
            <span key={workItemId}>
              {index > 0 ? ', ' : ''}
              <Link href={`/runs/${runId}/timeline#work-item-${workItemId}`}>
                <Reference kind="Inspection" value={workItemId} />
              </Link>
            </span>
          ))}
        </p>
      ) : null}
    </div>
  );
}
