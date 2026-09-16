import type { RunStopFacts } from '@intellifin/infrastructure';

import { Banner } from '../design/Banner';
import { STOP_REASON_TITLE, stopReason } from './stop-reason';

/**
 * The stop reason under a Runs-list outcome badge: one caption line, or nothing at all
 * for a Run that has not stopped. Nothing here decides the words — `stopReason` does, so
 * the list and the header cannot disagree.
 */
export function StopReasonNote({ facts }: { readonly facts: RunStopFacts }): React.JSX.Element | null {
  const sentence = stopReason(facts);
  return sentence === null ? null : <p className="ls-caption ls-stop-reason">{sentence}</p>;
}

/**
 * The stop reason on Run Detail, on every tab, as the same warning Banner the cancellation
 * state uses: a Run that stopped before it concluded is a state of the Run, and a state is
 * said above the tabs rather than found under one of them.
 */
export function StopReasonBanner({ facts }: { readonly facts: RunStopFacts }): React.JSX.Element | null {
  const sentence = stopReason(facts);
  if (sentence === null) return null;
  return (
    <Banner tone="warning" title={STOP_REASON_TITLE}>
      <p>{sentence}</p>
    </Banner>
  );
}
