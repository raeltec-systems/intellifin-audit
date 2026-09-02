import Link from 'next/link';

interface Tab {
  readonly href: string;
  readonly label: string;
}

interface TabsProps {
  /** Names what this set of tabs navigates, for the landmark. */
  readonly label: string;
  readonly tabs: readonly Tab[];
  /** The href of the tab currently shown. */
  readonly current: string;
  /**
   * What "current" means here. `page` for tabs that navigate between routes — the Run
   * Detail tabs. `location` for tabs that move within one document, where `page` would
   * be a lie: the anchor is not a page.
   */
  readonly currentKind?: 'page' | 'location';
}

/**
 * Tabs at `{spacing.tabs}`.
 *
 * These are navigation, not a widget: EXPERIENCE.md makes the Run Detail tabs the
 * navigation between sub-surfaces ("No cell is clickable; the tabs are the navigation"),
 * each of which is its own route. So they are links in a `<nav>` marked `aria-current`,
 * not `role="tab"` — a tablist with no tabpanel beside it is a broken ARIA pattern that
 * announces a widget the page does not have.
 */
export function Tabs({
  label,
  tabs,
  current,
  currentKind = 'page',
}: TabsProps): React.JSX.Element {
  return (
    <nav className="ls-tabs" aria-label={label}>
      <ul>
        {tabs.map((tab) => {
          const isCurrent = tab.href === current;
          const content = tab.label;
          return (
            <li key={tab.href}>
              {tab.href.startsWith('#') ? (
                // A raw anchor: an in-document fragment navigates nowhere, so routing
                // it through the client router would be a round trip to the same page.
                <a
                  className="ls-tab"
                  href={tab.href}
                  aria-current={isCurrent ? currentKind : undefined}
                >
                  {content}
                </a>
              ) : (
                <Link
                  className="ls-tab"
                  href={tab.href}
                  aria-current={isCurrent ? currentKind : undefined}
                >
                  {content}
                </Link>
              )}
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
