---
title: 'Story 2.1: Create a Procedure from a Template'
type: 'feature'
created: '2026-09-03'
status: 'draft'
baseline_revision: 'f5fb9deb3bd751ffa48d0b8ba79da960cc34235a'
baseline_commit: 'f5fb9deb3bd751ffa48d0b8ba79da960cc34235a'
review_loop_iteration: 0
followup_review_recommended: true
context:
  - '{project-root}/AGENTS.md'
  - '{project-root}/CLAUDE.md'
  - '{project-root}/_bmad-output/implementation-artifacts/epic-2-context.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-1-7-register-a-population-source-binding.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-1-6-register-a-target-system-with-a-read-only-credential.md'
deferred: []
---

<intent-contract>

## Intent

**Problem:** An Auditor has nowhere to start. Registrations and bindings exist, but no
Procedure does, so nothing can reference them and nothing can be approved, scheduled, or
run. `/procedures` is an inert placeholder that says authoring is not part of this release.

**Approach:** A `procedures` domain module that owns the four Template contracts as data
and the Procedure Version state machine; one audited command that creates a Procedure and
its first `DRAFT` version pre-filled from the chosen Template; one that edits a Draft; and
the Procedures list, the New-procedure surface, the Procedure Detail, and a read-only
Builder shell that shows what the Template pre-filled. Stories 2.2 through 2.6 make the
Builder's sections editable. This story makes a Draft exist, correctly, with the
pre-filled values on it.

## Boundaries & Constraints

**Always:**
- The four Templates are `P-1` Terminated Users Retaining Access (the hero), `P-2`
  Segregation-of-Duties Conflicts, `P-3` High-Value Transactions Without Required
  Approval, `P-4` Production Configuration Deviation. They are DATA owned by
  `packages/domain/src/procedures/`, not rows in a table, not configuration, not a seed
  script (AD-2). A Template is a build constant for the same reason
  `SUPPORTED_SCHEMA_MAX` is: an image ships a fixed set of Template contracts.
- Every Template default is transcribed from addendum §C and **pinned to that file on
  disk** by a test that reads it. A value retyped into TypeScript and asserted against a
  copy of itself proves only that the file agrees with itself.
- Each Template record carries, as data, its golden Population Source binding reference
  and the version identifier of its expected outcomes and confirmation script (AD-12,
  AD-19). Those already exist under `fixtures/northstar/expectations/`. The Template
  names them; it does not read them, and no Regression Run is built here.
- A Procedure Version's state vocabulary is exactly `DRAFT`, `SUBMITTED`, `APPROVED`,
  `REJECTED`, `ACTIVE`, `RETIRED` (addendum §E). This story only ever writes `DRAFT`.
  The permitted transitions live in the domain as data from the first commit, with
  `DRAFT → SUBMITTED` and the rest unreachable until their own stories; a state machine
  that grows one arrow per story ends up with no machine at all.
- Creation writes the Procedure row, the `DRAFT` version row, and the audit event in ONE
  transaction through a `procedures` unit of work. Either all three commit or none do.
- The audit families are closed. `AUDIT_EVENT_FAMILIES` has no `procedure` entry, so the
  events are `lifecycle.procedure-created` and `lifecycle.procedure-draft-changed`, with
  `aggregateId` = the Procedure id so a Procedure's whole history is one chain.
- Both commands authorize through `requireServerAction('procedure.author')` INSIDE the
  Server Action, before any input is read. A PoC Administrator is refused with
  EXPERIENCE.md's verbatim sentence and the refusal is audited.
- Reading is not gated by an action. `GATED_ACTIONS` is 24 entries checked against
  EXPERIENCE.md character for character; a 25th breaks a completeness claim. Every
  signed-in role may see the Procedures list.
- The Procedures card shows Active version, Schedule, next Run and last outcome (UX-DR7).
  In this story every one of those is absent, so each says so IN WORDS — "No active
  version", "Not scheduled", "No Runs yet", "No outcome". A dash or an empty cell is
  something a reader takes for "fine". Story 1.6's "Never probed" is the precedent.
- The Control name and the Template identity appear on every surface that lists or opens
  the Procedure (UX-DR7): the card, the detail header, the Builder shell header, and the
  breadcrumb.
- The one editable field in this story — the Control name, on the Draft — carries a
  full-row optimistic-concurrency token, exactly as `registrationRowVersion` and
  `bindingRowVersion` do. A save that changes nothing writes nothing and appends nothing.
