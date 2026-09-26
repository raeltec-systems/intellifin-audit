import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { ESCALATION_KINDS, FIXED_ESCALATION_OPTIONS, MARK_AMBIGUOUS_OPTION } from '@intellifin/application';
import { deriveExecutablePlan, type ExecutablePlan } from '@intellifin/domain';
import type { RunPauseEntry, RunPauseRequestEntry } from '@intellifin/infrastructure';

import { executablePlanInputs } from '../../../../tests/fixtures/executable-plan';
import { ESCALATION_KIND_UNKNOWN, ESCALATION_KIND_WORDS } from '../design/plain-words';
import {
  ESCALATION_ANSWER_WORDS,
  ESCALATION_REPLAY_WORDS,
  PAUSE_REQUEST_WORDS,
  answeredByWords,
  aroundName,
  decisionSubjectKeys,
  escalationAnswerTitle,
  escalationAnswerWords,
  escalationAnswersShownWords,
  escalationRaiseSentences,
  escalationReplayAbsenceWords,
  escalationReplayHref,
  pauseHistoryRows,
  pauseRequestSentences,
  pauseRequestedByWords,
  pauseRequestsShownWords,
  platformOptionWords,
} from './decision-words';
import { choseCandidateWords, MATCH_DECISION_WORDS } from './match-words';
import { pauseStepNamer } from './pause-words';

/**
 * The words for the decisions a Run recorded (Story 10.10).
 *
 * The APPROVED sentences are read back out of the story on disk, where the owner's
 * approved list is written, so a word changed here and not there fails — the
 * `copy.test.ts` discipline, applied to the one place this wording is recorded. The
 * proposed ones are pinned by value, so a change to them is a visible diff to confirm.
 */

const STORY = readFileSync(
  resolve(__dirname, '../../../../_bmad-output/implementation-artifacts/10-10-retained-decision-history-on-the-execution-timeline-an-answe.md'),
  'utf8',
);
/**
 * The owner's approved list, and nothing else in the story. The markdown wraps long
 * sentences across lines, so runs of whitespace are read as the one space they are.
 */
const APPROVED = STORY.slice(STORY.indexOf('## Approved wording and layout'), STORY.indexOf('## Code Map')).replace(/\s+/gu, ' ');

const derived = deriveExecutablePlan(executablePlanInputs());
if (!derived.ok) throw new Error(`The fixture plan did not compile: ${derived.reason}`);
const PLAN: ExecutablePlan = derived.plan;
const INSPECT = PLAN.targetSystems[0]!.planSteps.find((step) => step.action === 'inspect-record')!;
const NAMER = pauseStepNamer(PLAN, new Map());

