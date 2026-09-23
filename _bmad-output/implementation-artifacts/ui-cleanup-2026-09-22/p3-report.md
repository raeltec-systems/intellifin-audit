# Package 3 — procedure authoring

Branch `ui/p3`, based on the shared layer (`290ca5f`, `7b6a695`). Commits `a285fe5` to
`55f0d27`. Every finding below has a fix and a test; the key ones were proven by
mutation (the fix removed, the named test run and seen to fail, the fix restored).

## Findings

### UX-05 (P1) — a Procedure is named by its Procedure name

- **Changed.** The New procedure field, its help and its refusal say **Procedure name**
  (`NewProcedureForm.tsx`, `create-procedure.ts` refusal `Enter a Procedure name.`). The
  selected Template's risk, control statement and objective are shown read-only in their
  own card below the picker (`data-template-preview`). The Builder's rename form reads
  **Procedure name** / **Save Procedure name** (`RenameDraftForm.tsx`) and
  `BUILDER_CONTROL_NAME_EDITABLE_SENTENCE` in `copy.ts` was reworded (its `copy.test.ts`
  expectation pins only that it names the form). The domain field stays `controlName`.
- **Tests.** `new-procedure-words.test.ts` › "calls the field the Procedure name on the
  creation and rename forms"; `procedures.spec.ts` › "one click creates exactly one Draft
  and the Builder names it"; every Builder spec now drives the renamed labels.

### UX-06 (P2) — one task-specific introduction, no universal recommendation

- **Changed.** One introduction on `app/procedures/new/page.tsx`; the "(recommended)"
  suffix and the "starting point for most audits" paragraph are gone; each Template is
  described by its own risk, control and objective once chosen.
- **Tests.** `procedures.spec.ts` creation test asserts `not.toContainText('recommended')`.
  **Mutation:** restoring `(recommended)` on the P-1 option fails that assertion.

### UX-07 (P2) — create a Draft in one action

- **Changed.** `NewProcedureForm.tsx` has no `ConfirmDialog`; one submit creates the Draft
  and navigates to `builder?created=1`, where a line Banner names the new Draft
  (`draftCreatedBanner` in `new-procedure-words.ts`, filled through `fillTemplate`, so a
  name containing `$&` is safe). The hydration guards are unchanged: the native
  `<fieldset disabled>`, `data-client-ready`, `NEW_PROCEDURE_REQUIRES_JAVASCRIPT`, and the
  lost-response sentence (`UNKNOWN_CREATE_OUTCOME`, moved into `new-procedure-words.ts` and
  re-exported). Confirmations remain on submit, approve/reject, activation, scope
  expansion, cancel and rerun.
- **Tests.** `new-procedure-words.test.ts` (no dialog; the banner names the Draft safely;
  the banner shows only when reached from creation); `procedures.spec.ts` › "one click
  creates exactly one Draft and the Builder names it" (rewrites the old "cancelled
  confirmation creates nothing" test, which pinned the dialog this finding removes);
  `new-procedure-readiness.spec.ts` now intercepts the creation POST, aborts it, and
  asserts the sent body and the "may have been created" warning (it used to drive the
  dialog). **Mutation:** re-adding the `ConfirmDialog` import fails the SSR guard test.

### UX-08 (P2) — the first viewport shows the task

- **Changed.** The Builder header is `PageHeader` (title, version/state badge, one meta
  line) with the created Banner as a line; the guided intro is a compact heading and
  progress row; at ≥900px the outline is a sticky left column; the step's panel heading
  is a two-column grid; the conversation has `max-height: clamp(18rem, calc(100dvh -
  18rem), 34rem)` and scrolls inside itself (`writing-assistant.css`,
  `guided-preparation.css`).
- **Tests.** `builder-steps.spec.ts` › "the first viewport shows the task, and the Builder
  speaks the auditor’s language end to end": at 1366×768 the `h1`, the outline and the
  panel are inside the first viewport; the evidence step's composer bottom is ≤768; the
  chat's height is bounded; no horizontal page scroll at 1280×720 or 1366×768; axe clean.

### UX-09 (P1) — the dates an auditor names are proposed with the scope

- **Changed.** `periodNamedIn` (`packages/application/src/procedures/authoring-period.ts`)
  reads one explicit period from the auditor's own words (ISO ranges, full dates, day
  ranges in a month, month ranges, single dates, "August 2026"); it names nothing when
  the words name several different periods or an impossible date. The chat reads the
  period from the auditor's request, never from the model's text
  (`proposedScopePeriod` in `WritingAssistant.tsx`), shows "I’ll use 1–31 Aug 2026 as the
  testing period, both dates included, with this scope:" and the accept control **Use
  these dates and this scope**. `acceptAuthoringSuggestion` accepts an optional `period`
  and saves both through the existing `updatePopulationDraft` `period-scope` writer and
  its validation; a period on a non-scope suggestion is refused. The prompt now tells the
  model not to refuse a scope because no dates are saved and never to invent dates
  (`authoring-model.ts`; prompt version `guided-dialogue-v4`, v3 still parsed). No new
  provider tool, no scope expansion by chat, nothing applied without acceptance.
