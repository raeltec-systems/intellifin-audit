---
title: "Story 3.11: See Runs and inspect an adapter Run's Result, Evidence, Exceptions and Timeline"
type: 'feature'
created: '2026-09-05'
status: 'ready-for-dev'
review_loop_iteration: 0
followup_review_recommended: false
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-3-context.md'
  - '{project-root}/docs/contracts/executable-plan-v1.md'
warnings: []
deferred:
  - 'Live View, Watch, Pause/Resume, Escalation and Replay (Epic 5)'
  - 'Submit for review, Exception disposition, Export Workpaper Bundle, Overview (Epic 6)'
  - 'Tool Action Timeline rows (Epic 4, agent execution)'
---

<intent-contract>

## Intent

**Problem:** Everything the epic produces is invisible. `/runs` is an inert placeholder and
`/runs/[id]` is a single scrolling page that grew one section per story. An auditor cannot
see which Runs exist, what a Run concluded, which Gate rows failed, what Evidence was
captured, which Exceptions were raised, or what the execution actually did, without reading
the database.

**Approach:** Build the Runs list and the Run Detail tabs the UX contract specifies, reading
at request time behind the contract's refresh banner, so an auditor can act on a Run without
reading logs.

## Boundaries & Constraints

**Always:** The Runs table shows ten columns in the contract's order — Run, Procedure,
Effective period, Lifecycle, Result outcome, Gate, Review, Initiator, Elapsed, Change —
with the Run cell the row's only link, skeleton rows on a cold load, pagination rather than
infinite scroll, and the verbatim `Updated {time}. Refresh.` banner. Every badge carries an
icon and a word from one of the nine DESIGN.md families and never colour alone. Run Detail
renders five tabs in order — Result, Evidence, Exceptions, Review, Execution Timeline — each
its own route, navigated by links in a `<nav>` with `aria-current`, never `role="tab"`. The
Result tab carries the conclusion triptych: three cells, Run lifecycle then Evidence Quality
Gate then Result outcome, the third always showing the outcome badge, the sealed or unsealed
marker and the Result version in monospace, over the statement generated from the Result. No
triptych cell is clickable. The Gate checklist groups the addendum H rows under two overline
headers, Per-Observation checks and Run-level checks, each row showing a status icon, the
check name and status word, the diagnostic detail and the rule applied, with a derived header
count and every failed row linking to the Work Items it names. Evaluation cards show the
origin badge, the value badge and the condition text, with no controls. Evidence cards carry
the six FR-31 fields and a kind badge, and a `sheet` or `json` snapshot opens the grounding
inspector showing original value, normalized value, the snapshot it was read from, the
locator and field label in monospace, and the corroboration badge. The Timeline nests Session
Step, Work Item and Step Execution rows on the four-column grid at 20px per level, collapsed
to Work Item rows by default except that errors, limits consumed and version stamps stay
expanded. An Inconclusive or Run Failed Run shows its failed Gate rows first and a Safe next
action panel. Every read is a request-time read; there is no polling and no auto-refresh.

**Block If:** A required column or tab has no data behind it because an earlier story never
captured it.

