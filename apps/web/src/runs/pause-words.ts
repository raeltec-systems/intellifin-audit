import type { ExecutablePlan } from '@intellifin/domain';
import type { RunPauseClosure, RunPauseEntry, RunPauseWorkItem } from '@intellifin/infrastructure';

import { planActionWord } from './labels';
import { recordNaming, recordWords } from './record-words';

/**
 * The words for where a pause held a Run and which attempt its resume started (Story 10.6,
 * legacy 5.4), on the Execution Timeline and the Paused banner.
 *
 * Free of React, because the components and the browser specs read the same sentences —
 * the `run-start-words.ts` rule: a sentence retyped in a test is pinned against nothing.
 *
 * `[PROPOSED, needs owner confirmation]` Every sentence here is wording the UX artifacts do
 * not contain (the story's "Ask First" rule for wording). The one fact they state is the
 * spec's own: a pause between units names the step it holds the Run at and says that no
 * Step Execution was in flight, and a historical record without the link says its step
 * was not recorded.
 */
export const PAUSE_WORDS = {
  heading: 'Pauses and resumes',
  intro:
    'Each pause says where it held the Run, and each resume says which attempt it started. A resume restarts the held step as a new attempt; the attempt a pause interrupted is marked superseded.',
  noStepInFlight: 'No Step Execution was in flight.',
  /** A pause recorded before the Run named where it was held. */
  heldNotRecorded: 'The step this pause held the Run at was not recorded.',
  /** The same fact about the pause holding the Run now, on the Paused banner. */
  holdsNotRecorded: 'The step this pause holds the Run at was not recorded.',
  /** The banner's read of the open pause failed: never shown as an absence. */
  holdUnreadable: 'Where this pause holds the Run could not be read. Reload the Run.',
  /** A resume of a pause that recorded no held step: its attempt was never linked. */
  restartNotRecorded: 'The attempt this resume started was not recorded.',
  /** A resume whose attempt has not started — the Run was held again, or ended, first. */
  restartNone: 'This resume has not started a new attempt of the held step.',
  stillPaused: 'The Run is still paused.',
  closureUnknown: 'How this pause ended could not be read.',
} as const;

/** What a plan step is, read from the frozen plan: its action and its system's name. */
export interface PlanStepFacts {
  readonly action: string;
  readonly system: string | null;
}

/**
 * The frozen plan's own record of one step, or `null` when this plan does not name it.
 * A step is named by its action, never by its identifier, which is a platform key.
 */
export function planStepFacts(plan: ExecutablePlan | null, planStepId: string): PlanStepFacts | null {
  if (plan === null) return null;
  const step = [...plan.sessionSteps, ...plan.targetSystems.flatMap((target) => target.planSteps)]
    .find((candidate) => candidate.id === planStepId);
  if (step === undefined) return null;
  const system = step.targetSystemId === null
    ? null
    : plan.inputs.targets.find((target) => target.registrationId === step.targetSystemId)?.displayName ?? null;
  return { action: step.action, system };
}

/**
 * `“Inspect the record” for E-000102 on LoanCore`: a step, the record, the system.
 *
 * A plan step this page cannot find in the frozen plan is still NAMED, by the identifier
 * the event recorded: a pause that said nothing about where it held the Run would read as
 * one that held it nowhere.
 */
export function stepWords(facts: PlanStepFacts | null, record: string | null, planStepId: string): string {
  if (facts === null) return `plan step “${planStepId}”`;
  return `“${planActionWord(facts.action)}”${record === null ? '' : ` for ${record}`}${facts.system === null ? '' : ` on ${facts.system}`}`;
}

/** How a pause's sentences name a step and the record a Work Item inspects. */
export interface PauseStepNamer {
  /** The plan step, and the record when the Run was held at a Work Item. */
  step(planStepId: string, workItem: RunPauseWorkItem | null): string;
  /** A Work Item's record, as a sentence may say it; `null` when it names none (a P-4 page). */
  record(workItem: RunPauseWorkItem | null): string | null;
}

