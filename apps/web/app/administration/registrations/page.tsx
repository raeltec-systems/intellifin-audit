import type { Metadata } from 'next';

import {
  DrizzleRegistrationRepository,
  REGISTRATION_LIST_LIMIT,
} from '@intellifin/infrastructure';

import { RegistrationsPanel } from '../../../src/admin/RegistrationsPanel';
import { Banner } from '../../../src/design/Banner';
import { getRuntime } from '../../../src/bootstrap';
import { requireServerAction } from '../../../src/server-session';
import { createRegistrationAction } from './actions';

export const metadata: Metadata = {
  title: 'Target System registrations · IntelliFin Audit',
};

/** The role is read per request; this surface can never be cached (AD-7). */
export const dynamic = 'force-dynamic';

/**
 * Administration — Target System registrations (FR-8, AD-2, AD-10).
 *
 * The sidebar shows Administration to a PoC Administrator only, and that is
 * presentation: anybody can type this path. So the surface asks the audited
 * authorization path, which resolves the role fresh from `user_role`, applies the pure
 * domain policy, and appends the refusal to the audit chain before returning it.
 *
 * On refusal the page renders the reason and NOTHING else — no table, no form, not one
 * origin, credential reference or digest.
 *
 * This page reads. It never contacts a Target System: the connectivity column comes from
 * rows the worker writes, and `pnpm boundaries` fails the build if anything under
 * `apps/` so much as reaches the probe module.
 */
export default async function RegistrationsPage(): Promise<React.JSX.Element> {
  const decision = await requireServerAction('administration.registrations.manage');

  if (!decision.allowed) {
    return (
      <div className="ls-stack">
        <h1>Target System registrations</h1>
        <Banner tone="danger" title={decision.reason} />
      </div>
    );
  }

  const runtime = await getRuntime();
  const registrations = await new DrizzleRegistrationRepository(
    runtime.db,
    REGISTRATION_LIST_LIMIT,
  ).listRegistrations();

  return (
    <div className="ls-stack">
      <header className="ls-page-header">
        <h1>Target System registrations</h1>
        <p>
          Every system the agent may read, the read actions it is permitted, and the
          digest a Procedure Version freezes. Credentials must be read-only, and their
          secrets never enter this application.
        </p>
      </header>
      <RegistrationsPanel
        registrations={registrations}
        limit={REGISTRATION_LIST_LIMIT}
        createRegistration={createRegistrationAction}
      />
    </div>
  );
}
