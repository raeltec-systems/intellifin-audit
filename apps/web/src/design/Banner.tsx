import type { ReactNode } from 'react';

import { Icon, type IconName } from './Icon';

export type BannerTone = 'info' | 'success' | 'warning' | 'danger';

interface BannerProps {
  readonly tone: BannerTone;
  readonly title: string;
  /**
   * Optional glyph. There is no per-tone default on purpose: every icon that would
   * suggest itself — `check-circle-2`, `alert-circle`, `alert-triangle` — is a status
   * glyph belonging to the Result outcome, Exception or Run lifecycle families, and
   * DESIGN.md's whole reason for specifying those families is that they must never be
   * read as one another. A banner announcing "Couldn't export" wearing the Control
   * Failure glyph is precisely that confusion.
   *
   * A banner does not need one: its tone is a ground colour and its meaning is the
   * title, in words, inside a live region.
   */
  readonly icon?: IconName;
  readonly children?: ReactNode;
}

/**
 * A surface-level statement of what just happened, or of what is true about this
 * surface right now (EXPERIENCE.md → Per-surface states: "The result shows as a Banner
 * on the surface the user is on").
 *
 * A destructive banner is `role="alert"` so it is announced without waiting; the others
 * are `role="status"`, which announces politely. Both are live regions, because a
 * banner that appears after an action is new content the person did not scroll to.
 */
export function Banner({ tone, title, icon, children }: BannerProps): React.JSX.Element {
  return (
    <div className={`ls-banner ls-banner--${tone}`} role={tone === 'danger' ? 'alert' : 'status'}>
      {icon ? <Icon name={icon} size={16} /> : null}
      <div>
        <p className="ls-banner__title">{title}</p>
        {children ? <div>{children}</div> : null}
      </div>
    </div>
  );
}
