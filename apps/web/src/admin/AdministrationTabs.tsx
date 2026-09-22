import { Tabs } from '../design/Tabs';
import { ADMINISTRATION_TABS, ADMINISTRATION_TABS_LABEL } from './administration-words';

/**
 * The three Administration areas, as navigation (UI cleanup 2026-09-22, UX-41).
 *
 * The walkthrough found the only way to reach the sources and the systems was two links
 * inside a sentence of prose on the landing page — so an operator on the Users list had
 * to go back to find out the other two existed. They are a tabbed area now, and every
 * administration page renders this at the top.
 *
 * The labels are the breadcrumb labels package 1 set, imported rather than retyped
 * (`administration-words.test.ts` pins them against `SUBSECTION_LABELS`): a tab reading
 * "Target systems" over a crumb reading "Systems" is two names for one place.
 *
 * `Tabs` renders links in a `<nav>` with `aria-current`, never `role="tab"` — each area
 * is its own route, and a tablist with no tabpanel announces a widget the page does not
 * have.
 *
 * `current` is the AREA's href, not the pathname: a detail page under one of them is
 * still inside that area, and a tab bar with nothing marked on a system's own page would
 * tell a reader they had left Administration. The landing passes nothing, because the
 * landing is the parent of all three and is not one of them.
 */
export function AdministrationTabs({
  current = '',
}: {
  /** The area this page belongs to, or nothing on the landing. */
  readonly current?: string;
}): React.JSX.Element {
  return (
    <Tabs label={ADMINISTRATION_TABS_LABEL} tabs={[...ADMINISTRATION_TABS]} current={current} />
  );
}