/**
 * The namer a surface builds once, from the Run's frozen plan and the names
 * `readRecordNames` read. A record is named by THE record label rule (`recordWords`), so
 * a key the frozen binding masks is masked here exactly as it is on every other surface.
 */
export function pauseStepNamer(plan: ExecutablePlan | null, recordNames: ReadonlyMap<string, string>): PauseStepNamer {
  const naming = recordNaming(plan);
  const record = (workItem: RunPauseWorkItem | null): string | null =>
    workItem === null || workItem.subjectKey === null
      ? null
      : recordWords({ key: workItem.subjectKey, name: recordNames.get(workItem.subjectKey) ?? null }, naming);
  return {
    step: (planStepId, workItem) => stepWords(planStepFacts(plan, planStepId), record(workItem), planStepId),
    record,
  };
}

/** The record keys a pause history names, so a surface reads their names in one query. */
export function pauseSubjectKeys(entries: readonly Pick<RunPauseEntry, 'hold' | 'closure'>[]): readonly string[] {
  const keys = new Set<string>();
  const add = (workItem: RunPauseWorkItem | null): void => {
    if (workItem !== null && workItem.subjectKey !== null) keys.add(workItem.subjectKey);
  };
  for (const entry of entries) {
    if (entry.hold.kind === 'recorded') {
      add(entry.hold.workItem);
      add(entry.hold.settled);
      add(entry.hold.superseded?.workItem ?? null);
    }
    if (entry.closure.kind === 'resumed' && entry.closure.restart.kind === 'started') add(entry.closure.restart.attempt.workItem);
  }
  return [...keys];
}

export function pauseTitleWords(ordinal: number): string {
  return `Pause ${ordinal.toLocaleString('en-US')}`;
}

export function pausedByWords(actor: string | null, time: string): string {
  return actor === null ? `Paused at ${time}.` : `Paused by ${actor} at ${time}.`;
}

export function resumedByWords(actor: string | null, time: string): string {
  return actor === null ? `Resumed at ${time}.` : `Resumed by ${actor} at ${time}.`;
}

/** A pause that interrupted an attempt: where, and which attempt. */
export function heldInFlightWords(step: string, attempt: number): string {
  return `Held at ${step}, during attempt ${attempt.toLocaleString('en-US')}. That attempt was superseded.`;
}

/** A pause between units: the step it held the Run before. `noStepInFlight` follows. */
export function heldBeforeWords(step: string): string {
  return `Held before ${step}.`;
}

/** A pause after an inspection settled, before the next unit. `noStepInFlight` follows. */
export function heldAfterInspectionWords(step: string, settled: string | null): string {
  return settled === null
    ? `Held after an inspection finished, before ${step}.`
    : `Held after the inspection of ${settled} finished, before ${step}.`;
}

/** The attempt a resume started, at the step the pause held. */
export function restartedWords(step: string, attempt: number): string {
  return `It restarted ${step} as a new attempt (attempt ${attempt.toLocaleString('en-US')}).`;
}

export function timedOutWords(time: string): string {
  return `This pause reached its deadline at ${time} without a resume.`;
}

export function withdrawnWords(time: string): string {
  return `This pause was withdrawn at ${time}, when the Run ended.`;
}

/** The bounded list's own caption, when it does not hold every pause. */
export function pausesShownWords(shown: number, total: number): string {
  return `Showing the first ${shown.toLocaleString('en-US')} of ${total.toLocaleString('en-US')} pauses.`;
}

/** The Paused banner, in the present tense: the pause holding the Run now. */
export function bannerHeldInFlightWords(step: string, attempt: number): string {
  return `The Run is held at ${step}. Attempt ${attempt.toLocaleString('en-US')} was superseded; Resume restarts that step as a new attempt.`;
}

export function bannerHeldBeforeWords(step: string): string {
  return `The Run is held before ${step}.`;
}

