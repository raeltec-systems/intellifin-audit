import type { FrozenPlanInputs } from '@intellifin/domain';

import { NO_AUTOMATIC_RUNS_SENTENCE, RUN_STARTS_ON_CONFIRM_SENTENCE } from '../../design/run-start-words';
import {
  CRITERION_FALLBACK_SENTENCE,
  criteria,
  evidenceWords,
  filterSentences,
  periodWords,
  plannedFrequencyWords,
  sectionText,
  sourceFacts,
  systemAccess,
} from './decision-summary';
import {
  AGENT_JUDGED_NOTE,
  CREDENTIAL_BY_NAME_SENTENCE,
  CRITERIA_LABELS,
  EVIDENCE_LABELS,
  NOT_SET,
  NO_ADDRESS_SENTENCE,
  NO_CONDITIONS_SENTENCE,
  NO_EVIDENCE_SENTENCE,
  NO_SOURCE_SENTENCE,
  NO_SYSTEMS_SENTENCE,
  READ_ONLY_ACCESS_SENTENCE,
  REVIEW_HEADINGS,
  SUMMARY_LABELS,
  templateWords,
} from './review-words';

/**
 * The decision summary: what an approver has to decide, before anything they do not
 * (UI cleanup 2026-09-22, UX-33).
 *
 * Read entirely from the version's own frozen authoring inputs. The frozen contract —
 * canonical plan text, compiled applicability, model and tool configuration, fingerprints
 * and identifiers — is in ONE disclosure at the end of the page, so the ordinary reading
 * of this surface never meets a digest or a plan-step id.
 */

function Block({
  id,
  block,
  title,
  children,
  wide = false,
}: {
  readonly id: string;
  /** What this block is, so a test can address it without matching its own heading. */
  readonly block: string;
  readonly title: string;
  readonly children: React.ReactNode;
  readonly wide?: boolean;
}): React.JSX.Element {
  return (
    <section
      className={wide ? 'ls-card ls-stack ls-review-block ls-review-block--wide' : 'ls-card ls-stack ls-review-block'}
      aria-labelledby={id}
      data-review-block={block}
    >
      <h2 className="ls-card__title" id={id}>
        {title}
      </h2>
      {children}
    </section>
  );
}

