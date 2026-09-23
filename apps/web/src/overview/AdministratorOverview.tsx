import Link from 'next/link';

import {
  ADMIN_ENVIRONMENT_FACTS,
  ADMIN_ENVIRONMENT_HEADING,
  ADMIN_LINKS,
  ADMIN_OVERVIEW_HEADING,
  ADMIN_OVERVIEW_SCOPE,
  ADMIN_OVERVIEW_SENTENCE,
} from './overview-words';

/**
 * What a PoC Administrator lands on (UI cleanup 2026-09-22, UX-37).
 *
 * `[REPAIRED]` They used to meet an info Banner saying the summary was for other people —
 * a refusal-shaped welcome for somebody whose only act was signing in, naming nothing they
 * could do about it. EXPERIENCE.md's role-landing decision is explicit: "a PoC
 * Administrator lands on an administration summary, not on a refusal."
 *
 * Three links and the standing facts, and no counts. An exact count of users, sources or
 * systems has no reader in this build: every administration repository answers a bounded
 * page, and `rows.length` of a bounded page is the bound rather than a total — which is
 * precisely the number this product's own rule forbids a surface to report as one.
 *
 * Nothing about Runs or Reviews is READ here, and the last sentence says why. Not reading
 * is the control; `/runs` refuses this role on the server whatever a landing page shows.
 */
export function AdministratorOverview(): React.JSX.Element {
  return (
    <>
      <section aria-labelledby="admin-setup-heading" className="ls-stack">
        <h2 id="admin-setup-heading">{ADMIN_OVERVIEW_HEADING}</h2>
        <p>{ADMIN_OVERVIEW_SENTENCE}</p>
        <ul className="ls-admin-links">
          {ADMIN_LINKS.map((entry) => (
            <li key={entry.href}>
              <Link href={entry.href}>{entry.label}</Link>
              <p className="ls-caption">{entry.detail}</p>
            </li>
          ))}
        </ul>
      </section>

      <section aria-labelledby="admin-environment-heading" className="ls-stack">
        <h2 id="admin-environment-heading">{ADMIN_ENVIRONMENT_HEADING}</h2>
        <ul className="ls-facts">
          {ADMIN_ENVIRONMENT_FACTS.map((fact) => (
            <li key={fact}>{fact}</li>
          ))}
        </ul>
        <p className="ls-caption">{ADMIN_OVERVIEW_SCOPE}</p>
      </section>
    </>
  );
}
