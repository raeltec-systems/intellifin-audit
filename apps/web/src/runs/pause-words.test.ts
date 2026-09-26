import { describe, expect, it } from 'vitest';

import { deriveExecutablePlan, type ExecutablePlan } from '@intellifin/domain';
import type { RunPauseClosure, RunPauseEntry, RunPauseHold } from '@intellifin/infrastructure';

import { executablePlanInputs } from '../../../../tests/fixtures/executable-plan';
import { MASKED_VALUE } from '../design/copy';
import { planActionWord } from './labels';
import {
  PAUSE_WORDS,
  bannerHeldAfterInspectionWords,
  bannerHeldBeforeWords,
  bannerHeldInFlightWords,
  heldAfterInspectionWords,
  heldBeforeWords,
  heldInFlightWords,
  keySegments,
  pauseBannerResumeWords,
  pauseClosureSentences,
  pauseHoldRead,
  pauseHoldSentences,
  pauseStepNamer,
  pauseSubjectKeys,
  planStepFacts,
  restartedWords,
  resumedByWords,
  startedWords,
  stepWords,
  timedOutWords,
  withdrawnWords,
} from './pause-words';

/**
 * Where a pause held the Run and which attempt its resume started, in words (Story 10.6,
 * legacy 5.4). Every expected sentence is built by the function the surface calls for THAT
 * branch, so a branch that answered with another arm's sentence fails here; the wording
 * itself is `[PROPOSED]` and lives in one place, `pause-words.ts`.
 */

const derived = deriveExecutablePlan(executablePlanInputs());
if (!derived.ok) throw new Error(`The fixture plan did not compile: ${derived.reason}`);
const PLAN: ExecutablePlan = derived.plan;
const TARGET = PLAN.targetSystems[0]!;
const SYSTEM = PLAN.inputs.targets[0]!.displayName;
const SIGN_IN = PLAN.sessionSteps.find((step) => step.action === 'sign-in')!;
const INSPECT = TARGET.planSteps.find((step) => step.action === 'inspect-record')!;

const ITEM = { workItemId: '019823ab-0000-7000-8000-0000000000b1', subjectKey: 'max_manual_approval_amount' };
const NEXT_ITEM = { workItemId: '019823ab-0000-7000-8000-0000000000b2', subjectKey: 'session_timeout_minutes' };
const NAMER = pauseStepNamer(PLAN, new Map());

function recorded(overrides: Partial<Extract<RunPauseHold, { kind: 'recorded' }>> = {}): RunPauseHold {
  return { kind: 'recorded', planStepId: SIGN_IN.id, workItem: null, superseded: null, settled: null, ...overrides };
}

describe('naming a plan step', () => {
  it('names a step by its action and system, never by its identifier', () => {
    expect(planStepFacts(PLAN, SIGN_IN.id)).toEqual({ action: 'sign-in', system: SYSTEM });
    expect(stepWords(planStepFacts(PLAN, SIGN_IN.id), null, SIGN_IN.id))
      .toBe(`“${planActionWord('sign-in')}” on ${SYSTEM}`);
    expect(stepWords(planStepFacts(PLAN, INSPECT.id), 'E-000102', INSPECT.id))
      .toBe(`“${planActionWord('inspect-record')}” for E-000102 on ${SYSTEM}`);
  });

  it('still names a step the plan cannot place, by the identifier the event recorded', () => {
    // A pause that said nothing about where it held the Run would read as one that held it
    // nowhere, so an unreadable plan or an unknown step says the step's identifier instead.
    expect(planStepFacts(null, SIGN_IN.id)).toBeNull();
    expect(planStepFacts(PLAN, 'session-99')).toBeNull();
    expect(stepWords(null, 'E-000102', 'session-99')).toBe('plan step “session-99”');
  });

  it('names a record by the one record label rule, masked where the frozen binding masks it', () => {
    expect(NAMER.record(ITEM)).toBe(ITEM.subjectKey);
    expect(NAMER.record({ ...ITEM, subjectKey: null })).toBeNull();
    expect(NAMER.record(null)).toBeNull();
    const snapshot = PLAN.inputs.sourceSnapshot!;
    const masking = {
      ...PLAN,
      inputs: { ...PLAN.inputs, sourceSnapshot: { ...snapshot, contract: { ...snapshot.contract, sensitive_fields: ['parameter'] } } },
    } as ExecutablePlan;
    const masked = pauseStepNamer(masking, new Map());
    expect(masked.record(ITEM)).toBe(MASKED_VALUE);
    expect(masked.step(INSPECT.id, ITEM)).not.toContain(ITEM.subjectKey);
    expect(masked.step(INSPECT.id, ITEM)).toContain(MASKED_VALUE);
  });
});

