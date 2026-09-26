'use client';

import Link from 'next/link';
import { Fragment, useEffect, useRef, useState } from 'react';

import { Banner } from '../design/Banner';
import { TechnicalDetails } from '../design/TechnicalDetails';
import { countNoun } from '../design/words';
import { REPLAY_COPY } from '../design/copy';
import { AdapterStepLog, FrameSource, SessionChrome, SessionStage, type LiveViewerAdapterStep, type LiveViewerFrame } from './LiveViewer';
import { UntrustedPolicy, UntrustedText } from './UntrustedText';
import {
  REPLAY_BOUND_WORDS,
  REPLAY_GAP_WORDS,
  clampReplayIndex,
  replayGapPosition,
  replayGapsAt,
  replayIncompleteSentence,
  replayInspectionHref,
  replayJumpBoundSentence,
  type ReplayFrameAbsence,
  type ReplayGapView,
  type ReplayGapsView,
  type ReplayInitialSelection,
  type ReplayJumpTarget,
  type ReplayJumpTotals,
  type ReplayWindow,
} from './replay';
import { recordFramePosition, toolActionNarration } from './session-words';
import { utcStamp } from './labels';

/** One frame and everything the platform already stored about the action that took it. */
export interface ReplayFrameView extends LiveViewerFrame {
  /** Position among all retained session captures, distinct from the loaded page index. */
  readonly globalOrdinal?: number;
  /** The Step narration, which is also this frame's `alt` (UX-DR37). */
  readonly stepNarration: string;
  readonly workItemLabel: string | null;
  /** Which Work Item this frame belongs to, for the record's own frame position (UX-29). */
  readonly workItemId: string | null;
  /** The record the Work Item inspected, or `null` when it inspected no population. */
  readonly subjectKey: string | null;
  readonly action: {
    readonly action: string;
    readonly method: string;
    readonly destination: string;
    readonly outcome: string;
    readonly status: number | null;
    readonly denial: string | null;
    readonly capture: string;
    readonly captureSuppression: string | null;
    readonly startedAt: string;
  } | null;
  /** Observations the Run had registered by the time this frame was captured. */
  readonly observations: number;
}

export interface ReplayViewerProps {
  readonly runId: string;
  readonly stateSentence: string;
  readonly workspace: { readonly mode: string; readonly reference: string | null } | null;
  /** The Run's terminal state, said in words on the rail rather than as a stored token. */
  readonly runState: string;
  readonly frames: readonly ReplayFrameView[];
  /** The exact number of frames this Run holds; larger than `frames` when the read bound. */
  readonly framesTotal: number;
  readonly plannedSteps: number | null;
  readonly stageNote: string | null;
  readonly jumpTargets: readonly ReplayJumpTarget[];
  /**
   * The EXACT number of Escalations and Exceptions the Run holds, beside the bounded pages
   * `jumpTargets` was built from (Story 10.9). REQUIRED, so no view can leave a bounded list
   * unsaid by forgetting it; `null` only where no jump list renders, an inspection page.
   */
  readonly jumpTotals: ReplayJumpTotals | null;
  readonly instructions: readonly { readonly system: string; readonly text: string }[];
  readonly adapterSteps: readonly LiveViewerAdapterStep[];
  /** Where Replay opens: the first frame, a requested inspection, or a request it could not resolve. */
  readonly initialSelection?: ReplayInitialSelection;
  /** One inspection's own captures, paged, when Replay was opened at a record's inspection. */
  readonly window?: ReplayWindow;
  /**
   * The Tool Actions that left no frame, and where each sits (Story 10.6, legacy 5.2): a
   * missing frame and a suppressed capture, told apart. Absent on an inspection page, whose
   * frames are one record's captures rather than the whole session.
   */
  readonly gaps?: ReplayGapsView;
}

/** How long one frame is held while Replay is playing. */
const FRAME_INTERVAL_MS = 1_200;

/**
 * The sentence for a jump target with no frame, from the resolver's reason: each says only
 * what the read could know (see `ReplayFrameAbsence`). Exhaustive over the vocabulary, so a
 * reason added to the resolver fails to compile here rather than rendering nothing.
 */
function absenceSentence(absence: ReplayFrameAbsence, shown: number): string {
  switch (absence) {
    case 'none-captured': return REPLAY_COPY.noFrameForTarget;
    case 'none-before': return REPLAY_COPY.noFrameBeforeTarget;
    case 'not-read': return REPLAY_COPY.frameNotRead.replace('{shown}', String(shown));
  }
}

