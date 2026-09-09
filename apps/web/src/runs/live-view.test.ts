import { describe, expect, it } from 'vitest';

import { ACTIVE_RUN_STATES, RUN_STATES } from '@intellifin/domain';
import type { RunFrameRow, RunStepExecutionRow } from '@intellifin/infrastructure';

import {
  LIVE_VIEW_CHROME,
  chromeDotClass,
  currentStepExecution,
  frameNarration,
  liveViewChrome,
  plannedStepCount,
  stepNarration,
} from './live-view';

const EXECUTION: RunStepExecutionRow = {
  stepExecutionId: '01990000-0000-7000-8000-0000000005a1',
  planStepId: 'loancore-2',
  workItemId: null,
  action: 'inspect-record',
  state: 'RUNNING',
  attempt: 1,
  startedAt: '2026-09-09T06:12:00.000Z',
  completedAt: null,
  diagnostic: null,
};

const FRAME: RunFrameRow = {
  evidenceId: '01990000-0000-7000-8000-0000000005b1',
  toolActionId: '01990000-0000-7000-8000-0000000005b2',
  stepExecutionId: EXECUTION.stepExecutionId,
  workItemId: null,
  action: 'read-attribute',
  digest: 'a'.repeat(64),
  size: 1024,
  mediaType: 'image/png',
  sourceLocation: 'http://localhost:4300/loancore/users/E-000102',
  capturedAt: '2026-09-09T06:12:03.000Z',
  actionStartedAt: '2026-09-09T06:12:02.000Z',
};

describe('the session viewer chrome', () => {
  it('maps every Run state the domain has, and gives a Queued Run no session word', () => {
    // Every state is mapped deliberately: a state that fell through to a word would put a
    // session label on a Run that has none, and the four words are a closed vocabulary.
    const mapped = Object.fromEntries(RUN_STATES.map((state) => [state, liveViewChrome(state)]));
    expect(mapped).toEqual({
      QUEUED: null,
      RUNNING: 'LIVE',
      PAUSED: 'PAUSED',
      AWAITING_AUDITOR: 'AWAITING',
      COMPLETED: 'REPLAY',
      INCONCLUSIVE: 'REPLAY',
      RUN_FAILED: 'REPLAY',
      CANCELED: 'REPLAY',
    });
  });

  it('gives every active state but Queued a live session word, and every terminal state REPLAY', () => {
    for (const state of ACTIVE_RUN_STATES) {
      expect(liveViewChrome(state) === 'REPLAY', state).toBe(false);
    }
    for (const state of RUN_STATES) {
      const terminal = !(ACTIVE_RUN_STATES as readonly string[]).includes(state);
      if (terminal) expect(liveViewChrome(state), state).toBe('REPLAY');
    }
  });

  it('refuses a word for a state outside the vocabulary rather than guessing one', () => {
    expect(liveViewChrome('constructor')).toBeNull();
    expect(liveViewChrome('')).toBeNull();
    expect(liveViewChrome('LIVE')).toBeNull();
  });

  it('names a dot class for every word in the closed vocabulary', () => {
    expect(LIVE_VIEW_CHROME.map(chromeDotClass)).toEqual([
      'ls-session__dot ls-session__dot--live',
      'ls-session__dot ls-session__dot--paused',
      'ls-session__dot ls-session__dot--awaiting',
      'ls-session__dot ls-session__dot--replay',
    ]);
  });
});

describe('the Step counter and narration', () => {
  it('counts the frozen plan\'s own steps and says nothing when the plan is unreadable', () => {
    const plan = {
      sessionSteps: [{}, {}],
      targetSystems: [{ planSteps: [{}, {}, {}] }, { planSteps: [{}, {}, {}] }],
    } as never;
    expect(plannedStepCount(plan)).toBe(8);
    expect(plannedStepCount(null)).toBeNull();
  });

  it('gives the frame the SAME narration string as its Step row', () => {
    // EXPERIENCE.md: "Session viewer frames carry an `alt` narration equal to the Step
    // narration." Equal, not merely similar — so the two callers share one function.
    const narration = stepNarration(EXECUTION, 'LoanCore');
    expect(narration).toBe('Inspect the record on LoanCore, plan step loancore-2, started 2026-09-09T06:12:00.000Z.');
    expect(frameNarration(FRAME, EXECUTION, 'LoanCore')).toBe(narration);
  });

  it('narrates the capturing action when the Step Execution cannot be resolved', () => {
    expect(frameNarration(FRAME, null, 'LoanCore'))
      .toBe('Read an attribute on LoanCore, captured 2026-09-09T06:12:02.000Z.');
    expect(frameNarration(FRAME, null, null)).toBe('Read an attribute, captured 2026-09-09T06:12:02.000Z.');
  });

  it('narrates without a Target System when the Step names none', () => {
    expect(stepNarration({ ...EXECUTION, action: 'create-workspace', planStepId: 'session-1' }, null))
      .toBe('Create the Agent Workspace, plan step session-1, started 2026-09-09T06:12:00.000Z.');
  });

  it('takes the newest Step Execution as the current one, whatever order it was read in', () => {
    const older = { ...EXECUTION, stepExecutionId: 'older', startedAt: '2026-09-09T06:10:00.000Z' };
    const newer = { ...EXECUTION, stepExecutionId: 'newer', startedAt: '2026-09-09T06:14:00.000Z' };
    expect(currentStepExecution([older, newer])?.stepExecutionId).toBe('newer');
    expect(currentStepExecution([newer, older])?.stepExecutionId).toBe('newer');
    expect(currentStepExecution([])).toBeNull();
  });
});