describe('where a pause held the Run', () => {
  it('names the attempt an in-flight pause superseded, at the step and record it was on', () => {
    const hold = recorded({
      planStepId: INSPECT.id,
      workItem: ITEM,
      superseded: { stepExecutionId: '019823ab-0000-7000-8000-0000000000c1', planStepId: INSPECT.id, attempt: 2, workItem: ITEM },
    });
    const step = NAMER.step(INSPECT.id, ITEM);
    expect(pauseHoldSentences({ mode: 'immediate', hold }, NAMER, 'past')).toEqual([heldInFlightWords(step, 2)]);
    expect(pauseHoldSentences({ mode: 'immediate', hold }, NAMER, 'present')).toEqual([bannerHeldInFlightWords(step, 2)]);
    expect(step).toContain(ITEM.subjectKey);
  });

  it('names the step a between-units pause held the Run before, and says no attempt was in flight', () => {
    const hold = recorded();
    const step = NAMER.step(SIGN_IN.id, null);
    expect(pauseHoldSentences({ mode: 'immediate', hold }, NAMER, 'past'))
      .toEqual([heldBeforeWords(step), PAUSE_WORDS.noStepInFlight]);
    expect(pauseHoldSentences({ mode: 'immediate', hold }, NAMER, 'present'))
      .toEqual([bannerHeldBeforeWords(step), PAUSE_WORDS.noStepInFlight]);
  });

  it('names the inspection that settled and the unit the Run is held before, after an inspection', () => {
    const hold = recorded({ planStepId: INSPECT.id, workItem: NEXT_ITEM, settled: ITEM });
    const step = NAMER.step(INSPECT.id, NEXT_ITEM);
    expect(pauseHoldSentences({ mode: 'after-inspection', hold }, NAMER, 'past'))
      .toEqual([heldAfterInspectionWords(step, ITEM.subjectKey), PAUSE_WORDS.noStepInFlight]);
    expect(pauseHoldSentences({ mode: 'after-inspection', hold }, NAMER, 'present'))
      .toEqual([bannerHeldAfterInspectionWords(step, ITEM.subjectKey), PAUSE_WORDS.noStepInFlight]);
    // The settled inspection could not be read: the pause still says it came after one.
    expect(pauseHoldSentences({ mode: 'after-inspection', hold: recorded({ planStepId: INSPECT.id, workItem: NEXT_ITEM }) }, NAMER, 'past'))
      .toEqual([heldAfterInspectionWords(step, null), PAUSE_WORDS.noStepInFlight]);
  });

  it('says a historical pause that recorded no step did not record one, in both tenses', () => {
    const hold: RunPauseHold = { kind: 'not-recorded' };
    expect(pauseHoldSentences({ mode: 'immediate', hold }, NAMER, 'past')).toEqual([PAUSE_WORDS.heldNotRecorded]);
    expect(pauseHoldSentences({ mode: 'immediate', hold }, NAMER, 'present')).toEqual([PAUSE_WORDS.holdsNotRecorded]);
  });

  it('gives the banner the superseded attempt, and an unreadable entry as unreadable', () => {
    const superseded = '019823ab-0000-7000-8000-0000000000c2';
    const hold = recorded({
      planStepId: INSPECT.id,
      workItem: ITEM,
      superseded: { stepExecutionId: superseded, planStepId: INSPECT.id, attempt: 1, workItem: ITEM },
    });
    expect(pauseHoldRead({ mode: 'immediate', hold }, NAMER)).toEqual({
      kind: 'read',
      sentences: [bannerHeldInFlightWords(NAMER.step(INSPECT.id, ITEM), 1)],
      supersededStepExecutionId: superseded,
      resume: 'restart',
      keys: [ITEM.subjectKey],
    });
    expect(pauseHoldRead({ mode: 'immediate', hold: recorded() }, NAMER))
      .toMatchObject({ kind: 'read', supersededStepExecutionId: null, resume: 'start', keys: [] });
    expect(pauseHoldRead({ mode: 'immediate', hold: { kind: 'not-recorded' } }, NAMER))
      .toMatchObject({ kind: 'read', supersededStepExecutionId: null, resume: 'unknown' });
    expect(pauseHoldRead(null, NAMER)).toEqual({ kind: 'unreadable' });
  });

  // Screenshot review, 2026-09-26: the banner said "No Step Execution was in flight." and,
  // on the next line, "The agent restarts the current Step" — an attempt that never began.
  it('ends the banner with what Resume does for THIS hold, and keeps the old sentence where nothing says', () => {
    const read = (resume: 'restart' | 'start' | 'unknown') =>
      ({ kind: 'read', sentences: [], supersededStepExecutionId: null, resume, keys: [] }) as const;
    expect(pauseBannerResumeWords(read('restart'))).toBe(PAUSE_WORDS.resumeRestarts);
    expect(pauseBannerResumeWords(read('start'))).toBe(PAUSE_WORDS.resumeStarts);
    expect(pauseBannerResumeWords(read('unknown'))).toBe(PAUSE_WORDS.resumeUnknown);
    expect(pauseBannerResumeWords({ kind: 'unreadable' })).toBe(PAUSE_WORDS.resumeUnknown);
    expect(pauseBannerResumeWords({ kind: 'none' })).toBe(PAUSE_WORDS.resumeUnknown);
    // Only an interrupted attempt is restarted; a between-units hold is started.
    expect(PAUSE_WORDS.resumeStarts).not.toContain('restart');
    expect(PAUSE_WORDS.resumeRestarts).toContain('restarts');
  });
});

