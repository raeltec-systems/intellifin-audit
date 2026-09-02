import type { ReactNode } from 'react';

import { Icon, type IconName } from './Icon';

export type BannerTone = 'info' | 'success' | 'warning' | 'danger';

interface BannerProps {
  readonly tone: BannerTone;
  readonly title: string;
  readonly children?: ReactNode;
}

/** The icon each tone carries. Tone is never the only signal: the title says it too. */
const TONE_ICON: Readonly<Record<BannerTone, IconName>> = {
  info: 'info',
  success: 'check-circle-2',
  warning: 'alert-triangle',
  danger: 'alert-circle',
};

/**
 * A surface-level statement of what just happened, or of what is true about this
 * surface right now (EXPERIENCE.md → Per-surface states: "The result shows as a Banner
 * on the surface the user is on").
 *
 * A destructive banner is `role="alert"` so it is announced without waiting; the others
 * are `role="status"`, which announces politely. Both are live regions, because a
 * banner that appears after an action is new content the person did not scroll to.
 */
export function Banner({ tone, title, children }: BannerProps): React.JSX.Element {
  return (
    <div
      className={`ls-banner ls-banner--${tone}`}
      role={tone === 'danger' ? 'alert' : 'status'}
    >
      <Icon name={TONE_ICON[tone]} size={16} />
      <div>
        <p className="ls-banner__title">{title}</p>
        {children ? <div>{children}</div> : null}
      </div>
    </div>
  );
}
