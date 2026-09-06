import type { RunEvaluationRow, RunExceptionRow } from '@intellifin/infrastructure';

import { Digest } from '../design/Digest';
import { StatusBadge } from '../design/StatusBadge';
import { MASKED_BY_BINDING, MASKED_VALUE } from '../design/copy';
import { UntrustedList } from './UntrustedText';
import { evaluationOriginWord, evaluationValueWord, utcStamp } from './labels';

/**
 * The Exception list (DESIGN.md → Exception list row; EXPERIENCE.md → Exception list row).
 *
 * "identifier link in `{typography.mono}` with the Exception state badge, the condition
 * violated in `{typography.body-sm-relaxed}`, origin badge, masked identity where the
 * binding designates it, and a persistent 'Open' link on the right."
 *
 * THERE IS NO "Open" LINK. Exception Detail is a later epic, and inventing an `href` to a
 * page that does not exist would satisfy the letter of the rule while sending an auditor
 * to a 404 — the same call `DataTable`'s optional first-cell `href` records. What the
 * reader needs is here instead: the conditions that failed, their evaluation cards, and
 * the fingerprint that makes this finding recognisable in a later Run.
 *
 * THE STATE IS `Open`, and that is derived rather than stored. FR-42's Exception state
 * machine starts at Open and disposition is Epic 6, so no Exception in this environment
 * has ever transitioned. It is the same reading as "no Result row means no conclusion has
 * been issued": a fact about what has happened, not a placeholder.
 */
export function ExceptionCard({
  exception,
  evaluations,
  conditionText,
  masked,
}: {
  readonly exception: RunExceptionRow;
  /** The per-condition evaluations of this Exception's own Observation. */
  readonly evaluations: readonly RunEvaluationRow[];
  readonly conditionText: (conditionId: string) => string | null;
  /** Whether the binding designates this Run's matching key column sensitive (FR-41). */
  readonly masked: boolean;
}): React.JSX.Element {
  return (
    <li className="ls-exception" id={`exception-${exception.exceptionId}`}>
      <p className="ls-exception__header">
        <span className="ls-mono">{exception.exceptionId}</span>
        <StatusBadge family="exception" state="Open" />
      </p>
      <dl className="ls-definition">
        <div>
          <dt>Population record</dt>
          <dd className="ls-mono">
            {masked ? (
              <>
                <span aria-hidden="true">{MASKED_VALUE}</span>
                <span className="ls-visually-hidden">{MASKED_BY_BINDING}</span>
              </>
            ) : (
              exception.populationRecordKey
            )}
          </dd>
        </div>
        {masked ? (
          <div>
            <dt>Masking</dt>
            <dd>{MASKED_BY_BINDING}</dd>
          </div>
        ) : null}
        <div>
          <dt>Target System</dt>
          <dd className="ls-mono">{exception.targetSystem}</dd>
        </div>
        <div>
          <dt>Raised at (UTC)</dt>
          <dd className="ls-mono">{utcStamp(exception.raisedAt)}</dd>
        </div>
        <div>
          <dt>Fingerprint</dt>
          {/* HMAC-SHA-256 hex. The Run is deliberately outside it, so the same control
              failure recurring next month fingerprints the same and is recognisable. */}
          <Digest as="dd" label="Exception fingerprint" value={exception.fingerprint} />
        </div>
      </dl>
      <h3 className="ls-overline">Conditions violated</h3>
      <ul className="ls-plain-list">
        {exception.conditionIds.map((conditionId) => {
          const evaluation = evaluations.find((entry) => entry.conditionId === conditionId) ?? null;
          const origin = evaluation === null ? null : evaluationOriginWord(evaluation.origin, evaluation.confirmation);
          const value = evaluation === null ? null : evaluationValueWord(evaluation.value);
          const text = conditionText(conditionId);
          return (
            <li className="ls-evaluation" key={conditionId}>
              <p className="ls-evaluation__badges">
                {origin === null ? null : <StatusBadge family="evaluation-origin" state={origin} />}
                {value === null ? null : <StatusBadge family="evaluation-value" state={value} />}
              </p>
              <p className="ls-evaluation__condition">
                <span className="ls-mono">{conditionId}</span>
                {text === null ? null : <> — {text}</>}
              </p>
              {/* A rule's own reason. The deterministic evaluator writes no free text, and
                  `rationale` is null for every evaluation this epic produces; it is
                  rendered as untrusted anyway, because a later origin can carry one. */}
              {evaluation?.rationale ? (
                <UntrustedList field="evaluation rationale" values={[evaluation.rationale]} />
              ) : null}
              {evaluation?.diagnostic ? (
                <UntrustedList field="evaluation diagnostic" values={[evaluation.diagnostic]} />
              ) : null}
            </li>
          );
        })}
      </ul>
      {/*
        The compiled rules' own reasons — for P-2 this is where "report every prohibited
        pair" lives. A diagnostic MUST name an unknown value, so a Target System that
        answers with a sentence addressed to the auditor gets it stored here. It is data.
      */}
      <UntrustedList field="Exception diagnostics" values={exception.diagnostics} />
    </li>
  );
}
