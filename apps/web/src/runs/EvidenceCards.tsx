import type { ObservationAttribute, SnapshotSubstrate, StoredSnapshot } from '@intellifin/domain';
import type { RunEvidenceItem, RunObservationRow } from '@intellifin/infrastructure';

import { Digest } from '../design/Digest';
import { CAPTURE_TIME_UNRECORDED } from '../design/copy';
import { CorroborationBadge, EvidenceKindBadge } from './MinorBadge';
import { UntrustedText } from './UntrustedText';
import {
  corroborationReason,
  groundingInspectionReason,
  groundingValueText,
  inspectStoredGrounding,
} from './grounding-inspector';
import {
  captureTimeSourceSentence,
  countText,
  evidenceCaptureMethod,
  evidenceStateWord,
  foundWord,
  coverageWord,
  inspectableSubstrate,
  matchOriginWord,
  observationCorroborationWord,
  utcStamp,
} from './labels';

/**
 * One Evidence item card (DESIGN.md → Evidence item card).
 *
 * "header with the Target System or Population Source name and a kind badge; a
 * three-column grid of the FR-31 fields — Work Item, Target System, Step, capture method,
 * capture time (UTC), integrity digest".
 *
 * All six are STORED from generation 32 (owner decision, 2026-09-06). The capture method
 * used to be derived here from the artifact's kind and the capture time from the Step
 * Execution that froze the bytes; both are recorded by the process that captured the
 * artifact now, and the card says which way the recorded instant came to be — measured at
 * registration, or recovered from a Step Execution. A row that carries no instant at all
 * still says so IN WORDS rather than showing a dash a reader takes for "fine".
 */
export interface EvidenceCardProps {
  readonly evidenceId: string;
  readonly kind: string;
  /** The Target System or Population Source this artifact came from. */
  readonly source: string;
  readonly workItemId: string | null;
  readonly stepId: string | null;
  readonly capturedAt: string | null;
  readonly captureMethod: string | null;
  /** How the recorded instant came to be: measured, or recovered. Never invented. */
  readonly captureTimeSource: string | null;
  readonly digest: string | null;
  readonly size: number | null;
  readonly state: string;
  readonly objectKey: string;
  /** An optional note — a partial artifact, or one preserved after a cancellation. */
  readonly note: string | null;
}

/**
 * What an unregistered artifact says instead of a digest.
 *
 * Named per kind, because the stage that stopped is what the reader needs: an abandoned
 * population reservation means acquisition stopped, an abandoned extraction means the
 * extraction did. `Object.hasOwn`, because the kind is a stored value.
 */
const NOT_REGISTERED: Readonly<Record<string, string>> = {
  population: 'Not registered; acquisition stopped.',
  'reference-source': 'Not registered; acquisition stopped.',
  'adapter-extraction': 'Not registered; extraction stopped.',
  'structural-snapshot': 'Not registered; capture stopped.',
  screenshot: 'Not registered; capture stopped.',
};

function notRegistered(kind: string, state: string): string {
  if (state !== 'ABANDONED') return 'Reserved; verification pending';
  return Object.hasOwn(NOT_REGISTERED, kind) ? NOT_REGISTERED[kind]! : 'Not registered.';
}

