'use client';

import { Fragment, useEffect, useId, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { ProcedureVersionView } from '@intellifin/application';
import { Banner } from '../design/Banner';
import { StatusBadge } from '../design/StatusBadge';
import { policyText, predicateText, ruleText } from './plan-condition-text';
import { startPlanPolling } from './plan-polling';
import { countWords, durationWords } from './plan-numbers';

import { ACTION_LABELS } from './plan-step-labels';

/**
 * `2026-09-11T07:00:13.726Z` → `2026-09-11T07:00:13Z`.
 *
 * The `datetime` attribute keeps the stored value exactly; only the visible text is
 * trimmed. Both are ISO 8601 UTC with a `Z` (EXPERIENCE.md → Formats), and the
 * milliseconds of a derivation are not a fact anybody reads.
 */
function toSeconds(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : `${date.toISOString().slice(0, 19)}Z`;
}

/** The saved durable contract only. This component never compiles or executes a plan. */
export function ExecutablePlanPreview({
  draft,
  modelConfiguration,
}: {
  readonly draft: ProcedureVersionView;
  readonly modelConfiguration?: ProcedureVersionView['derivationModel'];
}): React.JSX.Element {
  const id = useId();
  const router = useRouter();
  const refresh = useRef(() => router.refresh());
  refresh.current = () => router.refresh();
  const pendingKey = `${draft.versionId}:${draft.planInputDigest ?? 'initial'}`;
  const [prolongedKey, setProlongedKey] = useState<string | null>(null);
  useEffect(() => {
    if (draft.planStatus !== 'pending') return;
    setProlongedKey(null);
    return startPlanPolling(() => refresh.current(), () => setProlongedKey(pendingKey));
  }, [draft.planStatus, pendingKey]);
  const plan = draft.compiledPlan;
  const successes = draft.planAttempts.filter((entry) => entry.outcome === 'success' && entry.inputDigest === draft.planInputDigest);
  const attempt = successes.find((entry) => entry.published === true) ?? successes.find((entry) => entry.published === undefined);
  const model = modelConfiguration !== undefined ? modelConfiguration : attempt?.outcome === 'success' ? attempt.model : null;
  const derivedAt = attempt === undefined ? null : attempt.completedAt ?? attempt.attemptedAt;
  return <section className="ls-card ls-stack" aria-labelledby={`${id}-title`} data-testid="executable-plan-preview">
    <h2 className="ls-card__title" id={`${id}-title`}>Executable plan preview</h2>
    <p className="ls-caption">This plan is read-only. The platform composes it from your saved sections; the agent reads it and cannot change a word of it. Change the originating Builder section to revise it.</p>
    <div role="status" aria-live="polite">
      {draft.planStatus === 'pending'
        ? <p className="ls-caption">{prolongedKey === pendingKey ? 'The executable plan is still pending. Automatic checks have paused after two minutes; this does not mean derivation failed. Reload the page to check again.' : 'Re-deriving the executable plan…'}</p>
        : draft.planStatus === 'failed' || plan === null
          ? <Banner tone="warning" title={`Cannot derive: ${draft.planFailureReason ?? 'No valid stored plan is available.'}`} />
          : <p className="ls-caption">Re-derived{derivedAt === null ? '' : ' at '}{derivedAt === null ? null : <time dateTime={derivedAt}>{toSeconds(derivedAt)}</time>}.</p>}
    </div>
    {draft.planStatus === 'succeeded' && plan !== null ? <div className="ls-plan-groups">

      <section className="ls-plan-group" aria-labelledby={`${id}-session`}>
        <h3 className="ls-overline" id={`${id}-session`}>Session Steps</h3>
        <ol className="ls-plan-steps">{plan.sessionSteps.map((step) => <li key={step.id}>
          <span className="ls-plan-step__title">{ACTION_LABELS[step.action]}{step.targetSystemId === null ? '' : ` — ${plan.inputs.targets.find((target) => target.registrationId === step.targetSystemId)?.displayName ?? step.targetSystemId}`}</span>
          <p className="ls-plan-step__text">{step.text}</p>
        </li>)}</ol>
      </section>

      <section className="ls-plan-group" aria-labelledby={`${id}-per-target`}>
        <h3 className="ls-overline" id={`${id}-per-target`}>Ordered Plan Steps per Target System</h3>
        {plan.targetSystems.map((system) => {
          const target = plan.inputs.targets.find((entry) => entry.registrationId === system.registrationId)!;
          const instruction = plan.inputs.instructions.find((entry) => entry.registrationId === system.registrationId);
          return <div key={system.registrationId} className="ls-plan-panel">
            <h4 className="ls-plan-panel__title">{target.displayName}</h4>
            <dl className="ls-plan-facts">
              <dt>May do here</dt>
              <dd><ul className="ls-tag-row">{target.contract.permitted_actions.map((action) => <li key={action} className="ls-tag">{action}</li>)}</ul></dd>
            </dl>
            {instruction === undefined ? null : <p className="ls-whitespace ls-plan-step__text">{instruction.text}</p>}
            <ol className="ls-plan-steps">{system.planSteps.map((step) => <li key={step.id}>
              <span className="ls-plan-step__title">{ACTION_LABELS[step.action]}</span>
              <p className="ls-plan-step__text">{step.text}</p>
            </li>)}</ol>
          </div>;
        })}
      </section>

      <section className="ls-plan-group" aria-labelledby={`${id}-observations`}>
        <h3 className="ls-overline" id={`${id}-observations`}>Observations to capture</h3>
        <ul className="ls-tag-row">{plan.observations.map((observation) => <li key={observation.attributeName} className="ls-tag">{observation.attributeName} <span className="ls-tag__note">{observation.valueType}</span></li>)}</ul>
      </section>

      <section className="ls-plan-group" aria-labelledby={`${id}-evidence`}>
        <h3 className="ls-overline" id={`${id}-evidence`}>Evidence and grounding</h3>
        {plan.inputs.evidenceRequirements.length === 0 ? <p className="ls-caption">No additional Evidence Requirements were authored.</p> : <div className="ls-plan-panel">
          <dl className="ls-plan-facts ls-plan-facts--names">{plan.inputs.evidenceRequirements.map((requirement) => <Fragment key={requirement.attributeName}>
            <dt>{requirement.attributeName}</dt>
            <dd>{requirement.modelRead ? 'model-read; ' : ''}grounding: {requirement.groundedBy.join(', ') || 'model-read exemption'}; screenshot: {requirement.screenshot ? 'required' : 'not required'}; recording segment: {requirement.recordingSegment ? 'required' : 'not required'}; {requirement.platformCaptured ? 'platform-captured' : 'adapter-acquired'}.</dd>
          </Fragment>)}</dl>
        </div>}
      </section>

      <section className="ls-plan-group" aria-labelledby={`${id}-conditions`}>
        <h3 className="ls-overline" id={`${id}-conditions`}>Conditions</h3>
        {plan.inputs.complianceConditions.map((condition) => <div key={condition.conditionId} className="ls-plan-panel">
          <div className="ls-plan-panel__head">
            <h4 className="ls-plan-panel__title">{condition.conditionId}</h4>
            <StatusBadge family="evaluation-origin" state={condition.status === 'RULE' ? 'Rule-Classified' : 'Agent-Judged (pending)'} />
          </div>
          <p className="ls-whitespace">{condition.text}</p>
          <dl className="ls-plan-facts">
            <dt>Applies when</dt><dd>{condition.applicability}</dd>
            <dt>Compiled applicability</dt><dd>{predicateText(condition.applicabilityAst)}</dd>
            {condition.rule === null
              ? <><dt>Certainty needed</dt><dd>At least {plan.inputs.agentJudgedThreshold}. Below that, the record is left for a person to decide.</dd></>
              : <><dt>Compiled rule</dt><dd>{ruleText(condition.rule)}</dd></>}
            {condition.policy === undefined ? null : <><dt>Privileged roles, frozen with this version</dt><dd>{policyText(condition.policy)}</dd></>}
          </dl>
        </div>)}
      </section>

      <section className="ls-plan-group" aria-labelledby={`${id}-credentials`}>
        <h3 className="ls-overline" id={`${id}-credentials`}>Sign-in credentials</h3>
        <dl className="ls-plan-facts ls-plan-facts--names">{plan.credentialReferences.map((reference) => <Fragment key={reference.targetSystemId}>
          <dt>{plan.inputs.targets.find((target) => target.registrationId === reference.targetSystemId)?.displayName}</dt>
          <dd><code className="ls-mono">{reference.credentialRef}</code></dd>
        </Fragment>)}</dl>
      </section>

      <section className="ls-plan-group" aria-labelledby={`${id}-limits`}>
        <h3 className="ls-overline" id={`${id}-limits`}>Execution limits</h3>
        <dl className="ls-plan-facts">
          <dt>Retries per Step Execution</dt><dd>{countWords(plan.limits.retriesPerStep)}</dd>
          <dt>Time per Step Execution</dt><dd>{durationWords(plan.limits.stepTimeoutSeconds)} ({countWords(plan.limits.stepTimeoutSeconds)} seconds)</dd>
          <dt>Step Executions per Run</dt><dd>{countWords(plan.limits.runStepExecutions)}</dd>
          <dt>Time per Run</dt><dd>{durationWords(plan.limits.runTimeoutSeconds)} ({countWords(plan.limits.runTimeoutSeconds)} seconds)</dd>
          <dt>Tokens per Run</dt><dd>{countWords(plan.limits.runTokens)}</dd>
        </dl>
        <p className="ls-caption">{model === null ? 'No model was used for this derivation.' : <>Derivation model: {model.provider} / {model.modelId}. Prompt version: {model.promptVersion}.</>}</p>
      </section>

    </div> : null}
  </section>;
}
