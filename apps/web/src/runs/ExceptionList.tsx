import { groundedText, type ObservationAttribute, type TemplateId } from '@intellifin/domain';
import type { RunEvaluationRow, RunExceptionRow, RunObservationRow } from '@intellifin/infrastructure';

import { Reference } from '../design/Reference';
import { StatusBadge } from '../design/StatusBadge';
import { TechnicalDetails } from '../design/TechnicalDetails';
import { Timestamp } from '../design/Timestamp';
import { MASKED_BY_BINDING, MASKED_VALUE } from '../design/copy';
import { readSimpleCondition } from '../procedures/simple-condition';
import { fieldWords } from '../procedures/condition-words';
import { Criterion } from './Criterion';
import { replayInspectionHref } from './replay';
import { UntrustedList, UntrustedText } from './UntrustedText';
import { evaluationOriginWord, evaluationValueWord, utcStamp } from './labels';
import { EXCEPTION_WORDS } from './result-words';

/**
 * One Exception, read as an audit finding (DESIGN.md → Exception list row; EXPERIENCE.md →
 * Exception list row; UI cleanup 2026-09-22, UX-21).
 *
 * THE FINDING. The walkthrough met a card headed by a thirty-six character Exception UUID,
 * with the Target System shown as its REGISTRATION id, the condition as compiler grammar
 * (`found = false or account_status in [Disabled] else [Active]`), an HMAC fingerprint on
 * the third row, and no way at all to reach the evidence for the record it names. An
 * auditor cannot take that to a control owner.
 *
 * What a finding carries now, in EXPERIENCE.md's own order: the RECORD it is about and the
 * SYSTEM it was found on, both as names; why it is an Exception, as a sentence; what was
 * expected against what was observed; and one click to that record's evidence and to the
 * session where it was captured. The Exception's own identity is a short `Reference`, and
 * the identifiers, the fingerprint, the immutable condition set and the exact raised-at
 * instant are under Technical details — moved, never deleted.
 *
 * THE STATE IS `Open`, and that is derived rather than stored. FR-42's Exception state
 * machine starts at Open and disposition is Epic 6, so no Exception in this environment
 * has ever transitioned. It is the same reading as "no Result row means no conclusion has
 * been issued": a fact about what has happened, not a placeholder.
 *
 * MASKING IS UNCHANGED. Where the binding designates the matching key column sensitive
 * (FR-41), the record key is `MASKED_VALUE` with `MASKED_BY_BINDING` beside it — on the
 * heading, in the links' accessible names, and everywhere else it would otherwise appear.
 */
