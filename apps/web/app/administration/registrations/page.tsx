import type { Metadata } from 'next';

import {
  DrizzleRegistrationRepository,
  REGISTRATION_LIST_LIMIT,
  credentialCapabilityManifest,
} from '@intellifin/infrastructure';

import { AdministrationTabs } from '../../../src/admin/AdministrationTabs';
import { RegistrationsPanel } from '../../../src/admin/RegistrationsPanel';
import { ADMINISTRATION_AREAS } from '../../../src/admin/administration-words';
import { Banner } from '../../../src/design/Banner';
import { PageHeader } from '../../../src/design/PageHeader';
import { getRuntime } from '../../../src/bootstrap';
import { requireServerAction } from '../../../src/server-session';
import { createRegistrationAction } from './actions';

export const metadata: Metadata = {
  title: 'Systems · IntelliFin Audit',
};

/** The role is read per request; this surface can never be cached (AD-7). */
export const dynamic = 'force-dynamic';

const AREA = ADMINISTRATION_AREAS['/administration/registrations'];

/**
 * Administration — Systems (FR-8, AD-2, AD-10; UI cleanup 2026-09-22, UX-41, UX-43).
 *
 * "Systems" here, not "Target systems": it is the breadcrumb label package 1 already
 * registered for this path, and a tab reading one name over a crumb reading another is
 * two names for one place.
 *
 * The sidebar shows Administration to a PoC Administrator only, and that is
 * presentation: anybody can type this path. So the surface asks the audited
 * authorization path, which resolves the role fresh from `user_role`, applies the pure
 * domain policy, and appends the refusal to the audit chain before returning it.
 *
 * On refusal the page renders the reason and NOTHING else — no tabs, no table, no form,
 * not one origin, credential reference or digest.
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
        <h1>{AREA.title}</h1>
        <Banner tone="danger" title={decision.reason} />
      </div>
    );
  }

  const runtime = await getRuntime();
  const repository = new DrizzleRegistrationRepository(runtime.db, REGISTRATION_LIST_LIMIT);
  const [registrations, total] = await Promise.all([
    repository.listRegistrations(),
    repository.countRegistrations(),
  ]);
  // Names only, never a value: `credentialCapabilityManifest` reads the declared manifest
  // this process already validated at boot, and the datalist offers what it declares.
  const knownCredentialReferences = [...credentialCapabilityManifest(runtime.config).keys()];

  return (
    <div className="ls-stack">
      <PageHeader
        title={AREA.title}
        lede="The systems the agent is allowed to look in, and what it may do in each one. Every credential must be read-only, and no password or token is ever stored here."
      />
      <AdministrationTabs current="/administration/registrations" />
      <RegistrationsPanel
        registrations={registrations}
        limit={REGISTRATION_LIST_LIMIT}
        total={total}
        knownCredentialReferences={knownCredentialReferences}
        createRegistration={createRegistrationAction}
      />
    </div>
  );
}
