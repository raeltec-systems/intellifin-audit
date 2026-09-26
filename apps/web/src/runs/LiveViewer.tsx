import Link from 'next/link';

import { Banner } from '../design/Banner';
import { Digest } from '../design/Digest';
import { Reference } from '../design/Reference';
import { TechnicalDetails, type TechnicalItem } from '../design/TechnicalDetails';
import { Timestamp } from '../design/Timestamp';
import { countNoun } from '../design/words';
import { CAPTURE_TIME_UNRECORDED, LIVE_VIEW_DESKTOP_ONLY_SENTENCE, SESSION_ISOLATION_NOTE } from '../design/copy';
import { EvidenceKindBadge } from './MinorBadge';
import { UntrustedPolicy, UntrustedText } from './UntrustedText';
import { ADAPTER_ARTIFACT_WORDS, chromeDotClass, type AdapterLogStep, type AdapterStepArtifact, type LiveViewChrome } from './live-view';
import { attemptContext, noWorkItemSentence } from './session-words';
import { evidenceKindWord, sessionStepWord, utcStamp, workItemLabel, workItemWord, workspaceModeWord } from './labels';

export interface LiveViewerFrame {
  readonly evidenceId: string;
  /** Equal to its Step's narration (EXPERIENCE.md accessibility rules). */
  readonly narration: string;
  readonly sourceLocation: string;
  readonly digest: string;
  readonly capturedAt: string | null;
}

export interface LiveViewerStep {
  readonly narration: string;
  readonly state: string;
  readonly attempt: number;
  readonly diagnostic: string | null;
}

export interface LiveViewerWorkItem {
  readonly displayName: string;
  readonly state: string;
  readonly subjectKey: string | null;
  readonly observations: number;
}

export interface LiveViewerEvidence {
  readonly evidenceId: string;
  readonly kind: string;
  readonly digest: string | null;
  readonly capturedAt: string | null;
}

/**
 * One adapter log row. Its artifact is REQUIRED and says which of three things is true
 * (Story 10.6, legacy 5.3): an optional digest let Live View pass `null` for every row, so
 * each acquired step said "No artifact registered." over an artifact the Run had
 * registered, and nothing failed to compile.
 */
export type LiveViewerAdapterStep = AdapterLogStep;

export interface LiveViewerProps {
  readonly runId: string;
  /** The Run's own state, so the rail's "no record" sentence is true of it (UX-49). */
  readonly runState: string;
  /** `null` when the Run has no session yet — a Queued Run, which says so in words. */
  readonly chrome: LiveViewChrome | null;
  /** What the chrome says out loud when a screen reader reaches it. */
  readonly stateSentence: string;
  readonly workspace: { readonly mode: string; readonly reference: string | null; readonly status: string } | null;
  /**
   * How many LOGICAL plan steps have started — distinct plan steps with at least one Step
   * Execution, never the row count. The chrome read "Step 7 of 6" after a pause and a
   * resume because this was `run_step_execution`'s exact TOTAL, which counts ATTEMPTS
   * (UI cleanup 2026-09-22, UX-47). See `logicalStepProgress`.
   */
  readonly stepsStarted: number;
  readonly plannedSteps: number | null;
  /** Every attempt beyond the first, across the Run: secondary context, never the counter. */
  readonly retries: number;
  readonly frame: LiveViewerFrame | null;
  /** Why there is no frame, in words. Never an empty stage with nothing said. */
  readonly stageNote: string | null;
  readonly step: LiveViewerStep | null;
  readonly workItem: LiveViewerWorkItem | null;
  readonly observations: number;
  readonly evidence: readonly LiveViewerEvidence[];
  readonly instructions: readonly { readonly system: string; readonly text: string }[];
  readonly adapterSteps: readonly LiveViewerAdapterStep[];
  /**
   * Who holds control of the Run, at the top of the rail beside the screen. It is not in
   * the page header's control row, which it would turn into a stack (UX-48).
   */
  readonly controller?: React.ReactNode;
}

