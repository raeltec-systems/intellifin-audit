# UI cleanup 2026-09-22 — package 2: role landing pages, Reviews, searchable lists, compact tables

Commits on `ui/p2`: `56d58b6` (reads), `29d1066` (pages and components), `ed0dbe7` (unit and
integration tests), `25d9278` (browser specs), `eb25ebb` and the run-surfaces locator commit
(defects found when the browser specs were first actually run, below). The earlier sessions
were cut off by a rate limit; the last one wrote this report's draft and the browser specs
but had not run them end to end. They were run here, and they found three real defects and
four fixture defects, all fixed in `eb25ebb`.

## Findings, one at a time

### UX-01 — Overview "Needs attention" now includes unsealed Results
`apps/web/app/page.tsx` (`OverviewSections`), `apps/web/src/overview/AttentionList.tsx`,
`apps/web/src/overview/overview-words.ts` (`ATTENTION_NOT_YET_LISTED`, revised),
`packages/infrastructure/src/runs/pending-results.ts` (`DrizzlePendingResultReader`, new).
A `pending` group renders every Run whose Result is `PENDING_CONFIRMATION`, with the exact
count of remaining assessments and a direct link to the Run's Result tab, `/runs/{id}`
(`resultTabHref` in `apps/web/src/review/review-words.ts`; see the defects below). The footnote no
longer claims such a Result "is not listed here"; it names only what is genuinely absent
(submission, approval, finalization, a scheduler).
Proof: `AttentionList.test.ts` (18 cases, SSR), `tests/integration/ui-cleanup-p2-reads.test.ts`
(the reader, against real PostgreSQL — own account only, sealed excluded, a stranger sees
nothing), and `tests/e2e/reviews.spec.ts`'s Results-tab test (the same read, in the browser,
FOLLOWING the "Open the Result" link to the Run's own page). Proven by mutation: pointing the link helper back at
`/runs/{id}/result` fails `AttentionList.test.ts`, `ReviewQueues.test.ts` and
`review-words.test.ts`.

### UX-37 (Overview half) and role landing — three homes, one page
`apps/web/app/page.tsx`, `apps/web/src/overview/AdministratorOverview.tsx`,
`apps/web/src/overview/MyDrafts.tsx`, `apps/web/src/overview/overview-words.ts`
(`MANAGER_ATTENTION_ORDER`, `ADMIN_*`), `packages/infrastructure/src/procedures/procedure-list.ts`
(`listAuthoredDrafts`, new).
- Auditor: `MyDrafts` renders first, above "Needs attention", from `listAuthoredDrafts`.
- Audit Manager: the attention list reorders to `['version','escalation','flag','pending','stopped']`
  and a `MANAGER_RESULT_REVIEW_NOTE` explains the half of their work this release does not
  have, linking to Reviews.
- PoC Administrator: `AdministratorOverview` — three links (Users, Population sources,
  Systems) plus the standing environment facts. No Run or Review fact is *read* for this
  role (`mayReadRuns`/`decision.allowed` gate it), which is the control; the page never
  asserts a fabricated absence.
Proof: `RoleLanding.test.ts` (8 SSR cases, all three landings), `AttentionList.test.ts`
(the `order` prop), and the new `tests/e2e/overview.spec.ts` (three `test.describe` blocks,
one per role, against the real signed-in accounts — the Manager signs in live via
`E2E_MANAGER_EMAIL`, since no pre-authenticated Manager `AUTH_STATE` exists).

### UX-03 / UX-04 — Procedures: searchable, filtered, paged, one Schedule sentence
`apps/web/app/procedures/page.tsx`, `apps/web/src/procedures/list/ProcedureFilters.tsx`,
`apps/web/src/procedures/list/ProcedureCard.tsx`, `apps/web/src/procedures/list/procedures-list-words.ts`,
`packages/infrastructure/src/procedures/procedure-list.ts` (`listProcedures`, `listOwners`, new).
A `<form method="get" data-readonly-filter="true">` (search, state, owner), an exact
`page.total`/`page.unfilteredTotal` pair, offset pagination past `PROCEDURE_PAGE_SIZE` (20),
and a compact one-`<dl>`-line card (Active version, Newest version, Schedule, Accountable,
Last outcome) in place of the old four-cell card that repeated two absent sentences per row.
`NEXT_RUN_MANUAL` is now said once, in a `Banner` above the list.
Proof: `procedures-list-words.test.ts`, `ProcedureList.test.ts` (component + reader unit),
`tests/integration/ui-cleanup-p2-reads.test.ts` (search/state/owner/pagination against
PostgreSQL — `%` literal, unknown state, exceeding a bounded page), and the new
`tests/e2e/procedures-list.spec.ts` (search narrows and survives a reload, combined
search+state+owner narrows to one Procedure, and the identical GET submission works with
`javaScriptEnabled: false`). `tests/e2e/procedures.spec.ts`'s two list-page tests are
rewritten for the new card (see "Fixed on top of the inherited work" below).

