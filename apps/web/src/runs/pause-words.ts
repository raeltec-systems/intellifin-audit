import type { ExecutablePlan } from '@intellifin/domain';
import type { RunPauseEntry, RunPauseWorkItem } from '@intellifin/infrastructure';

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
  // Two claims, each true of every pause it names: a resume that followed a pause between
  // units STARTS the held step, so "restarts" is said only of an interrupted attempt.
  intro:
    'Each pause says where it held the Run, and each resume says which attempt it started. When a pause interrupted an attempt, that attempt is marked superseded and the resume restarts the step as a new attempt.',
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
  /**
   * The Paused banner's last line: what Resume will do, as far as the pause's record
   * establishes it. A pause that interrupted an attempt restarts that step; a pause between
   * units starts the step it holds the Run before, so "restarts" would claim an attempt
   * that never began, beside a sentence saying none was in flight.
   */
  resumeRestarts: 'Evidence already collected is preserved. Resume restarts that step from its first Tool Action as a new attempt.',
  resumeStarts: 'Evidence already collected is preserved. Resume starts that step from its first Tool Action.',
  /** Where the record does not say (an older pause, an unreadable hold): the sentence the banner always had. */
  resumeUnknown: 'Evidence already collected is preserved. The agent restarts the current Step from its first Tool Action.',
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

/** The attempt a resume restarted, at the step whose attempt the pause interrupted. */
export function restartedWords(step: string, attempt: number): string {
  return `It restarted ${step} as a new attempt (attempt ${attempt.toLocaleString('en-US')}).`;
}

/**
 * The attempt a resume started, after a pause that held the Run BETWEEN units: nothing was
 * interrupted, so the step is started, not restarted.
 */
export function startedWords(step: string, attempt: number): string {
  return `It started ${step} (attempt ${attempt.toLocaleString('en-US')}).`;
}

/** A pause that ran out: the instant is the pause's DEADLINE, never the moment a wake closed it. */
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

/**
 * The Paused banner, in the present tense: the pause holding the Run now. The superseded
 * attempt's reference follows this sentence, so it ends on that attempt; what Resume does
 * is the banner's last line (`pauseBannerResumeWords`).
 */
export function bannerHeldInFlightWords(step: string, attempt: number): string {
  return `The Run is held at ${step}, during attempt ${attempt.toLocaleString('en-US')}. That attempt was superseded.`;
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
      /**
       * What Resume will do, as far as the record establishes it: restart an interrupted
       * attempt, start the step the Run is held before, or — for a pause that recorded no
       * step — `unknown`.
       */
      readonly resume: 'restart' | 'start' | 'unknown';
      /** The record keys the sentences name, which a surface keeps on one line. */
      readonly keys: readonly string[];
    };

/** The banner's hold, from the open pause's entry; a pause with no readable entry is unreadable. */
export function pauseHoldRead(entry: Pick<RunPauseEntry, 'mode' | 'hold'> | null, name: PauseStepNamer): PauseHoldRead {
  if (entry === null) return { kind: 'unreadable' };
  const { hold } = entry;
  return {
    kind: 'read',
    sentences: pauseHoldSentences(entry, name, 'present'),
    supersededStepExecutionId: hold.kind === 'recorded' ? hold.superseded?.stepExecutionId ?? null : null,
    resume: hold.kind !== 'recorded' ? 'unknown' : hold.superseded === null ? 'start' : 'restart',
    keys: pauseSubjectKeys([{ hold, closure: { kind: 'open' } }]),
  };
}

/** The Paused banner's last line, for the hold it read. */
export function pauseBannerResumeWords(hold: PauseHoldRead): string {
  if (hold.kind !== 'read' || hold.resume === 'unknown') return PAUSE_WORDS.resumeUnknown;
  return hold.resume === 'restart' ? PAUSE_WORDS.resumeRestarts : PAUSE_WORDS.resumeStarts;
}

/**
 * A sentence split so each record key it names can be kept on one line. A key such as
 * `E-000102` breaks after its hyphen like any hyphenated word, and a record key read as
 * "E-" on one line and "000102" on the next is a key read wrongly; the text itself is
 * unchanged, so copying it, searching it and hearing it are unaffected.
 */
export interface KeySegment {
  readonly text: string;
  readonly key: boolean;
}

export function keySegments(text: string, keys: readonly string[]): readonly KeySegment[] {
  const present = [...new Set(keys)].filter((key) => key.length > 0 && text.includes(key));
  if (present.length === 0) return [{ text, key: false }];
  const segments: KeySegment[] = [];
  let rest = text;
  for (;;) {
    let at = -1;
    let found = '';
    for (const key of present) {
      const index = rest.indexOf(key);
      // The earliest occurrence; at one position, the longer key, so no key is split.
      if (index !== -1 && (at === -1 || index < at || (index === at && key.length > found.length))) {
        at = index;
        found = key;
      }
    }
    if (at === -1) break;
    if (at > 0) segments.push({ text: rest.slice(0, at), key: false });
    segments.push({ text: found, key: true });
    rest = rest.slice(at + found.length);
  }
  if (rest.length > 0) segments.push({ text: rest, key: false });
  return segments;
}

/**
 * How a pause ended, and — for a resume — which attempt it started. Actor names and times
 * are rendered by the caller, which holds the name reader and the one time renderer.
 */
export function pauseClosureSentences(
  entry: Pick<RunPauseEntry, 'hold' | 'closure' | 'deadline'>,
  name: PauseStepNamer,
  render: { readonly actor: (id: string | null) => string | null; readonly time: (iso: string) => string },
): readonly string[] {
  const { closure } = entry;
  switch (closure.kind) {
    case 'open':
      return [PAUSE_WORDS.stillPaused];
    case 'resumed': {
      const resumed = resumedByWords(render.actor(closure.resumedBy), render.time(closure.resumedAt));
      const { restart } = closure;
      if (restart.kind === 'started') {
        const step = name.step(restart.attempt.planStepId, restart.attempt.workItem);
        // Only an attempt the pause interrupted is RESTARTED; after a pause between units
        // the resume started the held step for the first time since the pause.
        const interrupted = entry.hold.kind === 'recorded' && entry.hold.superseded !== null;
        return [resumed, interrupted
          ? restartedWords(step, restart.attempt.attempt)
          : startedWords(step, restart.attempt.attempt)];
      }
      return [resumed, restart.kind === 'none' ? PAUSE_WORDS.restartNone : PAUSE_WORDS.restartNotRecorded];
    }
    case 'timed-out':
      // The pause's own deadline: the wake that closes it can run later than that, and the
      // sentence says when the deadline was reached.
      return [timedOutWords(render.time(entry.deadline))];
    case 'withdrawn':
      return [withdrawnWords(render.time(closure.at))];
    default:
      return [PAUSE_WORDS.closureUnknown];
  }
}
