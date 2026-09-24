'use client';

import { createContext, useContext, useState, type ReactNode } from 'react';

import { Banner, type BannerTone } from '../design/Banner';

/** What an answered Escalation says, and which question it answered. */
export interface EscalationOutcome {
  readonly waitId: string;
  readonly tone: BannerTone;
  readonly title: string;
  readonly body?: string;
}

const OutcomeContext = createContext<((outcome: EscalationOutcome) => void) | null>(null);

/**
 * Where the Escalation panel reports an answer that committed, or `null` outside a host.
 *
 * A panel with no host keeps the confirmation itself, which is what an SSR test renders.
 */
export function useEscalationOutcome(): ((outcome: EscalationOutcome) => void) | null {
  return useContext(OutcomeContext);
}

/**
 * The confirmation to show, if any.
 *
 * Shown while its own question is still on the page (before the refresh lands) and after no
 * question is open; hidden once a DIFFERENT one opens, because "Escalation answered."
 * above a new, unanswered Escalation would read as an answer to that one.
 */
export function visibleOutcome(outcome: EscalationOutcome | null, openWaitId: string | null): EscalationOutcome | null {
  if (outcome === null) return null;
  return openWaitId === null || openWaitId === outcome.waitId ? outcome : null;
}

/**
 * Keeps an answered Escalation's confirmation on the page after the panel is gone.
 *
 * The panel asks for a refresh the moment an answer commits, and the refreshed page has no
 * open question, so the panel — and a confirmation rendered inside it — is removed within
 * a few hundred milliseconds. Nobody could read "Escalation answered." and a screen reader
 * could miss it. This host is rendered in the same place whether or not a question is
 * open, so React keeps its state through `router.refresh()` and the confirmation stays
 * until the reader leaves the page ({@link visibleOutcome} says when it steps aside).
 */
export function EscalationOutcomeHost({
  openWaitId,
  children,
}: {
  /** The open Escalation this page shows, or `null` when none is open. */
  readonly openWaitId: string | null;
  readonly children?: ReactNode;
}): React.JSX.Element {
  const [outcome, setOutcome] = useState<EscalationOutcome | null>(null);
  const shown = visibleOutcome(outcome, openWaitId);
  return (
    <OutcomeContext.Provider value={setOutcome}>
      {shown === null ? null : (
        <div data-escalation-outcome>
          <Banner tone={shown.tone} title={shown.title}>{shown.body ? <p>{shown.body}</p> : null}</Banner>
        </div>
      )}
      {children}
    </OutcomeContext.Provider>
  );
}
