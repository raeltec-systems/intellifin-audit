---
title: '24.3 — Revise evaluations without overwriting facts or exceptions'
type: 'feature'
created: '2026-10-15'
status: 'ready-for-dev'
baseline_commit: '300d14e9b72ec3575090f023196483d47fa7f115'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/spec-24-1-bind-typed-criteria-and-facts-to-an-assessment-basis.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-24-2-show-exact-population-sample-and-coverage-denominators.md'
  - '{project-root}/_bmad-output/planning-artifacts/zobba-product-architecture-2026-09-30/Zobba-Product-and-Architecture-Design.md'
  - '{project-root}/zobba/README.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** 24.1 allows one evaluation per basis × criterion × subject (`UNIQUE(basis_id,criterion_id,subject)`, `0018_assessment_basis.sql:241`) and refuses re-evaluation when inputs changed ("Propose a new basis version to evaluate again", `application/src/assessment.rs:1898`). A fact cannot be corrected inside its basis (`UNIQUE(basis_id,subject,name)`), a successor basis starts empty, nothing links a new evaluation to the one it replaces, there is no human origin or disposition, and a `not_met` result is never an exception record. So late evidence, a correction or an auditor's disagreement either cannot be recorded or silently looks like a fresh, unrelated result, and an exception "disappears" when a later run simply does not observe it.

**Approach:** The agent keeps reading and acting natively. When evidence arrives or a human asks for reconsideration, it records new facts (same basis when the fact is new; a successor basis that carries unchanged facts by reference when a fact is corrected) and asks `evaluate` / `judgments` again. Trusted code — not the model — finds the predecessor, derives the closed cause from the input difference, and appends an immutable **evaluation revision**. Auditors save **dispositions** through an authenticated API against the exact revision. Every `not_met` becomes an occurrence of a Task-scoped **exception** whose status is derived from immutable occurrences, revisions and dispositions, never stored as a mutable flag. An **effective summary** recomputes the 24.2 partition over current revisions and dispositions, lists exceptions and limitations, and is recounted by the database.

## Boundaries & Constraints

