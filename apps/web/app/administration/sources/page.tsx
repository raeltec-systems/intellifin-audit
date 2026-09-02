import type { Metadata } from 'next';

import { BINDING_LIST_LIMIT, DrizzleBindingRepository } from '@intellifin/infrastructure';

import { BindingsPanel } from '../../../src/admin/BindingsPanel';
import { Banner } from '../../../src/design/Banner';
import { getRuntime } from '../../../src/bootstrap';
import { requireServerAction } from '../../../src/server-session';
import { createBindingAction } from './actions';

export const metadata: Metadata = {
  title: 'Population Source bindings · IntelliFin Audit',
};

/** The role is read per request; this surface can never be cached (AD-7). */
export const dynamic = 'force-dynamic';

/**
 * Administration — Population Source bindings (FR-6, FR-41).
 *
 * The sidebar shows Administration to a PoC Administrator only, and that is
 * presentation: anybody can type this path. So the surface asks the audited authorization
 * path, which resolves the role fresh from `user_role`, applies the pure domain policy,
 * and appends the refusal to the audit chain before returning it.
 *
 * On refusal the page renders the reason and NOTHING else — no table, no form, not one
 * location, field name or digest.
 *
 * This page reads. It never acquires a population: no file is opened, no endpoint is
 * called, and there is no file input on the form. A Run acquires the population through a
 * platform Adapter, and that is Epic 2.
 */
export default async function SourcesPage(): Promise<React.JSX.Element> {
  const decision = await requireServerAction('administration.bindings.manage');

  if (!decision.allowed) {
    return (
      <div className="ls-stack">
        <h1>Population Source bindings</h1>
        <Banner tone="danger" title={decision.reason} />
      </div>
    );
  }

  const runtime = await getRuntime();
  const bindings = await new DrizzleBindingRepository(
    runtime.db,
    BINDING_LIST_LIMIT,
  ).listBindings();

  return (
    <div className="ls-stack">
      <header className="ls-page-header">
        <h1>Population Source bindings</h1>
        <p>
          Where each population comes from, the schema it declares, how its expected record
          count is declared independently of us, and which of its fields are masked. A
          Procedure Version freezes all five, as the binding digest.
        </p>
      </header>
      <BindingsPanel
        bindings={bindings}
        limit={BINDING_LIST_LIMIT}
        createBinding={createBindingAction}
      />
    </div>
  );
}
