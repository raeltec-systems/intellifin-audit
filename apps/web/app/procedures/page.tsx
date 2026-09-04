import type { Metadata } from 'next';
import Link from 'next/link';

import { PROCEDURE_AUTHOR_ACTION, type ProcedureSummary } from '@intellifin/application';
import { authorizeAction } from '@intellifin/domain';
import { DrizzleProcedureRepository } from '@intellifin/infrastructure';

import { getRuntime } from '../../src/bootstrap';
import { PROCEDURE_CARD_ABSENT } from '../../src/design/copy';
import { EmptyState } from '../../src/design/EmptyState';
import { currentIdentity } from '../../src/server-session';
import { ProcedureStateBadge } from '../../src/procedures/ProcedureStateBadge';
import { templateLabel } from '../../src/procedures/labels';

export const metadata: Metadata = { title: 'Procedures · IntelliFin Audit' };

/** The role is read per request; this surface can never be cached (AD-7). */
export const dynamic = 'force-dynamic';

/**
 * Procedures (UX-DR7).
 *
 * Reading is not gated by an action: every signed-in role may see the list, so this
 * page does not ask `requireServerAction` anything. What IS gated is authoring — the
 * "New procedure" action is rendered only for a role the domain policy says may author,
 * and `/procedures/new` refuses the rest on the server. Hiding a control is never the
 * control; it is why the New-procedure surface exists apart from this page.
 *
 * The four cells of a card are UX-DR7's — Active version, Schedule, next Run, last
 * outcome — and in this story every one of them is absent, so every one of them says so
 * IN WORDS from `copy.ts`. A dash or an empty cell is something a reader takes for
 * "fine", and Story 1.6's "Never probed" is the precedent for saying what is not there.
 */
export default async function ProceduresPage(): Promise<React.JSX.Element> {
  const identity = await currentIdentity();
  const role = identity.kind === 'identified' ? identity.role : null;
  const mayAuthor = role !== null && authorizeAction(role, PROCEDURE_AUTHOR_ACTION).allowed;

  const runtime = await getRuntime();
  const procedures = await new DrizzleProcedureRepository(runtime.db).listProcedures();

  const newProcedureLink = mayAuthor ? (
    <Link className="ls-button ls-button--primary ls-button--md" href="/procedures/new">
      New procedure
    </Link>
  ) : null;

  if (procedures.length === 0) {
    // The EmptyState's ONLY action is "New procedure" — no other link, no handler; the
    // component's type cannot carry a mutating call to action at all. For a role that
    // may not author, even the link is absent rather than shown and refused.
    return (
      <div className="ls-stack">
        <header className="ls-page-header">
          <h1>Procedures</h1>
          <p>Procedures with their Active version, Schedule, next Run, and last outcome.</p>
        </header>
        <EmptyState
          icon="file-text"
          headline="No Procedures yet."
          sentence="A Procedure and its versions would be listed here, each created from a Template. An empty list does not mean a control passed; it means nothing can be approved, scheduled, or run."
          link={mayAuthor ? { href: '/procedures/new', label: 'New procedure' } : undefined}
        />
      </div>
    );
  }

  return (
    <div className="ls-stack">
      <header className="ls-page-header">
        <h1>Procedures</h1>
        <p>Procedures with their Active version, Schedule, next Run, and last outcome.</p>
        {newProcedureLink}
      </header>
      <ul className="ls-stack">
        {procedures.map((procedure) => (
          <ProcedureCard key={procedure.procedureId} procedure={procedure} />
        ))}
      </ul>
    </div>
  );
}

/**
 * The words STATUS_VOCABULARY spells the states with are chosen in `labels.ts`, once,
 * beside the badge that renders them.
 */
function ProcedureCard({ procedure }: { readonly procedure: ProcedureSummary }): React.JSX.Element {
  const version =
    procedure.activeVersionState === null ? null : (
      <ProcedureStateBadge state={procedure.activeVersionState} />
    );

  return (
    <li className="ls-card">
      <h2 className="ls-card__title">
        {/* The Control name, linked to the Detail — the row's way onward (UX-DR7). */}
        <Link href={`/procedures/${procedure.procedureId}`}>{procedure.controlName}</Link>
      </h2>
      <p className="ls-caption">
        Template {procedure.templateId} · {templateLabel(procedure.templateId)}
      </p>
      <dl className="ls-card__cells">
        <div>
          <dt>Active version</dt>
          <dd>{version ?? PROCEDURE_CARD_ABSENT.activeVersion}</dd>
        </div>
        <div>
          <dt>Schedule</dt>
          <dd>{PROCEDURE_CARD_ABSENT.schedule}</dd>
        </div>
        <div>
          <dt>Next Run</dt>
          <dd>{PROCEDURE_CARD_ABSENT.nextRun}</dd>
        </div>
        <div>
          <dt>Last outcome</dt>
          <dd>{PROCEDURE_CARD_ABSENT.lastOutcome}</dd>
        </div>
      </dl>
    </li>
  );
}
