import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { procedureVersionRowVersion, submissionUnavailableReason, type ProcedureVersionView } from '@intellifin/application';
import { VersionActions } from '../../../src/procedures/VersionActions';
import { NewVersionButton } from '../../../src/procedures/NewVersionButton';
import { VersionStatus } from '../../../src/procedures/VersionStatus';
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
  params, searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ before?: string }>;
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
  const repository = new DrizzleProcedureRepository(runtime.db);
  const procedure = await repository.findProcedure(id);
  if (procedure === null) notFound();

  const beforeText = (await searchParams).before;
  const before = beforeText === undefined ? undefined : Number(beforeText);
  if (before !== undefined && (!Number.isSafeInteger(before) || before < 1)) notFound();
  const { versions, olderThan } = await repository.versionPage(id, before);
  const successors = await repository.activatedSuccessors(id);

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
                <VersionStatus version={version} successorNumber={successors.get(version.versionId) ?? null} />
                {version.state === 'ACTIVE' && <NewVersionButton procedureId={procedure.procedureId} versionId={version.versionId} expectedRowVersion={procedureVersionRowVersion(version)} />}
                {version.state === 'DRAFT' && <VersionActions procedureId={procedure.procedureId} versionId={version.versionId} rowVersion={procedureVersionRowVersion(version)} actions={[{ decision: 'submit', label: 'Submit for approval', reason: submissionUnavailableReason(version) }]} />}
                {version.state === 'DRAFT' ? (
                  <p>
                    <Link
                      className="ls-button ls-button--secondary ls-button--md"
                      href={`/procedures/${procedure.procedureId}/builder?version=${version.versionId}`}
                    >
                      Open Builder
                    </Link>
                  </p>
                ) : <p><Link className="ls-button ls-button--secondary ls-button--md" href={`/procedures/${procedure.procedureId}/versions/${version.versionId}`}>Open version review</Link></p>}
              </div>
              <VersionMeta version={version} />
            </li>
          ))}
        </ul>
        <nav className="ls-stack" aria-label="Version history pages">
          {before !== undefined && <Link href={`/procedures/${id}`}>Newest versions</Link>}
          {olderThan !== null && <Link href={`/procedures/${id}?before=${olderThan}`}>Older versions</Link>}
        </nav>
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
