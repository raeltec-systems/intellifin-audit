# Review 24.1 — Verification gap

Reviewer lens: verification gap. Commit `54564e1` on `codex/zobba-foundation-batch`, against
`spec-24-1-bind-typed-criteria-and-facts-to-an-assessment-basis.md`.

Method: for each acceptance criterion, boundary rule and matrix row, I found the code that
enforces it and the test that should fail if that code were removed or changed. I did the
mutation checks by reading the code. I did not change any tracked file.

Totals: **2 High, 9 Medium, 8 Low.**

## What is well covered

- Matrix rows **rule met, value mismatch, missing input, unavailable source, analysis failed,
  observed exception, currency mismatch, leading zeros/date/zone, not applicable, unverified
  authority** are asserted as exact rows in `crates/worker/tests/assessment.rs:900-1040`. The test
  also checks that the run has exactly one `not_met`.
- `evaluate` check order (failed analysis before applicability): reordering it changes the
  INV-0053 tuple `("unknown","failed",…)`, so the worker test catches it.
- Determinism on a second run: `after_answer` prints "re-evaluating gives the same output digest"
  only when the stored digest equals the new one. Both the application test (`tests.rs:780-800`)
  and the worker test (`bodies[2]`) check for that text. A digest that changes between runs fails
  both tests.
- A model cannot write a rule verdict. The application refuses a judgment on a rule criterion
  (application test), and the database refuses `model_proposal` on a rule criterion (forged insert,
  message checked).
- The database refuses a decided verdict on an unsupported fact (forged insert, message checked).
- DELETE and TRUNCATE are refused on all six tables, with the message checked. The DELETE exception
  under `zobba.disposable_fixture_reset` in a `*_test` database is shown in a transaction that is
  then rolled back.
- The failed side of the "completed, not collected" job fix is covered. If either the database
  guard or the `job_state` query goes back to `collected`, the INV-0053 approver fact becomes
  supported. The insert is then refused, or approval·INV-0053 becomes `met`, and the test fails.
  (This relies on one precondition the test does not assert; see M1.)
- The reclaim fix (`Ok(progress || recorded_before)`, `application/src/assessment.rs:1716`) is
  caught: the application test checks that a repeated `after_answer` for the same invocation
  returns `true`.

---

## High

### H1 — No test records a fact from an analysis job that completed. The NULL-comparison guard fix and the positive side of the "completed, not collected" fix are not tested.

- **Rule:** a fact that names a 22.4 job is `analysis_failed` exactly when that job did not
  complete. A supported fact from a job that completed must be accepted.
- **Enforced at:**
  - `zobba/migrations/0018_assessment_basis.sql:259-260`:
    `(NEW.support_reason IS NOT DISTINCT FROM 'analysis_failed') = NOT EXISTS(… status='completed')`.
  - `zobba/crates/infrastructure/src/assessment.rs:312-321`: the `job_state` query, `status='completed'`.
  - `zobba/crates/application/src/assessment.rs:1451-1455`.
- **Why the tests cannot catch a regression:**
  - The worker test has one program, `raise SystemExit(3)`, so its only job fails.
  - The application test inserts only `JobState::Failed` (`assessment/tests.rs:455`).
  - Revert the guard to `NEW.support_reason = 'analysis_failed'`. For a supported fact
    `support_reason` is NULL, so the comparison gives NULL and the `EXISTS` sub-query matches no
    row. The guard then refuses **every supported fact that names a completed job**. That is the
    bug the fix removed, and every test still passes.
  - A typo in the infrastructure status (for example `'complete'`) makes every job `Failed`. Every
    job-derived fact then becomes `analysis_failed`, which is an execution failure, and no test
    notices.
  - No test checks the guard's same-Task branch (`j.task_id = NEW.task_id`), or the application's
    handling of another Task's job (`unknown_job` → `source_unverified`, job ID dropped).
- **Tests to add:**
  1. Worker test: a second program that succeeds, then a fact with that `job_id` and a verified
     quote. Assert `support='supported'`, `support_reason IS NULL`, the `job_id` column is kept,
     and an evaluation that reads the fact is `met`.
  2. Forged inserts as admin (check the messages):
     - a supported fact that names the failed job: refused;
     - `support_reason='analysis_failed'` on the completed job: refused;
     - a fact that names another Task's job: refused.
  3. Application test: `JobState::Collected` gives `Supported`, and an unknown job gives
     `Unsupported(SourceUnverified)` with `job_id` set to `None`.