export function EvidenceCard(props: EvidenceCardProps): React.JSX.Element {
  const captureMethod = evidenceCaptureMethod(props.captureMethod);
  const captureTimeSource = captureTimeSourceSentence(props.captureTimeSource);
  return (
    <li className="ls-evidence-item" id={`evidence-${props.evidenceId}`}>
      <p className="ls-evidence-item__header">
        <span className="ls-mono">{props.source}</span>
        <EvidenceKindBadge kind={props.kind} />
      </p>
      <dl className="ls-definition ls-evidence-item__fields">
        <div>
          <dt>Evidence ID</dt>
          <dd className="ls-mono">{props.evidenceId}</dd>
        </div>
        <div>
          <dt>Work Item</dt>
          <dd className="ls-mono">{props.workItemId ?? 'Not produced by a Work Item'}</dd>
        </div>
        <div>
          <dt>Target System</dt>
          <dd className="ls-mono">{props.source}</dd>
        </div>
        <div>
          <dt>Step</dt>
          <dd className="ls-mono">{props.stepId ?? 'No plan Step recorded'}</dd>
        </div>
        <div>
          <dt>Capture method</dt>
          <dd>{captureMethod ?? 'Not recorded'}</dd>
        </div>
        <div>
          <dt>Capture time (UTC)</dt>
          {props.capturedAt === null ? (
            <dd>{CAPTURE_TIME_UNRECORDED}</dd>
          ) : (
            <dd>
              <span className="ls-mono">{utcStamp(props.capturedAt)}</span>
              {/* Said beside the instant, never instead of it: a recovered time and a
                  measured one are both real and are not the same claim. */}
              {captureTimeSource === null ? null : <> · {captureTimeSource}</>}
            </dd>
          )}
        </div>
        <div>
          <dt>Integrity digest</dt>
          {props.digest === null ? (
            <dd>{notRegistered(props.kind, props.state)}</dd>
          ) : (
            <Digest as="dd" label="Evidence" value={props.digest} />
          )}
        </div>
        <div>
          <dt>Stored bytes</dt>
          <dd className="ls-mono">{props.size === null ? 'Not registered' : countText(props.size)}</dd>
        </div>
        <div>
          <dt>Evidence state</dt>
          <dd>{evidenceStateWord(props.state)}</dd>
        </div>
        <div>
          <dt>Object key</dt>
          <dd className="ls-mono">{props.objectKey}</dd>
        </div>
      </dl>
      {props.note === null ? null : <p className="ls-note">{props.note}</p>}
    </li>
  );
}

/** Project a stored Evidence row onto the card, so the page has no shaping logic in it. */
export function evidenceCardProps(item: RunEvidenceItem): EvidenceCardProps {
  return {
    evidenceId: item.evidenceId,
    kind: item.kind,
    source: item.registrationId,
    workItemId: item.workItemId,
    stepId: item.stepId,
    capturedAt: item.capturedAt,
    captureMethod: item.captureMethod,
    captureTimeSource: item.captureTimeSource,
    digest: item.digest,
    size: item.size,
    state: item.state,
    objectKey: item.objectKey,
    note:
      item.state === 'ABANDONED'
        ? 'This reservation was abandoned: the Run stopped before the artifact was registered. Nothing was silently dropped.'
        : null,
  };
}

/**
 * The grounding inspector (DESIGN.md → Grounding inspector).
 *
 * "For each attribute: original value, normalized value, the Structural Snapshot it was
 * read from, locator and field label in `{typography.mono}`, and a corroboration badge
 * (matched · contradictory · model-read)."
 *
 * It opens for a `web_tree`, `sheet` or `json` snapshot — the substrates this build's
 * domain extractor actually re-reads. `desktop_tree` remains refused by name there, and
 * an inspector that opened for it would promise a re-read nothing performed. The substrate
 * is decided by the DOMAIN's own media-type function, not by a second test here.
 *
 * Every value in it came from a Target System, so every value in it is rendered as
 * untrusted source content and announced as such.
 */
