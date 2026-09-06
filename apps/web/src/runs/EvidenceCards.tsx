import type { ObservationAttribute } from '@intellifin/domain';
import type { RunEvidenceItem, RunObservationRow } from '@intellifin/infrastructure';

import { Digest } from '../design/Digest';
import { CAPTURE_TIME_UNRECORDED } from '../design/copy';
import { CorroborationBadge, EvidenceKindBadge } from './MinorBadge';
import { UntrustedText } from './UntrustedText';
import {
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
 * FIVE of the six are stored. The sixth is not: neither `run_evidence` nor
 * `population_evidence` has a capture-time column, so for a Reference Source and an
 * adapter extraction the instant comes from the Step Execution that uploaded, verified
 * and registered the bytes, and for the population artifact nothing recorded one at all.
 * That case says so IN WORDS rather than showing a dash a reader takes for "fine". The
 * gap is named in `CLAUDE.md` and in the story's report; it is not papered over here.
 */
export interface EvidenceCardProps {
  readonly evidenceId: string;
  readonly kind: string;
  /** The Target System or Population Source this artifact came from. */
  readonly source: string;
  readonly workItemId: string | null;
  readonly stepId: string | null;
  readonly capturedAt: string | null;
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
};

function notRegistered(kind: string, state: string): string {
  if (state !== 'ABANDONED') return 'Reserved; verification pending';
  return Object.hasOwn(NOT_REGISTERED, kind) ? NOT_REGISTERED[kind]! : 'Not registered.';
}

export function EvidenceCard(props: EvidenceCardProps): React.JSX.Element {
  const captureMethod = evidenceCaptureMethod(props.kind);
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
          <dd className={props.capturedAt === null ? undefined : 'ls-mono'}>
            {props.capturedAt === null ? CAPTURE_TIME_UNRECORDED : utcStamp(props.capturedAt)}
          </dd>
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
 * It opens for a `sheet` or `json` snapshot — the two substrates Story 3.6's extractor
 * actually re-reads. `web_tree` and `desktop_tree` are refused BY NAME there, and an
 * inspector that opened for them would promise a re-read nothing performed. The substrate
 * is decided by the DOMAIN's own media-type function, not by a second test here.
 *
 * Every value in it came from a Target System, so every value in it is rendered as
 * untrusted source content and announced as such.
 */
export function GroundingInspector({
  observation,
  mediaTypeOf,
}: {
  readonly observation: RunObservationRow;
  /** The registered media type of an Evidence item, or `null` when it is unknown. */
  readonly mediaTypeOf: (evidenceId: string) => string | null;
}): React.JSX.Element {
  const attributes: readonly (ObservationAttribute | null)[] = [
    observation.identity,
    ...observation.attributes,
  ];
  const grounded = attributes.filter((attribute): attribute is ObservationAttribute => attribute !== null);
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
      {grounded.length === 0 ? (
        <p>No attribute on this Observation carries a grounding.</p>
      ) : (
        <details className="ls-expand">
          <summary>Grounding for {countText(grounded.length)} attributes</summary>
          <ul className="ls-plain-list">
            {grounded.map((attribute) => (
              <AttributeGrounding
                key={attribute.name}
                attribute={attribute}
                substrate={
                  attribute.grounding === null
                    ? null
                    : inspectableSubstrate(mediaTypeOf(attribute.grounding.evidenceId))
                }
              />
            ))}
          </ul>
        </details>
      )}
    </li>
  );
}

function AttributeGrounding({
  attribute,
  substrate,
}: {
  readonly attribute: ObservationAttribute;
  readonly substrate: string | null;
}): React.JSX.Element {
  return (
    <li className="ls-grounding">
      <p className="ls-grounding__header">
        <span className="ls-mono">{attribute.name}</span>
        <CorroborationBadge value={attribute.corroboration} />
      </p>
      <dl className="ls-definition">
        <div>
          <dt>Original value</dt>
          <dd>
            <UntrustedText field={`${attribute.name}, as the Target System presented it`}>
              {JSON.stringify(attribute.originalValue)}
            </UntrustedText>
          </dd>
        </div>
        <div>
          <dt>Normalized value</dt>
          <dd>
            <UntrustedText field={`${attribute.name}, normalized`}>
              {JSON.stringify(attribute.normalizedValue)}
            </UntrustedText>
          </dd>
        </div>
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
                <a href={`#evidence-${attribute.grounding.evidenceId}`}>
                  {attribute.grounding.evidenceId}
                </a>
                {substrate === null ? null : <> · {substrate}</>}
              </dd>
            </div>
            <div>
              <dt>Locator</dt>
              <dd className="ls-mono">{attribute.grounding.locator}</dd>
            </div>
            <div>
              <dt>Field label</dt>
              <dd className="ls-mono">{attribute.grounding.label}</dd>
            </div>
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