describe('the approved words, read back out of the story', () => {
  it('holds every approved Escalation answer sentence verbatim', () => {
    for (const sentence of [
      ESCALATION_ANSWER_WORDS.heading,
      ESCALATION_ANSWER_WORDS.intro,
      ESCALATION_ANSWER_WORDS.answeredBy,
      ESCALATION_ANSWER_WORDS.candidate,
      ESCALATION_ANSWER_WORDS.option,
      ESCALATION_ANSWER_WORDS.aborted,
      ESCALATION_ANSWER_WORDS.raisedAt,
      ESCALATION_ANSWER_WORDS.stepNotRecorded,
      ESCALATION_ANSWER_WORDS.openInReplay,
    ]) expect(APPROVED, sentence).toContain(`"${sentence}"`);
  });

  it('holds every approved pause request sentence verbatim', () => {
    for (const sentence of [PAUSE_REQUEST_WORDS.title, PAUSE_REQUEST_WORDS.requestedBy, PAUSE_REQUEST_WORDS.runEnded]) {
      expect(APPROVED, sentence).toContain(`"${sentence}"`);
    }
    // "It copies the existing cancellation sentence": the two differ only in what was asked for.
    expect(PAUSE_REQUEST_WORDS.runEnded.replace('pause took effect', 'cancellation was performed'))
      .toBe('The Run ended before the cancellation was performed, so its own outcome stands.');
  });

  it('says a candidate answer exactly as the human-match note says the same choice', () => {
    expect(escalationAnswerWords('choose-candidate', { kind: 'candidate', candidate: 2, candidates: 3, label: 'x' }))
      .toBe(`Answer: ${choseCandidateWords(2, 3)}.`);
    expect(escalationAnswerWords('choose-candidate', { kind: 'candidate', candidate: 2, candidates: 3, label: 'x' }))
      .toBe('Answer: chose candidate 2 of 3.');
  });

  it('keeps every sentence it did not get approved out of the approved list, so each is a visible proposal', () => {
    for (const sentence of [
      ESCALATION_ANSWER_WORDS.workItemNotRecorded,
      ESCALATION_ANSWER_WORDS.answerUnreadable,
      ESCALATION_ANSWER_WORDS.shown,
      PAUSE_REQUEST_WORDS.replaced,
      PAUSE_REQUEST_WORDS.outcomeUnknown,
      PAUSE_REQUEST_WORDS.afterInspection,
      PAUSE_REQUEST_WORDS.inspectionNotRecorded,
      PAUSE_REQUEST_WORDS.requestedByUntimed,
      PAUSE_REQUEST_WORDS.requestedAtUnnamed,
      PAUSE_REQUEST_WORDS.requesterNotRecorded,
      PAUSE_REQUEST_WORDS.shown,
      ESCALATION_REPLAY_WORDS.opened,
      ESCALATION_REPLAY_WORDS.noFrame,
      ESCALATION_REPLAY_WORDS.unavailable,
      ESCALATION_REPLAY_WORDS.chooseTarget,
    ]) expect(APPROVED).not.toContain(sentence);
    expect(ESCALATION_ANSWER_WORDS.workItemNotRecorded).toBe('The Work Item this Escalation was raised for was not recorded.');
    expect(ESCALATION_ANSWER_WORDS.answerUnreadable).toBe('The answer this Escalation received could not be read.');
    expect(PAUSE_REQUEST_WORDS.replaced).toBe('A request to pause the Run at once replaced it before it took effect.');
    expect(PAUSE_REQUEST_WORDS.afterInspection).toBe('It asked to pause after {step}.');
    expect(ESCALATION_REPLAY_WORDS.unavailable).toBe('The Escalation this link names is not available in this Replay view.');
    expect(ESCALATION_REPLAY_WORDS.noFrame).toBe('Opened for the Escalation “{kind}”: {absence}.');
    expect(ESCALATION_REPLAY_WORDS.chooseTarget).toBe('Choose a recorded target below.');
  });

  it('points a Replay note at the "Jump to" list only when that list holds a recorded target', () => {
    expect(escalationReplayAbsenceWords(ESCALATION_REPLAY_WORDS.unavailable, true))
      .toBe('The Escalation this link names is not available in this Replay view. Choose a recorded target below.');
    expect(escalationReplayAbsenceWords(ESCALATION_REPLAY_WORDS.unavailable, false)).toBe(ESCALATION_REPLAY_WORDS.unavailable);
  });

  it('labels the candidate text with the existing inert source label', () => {
    expect(ESCALATION_ANSWER_WORDS.candidateField).toBe(MATCH_DECISION_WORDS.candidateField);
  });
});

describe('the title and the platform option words', () => {
  it('names each kind in the existing plain words, and an unrecognised stored kind as one', () => {
    for (const kind of ESCALATION_KINDS) expect(escalationAnswerTitle(kind)).toBe(ESCALATION_KIND_WORDS[kind]);
    expect(escalationAnswerTitle('choose-candidate')).toBe('Choose candidate');
    expect(escalationAnswerTitle('unnamed-value')).toBe('Unnamed value');
    expect(escalationAnswerTitle('retry-or-skip')).toBe('Retry or skip');
    expect(escalationAnswerTitle('constructor')).toBe(ESCALATION_KIND_UNKNOWN);
  });

  it('says every platform option in the application vocabulary, and those are the approved words', () => {
    const said = [
      ...FIXED_ESCALATION_OPTIONS['retry-or-skip'].map((option) => platformOptionWords('retry-or-skip', option.id)),
      ...FIXED_ESCALATION_OPTIONS['unnamed-value'].map((option) => platformOptionWords('unnamed-value', option.id)),
      platformOptionWords('choose-candidate', MARK_AMBIGUOUS_OPTION.id),
    ];
    expect(said).toEqual(['Retry', 'Skip', 'Abort', 'Mark the record Unevaluated and continue', 'Abort', 'Mark the record ambiguous']);
    for (const words of new Set(said)) expect(APPROVED, words ?? '').toContain(`"${words}"`);
  });

  it('refuses an option the platform does not offer on that kind of question', () => {
    expect(platformOptionWords('choose-candidate', 'abort')).toBeNull();
    expect(platformOptionWords('unnamed-value', 'retry')).toBeNull();
    expect(platformOptionWords('retry-or-skip', 'mark-ambiguous')).toBeNull();
    // A stored kind is typed `string`: an inherited key names nothing.
    expect(platformOptionWords('constructor', 'retry')).toBeNull();
    expect(platformOptionWords('toString', 'abort')).toBeNull();
  });

  it('says an option answer in the platform words, and a row it cannot read as unreadable', () => {
    expect(escalationAnswerWords('retry-or-skip', { kind: 'option', optionId: 'abort' })).toBe('Answer: Abort.');
    expect(escalationAnswerWords('unnamed-value', { kind: 'option', optionId: 'mark-unevaluated' }))
      .toBe('Answer: Mark the record Unevaluated and continue.');
    expect(escalationAnswerWords('choose-candidate', { kind: 'option', optionId: 'mark-ambiguous' })).toBe('Answer: Mark the record ambiguous.');
    expect(escalationAnswerWords('choose-candidate', { kind: 'option', optionId: 'abort' })).toBe(ESCALATION_ANSWER_WORDS.answerUnreadable);
    expect(escalationAnswerWords('retry-or-skip', { kind: 'unreadable' })).toBe(ESCALATION_ANSWER_WORDS.answerUnreadable);
  });
});

