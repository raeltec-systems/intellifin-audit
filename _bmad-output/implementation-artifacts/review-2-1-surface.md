---
title: 'Adversarial review — Story 2.1 surface (apps/web + tests/e2e)'
scope: 'apps/web/**, tests/e2e/procedures.spec.ts'
reviewer: 'adversarial code reviewer (Claude Code subagent)'
date: '2026-09-04'
---

# Review: Story 2.1 — Create a Procedure from a Template (web surface)

Scope per instructions: `apps/web/**` and `tests/e2e/procedures.spec.ts` only. Everything
in `packages/domain`, `packages/application`, `packages/infrastructure` and
`tests/integration` is out of scope (owned by another reviewer) except where an apps/web
file imports something from it and the question is whether the web layer uses it safely.

Diff reviewed: `git diff main...HEAD -- apps/web tests/e2e` (17 files, 1781 insertions).

All claims below were reproduced by reading the code, running the actual test files, or
(where noted) a mutation plant-and-revert. Nothing here is asserted from memory of the
pattern alone.

---

## Blockers

### B1. The Procedure Detail and Builder pages render TWO breadcrumb navs at once, with contradictory content

**Files:**
- `apps/web/app/procedures/[id]/page.tsx` (renders `<DetailTrail trail=.../>`)
- `apps/web/app/procedures/[id]/builder/page.tsx` (renders `<DetailTrail trail=.../>`)
- `apps/web/src/procedures/DetailTrail.tsx:30` (`<nav className="ls-breadcrumbs" aria-label="Breadcrumb">`)
- `apps/web/src/shell/AppShell.tsx:68` (`<Breadcrumbs />`, unconditional, inside `<main id="content">`, immediately before `{children}`)
- `apps/web/src/shell/Breadcrumbs.tsx:17` (same `aria-label="Breadcrumb"`)
- `apps/web/src/shell/breadcrumb-rules.ts:70-86` (`crumbsFor`)

**What breaks:** `AppShell` unconditionally renders the shell's own `<Breadcrumbs />`
inside `<main>`, before every page's content. That component derives crumbs from the raw
pathname (`crumbsFor`): for `/procedures/{uuid}` it produces "Procedures / {uuid}" (the
second segment has no entry in `SUBSECTION_LABELS`, so it falls through to
`readableSegment`, i.e. the raw UUID, rendered `mono`). `DetailTrail.tsx`'s own doc
comment states the reason for its existence: *"The shell's `Breadcrumbs` is a client
component reading only the pathname, so the best it can say for `/procedures/018f…` is a
monospace UUID... so the detail page renders its own trail here, server-side, where the
Control name is known."* That comment describes the shell's crumb as a problem to be
worked around — but nothing suppresses the shell's `<Breadcrumbs />` for these routes.
`AppShell.tsx` and `breadcrumb-rules.ts` are both untouched by this diff. The result: the
Procedure Detail and Builder pages render **two** `<nav aria-label="Breadcrumb">`
landmarks stacked in the DOM — the shell's, reading "Procedures / {raw UUID}", directly
followed by `DetailTrail`'s, reading "Procedures / {Control name}" (and, on the Builder,
"... / Builder"). Two landmarks with the identical accessible name is also an ARIA
authoring problem (duplicate landmark names must be programmatically distinguishable —
they are not, both say "Breadcrumb").

**How reproduced:** Traced the render tree by hand:
1. `layout.tsx` → `AppShell` → `<main id="content"><Breadcrumbs />{children}</main>` (verified `AppShell.tsx:68`, unconditional, no route check).
2. `Breadcrumbs.tsx:12-14`: `crumbsFor(pathname)`; for `/procedures/{id}`, `crumbsFor` (`breadcrumb-rules.ts:70-86`) returns a 2-element array (`segments.length === 2 >= 2`), second crumb's `subsectionLabel('/procedures/{id}')` is `undefined` (not in the two-entry `SUBSECTION_LABELS` map, which only knows `/administration/registrations` and `/administration/sources`), so it falls to `readableSegment(segment)` — the literal id string — with `mono: true`.
3. `[id]/page.tsx:62-67` and `[id]/builder/page.tsx:69-75` both render `<DetailTrail trail={[...]} />` as the first element of the page body (i.e. inside `{children}`), which is `DetailTrail.tsx`'s own `<nav aria-label="Breadcrumb">`.
4. Confirmed `.ls-card`/`.ls-breadcrumbs` styling doesn't hide either — both are plain, unconditionally-rendered `<nav>` elements with no `display:none` anywhere in the diff or in `globals.css` that would suppress one.

