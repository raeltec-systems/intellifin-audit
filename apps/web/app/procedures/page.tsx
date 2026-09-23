import type { Metadata } from 'next';
import Link from 'next/link';

import { PROCEDURE_AUTHOR_ACTION } from '@intellifin/application';
import { authorizeAction, isProcedureVersionState, type ProcedureVersionState } from '@intellifin/domain';
import {
  DrizzleActorNameReader,
  DrizzleProcedureListReader,
  DrizzleRunOverviewRepository,
  DrizzleRunStopReader,
  PROCEDURE_PAGE_SIZE,
  type ProcedureLastRun,
} from '@intellifin/infrastructure';

import { getRuntime } from '../../src/bootstrap';
import { Banner } from '../../src/design/Banner';
import { PROCEDURE_CARD_ABSENT } from '../../src/design/copy';
import { EmptyState } from '../../src/design/EmptyState';
import { PageHeader } from '../../src/design/PageHeader';
import { currentIdentity } from '../../src/server-session';
import { NEXT_RUN_MANUAL } from '../../src/procedures/last-run-words';
import { ProcedureCard } from '../../src/procedures/list/ProcedureCard';
import { ProcedureFilters } from '../../src/procedures/list/ProcedureFilters';
import {
  FILTER_KEYS,
  NEWER_PAGE,
  NEW_PROCEDURE,
  OLDER_PAGE,
  PAGINATION_LABEL,
  PROCEDURES_EMPTY,
  PROCEDURES_LEDE,
  PROCEDURES_NO_MATCH,
  PROCEDURES_TITLE,
  SCHEDULE_NOTE_HEADING,
  matchedSentence,
  pageSentence,
  scheduleNoteHint,
} from '../../src/procedures/list/procedures-list-words';
import { isStoppedState } from '../../src/runs/stop-reason';

export const metadata: Metadata = { title: 'Procedures · IntelliFin Audit' };

/** The role is read per request; this surface can never be cached (AD-7). */
export const dynamic = 'force-dynamic';

/**
 * Procedures (UX-DR7; UI cleanup 2026-09-22, UX-03 and UX-04).
 *
 * Reading is not gated by an action: every signed-in role may see the list, so this page
 * does not ask `requireServerAction` anything. What IS gated is authoring — the "New
 * procedure" action is rendered only for a role the domain policy says may author, and
 * `/procedures/new` refuses the rest on the server. Hiding a control is never the control.
 *
 * `[REPAIRED 2026-09-22]` The owner met this page 6,497 pixels tall with no search, no
 * filter and no paging, and every card repeating two sentences about a scheduler that does
 * not exist. It is a searchable, filtered, PAGED list now, over an EXACT total from the
 * read's own `count(*)` — never `rows.length` of a bounded page, which is the bound rather
 * than a count. The unavailability of scheduling is stated ONCE, above the list, and each
 * card says which frequency its Active version PLANS.
 *
 * The Run facts stay gated on `run.initiate` — the action the Runs register itself is
 * gated on — and are not READ at all for a role that does not hold it. Not reading is the
 * control; the cell then says which of the two is happening.
 */