### UX-17 — Runs table: the contract's six columns, no page-level scroll
`apps/web/app/runs/page.tsx`, `apps/web/src/runs/RunsTable.tsx`,
`apps/web/src/runs/runs-list-words.ts` (new). `Run` (Procedure name, `<Reference>`,
`readablePeriod` beneath) · `Execution` · `Assessment` · `Evidence checks` · `Started`
(who, `<Timestamp>`, elapsed) · `Change` — `STATUS_COLUMN_WORDS` on the three status
headers, the Review column dropped with the caption saying why.
Proof: `RunsTable.test.ts`, `runs-list-words.test.ts` (reads EXPERIENCE.md's revised Data
tables row off disk for the six-column set), and — new this session — a browser test in
`tests/e2e/runs.spec.ts` that seeds a genuinely wide row (long Procedure name, a badge, a
stop-reason sentence) and asserts `document.documentElement.scrollWidth <= window.innerWidth`
at both 1366×768 and 1280×720, plus that the Run cell's rendered width stays ≥200px (the
`.ls-table th[scope='row']` 16rem min-width doing its job) rather than collapsing into a
one-word column. `tests/e2e/run-surfaces.spec.ts`'s one owned hunk (the column-header
assertion) is updated from the ten old headers to the six new ones; nothing else in that
package-5 file was touched.

### UX-30 / UX-35 / UX-36 — Reviews: two tabs, real queues, an honest unavailability Banner
`apps/web/app/review/page.tsx` (Procedures), `apps/web/app/review/results/page.tsx` (Results),
`apps/web/src/review/{reads,review-words,SubmittedVersions,PendingResults}.ts(x)`,
`packages/infrastructure/src/procedures/submitted-versions.ts` (`listSubmittedFor`, new).
Two routes behind one `Tabs` component; the sidebar's `/review` link lands on Procedures.
A manager sees the whole SUBMITTED queue; an auditor sees only the versions THEY submitted
or authored, under "Your versions waiting for an Audit Manager" — never another auditor's
work under a heading that would claim it as theirs. Results states plainly, as a `Banner`,
that this release cannot submit, approve or finalize a Result (with a manager-specific line
about there being nothing to approve), then lists the Runs whose Result really is waiting
for a confirmation.
Proof: `ReviewQueues.test.ts`, `review-words.test.ts`, `tests/integration/ui-cleanup-p2-reads.test.ts`
(four cases over `listSubmittedFor`: manager sees both, auditor sees only theirs, the scoped
total is its own count, an empty id claims nothing — proven by mutation: pointing the page
at `listSubmitted` fails the foreign-version case), and the new `tests/e2e/reviews.spec.ts`
(an auditor who submitted one of two versions sees only their own; a live-signed-in manager
sees both plus the Results Banner and a real pending Result with a working "Open the Result"
link).

### Sidebar counts
`apps/web/app/layout.tsx`, `apps/web/src/design/{Sidebar,nav-rules}.tsx(x)`,
`packages/infrastructure/src/runs/pending-results.ts` (`DrizzleActiveRunCounter`, new),
`apps/web/src/review/reads.ts` (`countReviewsAwaiting`, new). Runs (active, gated on
`run.initiate`) and Reviews (submitted-versions + pending-Results, gated per role) — absent
rather than a fabricated zero on a failed read.
Proof: `nav-rules.test.ts` (25 cases), `AppShell.test.ts`, and exercised live in
`tests/e2e/overview.spec.ts`'s manager test (`REVIEWS_LINK` present) and implicitly by every
other browser test that loads the shell.