describe('keeping a record key on one line', () => {
  it('splits a sentence at each record key and changes none of its text', () => {
    const text = 'Held at “Inspect the record” for E-000102 on LoanCore, before E-000103.';
    const segments = keySegments(text, ['E-000102', 'E-000103']);
    expect(segments.map((segment) => segment.text).join('')).toBe(text);
    expect(segments.filter((segment) => segment.key).map((segment) => segment.text)).toEqual(['E-000102', 'E-000103']);
  });

  it('keeps the longer key whole where two start at one place, and ignores keys that are not there', () => {
    expect(keySegments('for AB-12 and AB-1.', ['AB-1', 'AB-12'])).toEqual([
      { text: 'for ', key: false }, { text: 'AB-12', key: true }, { text: ' and ', key: false },
      { text: 'AB-1', key: true }, { text: '.', key: false },
    ]);
    expect(keySegments('No key here.', ['E-1', ''])).toEqual([{ text: 'No key here.', key: false }]);
    expect(keySegments('E-1', ['E-1', 'E-1'])).toEqual([{ text: 'E-1', key: true }]);
  });
});

describe('how a pause ended', () => {
  const render = { actor: (id: string | null) => (id === null ? null : `person ${id}`), time: (iso: string) => `at-${iso}` };

  const DEADLINE = '2026-09-26T10:30:00.000Z';
  const ended = (hold: RunPauseHold, closure: RunPauseClosure) => ({ hold, closure, deadline: DEADLINE });
  const inFlight = recorded({
    planStepId: INSPECT.id,
    workItem: ITEM,
    superseded: { stepExecutionId: 'sx', planStepId: INSPECT.id, attempt: 3, workItem: ITEM },
  });
  const started: RunPauseClosure = {
    kind: 'resumed',
    resumedBy: 'u1',
    resumedAt: '2026-09-26T10:00:00.000Z',
    restart: { kind: 'started', attempt: { stepExecutionId: 'se', planStepId: INSPECT.id, attempt: 3, workItem: ITEM } },
  };

  it('says a resume RESTARTED the attempt a pause interrupted, at the step and record it was on', () => {
    expect(pauseClosureSentences(ended(inFlight, started), NAMER, render)).toEqual([
      resumedByWords('person u1', 'at-2026-09-26T10:00:00.000Z'),
      restartedWords(NAMER.step(INSPECT.id, ITEM), 3),
    ]);
  });

  // Screenshot review, 2026-09-26: a pause held before the sign-in said its resume
  // "restarted" the sign-in, which had never begun.
  it('says a resume STARTED the held step after a pause between units, and never that it restarted it', () => {
    const between = recorded({ planStepId: INSPECT.id, workItem: ITEM });
    const sentences = pauseClosureSentences(ended(between, started), NAMER, render);
    expect(sentences).toEqual([
      resumedByWords('person u1', 'at-2026-09-26T10:00:00.000Z'),
      startedWords(NAMER.step(INSPECT.id, ITEM), 3),
    ]);
    expect(sentences.join(' ')).not.toContain('restarted');
  });

  it('says when a resume has started no attempt yet, and when its attempt was never recorded', () => {
    const base = { kind: 'resumed', resumedBy: null, resumedAt: '2026-09-26T10:00:00.000Z' } as const;
    expect(pauseClosureSentences(ended(inFlight, { ...base, restart: { kind: 'none' } }), NAMER, render))
      .toEqual([resumedByWords(null, 'at-2026-09-26T10:00:00.000Z'), PAUSE_WORDS.restartNone]);
    expect(pauseClosureSentences(ended({ kind: 'not-recorded' }, { ...base, restart: { kind: 'not-recorded' } }), NAMER, render))
      .toEqual([resumedByWords(null, 'at-2026-09-26T10:00:00.000Z'), PAUSE_WORDS.restartNotRecorded]);
    expect(resumedByWords(null, 'x')).toBe('Resumed at x.');
  });

  it('says a pause is still open, ran out, was withdrawn, or ended in a way this build cannot name', () => {
    expect(pauseClosureSentences(ended(inFlight, { kind: 'open' }), NAMER, render)).toEqual([PAUSE_WORDS.stillPaused]);
    // A pause that ran out reached its DEADLINE; the wake that closed it can run later.
    expect(pauseClosureSentences(ended(inFlight, { kind: 'timed-out', at: 't' }), NAMER, render))
      .toEqual([timedOutWords(`at-${DEADLINE}`)]);
    expect(pauseClosureSentences(ended(inFlight, { kind: 'withdrawn', at: 'w' }), NAMER, render)).toEqual([withdrawnWords('at-w')]);
    expect(pauseClosureSentences(ended(inFlight, { kind: 'unknown' }), NAMER, render)).toEqual([PAUSE_WORDS.closureUnknown]);
  });
});

describe('the records a pause history names', () => {
  it('collects every record key, once, so the names are read in one query', () => {
    const entry = (hold: RunPauseHold, closure: RunPauseClosure): Pick<RunPauseEntry, 'hold' | 'closure'> => ({ hold, closure });
    const keys = pauseSubjectKeys([
      entry(recorded({ workItem: ITEM, settled: NEXT_ITEM }), { kind: 'open' }),
      entry(recorded({ superseded: { stepExecutionId: 's', planStepId: INSPECT.id, attempt: 1, workItem: { workItemId: 'w3', subjectKey: 'third' } } }),
        { kind: 'resumed', resumedBy: null, resumedAt: 'r', restart: { kind: 'started', attempt: { stepExecutionId: 't', planStepId: INSPECT.id, attempt: 2, workItem: { workItemId: 'w4', subjectKey: 'fourth' } } } }),
      entry({ kind: 'not-recorded' }, { kind: 'unknown' }),
      entry(recorded({ workItem: ITEM }), { kind: 'open' }),
    ]);
    expect([...keys].sort()).toEqual([ITEM.subjectKey, NEXT_ITEM.subjectKey, 'fourth', 'third'].sort());
  });
});
