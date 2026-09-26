import { FIXED_ESCALATION_OPTIONS, MARK_AMBIGUOUS_OPTION } from '@intellifin/application';
import type {
  RunEscalationAnswer,
  RunEscalationRaise,
  RunPauseEntry,
  RunPauseRequestEntry,
} from '@intellifin/infrastructure';

import { fillTemplate } from '../design/copy';
import { escalationKindWord } from '../design/plain-words';
import { MATCH_DECISION_WORDS } from './match-words';
import type { PauseStepNamer } from './pause-words';

/**
 * The words for the decisions a Run recorded, on the Execution Timeline (Story 10.10,
 * legacy 4.8 AC 4, 5.6 AC 3 and 5.4 AC 3): each answered Escalation, and each pause request
 * the Run never honoured.
 *
 * Free of React, because the components and the browser specs read the same sentences —
 * the `run-start-words.ts` rule: a sentence retyped in a test is pinned against nothing.
 * A `{name}` slot is left in a template for the surface to fill with `ActorName`, and a
 * `{step}` is named the way the pause entries name one (`pause-words.ts`).
 *
 * The owner approved the wording marked APPROVED on 2026-09-26 ("approve all"). Every
 * other sentence here is `[PROPOSED, needs owner confirmation]`: the story's rule is that a
 * sentence its approved list does not hold is still Ask First.
 */
export const ESCALATION_ANSWER_WORDS = {
  /** APPROVED. The section heading, beside "Pauses and resumes". */
  heading: 'Escalation answers',
  /** APPROVED. */
  intro: 'Each Escalation a person answered: the answer, who gave it, and when.',
  /** APPROVED. `{name}` through `ActorName`, `{time}` the answer's own instant. */
  answeredBy: 'Answered by {name} at {time}.',
  /** APPROVED. A candidate answer: its position among the candidates offered. */
  candidate: 'Answer: chose candidate {n} of {m}.',
  /** APPROVED. One of the platform's own options, in the platform's own words. */
  option: 'Answer: {option}.',
  /** APPROVED. Said only when the answer's own event records that it canceled the Run. */
  aborted: 'The Run was canceled by this answer.',
  /** APPROVED. `{step}` named as the pause entries name one. */
  raisedAt: 'Raised at {step}.',
  /** APPROVED. A raise whose record names no step. */
  stepNotRecorded: 'The step this Escalation was raised at was not recorded.',
  /** APPROVED. The link to the Escalation's jump target on Replay. */
  openInReplay: 'Open in Replay',
  /**
   * PROPOSED. The raise names its step, and its own Evidence does not establish one Work
   * Item at that step: the step is said, and so is the missing record.
   */
  workItemNotRecorded: 'The Work Item this Escalation was raised for was not recorded.',
  /** PROPOSED. A row whose answer is not one of the options it offered. */
  answerUnreadable: 'The answer this Escalation received could not be read.',
  /** PROPOSED. The bounded list's own caption, when it does not hold every answer. */
  shown: 'Showing the first {shown} of {total} Escalation answers.',
  /** The candidate's own text, which the Audit Agent wrote: the existing inert label. */
  candidateField: MATCH_DECISION_WORDS.candidateField,
} as const;

export const PAUSE_REQUEST_WORDS = {
  /** APPROVED. A pause the Run never reached, as an entry in "Pauses and resumes". */
  title: 'Pause request',
  /** APPROVED. */
  requestedBy: 'Requested by {name} at {time}.',
  /** APPROVED. It copies the cancellation's own sentence for a request the Run outran. */
  runEnded: 'The Run ended before the pause took effect, so its own outcome stands.',
  /**
   * PROPOSED. A "pause after this inspection" request retired by a request to pause at
   * once: the Run did not end, so the approved sentence would be false here.
   */
  replaced: 'A request to pause the Run at once replaced it before it took effect.',
  /** PROPOSED. A superseded request whose recorded reason this build does not name. */
  outcomeUnknown: 'Why this pause request did not take effect could not be read.',
  /** PROPOSED. The inspection a "pause after this inspection" request was to follow. */
  afterInspection: 'It asked to pause after {step}.',
  /** PROPOSED. That inspection, when its marker row does not resolve in this Run. */
  inspectionNotRecorded: 'The inspection it asked to pause after was not recorded.',
  /** PROPOSED. The record names who asked and not when. */
  requestedByUntimed: 'Requested by {name}. When it was requested was not recorded.',
  /** PROPOSED. The record names when and not who. */
  requestedAtUnnamed: 'Requested at {time}. Who requested it was not recorded.',
  /** PROPOSED. The record names neither. */
  requesterNotRecorded: 'Who requested this pause, and when, was not recorded.',
  /** PROPOSED. The bounded list's own caption, when it does not hold every request. */
  shown: 'Showing the first {shown} of {total} pause requests.',
} as const;

