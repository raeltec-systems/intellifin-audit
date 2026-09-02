import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { DrizzleRegistrationRepository, NoProcedureReferences } from '@intellifin/infrastructure';

import { RegistrationEditor } from '../../../../src/admin/RegistrationEditor';
import { Banner } from '../../../../src/design/Banner';
import { getRuntime } from '../../../../src/bootstrap';
import { requireServerAction } from '../../../../src/server-session';
import { changeRegistrationAction } from '../actions';

export const metadata: Metadata = {
  title: 'Target System registration · IntelliFin Audit',
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
        <h1>Target System registration</h1>
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

  const referencingProcedures = await new NoProcedureReferences().countReferencing();

  return (
    <div className="ls-stack">
      <header className="ls-page-header">
        <h1>{registration.displayName}</h1>
        <p>
          Changing the origin, application identity, credential reference, permitted
          actions, label patterns or secondary key recomputes the registration digest and
          is recorded in the audit chain. Changing the name or the note does not.
        </p>
      </header>
      <RegistrationEditor
        registration={registration}
        referencingProcedures={referencingProcedures}
        changeRegistration={changeRegistrationAction}
      />
    </div>
  );
}
