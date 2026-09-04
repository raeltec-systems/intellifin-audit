import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import type { ProcedureVersionView } from '@intellifin/application';
import { DrizzleProcedureRepository } from '@intellifin/infrastructure';

import { getRuntime } from '../../../src/bootstrap';
import { Banner } from '../../../src/design/Banner';
import { DetailTrail } from '../../../src/procedures/DetailTrail';
import { ProcedureStateBadge } from '../../../src/procedures/ProcedureStateBadge';
import { templateLabel, versionLabel } from '../../../src/procedures/labels';
import { requireServerAction } from '../../../src/server-session';

export const metadata: Metadata = {
  title: 'Procedure · IntelliFin Audit',
};

/** The role is read per request; this surface can never be cached (AD-7). */
export const dynamic = 'force-dynamic';

/**
 * Procedure Detail (UX-DR11, scoped to this story).
 *
 * The surface shows the versions that exist — one, a `DRAFT`, for every Procedure this
 * story can create — each with its state badge, and opens the Builder for the Draft.
 * Everything else UX-DR11 names (approval, scheduling, Run history) arrives with the
 * stories that own it, and is rendered by nobody here.
 *
 * Authorization comes first, before the id in the URL is used for anything. A refused
 * caller must not be able to learn whether a procedure id exists by watching this page
 * answer differently — so the refusal branch renders before the lookup, not after.
 * Reading the LIST is ungated, but the spec's gating table has no `procedure.view` and
 * UX-DR11's surfaces are read with the same rule as any other detail surface; the
 * Detail is where a Draft is edited from, so it keeps the author gate.
 */
export default async function ProcedurePage({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<React.JSX.Element> {
  const decision = await requireServerAction('procedure.author');

  if (!decision.allowed) {
    return (
      <div className="ls-stack">
        <h1>Procedure</h1>
        <Banner tone="danger" title={decision.reason} />
      </div>
    );
  }

  const { id } = await params;
  const runtime = await getRuntime();
  const procedure = await new DrizzleProcedureRepository(runtime.db).findProcedure(id);
  if (procedure === null) notFound();

  const versions = await new DrizzleProcedureRepository(runtime.db).listVersions(id);

  return (
    <div className="ls-stack">
      <DetailTrail
        trail={[
          { href: '/procedures', label: 'Procedures', mono: false },
          { href: `/procedures/${procedure.procedureId}`, label: procedure.controlName },
        ]}
      />
      <header className="ls-page-header">
        <h1>{procedure.controlName}</h1>
        <p>
          Template {procedure.templateId} · {templateLabel(procedure.templateId)}
        </p>
      </header>

      <section className="ls-stack">
        <h2>Versions</h2>
        <ul className="ls-stack">
          {versions.map((version) => (
            <li key={version.versionId} className="ls-card">
              <div className="ls-stack">
                <p className="ls-card__title">
                  {versionLabel(version.versionNumber, version.state)}{' '}
                  <ProcedureStateBadge state={version.state} />
                </p>
                <p className="ls-caption">
                  Created {version.createdAt.replace('T', ' ').slice(0, 19)} UTC · Last
                  changed {version.updatedAt.replace('T', ' ').slice(0, 19)} UTC
                </p>
                {version.state === 'DRAFT' ? (
                  <p>
                    <Link
                      className="ls-button ls-button--secondary ls-button--md"
                      href={`/procedures/${procedure.procedureId}/builder`}
                    >
                      Open Builder
                    </Link>
                  </p>
                ) : null}
              </div>
              <VersionMeta version={version} />
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

/** The version's own facts, beneath its card title. */
function VersionMeta({ version }: { readonly version: ProcedureVersionView }): React.JSX.Element {
  return (
    <dl className="ls-card__cells">
      <div>
        <dt>Template</dt>
        <dd>
          {version.templateId} · {templateLabel(version.templateId)}
        </dd>
      </div>
      <div>
        <dt>Version</dt>
        <dd>{version.versionNumber}</dd>
      </div>
      <div>
        <dt>State</dt>
        <dd>{version.state}</dd>
      </div>
    </dl>
  );
}
