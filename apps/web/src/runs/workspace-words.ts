import { countNoun } from '../design/words';
import { countText, planActionWord } from './labels';

/**
 * The Auditor Workspace's own words (UI cleanup 2026-09-23, UX-23 and UX-24).
 *
 * The owner's walkthrough read the workspace pane as a description of the platform:
 * "Registered action-linked capture · open", "Registered evidence updates when execution
 * commits a capture. It is separate from the ephemeral preview above.", "Near-live
 * preview · synthetic workspace · not registered evidence." and two raw ISO instants.
 * Each one named a mechanism. None named a fact an auditor acts on. What an auditor needs
 * from this pane is three facts: the live picture is a few seconds behind and is NOT
 * evidence; the saved screen IS evidence; and which system and page that screen came
 * from, and when (`FrameSource` says the page and the time).
 *
 * Free of React and of `next/*`, so the browser specs import these rather than retyping
 * them: a sentence retyped in a test is a sentence pinned against nothing (the
 * `run-start-words.ts` rule).
 */

/* ---------------------------------------------------------------- live preview --- */

/** The live preview's accessible name: AW-060's own label for this viewing mode. */
export const WORKSPACE_PREVIEW_LABEL = 'Live workspace preview';

/** The preview image's text alternative. */
export const WORKSPACE_PREVIEW_ALT = 'Live preview of the agent workspace';

/**
 * Every state of the live preview, said once.
 *
 * `WorkspacePreview` sets its status ONLY from this table, and its test refuses an inline
 * sentence there. The private-step and hidden-tab states are privacy behaviour and must
 * always be said: a picture that disappears with no reason reads as a broken screen.
 */
export const WORKSPACE_PREVIEW_STATUS = {
  /** Before the first sample is read, and after a read that failed. */
  unavailable: 'Live preview unavailable.',
  /**
   * The Run is not active, or this deployment shows no live preview. Two causes, one
   * sentence that is true of both: it names no cause (the 2026-09-16 rule).
   */
  off: 'Live preview unavailable for this Run.',
  /** The tab is hidden, so nothing is fetched or shown until it is visible again. */
  hidden: 'Live preview paused while this tab is hidden.',
  /** A private step hides every picture of the workspace until the step ends. */
  private: 'Private step. The live preview is hidden until it ends.',
  /** The newest sample was refused, missing or too old to show. */
  noRecentScreen: 'Live preview unavailable. No recent screen to show.',
  /** A fresh picture is on screen. */
  showing: 'Live preview, a few seconds behind. Not saved as evidence.',
  /** A shown picture grew older than the freshness bound before a newer one arrived. */
  outOfDate: 'Live preview out of date. Waiting for a newer screen.',
} as const;

export type WorkspacePreviewStatus = (typeof WORKSPACE_PREVIEW_STATUS)[keyof typeof WORKSPACE_PREVIEW_STATUS];

/* --------------------------------------------------------------- saved screen --- */

/** The heading over the newest screen this Run saved as evidence. */
export const SAVED_SCREEN_HEADING = 'Latest saved screen';

/** Said above a saved screen: it is evidence, and which system it came from. */
export function savedScreenSentence(system: string | null): string {
  return system === null ? 'Saved as evidence.' : `Saved as evidence from ${system}.`;
}

/**
 * Why the stage shows no saved screen. Each sentence is true of its own Run state: "yet"
 * is a claim about a future only an active Run has (UX-49).
 */
export function noSavedScreenSentence({ browserOpened, active }: {
  /** Whether this Run has an Agent Workspace row at all. */
  readonly browserOpened: boolean;
  readonly active: boolean;
}): string {
  if (!browserOpened) return 'No browser has been opened for this Run.';
  return active ? 'No screen has been saved yet.' : 'No screen was saved during this Run.';
}

/* ------------------------------------------------------------------- progress --- */

export interface WorkspaceCoverageCounts {
  readonly fullyInspectedSubjects: number;
  readonly includedRows: number;
  /** `null` when some Observations could not be tied to a record, so no exact count exists. */
  readonly exceptionRecords: number | null;
  readonly pendingAssessments: number;
}

/** Said when the record coverage read is not ready: it names no cause, because it has several. */
export const RECORD_COVERAGE_UNAVAILABLE = 'Record coverage is not available.';

/** `3 of 12 included records inspected · 2 records with exceptions · 1 assessment awaiting confirmation`. */
export function recordCoverageLine(counts: WorkspaceCoverageCounts): string {
  const inspected = `${countText(counts.fullyInspectedSubjects)} of ${countNoun(counts.includedRows, 'included record')} inspected`;
  const exceptions = counts.exceptionRecords === null
    ? 'records with exceptions not counted'
    : `${countNoun(counts.exceptionRecords, 'record')} with exceptions`;
  const pending = `${countNoun(counts.pendingAssessments, 'assessment')} awaiting confirmation`;
  return `${inspected} · ${exceptions} · ${pending}`;
}

/** The newest step the page read, in words: `Inspect the record for E-000103 on LoanCore`. */
export function currentStepWords(step: {
  readonly action: string;
  readonly subject: string | null;
  readonly target: string | null;
}): string {
  return `${planActionWord(step.action)}${step.subject === null ? '' : ` for ${step.subject}`}${step.target === null ? '' : ` on ${step.target}`}`;
}

/** Said when no step has started. True of an active Run and of a finished one alike. */
export const NO_STEP_STARTED_SENTENCE = 'No step has started in this Run.';
