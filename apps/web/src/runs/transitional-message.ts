import { useState } from 'react';

/**
 * A control's transitional message, kept only while the Run state it was written about
 * still holds (UI cleanup 2026-09-22, UX-49).
 *
 * "Pause requested." stayed on the page beside a CONFIRMED "Paused by …" banner: the
 * message was component state, and nothing told it that the transition it announced had
 * since settled. The server re-read that settled it says what is now true in its own
 * banner, so the control's sentence is at best a duplicate and at worst — as there — a
 * claim about a state the Run has already left.
 *
 * The rule is keyed on the SETTLED facts the server read (for Pause: `paused` and
 * `pausePending`; for Cancel: `cancelPending`). A message is stored with the key of the
 * render it was written in, and the first render whose key differs drops it. A refusal
 * whose Run state did not move keeps its message, because nothing has settled it.
 */
export interface TransitionalMessageState<M> {
  readonly key: string;
  readonly message: M | null;
}

/** The pure half of the rule, so it can be proven without a browser. */
export function settleMessage<M>(state: TransitionalMessageState<M>, key: string): TransitionalMessageState<M> {
  if (state.key === key) return state;
  return { key, message: null };
}

/**
 * `useState` for a message, with the settle rule applied during render — React's own
 * "adjust state when a prop changes" pattern, so there is no effect that paints the stale
 * message for one frame before removing it.
 */
export function useTransitionalMessage<M>(settledKey: string): readonly [M | null, (message: M | null) => void] {
  const [state, setState] = useState<TransitionalMessageState<M>>({ key: settledKey, message: null });
  const settled = settleMessage(state, settledKey);
  if (settled !== state) setState(settled);
  // The functional update keeps the key the state already carries, which the adjustment
  // above keeps equal to the key of the latest render: a message written after an action
  // resolves belongs to the state the page was showing when it resolved.
  const set = (message: M | null): void => { setState((previous) => ({ key: previous.key, message })); };
  return [settled.message, set] as const;
}