### UX-32 — Notifications: the popover lists, the page reads
`apps/web/src/shell/{NotificationBell,bell-items}.ts(x)`, `apps/web/app/layout.tsx`,
`apps/web/app/notifications/page.tsx`. The popover now lists the open items themselves
(Procedure, kind, question/flagger, time remaining), each linking to its Run, with
"Open notifications" kept as the last link and its exact accessible name unchanged (the two
browser suites that already click it, `a11y.spec.ts` and `shell.spec.ts`, needed no edits).
`/notifications` renders every instant through `<Timestamp>`, every actor through
`ActorName`, and now also gives each row a `<TechnicalDetails>` disclosure carrying the raw
Run identifier — closed by default, so the ordinary reading of the page never meets a UUID,
matching the pattern `apps/web/src/runs/detail.tsx` already uses.
Proof: `apps/web/app/notifications/page.test.ts` (7 SSR cases — one rewritten this session,
see below), `bell-items.test.ts`, and — new this session — an assertion added to
`tests/e2e/escalations.spec.ts`'s existing `openFromNotifications` helper that opens the bell
live, with a real open Escalation seeded, and asserts the panel lists it (Procedure name,
"Waiting for your answer", "Time remaining:") before it ever reaches the Notifications page.

### UX-02 / UX-31 on these surfaces
Every instant on every surface listed above goes through `<Timestamp>`; every Run/attention
row is named through `<Reference>` or the Procedure's own name; every count uses `countNoun`
(`overviewBounded`/`bellBounded`/`reviewsBounded`/`matchedSentence`/`pageSentence`); the raw
UUID appears only inside `<TechnicalDetails>` (Notifications) or is absent from visible text
entirely (Overview, Reviews, Procedures, Runs).

### The two ledes
`OVERVIEW_LEDE` = "Your audit work and the items that need your attention." and `RUNS_LEDE` =
"Every Run, newest first: what it tested, how it ended, and whether its evidence can be
relied on." — both exactly the plan's wording, both pinned by `run-start-words.ts`-pattern
tests (`overview-words` is read inline in `AttentionList.test.ts`/`RoleLanding.test.ts`;
`runs-list-words.test.ts` pins `RUNS_LEDE` verbatim).

## Fixed in `25d9278`, on top of the inherited work

- **The uncommitted `apps/web/app/notifications/page.tsx` edit had two problems.** A
  `<details>` (from the new `<TechnicalDetails>` disclosure) was nested inside a `<p>` in the
  delivered-flag branch of `deliveredItem` — invalid HTML5 (`<p>`'s content model is
  phrasing-only, and `<details>` forces an implied `</p>` end tag), which would have produced
  a real hydration mismatch the moment a delivered flag notification existed. Changed the
  wrapper to a `<>` fragment, matching the other two call sites. And the one test this broke
  (`links a delivered Escalation to its Run with safe metadata only`) was asserting the raw
  UUID never appears as visible text ANYWHERE — true before the disclosure existed, false now
  that the disclosure is the SANCTIONED place for it. Rewrote the assertion to check the
  ordinary reading (everything before the `<details` tag) separately from the disclosure's
  own `<dd>`, so it proves the actual rule (never loose, only under the disclosure) instead
  of a rule the new markup was never going to satisfy. Both changes are in
  `apps/web/app/notifications/page.tsx` and `apps/web/app/notifications/page.test.ts`;
  7/7 tests pass.
- **The Procedures list redesign silently broke every Builder-entry test in
  `tests/e2e/procedures.spec.ts`.** The card's class changed from the generic `.ls-card`
  primitive to `.ls-procedure-card`, but roughly a dozen Builder tests in that
  package-3-owned file — none of which this package may edit — locate a Procedure to open
  by `page.locator('.ls-card').filter({ hasText: ... })`. Since `.ls-procedure-card` does not
  contain the token `ls-card`, every one of those locators would have resolved to zero
  elements the moment this branch merges. Fixed at the source: `ProcedureCard.tsx`'s `<li>`
  now carries `className="ls-procedure-card ls-card"`. This costs nothing visually —
  `.ls-procedure-card`'s rules are declared *after* `.ls-card`'s in `globals.css`, so at
  equal specificity they win on every property the two share (padding, gap, radius) — and it
  restores every existing `.ls-card`/`li.ls-card` locator in `procedures.spec.ts` and
  `runs.spec.ts` without touching a single Builder-owned assertion.
