import type { ProcedureVersionView } from '@intellifin/application';

import { ReadinessPanel } from './ReadinessPanel';
import { ACTION_LABELS } from './plan-step-labels';
import { countWords, durationWords } from './plan-numbers';

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
 *
 * The shape is the reading order, not the plan's storage order. A Session Step happens
 * ONCE and a plan step happens PER RECORD, and an auditor who cannot tell those apart
 * cannot judge what a Run costs — so they are two labelled groups rather than one list
 * followed by a sentence that says "then, for every record" in prose.
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
  const systems = plan === null ? [] : plan.inputs.targets.map((target) => target.displayName);
  // Every Target System carries the same three plan steps by construction, so the first
  // one is the per-record sequence. Read, never restated.
  const perRecord = plan?.targetSystems[0]?.planSteps ?? [];
  const evidence = plan?.inputs.evidenceRequirements ?? [];
  // Read as a number, not as the compiler's literal type: the sentence must stay right
  // if a later compiler version freezes a different bound, and `=== 1` against a
  // literal `3` does not even compile.
  const retries: number = plan?.limits.retriesPerStep ?? 0;
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
        <div className="ls-plan-groups">
          <p className="ls-caption">
            Written by the platform from what you entered — not by the agent. Every Run
            of this version does exactly this, in this order, and nothing below is
            decided while it runs.
          </p>

          <section className="ls-plan-group" aria-labelledby={`${headingId}-once`}>
            <h3 className="ls-overline" id={`${headingId}-once`}>
              Once, at the start
            </h3>
            <ol className="ls-plan-steps">
              {plan.sessionSteps.map((step) => {
                const target = plan.inputs.targets.find(
                  (entry) => entry.registrationId === step.targetSystemId,
                );
                return (
                  <li key={step.id} data-agent-step={step.action}>
                    <span className="ls-plan-step__title">
                      {ACTION_LABELS[step.action]}
                      {target === undefined ? '' : ` — ${target.displayName}`}
                    </span>
                  </li>
                );
              })}
            </ol>
          </section>

          <section className="ls-plan-group" aria-labelledby={`${headingId}-each`}>
            <h3 className="ls-overline" id={`${headingId}-each`}>
              Then, for every record in the population
            </h3>
            <p className="ls-caption">
              {systems.length === 1
                ? `In ${systems[0]}.`
                : `In each of ${systems.length} systems: ${systems.join(', ')}.`}
            </p>
            <ol className="ls-plan-steps">
              {perRecord.map((step) => (
                <li key={step.id} data-agent-record-step={step.action}>
                  <span className="ls-plan-step__title">{ACTION_LABELS[step.action]}</span>
                </li>
              ))}
            </ol>
          </section>

          <section className="ls-plan-group" aria-labelledby={`${headingId}-writes`}>
            <h3 className="ls-overline" id={`${headingId}-writes`}>
              What it writes down
            </h3>
            <dl className="ls-plan-facts">
              <dt>Captures</dt>
              <dd>
                <ul className="ls-tag-row">
                  {plan.observations.map((observation) => (
                    <li key={observation.attributeName} className="ls-tag">
                      {observation.attributeName}
                    </li>
                  ))}
                </ul>
              </dd>
              <dt>Freezes proof of</dt>
              <dd>
                {evidence.length === 0 ? (
                  'Nothing beyond what the Template already asks for.'
                ) : (
                  <ul className="ls-tag-row">
                    {evidence.map((requirement) => (
                      <li key={requirement.attributeName} className="ls-tag">
                        {requirement.attributeName}
                      </li>
                    ))}
                  </ul>
                )}
              </dd>
            </dl>
          </section>

          <section className="ls-plan-group" aria-labelledby={`${headingId}-limits`}>
            <h3 className="ls-overline" id={`${headingId}-limits`}>
              When it stops on its own
            </h3>
            <dl className="ls-plan-facts">
              <dt>Stops after</dt>
              <dd>
                {countWords(plan.limits.runStepExecutions)} steps,{' '}
                {durationWords(plan.limits.runTimeoutSeconds)}, or{' '}
                {countWords(plan.limits.runTokens)} tokens — whichever comes first
              </dd>
              <dt>Retries</dt>
              <dd>
                A failed step {countWords(retries)} {retries === 1 ? 'time' : 'times'}
              </dd>
            </dl>
          </section>
        </div>
      )}
      {withReadiness ? (
        <ReadinessPanel inputs={readiness} headingId={`${headingId}-readiness`} headingLevel={3} />
      ) : null}
    </section>
  );
}