describe('who answered, and where it was raised', () => {
  it('fills the time and leaves the name for ActorName', () => {
    expect(answeredByWords('26 Sep 2026, 09:05:00')).toBe('Answered by {name} at 26 Sep 2026, 09:05:00.');
    expect(aroundName(answeredByWords('T'))).toEqual(['Answered by ', ' at T.']);
    expect(aroundName('No person here.')).toBeNull();
  });

  it('names the step and the record the way the pause entries do', () => {
    const workItem = { workItemId: '019823ab-0000-7000-8000-0000000000e1', subjectKey: 'E-000102' };
    expect(escalationRaiseSentences({ kind: 'recorded', planStepId: INSPECT.id, workItem }, NAMER))
      .toEqual(['Raised at “Inspect the record” for E-000102 on ProdConsole.']);
    expect(escalationRaiseSentences({ kind: 'recorded', planStepId: INSPECT.id, workItem }, NAMER))
      .toEqual([`Raised at ${NAMER.step(INSPECT.id, workItem)}.`]);
  });

  it('says a step without its Work Item, and a raise that recorded no step, in words', () => {
    expect(escalationRaiseSentences({ kind: 'recorded', planStepId: INSPECT.id, workItem: null }, NAMER))
      .toEqual(['Raised at “Inspect the record” on ProdConsole.', ESCALATION_ANSWER_WORDS.workItemNotRecorded]);
    expect(escalationRaiseSentences({ kind: 'not-recorded' }, NAMER)).toEqual([ESCALATION_ANSWER_WORDS.stepNotRecorded]);
    // A step the frozen plan does not name is still named, by the id its raise recorded.
    expect(escalationRaiseSentences({ kind: 'recorded', planStepId: 'agent-step-1', workItem: null }, NAMER))
      .toEqual(['Raised at plan step “agent-step-1”.', ESCALATION_ANSWER_WORDS.workItemNotRecorded]);
  });

  it('links each answer to its own Escalation on Replay, encoded', () => {
    expect(escalationReplayHref('019823ab-0000-7000-8000-000000000001', '019823ab-0000-7000-8000-0000000000f1'))
      .toBe('/runs/019823ab-0000-7000-8000-000000000001/replay?escalation=019823ab-0000-7000-8000-0000000000f1');
    expect(escalationReplayHref('a/b', 'c&d')).toBe('/runs/a%2Fb/replay?escalation=c%26d');
  });

  it('says what a bounded list holds', () => {
    expect(escalationAnswersShownWords(100, 1234)).toBe('Showing the first 100 of 1,234 Escalation answers.');
    expect(pauseRequestsShownWords(100, 101)).toBe('Showing the first 100 of 101 pause requests.');
  });
});

const AUDITOR = '019823ab-0000-7000-8000-000000000007';
const REQUEST: RunPauseRequestEntry = {
  eventId: '019823ab-0000-7000-8000-0000000000b1',
  mode: 'immediate',
  requestedBy: AUDITOR,
  requestedAt: '2026-09-26T09:20:00.000Z',
  supersededAt: '2026-09-26T09:25:00.000Z',
  outcome: 'run-ended',
  inspection: null,
};