**Never:** Do not build the five-second live channel, Live View, Watch, Pause, Resume,
Escalation or Replay — all Epic 5, and the request-time reads here must stay compatible with
them. Do not add Submit, Exception disposition or Export controls — Epic 6. Do not render a
Tool Action Timeline row — Epic 4. Do not put an accessible name on an element that cannot
carry one. Do not add a row-level click handler. Do not invent user-visible copy: a sentence
either comes from the UX artifacts or is stated in this spec as ours.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Cold load | Runs list, no cache | Skeleton rows, then the table with all ten columns | None |
| No Runs at all | Empty table | The unfiltered empty state; an empty list never reads as "fine" | None |
| Stale data | Any request-time read | `Updated {time}. Refresh.` banner on Runs and Run Detail | Never silently stale |
| Queued Run | `QUEUED` | Triptych Queued / Not evaluated / No conclusion issued; Evidence tab shows `No Evidence collected.` | None |
| Running Run | `RUNNING` | Gate rows and Timeline as they stand at request time | No polling |
| Completed unsealed | Gate passed, evaluation pending | Outcome Pending Confirmation with the pending count | Epic 6 confirms |
| Completed sealed | Pass or Control Failure | Sealed marker, Result version, generated statement | None |
| Inconclusive | Failed Gate rows | Failed rows first, Safe next action panel | Stated reason |
| Run Failed | Execution failure | Panel naming the Session Step, retries and error class | None |
| Canceled | Human cancellation | Cancelling actor and elapsed time; Evidence preserved | None |
| Grounding inspector | A `sheet` or `json` snapshot | Original, normalized, snapshot, locator and label in monospace, corroboration badge | None |
| Unknown badge state | A row value outside the vocabulary | Written in words, never guessed into a badge | `StatusBadge` throws on an unknown state |
| Malformed Run id | `/runs/%E0%A4%A` or a non-UUID | A safe not-found page | Never a framework 500 |
| Denied role | A role without the action | The gating table's sentence, before any Run fact is exposed | Denial audited |
| Narrow viewport | 1024-1239px, then 900-1023px | Horizontal scroll with the identifier column fixed, then label/value stacks | None |

</intent-contract>

## Code Map

- `apps/web/app/runs/page.tsx` — today an inert `EmptyState` placeholder so the nav item
  resolves. This story replaces it with the real Runs list. Its empty-state sentence is
  already right ("An empty list does not mean a control passed."); keep it, and see the
  Design Notes on why it is not pinned against the UX artifacts.
- `apps/web/app/runs/[id]/page.tsx` — 123 lines of Run Detail grown story by story:
  lifecycle badge, Run details list, Population acquisition, Target System execution and
  Evidence package sections, plus the `?after=` reasons pagination. This story reorganizes
  it into the five tabs. Do NOT delete what is there; every section already reads a stage's
  real rows and each belongs under one of the tabs.
- `apps/web/src/design/Tabs.tsx` — already written FOR this surface: links in a `<nav>` with
  `aria-current`, deliberately not `role="tab"`, because a tablist with no tabpanel beside
  it is a broken ARIA pattern that announces a widget the page does not have. Each tab is
  its own route. Use it; do not build a widget.
- `apps/web/src/design/DataTable.tsx` — `caption`, a `first` column that is the row header
  and the row's only link, `columns`, `rows`, `rowKey` and a required empty state. There is
  no `onRowClick` prop and there must not be one.
- `apps/web/src/design/StatusBadge.tsx` and `status.ts` — all eight named families exist:
  `run-lifecycle`, `evidence-quality-gate`, `result-outcome`, `work-item`,
  `evaluation-origin`, `evaluation-value`, `auditor-review`, `procedure-version`.
  `status.test.ts` reads the DESIGN.md table off disk. A badge takes a family and a state
  and derives the word, treatment and icon; an unknown state THROWS, which on a page is a
  500, so an out-of-vocabulary value is written in words — the existing `workItemState`
  helper in `[id]/page.tsx` shows the pattern.
- `apps/web/src/design/Digest.tsx` — the ONE way a 64-character digest is rendered: the full
  value `aria-hidden` beside a visually hidden spoken form. `Digest.test.ts` scans every
  `.tsx` and refuses `aria-label` on an element that cannot carry one.
- `apps/web/src/design/copy.ts` and `copy.test.ts` — every sentence quoted from EXPERIENCE.md
  or DESIGN.md lives here and is pinned character for character against the artifact on disk.
  None of this story's sentences are there yet; all of them must be added.
- `apps/web/src/design/EmptyState.tsx`, `Banner.tsx`, `Button.tsx`, `UnavailableActions.tsx`
  — a disabled action is `aria-disabled` with a visible reason sharing one DOM node through
  `disabledReasonId`, never `disabled`.
- `apps/web/src/shell/breadcrumb-rules.ts` — `rendersOwnTrail` is the one place that knows a
  page renders its own breadcrumb, and the shell stands down there. Two
  `<nav aria-label="Breadcrumb">` on one page are two landmarks nobody can tell apart, and
  the accessibility gate CANNOT catch it (`landmark-unique` is best-practice, not
  WCAG-tagged, so it never reaches `results.violations`).
