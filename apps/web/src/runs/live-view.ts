import type { ExecutablePlan } from '@intellifin/domain';
import type { RunFrameRow, RunStepExecutionRow } from '@intellifin/infrastructure';

import { planActionWord } from './labels';
import { planActionNarration, toolActionNarration, type NarrationSubject } from './session-words';

/**
 * The session viewer's four state words (UX-DR24, DESIGN.md → Session viewer).
 *
 * A CLOSED vocabulary, and the dot beside each word is a token this stylesheet paints.
 * It describes a SESSION, which is why a Queued Run maps to none of them: there is no
 * session yet, and stretching `LIVE` over a Run that has not started would be the
 * "Active version: Draft" defect in a new place.
 */
export const LIVE_VIEW_CHROME = ['LIVE', 'PAUSED', 'AWAITING', 'REPLAY'] as const;
export type LiveViewChrome = (typeof LIVE_VIEW_CHROME)[number];

/**
 * Which word the chrome strip shows for a Run state, or `null` when there is no session.
 *
 * `Object.hasOwn` is unnecessary here because the branch is a switch over the domain's own
 * state vocabulary and an unknown value falls through to `null`, which the surface renders
 * as "no session" rather than as a word it made up.
 */
export function liveViewChrome(state: string): LiveViewChrome | null {
  switch (state) {
    case 'RUNNING':
      return 'LIVE';
    case 'PAUSED':
      return 'PAUSED';
    case 'AWAITING_AUDITOR':
      return 'AWAITING';
    case 'COMPLETED':
    case 'INCONCLUSIVE':
    case 'RUN_FAILED':
    case 'CANCELED':
      return 'REPLAY';
    default:
      // QUEUED, and any state this build does not know. Both are "no session yet".
      return null;
  }
}

/** The dot's modifier class, so a reader never has colour alone: word and dot together. */
export function chromeDotClass(chrome: LiveViewChrome): string {
  return `ls-session__dot ls-session__dot--${chrome.toLowerCase()}`;
}

/**
 * How many Step Executions the frozen plan can produce at most — the denominator of the
 * chrome's Step counter.
 *
 * Read from the plan the Run is executing, never from a stored progress number: the plan
 * is what an auditor reads, and a counter derived from anything else could disagree with
 * it. One Session Step each, plus each Target System's three plan steps.
 */
export function plannedStepCount(plan: ExecutablePlan | null): number | null {
  if (plan === null) return null;
  return plan.sessionSteps.length + plan.targetSystems.reduce((total, target) => total + target.planSteps.length, 0);
}

/** Every plan step id the frozen plan declares, or `null` when the plan could not be read. */
export function plannedStepIds(plan: ExecutablePlan | null): readonly string[] | null {
  if (plan === null) return null;
  return [...plan.sessionSteps.map((step) => step.id), ...plan.targetSystems.flatMap((target) => target.planSteps.map((step) => step.id))];
}

/**
 * How far through the plan a Run has got, counted in LOGICAL steps
 * (UI cleanup 2026-09-22, UX-47).
 *
 * The chrome read **"Step 7 of 6"** after a pause and a resume, because the numerator was
 * `run_step_execution`'s exact TOTAL — which counts ATTEMPTS. A pause supersedes the
 * attempt in flight and the resume starts a new one, so a Run that had reached the sixth of
 * six plan steps reported seven. A progress counter whose numerator can pass its
 * denominator is not reporting progress; it is reporting rows.
 *
 * `started` counts DISTINCT PLAN STEPS that have at least one Step Execution, intersected
 * with the plan's own step ids when the plan is readable — so the invariant
 * `started <= plannedStepCount` holds by construction and not by clamping, and a stale row
 * naming a step this version does not declare cannot push the counter over.
 *
 * `units` counts distinct (plan step, Work Item) pairs. It is the work actually done and is
 * deliberately NOT the counter's numerator: a plan declares three per-target plan steps and
 * a Run walks them once PER RECORD, so a three-leaver Run has nine such pairs against six
 * declared steps — the very shape the finding is about. It is reported as its own fact,
 * with its own noun, where a surface wants to say how many record-steps have run.
 *
 * `retries` is every attempt beyond the first, across every unit: what a reader wants to
 * know is that something was tried again, not that the counter moved.
 */
export interface LogicalStepProgress {
  readonly started: number;
  readonly units: number;
  readonly retries: number;
}

