'use client';

import { useEffect, useState } from 'react';

import { Tabs } from '../../src/design/Tabs';

const SECTIONS = [
  { href: '#families-heading', label: 'State families' },
  { href: '#table-heading', label: 'Data table' },
  { href: '#actions-heading', label: 'Actions' },
] as const;

const FIRST = SECTIONS[0].href;

/**
 * Tabs over the sections of this one page.
 *
 * These tabs move within a document rather than between routes, so `aria-current` is
 * `location`, not `page` — the target is an anchor, not a page — and the current tab is
 * tracked from the address hash. A `current` pinned to one constant would leave the
 * first tab marked current whichever tab was clicked, which is worse than no marking:
 * it states something untrue to exactly the people who cannot see the underline.
 */
export function SectionTabs(): React.JSX.Element {
  const [current, setCurrent] = useState<string>(FIRST);

  useEffect(() => {
    function sync(): void {
      setCurrent(window.location.hash === '' ? FIRST : window.location.hash);
    }
    sync();
    window.addEventListener('hashchange', sync);
    return () => window.removeEventListener('hashchange', sync);
  }, []);

  return (
    <Tabs
      label="Reference sections"
      tabs={SECTIONS}
      current={current}
      currentKind="location"
    />
  );
}