export function bannerHeldAfterInspectionWords(step: string, settled: string | null): string {
  return settled === null
    ? `The Run is held after an inspection finished, before ${step}.`
    : `The Run is held after the inspection of ${settled} finished, before ${step}.`;
}

/**
 * What a pause says about where it held the Run: on the Timeline in the past tense, on the
 * Paused banner in the present. The branch table is the rule, one arm per thing the
 * durable record can establish, and a record that establishes none of them says so.
 */
export function pauseHoldSentences(
  entry: Pick<RunPauseEntry, 'mode' | 'hold'>,
  name: PauseStepNamer,
  tense: 'past' | 'present',
): readonly string[] {
  const { hold } = entry;
  if (hold.kind === 'not-recorded') return [tense === 'past' ? PAUSE_WORDS.heldNotRecorded : PAUSE_WORDS.holdsNotRecorded];
  if (hold.superseded !== null) {
    const step = name.step(hold.planStepId, hold.superseded.workItem ?? hold.workItem);
    return [tense === 'past'
      ? heldInFlightWords(step, hold.superseded.attempt)
      : bannerHeldInFlightWords(step, hold.superseded.attempt)];
  }
  const step = name.step(hold.planStepId, hold.workItem);
  if (entry.mode === 'after-inspection') {
    const settled = name.record(hold.settled);
    return [
      tense === 'past' ? heldAfterInspectionWords(step, settled) : bannerHeldAfterInspectionWords(step, settled),
      PAUSE_WORDS.noStepInFlight,
    ];
  }
  return [tense === 'past' ? heldBeforeWords(step) : bannerHeldBeforeWords(step), PAUSE_WORDS.noStepInFlight];
}

/**
 * What the Paused banner says about where the pause holding the Run holds it.
 *
 * `none` is a Run no pause holds; `unreadable` is a pause whose record could not be read,
 * which the banner says in words (`holdUnreadable`) and never renders as an absence.
 */
export type PauseHoldRead =
  | { readonly kind: 'none' }
  | { readonly kind: 'unreadable' }
  | {
      readonly kind: 'read';
      readonly sentences: readonly string[];
      /** The attempt the pause superseded, when one was in flight. */
      readonly supersededStepExecutionId: string | null;
    };

/** The banner's hold, from the open pause's entry; a pause with no readable entry is unreadable. */
export function pauseHoldRead(entry: Pick<RunPauseEntry, 'mode' | 'hold'> | null, name: PauseStepNamer): PauseHoldRead {
  if (entry === null) return { kind: 'unreadable' };
  return {
    kind: 'read',
    sentences: pauseHoldSentences(entry, name, 'present'),
    supersededStepExecutionId: entry.hold.kind === 'recorded' ? entry.hold.superseded?.stepExecutionId ?? null : null,
  };
}

/**
 * How a pause ended, and — for a resume — which attempt it started. Actor names and times
 * are rendered by the caller, which holds the name reader and the one time renderer.
 */
export function pauseClosureSentences(
  closure: RunPauseClosure,
  name: PauseStepNamer,
  render: { readonly actor: (id: string | null) => string | null; readonly time: (iso: string) => string },
): readonly string[] {
  switch (closure.kind) {
    case 'open':
      return [PAUSE_WORDS.stillPaused];
    case 'resumed': {
      const resumed = resumedByWords(render.actor(closure.resumedBy), render.time(closure.resumedAt));
      const { restart } = closure;
      if (restart.kind === 'started') {
        const step = name.step(restart.attempt.planStepId, restart.attempt.workItem);
        return [resumed, restartedWords(step, restart.attempt.attempt)];
      }
      return [resumed, restart.kind === 'none' ? PAUSE_WORDS.restartNone : PAUSE_WORDS.restartNotRecorded];
    }
    case 'timed-out':
      return [timedOutWords(render.time(closure.at))];
    case 'withdrawn':
      return [withdrawnWords(render.time(closure.at))];
    default:
      return [PAUSE_WORDS.closureUnknown];
  }
}
