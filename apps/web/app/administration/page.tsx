import type { Metadata } from 'next';

import {
  BINDING_LIST_LIMIT,
  DrizzleBindingRepository,
  DrizzleRegistrationRepository,
  DrizzleUserDirectory,
  REGISTRATION_LIST_LIMIT,
  USER_LIST_LIMIT,
} from '@intellifin/infrastructure';

import { AdministrationSummary } from '../../src/admin/AdministrationSummary';
import { AdministrationTabs } from '../../src/admin/AdministrationTabs';
import { ADMINISTRATION_LEDE } from '../../src/admin/administration-words';
import { Banner } from '../../src/design/Banner';
import { PageHeader } from '../../src/design/PageHeader';
import { getRuntime } from '../../src/bootstrap';
import { requireServerAction } from '../../src/server-session';

export const metadata: Metadata = { title: 'Administration · IntelliFin Audit' };

/** The role is read per request; this surface can never be cached (AD-7). */
export const dynamic = 'force-dynamic';

/**
 * Administration — the operator's summary (UI cleanup 2026-09-22, UX-37, UX-41).
 *
 * The sidebar removes this item for everybody but a PoC Administrator, and that removal
 * is presentation: anybody can type the path. So the surface itself asks the audited
 * authorization path, which resolves the role fresh from `user_role`, applies the pure
 * domain policy, and appends the refusal to the audit chain before returning it.
 *
 * On refusal the page renders the reason and NOTHING else — no headings, no counts, no
 * tab bar naming areas a refused caller may not reach.
 *
 * This page used to be the user list with the other two areas linked from a sentence of
 * prose. It is the parent of all three now: each one's exact total, four configuration
 * health lines, and the tabs. The Users directory moved to `/administration/users`,
 * which is the breadcrumb label package 1 already registered for it.
 *
 * Six `count(*)` reads, no list. A total taken from a bounded list reports the list limit
 * once a deployment passes it, which is the one number on this page nobody would check.
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

  const runtime = await getRuntime();
  const users = new DrizzleUserDirectory(runtime.db, USER_LIST_LIMIT);
  const sources = new DrizzleBindingRepository(runtime.db, BINDING_LIST_LIMIT);
  const systems = new DrizzleRegistrationRepository(runtime.db, REGISTRATION_LIST_LIMIT);

  const [
    userTotal,
    usersWithoutRole,
    administrators,
    sourceTotal,
    sourcesWithoutConfirmedCount,
    systemTotal,
    systemsNeverChecked,
  ] = await Promise.all([
    users.countUsers(),
    users.countUsers({ role: 'none' }),
    users.countUsers({ role: 'poc-administrator' }),
    sources.countBindings(),
    sources.countBindings({ declaredCountMechanism: 'none' }),
    systems.countRegistrations(),
    systems.countRegistrations({ connectivity: 'never-probed' }),
  ]);

  return (
    <div className="ls-stack">
      <PageHeader title="Administration" lede={ADMINISTRATION_LEDE} />
      <AdministrationTabs />
      <AdministrationSummary
        totals={{
          users: userTotal,
          usersWithoutRole,
          administrators,
          sources: sourceTotal,
          sourcesWithoutConfirmedCount,
          systems: systemTotal,
          systemsNeverChecked,
        }}
      />
    </div>
  );
}
