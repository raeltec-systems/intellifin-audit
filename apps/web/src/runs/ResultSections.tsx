import { OUTCOME_ROWS, type RunResultPublication } from '@intellifin/domain';
import type { RunResultRow } from '@intellifin/infrastructure';

import { Digest } from '../design/Digest';
import { Icon } from '../design/Icon';
import { StatusBadge } from '../design/StatusBadge';
import {
  EXECUTION_FAILURE_HEADING,
  SAFE_NEXT_ACTION_HEADING,
} from '../design/copy';
import { UntrustedList } from './UntrustedText';
import { countText, evaluationOriginWord, evaluationValueWord, utcStamp } from './labels';

/**
 * The Result tab's sections beneath the triptych.
 *
 * Everything here is READ from the sealed Result's published document. Nothing is
 * recomputed: `publishRunResult` derived the counts, the coverage matrix and the statement
 * inside the transaction that concluded the Run, and a second derivation on the way to a
 * screen would be a second answer to what the Run concluded.
 */

/**
 * Population reconciliation (DESIGN.md → Population reconciliation).
 *
 * "File-level rows (declared, parsed, digest) above inclusion-level rows (rows in,
 * included, excluded with reason)… Excluded, Uninspected, and Unevaluated counts are
 * always present."
 *
 * The raw excluded and indeterminate ROWS live on the Evidence tab, beside the
 * acquisition that produced them; EXPERIENCE.md's "excluded rows expand to the exclusion
 * reason list" is the reason list below, which the sealed Result publishes.
 *
 * The DECLARED count is not among them, and cannot be: it is checked at acquisition and
 * the verdict is stored, but the number itself lives only inside the frozen acquisition
 * envelope in object storage, which this surface may not read (`no-evidence-store-in-web`).
 * So the row states the §H verdict and says where the declaration is, rather than showing
 * a number nobody stored or a dash a reader takes for "fine".
 */
