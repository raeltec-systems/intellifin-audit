import type { Metadata } from 'next';

import { Banner } from '../../src/design/Banner';
import { EmptyState } from '../../src/design/EmptyState';
import { requireServerAction } from '../../src/server-session';

export const metadata: Metadata = { title: 'Administration · IntelliFin Audit' };

/** The role is read per request; this surface can never be cached (AD-7). */
export const dynamic = 'force-dynamic';

/**
 * Administration — the first production caller of `requireAction`.
 *
 * The sidebar removes this item for everybody but a PoC Administrator, and that removal
 * is presentation: anybody can type the path. So the surface itself asks the audited
 * authorization path, which resolves the role fresh from `user_role`, applies the pure
 * domain policy, and appends the refusal to the audit chain before returning it.
 *
 * On refusal the page renders the reason and NOTHING else — no headings, no counts, no
 * "you could ask an administrator for X" that discloses what X is.
 */
export default async function AdministrationPage(): Promise<React.JSX.Element> {
  const decision = await requireServerAction('administration.users.manage');

  if (!decision.allowed) {
    return (
      <div className="ls-stack">
        <h1>Administration</h1>
        <Banner tone="danger" title={decision.reason} />
      </div>
    );
  }

  return (
    <div className="ls-stack">
      <header className="ls-page-header">
        <h1>Administration</h1>
        <p>
          Users and roles, Target System registrations, Population Source bindings, and
          platform diagnostics.
        </p>
      </header>
      <EmptyState
        icon="settings"
        headline="Nothing is registered yet."
        sentence="Users, Target System registrations, and Population Source bindings would be listed here. Managing them is not part of this release."
      />
    </div>
  );
}
