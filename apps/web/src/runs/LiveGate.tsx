'use client';

import { useEffect, useRef, useState } from 'react';

import { ACTION_GATE_OPEN, ActionGateProvider, useActionGate, type ActionGateState } from '../design/action-gate';
import { EndedBanner } from './LiveViewer';
import { LiveBannerView, useThrottledRefresh } from './LiveBanner';
import { LIVE_GATE_REASONS, isRunEndingEvent, liveGateReason } from './live-status';
import { useLiveTimeline } from './useLiveTimeline';

/**
 * Live View's one subscription, and the gate over its controls (Story 5.7, UX-DR25).
 *
 * **One `EventSource` for the surface.** The banner and every control need the same
 * answer to "is this page still being told what the Run is doing", and two subscriptions
 * would be two silence clocks, two reconnects and two cursors — which is how a page ends
 * up disagreeing with itself. So the subscription lives here, the banner became a view
 * this renders, and the controls read the verdict through context.
 *
 * **A control that is not gated is the default.** `useLiveGate` returns "open" when there
 * is no provider, so Run Detail — which carries the same Pause, Resume and Cancel
 * components and is not a live-supervision surface — is unchanged. The gate is Live
 * View's, because UX-DR25's rule is Live View's.
 *
 * **A terminal Run needs no stream and gets no banner from here.** `cursor === null` is
 * the server saying the Run has already ended: there is nothing to subscribe to, the
 * ended Banner names the terminal state and links to Run Detail, and every control is
 * closed for the reason that is true.
 */

/**
 * The gate's own state IS the design system's `ActionGateState` (PR 29 review).
 *
 * It used to be a context private to this file, which is why `ConfirmDialog` — the
 * component every confirmation goes through — could not read it: a dialog opened while
 * the stream was live kept its Confirm button working after the gate had closed behind
 * it. One context, in the design layer, closes that window for every dialog at once
 * rather than for the three that remembered to ask.
 */
export type LiveGateState = ActionGateState;

/**
 * What the surface's live channel permits right now.
 *
 * Outside a `LiveGate` this is OPEN, which is the truth: a surface with no live channel
 * makes no claim about being live, so it has nothing to withdraw.
 */
export function useLiveGate(): LiveGateState {
  return useActionGate();
}

/** EXPERIENCE.md's responsive floor for Live View: below this it is read-only. */
export const LIVE_VIEW_DESKTOP_MIN_PX = 1024;

/**
 * Whether this page is on a viewport the contract permits supervision from.
 *
 * It starts TRUE — the server cannot know a viewport, and starting withdrawn would break
 * a guarantee this product already ships: Flag is the one control here with no
 * confirmation dialog and therefore the one that works with no JavaScript at all
 * (`flag-run.spec.ts` proves it with `javaScriptEnabled: false`). A gate that closed on
 * the server would disable it permanently for a reader who has script off, on a desktop,
 * which is worse than the case it was closing.
 *
 * So this is the same shape the rest of the gate already has: with no script there is no
 * gate, and what actually refuses a stale or out-of-scope action is the command. The
 * media query is read one tick after mount and re-read whenever it changes, so a phone
 * with script loses its controls immediately and a rotating tablet needs no reload.
 * Server render and first client render agree, so there is no hydration mismatch.
 */
export function useDesktopViewport(): boolean {
  const [desktop, setDesktop] = useState(true);
  useEffect(() => {
    const query = window.matchMedia(`(min-width: ${LIVE_VIEW_DESKTOP_MIN_PX}px)`);
    const read = (): void => { setDesktop(query.matches); };
    read();
    query.addEventListener('change', read);
    return () => { query.removeEventListener('change', read); };
  }, []);
  return desktop;
}

export function LiveGate({
  runId,
  state,
  url,
  cursor,
  readAt,
  href,
  children,
}: {
  readonly runId: string;
  /** The Run state the server read, for the ended Banner's own sentence. */
  readonly state: string;
  readonly url: string;
  /** The chain head this page was rendered at, or `null` when the Run has already ended. */
  readonly cursor: number | null;
  readonly readAt: string;
  readonly href: string;
  readonly children: React.ReactNode;
}): React.JSX.Element {
  return cursor === null
    ? (
      <TerminalGate runId={runId} state={state}>{children}</TerminalGate>
    )
    : <SubscribedGate url={url} cursor={cursor} readAt={readAt} href={href}>{children}</SubscribedGate>;
}

/**
 * A Run that has already ended: no stream to lose, and the controls are closed from the
 * first render. The viewport still outranks it, so a phone is told the reason that is
 * actionable ("open on a desktop") rather than one that is not.
 */
function TerminalGate({
  runId, state, children,
}: {
  readonly runId: string;
  readonly state: string;
  readonly children: React.ReactNode;
}): React.JSX.Element {
  const desktop = useDesktopViewport();
  return (
      <ActionGateProvider
        value={{ disabledReason: desktop ? LIVE_GATE_REASONS.runEnded : LIVE_GATE_REASONS.viewport }}
      >
      <EndedBanner runId={runId} state={state} />
      {children}
    </ActionGateProvider>
  );
}

function SubscribedGate({
  url, cursor, readAt, href, children,
}: {
  readonly url: string;
  readonly cursor: number;
  readonly readAt: string;
  readonly href: string;
  readonly children: React.ReactNode;
}): React.JSX.Element {
  const refresh = useThrottledRefresh();
  // Latched, never cleared. A Run that has ended does not start again, and the next
  // server read removes the controls anyway; what this closes is the second between the
  // terminal event arriving and that read landing.
  const [runEnded, setRunEnded] = useState(false);
  const ended = useRef(false);
  const live = useLiveTimeline(url, cursor, (event) => {
    if (isRunEndingEvent(event.eventType) && !ended.current) { ended.current = true; setRunEnded(true); }
    refresh();
  });
  const desktop = useDesktopViewport();
  const reason = liveGateReason(live.status, runEnded, desktop);
  return (
    <ActionGateProvider
      value={reason === null ? ACTION_GATE_OPEN : { disabledReason: LIVE_GATE_REASONS[reason] }}
    >
      <LiveBannerView status={live.status} silence={live.silence} lastSeq={live.lastSeq} readAt={readAt} href={href} />
      {children}
    </ActionGateProvider>
  );
}
