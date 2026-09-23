import type { RunState } from '@intellifin/domain';
import type { RunResultRow } from '@intellifin/infrastructure';

import { Icon } from '../design/Icon';
import { StatusBadge } from '../design/StatusBadge';
import { NO_RESULT_STATEMENT, UNREADABLE_PUBLICATION } from '../design/copy';
import {
  STATUS_COLUMN_WORDS,
  assessmentMeaning,
  evidenceChecksMeaning,
  executionMeaning,
  pendingAssessmentSentence,
} from '../design/status-words';
import { gateWord, resultOutcomeWord, runLifecycleWord } from './labels';

/**
 * The conclusion triptych (DESIGN.md → Conclusion triptych; EXPERIENCE.md → Component
 * Patterns; UI cleanup 2026-09-22, UX-18).
 *
 * EXPERIENCE.md's revised row: "Cells are Execution (lifecycle), Assessment (Result
 * outcome) and Evidence checks (Gate), in that order and under those labels, each with a
 * one-line meaning under its badge so that evidence validity, control compliance and a
 * person's review are never read as one thing."
 *
 * THE FINDING. The walkthrough met `Completed`, `Control Failure` and a green `Passed` on
 * one line, labelled `Run lifecycle`, `Evidence Quality Gate` and `Result outcome` — three
 * platform nouns that say which TABLE a word came from and not which QUESTION it answers.
 * A reader could take a passed Evidence Quality Gate for a passed control, or a finished
 * Run for a finished review. The labels are the three questions now, the meanings are
 * `status-words.ts`'s, and Assessment sits in the middle because it is what a reader came
 * for; Evidence checks sits last because it qualifies the assessment rather than being it.
 *
 * NO CELL IS CLICKABLE. The tabs are the navigation, and a cell that navigated would make
 * the screen's primary object a control. There is no link, no button and no handler in
 * this component, so one cannot be added by accident.
 *
 * The statement is the Result's own, published by `publishRunResult` and stored on the
 * row. It is READ, never recomputed here: a second implementation of "what did this Run
 * conclude" would agree on every case anybody tried and diverge on the first one nobody
 * did, and here the divergence is an audit conclusion.
 */
export function ConclusionTriptych({
  state,
  result,
  gateChecks,
  gateFailed,
  pendingCount,
}: {
  readonly state: RunState;
  readonly result: RunResultRow | null;
  readonly gateChecks: number;
  readonly gateFailed: number;
  /**
   * How many of the agent's assessments still need a person, read from the effective
   * evaluations. The Assessment cell says the number and what it asks for rather than
   * leaving `Pending Confirmation` as a badge nobody can act on; `null` means the count
   * could not be read, which is said rather than shown as a zero.
   */
  readonly pendingCount?: number | null;
}): React.JSX.Element {
  const lifecycle = runLifecycleWord(state);
  const outcome = resultOutcomeWord(result?.outcome ?? null);
  const gate = gateWord(gateChecks, gateFailed);
  const pending = result !== null && result.outcome === 'PENDING_CONFIRMATION';
  return (
    <section className="ls-card ls-stack" aria-labelledby="conclusion-heading">
      <h2 id="conclusion-heading">Conclusion</h2>
      <div className="ls-triptych">
        <div className="ls-triptych__cell">
          <p className="ls-overline">{STATUS_COLUMN_WORDS.execution}</p>
          {lifecycle === null ? (
            <p>{state}</p>
          ) : (
            <>
              <StatusBadge family="run-lifecycle" state={lifecycle} size="md" />
              <p className="ls-triptych__meaning">{executionMeaning(lifecycle)}</p>
            </>
          )}
        </div>
        <div className="ls-triptych__cell">
          <p className="ls-overline">{STATUS_COLUMN_WORDS.assessment}</p>
          {outcome === null ? (
            <p>{result?.outcome}</p>
          ) : (
            <>
              <StatusBadge family="result-outcome" state={outcome} size="md" />
              {/* An unsealed Result says what it needs from the reader, with the exact
                  count, instead of a badge word they cannot act on. A count that could
                  not be read says so: a zero would claim nothing is waiting. */}
              <p className="ls-triptych__meaning">
                {pending && pendingCount !== null && pendingCount !== undefined
                  ? pendingAssessmentSentence(pendingCount)
                  : assessmentMeaning(outcome)}
              </p>
            </>
          )}
          {result === null ? (
            // Never a dash and never a fabricated version: nothing has been published, so
            // there is no version to show and the cell says exactly that.
            <p className="ls-triptych__marker">No Result version. No Result has been published.</p>
          ) : (
            <>
              <p className="ls-triptych__marker">
                <Icon name={pending ? 'user' : 'lock'} size={14} />
                {result.sealed ? 'Sealed' : 'Unsealed'}
              </p>
              <p className="ls-triptych__version">
                Result version <span className="ls-mono">{result.version}</span>
              </p>
            </>
          )}
        </div>
        <div className="ls-triptych__cell">
          <p className="ls-overline">{STATUS_COLUMN_WORDS.evidenceChecks}</p>
          <StatusBadge family="evidence-quality-gate" state={gate} size="md" />
          {/* "Evidence checks passed" is never "the control passed", and the sentence
              under the badge is where that is said rather than left to be inferred. */}
          <p className="ls-triptych__meaning">{evidenceChecksMeaning(gate)}</p>
        </div>
      </div>
      <p className="ls-triptych__statement">
        {result === null
          ? NO_RESULT_STATEMENT
          : (result.publication?.statement ?? UNREADABLE_PUBLICATION)}
      </p>
      {result?.scope ? (
        <div>
          <p className="ls-overline">Scope</p>
          {/* The auditor's own sentence about what the Run covered, verbatim. Rewording
              it, truncating it or generating a replacement would put the platform's words
              where a human's belong. */}
          <p className="ls-whitespace">{result.scope}</p>
        </div>
      ) : null}
    </section>
  );
}