**Always:**
- **Revision chain.** Chain identity = (Task, basis lineage root, criterion lineage root, subject unit, subject). Revision 1 is the 0018 evaluation (or 24.2 opportunity for bulk work, see summary). Revision n ≥ 2 is a row in new `assessment_evaluation_revisions` with `predecessor_id` = current head, `revision` = n, its own `basis_id`/`criterion_id` (may be a successor version), the 24.1 outcome columns (applicability, execution, verdict, reason, origin `deterministic|model_proposal`), inputs with digests, `output_digest` (24.1 `output_digest`, unchanged), proposing invocation, and `changes{added, removed, replaced}` fact-ID lists (≤32 each). No forks: one successor per head, enforced under a per-chain advisory lock. Trusted code finds the predecessor by exact query, never from the bounded snapshot.
- **Cause (closed, derived, ≥1, never model-written):** `inputs_changed` · `criterion_revised` (new criterion version in its `supersedes` chain) · `basis_revised` (new basis version: period, criteria or population changed) · `prior_execution_failed` (predecessor `execution failed` and its job has since completed) · `reconsideration_requested` (head carries a `needs_reconsideration` disposition). A request whose derived cause set is empty and whose output digest equals the head's records nothing and gives feedback ("unchanged; same output digest"); an empty cause with a different digest is a refused internal error, never a cycle failure.
- **Fact succession.** A fact absent from its basis may still be recorded there (24.1 rule). Changing a recorded fact needs a successor basis (`propose_basis` with `supersedes`, existing field) plus new answer field `carry_facts: {basis, except: [{subject, name}]}` (≤1 per answer, `except` ≤64): trusted code inserts `assessment_basis_carried_facts(basis_id, fact_id, from_basis_id)` rows for every effective fact of the predecessor not excepted — by reference, original verification kept, no copy, no re-parse. Effective facts of a basis = own facts ∪ carried facts minus any (subject, name) the basis records itself. The 1,024-fact bound counts own + carried. The original fact and every predecessor revision stay inspectable.
- **Disposition** (new `assessment_dispositions`, human only, via API): exact revision ID (0018 evaluation or revision row) + kind. For origin `deterministic`: `accepted` | `needs_reconsideration{concern: facts|rule|authority|scope}`. For origin `model_proposal`: `accepted` | `replaced{verdict met|not_met|undetermined}` | `needs_reconsideration{concern}`. Always: actor ID, session-bound request key (idempotent per actor), rationale (1–2,000 bytes, attributed data), 0–8 evidence references = 22.5 citation sources verified at write time by `application::citation::verify` (an unverified reference refuses the whole request, 409 `reference_unverified`, naming its index), database time. A disposition never alters the revision, its facts or its verdict columns; `replaced` is a separate human verdict whose effective origin is `human`. A deterministic verdict cannot be replaced: to change it, correct facts or criterion. Latest disposition per revision is effective; ≤16 per revision. Disposing a non-head revision is refused (409 `revision_superseded`, names the head).
- **Authority:** the actor holds a current Auditor or Audit manager role and a current assignment on the engagement (scope lock as `operations::decide`); Admin alone is refused. Recheck session, role and assignment inside the write transaction. A `needs_reconsideration` disposition wakes the Task (`task::wake`); no other disposition changes Task state.
- **Exceptions.** New `assessment_exceptions` (identity: Task, criterion lineage root, subject unit, subject, kind `criterion_not_met`; first-occurrence reference) and `assessment_exception_occurrences` (exception, occurrence source = 0018 evaluation | revision | 24.2 opportunity | human `replaced not_met`, origin, created). Written by trusted code in the same transaction as the `not_met` record (including the 24.2 opportunity batch). Derived status (pure domain fn, closed): `open` · `resolved_by_evidence` (chain head is `met`, completed, cause includes `inputs_changed`/`basis_revised` with a newer source, and its inputs differ from the failing occurrence's) · `replaced_by_human_judgment` (head's effective disposition `replaced` = met; owner decision 2026-10-21: a person's `replaced undetermined` keeps the exception open and says "a person marked this undetermined; this is not evidence of remediation") · `closed_by_disposition` (exception disposition below). Plus `latest_observed: not_met|not_observed` — a head that is undetermined, failed, not applicable, absent from a later population, or missing keeps the exception `open` and says "not observed in the latest revision; this is not evidence of remediation".
- **Exception disposition** (`assessment_exception_dispositions`): `closed{rationale, ≥1 verified evidence reference}` or `reopened{rationale}` by an Audit manager or the Task's accountable actor; same key/session/recheck rules. A later `not_met` occurrence after closure reopens it (derived). Cross-Task and cross-period continuing finding identity is out of scope (Epic 26).
- **Effective outcome** (pure `domain::revision::effective`): head revision outcome, overlaid by its effective disposition (`replaced` → human verdict, origin `human`; `accepted` → unchanged, labelled accepted; `needs_reconsideration` → unchanged verdict but `pending_reconsideration`). `unreviewed` is the absence of a disposition. A new revision after an accepted predecessor shows "earlier version accepted; this version unreviewed". 24.2 judgment opportunities resolve their `evaluation_id` to its chain head.
- **Effective summary version** (new answer field `summarise_effective: [{basis, population, sample?}]` ≤2; table `assessment_effective_summaries`, aggregation `effective_partition_v1`, `supersedes` a previous effective summary of the same population lineage): 24.2 `summarise` over effective outcomes, plus exact counts per criterion of human-replaced and pending-reconsideration opportunities, pending dispositions, exceptions by derived status and distinct exception subjects; closed limitation codes with words (`population_incomplete`, `unresolved_subjects`, `pending_reconsideration`, `unreviewed_model_proposals`, `superseded_inputs_not_reevaluated`, `sample_only`). Exceptions are listed (bounded 50 with exact total) beside the 24.2 denominators; `exceptions_found_inconclusive` stays when unresolved exist. The insert guard recomputes every count with exact SQL over a new SQL function `assessment_effective_outcomes(population)` and refuses disagreement.
- **Agent use.** `evaluate` and `judgments` produce a revision instead of the 24.1 refusal when a head exists and a cause is derived; `judgments` on a head without `reconsideration_requested`, changed inputs or a new criterion/basis are refused with feedback. Outline gains one exact-count line per basis: heads, revisions, pending reconsiderations (with each disposition's concern and rationale inside the existing untrusted-content envelope, attributed to the person), open exceptions. Invalid or refused entries go to `discarded`/feedback; model-controllable input never fails a cycle.
- **Migration 0020 `assessment_revisions.sql`** (additive; 0001–0019 and catalogues v1–v19 byte-unchanged): the six tables above + `assessment_basis_carried_facts`, the SQL function, an added BEFORE INSERT trigger on `assessment_evaluations` refusing a revision-1 row for a chain whose predecessor basis already has a head (the new basis must revise, not restart), immutability (UPDATE/DELETE refused; TRUNCATE only under `zobba.disposable_fixture_reset=on` in `*_test`), forced RLS, runtime SELECT/INSERT, guards (custody or human-actor authority, same Task, closed vocabularies, bounds, no fork, cause/inputs agreement, deterministic not replaceable, dispositions only on heads). `SCHEMA_VERSION` 20, `schema-v20.catalog`, inventory lists/grants, `published.rs` pins 0019/v19.
- **API/Web.** POST `/engagements/{e}/tasks/{t}/assessment/revisions/{id}/dispositions`, POST `/…/assessment/exceptions/{id}/dispositions` (Origin, CSRF, `X-Expected-Actor`, key; strict body); GET `/…/assessment/chains/{id}/history?cursor=` (exact count, C-ordered 50 page, values withheld by 24.1 `value_withheld` rules). Panel: revision history per evaluation (predecessor, causes, changed facts), disposition form for assigned auditors (keyboard and screen-reader usable, rationale counter in bytes, evidence chips), exception list with derived status in words, effective summary with denominators and limitations. WCAG 2.2 AA.

**Ask First:** Any new crate; a `waived` disposition or any rule that changes a failing count; cross-Task or cross-period finding identity; Admin-configured disposition authority; custom sandbox-program criteria; any live provider run.

**Never:** UPDATE/DELETE of a fact, evaluation, opportunity, revision, disposition or exception; a model-written cause, predecessor, disposition or exception status; a human disposition that rewrites a deterministic verdict; closing or resolving an exception because a later revision did not observe it; numeric confidence; counts from a bounded page; treating `accepted` as review sign-off (24.5); a compiled step pipeline; live provider calls in tests.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Late evidence, same basis | INV-0042 `undetermined missing_fact` (approver); agent later records a supported approver fact and calls `evaluate` | revision 2, cause `inputs_changed`, `changes.added=[fact]`, verdict `met`; revision 1 unchanged and listed in history | N/A |
| Corrected fact | amount fact wrong; agent proposes successor basis + `carry_facts except [{INV-0042, amount}]` + new amount fact | carried facts by reference; revision cause `basis_revised,inputs_changed`, `replaced=[old→new]`; old fact still readable | N/A |
| Same output | `evaluate` again, no change | nothing recorded; feedback "unchanged" | no cycle failure |
| Failed then completed | revision 1 `execution failed analysis_failed`; job now completed | revision 2 cause `prior_execution_failed` | N/A |
| Human disagrees | model_proposal `met`; auditor `replaced not_met`, rationale, 1 verified reference | disposition row with actor, key, revision ID; effective verdict `not_met` origin human; exception occurrence (human) created; model revision unchanged | unverified reference → 409 `reference_unverified`, nothing written |
| Deterministic override attempt | `replaced` on a deterministic revision | 400 `not_replaceable` | nothing written |
| Stale disposition | disposition on revision 1 after revision 2 exists | 409 `revision_superseded` naming head | N/A |
| Unauthorised | Admin-only or unassigned member | 403 | denial not recorded as disposition |
| Reconsideration | `needs_reconsideration{facts}` | Task woken; outline shows concern in envelope; agent's next judgment becomes revision cause `reconsideration_requested` | judgment without cause refused with feedback |
| Not observed later | exception from population v1; v2 (supersedes) lacks the subject | status `open`, `latest_observed not_observed`, sentence "not evidence of remediation" | N/A |
| Resolved by evidence | v2 from a new original shows the subject `met` | `resolved_by_evidence`; occurrence history intact | N/A |
| Exception closed | Audit manager `closed` with rationale + verified evidence | `closed_by_disposition`; a later `not_met` occurrence makes it `open` again | auditor without manager role → 403 |
| AC3 summary | 24.2 AC2 fixture, then 3 failing subjects resolved by evidence and 2 human-replaced | effective summary: failing 15, distinct exception subjects listed with statuses, unresolved 20, `exceptions_found_inconclusive`, limitation `unresolved_subjects`; denominators equal 24.2's | forged count refused by guard |
| Fork attempt | two concurrent revisions of one head | one commits; the other refused, retried by trusted code as successor or dropped with feedback | N/A |
| Old records | 24.1/24.2 rows with no revisions | head = revision 1, `unreviewed`; old answers decode, schema digests unchanged | N/A |

</frozen-after-approval>

## Code Map

- `zobba/crates/domain/src/assessment.rs:155-192` -- `Applicability`/`Execution`/`Verdict`/`Origin`/`EvaluationReason` (reuse; do not add `human` to `Origin` — human verdicts live in dispositions). `:1211-1238` `ProposedJudgment`; `:1246-1300` `InputFact`, `EvaluationContext`, `Outcome::is_valid`; `:1576` `evaluate`, `:1612` `judge`, `:1668` `output_digest` (unchanged). `:1793` `answer_fields`, `:2050` `decode_basis` (pattern for `carry_facts`).
- New `zobba/crates/domain/src/revision.rs` (+ `revision/tests.rs`, `lib.rs` module, `SCHEMA_VERSION` 20 at `lib.rs:24`) -- `RevisionCause`, `DispositionKind`, `Concern`, `ExceptionStatus`, `LimitationCode` vocabularies (copy `vocabulary!` pattern `assessment.rs:69-192`); pure `causes(pred, new)`, `effective(head, disposition)`, `exception_status(occurrences, head, dispositions)`, canonical digests.
- `zobba/crates/domain/src/coverage.rs:1055-1130` -- `Summary`, `conclusion`, `summarise` (reuse; add `summarise_effective` over effective outcomes); `:1412` `answer_fields`, `:1672` `decode_summary` (pattern for `summarise_effective`).
- `zobba/crates/domain/src/citation.rs` -- `CitedAnswer` assessment fields (24.1/24.2 additions); add `carry_facts` (≤1), `summarise_effective` (≤2); old answers decode with unchanged bytes and schema digests.
- `zobba/crates/application/src/assessment.rs:225-300` `AssessmentStore` (add head/chain/revision/carried-fact/exception readers and writers; exact queries), `:1640-1660` fact-already-held feedback (point to successor + `carry_facts`), `:1852-1900` evaluate set-aside and inputs-changed refusal (replace with revision path), `:1970-2015` judgments (revision path), `:2174` `feedback_text`, `:2278` `outline`, `:66` `ASSESSMENT_CONSTRAINTS` (one paragraph). `application/src/assessment/coverage.rs` (added by 24.2) -- opportunity batch: add exception occurrences; effective summary step.
- `zobba/crates/application/src/citation.rs:48-130` -- `verify` for disposition evidence references. New `zobba/crates/application/src/disposition.rs` -- human commands, validation, authority result types.
- `zobba/crates/infrastructure/src/assessment.rs:66` `claimed`, `:79` `scoped`, `:328` `evaluations_of`, `:527` `record_evaluation`, `:591` `snapshot`, `:1088` `record_opportunities`, `:1184` `record_summary`, `:1238` `insert_summary` -- extend; add revision/disposition/exception repository functions and the history cursor.
- `zobba/crates/infrastructure/src/operation.rs:949-1020` -- authority, key idempotency and `task::wake` pattern to copy for dispositions; `zobba/crates/infrastructure/src/task.rs:146` `wake`.
- `zobba/migrations/0018_assessment_basis.sql:181-330,351-373` and `0019_assessment_coverage.sql:178-262,421-430` -- table, guard, advisory-lock, recounting-guard and immutability patterns for `0020_assessment_revisions.sql`.
- `zobba/crates/infrastructure/src/lib.rs:124,131,154,233,497-510,590-596,624-635,724-729,1708` -- inventory lists, function checks, catalogue chain (`schema-v20.catalog`), grants. `zobba/crates/infrastructure/tests/published.rs` -- pin 0019 and v19.
- `zobba/crates/api/src/work.rs:219-224,726` (assessment response), `crates/api/src/coverage.rs` (added by 24.2), `crates/api/src/tasks.rs:95` (route registration), `crates/api/src/operations.rs:627-665` (mutation-scope handler pattern) -- new routes, `openapi.json`, `web/src/generated/api.ts`.
- `zobba/web/src/AssessmentBasis.tsx`, `Coverage.tsx`, `assessment.ts`, `coverage.ts`, `Citation.tsx` -- history, disposition form, exceptions, effective summary; tests beside `web/tests/assessment.test.mjs`, `web/tests/browser/assessment.spec.ts`.
- `zobba/fixtures/documents/generate.py` -- add a late-evidence approval workbook and a corrected AP population successor with an `expected` JSON.

## Tasks & Acceptance

**Execution:**
- [ ] `zobba/crates/domain/src/revision.rs` (+ tests, `lib.rs`) -- vocabularies, cause derivation, effective outcome, exception status, digests; tests for every matrix row's pure part and determinism by repeat digest.
- [ ] `zobba/crates/domain/src/coverage.rs`, `citation.rs` -- `summarise_effective`, two answer fields, bounds, schema; old-answer and schema-digest compatibility.
- [ ] `zobba/crates/application/src/assessment.rs` (+ `coverage.rs`, tests) -- revision path for `evaluate`/`judgments`, `carry_facts`, effective facts, occurrences, effective summary, envelope feedback, exact outline counts.
- [ ] `zobba/crates/application/src/disposition.rs` -- commands, reference verification, authority checks.
- [ ] `zobba/migrations/0020_assessment_revisions.sql`, `infrastructure/src/assessment.rs`, `schema-v20.catalog`, `lib.rs`, `published.rs` -- tables, function, guards, trigger on `assessment_evaluations`, immutability; PostgreSQL tests: fork refusal under concurrency, deterministic not replaceable, stale/unauthorised refusals, forged effective counts, reset exception, RLS.
- [ ] `zobba/crates/worker/tests/revision.rs` -- synthetic-model end-to-end: late evidence same basis, corrected fact via successor + carry, reconsideration loop, not-observed exception stays open, resolved by evidence, AC3 effective summary numbers.
- [ ] `zobba/crates/api/src/` routes + `openapi.json` + generated client -- disposition commands, history, effective summary; API tests for authority, idempotent retry, conflicting retry, withholding.
- [ ] `zobba/web/src/` panel changes (+ unit, browser case with keyboard path and contrast).
- [ ] `zobba/fixtures/documents/generate.py` outputs; `zobba/README.md` -- what is proven offline.

**Acceptance Criteria:**
- Given any revision, when its history is read, then every predecessor, its facts, verdicts and causes are inspectable and unchanged.
- Given a disposition, when inspected, then actor, rationale, verified references and the exact revision ID are separate from the revision's own columns, and the revision row is byte-identical to before.
- Given an exception whose latest revision does not observe it, when shown, then its status is `open` and says this is not evidence of remediation.
- Given an effective summary, when recounted with SQL over `assessment_effective_outcomes`, then every count agrees and a forged summary is refused.

## Design Notes

Three layers that never overwrite each other: **facts** (what a source showed), **revisions** (what trusted code or the model concluded from a pinned set of facts), **dispositions** (what a person decided about one exact revision). Exceptions are a view over all three, with their own immutable occurrences.

```text
chain AP-basis / approval-required / invoice / INV-0042
 r1 eval-…a  undetermined missing_fact          (basis b1)
 r2 rev-…b   met  cause inputs_changed +approver (basis b1)
 r3 rev-…c   not_met cause basis_revised,inputs_changed replaced amount (basis b2, carried 63 facts)
     disposition accepted by auditor-7 (rationale, 1 reference) → effective not_met
 exception exc-… : open, occurrences [r3], latest observed not_met
```

24.1 lessons applied: disposition references are whole-value verified quotes; human rationale is attributed data shown inside the untrusted-content envelope when fed to the model; bounds are checked at write time in Rust and SQL; view values follow the viewer's current access; model mistakes become feedback, not failed cycles. Predecessor and cause are found and derived by trusted code because a model-chosen predecessor could silently re-root history.

Size: about 6,300 tokens, far above the 1,600 target (24.1 and 24.2 were also large and kept). **[K] Keep** (recommended: exceptions and the effective summary read the same revision heads and dispositions; split halves would ship one without its consumer) or **[S] Split** — 24.3a revisions, carried facts and dispositions; 24.3b exceptions and the effective summary.

## Verification

**Commands:**
- `cargo fmt --all --check && cargo clippy --workspace --all-targets -- -D warnings` -- expected: clean.
- `cargo test --workspace --locked -- --test-threads=1` on a guarded `_test` database -- expected: all pass.
- `pnpm --dir zobba/web check` and the revision browser case -- expected: pass with accessibility and contrast checks.

## Open Questions (owner decisions)

**Owner decision (2026-10-21, follow-up):** remove the hard cap of 16 dispositions per exception (and, by the same reasoning, per revision). An exception or a revision must never become permanently undecidable. Keep the full immutable disposition history, read it in bounded pages with a cursor, and bound only how much one read loads; database guards must not depend on reading the whole history in one bounded read. Scheduled as a 24.3b follow-up after the 24.4 build (both touch the same files).

**Owner decisions (2026-10-15):** decisions 1–7 approved as recommended (A): successor basis with `carry_facts` by reference; any assigned Auditor or Audit manager may dispose, only an Audit manager or the accountable actor may close an exception; deterministic results are never replaced; no waivers; Task-scoped exceptions; custom sandbox-program criteria deferred to a named follow-up Story 24.7; dispositions on a superseded revision are refused and the 409 names the current head. **Split (S)** after independent advisor review: **24.3a** = revision chains, carried facts and human dispositions (with their API, guards and panel parts); **24.3b** = exception occurrences/status and the effective summary (24.3b backfills occurrences from existing `not_met` revisions). Build 24.3a first; order the migration so 24.3b's tables and guard are separable (24.3a migration 0020/v20, 24.3b migration 0021/v21).

**Owner decisions (2026-10-21, 24.3b review round 1):** (1) An **unreviewed** model proposal of `met` never moves an exception to `resolved_by_evidence`: it stays open and says "a model proposal suggests this is met; awaiting human review" (`latest_observed: proposed_met`). Only a deterministic rule result, a model proposal a person `accepted`, or a person's `replaced met` resolves or replaces it. (2) A person's `replaced undetermined` does **not** count as `replaced_by_human_judgment`: the exception stays open and says "a person marked this undetermined; this is not evidence of remediation" (`latest_observed: person_undetermined`).

1. **Changing a recorded fact.** (a) Recommended: successor basis + `carry_facts` by reference (original verification kept, cheap, explicit). (b) Agent re-records every fact it still needs in the successor basis (re-verified, up to 1,024 quotes again).
2. **Who may save an evaluation disposition.** (a) Recommended: any currently assigned Auditor or Audit manager of the engagement; exception `closed` only by an Audit manager or the Task's accountable actor. (b) Only the accountable actor or an assigned Audit manager for both (the 20.5 decision rule).
3. **Overriding deterministic results.** (a) Recommended: never; a person accepts or asks for reconsideration, and a change comes from corrected facts or a new criterion version. (b) Allow `replaced` on deterministic results with an Audit manager role.
4. **Waivers.** (a) Recommended: no `waived` kind in 24.3; an exception is resolved by evidence, replaced by human judgment, or closed by an accountable disposition with evidence, and failing counts never drop. (b) Add `waived` as a visible disposition that keeps the failing count and lists waived exceptions separately.
5. **Exception identity scope.** (a) Recommended: Task-scoped (criterion lineage, subject unit, subject); continuing cross-period/Check identity stays in Epic 26. (b) Engagement-scoped now.
6. **Custom sandbox-program criteria (deferred by 24.1 to 24.2/24.3; 24.2 did not build them).** (a) Recommended: still deferred to a named follow-up story — pinning program/environment digests and a trusted output contract is its own work, and the rule-to-authority gap (24.1 Design Notes) grows with programs. (b) Add a `program` criterion method in 24.3 using a completed 22.4 job's output parsed by trusted code into the closed verdict vocabulary.
7. **Disposition on a superseded revision.** (a) Recommended: refused with the current head named. (b) Allowed and shown as historical.

## 24.3a delivered

Built on `codex/zobba-foundation-batch` (commits 764c194 … HEAD). Migration
0020 / catalogue v20 / `SCHEMA_VERSION` 20; 0001–0019 and v1–v19 unchanged
(`published.rs` pins 0019 and v19). 24.3b's exception and effective-summary
tables are not built; they go in 0021.

Tasks (24.3a parts; 24.3b parts left open):
- [x] `domain/src/revision.rs` (+ tests) — closed causes and their derivation, changes by fact name, revision digest, disposition request/check, effective outcome, `carry_facts`. (Exception status: 24.3b.)
- [x] `domain/src/citation.rs` — the `carry_facts` answer field (≤1, excess dropped and counted); older answers still decode. (`summarise_effective`: 24.3b.)
- [x] `application/src/assessment.rs`, `assessment/revision.rs` (+ tests) — revision path for `evaluate`/`judgments`, no-op reruns record nothing, carried facts, effective facts, fact bound counts carried facts, envelope feedback, revision outline with pending reconsiderations as quoted data.
- [x] `application/src/disposition.rs` (+ tests) — command, write-time reference verification, refusals.
- [x] `migrations/0020_assessment_revisions.sql`, `infrastructure/src/assessment/revision.rs`, `schema-v20.catalog`, `lib.rs`, `published.rs`, `bootstrap.rs` — four tables, guards, `revision_first` trigger on `assessment_evaluations`, immutability, RLS.
- [x] `worker/tests/revision.rs` — synthetic-model end to end: late evidence same basis, unchanged rerun, corrected fact via successor + carry, reconsideration loop through the real API, DB guard forgeries. (Exception rows: 24.3b.)
- [x] `api/src/revisions.rs` + `work.rs` + `openapi.json` + generated client — disposition POST, history route, chain heads in the work view; API unit tests.
- [x] `web/src/revision.ts`, `EvaluationReview.tsx`, `AssessmentBasis.tsx` (+ `tests/revision.test.mjs`, `tests/browser/revision.spec.ts` with keyboard path and contrast).
- [x] `zobba/README.md` — what is proven offline. (No `generate.py` change was needed: the existing `AP invoices.xlsx` and `AP policy.txt` serve.)

Deviations and fixes found on the way (each with a failing-if-broken test):
- Chain identity is (Task, basis lineage, criterion lineage, subject): 24.1 evaluations record no subject unit.
- A reconsideration causes a revision only when the request sent for the answering turn showed it (Rust and the SQL guard check the stored request), and an unseen one is due a further turn. Without this, the work loop's idempotent replay of the last answer on a reclaim recorded a revision the model never made.
- A `needs_reconsideration` disposition resumes a Task that is waiting for direction (paused/stopped stay so); a bare wakeup alone never ran a turn.
- Disposition reference reads are bound to the person's exact session (evidence repository `with_session_hash`), like every other original read.
- Pre-existing defect fixed: a document read now reuses the Task's newest job of the same program, so a fact may cite cells an earlier fact cited in an earlier cycle (the deterministic job key's operation carried its own expiry and was refused as a conflict).
- Pre-existing defect fixed: the work panel gave `AssessmentBasis` and `Coverage` the same React key, which duplicated the panel on re-render.
- The 24.1 worker assertion about re-evaluation feedback now checks the replayed records (the replay reports what it wrote; no new rows).
- Smoke, the web health parser and the browser runtime expect schema 20; the browser fixture reset deletes the four new tables.

Verification (sequential):
- `cargo fmt --all --check`: clean. `cargo clippy --workspace --all-targets --locked -- -D warnings`: clean.
- `cargo test --workspace --locked --no-fail-fast -- --test-threads=1`: 56 targets, 693 passed, 15 failed on the first run. The 15 were (a) `reading::tests::repeated_population_reads_reuse_the_collected_job_and_never_run_out_of_keys` (my document-job reuse also re-ran a failed ordinary read; fixed: an ordinary read keeps its collected outcome, failure included, and the test now asserts it) and (b) 14 `oidc_protocol` tests whose running OIDC fixture still held the expired, since-regenerated material (fixture restarted). Reruns: application lib 138/138, `oidc_protocol` 14/14, `worker --test revision` 3/3; `worker --test assessment` 3/3 and `--test coverage` 3/3 passed earlier on this tree.
- `pnpm --dir zobba/web check`: 225 tests, 223 pass, 2 fail (the two known IPv6 loopback cases). `pnpm --dir zobba/web build`: ok.
- Browser: `revision.spec.ts` 3/3; `assessment.spec.ts` 2/2, `coverage.spec.ts` 2/2, `investigation.spec.ts` 2/2.
- `python3 scripts/smoke.py`: passed (after updating its expected schema to 20).
- The local OIDC fixture's certificates had less than a day left; `fixtures/oidc/.local` was regenerated (ignored files, no credentials committed).

## 24.3a review round 1

Reports: `review-24-3a-blind-hunter.md` (BH), `review-24-3a-edge-case-hunter.md`
(ECH), `review-24-3a-verification-gap.md` (VG). Migration 0020 and catalogue v20
were amended (unreleased; v20 regenerated byte-preservingly); 0001–0019 and
v1–v19 are unchanged. Every fix has a test that fails without it.

| Item | Finding | Outcome |
|------|---------|---------|
| A | BH H1, ECH H3: outline budget drops reconsiderations; `unseen` loops | **Fixed.** Pending reconsiderations travel in their own request message (`assessment-reconsiderations`), bounded to the newest 8 with the exact count of the rest (at most about 13 KiB), so the outline budget can never drop one. `unseen` asks for a further turn only for a listed one this request did not show; a shown one the model ignores never loops (unit and end-to-end: one turn after resume, then waiting). |
| B | BH M1, ECH M2, BH L3: substring "model saw it"; unescaped rationale; wrong provenance | **Fixed.** Each line starts with the structured marker `- reconsideration <disposition ID> of <head ID> (`; subject, label and words are canonical JSON strings, so no newline can start a line. Rust and SQL check the same scope: the answering turn's own `user` message with that source ID, for the head's newest disposition. Class `person-input` (new `InputClass`), attributed to the person. |
| C | BH M2, ECH H2: two revision-1 chains → permanent `Unavailable` | **Fixed (resolution, no backfill).** `heads()` keeps one continuing chain per subject: the one whose revision 1 was recorded last (database time, then ID). This matches 24.1, which evaluated under the newest basis; the earlier chain stays closed and inspectable. A backfill was rejected: it would copy an evaluation into a revision row. A basis or criterion version has at most 64 earlier versions, refused at proposal (Rust feedback and SQL guard), so every 64-step walk (Rust, `revision_first`, `LINEAGE`, guards) reaches the root. |
| D | BH M3, ECH M5, BH L5: version forks; false "later version" | **Fixed.** A version has at most one successor. The fact guard refuses a second one under an advisory lock, and Rust gives feedback that names the existing successor. A database refusal of a criterion or basis is now feedback, not a failed cycle. A trigger is used, not a UNIQUE index: a legal 24.1 fork must not stop the upgrade. The feedback now says "a later version" or "not a version that basis/criterion succeeds", and judgment refusals forward their real reason. |
| E | BH M4, VG M5: disposition authority in SQL | **Fixed.** The guard requires `coalesce(knowledge_audit, false)` and `evidence_session_locked(actor, zobba.session_hash)`. The API sets the session hash only for the write transaction, so a worker connection cannot save a disposition, and an unset scope is refused. Tests: Admin with an assignment (403), no scope, no session, Admin forgery. |
| F | ECH M1: replay before authority | **Fixed.** `disposition_by_key` runs the session, role and assignment fence first. Revoked replay: 403 (unit and end to end). |
| G | ECH M3: human met/not_met on an undecidable head | **Fixed.** Rust `check(origin, decidable)` and SQL refuse `replaced` met or not_met unless the head is applicable, completed and under a verified authority (`400 verdict_not_decidable`). `undetermined` stays possible. SQL negative case: none in the fixture data (no undecidable judgment). Covered by domain and application tests. |
| H | ECH M4: partial quotes as references | **Fixed.** The 24.1 `whole_value` rule is applied to every reference (byte ranges against their widened context; exact locators by equality). |
| I | ECH M6: population evaluation reads revision 1 | **Fixed.** It reads chain heads and effective facts. A subject whose head is a later revision, or reads another basis version, cannot be a 24.2 opportunity (0019 pins revision-1 judgments of the population's basis). It is counted as not evaluated, never given its superseded first verdict, and the exact count is in the feedback. |
| J | ECH M7: refused carry, successor still evaluated | **Fixed.** A refused carry stops evaluations and judgments of that successor in the same answer, with feedback. |
| K | ECH H1, M8, BH L2, VG L1 | **Fixed.** `earlier_accepted` parses with any review state (the words adapt). The label is bounded to 200 characters. An uncertain body keeps its key after edits that return to it (browser test). Blank follows Rust White_Space. The two multi-rule parser cases now break one rule each, plus the cursor rule. Page-only references are no longer offered (ECH L10). |
| L | BH L1: resume without an event | **Fixed.** The resume writes the Task's `observed` event in the disposition transaction (asserted as the first event after the save). |
| M | VG H1–H4, M1–M10, lows | **Fixed**, except the items marked deferred below. Forged `changes` three ways; head's version or later (Rust: judgment and criterion paths, `criterion_revised`; SQL: older basis, unrelated criterion); a disposition racing a revision and two concurrent revisions (held transaction, `pg_stat_activity` advisory wait, one successor, 409 naming the new head, nothing written); a database-refused revision is feedback; carried facts the successor records itself, more than stated, too few at commit; the own+carried 1,024 bound in the fact guard, in the carried batch and in `carry_step`; each cause omitted, a false `prior_execution_failed`; an answer that never showed the reconsideration; paused Task stays paused; the 16 cap and a retry at the cap; excepted and shadowed inputs; another subject; owner UPDATE/DELETE reach the trigger (forced RLS lifted in a rolled-back transaction); owner TRUNCATE; carries TRUNCATE alone; RLS under two engagements; `revision_first` on a successor basis; four unverified references; the guard-message mapping (unit); a job-reuse test that fails on the old code (no second admission); one panel per re-read; history window at 49/50/51 (unit) and withholding in history; specific messages instead of a bare `is_err`; another Task's disposition (404), history (403) and SQL chain. Three SQL mutations (session clause, changes check, carried term) each fail the proof. |
| N | BH L4: subject unit not in the chain identity | **Kept (documented deviation).** 24.1 evaluations do not record a subject unit. Adding it would need a published-table change or a per-chain inference from facts. A criterion version whose subject unit differs is not distinguished: its subject text continues the same chain. |

Deferred, each with its reason:
- Replay on a real reclaim, end to end (VG M2). The SQL forgery (revision 3 under an earlier answer whose request never listed the reconsideration) and the application `turn-2b` case prove the rule. Forcing a reclaim of the last answer needs a claim-loss harness that this suite does not have.
- "One carried fact per subject and name" alone (VG H4). The effective-fact rule implies it, because a basis has one effective fact per subject and name, so no forgery can reach it alone. It stays as a second lock.
- A SQL negative case for G (see G above).
- The `reference_unverified` mapping end to end. It needs a reference to change between Rust verification and the write. The mapping is tested as a unit (`refusal_of`), and the four SQL reference forgeries are tested. The refusal still names index 0, because the guard checks all references at once.
- ECH lows not fixed (each is small and safe today):
  - (1) a carry into a basis that already has a successor;
  - (2) a shadowed carried row counts toward 1,024. This is conservative: it refuses early and never admits more;
  - (3) a reconsideration answered by a revision for another cause;
  - (5) two references to one lineage in one answer;
  - (8) the outline's per-basis lines have no "further bases" line and show no carry;
  - (9) a malformed `head_id` in a 409 reads as uncertain;
  - (11) a wall-time `limit_exceeded` document job stays the Task's outcome for that program;
  - (12) the panel does not refresh history after a save.
- VG L2 (the browser answers its own POST) is unchanged. The real route runs in the worker proof. The `_test` name condition of the fixture reset is not tested separately.

Verification after the last change (sequential, exact):
- `cargo fmt --all --check`: clean. `cargo clippy --workspace --all-targets --locked -- -D warnings`: clean.
- `cargo test --workspace --locked --no-fail-fast -- --test-threads=1`: 56 targets, 725 passed, 0 failed, 4 ignored. No rerun was needed (`final_validation_expiry` passed in the full run). The first attempt stopped at compile time because the disk was full. `target/debug` was cleared and the whole run was repeated.
- `pnpm --dir zobba/web check`: 225 tests, 223 passed, 2 failed (the two known IPv6 loopback cases). `pnpm --dir zobba/web build`: ok.
- Browser `revision.spec.ts`, `coverage.spec.ts`, `assessment.spec.ts`, `investigation.spec.ts`: 11 passed.
- `python3 scripts/smoke.py`: passed.

## Suggested Review Order (24.3a)

1. `zobba/migrations/0020_assessment_revisions.sql`:
   - `assessment_guard` (one successor, 64-version lineages, own+carried bound);
   - `revision_guard` (head, causes, the reconsideration marker in the `assessment-reconsiderations` message, changes, the disposition session and scope, decidable person verdicts, references);
   - `revision_batch`, `revision_complete`, `revision_first`;
   - immutability and RLS.
2. `zobba/crates/domain/src/revision.rs`: causes, changes, effective, `DispositionRequest::check(origin, decidable)`. Also `context.rs` (`InputClass::PersonInput`).
3. `zobba/crates/application/src/assessment/revision.rs`:
   - `reconsiderations_text`, `reconsideration_marker`, `shown_reconsideration`;
   - `plan_revision` (version relations), `version_refusal`;
   - `carry_step` (refused carry);
   - with the step 4/5 path in `assessment.rs` (unseen rule, forwarded refusals) and `assessment/coverage.rs` (heads in population evaluation).
4. `zobba/crates/application/src/disposition.rs`: replay after the fence, whole-value references, `NotDecidable`.
5. `zobba/crates/infrastructure/src/assessment/revision.rs`: `continuing`, `successor`, `record_disposition` (session GUC, resume event, `refusal_of`), `page_window`, `target_in` (decidable).
6. `zobba/crates/api/src/revisions.rs`: refusal codes, `history_response`.
7. `zobba/crates/application/src/reading.rs`: document-job reuse, and its new test.
8. `zobba/crates/worker/tests/revision.rs`: the end-to-end proof, races, and `database_guards_refuse_altered_revision_records`.
9. Web:
   - `zobba/web/src/revision.ts` and `EvaluationReview.tsx`;
   - `tests/revision.test.mjs` and `tests/browser/revision.spec.ts`.

## 24.3b delivered

Built on `codex/zobba-foundation-batch` (commits 6124596d … HEAD). Migration
0021 / catalogue v21 / `SCHEMA_VERSION` 21; 0001–0020 and v1–v20 unchanged
(`published.rs` pins 0020 and v20).

Tasks (24.3b parts):
- [x] `domain/src/exception.rs` (+ tests) — exception ID, observation ordering, `resolves`, `exception_status` (open / resolved_by_evidence / replaced_by_human_judgment / closed_by_disposition, never stored), status words with the not-remediation sentence, exception disposition request/check (no waivers; a closure needs evidence), `summarise_effective` (24.2 partition over effective outcomes, per-criterion human/pending/undisposed/superseded counts, exception counts by status and distinct subjects, 50 listed, closed limitations in words, "at least" on an incomplete population), document round trip and consistency.
- [x] `domain/src/citation.rs` — the `summarise_effective` answer field (≤2, excess dropped and counted); older answers still decode.
- [x] `application/src/assessment/exception.rs`, `assessment.rs` (+ tests) — the effective-summary step (unchanged result records nothing; a database refusal is feedback, never a failed cycle; missing opportunities and foreign populations are feedback), outline lines counting exceptions by status per newest basis version, `effective_row`.
- [x] `application/src/exception.rs` (+ tests) — the exception disposition command: write-time reference verification (shared `verified_references` from 24.3a), closing authority, idempotent key with authority rechecked on replay.
- [x] `migrations/0021_assessment_exceptions.sql`, `infrastructure/src/assessment/exception.rs`, `schema-v21.catalog`, `lib.rs` (inventory, ACLs), `published.rs`, `tests/bootstrap.rs` — four tables, the writer trigger on evaluations/revisions/opportunities/dispositions, statement guards, the disposition guard (session, assignment, closing authority, status, lock, references), the effective-summary recount guard, immutability, RLS, backfill.
- [x] `worker/tests/exception.rs` — synthetic-model end to end through the real worker, PostgreSQL and API (see AC evidence below), DB guard forgeries, a held-lock race and the backfill re-run; records `web/tests/fixtures/task-exceptions.json`.
- [x] `api/src/exceptions.rs` + `openapi.json` + generated client — list, detail and disposition routes; unit tests for vocabulary and refusal statuses.
- [x] `web/src/exceptions.ts`, `Exceptions.tsx`, `TaskWorkPanel.tsx` (+ `tests/exceptions.test.mjs`, `tests/browser/exceptions.spec.ts` with keyboard path and contrast); schema 21 in health, smoke and the browser runtime; the browser fixture reset deletes the four new tables.
- [x] `zobba/README.md` — what is proven offline. No `generate.py` change was needed.

Deviations (documented, each with tests):
- Exception identity is (Task, criterion lineage root, subject): 24.1 evaluations record no subject unit (as for 24.3a chains).
- An effective summary supersedes the newest effective summary of the same population **and sample**, not of the population lineage.
- Population and criterion lineage walks are bounded at 64 versions (the 24.3a bound).
- A judgment's population opportunity that is not met is also an occurrence (it is a not_met result naming the judgment), so a judged subject's exception typically holds two occurrences.
- AC3's literal numbers are reached with an analogous AP-invoices scenario (rule `history` over the population and judgment `segregation`), because a rule-only fixture cannot exercise a person's replaced verdict. Its exact numbers are asserted below.
- Rule-opportunity resolution by a newer population version is proven by the domain and SQL status rules; the worker proof resolves exceptions through judgment revisions.

AC evidence (`worker/tests/exception.rs`, real worker and API):
- After the judgments and population: 6 exceptions (5 subjects) from 11 occurrences; late approver evidence revises INV-0042 and INV-0055 to met (`inputs_changed`) → resolved_by_evidence; others open. First effective summary: exceptions_found_inconclusive; failing 3, meets 2, unresolved 4, failing opportunities 4; exceptions 4 open · 2 resolved; limitations unresolved (4), unreviewed model proposals (5); in scope 9.
- A person's `replaced` met on 000123 → replaced_by_human_judgment; INV-0051 closed (accountable person, verified reference), reopened (Audit manager), closed again; refusals: no evidence 400, another Auditor 403 `exception_close_forbidden`, Admin alone 403, reopen of an open exception 409, unverified reference 409 with index, key conflict 409, closed twice 409, revoked replay 403; occurrences unchanged by every disposition.
- A reconsideration request on INV-0054 wakes the Task; the second effective summary supersedes the first: failing 2 (a closure never drops INV-0051's failure), meets 3, unresolved 4, failing opportunities 3; human replaced 1, pending 1, undisposed 3; exceptions 2 open · 2 resolved · 1 replaced · 1 closed over 5 subjects; limitations unresolved (4), pending reconsideration (1), unreviewed model proposals (3). A third, unchanged request records nothing.
- DB: owner/admin/reset UPDATE and DELETE/TRUNCATE refusals on all four tables, runtime DELETE denied, RLS by engagement; forged exception (wrong ID, no not_met result) refused in a two-row insert with exactly one bad row (the good row alone accepted); forged occurrences refused; runtime forged exception refused; a disposition without the person's session refused; closing a closed exception refused; two concurrent closes serialise on the exception lock and the second is refused; forged effective summaries (an exception moved between statuses; a failing count dropped) refused by the recount; the backfill block reproduces every exception and occurrence.

## 24.3b review round 1

Reports: `review-24-3b-blind-hunter.md` (BH), `review-24-3b-edge-case-hunter.md` (ECH), `review-24-3b-verification-gap.md` (VG). Migration 0021 / catalogue v21 were amended (unreleased); 0001–0020 and v1–v20 are unchanged.

| Finding | Outcome |
|---|---|
| BH H1, ECH M6 — status derived per exception, cost grows with Task size | **Fixed.** Set-based SQL statuses (`assessment_exception_statuses`) and observations; Rust re-derives only the listed page and compares; indexes on evaluation subject and lineage `supersedes`. Scale proof at 20,000 rows / 19,000 exceptions (see evidence). Root causes found under scale: JIT on RLS-inflated plans (`jit=off` on runtime connections), per-row nested loops planned from statistics-free new rows (hash plans in guards and status functions; set-based checks), and the lease renewal waiting behind the cycle's own write locks (row-only renewal). |
| BH M1 — a disposition's time used as the observation's time | **Fixed.** A chain head is observed at its own record time; only a person's `replaced` verdict takes the disposition's time. |
| BH M2 — only the single latest observation read | **Fixed.** Any current not_met observation keeps the exception open. |
| BH M3 — an unreviewed model proposal resolves | **Fixed (owner decision 2026-10-21).** `proposed_met`, open. |
| BH M4, ECH M2 — summary counts/lists Task-wide exceptions | **Fixed.** Only the summary's own subjects (in scope, or the sample's selected items) and basis lineages; the guard recounts the same. |
| BH M5 — unbounded exceptions, reads refuse past a limit | **Fixed.** Write-time cap of 20,000 per Task (recorded feedback); reads are exact and paged. |
| BH L1, ECH L5 — 16 dispositions per exception, permanently | **Deferred.** The bound is the storage bound for an exception's history; the refusal is explicit (`exception_disposition_capacity`). Raising it is a product decision. |
| BH L2 — replay without closing-authority recheck | **Fixed.** Replays recheck `may_close` in the write transaction; a 23505 race is answered through the authority-checked read. |
| BH L3, ECH L7 — inner 24.2 limitations not recounted | **Fixed.** `effective_guard` derives the inner coverage limitations from its counts. |
| BH L4, ECH L4 — population lineage unbounded / forks | **Fixed.** `population_succession`: one successor, ≤64 earlier versions (new versions only). |
| BH L5 — criterion root wrong past 64 versions | **Fixed.** The root walk reaches the true root. |
| ECH H1 — a newer "not evaluated" judgment opportunity hides the chain head | **Fixed.** Judgment opportunities are not observations (their chain head is). |
| ECH H2, ECH M7 — >200 exceptions: wrong counts, unreachable rows | **Fixed.** Exact counts by status over all exceptions; 50 per page with `next_cursor`; web pages. |
| ECH M1 — `no_exception_found` with open exceptions | **Fixed.** Effective conclusion capped at `inconclusive`; `open_exceptions` limitation. |
| ECH M3 — a closure absorbs a concurrent not_met | **Fixed.** Occurrences and dispositions take the Task exception lock and a `seq`; a closure stands only over evidence it saw. |
| ECH M4 — old judgment over a new population adds an occurrence | **Fixed.** Judgment opportunities add none; worker proof (`invoices-v2`). |
| ECH M5 — `replaced undetermined` counts as replaced | **Fixed (owner decision 2026-10-21).** `person_undetermined`, open. |
| ECH L1 — exception outline lines can be dropped | **Partly.** A Task-wide counts line and an explicit "could not be read" line were added; the outline's tier order is the 22.6 rule and is unchanged. |
| ECH L2 — a rule exception cannot resolve after its criterion is revised | **Deferred (by design).** A revised criterion is a different test; resolution needs a later read of the same version or a revision caused by changed inputs or a revised basis. |
| ECH L3 — words after a reconsideration-only `met` | **Deferred.** It stays open ("not observed…"), which is true but not specific; a distinct sentence is a wording change for review. |
| ECH L6 — occurrence paging by OFFSET over clock order | **Fixed.** Paged by `seq` cursor. |
| ECH L8 — "at least" on exact counts | **Deferred.** Wording only; the counts are exact. |
| ECH L9 — transient resolved → open while v2 is unevaluated | **Deferred (by design).** The status follows the latest population version; until it is evaluated its rule result is not observed. |
| ECH L10 — `accepted` after a `replaced not_met` | **Deferred.** Needs a 24.3a disposition-order rule; out of 24.3b's scope. |
| VG H1 — no test of revision / person's replaced not_met occurrences | **Fixed.** Worker proof asserts `revision` (model proposal) and `disposition` (human) occurrences; the backfill re-run compares all four kinds and their order. |
| VG H2 — effective summary forged for 2 fields | **Fixed.** Table of forgeries (exceptions, subjects, totals, failing, unresolved, failing opportunities, each review count, conclusion, listed status, supersedes) plus a dropped limitation and seven removed keys, after a positive control. |
| VG H3 — absent and rule-opportunity resolution untested in PostgreSQL | **Partly.** The Rust/SQL decision parity table covers the opportunity and absent kinds; a worker scenario whose population version drops a subject is not built. |
| VG M1 — disposition guard branches unreachable | **Fixed.** Direct inserts: non-closing Auditor, expired manager membership, foreign exception, reopen of an open one, wrong digest, closure without references, the 17th disposition; positive controls for manager and accountable person. |
| VG M2 — occurrence forgery covers 2 columns | **Fixed.** Origin, evidence, actor, exception, source kind, source ID, a met source, criterion, basis, a judgment's opportunity, time; ordering before a disposition. |
| VG M3 — backfill not tested as an upgrade | **Deferred.** Seeding populated v20 assessment data in `bootstrap.rs` is its own fixture; the backfill is compared on live data of all four kinds. |
| VG M4 — derived reopening untested in PostgreSQL | **Fixed.** INV-0051 closed, then reopened by a judgment over unseen evidence; INV-0054's closure stands over the same evidence. |
| VG M5 — Rust/SQL parity on one example per status | **Fixed.** `decide_parity`: 13,826 cases (every kind, verdict, execution, origin, review, cause, time, evidence, criterion, closure). |
| VG M6 — replay recheck asserts a bare 403 | **Fixed.** Codes asserted; demoted Audit manager replay → 403 `exception_close_forbidden`. |
| VG M7 — API viewer scoping untested | **Fixed.** Admin alone 403, another engagement 403, unknown exception 404, bad cursors 400. |
| VG M8, item B — coverage cycle ends with no recorded step | **Fixed.** Every silent stop records a closed `Halt`; the worker counts halts and authority outcomes; the authority poll tolerates an unknown answer for one lease lifetime; the lease renewal no longer waits behind the cycle's own locks. |
| VG L1 — race waiter not correlated | **Fixed.** By backend pid. |
| VG L2 — unscoped check cannot fail | **Fixed.** A complete VALUES insert without scope must be refused. |
| VG L3 — parser cases share one error | **Deferred.** Each case changes one field of a valid fixture; distinct error texts would widen the client's error surface. |
| VG L4 — browser POST answered by the harness | **Accepted** (named in the spec; server behaviour is the worker proof). |
| VG L5 — forged-exception disjuncts share a message | **Deferred.** Covered by the key and first-source forgeries; separate messages add no protection. |
| VG L6 — no forged `supersedes` | **Fixed.** NULL `supersedes` while one exists is refused. |
| VG L7 — `refused()` maps by substring | **Deferred.** The guard messages are fixed constants of this migration; a mapping test is a follow-up. |
| VG L8 — closure test confounded | **Deferred.** The second summary follows several changes; the per-exception closure assertions are direct. |

Evidence (round 1, `worker/tests/exception.rs`): after the judgments and population, 6 exceptions over 5 subjects; INV-0042 resolved only once a person accepted its met proposal; INV-0055's unreviewed met proposal kept open (`proposed_met`), then a person's `replaced undetermined` kept it open (`person_undetermined`), then `replaced not_met` added a human occurrence; first effective summary failing 3 · meets 2 · unresolved 4 · failing opportunities 4, exceptions 6 open, limitations unresolved (4), unreviewed (5), open exceptions (6). After the reconsideration turn: INV-0051's closure reopened by a revision reading unseen evidence; INV-0054's closure stands over a revision reading the same evidence; `invoices-v2` with the judgment criterion adds no occurrence (9 occurrences in all); second effective summary failing 3 · meets 2 · unresolved 4, human replaced 2, undisposed 2, exceptions 3 open · 1 resolved · 1 replaced · 1 closed over 5 subjects, conclusion `exceptions_found_inconclusive`. Scale: a 20,000-invoice population (19,000 not in the history) records 19,000 exceptions and its effective summary (failing 19,000, unresolved 1,000); the list reads in 1.7 s, the detail in 0.2 s, the turn in about 75 s.

Verification (round 1, sequential, one disposable `_test` database, after the last code change):
- `cargo fmt --check` clean; `cargo clippy --workspace --all-targets --locked -- -D warnings` clean.
- `cargo test --workspace --locked --no-fail-fast -- --test-threads=1` (line-table debug info to fit the disk): 773 passed, 2 failed — the infrastructure unit test `an_observation_is_read_exactly_or_not_at_all` (its JSON lacked the new review state) and the scale proof's list bound (3.3 s against a 3 s assertion under the full suite). Both fixed; reruns: infrastructure `assessment::exception` 2/2, `--test exception` 3/3.
- `cargo test -p zobba-worker --test coverage` ten times in a row: **10/10 passed**.
- `pnpm --dir web check`: 232 tests, 230 pass, 2 fail (the known IPv6 loopback cases); `pnpm --dir web build`: ok.
- Browser: `exceptions.spec.ts` 4/4; `assessment`, `coverage`, `investigation`, `revision` specs 11/11.
- `python3 scripts/smoke.py`: passed (schema 21).

## Suggested Review Order (24.3b)

1. `zobba/migrations/0021_assessment_exceptions.sql`:
   - helpers (`assessment_criterion_root` to the true root, `assessment_task_criterion_roots`, `assessment_task_population_roots`, `assessment_exception_key`, `assessment_evidence`), the three new indexes and `population_succession`;
   - `assessment_exception_observations` (chain heads at their own time; decided rule opportunities of latest versions; absent), `assessment_exception_decide` (the pure rule), `assessment_exception_statuses` (set-based, by `seq`), `assessment_effective_outcomes`;
   - the backfill block (with `seq`), `exception_record` (Task lock, jsonb staging, cap, aggregated places) and `exception_batch` (key check; first-source and expected-occurrence checks for direct inserts; aggregated ordering check);
   - `exception_guard` (session, assignment, closing authority, Task lock, status, references, `seq`) and `effective_guard` (outcomes read once; domain-scoped exceptions; inner 24.2 limitations derived; conclusion cap; outer limitations);
   - planner settings (`enable_nestloop=off` on the statement guards and status functions; `coverage_batch` too), immutability, RLS and grants.
2. `zobba/crates/domain/src/exception.rs`: `exception_status`, `closure_stands`, `would_resolve`/`resolves`, `latest_observation`, `status_words`, `summarise_effective` (own subjects, `effective_conclusion`, `open_exceptions`), `EffectiveSummary::is_consistent` (+ `exception/tests.rs`).
3. `zobba/crates/infrastructure/src/assessment/exception.rs`: `FACTS` + `entry_of` (Rust status re-derived and compared), `status_counts`, `exception_snapshot` (savepoint; unavailable said, never a failed turn), `record_effective`, `may_close`, the paged viewer; `assessment.rs` `refusal` (capacity) and `record_opportunities` (batches, bounded statement limit); `task.rs` `current` (row-only lease renewal); `lib.rs` (`jit=off`, inventory).
4. `zobba/crates/application/src/assessment/exception.rs`, `coverage.rs` (capacity feedback); `work.rs` (`CycleEnd::Unavailable(Halt)`); `worker/src/executor.rs` and `diagnostics.rs` (authority poll tolerance, halt counters).
5. `zobba/crates/api/src/exceptions.rs`: paged list, 404/400 refusals, `conclusion`, occurrence `seq`.
6. `zobba/crates/worker/tests/exception.rs`: the end-to-end proof (reopening, closure standing, new population version, scale), `database_guards_refuse_altered_exception_records`, `decide_parity`.
7. Web: `zobba/web/src/exceptions.ts`, `Exceptions.tsx`; `tests/exceptions.test.mjs`, `tests/browser/exceptions.spec.ts`.

Verification (24.3b, sequential, one database):
- `cargo fmt --check` clean; `cargo clippy --workspace --all-targets --locked -- -D warnings` clean.
- `cargo test --workspace --locked --no-fail-fast -- --test-threads=1`: 765 passed, 3 failed. All three were the 24.1/24.2/24.3a worker proofs, whose loopback answers lacked the new `summarise_effective` key (the strict structured-output schema requires every key, as with `carry_facts`), so turn 1 failed. Fixed in the fixtures; reruns: `--test assessment` 3/3, `--test revision` 3/3, `--test coverage` 3/3 (the coverage proof also stopped mid-cycle once after the fix, with no recorded failure step; four later instrumented runs and the full file passed, and the cause was not found — named, not claimed fixed).
- `--test exception` 3/3 (the new proof). `pnpm --dir web check`: 231 tests, 229 pass, 2 fail (the known IPv6 loopback cases). `pnpm --dir web build`: ok. Browser: `exceptions.spec.ts` 4/4; `revision`, `coverage`, `assessment`, `investigation` specs 11/11. `python3 scripts/smoke.py`: passed (schema 21).