export default async function ProceduresPage({
  searchParams,
}: {
  readonly searchParams: Promise<Record<string, string | string[] | undefined>>;
}): Promise<React.JSX.Element> {
  const identity = await currentIdentity();
  const role = identity.kind === 'identified' ? identity.role : null;
  const mayAuthor = role !== null && authorizeAction(role, PROCEDURE_AUTHOR_ACTION).allowed;
  const mayReadRuns = role !== null && authorizeAction(role, 'run.initiate').allowed;

  const query = await searchParams;
  const search = single(query[FILTER_KEYS.search]);
  const ownerId = single(query[FILTER_KEYS.owner]);
  // A state the vocabulary does not hold is DROPPED rather than matched, so a hand-typed
  // one narrows to nothing visible instead of reaching PostgreSQL as an unknown literal.
  const states = values(query[FILTER_KEYS.state]).filter((value): value is ProcedureVersionState =>
    isProcedureVersionState(value),
  );
  const pageNumber = pageOf(single(query[FILTER_KEYS.page]));

  const runtime = await getRuntime();
  const reader = new DrizzleProcedureListReader(runtime.db);
  const [page, owners] = await Promise.all([
    reader.listProcedures({
      search,
      states,
      ownerId,
      offset: (pageNumber - 1) * PROCEDURE_PAGE_SIZE,
      limit: PROCEDURE_PAGE_SIZE,
    }),
    reader.listOwners(),
  ]);

  // The last Run of every Procedure on this page, in ONE statement — a lateral read per
  // card would be a page of Procedures costing a page of round trips.
  const lastRuns = mayReadRuns
    ? await new DrizzleRunOverviewRepository(runtime.db).latestRunPerProcedure(
        page.rows.map((row) => row.procedureId),
      )
    : new Map<string, ProcedureLastRun>();
  // Why each of those Runs stopped, through the SAME statement the Runs list and the Run
  // header use, so a card cannot say one thing about a Run while the register says another.
  const [stops, names] = await Promise.all([
    new DrizzleRunStopReader(runtime.db).readStops(
      [...lastRuns.values()].filter((run) => isStoppedState(run.state)).map((run) => run.runId),
    ),
    new DrizzleActorNameReader(runtime.db).namesFor([
      ...owners.map((owner) => owner.userId),
      ...page.rows.flatMap((row) => (row.ownerId === null ? [] : [row.ownerId])),
    ]),
  ]);

  const filtered = search !== '' || states.length > 0 || ownerId !== '';
  const from = page.offset + 1;
  const to = page.offset + page.rows.length;

  return (
    <div className="ls-stack">
      <PageHeader
        title={PROCEDURES_TITLE}
        lede={PROCEDURES_LEDE}
        actions={
          mayAuthor ? (
            <Link className="ls-button ls-button--primary ls-button--md" href="/procedures/new">
              {NEW_PROCEDURE}
            </Link>
          ) : null
        }
      />

      {/* Said ONCE for the whole list. Both sentences are still the contract's and
          `last-run-words.ts`'s; what changed is that twenty cards no longer repeat them. */}
      <Banner tone="info" variant="line" title={SCHEDULE_NOTE_HEADING}>
        <p>{NEXT_RUN_MANUAL}</p>
        <p className="ls-caption">{scheduleNoteHint(PROCEDURE_CARD_ABSENT.schedule)}</p>
      </Banner>

      {page.unfilteredTotal === 0 ? (
        // The EmptyState's ONLY action is "New procedure" — no handler; the component's
        // type cannot carry a mutating call to action at all.
        <EmptyState
          icon="file-text"
          {...PROCEDURES_EMPTY}
          link={mayAuthor ? { href: '/procedures/new', label: NEW_PROCEDURE } : undefined}
        />
      ) : (
        <>
          <ProcedureFilters
            search={search}
            states={states}
            ownerId={ownerId}
            owners={owners}
            names={names}
          />
          <p role="status">{matchedSentence(page.total, page.unfilteredTotal)}</p>
          {page.rows.length === 0 ? (
            <EmptyState icon="search-x" {...(filtered ? PROCEDURES_NO_MATCH : PROCEDURES_EMPTY)} />
          ) : (
            <>
              <ul className="ls-procedure-list">
                {page.rows.map((row) => {
                  const lastRun = lastRuns.get(row.procedureId) ?? null;
                  return (
                    <ProcedureCard
                      key={row.procedureId}
                      row={row}
                      lastRun={lastRun}
                      stop={lastRun === null ? null : stops.get(lastRun.runId) ?? null}
                      runsVisible={mayReadRuns}
                      absent={PROCEDURE_CARD_ABSENT}
                      names={names}
                    />
                  );
                })}
              </ul>
              {page.total > page.rows.length ? (
                <nav className="ls-pagination" aria-label={PAGINATION_LABEL}>
                  <p>{pageSentence(from, to, page.total)}</p>
                  {pageNumber > 1 ? (
                    <Link href={href(query, pageNumber - 1)}>{OLDER_PAGE}</Link>
                  ) : null}
                  {to < page.total ? (
                    <Link href={href(query, pageNumber + 1)}>{NEWER_PAGE}</Link>
                  ) : null}
                </nav>
              ) : null}
            </>
          )}
        </>
      )}
    </div>
  );
}

/** One value from a query key a caller may repeat. Bounded, because it comes from a URL. */
function single(value: string | string[] | undefined): string {
  const first = Array.isArray(value) ? value[0] : value;
  return typeof first === 'string' ? first.slice(0, 200).trim() : '';
}

/** Every value of a repeatable key, so the read's list shape survives a later checkbox set. */
function values(value: string | string[] | undefined): readonly string[] {
  if (Array.isArray(value)) return value.filter((entry) => typeof entry === 'string');
  return typeof value === 'string' && value !== '' ? [value] : [];
}

/**
 * Which page was asked for.
 *
 * A page number is arbitrary text from the URL bar, so anything that is not a positive
 * integer is page one — never an error, and never an offset PostgreSQL has to skip. The
 * read bounds the offset again; this is the surface's own half of the same rule.
 */
function pageOf(value: string): number {
  const parsed = Number.parseInt(value, 10);
  return Number.isSafeInteger(parsed) && parsed > 1 ? parsed : 1;
}

/** The same filter, a different page. Every other key the reader set is carried through. */
function href(query: Record<string, string | string[] | undefined>, page: number): string {
  const params = new URLSearchParams();
  for (const key of [FILTER_KEYS.search, FILTER_KEYS.owner] as const) {
    const value = single(query[key]);
    if (value !== '') params.set(key, value);
  }
  for (const state of values(query[FILTER_KEYS.state])) params.append(FILTER_KEYS.state, state);
  if (page > 1) params.set(FILTER_KEYS.page, String(page));
  const text = params.toString();
  return text === '' ? '/procedures' : `/procedures?${text}`;
}
