# Review — Story 24.3a verification gaps

Lens: verification gap. Scope: `git diff 437c737 cc64fa9 -- zobba` against the
24.3a parts of `spec-24-3-revise-evaluations-without-overwriting-facts-or-exceptions.md`.
Method: for every 24.3a acceptance criterion, boundary rule, matrix row and
migration-0020 guard, find the test that fails when the rule is broken. Read-only:
no code was changed and no test was run (mutations were reasoned from the code).
Every guard message in `0020_assessment_revisions.sql` was grepped across all
test trees (`crates/*/tests`, `crates/*/src/**/tests.rs`, `web/tests`).

Counts: **High 4 · Medium 10 · Low 7**.

What is well covered (no action): domain `causes`/`changes`/`effective`/
`DispositionRequest::check` (one test per cause and per kind); same-output rerun
records nothing (application + worker); late evidence same basis; corrected fact
via successor + `carry_facts` (application + worker, positive path); Rust
"unseen reconsideration is not answered" (`turn-2b` in
`a_reconsideration_request_is_the_only_cause_for_an_unchanged_judgment`);
disposition idempotent retry and conflicting retry; `not_replaceable`,
`revision_superseded` naming the head, `reference_unverified` naming index 1,
revoked assignment 403, Admin-only 403 (worker, real API); UPDATE/DELETE/TRUNCATE
refused for the admin connection, UPDATE refused under the fixture reset; the
fork-by-copy and wrong-predecessor forgeries; one extra forged cause; deterministic
`replaced` and superseded-head disposition forgeries; published 0001–0019 and
v1–v19 hashes (checked: `published.rs` digests match the files, and
`git diff 437c737 cc64fa9` touches none of them).

---

## High

### H1 — The SQL "changes are exactly derived" guard has no forgery test
- **Rule:** `revision_guard`, `0020_assessment_revisions.sql:371-381`
  ("a revision names exactly the facts added, removed and replaced since its predecessor").
- **Why nothing catches a regression:** the message appears in no test. The worker
  test's doc comment (`worker/tests/revision.rs:1451-1455`) says the database
  "refuses … forged causes and changes", but `database_guards_refuse_altered_revision_records`
  never forges `changes`. The positive revisions (rev2 `added`, rev3 `replaced`)
  pass whether the check exists or not. Deleting lines 371-381, or computing
  `changes` from IDs instead of names, survives the whole suite. Rust derivation
  is tested only in `domain/src/revision/tests.rs`.
- **Test to add:** in the guard function, copy rev3 as a successor of the head
  with real derived causes but (a) `changes.replaced=[]`, (b) the old amount moved
  to `removed` and the new one to `added`, (c) an extra fact ID in `added`; assert
  each is refused with that exact message. Each forgery must keep causes correct
  so it breaks only the changes rule.

### H2 — "A revision reads its head's basis/criterion version or one that succeeds it" is untested in Rust and SQL; `criterion_revised` is never exercised above the domain
- **Rule:** `application/src/assessment/revision.rs:875-903` (`basis_descends`,
  `criterion_descends`) and `0020…sql:310-328` (SQL walkers).
