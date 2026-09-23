import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';

import { procedureVersionRowVersion, submissionUnavailableReason, type ProcedureVersionView } from '@intellifin/application';
import { VersionActions } from '../../../src/procedures/VersionActions';
import { NewVersionButton } from '../../../src/procedures/NewVersionButton';
import { VersionStatus } from '../../../src/procedures/VersionStatus';
import { CryptoUuidV7Generator, DrizzleProcedureRepository } from '@intellifin/infrastructure';
import { isExplicitPeriod } from '@intellifin/domain';

import { getRuntime } from '../../../src/bootstrap';
import { Banner } from '../../../src/design/Banner';
import { PageHeader } from '../../../src/design/PageHeader';
import { Timestamp } from '../../../src/design/Timestamp';
import { DetailTrail } from '../../../src/procedures/DetailTrail';
import { ProcedureStateBadge } from '../../../src/procedures/ProcedureStateBadge';
import { templateLabel, versionLabel } from '../../../src/procedures/labels';
import { draftGapWords } from '../../../src/procedures/readiness-words';
import { plannedFrequencyLine, SCHEDULE_NOT_SAVED_LINE } from '../../../src/design/run-start-words';
import { requireServerAction } from '../../../src/server-session';
import { InitiateRunForm } from '../../../src/runs/InitiateRunForm';

export const metadata: Metadata = {
  title: 'Procedure · IntelliFin Audit',
};

/** The role is read per request; this surface can never be cached (AD-7). */
export const dynamic = 'force-dynamic';

/**
 * Procedure Detail (UX-DR11): version history, review/authoring links and period-based
 * Run initiation. The command, rather than the rendered history page, selects the
 * Active version that owns the requested period.
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
  searchParams: Promise<{ before?: string; requestToken?: string | string[]; from?: string | string[]; to?: string | string[] }>;
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

  const query = await searchParams;
  const resuming = query.requestToken !== undefined;
  const queryPeriod = { from: query.from, to: query.to };
  if (resuming && (typeof query.requestToken !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(query.requestToken) || !isExplicitPeriod(queryPeriod))) notFound();
  const requestToken = resuming ? query.requestToken as string : new CryptoUuidV7Generator().next();
  const initialPeriod = resuming && isExplicitPeriod(queryPeriod) ? queryPeriod : undefined;
  // Without a request token the dates are a SUGGESTION: an Active version card links here
  // with its saved Period so the Initiate Run box opens filled in. They fill the fields and
  // nothing else, so a malformed pair is ignored rather than refused.
  const suggestedPeriod = !resuming && isExplicitPeriod(queryPeriod) ? queryPeriod : undefined;
  const beforeText = query.before;
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
      {/* UX-08/UX-02: one compact header row instead of a title and a paragraph each on
          their own; the Procedure carries no single state, so there is no badge here. */}
      <PageHeader
        title={procedure.controlName}
        meta={`Template ${procedure.templateId} · ${templateLabel(procedure.templateId)}`}
      />

      {/* The card and the box share this page, so a new suggestion has to REMOUNT the box:
          a mounted form keeps its own state, and a request token, until a full navigation. */}
      <InitiateRunForm key={suggestedPeriod === undefined ? 'blank' : `${suggestedPeriod.from}:${suggestedPeriod.to}`} procedureId={procedure.procedureId} requestToken={requestToken} initialPeriod={initialPeriod} suggestedPeriod={suggestedPeriod} />

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
                  Created <Timestamp value={version.createdAt} /> · Last changed{' '}
                  <Timestamp value={version.updatedAt} />
                </p>
                <VersionStatus version={version} successorNumber={successors.get(version.versionId) ?? null} />
                {version.state === 'ACTIVE' && <NewVersionButton procedureId={procedure.procedureId} versionId={version.versionId} expectedRowVersion={procedureVersionRowVersion(version)} />}
                {version.state === 'DRAFT' && <VersionActions procedureId={procedure.procedureId} versionId={version.versionId} rowVersion={procedureVersionRowVersion(version)} actions={[{ decision: 'submit', label: 'Submit for approval', reason: draftGapWords(submissionUnavailableReason(version)) }]} />}
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
      {/* No "State" cell: the stored upper-case state (`ACTIVE`) repeated the badge on the
          card's title in the platform's own spelling. The badge is the one place it is said. */}
      {/*
        UX-14: the Schedule's saved frequency, read the way a plan is read — never a
        claim that anything runs by itself. `run-start-words.ts` is the one place this
        sentence and the Initiate Run box's own sentences are said, so a rewording of
        either lands on every surface that reads them.
      */}
      <div>
        <dt>Planned frequency</dt>
        <dd>{version.schedule === null ? SCHEDULE_NOT_SAVED_LINE : plannedFrequencyLine(version.schedule.frequency)}</dd>
      </div>
    </dl>
  );
}