- **Note.** The brief names `packages/infrastructure/src/authoring/**`; that folder does
  not exist. The prompt and receipt store are `packages/infrastructure/src/procedures/
  authoring-model.ts` and `authoring-store.ts`, and those were edited.
- **Tests.** `authoring-period.test.ts` (16 cases); `tests/unit/procedure-authoring.test.ts`
  › "saves the dates the auditor named together with the scope, through the
  Period-and-scope writer" and "refuses a period on any suggestion that is not a scope
  proposal, and an invalid period, changing nothing"; `WritingAssistant.test.ts` › "reads
  the period from the auditor’s own words, never from the model’s proposal";
  `authoring-model.test.ts` asserts the prompt paragraph; `builder-steps.spec.ts` sends
  "employees terminated during August 2026" through the synthetic OpenAI preload, asserts
  one proposal carrying both dates and the scope, confirms it, and reloads to see both
  saved. **Mutation:** making accept always use the `scope-note` writer fails "saves the
  dates … together with the scope" (1 failed, 63 passed).

### UX-10 (P2) — the composer hint says what the conversation is waiting for

- **Changed.** `COMPOSER_HINTS` in `assistant-words.ts`, chosen by `composerState`: the
  "record that" hint appears only when a concrete proposal is on screen; a question says
  to answer it; a first turn says a rough answer is enough. The clarify reply
  (`clarifyCommandReply`) likewise mentions "record that" only when a proposal exists.
- **Tests.** `WritingAssistant.test.ts` › "never offers "record that" under a question";
  `builder-steps.spec.ts` reads `data-composer-hint`.

### UX-11 (P1) — a searchable source chooser

- **Changed.** `SourceChooser.tsx` + `source-choice.ts`: a search field, a count line, a
  `role=status` outcome, "Suited to this procedure" (sources declaring every Template
  lookup field and every saved filter field) above "Other sources", each row with its
  name, how the records arrive (`SOURCE_KIND_WORDS`), readable field names, "Missing:
  termination effective date" when a required field is absent, and a **Choose** button
  (withheld with a stated reason when the saved filters could not be kept). Choosing
  goes through the same `chooseSource` path the chat uses, so filters are retained. The
  chat still selects by name, and its list now points at the chooser
  (`CHOICES_LISTED_BESIDE`) with the same readable descriptions.
- **Tests.** `source-choice.test.ts` (7 cases); `builder-steps.spec.ts` searches, chooses
  and sees the row marked chosen. **Mutation:** ranking every source as "Other" fails
  "suggests the sources that declare every required field".

### UX-12 (P2) — filters wait for a source

- **Changed.** With no source chosen, the filter editor says **Choose a source to see its
  fields.** (`NO_SOURCE_FIELDS_YET`, `data-filters-await-source`) and no field is marked
  as missing from "this source"; saving without a source says so once.
- **Tests.** `builder-steps.spec.ts` asserts the waiting sentence and the absence of
  "(this source does not provide it)" before a source is chosen.

### UX-13 (P1) — criteria in audit language

- **Changed.** The criteria step, the Review step and the Procedure page read each
  condition as "Condition N." and `conditionSentence(...)` (or `CONDITION_NOT_IN_WORDS`);
  the compiled text and the applicability are under `TechnicalDetails`
  (`GuidedPreparation.tsx`). `conditionLabel` was ADDED to `condition-words.ts`; nothing
  existing there changed. `plain-words.test.ts` now bans `found = false`,
  `account_status`, `Gate failure` and `unnamed value` as rendered text.
- **Tests.** `GuidedPreparation.test.ts` › "says the criteria in audit language and keeps
  the compiled rule under Technical details"; the extended `plain-words.test.ts` scan.

### UX-14 (P2) — Planned frequency

- **Changed.** The step is **Planned frequency** (`SECTION_WORDS.Schedule` in
  `plain-words.ts`, `PREPARATION_NAMES.frequency` plus the alias "planned frequency"); the
  question ends "Nothing runs by itself yet."; the saved value reads "Planned: weekly …
  nothing runs by itself yet" (`plannedFrequencyLine`, added to `run-start-words.ts`);
  the start time is the "intended time"; the one clear action is the pinned **Start a Run
  now** link to `initiateRunHref` (`data-frequency-start-run`). The Procedure page's
  version card has a Planned frequency cell. Pinned run-start sentences are unchanged.
- **Tests.** `run-start-words.test.ts` › "the saved frequency is read as a plan, never a
  promise"; `GuidedPreparation.test.ts` and `BuilderSections.render.test.ts` read the new
  title; `builder-steps.spec.ts` asserts the caption and link.

### UX-15 (P1) — readiness names the Builder's sections and links to them

- **Changed.** `readiness-words.ts`: `readinessLine` (typed
  `Record<ProcedureReadinessCode, …>`, so a new domain code without words does not
  compile) names the section by `SECTION_WORDS[...].title` and the step it lives in;
  `ReadinessPanel` renders "Go to {title}" links to the stable step anchors
  (`preparation-anchors.ts`, `guided-preparation-panel-<step>`; a `hashchange` listener
  selects the step). `draftGapWords` rewrites the domain's completeness and plan sentences
  in Builder words for the Submit reason on the Builder and on the Procedure page.