Not run through Playwright (no live server available to this reviewer without touching
the shared database other agents are using), so the DOM order/visual stacking is
reasoned from source, not screenshotted — **the code-path trace above is unambiguous
enough that I am confident in this without a screenshot**, but flagging the one thing not
directly observed.

**Why it evades the axe gate:** `landmark-unique` (the axe-core rule for "no two
landmarks with the same role and accessible name") is tagged `cat.semantics` /
`best-practice` in axe-core, not a WCAG success-criterion tag. `tests/e2e/procedures.spec.ts:23,30`
scans with `TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa']` via
`.withTags(TAGS)`, which excludes best-practice rules. So the CI accessibility gate will
not catch this even though it is a real, user-visible defect (two different breadcrumb
trails, one of them a raw UUID, stacked on the page) — the same "escapes automated
checks" shape as the `aria-label`-on-`<dd>` defect this codebase already hit once
(`Digest.tsx`'s own doc comment).

**Fix direction:** either suppress the shell's `<Breadcrumbs />` for `/procedures/[id]`
and `/procedures/[id]/builder` (e.g. `crumbsFor` returns `[]` for known detail routes and
the page renders its own), or make `breadcrumb-rules.ts` capable of naming the Procedure
(which it structurally cannot today, being a pathname-only client component) and delete
`DetailTrail`. Shipping both is the bug.

---

### B2. "Create Procedure" performs a state-changing action with no confirmation dialog, contradicting the UX contract and the component's own doc comment

**Files:** `apps/web/src/procedures/NewProcedureForm.tsx`

**What breaks:** EXPERIENCE.md → Component Patterns states, without exception:
*"Confirmation dialog | All mutating actions | Three weights. **Routine** (submit,
approve, rerun, export, pause, cancel, answer or abort an Escalation): restates the
consequence. ..."* (line 99 of EXPERIENCE.md). `DESIGN.md` line 408 repeats this:
*"Confirmation dialog. ... Three weights, defined behaviorally in `EXPERIENCE.md`:
routine, ..."* — no carve-out for Procedure creation. Creating a Procedure writes a
`procedure` row, a `procedure_version` row, and appends `lifecycle.procedure-created` to
the audit chain — unambiguously a mutating action.

`NewProcedureForm.tsx`'s own doc comment (lines 22-24) says: *"The dialog is
`weight="routine"`: creating a Draft changes nothing that exists and is recorded in the
audit chain, but it is still the moment the person confirms what they are about to
make."* **There is no dialog anywhere in the file.** `ConfirmDialog` is not imported
(confirmed: `grep -n "ConfirmDialog\|import" NewProcedureForm.tsx` shows no such import),
and the submit handler (`onRequestSubmit` → `submit()`) calls the Server Action directly
on click with no intervening confirmation step. Compare with the sibling component
`RenameDraftForm.tsx`, which correctly imports `ConfirmDialog`, sets `weight="routine"`,
and gates the actual save behind `onConfirm`.

**How reproduced:** Read `NewProcedureForm.tsx` end to end; grepped for `ConfirmDialog`
in the file (no match) and confirmed the doc comment's claim against the actual `submit`
function (lines 55-76), which is invoked unconditionally from `onRequestSubmit` once a
Template is chosen. Cross-checked against `tests/e2e/procedures.spec.ts:107-109`, which
clicks "Create Procedure" and immediately asserts the resulting Builder heading — the
test itself encodes the (missing) direct-submit behavior, so it will not catch a fix
that adds the dialog back without also being updated, and it currently gives no signal
that a dialog is missing.

**Fix direction:** add the `ConfirmDialog` the doc comment already describes, exactly as
`RenameDraftForm.tsx` does it, before calling `onCreate`.

---

### B3. The Builder's "not editable yet" sentence is `aria-hidden`, with no visually-hidden companion — invisible to every screen reader

**File:** `apps/web/src/procedures/BuilderSections.tsx:32-34`

```tsx
<p className="ls-caption" aria-hidden="true">
  {BUILDER_SECTION_NOT_EDITABLE_SENTENCE}
</p>
```

**What breaks:** This is the ONLY place `BUILDER_SECTION_NOT_EDITABLE_SENTENCE` is
rendered for a given section, and it is marked `aria-hidden="true"` with nothing else in
the section carrying the same information for assistive technology. A screen-reader user
reading a Builder section gets the section heading and the pre-filled content, but never
learns that the section "is pre-filled from the Template and is not editable yet" — the
exact sentence the story exists to guarantee is shown (spec's Task 13: "each showing its
pre-filled values read-only under the 'not editable yet' sentence"). For a sighted user
the text is visible; for an AT user it does not exist. That is a real, asymmetric loss of
information, not a decorative hide.

The codebase already has the correct pattern for this exact situation, one file away, and
documents *why* it is safe there and (by implication) not safe here:
`apps/web/src/design/Digest.tsx:35-38`:
> `aria-hidden` on visible text is safe only because the equivalent text is right
> here, in the same element, and carries the same information.

`Digest.tsx` pairs its `aria-hidden` span with a second `<span className="ls-visually-hidden">{spokenDigest(...)}</span>` carrying the same meaning for AT. `BuilderSections.tsx` has no such companion — the `aria-hidden` paragraph is the only copy of the sentence, full stop.

**How reproduced:**
- Confirmed the JSX at `BuilderSections.tsx:32-34` (`Read` tool).
- Grepped the whole component and its test coverage: `grep -rln "BuilderSections\|aria-hidden" apps/web --include=*.test.ts --include=*.test.tsx` returns only `copy.test.ts`, whose only assertion about this component (`copy.test.ts` "the Builder read-only sentence" describe block) checks that the source string `BUILDER_SECTION_NOT_EDITABLE_SENTENCE` appears in the file — it does not check for, or against, `aria-hidden`. No unit test exercises the accessibility tree here.
- The e2e assertions that touch this text (`tests/e2e/procedures.spec.ts:119,279`) use Playwright's `getByText(...).toBeVisible()` / `toHaveCount(0)`, which key off DOM/CSS visibility, not the accessibility tree — `aria-hidden="true"` does not affect either, so these assertions pass identically whether or not the text is exposed to AT. They cannot catch this defect.
- `axe-core` has no rule that flags "informative text hidden via valid `aria-hidden` with no AT-visible equivalent" (unlike, say, an empty link) — there is nothing invalid about the markup, so the CI accessibility gate (`scan()` in the same spec file) will not flag it either. Same "escapes the automated gate" shape as B1 and as the codebase's own prior `aria-label`-on-`<dd>` incident.

**Fix direction:** remove `aria-hidden="true"` (simplest — there is no visual reason to hide this text; it's a plain caption, not a duplicated full-value-plus-summary situation like a digest), or, if the visual redundancy across many repeated sections was the motivation, follow the `Digest.tsx` pattern properly: hide the visible text and add an `.ls-visually-hidden` companion that says the same thing once per section.

---

## Should

### S1. Client-side refusal strings duplicated as bare literals instead of the shared constants — the exact drift this codebase has already been bitten by

**Files:**
- `apps/web/src/procedures/NewProcedureForm.tsx:84,122` — `'Choose a Template.'`
- `apps/web/src/procedures/RenameDraftForm.tsx:90` — `'Enter a Control name.'`

Both strings match `PROCEDURE_REFUSALS.TEMPLATE_REQUIRED` and
`PROCEDURE_REFUSALS.NAME_REQUIRED` (`packages/application/src/procedures/create-procedure.ts`)
today, but neither component imports those constants, and neither string is pinned via
`copy.ts`/`copy.test.ts` the way `REGISTRATION_REFUSALS.CREDENTIAL_NOT_READ_ONLY` and the
other cross-layer sentences are (see `copy.test.ts`'s own comment: *"Three independent
literals carried this string — the command, the browser spec's helper and the
surface — and each was only ever checked against another of them."*). These two are
purely client-side pre-submit checks (they never reach the Server Action — the boundary's
shape check in `actions.ts` returns `MALFORMED` for an empty `templateId` before the
domain's `TEMPLATE_REQUIRED` refusal could ever surface through the web UI), so today's
risk is narrower than the historical incident, but it is the same category of defect: if
`PROCEDURE_REFUSALS.TEMPLATE_REQUIRED` or `.NAME_REQUIRED` is ever reworded, these two
client literals silently stop matching and nothing will notice.

**How reproduced:** `grep -rn "'Choose a Template.'\|'Enter a Control name.'\|PROCEDURE_REFUSALS" apps/web/src/procedures/*.tsx apps/web/src/design/copy.test.ts` — only the two hardcoded literals were found; no import, no pinning test.

**Fix direction:** import `PROCEDURE_REFUSALS.TEMPLATE_REQUIRED` / `.NAME_REQUIRED` from `@intellifin/application` directly (both components already import other names from it via `actions.ts`'s re-exported types), rather than retyping the sentence.

### S2. The Procedures list EmptyState copy breaks the established copy.ts convention, and its own enforcing test's surface list was not extended

**Files:** `apps/web/app/procedures/page.tsx:61-66`, `apps/web/src/design/copy.ts`, `apps/web/src/design/copy.test.ts`

`page.tsx` hardcodes the EmptyState headline/sentence inline:
```tsx
headline="No Procedures yet."
sentence="A Procedure and its versions would be listed here, each created from a Template. An empty list does not mean a control passed; it means nothing can be approved, scheduled, or run."
```
EXPERIENCE.md's "Procedures | No Procedures" row (`Per-surface states`, line 130) only
fixes the *action* ("EmptyState with 'New procedure' as the only action"), not the
wording — exactly like the `reviewQueueEmpty` and `notificationsEmpty` entries already in
`copy.ts`, which are explicitly annotated `/** Not from the contract: EXPERIENCE.md gives
this surface a headline only. */` and still live in `EMPTY_STATES`. This new one does
not follow that precedent: it is typed directly in the page component. `copy.test.ts`'s
own "renders every shipped empty state from this module and not from inline copy" test
(the very mechanism that would catch a component drifting from its pinned copy) lists
three surfaces (`app/page.tsx`, `app/review/page.tsx`,
`shell/NotificationBell.tsx`) and was not extended to include
`app/procedures/page.tsx`. A future edit that quietly reworks this sentence, or a
copy-paste mismatch between the headline used here and one used elsewhere for the same
concept, would go completely unenforced by this file (the e2e spec's
`toContainText('No Procedures yet.')` on line 76 does catch a headline change today, but
only for that one string, and only via the browser suite).

**How reproduced:** Read `page.tsx` (no `copy.ts` import for the EmptyState text) and
`copy.test.ts`'s "renders every shipped empty state" test list.

### S3. The malformed-id e2e case checks `< 500`, not the 404 the spec requires

**File:** `tests/e2e/procedures.spec.ts:237-241`

```ts
test('a malformed id answers a page, never a 500', async ({ page }) => {
  const response = await page.goto('/procedures/not-a-uuid');
  expect(response?.status()).toBeLessThan(500);
});
```

The spec's I/O matrix is explicit: *"Malformed id in the URL | `/procedures/not-a-uuid` |
404 | `isUuidText` at the repository, never per page."* This assertion only proves the
request didn't 500 — a regression that made the page render 200 with a broken or blank
body (e.g. a guard removed so the id reaches the query differently and returns something
unexpected, or a redirect loop) would still pass this test. It does not prove the
required 404.

**Fix direction:** `expect(response?.status()).toBe(404);`

### S4. Version state is rendered three times per version row, once as a raw uppercase enum value in running prose — contradicts DESIGN.md's "Sentence case everywhere"

**File:** `apps/web/app/procedures/[id]/page.tsx:82-83,124-126`; `apps/web/src/procedures/labels.ts:22-24`

`versionLabel(versionNumber, state)` returns literally `"Version 1 · DRAFT"` — the raw,
all-caps domain enum value spliced into a sentence. `labels.ts`'s own comment says this is
deliberate ("The state word is spelled the way the domain stores it; the badge beside it
carries the display word, so the two never disagree about spelling"), but the effect on
the actual page is: the card title shows `Version 1 · DRAFT` immediately followed by a
`ProcedureStateBadge` reading "Draft" — the same fact in two different cases, side by
side — and then `VersionMeta`'s `<dd>{version.state}</dd>` shows the raw value a third
time a few lines down. DESIGN.md's Voice and Tone rule: *"Sentence case everywhere;
column headers uppercase by CSS only."* `DRAFT` in running prose (not a column header) is
exactly the case this rule forbids.

**How reproduced:** Read `labels.ts` and `[id]/page.tsx` end to end; confirmed
`ProcedureStateBadge` separately renders the sentence-case word for the same `state`
value at `[id]/page.tsx:83`, and `VersionMeta` renders the raw value again at line 125.

**Fix direction:** drop the state from `versionLabel`'s return value ("Version 1") and
let the badge be the one place the state's word appears in prose, or lower-case it there.
Not a functional bug, but a real deviation from the pinned voice rule and needlessly
redundant.

---

## Consider

- **`apps/web/app/procedures/[id]/page.tsx:42`** gates the whole Procedure Detail surface
  behind `requireServerAction('procedure.author')`, which — since only PoC Administrator
  lacks `procedure.author` among the three roles — means a PoC Administrator cannot view
  ANY Procedure Detail page at all, not just author actions on it. The spec's explicit
  "Reading is not gated by an action" language (spec line 64) is scoped in the intent
  contract to "Every signed-in role may see the Procedures **list**", and the page's own
  doc comment gives a considered reason for extending the gate to the Detail ("the Detail
  is where a Draft is edited from, so it keeps the author gate"). This is a defensible,
  documented interpretation rather than a clear contract violation, so I am not blocking
  on it, but it is a real product-behavior choice worth confirming with whoever owns
  UX-DR11: a PoC Administrator who wants to see what Procedures exist and their current
  state (not edit anything) is refused the Detail page outright. No e2e test exercises
  this specific case (only `/procedures/new` and `/procedures/{id}/builder` are tested
  for the PoC Administrator role; `/procedures/{id}` itself is not).

- **`apps/web/app/procedures/[id]/page.tsx:42`** uses the raw string literal
  `'procedure.author'` where every other call site in this diff imports and uses the
  `PROCEDURE_AUTHOR_ACTION` constant. Harmless today (the literal matches the constant's
  value, confirmed via `grep` against `create-procedure.ts:39`), but it is the kind of
  divergence that becomes a real bug the day the action name changes in one place and
  not the other.

- **`apps/web/src/procedures/NewProcedureForm.tsx:6`** imports `type TemplateId` from
  `@intellifin/domain` and never uses it. Dead import; harmless (this repo's tsconfig
  does not set `noUnusedLocals`, confirmed no such flag in `apps/web/tsconfig.json`), but
  worth a quick cleanup.

- **`apps/web/app/procedures/[id]/builder/page.tsx`** and its e2e coverage never test the
  malformed-id → 404 case for the Builder route specifically (only the Detail route is
  tested at `tests/e2e/procedures.spec.ts:237-241`). Given the Builder page does its own
  independent `findProcedure(id)` call, a regression there specifically would not be
  caught by the Detail-route test.

---

## Nothing found here

Verified clean, with reproduction where noted:

- **Server Action self-authorization (hunt #1).** Both `createProcedureAction`
  (`app/procedures/new/actions.ts:96`) and `renameProcedureDraftAction`
  (`app/procedures/[id]/builder/actions.ts:107`) call `requireServerAction` as the very
  first statement, before any input field is read. **Reproduced by mutation**: moved the
  `requireServerAction` call in `actions.ts` to after the `isNewProcedureFormFields`
  check, ran `pnpm vitest run apps/web/app/procedures/new/actions.test.ts`, and the test
  `"authorizes before it reads the input at all"` failed exactly as expected (got
  `MALFORMED` instead of the role-denial reason). Reverted with `git checkout --` and
  confirmed the suite is green again (23/23 passed) and `git diff` is empty for the file.
  The New-procedure and Builder pages (`page.tsx` in both folders) also gate before doing
  any repository lookup, and `actions.test.ts`'s final describe block additionally reads
  `page.tsx`'s source to pin the gate-before-render ordering at the unit level.

- **Untrusted Server Action arguments (hunt #2).** Both `isNewProcedureFormFields` and
  `isRenameDraftFields` check `typeof`, non-emptiness where relevant, and explicit length
  bounds (`templateId` ≤ 8, `controlName` ≤ `PROCEDURE_LIMITS.controlName` = 200,
  `expectedRowVersion` ≤ 64, ids checked against a real UUID regex) before any field
  reaches the command. `actions.test.ts` exercises `undefined`, `null`, wrong-typed
  fields, and over-length strings for both actions and asserts each is refused with the
  generic `MALFORMED` message without calling the command or the runtime.

- **`Object.hasOwn` / unsafe object-key lookups (hunt #3).** No plain-object lookup in
  this diff is keyed by raw request input. `STATE_WORDS[state]` in
  `ProcedureStateBadge.tsx` is keyed by `ProcedureVersionState`, a value that always comes
  from a DB row (via the repository, out of this review's scope but structurally not
  request-input), not from a URL segment or POST body. The two `isXFields` boundary
  functions read fixed, known key names (`templateId`, `controlName`, `procedureId`,
  `versionId`, `expectedRowVersion`) from the request body with bracket notation and a
  `typeof` check — none of those names collide with a dangerous inherited property
  (`constructor`, `toString`, `__proto__`), and a hand-crafted body under any of those
  keys still has to pass a `typeof === 'string'` / length check to be accepted.

- **`aria-label` on a name-prohibited element (hunt #4).** The only new `aria-label` in
  this diff is on a `<nav>` (`DetailTrail.tsx:30`), a landmark element that legitimately
  accepts an accessible name. No new `aria-label` sits on a `span`, `div`, `p`, `li`,
  `td`, or `dd`. (The duplicate-landmark problem this creates is filed as B1 above — a
  different defect from the "silently dropped" class.)

- **`<form method="post">` (hunt #5).** Both new forms (`NewProcedureForm.tsx:106`,
  `RenameDraftForm.tsx:118-120`) declare `method="post"` with a comment explaining why,
  matching the established pattern. **Reproduced by running the existing scanner**:
  `pnpm vitest run apps/web/src/form-method.test.ts` — 92/92 passed, and the scanner
  walks `.ts`/`.tsx` recursively so the new files are in scope; the suite would fail on a
  missing `method="post"` per its own design (already proven against other files by the
  Story 1.5 mutation-testing record in `CLAUDE.md`).

- **`disabled` vs `aria-disabled` (hunt #6).** No new `disabled` attribute on an
  interactive control with a reason attached. The one `disabled` in this diff is
  `<option value="" disabled>` (a placeholder option in a native `<select>`), which is
  standard, keyboard-reachable-select behavior and not the "disabled action whose reason
  becomes unreachable" pattern this rule targets.

- **Copy pinned to the UX contract (hunt #7), for everything except S2 above.**
  `PROCEDURE_CARD_ABSENT`, `BUILDER_SECTION_NOT_EDITABLE_SENTENCE` and the surface-scan
  assertions in `copy.test.ts` were run (`pnpm vitest run apps/web/src/design/copy.test.ts`
  — 21/21 passed) and read line by line; `PROCEDURE_CARD_ABSENT`'s four sentences are
  invented by the implementation spec (not EXPERIENCE.md verbatim) and are honestly
  documented as such in `copy.ts`'s comment, pinned against a hardcoded literal in the
  test rather than against EXPERIENCE.md — which is correct here, since the sentences
  are not claimed as UX-contract quotations (unlike `REGISTRATION_CHANGE_WARNING_TEMPLATE`
  or `DECLARED_COUNT_MISSING_SENTENCE`, which are checked against the artifact on disk).
  I did not find any sentence in this diff that is claimed as a quotation and is not
  actually present in EXPERIENCE.md/DESIGN.md.

- **CSS classes and custom properties (hunt #8).** Every new class in `globals.css`
  (`.ls-whitespace`, `.ls-card`, `.ls-card__title`, `.ls-card__title a`, `.ls-card__cells`,
  `.ls-card__cells dt`, `.ls-card__cells dd`) has a rule, and every `var(--…)` it reads
  (`--spacing-4`, `--spacing-card-padding`, `--color-surface-card`,
  `--color-border-default`, `--rounded-lg`, `--type-card-title-*`, `--type-caption-*`,
  `--color-text-muted`, `--type-body-sm-*`) is defined in `tokens.css`. Verified by
  grepping each token name against both files, and by running the existing enforcing
  tests: `pnpm vitest run apps/web/src/design/stylesheet.test.ts` (24/24 passed) and
  `apps/web/src/design/tokens.test.ts` (150/150 passed). Every `className` used by the new
  components (`ls-admin__actions`, `ls-admin__fields`, `ls-admin__form`, `ls-breadcrumbs`,
  `ls-breadcrumbs__separator`, `ls-button*`, `ls-caption`, `ls-card*`, `ls-dialog__field`,
  `ls-input`, `ls-page-header`, `ls-select`, `ls-stack`, `ls-whitespace`) resolves to an
  existing or newly-added rule.

- **E2E assertions against a page rendered before the action (hunt #9).** Checked every
  assertion in `tests/e2e/procedures.spec.ts`. The rename-success and idle-save cases
  correctly `page.reload()` before asserting the header text reflects the new Control
  name (`procedures.spec.ts:196-198`); the idle-save banner assertion is checked directly
  against the live Server Action response rather than pre-existing page state, so it is
  not vulnerable to this defect shape. The Template-picker-has-no-default assertion
  (`toHaveValue('')`) is checked immediately after `page.goto`, before any selection is
  made, so it cannot be trivially true from a prior test's leftover state — each test
  navigates fresh. (S3 above is a related but different problem: an assertion that CAN
  fail but doesn't prove the right thing, not one that cannot fail at all.)

- **`decodeURIComponent` on untrusted input (hunt #10).** No new call to
  `decodeURIComponent` in this diff. The one place this codebase already covers it
  (`breadcrumb-rules.ts:41-47`, `readableSegment`) is untouched, pre-existing code that
  DetailTrail's addition happens to duplicate the general shape of (see B1) without
  touching the decode logic itself.

- **Spec's "Never" list (hunt #11).** No `PlanCompiler`, plan derivation, or plan preview
  anywhere in the diff. No "Submit for approval" control, disabled or otherwise — grepped
  for the phrase across `apps/web/app/procedures`, `apps/web/src/procedures`, and the e2e
  spec; no match. No editable Builder section beyond the Control name — `BuilderSections.tsx`
  renders every section as plain `<p>` text with no `input`/`select`/`textarea`, and the
  e2e spec explicitly asserts `.ls-card input, .ls-card select, .ls-card textarea` has
  count 0 (`procedures.spec.ts:123-125`). No new digest function introduced in this
  scope; the one row-version token (`procedureVersionRowVersion`) is imported from
  `@intellifin/application`, not defined in `apps/web`.