- Every `<form>` names `method="post"`. Every object lookup keyed by request input uses
  `Object.hasOwn` or a `Map` — this has bitten five times.
- Every string quoted from EXPERIENCE.md or DESIGN.md lives in
  `apps/web/src/design/copy.ts` and is pinned to the artifact on disk.

**Block If:**
- Delivering this requires a new entry in `GATED_ACTIONS` or in `AUDIT_EVENT_FAMILIES`.
- Delivering this requires the web process to call a model, a queue, or a Target System.
- Delivering this requires changing an approved requirement, an AD, or a pinned
  dependency major.

**Never:**
- **No `PlanCompiler`, no plan derivation, no plan preview, no `ModelGateway`.** AD-23
  makes derivation a queued worker job. Story 2.6 owns it. Nothing here derives a plan or
  shows one.
- **No editable Builder sections.** Period and scope, Population Source binding,
  inclusion rule, Target System selection, Audit Instructions, Compliance Rule
  conditions, Evidence Requirements and Schedule are stories 2.2–2.5. This story renders
  the Template's pre-filled values for those sections READ-ONLY, each under the section
  heading it will later be edited in, with the visible sentence from `copy.ts` saying it
  is not editable yet.
- **No submission, no approval, no rejection, no diff, no version numbering beyond 1.**
  Stories 2.7 and 2.8. No `Submit for approval` control, not even disabled.
- **No platform-authored drafts.** Story 2.8. Stories 1.6 and 1.7 already publish the
  events that will mint them; nothing here consumes those events.
- **No scope-widening check** on Audit Instructions. Story 2.3.
- **No new digest.** A Procedure Version freezes at approval (Story 2.7), not at
  creation. Do not invent a third digest function; do not extend either existing one.
- **No Run, no Schedule execution, no scheduler entry.** The Template's Schedule default
  is stored as data and is inert.
- **No `procedures` table read or written by another module.** Each module owns its own
  tables (AD-2).
- **No new dependency in `packages/domain` or `packages/application`.** Both validate by
  hand today, and `zod` is an infrastructure dependency. AD-14's Zod contract is the
  compiled plan (Story 2.6), not this payload. `packages/domain` also has no
  `@types/node` on purpose — that absence is what stops `process.env` typechecking
  there (AD-11), so `node:crypto` is unreachable and must stay so.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|---|---|---|---|
| Empty list | No Procedure exists | EmptyState whose only action is "New procedure" | An empty list never reads as a passed control |
| Populated list | One or more Procedures | One card each: Control name, Template, and the four UX-DR7 cells, each in words | No dash, no blank cell |
| Create from the hero | Template `P-1`, a Control name | Procedure + version 1 in `DRAFT`, every §C default stored, `lifecycle.procedure-created` in the same transaction | All three rows or none |
| Create from P-2, P-3, P-4 | Template chosen, a Control name | Same shape; the §C defaults for that Template | The pre-fill differs; the code path does not |
| No Template chosen | Form submitted with no selection | Refused with a sentence; nothing stored | The form does not default to a Template — a default makes the choice for the person |
| Blank or over-long Control name | `''`, whitespace, or > 200 characters | Refused with a sentence; nothing stored | Bounded at the Server Action boundary, before the command |
| Malformed argument | A hand-made POST with `null`, a number, a missing field | Refused with the same sentence | A Server Action argument is untrusted whatever its TypeScript type says |
| Unstorable value | A lone surrogate or NUL in the Control name | Refused with a sentence | `canonicalJson` refuses; the command translates |
| Rename a Draft | New Control name, current row version | Stored; `lifecycle.procedure-draft-changed` in the same transaction | Both commit or neither |
| Idle save | Submitted unchanged | Nothing written, nothing appended | An event per idle submit says somebody changed nothing |
| Stale tab | Row changed since the page loaded | Refused with the Story 1.6 sentence | The token covers the whole row |
| Malformed id in the URL | `/procedures/not-a-uuid` | 404 | `isUuidText` at the repository, never per page |
| PoC Administrator | Requests `/procedures/new` or invokes either action | Refused with the verbatim sentence, audited, no Procedure data in the response | Hiding a control is never the control |
| Audit append fails | The event cannot be written | The whole transaction rolls back; the caller sees a refusal | A Draft that could not be audited does not exist |

</intent-contract>

## Code Map

Stories 1.6 and 1.7 built every mechanism this story needs. Follow them; do not reinvent
them. Read these BEFORE writing anything.

