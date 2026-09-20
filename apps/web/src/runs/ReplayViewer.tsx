'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';

import { Digest } from '../design/Digest';
import { REPLAY_COPY } from '../design/copy';
import { SessionChrome, SessionStage, type LiveViewerAdapterStep, type LiveViewerFrame } from './LiveViewer';
import { UntrustedText } from './UntrustedText';
import { clampReplayIndex, replayInspectionHref, type ReplayWindow, type ReplayFrameAbsence, type ReplayInitialSelection, type ReplayJumpTarget } from './replay';
import { utcStamp } from './labels';

/** One frame and everything the platform already stored about the action that took it. */
export interface ReplayFrameView extends LiveViewerFrame {
  /** Position among all retained session captures, distinct from the loaded page index. */
  readonly globalOrdinal?: number;
  /** The Step narration, which is also this frame's `alt` (UX-DR37). */
  readonly stepNarration: string;
  readonly workItemLabel: string | null;
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
  readonly frames: readonly ReplayFrameView[];
  /** The exact number of frames this Run holds; larger than `frames` when the read bound. */
  readonly framesTotal: number;
  readonly plannedSteps: number | null;
  readonly stageNote: string | null;
  readonly jumpTargets: readonly ReplayJumpTarget[];
  readonly instructions: readonly { readonly system: string; readonly text: string }[];
  readonly adapterSteps: readonly LiveViewerAdapterStep[];
  readonly initialSelection?: ReplayInitialSelection;
  readonly window?: ReplayWindow;
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
 * The session viewer in its REPLAY mode (Story 5.8, FR-30, UX-DR24, UX-DR26, addendum §F).
 *
 * **It re-executes nothing, and that is a property of what it can reach.** Every prop is a
 * row the platform already stored, the frames come through the Run's own protected route,
 * and there is no action, no fetch and no provider client anywhere in this file. A Replay
 * that could re-run a Tool Action would be a Replay that could change what it is showing.
 *
 * **It starts PAUSED at the requested inspection, or the first frame** (UX-DR26). A Replay that started playing would
 * move a session under somebody who opened it to look at one thing.
 *
 * The chrome and the stage are the SAME components Live View renders, so the two surfaces
 * cannot disagree about a state dot, a workspace identity or where a frame comes from.
 */
export function ReplayViewer(props: ReplayViewerProps): React.JSX.Element {
  const [index, setIndex] = useState(() => props.window?.kind === 'unavailable' || props.initialSelection?.frameIndex === null
    ? -1 : clampReplayIndex(props.initialSelection?.frameIndex ?? 0, props.frames.length));
  const [playing, setPlaying] = useState(false);
  const [unavailableFrame, setUnavailableFrame] = useState<string | null>(null);
  const viewer = useRef<HTMLDivElement>(null);
  const frame = index < 0 ? null : props.frames[index] ?? null;
  const last = props.frames.length - 1;

  useEffect(() => {
    if (!playing || index < 0) return undefined;
    if (index >= last) { setPlaying(false); return undefined; }
    const timer = window.setTimeout(() => setIndex((value) => clampReplayIndex(value + 1, props.frames.length)), FRAME_INTERVAL_MS);
    return () => window.clearTimeout(timer);
  }, [playing, index, last, props.frames.length]);

  const go = (next: number): void => { setPlaying(false); setIndex(clampReplayIndex(next, props.frames.length)); };

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

  const position = `Frame ${frame?.globalOrdinal ?? index + 1} of ${props.window?.kind === 'inspection' ? props.framesTotal : props.frames.length}`;
  const counter = props.plannedSteps === null ? position : `${position} · ${props.plannedSteps} planned Steps`;
  const inspection = props.window?.kind === 'inspection' ? props.window : null;
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

  return (
    <section className="ls-session" aria-labelledby="replay-session-heading">
      <h2 id="replay-session-heading" className="ls-visually-hidden">Agent session replay</h2>
      <SessionChrome
        chrome="REPLAY"
        stateSentence={props.stateSentence}
        workspace={props.workspace}
        counter={index < 0 ? props.window !== undefined ? 'No selected frame' : props.frames.length === 0 ? 'No frames' : 'No selected frame' : counter}
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
          <section aria-labelledby="replay-step-heading" className="ls-stack">
            <h3 id="replay-step-heading">Step</h3>
            {frame === null ? <p>{selectionNote ?? (props.framesTotal > 0 ? 'Choose a recorded frame to see its inspection step.' : REPLAY_COPY.noFrames)}</p> : <p>{frame.stepNarration}</p>}
            {frame?.workItemLabel === null || frame?.workItemLabel === undefined
              ? null
              : <p>Work Item: {frame.workItemLabel}</p>}
          </section>

          <section aria-labelledby="replay-action-heading" className="ls-stack">
            <h3 id="replay-action-heading">Tool Action</h3>
            {frame?.action === null || frame?.action === undefined ? (
              <p>{REPLAY_COPY.noAction}</p>
            ) : (
              <>
                <p>{frame.action.action} · {frame.action.method} · {frame.action.outcome}
                  {frame.action.status === null ? '' : ` · ${frame.action.status}`}</p>
                <UntrustedText field="requested destination">{frame.action.destination}</UntrustedText>
                {frame.action.denial === null ? null : <p>Denied: {frame.action.denial}</p>}
                <p>Capture {frame.action.capture.toLowerCase()}
                  {frame.action.captureSuppression === null ? '' : ` · ${frame.action.captureSuppression}`}</p>
                <p>Started {utcStamp(frame.action.startedAt)}</p>
              </>
            )}
          </section>

          <section aria-labelledby="replay-observations-heading" className="ls-stack">
            <h3 id="replay-observations-heading">Observations</h3>
            {/* A count needs a frame to be counted AT. With no frame this said "0
                Observations had been registered when this frame was captured", which
                describes a frame that does not exist. */}
            <p>
              {frame === null
                ? selectionNote ?? (props.framesTotal > 0 ? 'Choose a recorded frame to see the observations registered by that moment.' : REPLAY_COPY.observationsNoFrame)
                : REPLAY_COPY.observationsThrough.replace('{count}', String(frame.observations))}
            </p>
            {/* Observations are listed on the Evidence tab, with their grounding; there is
                no Observations tab and a link to one is a Page not found. */}
            <p><Link href={`/runs/${props.runId}/evidence`}>{REPLAY_COPY.observationsLink}</Link></p>
          </section>
        </div>
      </div>

      <div className="ls-session__controls">
        <button
          type="button"
          className="ls-button ls-button--secondary ls-button--sm"
          onClick={() => { if (index >= 0) setPlaying((value) => !value); }}
          aria-disabled={index < 0 ? true : undefined}
        >{playing ? REPLAY_COPY.pause : REPLAY_COPY.play}</button>
        <span className="ls-caption">{REPLAY_COPY.keys}</span>
      </div>

      <div className="ls-session__scrubber" role="group" aria-label={REPLAY_COPY.scrubberLabel}>
        {props.frames.map((item, position) => (
          <button
            key={item.evidenceId}
            type="button"
            className={position === index ? 'ls-scrubber-pill ls-scrubber-pill--current' : 'ls-scrubber-pill'}
            aria-current={position === index ? 'true' : undefined}
            aria-label={`Frame ${item.globalOrdinal ?? position + 1} of ${inspection === null ? props.frames.length : props.framesTotal}: ${item.stepNarration}`}
            onClick={() => go(position)}
          />
        ))}
      </div>
      {props.window === undefined && props.framesTotal > props.frames.length ? (
        <p className="ls-caption">
          {REPLAY_COPY.bounded
            .replace('{shown}', String(props.frames.length))
            .replace('{total}', String(props.framesTotal))}
        </p>
      ) : null}

      {props.window === undefined ? <section aria-labelledby="replay-jump-heading" className="ls-card ls-stack">
        <h3 id="replay-jump-heading">Jump to</h3>
        {props.jumpTargets.length === 0 ? <p>{REPLAY_COPY.noJumpTargets}</p> : (
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
                    {target.absence === 'not-read' && target.workItemId !== undefined ? <> <Link href={replayInspectionHref(props.runId, target.workItemId)}>Open inspection Replay</Link></> : null}
                  </span>
                ) : (
                  <button
                    type="button"
                    className="ls-button ls-button--ghost ls-button--sm"
                    onClick={() => go(target.frameIndex)}
                  >
                    {JUMP_WORDS[target.kind]} · <span className="ls-mono">{target.label}</span>
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </section> : null}

      {props.instructions.length === 0 ? null : (
        <section aria-labelledby="replay-instructions-heading" className="ls-card ls-stack">
          <h3 id="replay-instructions-heading">Audit Instructions</h3>
          <p>The auditor&rsquo;s own words, frozen into this Procedure Version and shown verbatim (FR-8).</p>
          {props.instructions.map((instruction) => (
            <div key={instruction.system} className="ls-stack">
              <h4>{instruction.system}</h4>
              <pre className="ls-session__instruction">{instruction.text}</pre>
            </div>
          ))}
        </section>
      )}

      {props.adapterSteps.length === 0 ? null : (
        <section aria-labelledby="replay-adapter-heading" className="ls-card ls-stack">
          <h3 id="replay-adapter-heading">Adapter Session Steps</h3>
          <p>An Adapter reads without a workspace screen, so each Step is a log row with its state and its integrity digest.</p>
          <ul className="ls-session__log">
            {props.adapterSteps.map((step) => (
              <li key={step.stepId}>
                <span className="ls-mono">{step.stepId}</span>
                <span>{step.displayName}</span>
                <span>{step.state} · {step.attempts} attempts</span>
                {step.digest === null ? <span>No artifact registered.</span> : <Digest value={step.digest} label="Adapter artifact digest" />}
              </li>
            ))}
          </ul>
        </section>
      )}
    </section>
  );
}