- **Two list-page tests in `procedures.spec.ts` and one in `runs.spec.ts` pinned the OLD
  card's shape and needed rewriting for the new one**, per the "rewrite it to pin the NEW
  behaviour" rule: `NEXT_RUN_MANUAL` moved from every card to one Banner above the list
  (UX-04), so the assertions that it was *inside* each card are now assertions that it is
  said once, above the list, and NOT repeated inside any one card. `procedures.spec.ts`'s
  "the card states all four cells" test is also rewritten to check the Active-version cell's
  text *specifically* rather than asserting "Draft" never appears anywhere on the card — the
  new "Newest version" cell legitimately says Draft for a fresh Procedure, and only the
  Active-version cell must never say so.
- **`tests/e2e/run-surfaces.spec.ts`'s ONE owned hunk** (the ten-column header list) is now
  the six-column list, with the test renamed from "the ten contract columns" to "the six
  contract columns" — nothing else in that package-5 file was touched.
- **Wrote the three missing browser specs the brief requires and that had never been
  created**: `tests/e2e/overview.spec.ts`, `tests/e2e/reviews.spec.ts`,
  `tests/e2e/procedures-list.spec.ts` (see "Findings" above for what each proves).
- **Added the missing UX-17 no-scroll/readable-column browser proof** to
  `tests/e2e/runs.spec.ts` (the brief's explicit acceptance test), and the missing
  live-bell-lists-an-item proof to `tests/e2e/escalations.spec.ts`.

## Defects the browser specs found when they were first run (fixed in `eb25ebb`)

- **Every "Open the Result" link on the Overview and on Reviews was a 404.** Both linked
  `/runs/{id}/result`; the Result tab is the Run's own page (`RUN_TABS`' empty slug), and no
  `result` route exists. The unit tests and the browser spec asserted the `href` string the
  component wrote, so they agreed with the defect. Now one function, `resultTabHref`, used
  by `AttentionList.tsx` and `PendingResults.tsx`; `review-words.test.ts` pins it against the
  route directory on disk (`app/runs/[id]/page.tsx` exists, `app/runs/[id]/result` does not),
  and `reviews.spec.ts` clicks the link and asserts the Run page opens. Proven by mutation:
  restoring `/result` fails 3 unit tests.
- **Recent Runs on the Overview used the raw UUID as the row's link text** (UX-02/UX-31:
  "no raw UUID as a primary label"). The five contract columns stay; the Run cell now reads
  `Run bf4ea3e7` (`referenceLabel`). `RecentRuns.test.ts` asserts the link text and that the
  UUID is not visible text; proven by mutation (restoring `row.runId` fails it).
  `runs.spec.ts` asserts the same in the browser.
- **Fixtures**: `overview.spec.ts` and `reviews.spec.ts` deleted versions before the
  submission notifications that name them (foreign key), so their teardowns threw and left
  rows that then failed `procedures.spec.ts`'s empty-list test; `reviews.spec.ts` inserted a
  `COMPLETED` Run before its Result (generation 25 refuses that per statement);
  `procedures-list.spec.ts` overrode `templateId` on the P-4-only plan fixture, which
  `deriveExecutablePlan` refuses, and expected a `search=` query parameter where the form
  uses `q=`. Its label locators are now the exported constants with `exact: true` (two
  labels contain "newest version"). The two manager journeys THROW when
  `E2E_MANAGER_EMAIL` is missing instead of calling `test.skip`.
- **`runs.spec.ts` (mine) still pinned the old Run cell and a package-1 change.** Rows are
  found by `a[href="/runs/{id}"]` now that the link is the Procedure name; the id-wraps-at-
  hyphens assertion is replaced by "the link is the Procedure name, the short reference is
  on the row, the full id is not". The queued-Run test read `getByText(/2026-08-01/).first()`,
  which since `290ca5f` (package 1) first meets the CLOSED Technical details copy of the
  period; it now asserts the header's readable `1–31 Aug 2026` and the exact dates in the
  Run details section.

## Verification (from the worktree, env sourced, after `pnpm build` on this machine)

