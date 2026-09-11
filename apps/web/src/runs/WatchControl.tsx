import Link from 'next/link';

import { Button } from '../design/Button';
import { UnavailableActions } from '../design/UnavailableActions';
import { LIVE_VIEW_QUEUED_SENTENCE } from '../design/copy';

const WATCH_REASON_ID = 'run-watch-unavailable';

/**
 * The Watch control on Run Detail (EXPERIENCE.md → Per-surface states, Run Detail rows).
 *
 * Running says `"Watch" in rail`; Queued says `Watch disabled with "Live View opens when
 * the Run starts."` — so this is one control in two states, decided on the server from
 * the Run state, and the disabled state keeps its position with its reason in the panel
 * rather than in a tooltip.
 *
 * A terminal Run gets REPLAY instead (Story 5.8). It is the same control in the rail's
 * Session slot and it changes its NAME rather than its destination-with-a-different-word:
 * a control labelled Watch that opened a page saying the Run is over would name the wrong
 * thing, which is why it rendered nothing at all until the Replay surface existed.
 */
export function WatchControl({
  runId,
  state,
  active,
}: {
  readonly runId: string;
  readonly state: string;
  readonly active: boolean;
}): React.JSX.Element | null {
  // The terminal session. EXPERIENCE.md reaches Replay from `Run Detail (terminal Run)`,
  // and a Run that is neither active nor terminal does not exist.
  if (!active) {
    return (
      <div className="ls-actions">
        <Link className="ls-button ls-button--secondary ls-button--md" href={`/runs/${runId}/replay`}>
          Replay
        </Link>
      </div>
    );
  }
  if (state === 'QUEUED') {
    return (
      <div className="ls-stack">
        <div className="ls-actions">
          {/* `Button` has no silent `disabled`: supplying the reason is what disables
              it, and `disabledReasonId` points its accessible description at the very
              sentence the panel below shows. */}
          <Button
            variant="secondary"
            disabledReason={LIVE_VIEW_QUEUED_SENTENCE}
            disabledReasonId={WATCH_REASON_ID}
          >
            Watch
          </Button>
        </div>
        <UnavailableActions
          headingLevel={2}
          actions={[{ id: WATCH_REASON_ID, label: 'Watch', reason: LIVE_VIEW_QUEUED_SENTENCE }]}
        />
      </div>
    );
  }
  // A link, not a button: opening Live View changes nothing, and a link works with no
  // JavaScript at all — the rule every control that must not depend on hydration follows.
  return (
    <div className="ls-actions">
      <Link className="ls-button ls-button--secondary ls-button--md" href={`/runs/${runId}/live`}>
        Watch
      </Link>
    </div>
  );
}
