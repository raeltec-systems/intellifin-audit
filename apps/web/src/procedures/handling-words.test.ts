import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import type { ProcedureVersionView } from '@intellifin/application';
import { deriveExecutablePlan, type ExecutablePlan } from '@intellifin/domain';

import { executablePlanInputs } from '../../../../tests/fixtures/executable-plan';
import { ScheduleForm } from './EvidenceScheduleForm';
import {
  ASKS_A_PERSON_LABEL,
  HANDLING_HEADING,
  RETRIES_LABEL,
  STOPS_AFTER_LABEL,
  asksAPersonWords,
  retriesWords,
  stopsAfterWords,
} from './handling-words';

/**
 * The handling the Schedule step used to promise in its title and never show.
 *
 * "Frequency and handling" offered a frequency and a time; when the agent stops, retries
 * or asks a person was frozen by the compiler and rendered only by `AgentSummary`. These
 * tests hold the two claims that matter: every number is READ from the plan, and a Draft
 * with no plan yet is told nothing rather than the compiler's current defaults.
 */

function plan(): ExecutablePlan {
  const result = deriveExecutablePlan(executablePlanInputs());
  if (!result.ok) throw new Error(result.reason);
  return result.plan;
}

/** A plan carrying different frozen limits. The limits are `z.literal`s, so the cast is
 *  the only way to state a plan this build would refuse to derive — which is the point. */
function withLimits(source: ExecutablePlan, limits: Record<string, number>): ExecutablePlan {
  return { ...source, limits: { ...source.limits, ...limits } } as unknown as ExecutablePlan;
}

describe('the handling facts are read from the plan', () => {
  it('says the three stop limits the plan froze, grouped and in words', () => {
    const limits = plan().limits;
    const words = stopsAfterWords(limits);
    // Formatted INDEPENDENTLY here: asking the module for its own formatter would
    // compare it with a copy of itself.
    expect(words).toContain(limits.runStepExecutions.toLocaleString('en-US'));
    expect(words).toContain(limits.runTokens.toLocaleString('en-US'));
    expect(words).toContain('1 hour'); // runTimeoutSeconds is 3600
    expect(words).toContain('whichever comes first');
  });

  it('says different numbers for a plan carrying different limits', () => {
    const other = stopsAfterWords(withLimits(plan(), { runStepExecutions: 42, runTimeoutSeconds: 90, runTokens: 7 }).limits);
    expect(other).toContain('42 steps');
    expect(other).toContain('1 minute 30 seconds');
    expect(other).toContain('7 tokens');
    expect(other).not.toContain(plan().limits.runStepExecutions.toLocaleString('en-US'));
  });

  it('pluralises the retry count from the value, not from the compiler literal', () => {
    expect(retriesWords(plan().limits)).toBe(`A failed step ${plan().limits.retriesPerStep} times`);
    expect(retriesWords(withLimits(plan(), { retriesPerStep: 1 }).limits)).toBe('A failed step 1 time');
  });

  it('says nothing about asking a person when no condition is judged that way', () => {
    // The fixture's Template compiles one Rule-Classified condition. Nothing on this
    // plan can reach the certainty threshold, so printing one would describe a stop
    // this version cannot make.
    expect(plan().inputs.complianceConditions.every((condition) => condition.status === 'RULE')).toBe(true);
    expect(asksAPersonWords(plan())).toBeNull();
  });

  it('names the frozen certainty threshold exactly when a condition is judged', () => {
    const source = plan();
    const judged = {
      ...source,
      inputs: {
        ...source.inputs,
        agentJudgedThreshold: '0.80',
        complianceConditions: source.inputs.complianceConditions.map((condition) => ({ ...condition, status: 'AGENT_JUDGED' })),
      },
    } as unknown as ExecutablePlan;
    const words = asksAPersonWords(judged);
    // Exactly as frozen: a decimal string, never parsed and never rounded to `0.8`.
    expect(words).toContain('0.80');
    expect(words).toContain('for a person to decide');
    expect(words).toContain('1 condition');
  });
});

function view(compiled: ExecutablePlan | null): ProcedureVersionView {
  const input = executablePlanInputs();
  return {
    ...input,
    versionId: 'version', procedureId: 'procedure', versionNumber: 1, state: 'DRAFT',
    targetBlockers: [], evidenceBlockers: [],
    createdAt: '2026-09-04T00:00:00Z', updatedAt: '2026-09-04T00:00:00Z',
    planCompilerVersion: '1', compiledPlan: compiled, planDerivable: true,
    planStatus: compiled === null ? 'pending' : 'succeeded', planFailureReason: null,
    planInputDigest: 'digest', derivationModel: null, planAttempts: [],
  };
}

const schedule = (draft: ProcedureVersionView): string =>
  renderToStaticMarkup(
    React.createElement(ScheduleForm, {
      draft,
      rowVersion: 'token',
      onSave: async () => ({ ok: true, rowVersion: 'token', changed: false }) as never,
    }),
  );

describe('the Schedule step shows the handling it no longer promises to edit', () => {
  it('reads the stop and retry facts out of the plan, under one heading', () => {
    const html = schedule(view(plan()));
    expect(html).toContain('data-schedule-handling');
    expect(html).toContain(HANDLING_HEADING);
    expect(html).toContain(STOPS_AFTER_LABEL);
    expect(html).toContain(RETRIES_LABEL);
    expect(html).toContain(stopsAfterWords(plan().limits));
    expect(html).toContain(retriesWords(plan().limits));
    // The fixture's conditions are all Rule-Classified, so there is nothing to ask about
    // and the row is absent rather than blank.
    expect(html).not.toContain(ASKS_A_PERSON_LABEL);
  });

  it('says nothing at all before this version has a plan', () => {
    const html = schedule(view(null));
    expect(html).not.toContain('data-schedule-handling');
    expect(html).not.toContain(HANDLING_HEADING);
    // And the invented-fact guard: the compiler's defaults must not appear from nowhere.
    expect(html).not.toContain(stopsAfterWords(plan().limits));
  });

  it('still says a saved time starts nothing, and where a Run is started', () => {
    const html = schedule(view(plan()));
    expect(html).toContain('Nothing runs by itself yet.');
    expect(html).toContain('Runs are started by hand from the Procedure page.');
  });
});