const JUMP_WORDS: Readonly<Record<ReplayJumpTarget['kind'], string>> = {
  'work-item': 'Work Item',
  exception: 'Exception',
  escalation: 'Escalation',
};

/**
 * One gap on the scrubber: a marker, not a button, because there is no frame to open. Its
 * SHAPE differs from a frame's pill — a missing frame is hollow and dashed, a suppressed
 * capture hatched — so it is never colour alone, and its name says which and where.
 */
function GapMarker({ gap }: { readonly gap: ReplayGapView }): React.JSX.Element {
  return (
    <span
      className={`ls-scrubber-gap ls-scrubber-gap--${gap.kind}`}
      role="img"
      aria-label={`${gap.mark}, ${replayGapPosition(gap.framesBefore)}: ${gap.narration}`}
      title={`${gap.mark}, ${replayGapPosition(gap.framesBefore)}`}
    />
  );
}

/**
 * The jump list's bound sentences, one per kind the list names only part of (Story 10.9).
 *
 * `shown` is counted from the targets this list RENDERS, never taken from a read, so the
 * sentence cannot describe a list other than the one under it; `total` is the Run's exact
 * count. Empty when the list names everything, which is every Run under the bound.
 */
function jumpBoundSentences(targets: readonly ReplayJumpTarget[], totals: ReplayJumpTotals | null): readonly string[] {
  if (totals === null) return [];
  const shown = (kind: ReplayJumpTarget['kind']): number => targets.filter((target) => target.kind === kind).length;
  return [
    replayJumpBoundSentence('escalation', shown('escalation'), totals.escalations),
    replayJumpBoundSentence('exception', shown('exception'), totals.exceptions),
  ].filter((sentence): sentence is string => sentence !== null);
}

/**
 * What the jump list covers when it is bounded, and the way to the rest (Story 10.9): its
 * record's own inspection, which the record review opens and which pages through every
 * capture the Run retained for that record. The sentence is the owner's, word for word;
 * only its "record review" is a link.
 */
function JumpBounds({ runId, bounds }: { readonly runId: string; readonly bounds: readonly string[] }): React.JSX.Element | null {
  if (bounds.length === 0) return null;
  const [before, after] = REPLAY_BOUND_WORDS.rest.split(REPLAY_BOUND_WORDS.restLink);
  // ONE note, so it reads as one statement about the list under it: as separate paragraphs
  // the stack's gap spaced each sentence like another item of the card. A sentence to a
  // line, so the two counts sit one above the other and the way to the rest is not broken
  // across lines; each is its own span, so each can still be found by its words.
  return (
    <p className="ls-caption" data-jump-bounds="">
      {bounds.map((sentence) => <Fragment key={sentence}><span>{sentence}</span>{' '}<br /></Fragment>)}
      <span>{before}<Link href={`/runs/${runId}/evidence`}>{REPLAY_BOUND_WORDS.restLink}</Link>{after}</span>
    </p>
  );
}

/**
 * The gaps in this playback, stated rather than implied (Story 10.6, legacy 5.2).
 *
 * A Replay with a gap used to look complete: the scrubber held only the frames a Run
 * registered, and nothing said an action had left none. The COUNT is exact and only missing
 * frames are counted — a suppressed capture is the credential guarantee working, said in
 * the platform's own capture sentence and listed beside the gaps, never as one.
 */
function ReplayGaps({ gaps }: { readonly gaps: ReplayGapsView | undefined }): React.JSX.Element | null {
  if (gaps === undefined || gaps.missing + gaps.suppressed === 0) return null;
  const listed = gaps.missing + gaps.suppressed;
  return (
    <section aria-labelledby="replay-gaps-heading" className="ls-stack">
      <h3 id="replay-gaps-heading">{REPLAY_GAP_WORDS.heading}</h3>
      {gaps.missing === 0 ? null : <Banner tone="warning" variant="line" title={replayIncompleteSentence(gaps.missing)} />}
      <details className="ls-disclosure">
        <summary>{REPLAY_GAP_WORDS.listSummary}</summary>
        <div className="ls-disclosure__body ls-stack">
          <ul className="ls-plain-list">
            {gaps.rows.map((gap) => (
              <li key={gap.toolActionId} data-gap={gap.kind}>
                {gap.mark} · {replayGapPosition(gap.framesBefore)} · {gap.narration}
              </li>
            ))}
          </ul>
          {gaps.rows.length < listed ? (
            <p className="ls-caption">
              {REPLAY_GAP_WORDS.bounded
                .replace('{shown}', gaps.rows.length.toLocaleString('en-US'))
                .replace('{total}', listed.toLocaleString('en-US'))}
            </p>
          ) : null}
        </div>
      </details>
    </section>
  );
}

