import type { ReactNode } from 'react';

/**
 * A page header that spends one row on the title (UI cleanup 2026-09-21, UX-08, UX-23,
 * UX-48).
 *
 * The walkthrough measured the Run header at nearly half a laptop viewport: a title, a
 * paragraph of links, a period line, a badge and a full-width banner, each on its own
 * row, before the tabs. This puts the badge on the title's row, the actions on its right,
 * and one meta line under it. The `lede` — a sentence explaining the surface — is for a
 * list page a person has never seen; a detail page has a name and needs none.
 */
export function PageHeader({
  title,
  badge,
  actions,
  meta,
  lede,
  children,
}: {
  readonly title: ReactNode;
  /** A status badge, rendered on the title's own row. */
  readonly badge?: ReactNode;
  /** Controls that belong to the whole page, right-aligned on the title's row. */
  readonly actions?: ReactNode;
  /** One line of facts about the thing named: links, period, when it started. */
  readonly meta?: ReactNode;
  /** One sentence for a surface that needs explaining. */
  readonly lede?: ReactNode;
  readonly children?: ReactNode;
}): React.JSX.Element {
  return (
    <header className="ls-page-header">
      <div className="ls-page-header__row">
        <div className="ls-page-header__title">
          <h1>{title}</h1>
          {badge ?? null}
        </div>
        {actions === undefined || actions === null ? null : (
          <div className="ls-page-header__actions ls-actions">{actions}</div>
        )}
      </div>
      {meta === undefined || meta === null ? null : <p className="ls-page-header__meta">{meta}</p>}
      {lede === undefined || lede === null ? null : <p>{lede}</p>}
      {children}
    </header>
  );
}
