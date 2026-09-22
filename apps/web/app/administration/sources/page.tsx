import type { Metadata } from 'next';

import { BINDING_LIST_LIMIT, DrizzleBindingRepository } from '@intellifin/infrastructure';

import { AdministrationTabs } from '../../../src/admin/AdministrationTabs';
import { BindingsPanel } from '../../../src/admin/BindingsPanel';
import { ADMINISTRATION_AREAS } from '../../../src/admin/administration-words';
import { Banner } from '../../../src/design/Banner';
import { PageHeader } from '../../../src/design/PageHeader';
import { getRuntime } from '../../../src/bootstrap';
import { requireServerAction } from '../../../src/server-session';
import { createBindingAction } from './actions';

export const metadata: Metadata = {
  title: 'Population sources · IntelliFin Audit',
};

/** The role is read per request; this surface can never be cached (AD-7). */
export const dynamic = 'force-dynamic';

const AREA = ADMINISTRATION_AREAS['/administration/sources'];

/**
 * Administration — Population sources (FR-6, FR-41; UI cleanup 2026-09-22, UX-41, UX-43).
 *
 * The sidebar shows Administration to a PoC Administrator only, and that is
 * presentation: anybody can type this path. So the surface asks the audited authorization
 * path, which resolves the role fresh from `user_role`, applies the pure domain policy,
 * and appends the refusal to the audit chain before returning it.
 *
 * On refusal the page renders the reason and NOTHING else — no tabs, no table, no form,
 * not one location, field name or digest.
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
        <h1>{AREA.title}</h1>
        <Banner tone="danger" title={decision.reason} />
      </div>
    );
  }

  const runtime = await getRuntime();
  const repository = new DrizzleBindingRepository(runtime.db, BINDING_LIST_LIMIT);
  const [bindings, total] = await Promise.all([
    repository.listBindings(),
    repository.countBindings(),
  ]);

  return (
    <div className="ls-stack">
      <PageHeader
        title={AREA.title}
        lede="Where the records a procedure tests come from. Set one up here, then an auditor picks it when they build a procedure."
      />
      <AdministrationTabs current="/administration/sources" />
      <BindingsPanel
        bindings={bindings}
        limit={BINDING_LIST_LIMIT}
        total={total}
        createBinding={createBindingAction}
      />
    </div>
  );
}