- **Why nothing catches a regression:** neither feedback line ("…a later version.
  Evaluate under that basis or one that succeeds it.", "…reads criterion …, a later
  version.") nor either SQL message appears in any test. The test named
  `a_judgment_under_an_older_basis_than_the_head_is_not_a_revision`
  (`application/src/assessment/tests.rs`) sends `evaluate`, which picks the newest
  basis and returns "is unchanged" — it never reaches `basis_descends`, so its name
  claims a rule it does not exercise. No test proposes a successor criterion, so
  the Rust and SQL `criterion_revised` branches (`revision.rs` domain `causes`
  aside) have no positive or negative integration test. Replacing either descend
  check with `Ok(true)`, or deleting either SQL walker, re-roots history backward
  with the suite green.
- **Tests to add:** (1) application: head on b2, a `judgments` entry naming b1 →
  feedback "a later version", no revision; (2) application + worker: a criterion
  successor (`supersedes` the approval criterion) then `evaluate` → revision with
  cause `criterion_revised`; and a judgment naming the older criterion version →
  refused; (3) SQL: forge a successor of the head whose `basis_id` is the head's
  *predecessor* basis (and separately an unrelated criterion of the Task) → the two
  "or one that succeeds it" messages.

### H3 — No concurrency test exists for forks or for a disposition racing a new revision, though the spec task list (marked done) requires "fork refusal under concurrency"
- **Rules:** per-chain advisory lock `0020…sql:264` (revisions) and `:388`
  (dispositions); head check `:307`, `:393-396`; Rust refusal-to-feedback
  `write_revision` (`application/src/assessment/revision.rs:909-930`, "the chain
  changed meanwhile"); `record_disposition` re-reading the head after a
  "current head" refusal (`infrastructure/src/assessment/revision.rs:633-642`).
- **Why nothing catches a regression:** every forgery is sequential. The fork
  copy is refused because the head already exists, which the UNIQUE constraints
  would also refuse — it does not show the lock matters. The race that the lock
  actually protects is a disposition read as "head" in `revision_target` (outside
  the write transaction, `disposition.rs` `save_disposition`) while a revision
  commits; the DB-refusal mapping branch and its re-read are never executed (the
  e2e superseded case is caught by the Rust pre-check). The "chain changed
  meanwhile" feedback appears in no test, so making `write_revision` propagate the
  refusal as a failed cycle survives. Removing both `pg_advisory_xact_lock` calls
  survives.
- **Tests to add:** (1) PostgreSQL: two transactions insert revision n+1 of one
  head; hold the first open after its INSERT, observe the second blocked in
  `pg_stat_activity` on the advisory lock, commit, require exactly one row and the
  second refused (the CLAUDE.md "hold the real command's transaction" pattern);
  (2) same pattern: disposition on the head while a revision of that head is held
  uncommitted → after commit the disposition is refused and the API returns 409
  `revision_superseded` naming the *new* head; (3) application fake store whose
  `record_revision` returns `ReadingError::Invalid` → feedback line, cycle not failed.

### H4 — Seven of eight carried-fact guards, and every carried-fact 1,024 bound in SQL, are untested; the statement-level batch is proven for one rule only
- **Rules:** `revision_batch` `0020…sql:440-467` (carried fact is an effective fact
  of its from-basis; a basis that records a fact itself does not carry it; one per
  subject/name; count ≤ `carried`; own + carried ≤ 1,024), `revision_complete`
  `:475-489` (deferred: exactly every non-excepted effective fact), carry-from-
  superseded `:257-261`, the rewritten `assessment_guard` own+carried bound
  `:172-176`; Rust `carry_step` bound `application/src/assessment/revision.rs:1005-1010`.
- **Why nothing catches a regression:** only "an excepted fact is not carried" and
  "a carried fact belongs to its basis's carry" are asserted. The two-row batch
  forgery's bad row (the old amount) breaks **two** rules — excepted *and*
  "records it itself" (the successor records its own amount) — so the second rule
  has no test of its own. `revision_complete` is never triggered by a short carry,
  so deleting it survives (Rust always computes the full list). Removing the
  `+ (SELECT count(*) … carried_facts …)` term from `assessment_guard:173-174`, or
  the 1,024 test in `revision_batch`, survives: the only SQL 1,024 test is 24.1's
  own-fact test (`worker/tests/assessment.rs`). `the_fact_bound_counts_carried_facts`
  covers the Rust `record_fact` bound only; the `carry_step` bound feedback ("would
  be more than 1024") appears in no test.
- **Tests to add (each breaking one rule):** a carry whose INSERT holds one fact
  fewer than its effective set → deferred refusal at COMMIT; `carried` stated 2
  with 1 row; a two-row batch where row 2 is a fact the successor records itself
  but is *not* excepted; two rows with the same subject/name from a from-basis
  (craft via carried-of-carried); a successor holding 1,000 own facts plus a 25-fact
  carry (SQL refusal) and the matching Rust `carry_step` feedback; one own fact on a
  basis already holding 1,023 carried facts (rewritten `assessment_guard`); a carry
  whose `from_basis_id` is not the basis's `supersedes`.

---

## Medium

### M1 — Causes: only one cause is forged (an extra one); a missing cause and each cause separately are not
- **Rule:** `0020…sql:349-370`. The single forgery adds `criterion_revised` to an
  unchanged head. A mutation `IF NOT (NEW.causes <@ expected)` (allows omitting a
  derived cause) survives. No forgery omits `inputs_changed`, `basis_revised` or
  `reconsideration_requested`, and none states `prior_execution_failed` falsely.
  `prior_execution_failed` (matrix row "Failed then completed") has no application,
  worker or SQL test at all — only `domain/src/revision/tests.rs:76`; deleting the
  SQL line `:357` survives.
- **Add:** forge rev3 with each derived cause removed in turn, and with
  `prior_execution_failed` added; an application/worker case where revision 1 is
  `execution failed analysis_failed` and the job later completes.

### M2 — The SQL "reconsideration was shown to the model" check is untested
- **Rule:** `0020…sql:363-367` (`strpos(i.request::text, 'reconsideration requested of '||pred||' ')`).
- **Why:** the e2e request did show it, so dropping the `EXISTS(model_invocations …)`
  clause (counting any pending reconsideration) survives. The Rust half is tested
  (`turn-2b`), but the "replay on reclaim" path is not exercised end to end.
- **Add:** forge a successor whose `invocation_id` is an earlier invocation (request
  without the mark) with causes `['reconsideration_requested']` → refused with the
  causes message (the derived set is empty there). Optionally
  a worker reclaim test that replays the last answer after a reconsideration lands.

### M3 — "Wakes a waiting Task, but a paused or stopped Task stays so" is untested on the negative side
- **Rule:** `infrastructure/src/assessment/revision.rs:653-664`
  (`UPDATE … WHERE state='waiting' AND cessation='confirmed'`).
- **Why:** only the waiting→ready path runs (worker `settle(…, 5)`). Removing the
  `state='waiting' AND cessation='confirmed'` predicate survives.
- **Add:** pause (and separately stop) the Task, save `needs_reconsideration`,
  assert state/cessation and revision unchanged and no turn runs; `accepted` and
  `replaced` leave a waiting Task waiting.

### M4 — The 16-dispositions-per-revision cap is untested anywhere
- **Rule:** SQL `0020…sql:409-411`; Rust has no check, only the error mapping
  `infrastructure/src/assessment/revision.rs:643` → `disposition_capacity`.
- **Add:** 16 accepted dispositions (distinct keys) on one head succeed, the 17th
  returns 429/`disposition_capacity` (whatever the API maps) and writes nothing;
  an exact retry of an existing key at the cap still returns the original.

### M5 — Disposition authority: the SQL guard passes on a NULL scope GUC, Admin-with-assignment is never tested, and the in-transaction recheck is never the refusing branch
- **Rules:** `0020…sql:385-387` (`IF NOT knowledge_audit(...)`), `task::admission_fence`
  in `record_disposition` (`infrastructure/src/assessment/revision.rs:589-594`).
- **Why:** `knowledge_audit` (`0010_knowledge.sql:7-14`) begins
  `org=current_setting('zobba.organisation_id',true)`; on the admin test connection
  that GUC is unset, so the function returns NULL for an *assigned* actor and
  `IF NOT NULL` does not raise. The head and not-replaceable forgeries
  (`worker/tests/revision.rs` `forged_disposition(&id(1))`, `&id(2)`) pass the
  authority guard only through this NULL; making the guard `coalesce(...,false)`
  would break them, and they would not notice the guard being deleted. The
  "Admin alone" cases use `actor-admin`, which has **no** engagement assignment
  (`infrastructure/src/fixture.rs:87-88`), so they prove "unassigned refused", not
  "Admin role with an assignment refused". The revoked-assignment 403 comes from
  `revision_target`'s fence (outside the write), so deleting the in-transaction
  `admission_fence` (session, role, assignment recheck) survives; a disposition sent
  with another session's hash is not tested.
- **Add:** set the scope GUCs on the forging connection (or `coalesce` in the
  guard) and add a forgery by an assigned actor whose membership roles are
  `['admin']` only; an API case for an Admin with an assignment; a held-transaction
  test revoking the assignment between `revision_target` and `record_disposition`.

### M6 — "Inputs must be effective facts": the negative cases are untested in Rust and SQL
- **Rules:** `0020…sql:336-345` (revision) and `:217-228` (rewritten
  `assessment_guard`), Rust `effective_facts`.
- **Why:** only the positive carried-input path runs (rev3 reads the carried
  approver). An excepted fact, or a carried fact later shadowed by the basis's own
  fact with the same subject/name, used as an input is never forged; deleting the
  `NOT EXISTS(… o.subject, o.name …)` shadow clause survives. The revision messages
  "…is an effective fact of its basis and subject…" and "continues an evaluation
  chain of its own Task and subject" appear in no test.
- **Add:** forge rev3's inputs with the old (excepted) amount; record a carried
  fact, then an own fact of the same subject/name on the successor, and forge an
  input of the carried one; forge a revision whose `subject` differs from its chain.

### M7 — Immutability "even for the owner" is vacuous for UPDATE and untested for DELETE; RLS isolation is tested only against an empty scope
- **Rule:** `revision_immutable`/`revision_retained`, `0020…sql:525-553`.
- **Why:** the owner's `UPDATE … SET actor_id=actor_id` asserts `rows_affected()==0`
  — the owner has FORCE RLS and no scope GUCs, so no row is visible and the
  trigger never fires; a role-conditional exemption in the trigger survives. Owner
  DELETE is not attempted. `TRUNCATE assessment_basis_carries CASCADE` is also
  refused by the cascaded `carried_facts` trigger, so dropping the carries truncate
  trigger survives. RLS is checked only as "nothing visible without a scope"; a
  second engagement's scope is never shown to see zero rows.
- **Add:** as owner with the engagement GUCs set, UPDATE and DELETE each table and
  assert the immutability message; TRUNCATE carries *without* CASCADE (after
  emptying carried_facts under the reset) asserts its own trigger; a read under
  engagement-b's GUCs sees zero rows.

### M8 — `revision_first` is tested only for the same basis, not its purpose (a successor basis must revise, not restart)
- **Rule:** `0020…sql:494-520`.
- **Why:** the forgery's `jsonb_set(…,'{basis_id}',to_jsonb(e.basis_id))` sets the
  basis to itself, so a mutation comparing only `e.basis_id = NEW.basis_id`
  (no lineage walk) survives — the same-basis case is refused anyway. The Rust side
  is covered (`evaluations.len()==1` in the corrected-fact application test).
- **Add:** the same forgery with `basis_id` = the successor `fy2026b` (and a
  criterion successor once H2's fixture exists) → refused with that message.

### M9 — The SQL disposition reference guard is untested
- **Rule:** `0020…sql:412-417` and its mapping to `ReferenceUnverified(0)`
  (`infrastructure/src/assessment/revision.rs:645`).
- **Why:** Rust verification is tested (index 1, cells, unreadable originals), but
  removing the SQL check survives; the mapping branch never runs.
- **Add:** forge a disposition whose reference has `verification='unverified'`, a
  wrong `original_sha256`, an unregistered `original_id`, and a 1,001-byte quote —
  one per statement.

### M10 — The final change was not verified across the workspace, and the document-job reuse fix has no unit test that distinguishes it
- **Rule:** `application/src/reading.rs:1321-1372` (every document read reuses the
  newest job of the same program; an ordinary read keeps its collected outcome).
- **Why:** after `cc64fa9` only `application` lib, `oidc_protocol` and
  `worker --test revision` were rerun; other worker targets that perform ordinary
  document reads (`citations`, `investigation`, `assessment`, `coverage`,
  `reliability_process`) and `api` were last run before that change. The changed
  unit assertion (`reading/tests.rs:1677`, same job and failure twice in one flow)
  would also pass on the pre-24.3a code (fixed key, settled once); the cross-cycle
  case that motivated the fix (a later cycle citing cells an earlier fact cited,
  whose key carried an expired operation) is covered only incidentally by the
  worker revision test's turn 4.
- **Add:** rerun `cargo test --workspace --locked -- --test-threads=1`; a reading
  unit test with two cycles (second basis, new operation expiry) citing the same
  cells → same job reused, no conflict.

---

## Low

- **L1 — Two web parser cases break more than one rule** (`web/tests/revision.test.mjs`).
  "a total below the listed revisions" (`total='2'`) also violates "final page
  stops short of the total", so deleting `numbers.some(n => n > total)`
  (`web/src/revision.ts` `parseHistory`) survives. "a review that is not the newest
  disposition" (`review:'accepted'` with a `replaced` disposition) also violates the
  `review==='replaced' ⇔ effective_origin==='human'` and effective-equals-head rules,
  so deleting the review/kind mapping survives. The `next_cursor !== null` rule has
  no case. Rebuild each case so it changes one fact (e.g. a `next_cursor` page with
  `total` below the last number; an `accepted` disposition with `review:'pending_reconsideration'`
  and effective fields equal to the head).
- **L2 — The browser spec answers its own POST** (`web/tests/browser/revision.spec.ts`),
  so the real API is untested there (refusal body shape, headers accepted). It says
  so; the real route runs only through the worker test's HTTP client. Acceptable,
  but the 409 rendering uses a hand-written body rather than the recorded one.
- **L3 — The duplicate React key fix has no regression test** (`web/src/TaskWorkPanel.tsx:136`).
  Add a browser assertion that exactly one `AssessmentBasis` and one `Coverage`
  section exist after a forced work re-read.
- **L4 — History paging and withholding:** no case at the 50-entry boundary
  (`room = HISTORY_PAGE - 1` on page 1, `more`); history fact values reuse
  `work::fact_response` but no history read by a viewer who cannot read the original;
  reference-quote withholding is tested only through the unit view function with a
  hand-set `readable` flag.
- **L5 — Bare/weak assertions:** runtime `DELETE` checked with bare `is_err()`
  (refused by privilege, not the trigger — fine, but untargeted); the fixture-reset
  `current_database() LIKE '%\_test'` condition and TRUNCATE-under-reset are untested.
- **L6 — Probably unreachable branch:** `plan_revision`'s "nothing it reads changed
  … yet its output differs" (`revision.rs:860-866`) — deterministic evaluation of
  equal inputs gives equal digests and judgments are refused earlier; either prove
  it reachable with a test or say it is defensive.
- **L7 — Cross-Task targets:** no API case for a disposition naming another Task's
  revision in the same engagement (`revision_target` filters by `task_id` →
  `revision_not_found`), nor the SQL "names an evaluation chain of its own Task"
  message; the history route's 403 is tested only for a non-existent chain ID.