- **Tests.** `readiness-words.test.ts`: every readiness code names its Builder title and
  no stored heading; every stored section maps to a step; the rendered panel links each
  finding; every `completenessReason` branch is driven through the REAL domain function.
  `builder-steps.spec.ts` follows a readiness link and lands focused on the evidence step.
  **Mutation:** removing the `stepHref` link fails "links each finding to the exact step".

### UX-16 (P2) — preparing the test plan, without the worker mechanics

- **Changed.** `RetryPlanDerivation.tsx` + `plan-words.ts`: **Try preparing the test plan
  again** / **Prepare the test plan**; `data-plan-recovery` says `draft` ("Something is
  missing in your draft." with the section named) or `platform` ("The platform could not
  prepare the test plan. Try preparing it again below."); the recorded reason and the
  attempt history (with `Timestamp`) are under `TechnicalDetails`. The server action's
  authorization and expected-revision guard are untouched. `submission-guard.ts`'s three
  sentences speak of the test plan instead of derivation.
- **Tests.** `RetryPlanDerivation.render.test.ts` (3 cases); `readiness-words.test.ts` ›
  "tells a draft gap from a platform failure"; `executable-plan.spec.ts` drives the new
  labels through `PLAN_RETRY_LABEL`/`PLAN_RETRY_CONFIRM`.

### UX-02 / UX-31 on these surfaces

- Section review records, the plan attempts and the Procedure page use `<Timestamp>`;
  counts use `countNoun` ("2 sections left"); sentence case throughout. Tests:
  `GuidedPreparation.test.ts` › "shows only the saved auditor acknowledgement…" (reads
  the `<time>` title and "11 Sep 2026"); `RetryPlanDerivation.render.test.ts`.

### Procedure Detail page

- `app/procedures/[id]/page.tsx`: `PageHeader`, `Timestamp`, the Planned frequency cell,
  the raw state cell removed (the badge says it), the Submit reason through
  `draftGapWords`. `initiateRunHref`, `INITIATE_RUN_ANCHOR` and every pinned run-start
  sentence are unchanged.

## Renamed controls the walkthroughs and the deployed acceptance use

`owner-walkthrough.spec.ts`, `owner-walkthrough-p1.spec.ts` and
`scripts/verify-deployed-loancore.mjs` were updated for each:

| Old | New |
| --- | --- |
| Control name (New procedure field) | Procedure name |
| New Control name / Save Control name | New Procedure name / Save Procedure name |
| Create Procedure → confirm dialog | Create Procedure (one click, no dialog) |
| How often this is meant to run (step title) | Planned frequency |
| Retry plan derivation | Try preparing the test plan again (confirm: Prepare the test plan) |

"Create Procedure", "Mark reviewed and continue", "Submit for approval" and the other
section titles are unchanged.

## Verification

_Filled in below._

## Left out and why

- **The created Banner reappears if `?created=1` is reloaded.** It is a query flag, not a
  one-time flash; removing it needs a client `history.replaceState` after hydration,
  which would make the Banner depend on JavaScript. Harmless (it names the Draft).
- **Readiness on the version review page is not linked.** `AgentSummary` and the
  `Version*.tsx` components are package 2's; the panel takes `stepHref` and names the
  section without a link where it is not passed.
- **The plan preview's own "Cannot derive" / "Re-deriving" words.**
  `ExecutablePlanPreview.tsx` is outside this package; only its retry control (mine) was
  reworded.

## Needs a change outside my scope

- `tests/e2e/version-review.spec.ts` still drives the old words: `getByLabel('Control
  name')`, `confirmed(page, 'Create Procedure')`, `New Control name`, `Save Control name`
  and "unknown save outcome in Control name". Rename to `Procedure name` / `New
  Procedure name` / `Save Procedure name` and replace the confirmation with a direct click
  on **Create Procedure**.
- `apps/web/src/procedures/ExecutablePlanPreview.tsx`: say "Preparing the test plan" /
  "The test plan could not be prepared" instead of "Re-deriving" / "Cannot derive:", and
  move its attempt list under `TechnicalDetails` (UX-16's rule, package 2's file).
- `AgentSummary.tsx`: pass `stepHref` to `ReadinessPanel` only where an editor exists; on
  the version review page keep it unlinked (already the default).

## Gotchas for CLAUDE.md

- **A dated scope is read from the auditor's words, never from the model's.**
  `proposedScopePeriod` reads the request's changes/notes; a period the model wrote is a
  period nobody named, and the accept path would save it.
- **A new chooser heading can steal a section's label.** `getByLabel('Where the records
  come from')` also matched the chooser's heading of the same words; name a helper region
  differently from the section it sits in.
- **One-action creation changes the Builder URL to `?created=1`.** Specs that assert
  `toHaveURL(/builder$/)` after creating must allow the query.