- `packages/domain/src/sources/population-source.ts` — the shape of a domain module that
  owns a vocabulary and a value type.
- `packages/domain/src/identity/roles.ts` — `GATED_ACTIONS`, the gating table, and
  `authorizeAction`. `procedure.author` already exists and is already tested for all
  three roles.
- `packages/domain/src/audit-event.ts` — `AUDIT_EVENT_FAMILIES` (closed),
  `EVENT_TYPE_PATTERN`, `SAFE_ID_PATTERN`, and `aggregateId` semantics.
- `packages/domain/src/canonical-json.ts` — the ONE canonicalizer. It refuses a lone
  surrogate, a NUL, and a non-finite number.
- `packages/application/src/sources/register-population-source.ts` — the command shape to
  copy: authorize, validate, then write and append inside one unit of work;
  `CommandRefused` **thrown** so a refusal rolls back; a full-row version token; write
  only when something moved.
- `packages/infrastructure/src/sources/` — the transaction-scoped writer and unit of work.
- `packages/infrastructure/src/db/identifier.ts` — `isUuidText`, called by every
  lookup-by-id in the repository.
- `packages/infrastructure/src/db/compat.ts` — `SUPPORTED_SCHEMA_MAX` rises to 7 in the
  same commit as the migration, and `SUPPORTED_SCHEMA_MIN` equals it.
- `apps/web/app/administration/sources/` and `apps/web/src/admin/Binding*.tsx` — the
  surface, its Server Actions, its input bounding, its confirmation dialog, its one
  Banner per surface.
- `apps/web/src/design/copy.ts` + `copy.test.ts` — how a contract sentence is pinned.
- `apps/web/src/design/Digest.tsx` — the only way a digest is rendered. Not needed here;
  named so it is not re-solved.
- `apps/web/app/procedures/page.tsx` — the placeholder this story replaces.
- `tests/integration/sources.test.ts` — how a stale-row guard is proved by holding one
  transaction open, and how CHECK constraints are asserted with raw SQL.
- `tests/integration/schema-compat.test.ts` — asserts the EXACT set of public tables. Two
  new names must be added there or it fails.

## Tasks & Acceptance

**Execution — in this order:**

1. `packages/domain/src/procedures/templates.ts` — the four Template records as frozen
   data, and the `TemplateId` union. Each record: id, name, control statement, objective,
   population-source default, target-system defaults, work-item coverage, audit
   instructions default, compliance-rule condition defaults (C1 compiled, C2
   Agent-Judged where §C says so — as DATA, not as a compiler), declared attribute
   labels, secondary key, evidence-requirement defaults, schedule default, golden binding
   reference, expectations version.
2. `packages/domain/src/procedures/templates.test.ts` — reads the addendum off disk,
   locates each `### P-n:` block, and asserts every stored default appears verbatim in
   that block. Also asserts there are exactly four Templates and that `P-1` is marked the
   hero.
3. `packages/domain/src/procedures/procedure-version.ts` — the state vocabulary, the
   permitted-transition table as data, `initialDraftSections(templateId)`, and the
   validator for the stored section payload.
4. Its `.test.ts` — every state reachable only through a permitted transition; the
   pre-fill for each Template equals the Template record.
5. `packages/application/src/procedures/ports.ts` — `ProcedureRepository`,
   `ProcedureWriter`, `ProceduresUnitOfWorkContext`.
6. `packages/application/src/procedures/create-procedure.ts` — `createProcedure`,
   `renameProcedureDraft`, `procedureVersionRowVersion`, the refusal strings, the two
   event types.
7. Its `.test.ts` — the refusals; that a failed append leaves nothing written; the
   stale-row guard; that an idle save writes and appends nothing; that a refusal is
   thrown and not returned.
8. `packages/infrastructure/src/db/schema.ts` + `drizzle/0007_*.sql` — `procedure` and
   `procedure_version`, generation 7. CHECK constraints on the state vocabulary, the
   Template id, a non-blank Control name, `version_number >= 1`, and a UNIQUE
   `(procedure_id, version_number)`. Raise `SUPPORTED_SCHEMA_MAX` in the same commit.
9. `packages/infrastructure/src/procedures/` — the Drizzle repository (guarded by
   `isUuidText`) and the transaction-scoped unit of work.
10. `apps/web/app/procedures/page.tsx` — the list: EmptyState, or cards with the four
    UX-DR7 cells in words.