export function GroundingInspector({
  observation,
  mediaTypeOf,
  snapshotOf,
  snapshotHrefOf,
  absenceHrefOf,
}: {
  readonly observation: RunObservationRow;
  /** The registered media type of an Evidence item, or `null` when it is unknown. */
  readonly mediaTypeOf: (evidenceId: string) => string | null;
  /** The exact stored artifact named by an Evidence id, supplied by the server route. */
  readonly snapshotOf?: (evidenceId: string) => StoredSnapshot | null;
  /** A protected route to the stored artifact at its grounding locator. */
  readonly snapshotHrefOf?: (evidenceId: string, locator: string) => string | null;
  readonly absenceHrefOf?: (evidenceId: string, observationId: string) => string | null;
}): React.JSX.Element {
  const snapshotResolver = snapshotOf ?? (() => null);
  // No link is emitted until an authorized server composition supplies one. A guessed
  // `/api/evidence` URL would be a dead placeholder and could suggest that access happened.
  const artifactHref = snapshotHrefOf ?? (() => null);
  const observationDiagnostic = observation.checks.find(
    (check) => check.check === 'observation-corroboration',
  )?.diagnostic ?? null;
  const identityDiagnostic = observation.checks.find(
    (check) => check.check === 'identity-corroboration',
  )?.diagnostic ?? null;
  const attributes: readonly ObservationAttribute[] = observation.attributes;
  return (
    <li className="ls-observation" id={`observation-${observation.observationId}`}>
      <p className="ls-observation__header">
        <span className="ls-mono">{observation.populationRecordKey}</span> on{' '}
        <span className="ls-mono">{observation.targetSystem}</span>
      </p>
      <dl className="ls-definition">
        <div>
          <dt>Match</dt>
          <dd>
            {foundWord(observation.found)} · {coverageWord(observation.coverage)} ·{' '}
            {matchOriginWord(observation.matchOrigin)}
          </dd>
        </div>
        <div>
          <dt>Corroboration</dt>
          <dd>{observationCorroborationWord(observation.corroboration)}</dd>
        </div>
        <div>
          <dt>Observed at (UTC)</dt>
          <dd className="ls-mono">{utcStamp(observation.observedAt)}</dd>
        </div>
        <div>
          <dt>Observed at, as the source stated it</dt>
          <dd className="ls-mono">{observation.observedAtSource}</dd>
        </div>
        <div>
          <dt>Observation digest</dt>
          <Digest as="dd" label="Observation" value={observation.digest} />
        </div>
      </dl>
      {observation.checks.length === 0 ? null : (
        <ul className="ls-plain-list">
          {observation.checks.map((check) => (
            <li key={check.check}>
              {check.check}: {check.outcome === 'PASS' ? 'Passed' : 'Not passed'}
              {check.diagnostic === null ? null : (
                <>
                  {' '}
                  · <code className="ls-mono">{check.diagnostic}</code>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
      {observation.found === 'false' ? <AbsenceProof observation={observation} hrefOf={absenceHrefOf} /> : null}
      <div className="ls-stack">
        <h3>Match provenance</h3>
        {observation.identity === null ? (
          <p>No identity match provenance was recorded.</p>
        ) : (
          <ul className="ls-plain-list">
            <AttributeGrounding
              attribute={observation.identity}
              isIdentity
              identityMatchOrigin={observation.matchOrigin}
              substrate={
                observation.identity.grounding === null
                  ? null
                  : inspectableSubstrate(mediaTypeOf(observation.identity.grounding.evidenceId))
              }
              snapshot={
                observation.identity.grounding === null
                  ? null
                  : snapshotResolver(observation.identity.grounding.evidenceId)
              }
              snapshotHref={
                observation.identity.grounding === null
                  ? null
                  : artifactHref(
                      observation.identity.grounding.evidenceId,
                      observation.identity.grounding.locator,
                    )
              }
              corroborationDiagnostic={identityDiagnostic}
              populationRecordKey={observation.populationRecordKey}
            />
          </ul>
        )}
      </div>
      <div className="ls-stack">
        <h3>Grounded attributes</h3>
        {attributes.length === 0 ? (
          <p>No declared attribute was recorded on this Observation.</p>
        ) : (
          <ul className="ls-plain-list">
            {attributes.map((attribute) => (
              <AttributeGrounding
                key={attribute.name}
                attribute={attribute}
                substrate={
                  attribute.grounding === null
                    ? null
                    : inspectableSubstrate(mediaTypeOf(attribute.grounding.evidenceId))
                }
                snapshot={
                  attribute.grounding === null
                    ? null
                    : snapshotResolver(attribute.grounding.evidenceId)
                }
                snapshotHref={
                  attribute.grounding === null
                    ? null
                    : artifactHref(attribute.grounding.evidenceId, attribute.grounding.locator)
                }
                corroborationDiagnostic={observationDiagnostic}
              />
            ))}
          </ul>
        )}
      </div>
    </li>
  );
}

function AttributeGrounding({
  attribute,
  substrate,
  snapshot,
  snapshotHref,
  corroborationDiagnostic,
  populationRecordKey,
  isIdentity = false,
  identityMatchOrigin,
}: {
  readonly attribute: ObservationAttribute;
  readonly substrate: SnapshotSubstrate | null;
  readonly snapshot: StoredSnapshot | null;
  readonly snapshotHref: string | null;
  readonly corroborationDiagnostic: string | null;
  readonly populationRecordKey?: string;
  readonly isIdentity?: boolean;
  readonly identityMatchOrigin?: string;
}): React.JSX.Element {
  const inspection = inspectStoredGrounding(attribute, substrate, snapshot);
  const reason = corroborationReason(attribute.corroboration, corroborationDiagnostic);
  return (
    <li className="ls-grounding">
      <p className="ls-grounding__header">
        {isIdentity ? <span>{identityMatchOrigin === 'platform' ? 'Platform key match' : identityMatchOrigin === 'human-matched' ? 'Human-selected match' : 'Identity match; origin unavailable'}</span> : <span className="ls-mono">{attribute.name}</span>}
        {isIdentity ? <span className="ls-mono">{attribute.name}</span> : null}
        <CorroborationBadge value={attribute.corroboration} />
      </p>
      <p>{reason}</p>
      <dl className="ls-definition">
        <div>
          <dt>Original value</dt>
          <dd>
            <UntrustedText field={`${attribute.name}, as the Target System presented it`}>
              {groundingValueText(attribute.originalValue)}
            </UntrustedText>
          </dd>
        </div>
        <div>
          <dt>Normalized value</dt>
          <dd>
            <UntrustedText field={`${attribute.name}, normalized`}>
              {groundingValueText(attribute.normalizedValue)}
            </UntrustedText>
          </dd>
        </div>
        {isIdentity && populationRecordKey !== undefined ? (
          <div>
            <dt>Population record key</dt>
            <dd className="ls-mono">{populationRecordKey}</dd>
          </div>
        ) : null}
        {attribute.grounding === null ? (
          <div>
            <dt>Grounding</dt>
            <dd>
              This attribute is not grounded in a stored snapshot, so nothing could re-read
              it.
            </dd>
          </div>
        ) : (
          <>
            <div>
              <dt>Structural Snapshot</dt>
              <dd className="ls-mono">
                {snapshotHref === null ? (
                  attribute.grounding.evidenceId
                ) : (
                  <a href={snapshotHref}>{attribute.grounding.evidenceId}</a>
                )}
                {substrate === null ? null : <> · {substrate}</>}
              </dd>
            </div>
            <div>
              <dt>Locator</dt>
              <dd className="ls-mono">{attribute.grounding.locator}</dd>
            </div>
            <div>
              <dt>Field label</dt>
              <dd className="ls-mono">
                <UntrustedText field={`${attribute.name}, field label`}>
                  {attribute.grounding.label}
                </UntrustedText>
              </dd>
            </div>
            <div>
              <dt>Snapshot at locator</dt>
              <dd>
                {inspection.cell === null ? (
                  <p>
                    {inspection.failure === null
                      ? 'No snapshot cell was read.'
                      : groundingInspectionReason(inspection.failure)}
                  </p>
                ) : (
                  <UntrustedText field={`${attribute.name}, as read at the stored snapshot locator`}>
                    {groundingValueText(inspection.cell.value)}
                  </UntrustedText>
                )}
              </dd>
            </div>
            {inspection.cell !== null && inspection.cell.label !== attribute.grounding.label ? (
              <div>
                <dt>Snapshot field label</dt>
                <dd className="ls-mono">
                  <UntrustedText field={`${attribute.name}, field label re-read from the snapshot`}>
                    {inspection.cell.label}
                  </UntrustedText>
                </dd>
              </div>
            ) : null}
            <div>
              <dt>Extracted text</dt>
              <dd>
                <UntrustedText field={`${attribute.name}, as extracted from the snapshot`}>
                  {attribute.grounding.extractedText}
                </UntrustedText>
              </dd>
            </div>
          </>
        )}
      </dl>
    </li>
  );
}

const ABSENCE_FAILURE_COPY: Readonly<Record<string, string>> = {
  'absence-proof-missing': 'No valid absence proof was supplied.',
  'query-key-missing': 'At least one declared search key was not searched.',
  'query-key-mismatch': 'A searched value did not match the declared population key.',
  'empty-result-unlinked': 'The empty-result Evidence was not linked to this Observation.',
  'empty-result-unregistered': 'The empty-result Evidence was not registered.',
  'extraction-incomplete': 'The search did not establish complete result consumption.',
};

function AbsenceProof({ observation, hrefOf }: {
  readonly observation: RunObservationRow;
  readonly hrefOf?: (evidenceId: string, observationId: string) => string | null;
}): React.JSX.Element {
  const metadata = observation.absence;
  const proof = metadata?.proof;
  const check = observation.checks.find(row => row.check === 'search-completeness');
  const failure = check?.diagnostic;
  const href = proof == null ? null : hrefOf?.(proof.emptyResultEvidenceId, observation.observationId);
  return <section className="ls-stack" aria-label="Absence proof">
    <h3>Absence proof</h3>
    <p>No matching account was reported. The proof below determines whether that absence is supported.</p>
    {metadata === undefined ? <p>Absence proof was not recorded for this historical Observation.</p>
      : !metadata.integrityValid ? <p>The stored absence provenance failed its integrity check; its proof cannot be displayed as verified.</p>
      : proof == null ? <p>No valid absence proof was supplied.</p>
      : <>
        <h4>Values actually searched</h4>
        <p>Recorded by the platform from the executed search, not from agent narration.</p>
        <ul className="ls-plain-list">{proof.queryKeys.map(query => <li key={query.key}>
          <UntrustedText field="search key">{query.key}</UntrustedText>
          <UntrustedText field="value actually searched">{query.value}</UntrustedText>
        </li>)}</ul>
        <p>Declared search keys: {metadata.expectedQueryKeys.length}.</p>
        <ul className="ls-plain-list">{metadata.expectedQueryKeys.map(query => <li key={query.key}>
          <UntrustedText field="declared search key">{query.key}</UntrustedText>
          <UntrustedText field="expected population value">{query.value}</UntrustedText>
        </li>)}</ul>
        <dl className="ls-definition">
          <div><dt>Empty-result Evidence</dt><dd className="ls-mono">{href ? <a href={href}>{proof.emptyResultEvidenceId}</a> : proof.emptyResultEvidenceId}</dd></div>
          <div><dt>Search completeness</dt><dd>{proof.extractionComplete ? 'The producer recorded complete result consumption.' : 'The search did not establish complete result consumption.'}</dd></div>
        </dl>
      </>}
    {failure != null && Object.hasOwn(ABSENCE_FAILURE_COPY, failure) ? <p>{ABSENCE_FAILURE_COPY[failure]}</p> : null}
    <p>{observation.coverage === 'COVERED' && check?.outcome === 'PASS'
      ? 'The registered absence check passed. Other required checks and evaluations still determine the Result.'
      : 'This Observation does not establish a covered absence; it cannot support a Compliant absence conclusion.'}</p>
  </section>;
}