/**
 * What Replay says when a Timeline entry's "Open in Replay" opened it at an Escalation.
 * `{kind}` is the jump target's own label (the Escalation's kind in plain words) and
 * `{absence}` the resolver's own reason a target has no frame.
 */
export const ESCALATION_REPLAY_WORDS = {
  /** PROPOSED. The Escalation's jump target opened on a frame. */
  opened: 'Opened at the Escalation “{kind}”.',
  /** PROPOSED. The Escalation is a jump target with no frame to open. */
  noFrame: 'Opened for the Escalation “{kind}”: {absence}. Choose a recorded target below.',
  /** PROPOSED. The link names an Escalation this Replay view cannot resolve. */
  unavailable: 'The Escalation this link names is not available in this Replay view. Choose a recorded target below.',
} as const;

/**
 * A sentence with a `{name}` slot, split around it so a surface can put `ActorName` there.
 * `null` when the sentence names nobody.
 */
export function aroundName(sentence: string): readonly [string, string] | null {
  const at = sentence.indexOf('{name}');
  return at < 0 ? null : [sentence.slice(0, at), sentence.slice(at + '{name}'.length)];
}

/** The title of an answered Escalation: its kind, in the existing plain words. */
export function escalationAnswerTitle(kind: string): string {
  return escalationKindWord(kind);
}

/** "Answered by {name} at {time}." with the time filled and the name left for `ActorName`. */
export function answeredByWords(time: string): string {
  return fillTemplate(ESCALATION_ANSWER_WORDS.answeredBy, { time });
}

/**
 * The platform's own words for one of its options on a question of this kind, or `null`
 * when the option is not one the platform offers there.
 *
 * Read from the application's vocabulary — `FIXED_ESCALATION_OPTIONS` and the
 * mark-ambiguous option the worker appends — and never from the label a row stored, which
 * is how the Escalation panel has always treated the closed FR-27 answer set. `Object.hasOwn`,
 * because the kind is a stored value typed `string`.
 */
export function platformOptionWords(kind: string, optionId: string): string | null {
  if (kind === 'choose-candidate') return optionId === MARK_AMBIGUOUS_OPTION.id ? MARK_AMBIGUOUS_OPTION.label : null;
  if (!Object.hasOwn(FIXED_ESCALATION_OPTIONS, kind)) return null;
  const fixed = FIXED_ESCALATION_OPTIONS[kind as keyof typeof FIXED_ESCALATION_OPTIONS];
  return fixed.find((option) => option.id === optionId)?.label ?? null;
}

/** The answer an Escalation received, as one sentence. */
export function escalationAnswerWords(kind: string, answer: RunEscalationAnswer): string {
  switch (answer.kind) {
    case 'candidate':
      return fillTemplate(ESCALATION_ANSWER_WORDS.candidate, {
        n: answer.candidate.toLocaleString('en-US'),
        m: answer.candidates.toLocaleString('en-US'),
      });
    case 'option': {
      const words = platformOptionWords(kind, answer.optionId);
      return words === null ? ESCALATION_ANSWER_WORDS.answerUnreadable : fillTemplate(ESCALATION_ANSWER_WORDS.option, { option: words });
    }
    default:
      return ESCALATION_ANSWER_WORDS.answerUnreadable;
  }
}

/**
 * Where an Escalation was raised: the step, and the record through the step's own words.
 *
 * A step named without a record is said, and so is the record's absence — a step alone
 * would read as though the question were about the step and nothing inspected there.
 */
export function escalationRaiseSentences(raise: RunEscalationRaise, name: PauseStepNamer): readonly string[] {
  if (raise.kind === 'not-recorded') return [ESCALATION_ANSWER_WORDS.stepNotRecorded];
  const raised = fillTemplate(ESCALATION_ANSWER_WORDS.raisedAt, { step: name.step(raise.planStepId, raise.workItem) });
  return raise.workItem === null ? [raised, ESCALATION_ANSWER_WORDS.workItemNotRecorded] : [raised];
}

export function escalationAnswersShownWords(shown: number, total: number): string {
  return fillTemplate(ESCALATION_ANSWER_WORDS.shown, {
    shown: shown.toLocaleString('en-US'),
    total: total.toLocaleString('en-US'),
  });
}

