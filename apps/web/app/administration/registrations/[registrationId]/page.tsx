import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { registrationRowVersion } from '@intellifin/application';
import {
  DrizzleRegistrationRepository,
  DrizzleProcedureRepository,
  credentialCapabilityManifest,
} from '@intellifin/infrastructure';

import { AdministrationTabs } from '../../../../src/admin/AdministrationTabs';
import { RegistrationEditor } from '../../../../src/admin/RegistrationEditor';
import { Banner } from '../../../../src/design/Banner';
import { getRuntime } from '../../../../src/bootstrap';
import { DetailTrail } from '../../../../src/procedures/DetailTrail';
import { requireServerAction } from '../../../../src/server-session';
import { changeRegistrationAction } from '../actions';

export const metadata: Metadata = {
  title: 'Target system · IntelliFin Audit',
};

/** The role is read per request; this surface can never be cached (AD-7). */
export const dynamic = 'force-dynamic';

/**
 * One Target System registration (FR-8, AD-2).
 *
 * Authorization comes first, before the id in the URL is used for anything. A refused
 * caller must not be able to learn whether a registration id exists by watching this
 * page answer differently — so the refusal branch renders before the lookup, not after.
 *
 * `ReferencingProcedureCounter` returns 0 in this release, so the confirmation dialog
 * does not mention Procedures. It is asked here rather than assumed so that the sentence
 * appears the moment Epic 2 gives it a true value.
 */
export default async function RegistrationPage({
  params,
}: {
  params: Promise<{ registrationId: string }>;
}): Promise<React.JSX.Element> {
  const decision = await requireServerAction('administration.registrations.manage');

  if (!decision.allowed) {
    return (
      <div className="ls-stack">
        <h1>Target system</h1>
        <Banner tone="danger" title={decision.reason} />
      </div>
    );
  }

  const { registrationId } = await params;
  const runtime = await getRuntime();
  const registration = await new DrizzleRegistrationRepository(runtime.db).findRegistration(
    registrationId,
  );
  if (registration === null) notFound();

  const procedures = new DrizzleProcedureRepository(runtime.db);
  const registrations = new DrizzleRegistrationRepository(runtime.db);
  const [referencingProcedures, affected, auditActivity] = await Promise.all([
    procedures.countReferencing(registrationId, 'registration'),
    procedures.listReferencing(registrationId, 'registration'),
    registrations.lastAuditActivity(registrationId),
  ]);
  const affectedProcedures = affected.map((row) => row.controlName);
  const knownCredentialReferences = [...credentialCapabilityManifest(runtime.config).keys()];

  // The page trails itself with the name it knows (UI cleanup 2026-09-21, UX-41): the
  // shell could only say this row's UUID, which the walkthrough found as the last crumb.
  return (
    <div className="ls-stack">
      <DetailTrail
        trail={[
          { href: '/administration', label: 'Administration' },
          { href: '/administration/registrations', label: 'Systems' },
          { href: `/administration/registrations/${registration.registrationId}`, label: registration.displayName },
        ]}
      />
      <AdministrationTabs current="/administration/registrations" />
      <header className="ls-page-header">
        <h1>{registration.displayName}</h1>
        <p>
          Changing what the agent may reach or do here gives this system a new
          fingerprint, and every procedure that uses it needs approving again. Changing
          only its name, note or status changes no procedure. Either way, the change is
          recorded against your name.
        </p>
      </header>
      <RegistrationEditor
        registration={registration}
        rowVersion={registrationRowVersion(registration)}
        referencingProcedures={referencingProcedures}
        affectedProcedures={affectedProcedures}
        knownCredentialReferences={knownCredentialReferences}
        auditActivity={auditActivity}
        changeRegistration={changeRegistrationAction}
      />
    </div>
  );
}
