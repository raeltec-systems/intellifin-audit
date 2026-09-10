import type { ProcedureVersionView } from '@intellifin/application';

import { ReadinessPanel } from './ReadinessPanel';
import { ACTION_LABELS } from './plan-step-labels';

/**
 * "Here is what the agent will do", in the order it will do it.
 *
 * Derived ENTIRELY from the executable plan the Draft already froze — the Session Steps
 * and the per-Target plan steps each carry their own canonical text — plus the advisory
 * readiness items. It compiles nothing, calls no model, and adds no vocabulary: a
 * summary that could disagree with the plan beneath it would be worse than no summary,
 * because it is the one a person actually reads before spending a Run.
 *
 * `ExecutablePlanPreview` stays the full, read-only contract. This is the same plan at
 * the altitude of a decision: how many systems, how many steps against each, what is
 * captured, and what looks likely to stop it.
 */
export function AgentSummary({
  draft,
  headingId,
  readiness: withReadiness = true,
}: {
  readonly draft: ProcedureVersionView;
  readonly headingId: string;
  /**
   * Whether this summary carries the readiness list inside it.
   *
   * The version review page has nowhere else to put it, so it keeps it. The Builder
   * raises readiness to the top level instead — "what would make this Run produce
   * nothing useful" is the one thing an auditor should meet before they decide to
   * spend a Run, and it must not be behind the same fold as the compiled plan.
   */
  readonly readiness?: boolean;
}): React.JSX.Element {
  const plan = draft.planStatus === 'succeeded' ? draft.compiledPlan : null;
  const readiness = {
    templateId: draft.templateId,
    targets: draft.targets,
    sourceSnapshot: draft.sourceSnapshot,
    complianceConditions: draft.complianceConditions,
    evidenceRequirements: draft.evidenceRequirements,
  };
  return (
    <section className="ls-card ls-stack" aria-labelledby={headingId} data-agent-summary>
      <h2 className="ls-card__title" id={headingId}>
        What the agent will do
      </h2>
      {plan === null ? (
        <p data-agent-summary-empty>
          No plan has been worked out yet, so there is nothing to summarise. The
          step-by-step plan below says whether it is still being worked out, or could not
          be, and why.
        </p>
      ) : (
        <>
          <ol className="ls-stack">
            {plan.sessionSteps.map((step) => {
              const target = plan.inputs.targets.find(
                (entry) => entry.registrationId === step.targetSystemId,
              );
              return (
                <li key={step.id} data-agent-step={step.action}>
                  <strong>
                    {ACTION_LABELS[step.action]}
                    {target === undefined ? '' : ` — ${target.displayName}`}
                  </strong>
                </li>
              );
            })}
          </ol>
          <p>
            Then, for every record of the bound population, against{' '}
            {plan.targetSystems.length === 1
              ? 'one Target System'
              : `each of ${plan.targetSystems.length} Target Systems`}
            :{' '}
            {plan.targetSystems[0]?.planSteps.map((step) => ACTION_LABELS[step.action]).join(', ')}.
          </p>
          <p>
            It captures {plan.observations.map((observation) => observation.attributeName).join(', ')}
            {plan.inputs.evidenceRequirements.length === 0
              ? '.'
              : `, and freezes Evidence for ${plan.inputs.evidenceRequirements.map((requirement) => requirement.attributeName).join(', ')}.`}
          </p>
          <p>
            It stops on its own after {plan.limits.runStepExecutions} Step Executions,{' '}
            {plan.limits.runTimeoutSeconds} seconds or {plan.limits.runTokens} tokens,
            whichever comes first, and retries a failed Step {plan.limits.retriesPerStep}{' '}
            times.
          </p>
        </>
      )}
      {withReadiness ? (
        <ReadinessPanel inputs={readiness} headingId={`${headingId}-readiness`} headingLevel={3} />
      ) : null}
    </section>
  );
}
