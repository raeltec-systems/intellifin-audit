'use client';

import { createContext, useContext, useRef, useState } from 'react';

import { EndedBanner } from './LiveViewer';
import { LiveBannerView, useThrottledRefresh } from './LiveBanner';
import { LIVE_GATE_REASONS, isRunEndingEvent, liveGateReason, type LiveGateReason } from './live-status';
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

export interface LiveGateState {
  /** `null` when the controls may be used. */
  readonly reason: LiveGateReason | null;
  /** The sentence a disabled control shows, or `null` when it is not disabled. */
  readonly disabledReason: string | null;
}

const OPEN: LiveGateState = { reason: null, disabledReason: null };

const LiveGateContext = createContext<LiveGateState>(OPEN);

/**
 * What the surface's live channel permits right now.
 *
 * Outside a `LiveGate` this is OPEN, which is the truth: a surface with no live channel
 * makes no claim about being live, so it has nothing to withdraw.
 */
export function useLiveGate(): LiveGateState {
  return useContext(LiveGateContext);
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
      <LiveGateContext.Provider value={{ reason: 'runEnded', disabledReason: LIVE_GATE_REASONS.runEnded }}>
        <EndedBanner runId={runId} state={state} />
        {children}
      </LiveGateContext.Provider>
    )
    : <SubscribedGate url={url} cursor={cursor} readAt={readAt} href={href}>{children}</SubscribedGate>;
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
  const reason = liveGateReason(live.status, runEnded);
  return (
    <LiveGateContext.Provider
      value={reason === null ? OPEN : { reason, disabledReason: LIVE_GATE_REASONS[reason] }}
    >
      <LiveBannerView status={live.status} silence={live.silence} lastSeq={live.lastSeq} readAt={readAt} href={href} />
      {children}
    </LiveGateContext.Provider>
  );
}