/**
 * The session viewer in its REPLAY mode (Story 5.8, FR-30, UX-DR24, UX-DR26, addendum §F).
 *
 * **It re-executes nothing, and that is a property of what it can reach.** Every prop is a
 * row the platform already stored, the frames come through the Run's own protected route,
 * and there is no action, no fetch and no provider client anywhere in this file. A Replay
 * that could re-run a Tool Action would be a Replay that could change what it is showing.
 *
 * **It starts PAUSED at the requested inspection, or the first frame** (UX-DR26). A Replay
 * that started playing would move a session under somebody who opened it to look at one
 * thing.
 *
 * The chrome and the stage are the SAME components Live View renders, so the two surfaces
 * cannot disagree about a state dot, a workspace identity or where a frame comes from.
 */
export function ReplayViewer(props: ReplayViewerProps): React.JSX.Element {
  const [index, setIndex] = useState(() => props.window?.kind === 'unavailable' || props.initialSelection?.frameIndex === null
    ? -1 : clampReplayIndex(props.initialSelection?.frameIndex ?? 0, props.frames.length));
  const [playing, setPlaying] = useState(false);
  const [jumped, setJumped] = useState<ReplayJumpTarget | null>(null);
  const [unavailableFrame, setUnavailableFrame] = useState<string | null>(null);
  const viewer = useRef<HTMLDivElement>(null);
  const frame = index < 0 ? null : props.frames[index] ?? null;
  // Whether this rail carries source content at all: the frame's captured location and the
  // page address its Tool Action asked for. No frame, no untrusted block, no policy line.
  const untrusted = frame !== null;
  const last = props.frames.length - 1;

  useEffect(() => {
    if (!playing || index < 0) return undefined;
    if (index >= last) { setPlaying(false); return undefined; }
    const timer = window.setTimeout(() => setIndex((value) => clampReplayIndex(value + 1, props.frames.length)), FRAME_INTERVAL_MS);
    return () => window.clearTimeout(timer);
  }, [playing, index, last, props.frames.length]);

  const go = (next: number, target: ReplayJumpTarget | null = null): void => {
    setPlaying(false);
    setJumped(target);
    setIndex(clampReplayIndex(next, props.frames.length));
  };

  function onKeyDown(event: React.KeyboardEvent<HTMLDivElement>): void {
    if (index < 0) return;
    // Space belongs to whatever has focus. A pill or a jump row is a real button, so the
    // browser already activates it on Space and Enter; taking Space here as well would
    // make one keystroke do two things.
    if (event.key === ' ' && event.target !== event.currentTarget) return;
    const step = (delta: number): void => { event.preventDefault(); go(index + delta); };
    switch (event.key) {
      case 'ArrowRight': case 'ArrowDown': return step(1);
      case 'ArrowLeft': case 'ArrowUp': return step(-1);
      case 'Home': return step(-index);
      case 'End': return step(last - index);
      case ' ': event.preventDefault(); setPlaying((value) => !value); return;
      default: return;
    }
  }

  /**
   * ONE global counter (UX-29).
   *
   * The walkthrough met two — `Frame 6 of 15` on the chrome and a per-inspection count on
   * the rail — with nothing saying which was which. The planned-Step count that used to
   * ride beside this is a third number about a different thing and is under Technical
   * details; what a reader following a session wants is where they are in it.
   */
  const inspection = props.window?.kind === 'inspection' ? props.window : null;
  // Both views number a frame among EVERY capture the Run retained, so the counter says
  // where this screen sits in the whole session, not in the loaded page. The default view
  // said "Frame 500 of 500" over a Run of 520 frames -- the bound presented as the total
  // (Story 10.9); its first frames ARE the session's first, so the position is unchanged.
  const counterTotal = Math.max(props.framesTotal, props.frames.length);
  const counter = index < 0
    ? props.window !== undefined || props.frames.length > 0 ? 'No selected frame' : 'No frames'
    : `Frame ${(frame?.globalOrdinal ?? index + 1).toLocaleString('en-US')} of ${counterTotal.toLocaleString('en-US')}`;
  const selection = props.initialSelection;
  const selectionNote = props.window?.kind === 'unavailable'
    ? 'The requested inspection is not available in this Replay view. Its identity or page could not be resolved.'
    : inspection !== null && props.frames.length === 0
      ? `No retained capture exists for this inspection: ${inspection.label}.`
      : selection?.kind === 'unavailable'
        ? 'The requested inspection is not available in this Replay view. Choose a recorded target below.'
        : selection?.kind === 'inspection' && selection.target.frameIndex === null
          ? `Requested inspection: ${selection.target.label}. ${absenceSentence(selection.target.absence, props.frames.length)} Choose a recorded target below.`
          : null;

  const jumpBounds = jumpBoundSentences(props.jumpTargets, props.jumpTotals);

  /**
   * The selected record's own position, beside the global one and only when a record is
   * selected. A count of frames "for this record" over a session nobody jumped into is a
   * number about nothing.
   */
  const ofRecord = ((): string | null => {
    if (frame === null || jumped === null || jumped.kind !== 'work-item') return null;
    const mine = props.frames.filter((item) => item.workItemId === jumped.id);
    const position = mine.findIndex((item) => item.evidenceId === frame.evidenceId);
    if (position < 0 || mine.length === 0) return null;
    return recordFramePosition(frame.subjectKey ?? jumped.label, position + 1, mine.length);
  })();

  return (
    <section className="ls-session" aria-labelledby="replay-session-heading">
      <h2 id="replay-session-heading" className="ls-visually-hidden">Agent session replay</h2>
      <SessionChrome
        chrome="REPLAY"
        stateSentence={props.stateSentence}
        workspace={props.workspace}
        counter={counter}
      />

      {inspection === null ? null : (
        <section aria-labelledby="replay-inspection-heading" className="ls-stack">
          <h3 id="replay-inspection-heading">Selected inspection: {inspection.label}</h3>
          <p>{props.frames.length === 0 ? '0 retained inspection frames.'
            : `Inspection frames ${inspection.cursor + 1}–${inspection.cursor + props.frames.length} of ${inspection.total}. This page contains only this inspection’s captures.`}</p>
          <nav aria-label="Inspection frame pages" className="ls-stack">
            {inspection.previousCursor === null ? null : <Link href={replayInspectionHref(props.runId, inspection.workItemId, inspection.previousCursor)}>Previous inspection frames</Link>}
            {inspection.nextCursor === null ? null : <Link href={replayInspectionHref(props.runId, inspection.workItemId, inspection.nextCursor)}>Next inspection frames</Link>}
          </nav>
        </section>
      )}
      {props.window === undefined ? null : <p><Link href={`/runs/${props.runId}/replay`}>Open session Replay</Link></p>}
      {selectionNote === null ? null : <p role="status">{selectionNote}</p>}

      <p className="ls-session-desktop-only">{REPLAY_COPY.desktopOnly}</p>

      {/* `tabIndex` so the arrow keys have somewhere to be pressed, and a label so a reader
          who lands here is told what the keys do rather than discovering them. */}
      <div
        ref={viewer}
        className="ls-session__body"
        tabIndex={0}
        role="group"
        aria-label={REPLAY_COPY.viewerLabel}
        onKeyDown={onKeyDown}
      >
        <SessionStage
          runId={props.runId}
          onFrameError={(evidenceId) => { setPlaying(false); setUnavailableFrame(evidenceId); }}
          frame={frame}
          imageUnavailable={frame !== null && frame.evidenceId === unavailableFrame}
          onRetryFrame={() => { setPlaying(false); setUnavailableFrame(null); }}
          stageNote={frame?.evidenceId === unavailableFrame
            ? 'This recorded frame could not be read from Evidence storage. Its Evidence record is unchanged.'
            : frame === null ? selectionNote ?? props.stageNote : null}
        />

        <div className="ls-session__rail ls-stack">
          <section aria-labelledby="replay-playback-heading" className="ls-stack">
            <h3 id="replay-playback-heading" className="ls-visually-hidden">Playback</h3>
            {/* The playback controls and the scrubber sit BESIDE the frame, at the top of the
                rail (UX-29). The walkthrough found both under the first viewport, so a reader
                had to scroll away from the screen to move it; under the stage they would still
                sit past the fold at 1366x768, because the stage keeps DESIGN.md's 430px floor.
                Below 1024px the rail stacks under the stage, so they are directly under it. */}
            <div className="ls-session__controls">
              <button
                type="button"
                className="ls-button ls-button--secondary ls-button--sm"
                onClick={() => { if (index >= 0) setPlaying((value) => !value); }}
                aria-disabled={index < 0 ? true : undefined}
              >{playing ? REPLAY_COPY.pause : REPLAY_COPY.play}</button>
              {ofRecord === null ? null : <span className="ls-session__record-position">{ofRecord}</span>}
              <span className="ls-caption">{REPLAY_COPY.keys}</span>
            </div>

            <div className="ls-session__scrubber" role="group" aria-label={REPLAY_COPY.scrubberLabel}>
              {props.frames.map((item, position) => (
                <Fragment key={item.evidenceId}>
                  {/* A gap is marked WHERE it sits: after the frames that precede it and before
                      the next (Story 10.6, legacy 5.2). Not a button — there is no frame to open. */}
                  {replayGapsAt(props.gaps, position).map((gap) => <GapMarker key={gap.toolActionId} gap={gap} />)}
                  <button
                    type="button"
                    className={position === index ? 'ls-scrubber-pill ls-scrubber-pill--current' : 'ls-scrubber-pill'}
                    aria-current={position === index ? 'true' : undefined}
                    aria-label={`Frame ${item.globalOrdinal ?? position + 1} of ${counterTotal}: ${item.stepNarration}`}
                    onClick={() => go(position)}
                  />
                </Fragment>
              ))}
              {replayGapsAt(props.gaps, props.frames.length).map((gap) => <GapMarker key={gap.toolActionId} gap={gap} />)}
            </div>
            {props.window === undefined && props.framesTotal > props.frames.length ? (
              <p className="ls-caption">
                {REPLAY_COPY.bounded
                  .replace('{shown}', String(props.frames.length))
                  .replace('{total}', String(props.framesTotal))}
              </p>
            ) : null}
          </section>

          <ReplayGaps gaps={props.gaps} />

          {/* The policy sentence ONCE, above the untrusted blocks this rail carries (UX-27). */}
          {untrusted ? <UntrustedPolicy /> : null}

          <section aria-labelledby="replay-step-heading" className="ls-stack">
            <h3 id="replay-step-heading">What the Agent was doing</h3>
            {frame === null ? <p>{selectionNote ?? (props.framesTotal > 0 ? 'Choose a recorded frame to see its inspection step.' : REPLAY_COPY.noFrames)}</p> : (
              <p className="ls-session__narration">{frame.stepNarration}</p>
            )}
            {frame?.workItemLabel === null || frame?.workItemLabel === undefined
              ? null
              : <p>Record: {frame.workItemLabel}</p>}
          </section>

          <section aria-labelledby="replay-action-heading" className="ls-stack">
            <h3 id="replay-action-heading">What this screen is</h3>
            {frame?.action === null || frame?.action === undefined ? (
              <p>{REPLAY_COPY.noAction}</p>
            ) : (
              <>
                {/* The action, in audit words. `navigate · GET · performed · 200` is the
                    row as it was stored; the method, the status and the outcome token are
                    under Technical details (UX-28). */}
                <p>
                  {toolActionNarration(frame.action.action, {
                    subject: frame.subjectKey,
                    system: null,
                  })}
                  {frame.action.outcome === 'denied' ? ' — refused by the platform' : ''}
                </p>
                <UntrustedText field="page address the Agent asked for" policy={false}>{frame.action.destination}</UntrustedText>
                {frame.action.denial === null ? null : <p>Refused: {frame.action.denial}</p>}
                <p>
                  {frame.action.capture === 'SUPPRESSED'
                    ? `Nothing was captured on this request${frame.action.captureSuppression === null ? '.' : ` — ${frame.action.captureSuppression}`}`
                    : 'The screen above was captured on this request.'}
                </p>
              </>
            )}
          </section>

          {frame === null ? null : <FrameSource frame={frame} headingId="replay-frame-source-heading" />}

          <section aria-labelledby="replay-observations-heading" className="ls-stack">
            <h3 id="replay-observations-heading">Observations</h3>
            {/* A count needs a frame to be counted AT. With no frame this said "0
                Observations had been registered when this frame was captured", which
                describes a frame that does not exist. */}
            <p>
              {frame === null
                ? selectionNote ?? (props.framesTotal > 0 ? 'Choose a recorded frame to see the observations registered by that moment.' : REPLAY_COPY.observationsNoFrame)
                : REPLAY_COPY.observationsThrough.replace('{count}', countNoun(frame.observations, 'Observation'))}
            </p>
            {/* Observations are listed on the Evidence tab, with their grounding; there is
                no Observations tab and a link to one is a Page not found. */}
            <p><Link href={`/runs/${props.runId}/evidence`}>{REPLAY_COPY.observationsLink}</Link></p>
          </section>

          <TechnicalDetails
            items={[
              { label: 'Run state', value: props.runState, mono: true },
              ...(props.workspace === null ? [] : [
                { label: 'Agent Workspace reference', value: props.workspace.reference ?? 'Not recorded', mono: true },
              ]),
              ...(props.plannedSteps === null
                ? []
                : [{ label: 'Plan steps this Version declares', value: String(props.plannedSteps), mono: true }]),
              ...(frame === null ? [] : [
                { label: 'Frame Evidence identifier', value: frame.evidenceId, mono: true },
                { label: 'Frame integrity digest', value: frame.digest, mono: true },
                ...(frame.capturedAt === null ? [] : [{ label: 'Captured at', value: utcStamp(frame.capturedAt), mono: true }]),
                ...(frame.workItemId === null ? [] : [{ label: 'Work Item identifier', value: frame.workItemId, mono: true }]),
              ]),
              ...(frame?.action == null ? [] : [
                { label: 'Tool Action', value: frame.action.action, mono: true },
                { label: 'HTTP method', value: frame.action.method, mono: true },
                { label: 'Outcome', value: frame.action.outcome, mono: true },
                { label: 'HTTP status', value: frame.action.status === null ? 'Not recorded' : String(frame.action.status), mono: true },
                { label: 'Capture state', value: frame.action.capture, mono: true },
                { label: 'Action started at', value: utcStamp(frame.action.startedAt), mono: true },
              ]),
            ]}
          />
        </div>
      </div>

      {/* An inspection page is one record's captures; its way back to the whole session is
          the link above, so it lists no jump targets of its own. */}
      {props.window !== undefined ? null : <section aria-labelledby="replay-jump-heading" className="ls-card ls-stack">
        <h3 id="replay-jump-heading">Jump to</h3>
        {/* Said BEFORE the list, so a reader knows it is partial before reading it. */}
        <JumpBounds runId={props.runId} bounds={jumpBounds} />
        {props.jumpTargets.length === 0 ? (jumpBounds.length === 0 ? <p>{REPLAY_COPY.noJumpTargets}</p> : null) : (
          <ul className="ls-session__jumps">
            {props.jumpTargets.map((target) => (
              <li key={`${target.kind}-${target.id}`}>
                {target.frameIndex === null ? (
                  // Nowhere to go, said in words -- and said only as far as it is KNOWN. A
                  // pill that opens nothing looks exactly like one that opens the right
                  // screen; and the resolver, not this row, decides whether the read could
                  // tell "captured nothing" from "not among the frames read".
                  <span>
                    {JUMP_WORDS[target.kind]} · <span className="ls-mono">{target.label}</span>
                    {' '}· {absenceSentence(target.absence, props.frames.length)}
                    {/* The inspection page that HOLDS the frame: an Escalation's can sit past that
                        record's first page (Story 10.9). */}
                    {target.absence === 'not-read' && target.workItemId !== undefined ? <>{' · '}<Link href={replayInspectionHref(props.runId, target.workItemId, target.inspectionCursor ?? 0)}>Open inspection Replay</Link></> : null}
                  </span>
                ) : (
                  <button
                    type="button"
                    className="ls-button ls-button--ghost ls-button--sm"
                    onClick={() => go(target.frameIndex, target)}
                  >
                    {JUMP_WORDS[target.kind]} · <span className="ls-mono">{target.label}</span>
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>}

      {props.instructions.length === 0 ? null : (
        <section aria-labelledby="replay-instructions-heading" className="ls-card ls-stack">
          <h3 id="replay-instructions-heading">Audit Instructions</h3>
          <p>The auditor&rsquo;s own words, frozen into this Procedure Version and shown verbatim.</p>
          {props.instructions.map((instruction) => (
            <div key={instruction.system} className="ls-stack">
              <h4>{instruction.system}</h4>
              <pre className="ls-session__instruction">{instruction.text}</pre>
            </div>
          ))}
        </section>
      )}

      <AdapterStepLog runId={props.runId} steps={props.adapterSteps} headingId="replay-adapter-heading" />
    </section>
  );
}