export function PopulationReconciliation({
  publication,
  rowsDigest,
  declaredCountPassed,
  uninspected,
}: {
  readonly publication: RunResultPublication;
  readonly rowsDigest: string | null;
  readonly declaredCountPassed: boolean | null;
  readonly uninspected: number;
}): React.JSX.Element {
  const population = publication.population;
  return (
    <section className="ls-card ls-stack" aria-labelledby="population-reconciliation">
      <h2 id="population-reconciliation">Population reconciliation</h2>
      <h3 className="ls-overline">File level</h3>
      <dl className="ls-definition ls-reconciliation">
        <div>
          <dt>Declared count and digest</dt>
          <dd>
            {declaredCountPassed === null
              ? 'Not reconciled: the population was never acquired.'
              : declaredCountPassed
                ? 'Reconciled exactly against the independent declaration.'
                : 'Did not reconcile against the independent declaration.'}{' '}
            The declaration itself is frozen in the acquisition envelope Evidence, not
            stored as a column.
          </dd>
        </div>
        <div>
          <dt>Rows parsed</dt>
          <dd className="ls-mono">{countText(population.rowsParsed)}</dd>
        </div>
        <div>
          <dt>Digest of the parsed rows</dt>
          {rowsDigest === null ? (
            <dd>Not recorded: the population was never parsed.</dd>
          ) : (
            <Digest as="dd" label="Population rows" value={rowsDigest} />
          )}
        </div>
      </dl>
      <h3 className="ls-overline">Inclusion level</h3>
      <dl className="ls-definition ls-reconciliation">
        <div>
          <dt>Rows in</dt>
          <dd className="ls-mono">{countText(population.rowsParsed)}</dd>
        </div>
        <div>
          <dt>Included</dt>
          <dd className="ls-mono">{countText(population.included)}</dd>
        </div>
        <div>
          <dt>Excluded</dt>
          <dd className="ls-mono">{countText(population.excluded)}</dd>
        </div>
        <div>
          <dt>Indeterminate</dt>
          <dd className={population.indeterminate > 0 ? 'ls-mono ls-difference' : 'ls-mono'}>
            {countText(population.indeterminate)}
          </dd>
        </div>
        <div>
          <dt>Uninspected</dt>
          <dd className={uninspected > 0 ? 'ls-mono ls-difference' : 'ls-mono'}>{countText(uninspected)}</dd>
        </div>
        <div>
          <dt>Unevaluated</dt>
          <dd className={publication.unevaluated.total > 0 ? 'ls-mono ls-difference' : 'ls-mono'}>
            {countText(publication.unevaluated.total)}
          </dd>
        </div>
      </dl>
      {publication.exclusions.length === 0 ? (
        <p>No row was excluded.</p>
      ) : (
        <>
          <h3 className="ls-overline">Exclusion reasons</h3>
          <ul className="ls-plain-list">
            {publication.exclusions.map((exclusion) => (
              <li key={exclusion.reason}>
                <span className="ls-mono">{countText(exclusion.total)}</span> ·{' '}
                {/* The inclusion rule's own sentence, stored verbatim, about rows a
                    Target System supplied. It is not the platform's own words. */}
                {exclusion.reason}
                {exclusion.records.length > 0 ? (
                  <span className="ls-mono"> ({exclusion.records.join(', ')})</span>
                ) : null}
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

/** Per-Target-System coverage, exactly as the sealed Result reports it. */
export function CoverageSection({
  publication,
}: {
  readonly publication: RunResultPublication;
}): React.JSX.Element {
  return (
    <section className="ls-card ls-stack" aria-labelledby="coverage-heading">
      <h2 id="coverage-heading">Coverage by Target System</h2>
      {publication.coverage.length === 0 ? (
        <p>This Run required no Target System coverage.</p>
      ) : (
        <ul className="ls-plain-list">
          {publication.coverage.map((entry) => (
            <li key={entry.targetSystem}>
              <span className="ls-mono">{entry.targetSystem}</span> ·{' '}
              <span className="ls-mono">{countText(entry.inspected)}</span> inspected ·{' '}
              <span className={entry.uninspected > 0 ? 'ls-mono ls-difference' : 'ls-mono'}>
                {countText(entry.uninspected)}
              </span>{' '}
              uninspected
              {entry.records.length > 0 ? (
                <span className="ls-mono"> ({entry.records.join(', ')})</span>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/**
 * The evaluation cards (DESIGN.md → Evaluation card).
 *
 * "condition text, an origin badge from the evaluation-origin family, a value badge from
 * the evaluation-value family". Rule-Classified cards have NO controls — and this story
 * adds none at all, for any origin: confirmation and disposition are Epic 6.
 *
 * `Unevaluated` is a VALUE and still shows its origin. That is DESIGN.md's own sentence
 * and it is the distinction the whole family exists for.
 */
export function ConditionCards({
  publication,
  conditionText,
}: {
  readonly publication: RunResultPublication;
  /** The frozen condition's authored text, or `null` when the plan could not be read. */
  readonly conditionText: (conditionId: string) => string | null;
}): React.JSX.Element {
  return (
    <section className="ls-card ls-stack" aria-labelledby="conditions-heading">
      <h2 id="conditions-heading">Evaluations by condition</h2>
      {publication.conditions.length === 0 ? (
        <p>No condition was evaluated on any record.</p>
      ) : (
        <ul className="ls-plain-list">
          {publication.conditions.map((entry) => {
            const origin = evaluationOriginWord(entry.origin, entry.confirmation);
            const value = evaluationValueWord(entry.value);
            const text = conditionText(entry.conditionId);
            return (
              <li
                className="ls-evaluation"
                key={`${entry.conditionId}:${entry.origin}:${entry.confirmation ?? ''}:${entry.value}`}
              >
                <p className="ls-evaluation__badges">
                  {origin === null ? (
                    <span>{entry.origin}</span>
                  ) : (
                    <StatusBadge family="evaluation-origin" state={origin} />
                  )}
                  {value === null ? (
                    <span>{entry.value}</span>
                  ) : (
                    <StatusBadge family="evaluation-value" state={value} />
                  )}
                  <span className="ls-mono">{countText(entry.total)}</span>
                </p>
                <p className="ls-evaluation__condition">
                  <span className="ls-mono">{entry.conditionId}</span>
                  {text === null ? null : <> — {text}</>}
                </p>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

/**
 * The records the Result names: every Exception, and every record left Unevaluated.
 *
 * The §C control fields and the compiled rules' own diagnostics both come from a Target
 * System's answer, so both are rendered as untrusted source content: a diagnostic MUST
 * name an unknown value, and a system that answers with a sentence addressed to the
 * auditor gets that sentence stored as the recorded reason.
 */
export function FindingsSection({
  publication,
}: {
  readonly publication: RunResultPublication;
}): React.JSX.Element {
  const lists = [
    { key: 'exceptions', heading: 'Exceptions', findings: publication.exceptions },
    { key: 'unevaluated', heading: 'Records left Unevaluated', findings: publication.unevaluated },
  ] as const;
  return (
    <section className="ls-card ls-stack" aria-labelledby="findings-heading">
      <h2 id="findings-heading">Records the Result names</h2>
      {lists.map((list) => (
        <div className="ls-stack" key={list.key}>
          <h3 className="ls-overline">
            {list.heading} · {countText(list.findings.total)}
          </h3>
          {list.findings.records.length === 0 ? (
            <p>
              {list.findings.total === 0
                ? `No record is listed under ${list.heading.toLowerCase()}.`
                : 'The identities are not listed on this Result.'}
            </p>
          ) : (
            <ul className="ls-plain-list">
              {list.findings.records.map((record) => (
                <li className="ls-finding" key={`${record.targetSystem}:${record.populationRecordKey}`}>
                  <p>
                    <span className="ls-mono">{record.populationRecordKey}</span> on{' '}
                    <span className="ls-mono">{record.targetSystem}</span> ·{' '}
                    <span className="ls-mono">{record.conditionIds.join(', ')}</span>
                  </p>
                  <UntrustedList field="control fields reported by the Target System" values={Object.entries(record.fields).map(([name, value]) => `${name}: ${JSON.stringify(value)}`)} />
                  <UntrustedList field="evaluation diagnostic" values={record.diagnostics} />
                </li>
              ))}
            </ul>
          )}
          {list.findings.total > list.findings.records.length ? (
            <p>
              {countText(list.findings.total - list.findings.records.length)} more are counted but
              not listed; the Result names a bounded sample beside the exact total.
            </p>
          ) : null}
        </div>
      ))}
    </section>
  );
}

/**
 * The Safe next action panel (DESIGN.md → Safe next action panel).
 *
 * The BODY is not written by us. It is addendum §E.1's "Permitted human action" cell for
 * the row that decided this Result — the same table `OUTCOME_ROWS` transcribes and
 * `tests/unit/outcome-rules.test.ts` pins against the addendum on disk. Inventing a
 * sentence here would put the platform's words where the contract already has some.
 */
export function SafeNextActionPanel({ result }: { readonly result: RunResultRow }): React.JSX.Element | null {
  const row = OUTCOME_ROWS.find((entry) => entry.id === result.outcomeRow);
  if (row === undefined) return null;
  return (
    <section className="ls-safe-next ls-stack" aria-labelledby="safe-next-heading">
      <h2 className="ls-panel__heading" id="safe-next-heading">
        <Icon name="shield" size={16} />
        {SAFE_NEXT_ACTION_HEADING}
      </h2>
      <p>{row.humanAction}</p>
      <p className="ls-caption">
        Addendum §E.1, row <span className="ls-mono">{row.id}</span>: {row.evidenceState}.
      </p>
    </section>
  );
}

/**
 * The execution failure panel (DESIGN.md → execution failure panel).
 *
 * "always accompanied by an execution-failure panel naming the failed Session Step
 * (workspace creation, Population Source acquisition, Target System sign-in, or Adapter
 * extraction), retries, and error class."
 *
 * The error class is the stored diagnostic — a closed constant, never a message from a
 * Target System — and is rendered in monospace as the identifier it is.
 */
export interface FailedStep {
  readonly name: string;
  readonly attempts: number;
  readonly diagnostic: string | null;
}

export function ExecutionFailurePanel({
  steps,
  sealedAt,
}: {
  readonly steps: readonly FailedStep[];
  readonly sealedAt: string | null;
}): React.JSX.Element {
  return (
    <section className="ls-execution-failure ls-stack" aria-labelledby="execution-failure-heading">
      <h2 className="ls-panel__heading" id="execution-failure-heading">
        <Icon name="cloud-off" size={16} />
        {EXECUTION_FAILURE_HEADING}
      </h2>
      {steps.length === 0 ? (
        <p>The Run failed before any Session Step recorded a diagnostic.</p>
      ) : (
        <ul className="ls-plain-list">
          {steps.map((step) => (
            <li key={step.name}>
              {step.name} · {countText(step.attempts)} attempts ·{' '}
              <code className="ls-mono">{step.diagnostic ?? 'no error class recorded'}</code>
            </li>
          ))}
        </ul>
      )}
      {sealedAt === null ? null : <p className="ls-caption">Concluded {utcStamp(sealedAt)}.</p>}
    </section>
  );
}