describe('a pause request the Run never honoured', () => {
  it('says who asked and when, and says which the record lacks', () => {
    expect(pauseRequestedByWords(AUDITOR, 'T')).toBe('Requested by {name} at T.');
    expect(pauseRequestedByWords(AUDITOR, null)).toBe(PAUSE_REQUEST_WORDS.requestedByUntimed);
    expect(pauseRequestedByWords(null, 'T')).toBe('Requested at T. Who requested it was not recorded.');
    expect(pauseRequestedByWords(null, null)).toBe(PAUSE_REQUEST_WORDS.requesterNotRecorded);
    // Only a sentence that names a person leaves a slot for one.
    expect(aroundName(pauseRequestedByWords(null, 'T'))).toBeNull();
    expect(aroundName(pauseRequestedByWords(null, null))).toBeNull();
  });

  it('says the Run ended first, or that a pause at once replaced it, or that the reason could not be read', () => {
    expect(pauseRequestSentences(REQUEST, NAMER)).toEqual([PAUSE_REQUEST_WORDS.runEnded]);
    const inspection = { planStepId: INSPECT.id, workItem: { workItemId: '019823ab-0000-7000-8000-0000000000e1', subjectKey: 'E-000102' } };
    const deferred = { ...REQUEST, mode: 'after-inspection' as const, inspection };
    expect(pauseRequestSentences(deferred, NAMER)).toEqual([
      'It asked to pause after “Inspect the record” for E-000102 on ProdConsole.',
      PAUSE_REQUEST_WORDS.runEnded,
    ]);
    expect(pauseRequestSentences({ ...deferred, outcome: 'replaced' }, NAMER)).toEqual([
      'It asked to pause after “Inspect the record” for E-000102 on ProdConsole.',
      PAUSE_REQUEST_WORDS.replaced,
    ]);
    expect(pauseRequestSentences({ ...deferred, outcome: 'unknown', inspection: null }, NAMER))
      .toEqual([PAUSE_REQUEST_WORDS.inspectionNotRecorded, PAUSE_REQUEST_WORDS.outcomeUnknown]);
  });

  it('collects the record keys every entry names, once each', () => {
    const workItem = { workItemId: '019823ab-0000-7000-8000-0000000000e1', subjectKey: 'E-000102' };
    expect(decisionSubjectKeys(
      [
        { raise: { kind: 'recorded', planStepId: INSPECT.id, workItem } },
        { raise: { kind: 'recorded', planStepId: INSPECT.id, workItem: { workItemId: 'x', subjectKey: null } } },
        { raise: { kind: 'not-recorded' } },
      ],
      [
        { inspection: { planStepId: INSPECT.id, workItem } },
        { inspection: { planStepId: INSPECT.id, workItem: { workItemId: 'y', subjectKey: 'E-000103' } } },
        { inspection: null },
      ],
    )).toEqual(['E-000102', 'E-000103']);
  });
});

const PAUSE = (waitId: string, pausedAt: string): RunPauseEntry => ({
  waitId,
  pausedAt,
  pausedBy: AUDITOR,
  deadline: pausedAt,
  mode: 'immediate',
  hold: { kind: 'not-recorded' },
  closure: { kind: 'open' },
});

describe('one list of pauses and requests, in the order they were asked for', () => {
  it('places each request by its own request time, and keeps each pause its ordinal among the pauses', () => {
    const first = PAUSE('019823ab-0000-7000-8000-0000000000d1', '2026-09-26T09:00:00.000Z');
    const second = PAUSE('019823ab-0000-7000-8000-0000000000d2', '2026-09-26T09:30:00.000Z');
    const early = { ...REQUEST, eventId: '019823ab-0000-7000-8000-0000000000b2', requestedAt: '2026-09-26T09:10:00.000Z' };
    // No request time recorded: placed by when the platform recorded it superseded.
    const late = { ...REQUEST, eventId: '019823ab-0000-7000-8000-0000000000b3', requestedAt: null, supersededAt: '2026-09-26T09:40:00.000Z' };
    const rows = pauseHistoryRows([first, second], [late, early]);
    expect(rows.map((row) => row.kind === 'pause' ? `pause ${row.ordinal}` : `request ${row.entry.eventId}`)).toEqual([
      'pause 1', `request ${early.eventId}`, 'pause 2', `request ${late.eventId}`,
    ]);
  });

  it('breaks a tie the same way every time, and puts an unreadable instant last', () => {
    const pause = PAUSE('019823ab-0000-7000-8000-0000000000d1', '2026-09-26T09:00:00.000Z');
    const tie = { ...REQUEST, requestedAt: '2026-09-26T09:00:00.000Z' };
    const unreadable = { ...REQUEST, eventId: '019823ab-0000-7000-8000-0000000000b9', requestedAt: 'not a time', supersededAt: 'nor this' };
    const rows = pauseHistoryRows([pause], [unreadable, tie]);
    expect(rows.map((row) => row.kind)).toEqual(['pause', 'request', 'request']);
    expect(rows[2]!.kind === 'request' && rows[2]!.entry.eventId).toBe(unreadable.eventId);
    expect(pauseHistoryRows([], [])).toEqual([]);
  });
});