- `apps/web/src/server-session.ts` and `require-role.ts` — `requireServerAction` resolves the
  session, reads the role on every request and audits a refusal. Every Run surface is
  protected by default-deny already; the page still calls it.
- `packages/infrastructure/src/runs/` — the read models this surface renders:
  `run-repository.ts` (`findRun`), `population-repository.ts` (`readPopulation`, paged),
  `adapter-execution-repository.ts` (`readExecution`), `evidence-package-repository.ts`
  (`readSealedPackage`), plus the Gate rows Story 3.8 wrote, the Exceptions Story 3.7 wrote
  and the sealed Result Story 3.9 wrote. The Runs LIST needs a new read: a background job
  must not borrow a surface's read and a surface must not borrow a job's (Story 1.8).
- `tests/e2e/runs.spec.ts` — 251 lines already covering initiation, lost acknowledgements,
  malformed and absent ids, a no-JavaScript journey and an administrator's denial. Extend
  it; `auth.setup.ts` signs in twice and the suite reuses the state, because
  `/sign-in/email` is rate limited and the limiter is real production behaviour.
- `tests/e2e/a11y.spec.ts` — the WCAG 2.1 AA gate. A violation fails the pull request and
  there is no allowlist.

## Tasks & Acceptance

**Execution:**
- `apps/web/src/design/copy.ts` — every sentence this story renders, quoted verbatim, with
  `copy.test.ts` reading EXPERIENCE.md and DESIGN.md off disk and requiring each character
  for character. At minimum: `Updated {time}. Refresh.`, `No Evidence collected.`,
  `Not comparable — versions differ`, `Missed 06:00 UTC start; not run`,
  `Submission is unavailable while the Result is unsealed.`,
  `Submission is unavailable for an Inconclusive Run. No conclusion exists to review.`
- A Runs list read model in `packages/infrastructure/src/runs/` — its own query, keyset
  paged, returning exactly the ten columns' data and nothing else.
- `apps/web/app/runs/page.tsx` — the table, the skeleton, the empty state, the banner and
  the pagination.
- `apps/web/app/runs/[id]/` — five tab routes, each rendering its own section, with the
  triptych, the Gate checklist, the evaluation cards, the Evidence cards, the grounding
  inspector, the Exceptions list and the Timeline distributed across them.
- `apps/web/src/runs/` — the components: triptych, Gate checklist, evaluation card, Evidence
  card, grounding inspector, Timeline. A kind badge and a corroboration badge get their own
  small component; they are NOT added to `status.ts`.
- `apps/web/app/globals.css` — a rule for every new class, or `stylesheet.test.ts` fails; a
  `var(--x)` naming nothing falls back silently and that test now catches it too.
- Tests — component tests for the read-model projection and the badge fallbacks; browser
  coverage of each lifecycle state, the grounding inspector, the Timeline collapse rule, the
  narrow viewports and a denied role, with axe clean on every new route.

**Acceptance Criteria:**
- Given Runs exist, when an authorized user opens `/runs`, then the table shows the ten
  contract columns in order, the Run cell is the row's only link, and the refresh banner
  names the read time.
- Given a Run in each of the six lifecycle states Epic 3 can reach, when its detail page is
  opened, then the triptych, the enabled and unavailable actions, and the state's own panel
  match the contract row for that state.
- Given a Run whose Gate failed, when the Result tab is opened, then the failed rows come
  first, each names its rule and diagnostic, each links to the Work Items it names, the
  header count is derived, and a Safe next action panel is present.
- Given an Observation with a `sheet` or `json` grounding, when the attribute is opened, then
  the inspector shows the original value, the normalized value, the snapshot, the locator and
  label in monospace, and the corroboration badge.
- Given any new route, when axe runs against it, then there are zero WCAG 2.1 AA violations.

## Spec Change Log

## Review Triage Log

## Design Notes

The UX contract has six gaps on these two surfaces. Each is decided here rather than left to
the implementer, so that two people reading this build the same thing.