- `pnpm build` — pass.
- `pnpm --filter @intellifin/web typecheck` — pass. Root `pnpm typecheck` — pass.
- `pnpm boundaries` — pass (677 modules, no violations).
- `pnpm exec vitest run apps/web` — 107 files, 1808/1808 pass.
- `pnpm exec vitest run packages/infrastructure tests/unit` — 66 files, 942/942 pass.
- `tests/integration/ui-cleanup-p2-reads.test.ts` — 17/17 pass.
- Browser, one run: `procedures`, `overview`, `reviews`, `procedures-list`, `runs`,
  `escalations`, `shell`, `a11y`, `run-surfaces` — **86 passed, 1 failed**. The failure is
  `run-surfaces.spec.ts:240`, `getByText(/^Updated \d{4}-\d{2}-\d{2}T/)`: package 1's
  `290ca5f` made the "Updated" strip readable (`22 Sep 2026, 17:05 UTC`), so it fails on the
  base commit too. That line is package 5's (see below). Every fixture row the run created
  was removed (`procedure` count 0 afterwards).

## Left out and why

- **Pagination past the 20-row page size is not click-tested in the browser.** Seeding 21
  compiled Procedure Versions to force a second page is expensive for a fact the reader
  already proves against real PostgreSQL: `tests/integration/ui-cleanup-p2-reads.test.ts`
  asserts `page.total` exceeds `page.rows.length` and that the offset/limit math is exact.
  The browser specs prove every OTHER new behaviour (search, filter, GET semantics, no-JS)
  end to end instead.
- **No browser test asserts a PoC Administrator refused at `/review` or `/runs` directly.**
  `runs.spec.ts`'s existing "Run access as an administrator" block already proves the
  server-side refusal pattern for Run surfaces, and the role policy itself
  (`roles.test.ts`, 24 actions × 3 roles) is package-1's and unconditional; adding a third
  copy of the same server-side-refusal proof for Reviews would test the identity/role layer
  a fourth time rather than anything this package built.
- **The bell popover's empty-inbox state (`BELL_EMPTY`) is proven only at the unit level**
  (`bell-items.test.ts`) and implicitly by `shell.spec.ts`'s existing disclosure tests (which
  run against accounts with nothing open). A dedicated browser assertion of the empty
  sentence was judged lower value than the live-item proof added to `escalations.spec.ts`,
  which is the state the finding (UX-32) was actually about.

## Needs a change outside my scope

- **`tests/e2e/run-surfaces.spec.ts:240` (package 5).** Replace
  `page.getByText(/^Updated \d{4}-\d{2}-\d{2}T/)` with
  `page.getByText(/^Updated \d{1,2} [A-Z][a-z]{2} \d{4}, \d{2}:\d{2} UTC/)` (the readable
  strip `LiveBanner` renders since `290ca5f`). I changed only the column list and, in the
  same test, the row locator my column change broke.
- **Edits made outside the listed files, all additive, for the merge reviewer:**
  `apps/web/src/design/DataTable.tsx` (optional `first.detail` line under the first cell,
  for the Run cell's reference and period; absent means unchanged output);
  `apps/web/src/form-method.test.ts` (a `<form method="get" data-readonly-filter="true">`
  is the one exception to the POST rule, with its own guard tests; an unmarked GET still
  fails); `packages/infrastructure/src/index.ts` and `src/procedures/index.ts` (barrel
  exports for the two new read files). `DrizzleSubmittedVersionReader.listSubmitted` keeps
  its signature and result; it now shares a private `page()` with the new `listSubmittedFor`.

## Gotchas for CLAUDE.md

- **A link's `href` asserted as a string proves nothing about the route.** Both Result links
  pointed at a route that does not exist and three tests agreed. Pin a link helper to the
  route directory on disk, and have one browser test FOLLOW the link.
- **A browser spec written and never run is not a test.** Four fixture defects and two
  product defects sat in specs a report described as passing. Run every new spec once, then
  check the database for rows its teardown should have removed.
- **A teardown must delete `notification` rows before the versions they name.** Submitting a
  version notifies every Audit Manager with a foreign key to the version; a teardown that
  skips it throws, leaves the Procedure, and fails `procedures.spec.ts`'s empty-list test.
- **A redesigned card keeps the class other packages' tests locate it by** (`ls-card` beside
  `ls-procedure-card`; the later rules still win in the cascade).
- **`<details>` can never sit inside a `<p>`**: the parser closes the `<p>` early, which is a
  hydration mismatch `renderToStaticMarkup` cannot show.
