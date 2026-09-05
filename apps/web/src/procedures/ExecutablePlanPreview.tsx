'use client';

import { useEffect, useId, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { ProcedureVersionView } from '@intellifin/application';
import { Banner } from '../design/Banner';
import { StatusBadge } from '../design/StatusBadge';
import { predicateText, ruleText } from './plan-condition-text';
import { startPlanPolling } from './plan-polling';

import { ACTION_LABELS } from './plan-step-labels';

/** The saved durable contract only. This component never compiles or executes a plan. */
export function ExecutablePlanPreview({ draft, modelConfiguration }: { readonly draft: ProcedureVersionView; readonly modelConfiguration?: ProcedureVersionView['derivationModel'] }): React.JSX.Element {
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
  return <section className="ls-card ls-stack" aria-labelledby={`${id}-title`} data-testid="executable-plan-preview">
    <h2 className="ls-card__title" id={`${id}-title`}>Executable plan preview</h2>
    <p>This plan is read-only. Change the originating Builder section to revise it.</p>
    <div role="status" aria-live="polite">
      {draft.planStatus === 'pending' ? <p>{prolongedKey === pendingKey ? 'The executable plan is still pending. Automatic checks have paused after two minutes; this does not mean derivation failed. Reload the page to check again.' : 'Re-deriving the executable plan…'}</p> : draft.planStatus === 'failed' || plan === null ? <Banner tone="warning" title={`Cannot derive: ${draft.planFailureReason ?? 'No valid stored plan is available.'}`} /> : <p>Re-derived{attempt === undefined ? '' : ' at '} {attempt === undefined ? null : <time dateTime={attempt.completedAt ?? attempt.attemptedAt}>{attempt.completedAt ?? attempt.attemptedAt}</time>}.</p>}
    </div>
    {draft.planStatus === 'succeeded' && plan !== null ? <>
      <h3>Session Steps</h3>
      <ol>{plan.sessionSteps.map((step) => <li key={step.id}><strong>{ACTION_LABELS[step.action]}{step.targetSystemId === null ? '' : ` — ${plan.inputs.targets.find((target) => target.registrationId === step.targetSystemId)?.displayName ?? step.targetSystemId}`}</strong><p>{step.text}</p></li>)}</ol>
      <h3>Ordered Plan Steps per Target System</h3>
      {plan.targetSystems.map((system) => {
        const target = plan.inputs.targets.find((entry) => entry.registrationId === system.registrationId)!;
        const instruction = plan.inputs.instructions.find((entry) => entry.registrationId === system.registrationId);
        return <div key={system.registrationId} className="ls-stack">
          <h4>{target.displayName}</h4>
          {instruction === undefined ? null : <p className="ls-whitespace">{instruction.text}</p>}
          <p>Permitted read actions: {target.contract.permitted_actions.join(', ')}.</p>
          <ol>{system.planSteps.map((step) => <li key={step.id}><strong>{ACTION_LABELS[step.action]}</strong><p>{step.text}</p></li>)}</ol>
        </div>;
      })}
      <h3>Observations to capture</h3>
      <ul>{plan.observations.map((observation) => <li key={observation.attributeName}>{observation.attributeName} ({observation.valueType})</li>)}</ul>
      <h3>Evidence and grounding</h3>
      {plan.inputs.evidenceRequirements.length === 0 ? <p>No additional Evidence Requirements were authored.</p> : <ul>{plan.inputs.evidenceRequirements.map((requirement) => <li key={requirement.attributeName}>
        <strong>{requirement.attributeName}</strong>: {requirement.modelRead ? 'model-read; ' : ''}grounding: {requirement.groundedBy.join(', ') || 'model-read exemption'}; screenshot: {requirement.screenshot ? 'required' : 'not required'}; recording segment: {requirement.recordingSegment ? 'required' : 'not required'}; {requirement.platformCaptured ? 'platform-captured' : 'adapter-acquired'}.
      </li>)}</ul>}
      <h3>Conditions</h3>
      {plan.inputs.complianceConditions.map((condition) => <div key={condition.conditionId} className="ls-stack">
        <h4>{condition.conditionId}</h4>
        <StatusBadge family="evaluation-origin" state={condition.status === 'RULE' ? 'Rule-Classified' : 'Agent-Judged (pending)'} />
        <p className="ls-whitespace">{condition.text}</p><p>Applies when: {condition.applicability}</p>
        <p>Compiled applicability: {predicateText(condition.applicabilityAst)}.</p>
        {condition.rule === null ? <p>Agent-Judged confidence threshold: {plan.inputs.agentJudgedThreshold}. The judgment must reach this threshold; otherwise the condition is Unevaluated.</p> : <p>Compiled rule: {ruleText(condition.rule)}</p>}
      </div>)}
      <h3>Credential references</h3>
      <ul>{plan.credentialReferences.map((reference) => <li key={reference.targetSystemId}>{plan.inputs.targets.find((target) => target.registrationId === reference.targetSystemId)?.displayName}: <code>{reference.credentialRef}</code></li>)}</ul>
      <h3>Execution limits</h3>
      <dl><dt>Retries per Step Execution</dt><dd>{plan.limits.retriesPerStep}</dd><dt>Seconds per Step Execution</dt><dd>{plan.limits.stepTimeoutSeconds}</dd><dt>Step Executions per Run</dt><dd>{plan.limits.runStepExecutions}</dd><dt>Seconds per Run</dt><dd>{plan.limits.runTimeoutSeconds}</dd><dt>Tokens per Run</dt><dd>{plan.limits.runTokens}</dd></dl>
      {model === null ? <p>No model was used for this derivation.</p> : <p>Derivation model: {model.provider} / {model.modelId}. Prompt version: {model.promptVersion}.</p>}
    </> : null}
  </section>;
}