11. `apps/web/app/procedures/new/page.tsx` + `actions.ts` — the Template picker (no
    default selection) and the Control-name field; the Server Action authorizes first,
    then bounds shape and length.
12. `apps/web/app/procedures/[id]/page.tsx` — Procedure Detail: the version list with a
    Draft badge, the Control name and Template identity, and the link into the Builder
    shell.
13. `apps/web/app/procedures/[id]/builder/page.tsx` + `actions.ts` — the Builder shell:
    the section headings in order, each showing its pre-filled values read-only under the
    "not editable yet" sentence, and the one editable field with its confirmation dialog.
14. `apps/web/src/design/copy.ts` + `copy.test.ts` — every new contract sentence, pinned.
15. `tests/integration/procedures.test.ts` — real PostgreSQL: atomicity both ways, the
    CHECK constraints asserted with raw SQL, the stale-row guard with one transaction
    held open.
16. `tests/integration/schema-compat.test.ts` — add the two table names.
17. `tests/e2e/procedures.spec.ts` — an Auditor creates a Procedure from each of the four
    Templates and sees the pre-filled sections; the empty state precedes them; a PoC
    Administrator is refused; axe finds no WCAG 2.1 AA violation.
18. `CLAUDE.md` — record the decisions this story takes (Design Notes below).

**Acceptance Criteria:**

- **Given** the Procedures surface with no Procedure, **when** an Auditor opens it,
  **then** an EmptyState appears whose only action is "New procedure".
- **Given** one or more Procedures, **when** an Auditor opens the surface, **then** each
  renders as a card showing its Active version, Schedule, next Run and last outcome, each
  stated in words when absent.
- **Given** the four Templates, **when** an Auditor chooses "New procedure", picks one,
  and names the Control, **then** a Procedure Version in `DRAFT` is created with every
  section pre-populated from addendum §C for that Template, and
  `lifecycle.procedure-created` is appended in the same transaction.
- **Given** any Template, **when** its stored defaults are compared with addendum §C read
  off disk, **then** every default appears verbatim in that Template's block.
- **Given** a Template record, **when** it is inspected, **then** it names its golden
  Population Source binding reference and the version of its expected outcomes and
  confirmation script.
- **Given** a Draft in the Builder shell, **when** the Auditor changes the Control name,
  **then** the change lands on that Draft only, `lifecycle.procedure-draft-changed` is
  appended in the same transaction, and no other Procedure or version is touched.
- **Given** a Draft changed in another tab, **when** the stale form is submitted,
  **then** it is refused with the Story 1.6 sentence and nothing is written.
- **Given** a PoC Administrator, **when** they request the New-procedure surface or
  invoke either Server Action, **then** they are refused verbatim, the refusal is
  audited, and no Procedure data reaches the browser.
- **Given** the audit append fails, **when** a Procedure is created, **then** nothing is
  stored and the caller is refused.

## Self-Validation Gate

**You validate this work. Do not hand it back for someone else to be its first reader.**
Every claim below must be one you personally reproduced in this working tree. A gate you
did not run is a gate that failed.

### 1. The commands, in this order, all clean

```
pnpm install
pnpm -r typecheck && pnpm typecheck
pnpm boundaries
pnpm test
pnpm build && pnpm --filter @intellifin/web build
pnpm db:generate            # must produce NOTHING new — a diff here means schema drift
pnpm test:integration       # needs a migrated PostgreSQL 18 on DATABASE_URL
pnpm test:e2e               # needs pnpm build, a migrated database, and pnpm seed:identity
```

`pnpm test:integration` and `pnpm test:e2e` must each pass **twice in a row**. A suite
that passes once may be passing on state its own first run created.

### 2. Mutation testing — the part that is not optional

A test suite that stays green when the code is wrong is worse than no suite: it is a
green light nobody earned. For each guard below, break the code, run the named suite,
confirm it FAILS, then restore the code and confirm it passes again. Record the mutation,
the suite, and the failing test name.

