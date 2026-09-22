# UI cleanup package 4 — the manager's Procedure Version review

Branch `ui/p4`, on `7b6a695`. Two commits: the surface, then the browser spec that pinned
the surface it replaces.

The walkthrough measured the submitted-version review at **13,887px**: fourteen `<details>`
forced open, every one of them labelled "Changed" on a version that has no predecessor, the
executable plan rendered twice, and Approve / Reject at the very bottom of all of it. The
repair is an order, not a deletion — nothing that was on the page has left it.

---

## UX-33 — lead with a decision summary

**What changed.** `app/procedures/[id]/versions/[versionId]/page.tsx` now reads in the order
a decision is taken: the decision (UX-34, below), then a summary of what is being decided,
then what changed, then the history, then the plan at decision altitude, then ONE technical
disclosure holding the frozen contract.

`apps/web/src/procedures/review/` is the new surface, and every function in it READS the
version's own frozen inputs and returns words. Nothing is compiled, defaulted or inferred: a
summary that could disagree with the contract underneath it would be worse than no summary,
because it is what an approver actually reads before an approval activates a Procedure.

| Section | Reads | Module |
| --- | --- | --- |
| What is being tested | `controlName`, the Template's own **name**, the Control, Objective, Risk and Criterion-reference sections | `decision-summary.ts` → `sectionText`, `review-words.ts` → `templateWords` |
| Which records this covers | Period as `readablePeriod`, scope, the source's display name, how records arrive, how their count is confirmed, its declared and masked fields, each filter as a sentence | `periodWords`, `sourceFacts`, `fieldList`, `filterSentences` |
| Where the agent looks, and what it may do there | each frozen Target: its kind in words (`TARGET_KIND_WORDS`), the registered read actions in words, the frozen origins, the auditor's instruction | `systemAccess`, `readActionWord` |
| What counts as a finding | `conditionSentence(...)` from `condition-words.ts`; where the shared reader cannot express a criterion, `CONDITION_NOT_IN_WORDS` **and the approved text verbatim** | `criteria` |
| Proof kept for every record | each Evidence Requirement as what is kept, in words rather than flags | `evidenceWords` |
| How often this is meant to run | `scheduleLine` beside `RUN_STARTS_ON_CONFIRM_SENTENCE` + `NO_AUTOMATIC_RUNS_SENTENCE` — a plan, never a schedule | `plannedFrequencyWords` |
| Access limits | read-only said ONCE, credentials named by reference only | `review-words.ts` |

- **`templateWords` falls back to the stored id rather than throwing.** `findProcedureTemplate`
  THROWS on an id it does not ship and the id here comes from a stored frozen review, so a
  version frozen under a Template a later build removed would take the whole approval surface
  down with it.
- **`readActionWord` and `sectionTitle` are `Object.hasOwn`-guarded.** Both keys arrive from a
  stored frozen contract typed `string`; a plain index answers `'constructor'` with an
  inherited function. An unrecognised value keeps its stored spelling, which is honest.
- **A criterion the audit reader cannot express gets no invented sentence.** P-4's Template
  criterion is frozen prose with no simple shape; a sentence guessed there would describe a
  rule the version did not freeze.
- **Every empty state names what would be here and refuses to imply a passed control** — "No
  criterion is frozen with this version, so a Run of it could reach no finding."

**What changed, in words.** `changed-sections.ts` reads BOTH sides of each stored
`VersionSectionDiff` into the same labelled facts the summary says, and reports only the
facts whose words differ, as `before → after`.

- **A first version says "First version: nothing to compare." and lists nothing.**
  `diffReviewedDefinitions` marks every section of a first version `changed: true` —
  `isConsistentVersionReview` requires exactly that of a review with no baseline — so
  rendering the stored flag told an approver that fourteen sections had been changed by
  somebody, on a version with no predecessor at all.
- **A section that changed only in its frozen contract is COUNTED, never dropped.** A section
  whose one difference is a compiler or schema version has nothing to say in words; dropping
  it would report "nothing changed" over a section that did. It is counted into
  `technicalChanged` with a sentence pointing at Technical details.
- **The arrow is `aria-hidden` beside a visually hidden "became"**, so a screen-reader user
  hears the change rather than a symbol.

**One plan, once.** `AgentSummary` stays in the ordinary flow as the decision-level view;
`ExecutablePlanPreview` — the contract — is rendered exactly once, inside the disclosure.
Both files keep every prop they had (`AgentSummary` still takes `readiness`, unchanged), so
the Builder, which package 3 owns, is untouched.

**The frozen contract, under one disclosure.** `TechnicalDetails` holds the version, Procedure
and Template identifiers, the compared-with version id, the submitted instant and the reviewed
row revision (all monospace), then `FROZEN_CONTRACT_SENTENCE`, then `ExecutablePlanPreview`
(which carries `IDENTITY_KEYS_EXACT_SENTENCE` beside the frozen plan text, where that sentence
must stay), then the stored section-by-section diff.

