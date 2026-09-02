import type { Metadata } from 'next';
import { notFound } from 'next/navigation';

import { bindingRowVersion } from '@intellifin/application';
import { DrizzleBindingRepository, NoProcedureReferences } from '@intellifin/infrastructure';

import { BindingEditor } from '../../../../src/admin/BindingEditor';
import { Banner } from '../../../../src/design/Banner';
import { getRuntime } from '../../../../src/bootstrap';
import { requireServerAction } from '../../../../src/server-session';
import { changeBindingAction } from '../actions';

export const metadata: Metadata = {
  title: 'Population Source binding · IntelliFin Audit',
};

/** The role is read per request; this surface can never be cached (AD-7). */
export const dynamic = 'force-dynamic';

/**
 * One Population Source binding (FR-6, FR-41).
 *
 * Authorization comes first, before the id in the URL is used for anything. A refused
 * caller must not be able to learn whether a binding id exists by watching this page
 * answer differently — so the refusal branch renders before the lookup, not after.
 *
 * `ReferencingProcedureCounter` returns 0 in this release — it is Story 1.6's port,
 * reused rather than duplicated, because the question it answers is the same one — so the
 * confirmation dialog does not mention Procedures. It is asked here rather than assumed
 * so that the sentence appears the moment Epic 2 gives it a true value.
 */
export default async function SourcePage({
  params,
}: {
  params: Promise<{ bindingId: string }>;
}): Promise<React.JSX.Element> {
  const decision = await requireServerAction('administration.bindings.manage');

  if (!decision.allowed) {
    return (
      <div className="ls-stack">
        <h1>Population Source binding</h1>
        <Banner tone="danger" title={decision.reason} />
      </div>
    );
  }

  const { bindingId } = await params;
  const runtime = await getRuntime();
  const binding = await new DrizzleBindingRepository(runtime.db).findBinding(bindingId);
  if (binding === null) notFound();

  const referencingProcedures = await new NoProcedureReferences().countReferencing();

  return (
    <div className="ls-stack">
      <header className="ls-page-header">
        <h1>{binding.displayName}</h1>
        <p>
          Changing the kind, the location, the declared schema, the declared-count
          mechanism or the sensitive fields recomputes the binding digest and is recorded
          in the audit chain. Changing the name, the note or the status is recorded too,
          under an event that affects no Procedure.
        </p>
      </header>
      <BindingEditor
        binding={binding}
        rowVersion={bindingRowVersion(binding)}
        referencingProcedures={referencingProcedures}
        changeBinding={changeBindingAction}
      />
    </div>
  );
}
