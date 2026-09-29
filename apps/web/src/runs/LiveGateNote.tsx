'use client';

import { useActionGate } from '../design/action-gate';
import { LIVE_GATE_NOTE_ID, LIVE_GATE_REASONS } from './live-status';

/**
 * Why Live View's controls are withdrawn, as text a sighted reader sees (Story 10.8
 * screenshot review).
 *
 * The gate withdraws Pause, Resume, Cancel, Acquire control and the flag's submit with one
 * sentence, and each control carries that sentence as its accessible description, which
 * is visually hidden. With the flag disclosure closed, a reader met greyed controls and
 * nothing on the page saying why: the tooltip-only explanation DESIGN.md forbids ("its
 * reason is visible text … never tooltip-only"). So the reason is said once, in the page
 * header whose controls it withdraws, while the gate is closed and not a moment after.
 *
 * Only the stream's two reasons. The narrow viewport's reason IS the stage's own floor
 * sentence, which is already on the page, and a second copy of it would be the same
 * sentence twice; `runEnded` lasts the second between the terminal event and the re-read
 * that removes the live controls altogether, and the ended Banner then says it.
 */
export function LiveGateNote(): React.JSX.Element | null {
  const { disabledReason } = useActionGate();
  if (disabledReason !== LIVE_GATE_REASONS.lost && disabledReason !== LIVE_GATE_REASONS.ended) return null;
  return <p id={LIVE_GATE_NOTE_ID} className="ls-caption">{disabledReason}</p>;
}