`VersionDiff` is kept, not deleted — the walkthrough's rule is to move implementation detail
into a deliberate technical view rather than delete provenance. Two changes inside it: a first
version's sections read **New** rather than Changed, and every section starts **closed** (a
first version used to force all fourteen open, which is most of the 13,887px). It also takes
an optional `headingId`, so the page gives it a heading inside the disclosure.

**Tests.** `review/review-words.test.ts` (33), `review/decision-summary.test.ts` (22),
`review/changed-sections.test.ts` (11), `review/DecisionSummary.test.ts` (15), and
`VersionReviewPage.test.ts` rewritten and extended to 21, `VersionDiff.test.ts` to 4.

---

## UX-34 — a persistent decision bar

**What changed.** `review/DecisionBar.tsx` sticks to the top of the CONTENT column (the shell's
own top bar scrolls away with the document, so `top: 0` is the viewport's top and nothing
overlaps it). It carries the exact version — `Version 3 · <Procedure name>` — the state badge,
the author, who submitted it and when as a `<Timestamp>`, the version's own status sentences
(`VersionStatus`, unchanged), the ONE saved decision, and the ONE set of decision controls.

- **There is exactly one set of decision controls on the surface.** A second copy would give a
  manager two Approve buttons for one version and a guard withdrawn on one of them; the page
  test asserts `data-subject-control` appears once.
- **"Saved decision" is said ONCE.** It used to be a heading above the content AND the last row
  of the Decision history directly below it.
- **The history is a native `<details>`** that says how many decisions it holds while closed,
  so closing it hides nothing a reader needs in order to decide to open it. Native, so it works
  before hydration and with no JavaScript at all.

**Every guard is unchanged.** `VersionActions` is not edited at all: the same Server Action,
the same `procedureVersionRowVersion` token, the same `AUTHOR_CANNOT_APPROVE_SENTENCE` for the
author and role denial for a non-manager, the same confirmation dialog explaining what approval
activates, the same rejection rationale requirement, the same `<fieldset disabled>` pre-hydration
guard and the same lost-response withdrawal. This moved where they are rendered, not what they do.

**The deployed acceptance harness is unaffected.** `scripts/verify-deployed-loancore.mjs` drives
this page by `getByRole('button', { name: 'Approve', exact: true })`, the dialog's `Approve`
confirm label, and `getByText('Submitted' | 'Active', { exact: true }).first()` — the state
badge, which the decision bar still renders. **No control or label was renamed.**

---

## UX-02 / UX-31 on these surfaces

- Every instant goes through `<Timestamp>`: the decision history, the submitted-by line, the
  saved decision, and the submitted-at technical item. `utcStamp` is gone from this page. A
  `+02:00` stored instant now reads `4 Sep 2026, 23:00:00 UTC` with the same instant exactly in
  `datetime`; the old test PINNED the raw stored offset and was rewritten to pin the new rule.
- `countNoun` for the history's decision count — `1 decision`, `3 decisions`.
- No `<Reference>` is used: the summary needs no identifier at all, so none is shown. Every raw
  id is under `TechnicalDetails`, monospace, and the page test asserts none is rendered as text
  above the disclosure.
- Sentence case throughout; `periodWords`, `filterSentence` and `evidenceWords` replace the
  frozen vocabularies (`versioned-file`, `cover-sheet`, `structural-snapshot`) with words.

---

## Layout (house rule 8)

**No page-level horizontal scrolling at 1366×768 or 1280×720.** The technical disclosure
holds the widest content this surface renders — `ExecutablePlanPreview`'s canonical plan
text, monospace identifiers, the stored section diff — so the check runs with that
disclosure OPEN, at both laptop viewports, inside the existing acceptance journey
(`version-review.spec.ts`): `document.documentElement.scrollWidth <=
document.documentElement.clientWidth`. It runs once, on the Auditor's page, right after the
disclosure is opened and the plan preview and diff are confirmed visible — the state in
which the page is widest, so a narrower assertion elsewhere would prove less.

---

## Proven by mutation

Each mutation was applied to a copy-aside of the file and restored from the copy.

| Mutation | Test that failed |
| --- | --- |
| `VersionDiff` labels a first version's sections from the stored `changed` flag | `VersionDiff.test.ts` "says a first version's sections are New" and `VersionReviewPage.test.ts` "says a first version has nothing to compare" |
| The page renders `ExecutablePlanPreview` a second time, outside the disclosure | `VersionReviewPage.test.ts` "renders the executable plan contract ONCE, inside the technical disclosure" |
| `readActionWord` uses a plain index instead of `Object.hasOwn` | `review-words.test.ts` "keeps an unrecognised stored action rather than inheriting a function" |
| `versionChanges` drops a section whose facts do not differ instead of counting it | `changed-sections.test.ts` "counts a section that changed only in its frozen contract, never dropping it" |