| # | Mutation to plant | Must fail |
|---|---|---|
| 1 | Change one Template default (an objective, a schedule) to a plausible near-miss | `templates.test.ts` |
| 2 | Delete one Template from the array | `templates.test.ts` |
| 3 | Return the refusal from inside the unit of work instead of throwing it | the atomicity case in `tests/integration/procedures.test.ts` |
| 4 | Make the audit append throw after the rows are written | the same file's rollback case |
| 5 | Remove the row-version check from `renameProcedureDraft` | the stale-row case, with a transaction held open |
| 6 | Move `requireServerAction` to AFTER the input is read | the Server Action denial test |
| 7 | Delete `requireAction` from the New-procedure page, keeping the nav hidden | the PoC Administrator e2e case |
| 8 | Replace a card's "No active version" with an empty string | the list test |
| 9 | Drop `method="post"` from a form | `form-method.test.ts` |
| 10 | Remove one CHECK constraint from the migration | the raw-SQL case in `tests/integration/procedures.test.ts` |
| 11 | Make the write unconditional so an idle save updates the row | the idle-save case |
| 12 | Point a Template's golden binding reference at a name that does not exist | `templates.test.ts` |

If a mutation does NOT fail its suite, the defect is in the test, not the mutation. Fix
the test and record it.

### 3. Adversarial re-read of your own diff

Answer each in writing, with the file and line:
- Which assertion in this diff **cannot fail**? (An assertion against a page rendered
  before the action, a contract compared with a copy of itself, a response compared with
  the function that produced it, a branch nothing exercises.)
- Which object lookup is keyed by request input and does not use `Object.hasOwn`?
- Which `aria-label` sits on an element that cannot carry an accessible name?
- Which `<form>` has no `method`?
- Which new `var(--…)` names a custom property nothing defines?
- Which CHECK constraint would still pass on the exact row it exists to refuse?
  (`array_length` of an empty array is NULL and a NULL CHECK PASSES; so is
  `NULL <> ALL(x)`.)
- Which code path reaches a database with a string the URL bar can supply?

### 4. The report

Write `_bmad-output/implementation-artifacts/self-validation-2-1.md` before handing back.
It contains: each command with its real output summary; the mutation table with the
failing test name for every row; your answers to section 3; and a plain list of anything
you could NOT run, with the reason. **An honest "I could not run the e2e suite because X"
is worth more than a green tick nobody can check.** Do not claim a result you did not
observe.

## Spec Change Log

## Review Triage Log

## Design Notes

**Why the Builder's sections are read-only here.** The acceptance criterion says the
Builder opens pre-populated and that changing a pre-filled value is scoped to the Draft.
Both are satisfied by rendering all sections and making ONE field editable. Building five
section editors would deliver stories 2.2 through 2.5 inside 2.1, un-reviewably, and each
of those sections carries its own domain rules — the `once`-Schedule restriction, the
declared-count block, the scope-widening check — that belong with the story that owns
them. The draft-scoped write path is proven once, here, by the Control name.

**Why the section payload is `jsonb` and not columns yet.** Stories 2.2–2.6 each promote
part of it to typed columns with their own constraints as they author that section. A
migration per section is the honest shape; inventing all of them now would fix a data
model against sections nobody has authored. The payload is never read untyped: the domain
owns its type and its validator, and the column is `NOT NULL`.

**Why the events are `lifecycle.*`.** `AUDIT_EVENT_FAMILIES` is a closed set with no
`procedure` entry, and widening it would change the pattern every existing event is
validated against. A Procedure Version's creation is a lifecycle transition, which is
what the family is for.

**Why the Template picker has no default.** Story 1.7 shipped a form defaulting to
`OPTIONS[0]`, which was the most restricted kind — so the surface showed a restriction to
somebody who had chosen nothing, and two browser assertions were true before the
selection they tested. A choice with a default is a choice the form made.

**Why viewing is ungated.** The gating table is 24 actions transcribed from EXPERIENCE.md
and checked against all three roles. Adding `procedure.view` would break that
completeness claim to express a rule the contract does not state. Mutations are gated;
reading the list is not.

**AD-2 says Templates are data owned by the procedures module.** It does not say where
that data lives. This story reads it as a build constant, for the same reason
`SUPPORTED_SCHEMA_MAX` is one: a Template's defaults are pinned to an addendum section
that ships with the image, and a Template row an operator could edit would let a
deployment drift from the contract its own tests assert. Recorded here so a later story
that wants operator-editable Templates changes this deliberately.

## Verification

**Commands:** see the Self-Validation Gate. Nothing here is verified by inspection.

**Manual checks:**
- Create one Procedure from each of the four Templates and confirm the four pre-fills
  differ in the sections addendum §C says they differ in.
- Open the Procedures list as a PoC Administrator and confirm the "New procedure" action
  is absent AND that requesting `/procedures/new` directly is refused.