### H2 — No test has a fact source whose quote is not at its locator. The "verified source" rule for facts is not tested at either layer.

- **Rule:** a fact is `supported` only when every one of its sources is verified at its exact
  location. "The model cannot assert a number the source does not show."
- **Enforced at:**
  - `zobba/crates/application/src/assessment.rs:1458-1463` (`any(|s| s.verification != Verified)`
    → `SourceUnverified`).
  - Deferred trigger `zobba/migrations/0018_assessment_basis.sql:315-317` ("all verified when
    supported").
- **Why the tests cannot catch a regression:**
  - Every fact source in the worker test and in the application test sits at its real cell. The
    worker test also asserts only `verified sources >= 12`, not the exact count.
  - Delete the application check. A quote that parses under its rule (for example `"1,250.00"`
    cited at a cell that holds something else) then becomes `supported`. Only the deferred trigger
    would refuse it, and no negative test exercises that trigger either.
  - The authority path does have a not-at-location case (the `unverified` criterion). The fact
    path has none.
- **Tests to add:**
  1. Worker test: a fact quoting `"1,250.00"` at a cell that does not hold it. Assert
     `support='unsupported'`, `support_reason='source_unverified'`,
     `assessment_fact_sources.verification='unverified'` with `reason='not_found_at_location'`,
     and an evaluation that reads it gives `undetermined fact_unsupported`.
  2. Forged insert in one transaction: a `supported` fact whose source row is `unverified`. Assert
     that COMMIT is refused with "all verified when supported".
  3. Application test: a reader that reports one source unverified → `SourceUnverified`.

---

## Medium

### M1 — The "completed, not collected" test depends on a precondition it never asserts

- **Rule:** a failed job is also `collected`, so a `collected` event alone is not success.
- **Enforced at:** `0018:256-260`; `infrastructure/src/assessment.rs:312-314`.
- **Gap:** the test catches a `collected` regression only if the failed job already had a
  `collected` event when turn 2 recorded the fact. The test never asserts that. If the job were
  still `failed` or running at that moment, `NOT EXISTS completed` would hold under either
  definition, and the test would pass against the old, wrong guard.
- **Test to add:** at the start of turn 2 in the responder, assert that the job's
  `analysis_job_events` statuses include `collected` and do not include `completed`.

### M2 — The UPDATE immutability assertions mostly cannot fail for the reason they exist; the reset exception and the owner role are not tested

- **Rule:** UPDATE, DELETE and TRUNCATE are refused, even for the owner. The only exception is
  DELETE (and TRUNCATE) under `zobba.disposable_fixture_reset=on` in a `*_test` database. UPDATE
  is refused even then.
- **Enforced at:** `0018:327-355` (`assessment_immutable`, `assessment_retained`).
- **Why the tests cannot catch a regression** (`worker/tests/assessment.rs:1205-1215`):
  - Five of the six UPDATE statements break a CHECK constraint even with no trigger, and only
    `is_err()` is asserted:
    - the evaluation `verdict='met'` update hits the `not_applicable` rows;
    - the fact `support='supported'` update hits the unavailable rows;
    - the criterion `authority_verified` update makes it disagree with its document;
    - the basis `period_to` update makes it disagree with its document;
    - the source `verified` update leaves a NULL digest.
  - Only `assessment_basis_criteria SET ordinal=ordinal` really needs the trigger.
  - So a trigger that let through UPDATEs that agree with the document (for example
    `SET created_us=0`, or a consistent rewrite of a document and its key column) would pass.
  - Not tested:
    - UPDATE refused while reset is `on`;
    - TRUNCATE allowed under reset;
    - the `LIKE '%\_test'` escape (an unescaped `_` would also accept `xtest`).
  - All statements run as the superuser admin, never as the migration owner.
- **Tests to add:**
  - For each table, an UPDATE that agrees with the document (`SET created_us=created_us`, or
    `actor_id=actor_id`), asserting the message "assessment records are immutable".
  - The same UPDATE inside `SET LOCAL zobba.disposable_fixture_reset='on'`, still refused.
  - TRUNCATE under reset, in a transaction that is rolled back, succeeds.
  - Repeat the UPDATE/TRUNCATE refusals on the migration-owner connection.

### M3 — Many insert-guard branches and claim custody have no negative test; the guard test's doc comment claims more than it checks

- **Rule:** the insert guard checks:
  - claim custody;
  - the answer invocation, its binding and its epoch;
  - that references stay in the same Task;
  - an unverified authority never gives `met`/`not_met`;
  - a decided verdict reads at least one fact;
  - a basis pins exactly the criteria it lists.
- **Enforced at:**
  - `0018:231-236` (invocation, binding, epoch);
  - `0018:239-251` (supersedes and `basis_criteria` order/Task);
  - `0018:253-255` (fact basis Task);
  - `0018:264-273` (source matches its document);
  - `0018:283-285` (unverified authority);
  - `0018:293-295` (zero inputs);
  - `0018:311-313` (deferred basis count);
  - `infrastructure/src/assessment.rs:66-77` (`claimed`: lock, producer, admission fence).
- **Gap:** `database_guards_refuse_altered_assessment_records` says the records are "bound to
  their own invocation's binding", but it forges only two things: an unsupported input and an
  origin that does not match the criterion kind. Deleting any of the branches listed above leaves
  every test green.
  - Note: the unverified authority branch (283) can only be reached by a forged row. The domain
    `evaluate` never produces such a row, so only a database test can protect it.
  - No test runs a write under a fenced or replaced claim producer.
- **Tests to add:** forged inserts with message checks for each branch:
  - wrong `methodology_binding_id`, wrong epoch, another Task's invocation;
  - `met` on the `unverified` criterion;
  - `not_met` with `inputs=[]`;
  - a basis-criterion row out of order or from another Task;
  - a basis whose document lists N criteria with N-1 pinned, refused at COMMIT;
  - a fact source that differs from its document.
  Also a repository test: after the claim producer is fenced, `record_fact` returns
  `Fenced`/`Denied` and writes nothing.

### M4 — No test exercises schema-v17 any more, and nothing tests the upgrade from v17 to v18

- **Rule:** migrations 0001–0017 and catalogues v1–v17 do not change. Migration 0018 is additive.
- **Enforced at:** `infrastructure/src/lib.rs:1544-1580` (catalogue chain); git history.
- **Gap:**
  - This commit moved every `check().await.unwrap().0, 17` to `18`. So `schema-v17.catalog` is now
    checked by no test: an edit to it, or a v17 database that no longer matches it, goes unseen.
  - The prefix upgrade tests stop at schema 7–10 (`bootstrap.rs:1244`, `2199`, `2371`).
  - Nothing installs the exact published 0001–0017, with their SQLx ledger and a populated Task or
    citation, and then upgrades to 18 while checking the ledger rows and existing data are
    unchanged.
  - The bytes of the published migrations are not pinned anywhere except in git.
- **Test to add:** an `assessment_upgrade_contract`:
  1. Install `migrator.iter().take(17)` with their checksums.
  2. Assert the runtime reports 17 against `schema-v17.catalog`.
  3. Seed a Task with an invocation.
  4. Migrate, and assert: version 18, ledger rows 1–17 byte-identical, seeded rows unchanged.
  5. Run the same corruption refusals (`checksum`, `catalog`) as `upgrade_contract`.

### M5 — No test makes trusted verification fail, so an outage could be recorded as a permanent "unverified"

- **Rule:** authority and fact quotes are verified before a record is made. A transient read
  failure is not proof, and must not leave a permanent `unverified` or `unsupported` record.
- **Enforced at:**
  - `application/src/assessment.rs:1081-1105` (`verify_sources`, which propagates `Err`);
  - `assessment.rs:1240-1247` (authority);
  - `assessment.rs:1440-1444` (facts are verified as a batch before any fact is written).
- **Gap:**
  - The application test's `Reader` (`assessment/tests.rs:20-110`) never returns `Err`.
  - Unavailable, Capacity and cancellation are never injected.
  - No test checks that a reader failure writes no fact, or that criteria written earlier in the
    same answer are later continued, not repeated, on reclaim.
- **Test to add:** a reader that fails after N reads. Assert:
  - `after_answer` returns `Err(Unavailable)`;
  - no fact record exists;
  - there is no criterion with `source_unreadable` caused by the outage;
  - a repeated `after_answer` with a healthy reader completes the answer without duplicates.

### M6 — Several web parser cases cannot fail for the rule they test, and some invariants are untested or missing

- **Rule:** the panel parses the API response strictly, under the same structural rules as the
  database. There is no confidence score.
- **Enforced at:**
  - `web/src/assessment.ts:205-209` (evaluation rules), `170-177` (fact pairings),
    `100-104` (criterion pairings);
  - `web/src/work.ts` (unavailable XOR assessment).
- **Gaps** (in `web/tests/assessment.test.mjs` and `work.test.mjs`):
  - `{ confidence: 0.9, verdict: 'probably' }` is refused only because of `'probably'`. `record()`
    ignores unknown keys, so a `confidence` field is silently dropped. Nothing proves the parser
    refuses it.
  - `{ execution: 'failed' }` with `verdict: 'met'` breaks both the "decided" rule and the
    "failed" rule. Remove either rule and the case still throws. Failed with `verdict: null` and
    `reason: 'missing_fact'` is not tested.
  - `{ assessment_unavailable: true, assessment: { bases: [] } }` throws inside
    `parseAssessment`. The mutual-exclusion guard in `work.ts` can be deleted and the case still
    throws.
  - These pairing rules are untested:
    - decimal ⇔ mantissa, scale and measure;
    - instant ⇔ `utc` and offset;
    - unavailable ⇔ reason;
    - ambiguous ⇔ candidates;
    - method ⇔ `requirement_id`;
    - original ⇔ `authority_source`;
    - judgment ⇔ rubric.
  - The database rule `0018:201` ("deterministic `undetermined` needs a reason") is not in the
    parser at all.
- **Tests to add:** one single-defect case per rule. Use a valid assessment for the unavailable
  case. Decide whether unknown keys (for example `confidence`) must be refused, then test that
  choice. Add the `undetermined`-reason rule to the parser and test it.

### M7 — Answer bounds and discard counting are mostly untested

- **Rule:**
  - limits per answer: `propose_criteria` ≤ 8, `propose_basis` ≤ 1, `record_facts` ≤ 64,
    `evaluate` ≤ 16, `judgments` ≤ 8;
  - invalid, repeated or over-bound entries are dropped and counted in `discarded`.
- **Enforced at:** `domain/src/citation.rs` (`entries`, `out.len() < max`, repeated-key `retain`);
  `domain/src/assessment.rs` (`MAX_*`, `answer_fields()`).
- **Gap:**
  - `the_answer_fields_stay_within_the_schema_bounds` asserts only `schema.is_valid()`, not the
    limit values themselves.
  - Only `evaluate` (a duplicate and an invalid ID) is checked for discards.
  - If `MAX_PROPOSED_CRITERIA` grows past 8, the tests do not notice, and the database CHECK
    `ordinal BETWEEN 0 AND 7` then refuses the 9th criterion at runtime.
  - The same coupling exists between `MAX_RECORDED_FACTS` and `ordinal ≤ 63`, and between
    `MAX_INVOCATION_EVALUATIONS` (1032) and `ordinal ≤ 1031`. Neither is tested.
- **Test to add:**
  - Decode 9 criteria, 2 bases, 65 facts, 17 evaluate IDs, 9 judgments and one repeated criterion
    key. Assert the lengths are 8/1/64/16/8 and assert the exact `discarded` count.
  - Assert the schema's `maxItems` for each field.
  - Assert each `MAX_*` constant against the matching migration CHECK bound.

### M8 — No automated WCAG check for the new panel

- **Rule:** the panel meets WCAG 2.2 AA (the spec's Verification asks for "accessibility checks").
- **Enforced at:** `web/src/AssessmentBasis.tsx`; `styles.css:706-710`.
- **Gap:**
  - `web/tests/browser/assessment.spec.ts` checks the region and heading names, the dt/dd text and
    one keyboard citation chip. There is no axe-style scan and no contrast measurement, although
    `evidence-search.spec.ts:387-398` measures contrast.
  - `.authority-unverified` and `.fact-unsupported` change only the colour (`--tertiary`).
  - Truncated IDs use `<abbr title>`, which a keyboard user cannot reach.
  - Nothing checks that the "exception" verdict is distinct by more than weight.
- **Test to add:**
  - measure the contrast of `.authority-unverified`, `.fact-value`, `dt` and `.context-note`
    (≥ 4.5:1);
  - assert that unverified and unsupported states are said in words (already partly true);
  - keyboard-walk the panel and assert no focus trap;
  - assert that the full ID of a truncated digest/ID is available without hover, or that
    truncation is decorative only.

### M9 — Outline/feedback byte bounds and the subject/evaluation caps are not tested

- **Rule:** the tier-2 outline and feedback are bounded (`MAX_ASSESSMENT_OUTLINE_BYTES` 16 KiB,
  `MAX_ASSESSMENT_FEEDBACK_BYTES` 8 KiB, `MAX_OUTLINE_RECORDS` 64), so they alone cannot cause
  `context_budget`. Subjects per criterion (64) and evaluations per answer (1032) are capped, with
  feedback.
- **Enforced at:** `application/src/assessment.rs:54-64`, `1537-1544`, `1578-1583`, `1661-1663`,
  `1872…` (`outline`).
- **Gap:**
  - No test references these constants.
  - The judgment loop `break`s on the evaluation cap with no feedback (`1661`). No test notices
    that a judgment was silently dropped.
- **Test to add:**
  - a snapshot with more than 64 records and long assertions: assert the outline is ≤ 16 KiB,
    counts what it omits, and the feedback is ≤ 8 KiB;
  - a criterion with 65 subjects: assert 64 evaluations and the truncation sentence.

---

## Low

- **L1 — Old answers.** `assessment_fields_are_optional_bounded_and_counted_when_invalid` checks
  that a 22.6 answer decodes, and that `investigation_schema()` refuses the new fields. No test
  pins the bytes (a digest) of `schema()` or `investigation_schema()`, or the request bytes of a
  composition without assessment. "Stored older answers parse with unchanged bytes and bindings"
  therefore rests on strictness, not on a fixed vector. Add a digest assertion for both schemas,
  and one recorded 22.6 answer fixture that is parsed and re-bound.
- **L2 — Reclaim test.** The first pass records all four record kinds. Dropping any single term of
  `recorded_before` (`assessment.rs:1712-1716`) still gives `true`. Also, only the evaluations
  are compared after the reclaim. Add a reclaim case where only facts were recorded, and compare
  the full store state.
- **L3 — Domain names that over-promise.**
  - `judgments_are_proposals_with_words_and_no_confidence` asserts nothing about confidence.
  - The digest determinism checks compare one in-memory computation with another, with no golden
    vector. A change to the canonical form would silently change the digests of new records
    against stored ones. Add a fixed expected digest for one outcome.
- **L4 — Binding change.** The test proves that a record from an old turn keeps `binding-1` with
  `method_changed`. No test proves that records made after a 21.2 active change use the new
  binding and epoch. The worker test asserts the binding but never the epoch.
- **L5 — API scoping.** No test shows assessment facts or criteria to a viewer who cannot read
  the original. The quote, filename and version must be withheld, and the population shows
  "A source you cannot open". The API path to `assessment_unavailable` (a failed read) is also not
  tested; only the browser test covers it, with made-up JSON.
- **L6 — Recording paths not covered:**
  - recording an `ambiguous` fact through `after_answer` or the worker (only domain `evaluate`);
  - a 22.4 descendant source;
  - a population reference to an unregistered original (`sha256: null`);
  - a duplicate (basis, criterion, subject) evaluation refused by the UNIQUE constraint.
- **L7 — Judgment provider failure.** The matrix row's error handling ("provider failure
  recorded; nothing fabricated") has no assessment-specific test.
- **L8 — Period rule only tested in the domain.** The rule "the period test uses the civil date,
  never the acquisition time" is tested only in the domain. The worker never evaluates
  `within_period` on a recorded instant fact.

## Summary

| Severity | Count |
|---|---|
| High | 2 |
| Medium | 9 |
| Low | 8 |