---

## Assertions rewritten because they pinned the OLD behaviour

All in `tests/e2e/version-review.spec.ts`. Every guard assertion in that file is kept
unchanged — the author cannot approve, a second person can, the exact version is approved, the
lost decision response withdraws both controls and posts exactly once, and the sealed
`procedure_version` row is compared as before.

| Was | Is |
| --- | --- |
| `locator('details')` count 14 and `details:not([open])` count 0 | the summary's own headings, `FIRST_VERSION_SENTENCE`, no `· Changed`, one closed `details.ls-technical` holding the only `executable-plan-preview` and the stored diff |
| `getByRole('region', { name: 'Decision history' })` | `[data-decision-history]`, its summary's count, then opened and read |
| `getByText('Rationale: …')` visible after a rejection | `getByText('Rejected: …')` — the decision bar's own status sentence, which is where a manager meets it without opening anything |
| `getByRole('heading', { name: 'Saved decision' })` | `[data-saved-decision]` inside `[data-decision-bar]`, asserted to appear exactly once on the page |

`immutable-versions.spec.ts` needed no change: its one assertion on this page is the Retired
status sentence, which the decision bar still renders. `executable-plan.spec.ts` was not
touched — every assertion in it is on the Builder.

---

## Verification

Run from the worktree with the package environment sourced.

| Gate | Result |
| --- | --- |
| `pnpm --filter @intellifin/web typecheck` | pass |
| `pnpm typecheck` (root, includes `tests/`) | pass |
| `pnpm boundaries` | pass — no violations, 669 modules cruised |
| `pnpm exec vitest run apps/web` | **1836 passed, 105 files** |
| `playwright test tests/e2e/version-review.spec.ts` | **6 passed** (second run; the first failed in `auth.setup.ts` on cold-`.next` route compilation, the documented 10-second timeout, and nothing else ran) |
| `playwright test immutable-versions executable-plan a11y shell` | **31 passed** |

WCAG 2.1 AA: `a11y.spec.ts` and both in-spec axe scans of the review surface (before and after
the approval) pass with no violations and no allowlist.

**Reconfirmed** after PostgreSQL was restarted and the horizontal-scroll check (above) was
added to `version-review.spec.ts`: same eight gates, same worktree, fresh run, identical
counts throughout — including the 6/6 on `version-review.spec.ts` FIRST attempt this time
(no cold-`.next` timeout), with the new scroll assertion passing at both viewports. Nothing
changed between the two runs except that the layout check is now committed.

---

## Left out and why

- **`scripts/verify-deployed-loancore.mjs` is unchanged.** It drives the page by control name
  and by the state badge, and neither moved; editing it would have been a change with nothing
  to fix.
- **`plan-numbers.ts` is unchanged.** Its job — saying a frozen number the way a person reads
  it — is already what UX-31 asks for, and its 21 tests pass.
- **`AgentSummary` keeps its readiness panel on this surface.** Readiness is advisory and this
  page has nowhere else to put it; removing it would take a real fact off the approver's page
  to make the page shorter.
- **The summary reads the DRAFT row for a version with no frozen review.** A Draft opened at
  this route has nothing frozen to compare, and `WhatChanged` says exactly that rather than
  claiming it is a first version — two different statements.

## Needs a change outside my scope

- **EXPERIENCE.md state table, line 137**: `| Version review | First version | Diff against
  nothing: every section shown expanded |`. The appended UI-cleanup section (line 382) now
  governs, and the two disagree. The row should read: a first version states it has nothing to
  compare and marks no section changed; the stored sections stay under Technical details as
  New, closed. I may not edit EXPERIENCE.md, so it is reported here.
- **`ExecutablePlanPreview` is rendered by the Builder outside any technical disclosure**
  (package 3 owns that placement). On this surface it is inside one. If the Builder wants the
  same treatment, that is package 3's call; the component needs no change either way.
- **`apps/web/app/review/page.tsx`** — the Audit Manager's Review landing — still shows an
  ordinary empty state while a Procedure Version waits for that manager. It is package 2's
  file; already named in CLAUDE.md as the third face of that defect.

## Gotchas for CLAUDE.md

- **A first version's stored diff flags EVERY section `changed`, and that flag is not a
  claim about a person.** `diffReviewedDefinitions` writes it because a review with no
  baseline must, so any surface that renders it must ask for the baseline first.
- **A "changed" section with no visible difference must be counted, not skipped.** Dropping
  a section whose only difference is a compiler or schema version reports "nothing changed"
  over a section that did; count it and point at the technical view.
- **`findProcedureTemplate` throws on an unknown id, and the id comes from a stored frozen
  review.** Any surface that names a Template must fall back to the stored id, or a version
  frozen under a removed Template takes the whole page down.