**1. No default sort is stated for the Runs table.** Order by `initiated_at` descending, then
`run_id` descending. `run_id` is a UUIDv7 so it is already time-ordered, which makes it a
deterministic tiebreak rather than an arbitrary one — and a keyset page needs a total order
or a row can appear on two pages.

**2. No verbatim empty-state sentence exists for the Runs surface.** The placeholder page
already carries one written for this repository: "A Run, its lifecycle state, and its sealed
Result would be listed here. An empty list does not mean a control passed." Keep it. It is
OURS, not quoted, so `copy.test.ts` must not pin it against the artifacts — pinning a
sentence against a file that does not contain it is a test that cannot pass, and pinning it
against our own module is a contract compared with a copy of itself.

**3. The Review column has no stated semantics.** It is the Auditor Review family — Draft,
Submitted, Approved, Finalized. Epic 3 creates no review, and Story 6.3 is what submits one,
so in this epic every row shows the absent marker `—`. Rendering "Draft" for a review nobody
started would state a fact that is not true, which is the "Active version: Draft" defect from
Story 2.1 in a new column.

**4. The Change column has no stated semantics.** It is the compact form of the rail card
"Change since previous Run", and it is computable now: Story 3.7 gives every Exception an
HMAC fingerprint over five keys with the Run deliberately absent, precisely so the same
finding recurring in a later Run is recognisable. Compare this Run's fingerprint set with the
previous terminal Run of the same Procedure. Only across compatible versions; otherwise the
verbatim `Not comparable — versions differ`. With no previous Run, the absent marker.

**5. "Written live while Running" contradicts "no auto-refresh of detail pages except Live
View."** The resolution is that the two sentences describe different things. The backend
WRITES the Timeline as the Run executes; the page SHOWS what exists when the request is
served. There is no polling, no streaming and no auto-refresh here, and the
`Updated {time}. Refresh.` banner is what tells the reader the page is a snapshot. Epic 5
adds the live channel on Live View, and these request-time reads stay compatible with it.

**6. Two badge kinds are outside the nine families and have no colour or icon mapping.** The
Evidence item kind (Structural Snapshot, Screenshot, Source excerpt, Recording segment,
Adapter extract) and the grounding corroboration badge (matched, contradictory, model-read)
must NOT be added to `status.ts`: that module is pinned against the DESIGN.md table by a test
that reads it off disk, and adding a row the table does not have would break the claim that
the module IS the table. They get their own small component using the generic status-badge
styling, with a word and an icon each, because "never colour alone" is a floor for every
badge and not only for the nine.

**Submit and Export are not rendered at all.** Story 6.3 submits a Result and Story 6.7
exports the bundle; a control that does nothing, or a disabled control with a reason nobody
wrote, is worse than a control that is not there yet. What the reader actually needs on an
Inconclusive or Run Failed Run is the Safe next action panel, which the contract requires and
which this story builds. The two disabled-Submit sentences are still transcribed into
`copy.ts` now, so Story 6.3 uses the contract's words rather than retyping them — the
fourth-retyping lesson from the denial strings.

**The Timeline has three levels here, not four.** Session Step, Work Item, Step Execution.
Tool Action rows come from agent execution in Epic 4, and "Open in Replay" is Epic 5. Build
the nesting so the fourth level and the link slot in without a rewrite.

**Every tab is its own route, so every tab authorizes for itself.** Reaching one is not a
precondition for reading another, and default-deny plus `requireServerAction` on each page is
what makes that true rather than a convention.

## Verification

**Commands:**
- `pnpm typecheck` — expected: 0 errors.
- `pnpm boundaries` — expected: no violations.
- `pnpm test` — expected: all pass, run alone.
- `pnpm db:migrate` then `pnpm test:integration` — expected: all pass against PostgreSQL 18
  on a database whose name contains `test` or `ci`. This story is expected to add no
  migration; if it does, raise `SUPPORTED_SCHEMA_MIN`/`MAX` together and list any new table
  in `tests/integration/schema-compat.test.ts`.
- `pnpm db:generate` — expected: no drift.
- `pnpm build`, `pnpm --filter @intellifin/web build`, `pnpm test:e2e` — expected: pass, no
  accessibility violations.

## Auto Run Result