export function logicalStepProgress(
  executions: readonly Pick<RunStepExecutionRow, 'planStepId' | 'workItemId' | 'attempt'>[],
  planStepIds: readonly string[] | null,
): LogicalStepProgress {
  const declared = planStepIds === null ? null : new Set(planStepIds);
  const steps = new Set<string>();
  const units = new Set<string>();
  let retries = 0;
  for (const execution of executions) {
    if (declared === null || declared.has(execution.planStepId)) steps.add(execution.planStepId);
    units.add(`${execution.planStepId}\u0000${execution.workItemId ?? ''}`);
    if (execution.attempt > 1) retries += 1;
  }
  return { started: steps.size, units: units.size, retries };
}

/**
 * The narration of one Step Execution, in audit words (UX-28).
 *
 * ONE function, used by the Step row AND by the frame's `alt` — EXPERIENCE.md's
 * accessibility rule is that "session viewer frames carry an `alt` narration equal to the
 * Step narration", and two implementations of "the narration" would satisfy that sentence
 * on the day they were written and diverge on the first value nobody tried.
 *
 * The plan-step id and the ISO instant that used to end this sentence are on the rail under
 * Technical details. They were inside the one string a screen-reader user hears as the
 * picture's caption, which is the last place a UUID belongs.
 */
export function stepNarration(
  execution: Pick<RunStepExecutionRow, 'action' | 'planStepId' | 'startedAt'>,
  targetName: string | null,
  subject: string | null = null,
): string {
  return planActionNarration(execution.action, at(subject, targetName));
}

/**
 * Which RECORD, in which system — the half of the sentence a screen reader hears.
 *
 * UX-DR37 makes the frame's `alt` and the Step narration the same string, and the Replay
 * scrubber's pills are labelled with it, so a narration that named only the Target System
 * gave a three-leaver Run three pills a screen-reader user could not tell apart while the
 * sighted reader saw the record on the jump list beside them. A Work Item with no subject
 * of its own (P-4 inspects a page, not a population) says only where.
 */
function at(subject: string | null, targetName: string | null, field: string | null = null): NarrationSubject {
  return { subject, system: targetName, field };
}

/**
 * What the stage says when there is no frame to show, in words rather than as a gap.
 *
 * Each sentence names WHY there is no picture. An empty stage with no explanation is the
 * defect class this codebase keeps finding: a reader takes an absence for "nothing
 * happened here", and on a supervision surface that is the opposite of the truth.
 */
export const LIVE_VIEW_STAGE = {
  /** The Run has a workspace and has captured nothing yet. */
  awaitingFirstFrame: 'No workspace screen has been captured yet. The first frame appears when the Agent captures one.',
  /** The frozen plan needs no browser at all: every Target System is adapter-acquired. */
  adapterOnly: 'This Run uses no Agent Workspace. Its Adapter Session Steps are listed below with their counts and integrity digests.',
  /** The registered frame could not be read back through its grant. */
  unavailable: 'The latest workspace screen could not be read from Evidence storage. Its Evidence record is unchanged.',
} as const;

/** The one Step the viewer is narrating: the newest Step Execution, or nothing yet. */
export function currentStepExecution(
  executions: readonly RunStepExecutionRow[],
): RunStepExecutionRow | null {
  let current: RunStepExecutionRow | null = null;
  for (const execution of executions) {
    if (current === null || Date.parse(execution.startedAt) >= Date.parse(current.startedAt)) current = execution;
  }
  return current;
}

/**
 * The frame's own narration: its Step Execution's, so the two are one string.
 *
 * `field` is the attribute a read-attribute action read, where the caller resolved one
 * against the version's frozen label patterns. It is passed to the Tool Action narration
 * only — a Step narrates the plan step, which names no field.
 */
export function frameNarration(
  frame: RunFrameRow,
  execution: Pick<RunStepExecutionRow, 'action' | 'planStepId' | 'startedAt'> | null,
  targetName: string | null,
  subject: string | null = null,
  field: string | null = null,
): string {
  if (execution !== null) return stepNarration(execution, targetName, subject);
  // The Step Execution could not be resolved. Narrate the ACTION that captured the frame
  // rather than inventing a Step: what is said is still true of the picture.
  return toolActionNarration(frame.action, at(subject, targetName, field));
}

/**
 * What an adapter log row says about the artifact its Session Step registered
 * (Story 10.6, legacy 5.3 AC 2; owner decision 2026-09-25).
 *
 * THREE situations, and never one sentence for all of them. Live View passed
 * `digest: null` for every row, so every acquired step said "No artifact registered."
 * over an artifact the Run HAD registered — a wiring defect that read exactly like a
 * missing artifact. A discriminated union, so a row that names a digest without the
 * Evidence it belongs to, or an unreadable row dressed as an empty one, does not compile.
 *
 * - `registered` — the step names an Evidence row and the exact read returned it
 *   REGISTERED: the row shows that Evidence and its integrity digest.
 * - `none` — the step names no Evidence, or names a reservation that was never
 *   registered (a step still in progress, or one whose attempts failed). "No artifact
 *   registered." is true of both.
 * - `unavailable` — the step names an Evidence row and the read could not say what it is:
 *   the read failed, or it did not return the row. Saying "No artifact registered." here
 *   would state an absence nobody observed.
 */
