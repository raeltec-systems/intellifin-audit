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
 * The DECLARED count and the RETRIEVED count are both here, as numbers, with the artifact
 * each is attributable to (owner decision, 2026-09-06). Until generation 32 only the §H
 * verdict was stored and the row said "Reconciled" or "Did not reconcile" in words: a
 * reader could see that the source and the platform disagreed and never by how much, or in
 * which direction. The declaration is frozen inside the acquisition ENVELOPE and the rows
 * inside the RAW artifact, and both objects belong to the population Evidence reservation,
 * so each number names the Evidence item it came from — a reference the reader can follow
 * to the Evidence tab, never bytes this surface read for itself (`no-evidence-store-in-web`
 * still fails the build on that, and must).
 */
export function PopulationReconciliation({
  publication,
  rowsDigest,
  declaredCountPassed,
  declaredCount,
  retrievedCount,
  evidence,
  runId,
  uninspected,
}: {
  readonly publication: RunResultPublication;
  readonly rowsDigest: string | null;
  readonly declaredCountPassed: boolean | null;
  /** The number the independent declaration stated, or `null` when it stated none. */
  readonly declaredCount: number | null;
  /** The rows parsed out of the frozen raw artifact, or `null` with no snapshot at all. */
  readonly retrievedCount: number | null;
  /** The population reservation's identity and its two object keys, for attribution. */
  readonly evidence: {
    readonly evidenceId: string;
    readonly objectKey: string;
    readonly envelopeKey: string;
  } | null;
  /** The Run, so each reference links to the Evidence tab's card for that artifact. */
  readonly runId: string;
  readonly uninspected: number;
}): React.JSX.Element {
  const population = publication.population;
  return (
    <section className="ls-card ls-stack" aria-labelledby="population-reconciliation">
      <h2 id="population-reconciliation">Population reconciliation</h2>
      <h3 className="ls-overline">File level</h3>
      <dl className="ls-definition ls-reconciliation">
        <div>
          <dt>Declared count</dt>
          <dd>
            <span className="ls-mono">
              {declaredCount === null ? 'Not recorded' : countText(declaredCount)}
            </span>
            {declaredCount === null ? (
              <>
                {' '}
                — the independent declaration stated no count this build could store, or
                this Run was acquired before the count was persisted.
              </>
            ) : null}
            {evidence === null ? null : (
              <>
                {' '}
                · from the acquisition envelope of Evidence{' '}
                <a href={`/runs/${runId}/evidence#evidence-${evidence.evidenceId}`} className="ls-mono">
                  {evidence.evidenceId}
                </a>{' '}
                <span className="ls-mono">({evidence.envelopeKey})</span>
              </>
            )}
          </dd>
        </div>
        <div>
          <dt>Retrieved count</dt>
          <dd>
            <span
              className={
                declaredCount !== null && retrievedCount !== null && declaredCount !== retrievedCount
                  ? 'ls-mono ls-difference'
                  : 'ls-mono'
              }
            >
              {retrievedCount === null ? 'Not recorded' : countText(retrievedCount)}
            </span>
            {evidence === null ? null : (
              <>
                {' '}
                · from the population artifact of Evidence{' '}
                <a href={`/runs/${runId}/evidence#evidence-${evidence.evidenceId}`} className="ls-mono">
                  {evidence.evidenceId}
                </a>{' '}
                <span className="ls-mono">({evidence.objectKey})</span>
              </>
            )}
          </dd>
        </div>
        <div>
          <dt>Record-count reconciliation</dt>
          {/* The stored §H verdict, READ and never re-derived from the two numbers above:
              a second answer to one question is how a surface comes to disagree with the
              Gate it reports. */}
          <dd>
            {declaredCountPassed === null
              ? 'Not reconciled: the population was never acquired.'
              : declaredCountPassed
                ? 'Reconciled exactly against the independent declaration.'
                : 'Did not reconcile against the independent declaration.'}
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

/**
 * What the Run FROZE, named — not only counted (owner decision, 2026-09-06).
 *
 * A Run stopped by its own time limit after acquiring, storing and verifying a population
 * is `INCONCLUSIVE` with that population still registered, and a Run that never reached a
 * source is `INCONCLUSIVE` with nothing. Those are different findings to an auditor, and a
 * `registered: 1` count cannot tell them apart: it says a number, not which artifact, and
 * a reader cannot follow a number to the bytes. Each identity links to its card on the
 * Evidence tab.
 *
 * Read from the sealed document and never recomputed. A document written before this
 * decision has NO `artifacts` key, which is a different statement from an empty list — one
 * means "this build did not record which", the other means "this Run froze nothing" — and
 * the section says which rather than rendering an empty list a reader takes for the second.
 */
export function EvidencePackageSection({
  publication,
  runId,
}: {
  readonly publication: RunResultPublication;
  readonly runId: string;
}): React.JSX.Element {
  const evidence = publication.evidence;
  const artifacts = evidence.artifacts;
  return (
    <section className="ls-card ls-stack" aria-labelledby="evidence-package-summary">
      <h2 id="evidence-package-summary">Evidence this Run froze</h2>
      <p>
        {evidence.state === 'SEALED'
          ? 'Sealed. Every artifact this Run required is registered and verified.'
          : 'Sealed as incomplete. An artifact this Run required was never registered.'}{' '}
        Registered artifacts: <span className="ls-mono">{countText(evidence.registered)}</span>.
        Required: <span className="ls-mono">{countText(evidence.requiredTotal)}</span>. Abandoned
        reservations: <span className="ls-mono">{countText(evidence.abandoned)}</span>.
      </p>
      {artifacts === undefined ? (
        <p>
          This Result was published before the artifacts were named, so which ones were
          registered is not recorded on it. The Evidence tab lists what the Run holds.
        </p>
      ) : artifacts.length === 0 ? (
        <p>This Run registered no Evidence at all.</p>
      ) : (
        <ul className="ls-plain-list">
          {artifacts.map((artifact) => (
            <li key={artifact.evidenceId}>
              {artifactKindWord(artifact.kind)} ·{' '}
              <a className="ls-mono" href={`/runs/${runId}/evidence#evidence-${artifact.evidenceId}`}>
                {artifact.evidenceId}
              </a>{' '}
              <span className="ls-mono">({artifact.objectKey})</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** The artifact kinds the sealed document names, in words. A stored value, so guarded. */
const ARTIFACT_KIND_WORDS: Readonly<Record<string, string>> = {
  population: 'Population',
  'reference-source': 'Reference Source',
  'adapter-extraction': 'Adapter extraction',
  'structural-snapshot': 'Structural snapshot',
  screenshot: 'Screenshot',
};

function artifactKindWord(kind: string): string {
  return Object.hasOwn(ARTIFACT_KIND_WORDS, kind) ? ARTIFACT_KIND_WORDS[kind]! : kind;
}

const TARGET_KIND_WORDS: Readonly<Record<string, string>> = {
  web: 'web application', desktop: 'desktop application', api: 'read-only API', 'versioned-file': 'versioned file (Reference Source)',
};

function targetKindWord(kind: string): string {
  return Object.hasOwn(TARGET_KIND_WORDS, kind) ? TARGET_KIND_WORDS[kind]! : kind;
}

/**
 * Which Target Systems were in scope, and which Template defaults were not (owner decision
 * 2026-09-08). A selected system this build refused is named with its closed reason rather
 * than dropped; an older document that never recorded the list says so in words.
 */
export function ScopeSection({
  publication,
}: {
  readonly publication: RunResultPublication;
}): React.JSX.Element {
  const systems = publication.targetSystems;
  return (
    <section className="ls-card ls-stack" aria-labelledby="scope-heading">
      <h2 id="scope-heading">Target Systems in scope</h2>
      {systems === undefined ? (
        <p>This Result did not record which Target Systems were in scope; it was published by an earlier build.</p>
      ) : publication.templateId === null ? (
        <p>This build could not read the frozen plan, so the Target System scope is not stated.</p>
      ) : systems.length === 0 ? (
        <p>The frozen version selected no Target System.</p>
      ) : (
        <ul className="ls-plain-list">
          {systems.map((entry) => (
            <li key={`${entry.inScope ? 'in' : 'out'}:${entry.registrationId ?? entry.displayName}`}>
              <strong>{entry.displayName}</strong> · {targetKindWord(entry.kind)} ·{' '}
              {!entry.inScope
                ? 'not selected — a Template default only, not in scope for this Run'
                : entry.support === 'supported'
                  ? 'in scope'
                  : <>in scope; <span className="ls-difference">refused by this build</span> ({entry.reason})</>}
            </li>
          ))}
        </ul>
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