export function ExceptionCard({
  exception,
  evaluations,
  observation,
  conditionText,
  templateId,
  targetSystemName,
  runId,
  masked,
}: {
  readonly exception: RunExceptionRow;
  /** The per-condition evaluations of this Exception's own Observation. */
  readonly evaluations: readonly RunEvaluationRow[];
  /** The Observation this finding was raised on, or `null` when it could not be read. */
  readonly observation: RunObservationRow | null;
  readonly conditionText: (conditionId: string) => string | null;
  /** The frozen Template, which is what turns a compiled condition into a sentence. */
  readonly templateId: TemplateId | null;
  /**
   * The Target System's frozen DISPLAY NAME, resolved through the Procedure Version's
   * plan. `exception.targetSystem` is the registration id and is a UUID to a reader.
   */
  readonly targetSystemName: string | null;
  readonly runId: string;
  /** Whether the binding designates this Run's matching key column sensitive (FR-41). */
  readonly masked: boolean;
}): React.JSX.Element {
  const record = masked ? MASKED_VALUE : exception.populationRecordKey;
  const system = targetSystemName ?? exception.targetSystem;
  // The current effective set decides what this record is an Exception FOR. The immutable
  // set the finding was raised under is under Technical details, where it belongs: it is
  // what the fingerprint is bound to and never what a reader acts on today.
  const failing = exception.effectiveConditionIds;
  return (
    <li className="ls-exception ls-stack" id={`exception-${exception.exceptionId}`}>
      <div className="ls-exception__header">
        <h3 className="ls-exception__record">
          {masked ? (
            <>
              <span aria-hidden="true">{MASKED_VALUE}</span>
              <span className="ls-visually-hidden">{MASKED_BY_BINDING}</span>
            </>
          ) : (
            exception.populationRecordKey
          )}{' '}
          <span className="ls-exception__system">on {system}</span>
        </h3>
        <StatusBadge family="exception" state="Open" />
      </div>
      {masked ? <p className="ls-caption">{MASKED_BY_BINDING}</p> : null}
      {/* The name or account the Target System itself showed for this record, where the
          Observation captured one. It is a value a Target System controls, so it is
          rendered inert and labelled — never as the platform's own words. */}
      {observation?.identity == null || masked ? null : (
        <UntrustedText field={`${fieldWords(observation.identity.name)}, as ${system} shows it`} policy={false}>
          {groundedText(observation.identity.originalValue)}
        </UntrustedText>
      )}

      <h4 className="ls-overline">{EXCEPTION_WORDS.failedCriterion}</h4>
      {failing.length === 0 ? (
        <p>{EXCEPTION_WORDS.noCurrentConditions}</p>
      ) : (
        <ul className="ls-plain-list">
          {failing.map((conditionId) => {
            const evaluation = evaluations.find((entry) => entry.conditionId === conditionId) ?? null;
            const origin = evaluation === null ? null : evaluationOriginWord(evaluation.origin, evaluation.confirmation);
            const value = evaluation === null ? null : evaluationValueWord(evaluation.value);
            const text = conditionText(conditionId);
            return (
              <li className="ls-evaluation ls-stack" key={conditionId}>
                <p className="ls-evaluation__badges">
                  {origin === null ? null : <StatusBadge family="evaluation-origin" state={origin} />}
                  {value === null ? null : <StatusBadge family="evaluation-value" state={value} />}
                </p>
                <Criterion
                  conditionId={conditionId}
                  text={text}
                  templateId={templateId}
                  technical={false}
                />
                <ExpectedAgainstObserved
                  text={text}
                  templateId={templateId}
                  conditionId={conditionId}
                  observation={observation}
                  masked={masked}
                />
                {/* A rule's own reason and, for a later origin, its rationale. Both come
                    from outside this platform; the page states the policy ONCE above every
                    Exception, so each block carries only its source label (UX-27). */}
                {(evaluation?.rationale ?? null) === null && (evaluation?.diagnostic ?? null) === null ? null : (
                  <>
                    {evaluation?.rationale ? (
                      <UntrustedList policy={false} field="evaluation rationale" values={[evaluation.rationale]} />
                    ) : null}
                    {evaluation?.diagnostic ? (
                      <UntrustedList policy={false} field="evaluation diagnostic" values={[evaluation.diagnostic]} />
                    ) : null}
                  </>
                )}
                <TechnicalDetails
                  items={[
                    { label: 'Condition identifier', value: conditionId, mono: true },
                    ...(text === null ? [] : [{ label: 'Criterion as approved', value: text, mono: true }]),
                  ]}
                />
              </li>
            );
          })}
        </ul>
      )}

      {/* The two one-click destinations EXPERIENCE.md asks a finding to carry: the record's
          own evidence, and the session frames where it was captured. Replay opens at the
          record's own inspection (`?workItem=`, resolved by the server, so it works past
          the session's frame prefix and without JavaScript); the Evidence anchor is the
          grounding inspector's own `id`, on the Evidence tab's technical artifacts page —
          the tab itself opens on the record queue. */}
      <p className="ls-exception__links">
        <a href={`/runs/${runId}/evidence/technical#observation-${exception.observationId}`}>
          {EXCEPTION_WORDS.openEvidence}
          <span className="ls-visually-hidden"> for {record}</span>
        </a>
        {' · '}
        <a href={replayInspectionHref(runId, exception.workItemId)}>
          {EXCEPTION_WORDS.openReplay}
          <span className="ls-visually-hidden"> for {record}</span>
        </a>
      </p>

      <p className="ls-caption">
        <Reference kind="Exception" value={exception.exceptionId} /> · raised{' '}
        <Timestamp value={exception.raisedAt} />
      </p>

      <TechnicalDetails
        items={[
          { label: 'Exception identifier', value: exception.exceptionId, mono: true },
          { label: 'Observation identifier', value: exception.observationId, mono: true },
          { label: 'Work Item identifier', value: exception.workItemId, mono: true },
          { label: 'Target System registration', value: exception.targetSystem, mono: true },
          { label: 'Raised at', value: utcStamp(exception.raisedAt), mono: true },
          // HMAC-SHA-256 hex. The Run is deliberately outside it, so the same control
          // failure recurring next month fingerprints the same and is recognisable.
          { label: 'Original fingerprint', value: exception.fingerprint, mono: true },
          {
            label: EXCEPTION_WORDS.originalConditions,
            value: exception.conditionIds.join(', '),
            mono: true,
          },
        ]}
      >
        {/*
          The compiled rules' own reasons — for P-2 this is where "report every prohibited
          pair" lives. A diagnostic MUST name an unknown value, so a Target System that
          answers with a sentence addressed to the auditor gets it stored here. It is data.
        */}
        <UntrustedList policy={false} field="diagnostics recorded when this finding was raised" values={exception.diagnostics} />
      </TechnicalDetails>
    </li>
  );
}

