'use client';

import { useId, useState } from 'react';

import { EmptyState } from '../design/EmptyState';
import { Icon } from '../design/Icon';

interface NotificationBellProps {
  /**
   * Unread Awaiting Auditor and flagged Runs. A typed input, not a query: the shell
   * shows a count somebody else counted. Absent or zero shows no count at all, because
   * EXPERIENCE.md forbids showing a count before it is known.
   */
  readonly unread?: number | undefined;
}

/**
 * The top-bar bell, with its unread count in `{components.status-badge-info-solid}`.
 *
 * The top bar carries this and nothing else. The prototype's "Signed in as" switcher is
 * disclaimed there as a prototype affordance, and a role switcher would contradict AD-7
 * outright — the role comes from the session on the server, never from a control.
 *
 * The panel holds the Notifications empty state until the Notifications surface exists.
 * A bell that opens nothing would be a control that lies about being one.
 */
export function NotificationBell({ unread }: NotificationBellProps): React.JSX.Element {
  const panelId = useId();
  const [open, setOpen] = useState(false);
  const count = unread !== undefined && unread > 0 ? unread : null;

  return (
    <div className="ls-bell-wrap">
      <button
        type="button"
        className="ls-bell"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((current) => !current)}
      >
        <Icon name="bell" size={18} />
        <span className="ls-visually-hidden">Notifications</span>
        {count === null ? null : (
          <span className="ls-bell__count">
            {count}
            <span className="ls-visually-hidden"> unread</span>
          </span>
        )}
      </button>
      <div className="ls-bell-panel" id={panelId} hidden={!open}>
        {open ? (
          <EmptyState
            icon="bell"
            headline="No Run is waiting on you."
            sentence="A Run waiting for an answer, or one flagged to an Audit Manager, appears here with the time remaining."
          />
        ) : null}
      </div>
    </div>
  );
}