/**
 * The Escalation's jump target on Replay. Replay resolves the id only against that Run's
 * own jump targets, and says so when it cannot.
 */
export function escalationReplayHref(runId: string, waitId: string): string {
  return `/runs/${encodeURIComponent(runId)}/replay?escalation=${encodeURIComponent(waitId)}`;
}

/**
 * Who asked for a pause and when, with the name left for `ActorName`. The record can lack
 * either, and the sentence then says which — never a blank where a person or a time goes.
 */
export function pauseRequestedByWords(requestedBy: string | null, time: string | null): string {
  if (requestedBy !== null && time !== null) return fillTemplate(PAUSE_REQUEST_WORDS.requestedBy, { time });
  if (requestedBy !== null) return PAUSE_REQUEST_WORDS.requestedByUntimed;
  if (time !== null) return fillTemplate(PAUSE_REQUEST_WORDS.requestedAtUnnamed, { time });
  return PAUSE_REQUEST_WORDS.requesterNotRecorded;
}

/** What happened to a pause request, and — for one after an inspection — which inspection. */
export function pauseRequestSentences(
  entry: Pick<RunPauseRequestEntry, 'mode' | 'outcome' | 'inspection'>,
  name: PauseStepNamer,
): readonly string[] {
  const outcome = entry.outcome === 'run-ended'
    ? PAUSE_REQUEST_WORDS.runEnded
    : entry.outcome === 'replaced' ? PAUSE_REQUEST_WORDS.replaced : PAUSE_REQUEST_WORDS.outcomeUnknown;
  if (entry.mode === 'immediate') return [outcome];
  const inspection = entry.inspection === null
    ? PAUSE_REQUEST_WORDS.inspectionNotRecorded
    : fillTemplate(PAUSE_REQUEST_WORDS.afterInspection, { step: name.step(entry.inspection.planStepId, entry.inspection.workItem) });
  return [inspection, outcome];
}

export function pauseRequestsShownWords(shown: number, total: number): string {
  return fillTemplate(PAUSE_REQUEST_WORDS.shown, {
    shown: shown.toLocaleString('en-US'),
    total: total.toLocaleString('en-US'),
  });
}

/** The record keys the decision entries name, so a surface reads their names in one query. */
export function decisionSubjectKeys(
  answers: readonly { readonly raise: RunEscalationRaise }[],
  requests: readonly Pick<RunPauseRequestEntry, 'inspection'>[],
): readonly string[] {
  const keys = new Set<string>();
  for (const answer of answers) {
    if (answer.raise.kind === 'recorded' && answer.raise.workItem?.subjectKey != null) keys.add(answer.raise.workItem.subjectKey);
  }
  for (const request of requests) {
    if (request.inspection?.workItem.subjectKey != null) keys.add(request.inspection.workItem.subjectKey);
  }
  return [...keys];
}

/** One row of "Pauses and resumes": a pause the Run honoured, or a request it never did. */
export type PauseHistoryRow =
  | { readonly kind: 'pause'; readonly ordinal: number; readonly entry: RunPauseEntry }
  | { readonly kind: 'request'; readonly entry: RunPauseRequestEntry };

/**
 * The pauses and the requests the Run never honoured, as one list in the order they were
 * asked for.
 *
 * A pause is placed by when it held the Run and a request by when it was asked for (or, if
 * its record holds no request time, when the platform recorded it as superseded). Each is
 * an instant the record stores for THAT row; nothing here pairs a request with a pause. A
 * pause keeps its ordinal among the pauses, so "Pause 2" means the same on every page.
 */
export function pauseHistoryRows(
  pauses: readonly RunPauseEntry[],
  requests: readonly RunPauseRequestEntry[],
): readonly PauseHistoryRow[] {
  const rows: { readonly at: number; readonly key: string; readonly row: PauseHistoryRow }[] = [
    ...pauses.map((entry, index) => ({
      at: Date.parse(entry.pausedAt),
      key: `0:${entry.waitId}`,
      row: { kind: 'pause', ordinal: index + 1, entry } as const,
    })),
    ...requests.map((entry) => ({
      at: Date.parse(entry.requestedAt ?? entry.supersededAt),
      key: `1:${entry.eventId}`,
      row: { kind: 'request', entry } as const,
    })),
  ];
  const time = (value: number): number => (Number.isFinite(value) ? value : Number.POSITIVE_INFINITY);
  return rows
    .sort((left, right) => time(left.at) - time(right.at) || (left.key < right.key ? -1 : left.key > right.key ? 1 : 0))
    .map((entry) => entry.row);
}