/**
 * What the criterion accepts, against what this Run actually captured (UX-21).
 *
 * The expected side is the SIMPLE reading of the frozen criterion — the same reading the
 * Builder's simple editor shows — so a criterion in compiler grammar the editor never
 * offered says so rather than being guessed at. The observed side is the captured value of
 * the field that criterion reads, taken from the Observation's grounded attributes; a Run
 * that captured no such field says so, because an empty cell reads as "nothing was wrong".
 */
function ExpectedAgainstObserved({
  text,
  templateId,
  conditionId,
  observation,
  masked,
}: {
  readonly text: string | null;
  readonly templateId: TemplateId | null;
  readonly conditionId: string;
  readonly observation: RunObservationRow | null;
  readonly masked: boolean;
}): React.JSX.Element | null {
  const simple = text === null || templateId === null ? null : readSimpleCondition(text, templateId, conditionId);
  // A disablement-window condition compares two instants and names no accepted value, so
  // there is nothing to put on an "Expected" line that would not be an invention.
  const field = simple === null || simple.kind === 'disablement-window' ? null : simple.field;
  const expected = simple === null || simple.kind === 'disablement-window'
    ? null
    : simple.compliant.map((value) => `“${value}”`).join(' or ');
  const attribute: ObservationAttribute | null = field === null || observation === null
    ? null
    : observation.attributes.find((entry) => entry.name === field) ?? null;
  const observed = attribute === null ? null : groundedText(attribute.originalValue);
  if (expected === null && observed === null) return null;
  return (
    <dl className="ls-definition ls-exception__compare">
      <div>
        <dt>{EXCEPTION_WORDS.expected}</dt>
        <dd>
          {expected === null
            ? EXCEPTION_WORDS.noExpectedValue
            : `The ${fieldWords(field!)} is ${expected}.`}
        </dd>
      </div>
      <div>
        <dt>{EXCEPTION_WORDS.observed}</dt>
        <dd>
          {observed === null || masked ? (
            masked && observed !== null ? MASKED_VALUE : EXCEPTION_WORDS.noObservedValue
          ) : (
            // The captured value came from the Target System, so it is inert and labelled.
            <UntrustedText field={`${fieldWords(field!)}, as the Target System showed it`} policy={false}>{observed}</UntrustedText>
          )}
        </dd>
      </div>
    </dl>
  );
}