function Facts({
  facts,
}: {
  readonly facts: readonly { label: string; value: React.ReactNode }[];
}): React.JSX.Element {
  return (
    <dl className="ls-definition">
      {facts.map((fact) => (
        <div key={fact.label}>
          <dt>{fact.label}</dt>
          <dd>{fact.value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function DecisionSummary({
  inputs,
  headingId,
}: {
  readonly inputs: FrozenPlanInputs;
  /** Prefix for every block's heading id, so the page owns the document's ids. */
  readonly headingId: string;
}): React.JSX.Element {
  const systems = systemAccess(inputs.targets, inputs.instructions);
  const conditions = criteria(inputs.complianceConditions, inputs.templateId);
  const source = inputs.sourceSnapshot;
  return (
    <div className="ls-review-grid">
      <Block id={`${headingId}-tested`} block="tested" title={REVIEW_HEADINGS.tested} wide>
        <Facts
          facts={[
            { label: SUMMARY_LABELS.procedureName, value: inputs.controlName },
            { label: SUMMARY_LABELS.template, value: templateWords(inputs.templateId) },
            { label: SUMMARY_LABELS.controlStatement, value: sectionText(inputs, 'Control') ?? NOT_SET },
            { label: SUMMARY_LABELS.objective, value: sectionText(inputs, 'Objective') ?? NOT_SET },
            { label: SUMMARY_LABELS.risk, value: sectionText(inputs, 'Risk') ?? NOT_SET },
            {
              label: SUMMARY_LABELS.criterionReference,
              value: sectionText(inputs, 'Criterion reference') ?? NOT_SET,
            },
          ]}
        />
      </Block>

      <Block id={`${headingId}-scope`} block="scope" title={REVIEW_HEADINGS.scope}>
        <Facts
          facts={[
            { label: SUMMARY_LABELS.period, value: periodWords(inputs.period) },
            { label: SUMMARY_LABELS.scope, value: inputs.scope.trim() === '' ? NOT_SET : inputs.scope },
          ]}
        />
        {source === null ? (
          <p data-no-source>{NO_SOURCE_SENTENCE}</p>
        ) : (
          <Facts
            facts={[
              { label: SUMMARY_LABELS.source, value: source.displayName },
              ...sourceFacts(source),
              {
                label: SUMMARY_LABELS.filters,
                value: (
                  <ul className="ls-review-list">
                    {filterSentences(inputs.inclusionRule).map((sentence) => (
                      <li key={sentence}>{sentence}</li>
                    ))}
                  </ul>
                ),
              },
            ]}
          />
        )}
      </Block>

      <Block id={`${headingId}-systems`} block="systems" title={REVIEW_HEADINGS.systems}>
        {systems.length === 0 ? (
          <p data-no-systems>{NO_SYSTEMS_SENTENCE}</p>
        ) : (
          systems.map((system) => (
            <div key={system.registrationId} className="ls-review-system">
              <p className="ls-review-system__name">
                {system.displayName} <span className="ls-caption">· {system.kindWord}</span>
              </p>
              <Facts
                facts={[
                  { label: SUMMARY_LABELS.mayDo, value: system.actions.join(', ') },
                  {
                    label: SUMMARY_LABELS.mayGo,
                    value: system.reach.length === 0 ? NO_ADDRESS_SENTENCE : system.reach.join(', '),
                  },
                ]}
              />
              {system.instruction === null ? null : (
                <p className="ls-whitespace">{system.instruction}</p>
              )}
            </div>
          ))
        )}
      </Block>

      <Block id={`${headingId}-criteria`} block="criteria" title={REVIEW_HEADINGS.criteria} wide>
        {conditions.length === 0 ? (
          <p data-no-conditions>{NO_CONDITIONS_SENTENCE}</p>
        ) : (
          <>
            <dl className="ls-definition">
              {conditions.map((condition) => (
                <div key={condition.conditionId}>
                  <dt>
                    {condition.conditionId}
                    {condition.agentJudged ? (
                      <span className="ls-caption"> · {CRITERIA_LABELS.agentJudged}</span>
                    ) : null}
                  </dt>
                  <dd>
                    {condition.sentence === null ? (
                      <>
                        <p>{CRITERION_FALLBACK_SENTENCE}</p>
                        <p className="ls-whitespace">{condition.text}</p>
                      </>
                    ) : (
                      condition.sentence
                    )}
                  </dd>
                </div>
              ))}
            </dl>
            {conditions.some((condition) => condition.agentJudged) ? (
              <p className="ls-caption">{AGENT_JUDGED_NOTE(inputs.agentJudgedThreshold)}</p>
            ) : null}
          </>
        )}
      </Block>

      <Block id={`${headingId}-evidence`} block="evidence" title={REVIEW_HEADINGS.evidence}>
        {inputs.evidenceRequirements.length === 0 ? (
          <p data-no-evidence>{NO_EVIDENCE_SENTENCE}</p>
        ) : (
          <Facts
            facts={inputs.evidenceRequirements.map((requirement) => ({
              label: requirement.attributeName,
              value: evidenceWords(requirement),
            }))}
          />
        )}
        <p className="ls-caption">{EVIDENCE_LABELS.note}</p>
      </Block>

      <Block id={`${headingId}-frequency`} block="frequency" title={REVIEW_HEADINGS.frequency}>
        <Facts
          facts={[{ label: SUMMARY_LABELS.frequency, value: plannedFrequencyWords(inputs.schedule) }]}
        />
        <p>
          {RUN_STARTS_ON_CONFIRM_SENTENCE} {NO_AUTOMATIC_RUNS_SENTENCE}
        </p>
      </Block>

      <Block id={`${headingId}-access`} block="access" title={REVIEW_HEADINGS.access} wide>
        <p>{READ_ONLY_ACCESS_SENTENCE}</p>
        <p>{CREDENTIAL_BY_NAME_SENTENCE}</p>
        {systems.length === 0 ? null : (
          <Facts
            facts={systems.map((system) => ({
              label: system.displayName,
              value: <code className="ls-mono">{system.credentialRef}</code>,
            }))}
          />
        )}
      </Block>
    </div>
  );
}
