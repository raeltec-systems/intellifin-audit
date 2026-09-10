'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';

import { Digest } from '../design/Digest';
import { REPLAY_COPY } from '../design/copy';
import { SessionChrome, SessionStage, type LiveViewerAdapterStep, type LiveViewerFrame } from './LiveViewer';
import { UntrustedText } from './UntrustedText';
import { clampReplayIndex, type ReplayJumpTarget } from './replay';
import { utcStamp } from './labels';

/** One frame and everything the platform already stored about the action that took it. */
export interface ReplayFrameView extends LiveViewerFrame {
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
  readonly workspace: { readonly mode: string; readonly workspaceId: string | null } | null;
  readonly frames: readonly ReplayFrameView[];
  /** The exact number of frames this Run holds; larger than `frames` when the read bound. */
  readonly framesTotal: number;
  readonly plannedSteps: number | null;
  readonly stageNote: string | null;
  readonly jumpTargets: readonly ReplayJumpTarget[];
  readonly instructions: readonly { readonly system: string; readonly text: string }[];
  readonly adapterSteps: readonly LiveViewerAdapterStep[];
}

/** How long one frame is held while Replay is playing. */
const FRAME_INTERVAL_MS = 1_200;

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
 * **It starts PAUSED at the first frame** (UX-DR26). A Replay that started playing would
 * move a session under somebody who opened it to look at one thing.
 *
 * The chrome and the stage are the SAME components Live View renders, so the two surfaces
 * cannot disagree about a state dot, a workspace identity or where a frame comes from.
 */
export function ReplayViewer(props: ReplayViewerProps): React.JSX.Element {
  const [index, setIndex] = useState(() => clampReplayIndex(0, props.frames.length));
  const [playing, setPlaying] = useState(false);
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

  const counter = props.plannedSteps === null
    ? `Frame ${index + 1} of ${props.frames.length}`
    : `Frame ${index + 1} of ${props.frames.length} · ${props.plannedSteps} planned Steps`;

  return (
    <section className="ls-session" aria-labelledby="replay-session-heading">
      <h2 id="replay-session-heading" className="ls-visually-hidden">Agent session replay</h2>
      <SessionChrome
        chrome="REPLAY"
        stateSentence={props.stateSentence}
        workspace={props.workspace}
        counter={index < 0 ? 'No frames' : counter}
      />

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
          frame={frame}
          stageNote={frame === null ? props.stageNote : null}
        />

        <div className="ls-session__rail ls-stack">
          <section aria-labelledby="replay-step-heading" className="ls-stack">
            <h3 id="replay-step-heading">Step</h3>
            {frame === null ? <p>{REPLAY_COPY.noFrames}</p> : <p>{frame.stepNarration}</p>}
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
            <p>{REPLAY_COPY.observationsThrough.replace('{count}', String(frame?.observations ?? 0))}</p>
            <p><Link href={`/runs/${props.runId}/observations`}>Open the Observations tab</Link></p>
          </section>
        </div>
      </div>

      <div className="ls-session__controls">
        <button
          type="button"
          className="ls-button ls-button--secondary ls-button--sm"
          onClick={() => setPlaying((value) => !value)}
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
            aria-label={`Frame ${position + 1} of ${props.frames.length}: ${item.stepNarration}`}
            onClick={() => go(position)}
          />
        ))}
      </div>
      {props.framesTotal > props.frames.length ? (
        <p className="ls-caption">
          {REPLAY_COPY.bounded
            .replace('{shown}', String(props.frames.length))
            .replace('{total}', String(props.framesTotal))}
        </p>
      ) : null}

      <section aria-labelledby="replay-jump-heading" className="ls-card ls-stack">
        <h3 id="replay-jump-heading">Jump to</h3>
        {props.jumpTargets.length === 0 ? <p>{REPLAY_COPY.noJumpTargets}</p> : (
          <ul className="ls-session__jumps">
            {props.jumpTargets.map((target) => (
              <li key={`${target.kind}-${target.id}`}>
                {target.frameIndex === null ? (
                  // Nowhere to go, said in words. A pill that opens nothing looks
                  // exactly like one that opens the right screen.
                  <span>
                    {JUMP_WORDS[target.kind]} · <span className="ls-mono">{target.label}</span>
                    {' '}· {REPLAY_COPY.noFrameForTarget}
                  </span>
                ) : (
                  <button
                    type="button"
                    className="ls-button ls-button--ghost ls-button--sm"
                    onClick={() => go(target.frameIndex ?? 0)}
                  >
                    {JUMP_WORDS[target.kind]} · <span className="ls-mono">{target.label}</span>
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

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