/**
 * The navy chrome strip, shared by Live View and Replay (UX-DR24, Story 5.8).
 *
 * "One session viewer for Live View and Replay" is the design rule, and this is the half
 * that is literally the same markup in both: the state dot and word, the workspace
 * identity, the isolation note and the Step counter. Two copies would agree on every case
 * anybody tried and diverge on the first one nobody did — here that would be a Replay whose
 * dot said one thing and whose word said another.
 */
export function SessionChrome({ chrome, stateSentence, workspace, counter }: {
  readonly chrome: LiveViewChrome | null;
  readonly stateSentence: string;
  /**
   * The workspace's GUARANTEE, said as a word. Its platform reference used to sit beside
   * it here — `workspace-01a0b44d-…`, thirty-six characters a reader never types, on the
   * one strip that has to be legible at a glance (UI cleanup 2026-09-22, UX-28). The
   * reference is under Technical details on the rail, where nothing is lost.
   */
  readonly workspace: { readonly mode: string } | null;
  readonly counter: string;
}): React.JSX.Element {
  return (
    <div className="ls-session__chrome">
      {/* The state is announced; the dot and word are the same fact for everyone else,
          so they are hidden from the reader that already heard the sentence. */}
      <span className="ls-visually-hidden" aria-live="polite">{stateSentence}</span>
      <span className="ls-session__state" aria-hidden="true">
        <span className={chrome === null ? 'ls-session__dot ls-session__dot--none' : chromeDotClass(chrome)} />
        {chrome ?? 'NO SESSION'}
      </span>
      <span className="ls-session__workspace">
        {workspace === null ? 'No Agent Workspace' : workspaceModeWord(workspace.mode)}
      </span>
      <span className="ls-session__note">{SESSION_ISOLATION_NOTE}</span>
      <span className="ls-session__counter">{counter}</span>
    </div>
  );
}

/**
 * The stage: one registered frame, or the sentence saying why there is none.
 *
 * Shared for the same reason as the chrome, and it carries the rule that matters most on
 * both surfaces — every frame is fetched through the Run's own protected route, which
 * consumes a worker-signed grant on the server, so no object-store URL, signed or
 * otherwise, is ever in this markup (AD-5).
 *
 * The stage holds the SCREEN and nothing else (UI cleanup 2026-09-22, UX-29, UX-48). The
 * captured page location and the capture time used to sit under the picture as its
 * caption, inside the stage, and the untrusted-content block that carries the location made
 * the stage a third taller than its 430px floor — which is what pushed Replay's playback
 * controls and Live View's screen below the first viewport. They are `FrameSource`, in the
 * rail beside the screen, where the rest of what a reader is told about it already is.
 *
 * Whether a tall rail can stretch this cell, and where a real frame sits inside the floor,
 * are both decided in package 5's region of `globals.css`: `.ls-session__body` aligns its
 * items to the start, because the grid item is this stage on Live View and on Replay alike.
 */
export function SessionStage({ runId, frame, stageNote, onFrameError, imageUnavailable, onRetryFrame }: {
  readonly runId: string;
  readonly frame: LiveViewerFrame | null;
  readonly stageNote: string | null;
  readonly onFrameError?: (evidenceId: string) => void;
  readonly imageUnavailable?: boolean;
  readonly onRetryFrame?: () => void;
}): React.JSX.Element {
  return (
    // Centred for the "no frame yet" sentence; top-aligned for a real frame, whatever
    // its own aspect ratio, so a short screenshot does not push its own top toward the
    // middle of the 430px floor (UX-29, UX-48; see `.ls-session__stage--frame`).
    <div className={frame === null ? 'ls-session__stage' : 'ls-session__stage ls-session__stage--frame'}>
      {frame === null ? (
        <p className="ls-session__stage-note">{stageNote}</p>
      ) : (
        <figure className="ls-session__figure">
          {/* A registered artifact's bytes never change, so the route answers a strong
              ETag and the browser may revalidate rather than re-read the store. */}
          {imageUnavailable ? (
            <div className="ls-stack">
              <p role="status" aria-live="polite">{stageNote}</p>
              {onRetryFrame === undefined ? null : <button type="button" className="ls-button ls-button--secondary ls-button--sm" onClick={onRetryFrame}>Retry this frame</button>}
            </div>
          ) : <img
            key={frame.evidenceId}
            className="ls-session__frame"
            src={`/api/runs/${runId}/frames/${frame.evidenceId}`}
            alt={frame.narration}
            decoding="async"
            onError={onFrameError === undefined ? undefined : () => onFrameError(frame.evidenceId)}
          />}
        </figure>
      )}
    </div>
  );
}

