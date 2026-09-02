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
export function Tabs({ label, tabs, current }: TabsProps): React.JSX.Element {
  return (
    <nav className="ls-tabs" aria-label={label}>
      <ul>
        {tabs.map((tab) => (
          <li key={tab.href}>
            <a
              className="ls-tab"
              href={tab.href}
              aria-current={tab.href === current ? 'page' : undefined}
            >
              {tab.label}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}
