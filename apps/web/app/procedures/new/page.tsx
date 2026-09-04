import type { Metadata } from 'next';

import { PROCEDURE_AUTHOR_ACTION } from '@intellifin/application';

import { Banner } from '../../../src/design/Banner';
import { NewProcedureForm } from '../../../src/procedures/NewProcedureForm';
import { requireServerAction } from '../../../src/server-session';
import { createProcedureAction } from './actions';

export const metadata: Metadata = {
  title: 'New procedure · IntelliFin Audit',
};

/** The role is read per request; this surface can never be cached (AD-7). */
export const dynamic = 'force-dynamic';

/**
 * New procedure (FR-4).
 *
 * The page asks the audited authorization path before it renders anything: a PoC
 * Administrator typing this path is refused here, with the verbatim sentence and an
 * audit row, and the refusal branch renders NOTHING else — not the picker, not the
 * field, not one Template name. Hiding the nav item is presentation; this is the
 * control.
 *
 * The Template picker has no default selection. A default chooses for the person.
 */
export default async function NewProcedurePage(): Promise<React.JSX.Element> {
  const decision = await requireServerAction(PROCEDURE_AUTHOR_ACTION);

  if (!decision.allowed) {
    return (
      <div className="ls-stack">
        <h1>New procedure</h1>
        <Banner tone="danger" title={decision.reason} />
      </div>
    );
  }

  return (
    <div className="ls-stack">
      <header className="ls-page-header">
        <h1>New procedure</h1>
        <p>
          A Procedure starts as a Draft pre-filled from a Template. Every section is
          shown in the Builder; this release makes the Control name editable and the
          rest arrives in later releases.
        </p>
      </header>
      <NewProcedureForm onCreate={createProcedureAction} />
    </div>
  );
}