/**
 * Where a frame was captured, and WHEN, beside the screen rather than under it (UX-29).
 *
 * The location is what the Target System's page was at, so it is source content and goes
 * through `UntrustedText` — without the policy sentence, which the rail states ONCE above
 * every untrusted block it carries (UX-27). The integrity digest is under Technical details:
 * it is a sixty-four character check value, not something a reader reads (UX-28).
 */
export function FrameSource({ frame, headingId }: {
  readonly frame: Pick<LiveViewerFrame, 'sourceLocation' | 'capturedAt'>;
  readonly headingId: string;
}): React.JSX.Element {
  return (
    <section aria-labelledby={headingId} className="ls-stack">
      <h3 id={headingId}>Where this screen was captured</h3>
      <UntrustedText field="captured page location" policy={false}>{frame.sourceLocation}</UntrustedText>
      <p className="ls-caption">
        {frame.capturedAt === null
          ? CAPTURE_TIME_UNRECORDED
          : <>Captured <Timestamp value={frame.capturedAt} /></>}
      </p>
    </section>
  );
}

/**
 * The session viewer (UX-DR24, DESIGN.md → Session viewer), in its Live mode.
 *
 * A navy chrome strip over a sandboxed stage, with a narration rail beside it. Story 5.3
 * is READ-ONLY supervision: Pause, Cancel and Flag arrive with Stories 5.4 and 5.5, and a
 * disabled control whose action does not exist yet is worse than a control that is not
 * there — the rule Story 3.11 recorded for the Submit sentences. Run Detail keeps Cancel
 * in the meantime and this surface links to it.
 *
 * Every frame is a REGISTERED screenshot fetched through the Run's own protected route,
 * which consumes a worker-signed grant on the server: no object-store URL, signed or
 * otherwise, is ever in this markup (AD-5, `docs/contracts/live-view-v1.md`).
 */