export type AdapterStepArtifact =
  | { readonly kind: 'registered'; readonly evidenceId: string; readonly digest: string }
  | { readonly kind: 'none' }
  | { readonly kind: 'unavailable' };

/**
 * The two sentences an adapter log row says instead of a digest. `none` is the sentence
 * both viewers already said; `unavailable` is new and PROPOSED (Story 10.6's Ask First
 * rule on wording): it says what is known — the record could not be read — and what to
 * do, and claims neither that an artifact exists nor that none does.
 */
export const ADAPTER_ARTIFACT_WORDS = {
  none: 'No artifact registered.',
  unavailable: 'The artifact record for this step could not be read, so its digest is not shown. Reload the page to try again.',
} as const;

/** The two facts of an Evidence row the log needs: whether it is registered, and its digest. */
export interface AdapterEvidenceFact {
  readonly state: string;
  readonly digest: string | null;
}

/**
 * One step's artifact, decided from the Evidence id the step names and the exact read.
 *
 * `read` is `null` when the Evidence read itself failed. A row the read did not return is
 * `unavailable` rather than `none`: the step names it, so something is there to report,
 * and an absence nobody observed is not a fact this surface may state.
 */
export function adapterStepArtifact(
  evidenceId: string | null,
  read: ReadonlyMap<string, AdapterEvidenceFact> | null,
): AdapterStepArtifact {
  if (evidenceId === null) return { kind: 'none' };
  if (read === null) return { kind: 'unavailable' };
  const row = read.get(evidenceId);
  if (row === undefined) return { kind: 'unavailable' };
  if (row.state !== 'REGISTERED' || row.digest === null) return { kind: 'none' };
  return { kind: 'registered', evidenceId, digest: row.digest };
}

/** One adapter log row, as both session viewers render it. */
export interface AdapterLogStep {
  readonly stepId: string;
  readonly displayName: string;
  readonly state: string;
  readonly attempts: number;
  readonly artifact: AdapterStepArtifact;
}

/** The Session Step facts the log reads — a `RunTimelineSessionStep`, structurally. */
export interface AdapterLogSessionStep {
  readonly stepId: string;
  readonly action: string;
  readonly displayName: string;
  readonly state: string;
  readonly attempts: number;
  readonly evidenceId: string | null;
}

/** The ONE read the log makes: the exact Evidence rows its steps name, and nothing else. */
export interface AdapterLogEvidenceReader {
  readEvidenceItemsByIds(
    runId: string,
    evidenceIds: readonly string[],
  ): Promise<readonly { readonly evidenceId: string; readonly state: string; readonly digest: string | null }[]>;
}

/**
 * The adapter log rows of a Run: every `extract-adapter` Session Step with the artifact it
 * registered, read EXACTLY by the Evidence ids the steps name.
 *
 * Not through the Evidence overview read. That read is a bounded sample ordered by kind,
 * so on a Run with more adapter extractions than one page a Reference Source's artifact
 * fell off the end and its row said "No artifact registered." over an artifact the
 * database held — "a limit belongs to the cardinality of the read", one surface along.
 * Live View and Replay both call this, so the two surfaces cannot disagree about one row.
 *
 * A read that throws makes every step that names an artifact `unavailable`; a step that
 * names none is still `none`, because that half needed no read at all.
 */
export async function readAdapterLog(
  reader: AdapterLogEvidenceReader,
  runId: string,
  sessionSteps: readonly AdapterLogSessionStep[],
): Promise<readonly AdapterLogStep[]> {
  const steps = sessionSteps.filter((step) => step.action === 'extract-adapter');
  const named = steps.flatMap((step) => (step.evidenceId === null ? [] : [step.evidenceId]));
  let read: ReadonlyMap<string, AdapterEvidenceFact> | null = new Map();
  if (named.length > 0) {
    try {
      const rows = await reader.readEvidenceItemsByIds(runId, named);
      read = new Map(rows.map((row) => [row.evidenceId, { state: row.state, digest: row.digest }]));
    } catch {
      read = null;
    }
  }
  return steps.map((step) => ({
    stepId: step.stepId,
    displayName: `${planActionWord(step.action)} · ${step.displayName}`,
    state: step.state,
    attempts: step.attempts,
    artifact: adapterStepArtifact(step.evidenceId, read),
  }));
}
