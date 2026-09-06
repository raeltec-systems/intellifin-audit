import type { RunState } from '@intellifin/domain';
import type { RunResultRow } from '@intellifin/infrastructure';

import { Icon } from '../design/Icon';
import { StatusBadge } from '../design/StatusBadge';
import { NO_RESULT_STATEMENT, UNREADABLE_PUBLICATION } from '../design/copy';
import { gateWord, resultOutcomeWord, runLifecycleWord } from './labels';

/**
 * The conclusion triptych (DESIGN.md → Conclusion triptych; EXPERIENCE.md → Component
 * Patterns).
 *
 * "Three equal cells divided by hairlines — Run lifecycle, Evidence Quality Gate, Result
 * outcome — over a single plain-language statement of what was evaluated. The third cell
 * carries the outcome badge, a sealed/unsealed marker (`lock` when sealed, `user` when
 * Pending Confirmation), and the Result version in `{typography.mono}`, always shown."
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
}: {
  readonly state: RunState;
  readonly result: RunResultRow | null;
  readonly gateChecks: number;
  readonly gateFailed: number;
}): React.JSX.Element {
  const lifecycle = runLifecycleWord(state);
  const outcome = resultOutcomeWord(result?.outcome ?? null);
  const pending = result !== null && result.outcome === 'PENDING_CONFIRMATION';
  return (
    <section className="ls-card ls-stack" aria-labelledby="conclusion-heading">
      <h2 id="conclusion-heading">Conclusion</h2>
      <div className="ls-triptych">
        <div className="ls-triptych__cell">
          <p className="ls-overline">Run lifecycle</p>
          {lifecycle === null ? (
            <p>{state}</p>
          ) : (
            <StatusBadge family="run-lifecycle" state={lifecycle} size="md" />
          )}
        </div>
        <div className="ls-triptych__cell">
          <p className="ls-overline">Evidence Quality Gate</p>
          <StatusBadge
            family="evidence-quality-gate"
            state={gateWord(gateChecks, gateFailed)}
            size="md"
          />
        </div>
        <div className="ls-triptych__cell">
          <p className="ls-overline">Result outcome</p>
          {outcome === null ? (
            <p>{result?.outcome}</p>
          ) : (
            <StatusBadge family="result-outcome" state={outcome} size="md" />
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