export function LiveViewer(props: LiveViewerProps): React.JSX.Element {
  // The counter can never pass its own denominator: `stepsStarted` counts distinct plan
  // steps intersected with the plan's own step ids (UX-47).
  const counter = props.plannedSteps === null
    ? `Step ${props.stepsStarted.toLocaleString('en-US')}`
    : `Step ${props.stepsStarted.toLocaleString('en-US')} of ${props.plannedSteps.toLocaleString('en-US')}`;
  const attempt = props.step === null ? null : attemptContext(props.step.attempt);
  const untrusted = props.frame !== null || (props.step !== null && props.step.diagnostic !== null);
  // The identifiers, the exact instants and the check values, in one place a reader opens
  // deliberately rather than meets on the way to the screen (UX-28, UX-48).
  const technical: readonly TechnicalItem[] = [
    ...(props.workspace === null ? [] : [
      { label: 'Agent Workspace reference', value: props.workspace.reference ?? 'Not recorded', mono: true },
      { label: 'Agent Workspace state', value: props.workspace.status, mono: true },
    ]),
    ...(props.frame === null ? [] : [
      { label: 'Frame Evidence identifier', value: props.frame.evidenceId, mono: true },
      { label: 'Frame integrity digest', value: props.frame.digest, mono: true },
      ...(props.frame.capturedAt === null
        ? []
        : [{ label: 'Captured at', value: utcStamp(props.frame.capturedAt), mono: true }]),
    ]),
    ...(props.step === null ? [] : [
      { label: 'Current attempt', value: String(props.step.attempt), mono: true },
      { label: 'Step Execution state', value: props.step.state, mono: true },
    ]),
    { label: 'Attempts beyond the first', value: String(props.retries), mono: true },
  ];
  return (
    <section className="ls-session" aria-labelledby="live-session-heading">
      <h2 id="live-session-heading" className="ls-visually-hidden">Agent session</h2>
      <SessionChrome
        chrome={props.chrome}
        stateSentence={props.stateSentence}
        workspace={props.workspace}
        counter={counter}
      />

      <p className="ls-session-desktop-only">{LIVE_VIEW_DESKTOP_ONLY_SENTENCE}</p>

      <div className="ls-session__body">
        {/* The screen FIRST. The walkthrough met it below the first viewport, under a
            title, a status, a banner, full-width controls, a workspace id, a warning and a
            row of hashes — on the one surface whose purpose is to show a screen. */}
        <SessionStage runId={props.runId} frame={props.frame} stageNote={props.stageNote} />

        <div className="ls-session__rail ls-stack">
          {props.controller ?? null}
          {/* The policy sentence ONCE, above every untrusted block this rail carries, and
              only when it carries one (UX-27): the walkthrough met it under every field. */}
          {untrusted ? <UntrustedPolicy /> : null}
          <section aria-labelledby="live-step-heading" className="ls-stack">
            <h3 id="live-step-heading">What the Agent is doing</h3>
            {props.step === null ? (
              <p>No Step Execution has started yet.</p>
            ) : (
              <>
                <p className="ls-session__narration">{props.step.narration}</p>
                {/* `attempt 1` is said nowhere: every Step Execution has one, so printing
                    it makes a retry indistinguishable from an ordinary first pass. */}
                {attempt === null ? null : <p className="ls-caption">This is {attempt}.</p>}
                {props.step.diagnostic === null ? null : (
                  <UntrustedText field="Step Execution diagnostic" policy={false}>{props.step.diagnostic}</UntrustedText>
                )}
              </>
            )}
          </section>

          <section aria-labelledby="live-work-item-heading" className="ls-stack">
            <h3 id="live-work-item-heading">Record being inspected</h3>
            {props.workItem === null ? (
              // Each sentence is true of its own Run state. A COMPLETED Run used to be
              // told "No Work Item is being worked yet." — "yet" is a claim about a
              // future only an active Run has (UX-49).
              <p>{noWorkItemSentence(props.runState)}</p>
            ) : (
              <p>
                {/* The record, then the system: `displayName` alone is the same on every
                    Work Item of a Run, so this rail could not say which leaver was being
                    inspected. One rule, shared with the Replay jump list. */}
                {workItemLabel(props.workItem)} · {workItemWord(props.workItem.state) ?? props.workItem.state} ·{' '}
                {countNoun(props.workItem.observations, 'Observation')}
              </p>
            )}
            <p>{countNoun(props.observations, 'Observation')} registered in this Run so far.</p>
          </section>

          {props.frame === null ? null : <FrameSource frame={props.frame} headingId="live-frame-source-heading" />}

          {/* What has been frozen, behind a disclosure: a growing inventory is provenance,
              not what a person watching a Run is reading (UX-48). */}
          <details className="ls-disclosure">
            <summary>
              Evidence as registered · {countNoun(props.evidence.length, 'item')}
            </summary>
            <div className="ls-disclosure__body ls-stack">
              {props.evidence.length === 0 ? (
                <p>No Evidence has been registered yet.</p>
              ) : (
                <ul className="ls-session__evidence">
                  {props.evidence.map((item) => (
                    <li key={item.evidenceId}>
                      <EvidenceKindBadge kind={item.kind} />
                      <span>{evidenceKindWord(item.kind)}</span>
                      {item.digest === null ? <span>No digest recorded.</span> : <Digest value={item.digest} label="Evidence integrity digest" />}
                      <span>
                        {item.capturedAt === null ? CAPTURE_TIME_UNRECORDED : <Timestamp value={item.capturedAt} />}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              <p>
                <Link href={`/runs/${props.runId}/evidence`}>Open the Evidence tab</Link>
              </p>
            </div>
          </details>

          <TechnicalDetails items={technical} />
        </div>
      </div>

      {props.instructions.length === 0 ? null : (
        <section aria-labelledby="live-instructions-heading" className="ls-card ls-stack">
          <h3 id="live-instructions-heading">Audit Instructions</h3>
          <p>The auditor&rsquo;s own words, frozen into this Procedure Version and shown verbatim.</p>
          {props.instructions.map((instruction) => (
            <div key={instruction.system} className="ls-stack">
              <h4>{instruction.system}</h4>
              <pre className="ls-session__instruction">{instruction.text}</pre>
            </div>
          ))}
        </section>
      )}

      <AdapterStepLog runId={props.runId} steps={props.adapterSteps} headingId="live-adapter-heading" />
    </section>
  );
}

/**
 * What one adapter log row says about its artifact: the Evidence and its digest, or one of
 * two sentences — never one sentence for all three situations (Story 10.6, legacy 5.3).
 *
 * The Evidence is named the way the Result tab names the artifacts a Run froze: a short
 * reference linked to its card, with the full identifier under Technical details.
 */
function AdapterArtifact({ runId, artifact }: {
  readonly runId: string;
  readonly artifact: AdapterStepArtifact;
}): React.JSX.Element {
  switch (artifact.kind) {
    case 'registered':
      return (
        <>
          <a href={`/runs/${runId}/evidence/technical#evidence-${encodeURIComponent(artifact.evidenceId)}`}>
            <Reference kind="Evidence" value={artifact.evidenceId} />
          </a>
          <Digest value={artifact.digest} label="Adapter artifact digest" />
        </>
      );
    case 'unavailable':
      return <span>{ADAPTER_ARTIFACT_WORDS.unavailable}</span>;
    case 'none':
      return <span>{ADAPTER_ARTIFACT_WORDS.none}</span>;
  }
}

/**
 * The Session Steps an Adapter performed, as log rows (UX-DR25's adapter-only row).
 *
 * ONE component for Live View and Replay, the `SessionChrome` and `SessionStage`
 * discipline: the two copies of this markup already disagreed once — Replay's rows were
 * repaired to show their digests and Live View's were left passing `null` — and a single
 * component is what stops the next repair landing on one surface only.
 */
export function AdapterStepLog({ runId, steps, headingId }: {
  readonly runId: string;
  readonly steps: readonly LiveViewerAdapterStep[];
  readonly headingId: string;
}): React.JSX.Element | null {
  if (steps.length === 0) return null;
  return (
    <section aria-labelledby={headingId} className="ls-card ls-stack">
      <h3 id={headingId}>Systems read without a screen</h3>
      <p>An Adapter reads without a workspace screen, so each step is a log row with its state and its integrity digest.</p>
      <ul className="ls-session__log">
        {steps.map((step) => (
          <li key={step.stepId}>
            <span>{step.displayName}</span>
            <span>{sessionStepWord(step.state)} · {countNoun(step.attempts, 'attempt')}</span>
            <AdapterArtifact runId={runId} artifact={step.artifact} />
            <TechnicalDetails
              items={[
                { label: 'Plan step identifier', value: step.stepId, mono: true },
                ...(step.artifact.kind === 'registered'
                  ? [{ label: 'Evidence identifier', value: step.artifact.evidenceId, mono: true }]
                  : []),
              ]}
            />
          </li>
        ))}
      </ul>
    </section>
  );
}

/** What Live View says when the Run it names has already finished. */
export function EndedBanner({ runId, state }: { readonly runId: string; readonly state: string }): React.JSX.Element {
  return (
    <Banner tone="info" title={`This Run has ended: ${state}.`}>
      <p>
        Nothing further will be captured. <Link href={`/runs/${runId}`}>Open Run Detail</Link> for the Result, the
        Evidence Quality Gate and the Execution Timeline.
      </p>
    </Banner>
  );
}
