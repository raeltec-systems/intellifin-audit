import Link from 'next/link';

import { Banner } from '../design/Banner';
import { Digest } from '../design/Digest';
import { CAPTURE_TIME_UNRECORDED, LIVE_VIEW_DESKTOP_ONLY_SENTENCE, SESSION_ISOLATION_NOTE } from '../design/copy';
import { EvidenceKindBadge } from './MinorBadge';
import { UntrustedText } from './UntrustedText';
import { chromeDotClass, type LiveViewChrome } from './live-view';
import { evidenceKindWord, utcStamp, workspaceModeWord } from './labels';

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

export interface LiveViewerAdapterStep {
  readonly stepId: string;
  readonly displayName: string;
  readonly state: string;
  readonly attempts: number;
  readonly digest: string | null;
}

export interface LiveViewerProps {
  readonly runId: string;
  /** `null` when the Run has no session yet — a Queued Run, which says so in words. */
  readonly chrome: LiveViewChrome | null;
  /** What the chrome says out loud when a screen reader reaches it. */
  readonly stateSentence: string;
  readonly workspace: { readonly mode: string; readonly workspaceId: string | null; readonly status: string } | null;
  readonly stepsStarted: number;
  readonly plannedSteps: number | null;
  readonly frame: LiveViewerFrame | null;
  /** Why there is no frame, in words. Never an empty stage with nothing said. */
  readonly stageNote: string | null;
  readonly step: LiveViewerStep | null;
  readonly workItem: LiveViewerWorkItem | null;
  readonly observations: number;
  readonly evidence: readonly LiveViewerEvidence[];
  readonly instructions: readonly { readonly system: string; readonly text: string }[];
  readonly adapterSteps: readonly LiveViewerAdapterStep[];
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
  const counter = props.plannedSteps === null
    ? `Step ${props.stepsStarted}`
    : `Step ${props.stepsStarted} of ${props.plannedSteps}`;
  return (
    <section className="ls-session" aria-labelledby="live-session-heading">
      <h2 id="live-session-heading" className="ls-visually-hidden">Agent session</h2>
      <div className="ls-session__chrome">
        {/* The state is announced; the dot and word are the same fact for everyone else,
            so they are hidden from the reader that already heard the sentence. */}
        <span className="ls-visually-hidden" aria-live="polite">{props.stateSentence}</span>
        <span className="ls-session__state" aria-hidden="true">
          <span className={props.chrome === null ? 'ls-session__dot ls-session__dot--none' : chromeDotClass(props.chrome)} />
          {props.chrome ?? 'NO SESSION'}
        </span>
        <span className="ls-session__workspace">
          {props.workspace === null
            ? 'No Agent Workspace'
            : `${workspaceModeWord(props.workspace.mode)}${props.workspace.workspaceId === null ? '' : ` · ${props.workspace.workspaceId}`}`}
        </span>
        <span className="ls-session__note">{SESSION_ISOLATION_NOTE}</span>
        <span className="ls-session__counter">{counter}</span>
      </div>

      <p className="ls-session-desktop-only">{LIVE_VIEW_DESKTOP_ONLY_SENTENCE}</p>

      <div className="ls-session__body">
        <div className="ls-session__stage">
          {props.frame === null ? (
            <p className="ls-session__stage-note">{props.stageNote}</p>
          ) : (
            <figure className="ls-session__figure">
              {/* A registered artifact's bytes never change, so the route answers a strong
                  ETag and the browser may revalidate rather than re-read the store. */}
              <img
                className="ls-session__frame"
                src={`/api/runs/${props.runId}/frames/${props.frame.evidenceId}`}
                alt={props.frame.narration}
                decoding="async"
              />
              <figcaption className="ls-session__caption">
                <UntrustedText field="captured page location">{props.frame.sourceLocation}</UntrustedText>
                <span>
                  {props.frame.capturedAt === null ? CAPTURE_TIME_UNRECORDED : `Captured ${utcStamp(props.frame.capturedAt)}`}
                </span>
                <Digest value={props.frame.digest} label="frame integrity digest" />
              </figcaption>
            </figure>
          )}
        </div>

        <div className="ls-session__rail ls-stack">
          <section aria-labelledby="live-step-heading" className="ls-stack">
            <h3 id="live-step-heading">Current Step</h3>
            {props.step === null ? (
              <p>No Step Execution has started yet.</p>
            ) : (
              <>
                <p>{props.step.narration}</p>
                <p>
                  {props.step.state} · attempt {props.step.attempt}
                </p>
                {props.step.diagnostic === null ? null : (
                  <UntrustedText field="Step Execution diagnostic">{props.step.diagnostic}</UntrustedText>
                )}
              </>
            )}
          </section>

          <section aria-labelledby="live-work-item-heading" className="ls-stack">
            <h3 id="live-work-item-heading">Work Item</h3>
            {props.workItem === null ? (
              <p>No Work Item is being worked yet.</p>
            ) : (
              <p>
                {props.workItem.displayName}
                {props.workItem.subjectKey === null ? '' : ` · ${props.workItem.subjectKey}`} · {props.workItem.state} ·{' '}
                {props.workItem.observations} Observations
              </p>
            )}
            <p>{props.observations} Observations registered in this Run so far.</p>
          </section>

          <section aria-labelledby="live-evidence-heading" className="ls-stack">
            <h3 id="live-evidence-heading">Evidence as registered</h3>
            {props.evidence.length === 0 ? (
              <p>No Evidence has been registered yet.</p>
            ) : (
              <ul className="ls-session__evidence">
                {props.evidence.map((item) => (
                  <li key={item.evidenceId}>
                    <EvidenceKindBadge kind={item.kind} />
                    <span>{evidenceKindWord(item.kind)}</span>
                    {item.digest === null ? <span>No digest recorded.</span> : <Digest value={item.digest} label="Evidence integrity digest" />}
                    <span>{item.capturedAt === null ? CAPTURE_TIME_UNRECORDED : utcStamp(item.capturedAt)}</span>
                  </li>
                ))}
              </ul>
            )}
            <p>
              <Link href={`/runs/${props.runId}/evidence`}>Open the Evidence tab</Link>
            </p>
          </section>
        </div>
      </div>

      {props.instructions.length === 0 ? null : (
        <section aria-labelledby="live-instructions-heading" className="ls-card ls-stack">
          <h3 id="live-instructions-heading">Audit Instructions</h3>
          <p>
            The auditor&rsquo;s own words, frozen into this Procedure Version and shown verbatim (FR-8).
          </p>
          {props.instructions.map((instruction) => (
            <div key={instruction.system} className="ls-stack">
              <h4>{instruction.system}</h4>
              <pre className="ls-session__instruction">{instruction.text}</pre>
            </div>
          ))}
        </section>
      )}

      {props.adapterSteps.length === 0 ? null : (
        <section aria-labelledby="live-adapter-heading" className="ls-card ls-stack">
          <h3 id="live-adapter-heading">Adapter Session Steps</h3>
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
