# Review 24.3b — Verification gap

Reviewer lens: for each 24.3b rule, find the test that FAILS when the rule is broken.
Scope: `git diff f91f3f1d a83452e3 -- zobba`, the 24.3b section of
`spec-24-3-revise-evaluations-without-overwriting-facts-or-exceptions.md`.
Read-only review. The coverage test was NOT re-run: no PostgreSQL was up in this
session (`pg_isready`: no response) and the test activation script was absent.

Counts: **High 3 · Medium 8 · Low 8.**

What is well covered (checked, not assumed): owner immutability is tested with
`NO FORCE ROW LEVEL SECURITY` lifted, so the trigger is reached and RLS does not
answer first (`worker/tests/exception.rs:1739-1778`); TRUNCATE for admin and owner;
runtime DELETE `permission denied`; engagement RLS both directions (`:1782-1796`);
the two-row forged exception insert, one bad row (`:1817-1838`); the held-lock close
race waits on the advisory lock and then reads the committed closure (`:1920-1982`);
the backfill block is re-run and compared with the writer's output (`:2063-2125`);
0020/v20 are pinned (`infrastructure/tests/published.rs`); app-level refusals for
no evidence (400), another Auditor (403 `exception_close_forbidden`), Admin alone,
reopen of an open exception, unverified reference with index, key conflict, closed
twice (`:1192-1290`).

---

## High

### H1 — No test asserts the occurrence of a not_met **revision** or a person's **`replaced not_met`**
- Rule: every not_met path writes one occurrence (spec matrix row "Human disagrees …
  exception occurrence (human) created").
- Enforced: `migrations/0021_assessment_exceptions.sql:436-460` (revision and
  disposition branches of `exception_record`); guard `:522-553`; backfill `:384-397`.
- Why tests cannot catch it: the 24.3b proof produces only `evaluation` and
  `opportunity` occurrences (`worker/tests/exception.rs:1050-1088`; the person's
  replacement on 000123 is `met`, `:1173-1184`). `worker/tests/revision.rs:974-1017`
  does save `replaced not_met`, but asserts nothing about exceptions. The statement
  guard only checks rows that ARE written, so a writer branch that writes nothing
  (for example `WHERE a.kind='replaced' AND a.verdict='met'`, or a dropped revision
  branch) passes every test. The backfill re-run uses the same fixture, so its
  revision and disposition branches are never compared either.
- Test to add: in `exception.rs`, a judgment revision to `not_met` and a person's
  `replaced not_met` on a `met` model proposal; assert exactly one new occurrence each
  with `source_kind` `revision` / `disposition`, origin `model_proposal` / `human`,
  and the expected evidence; then re-run the backfill block over that data.

### H2 — The effective-summary recount is forged for 2 of about 35 counted fields
- Rule: "The insert guard recomputes every count … and refuses disagreement";
  missing keys refused, NULL-safe.
- Enforced: `0021…sql:613-819` (`effective_guard`): population counts `:664-669`,
  selected `:672`, opportunities complete `:683-688`, per-criterion 15 fields + reasons
  `:689-731`, reviews `:738-741`, unresolved / meets / not applicable / failing
  opportunities `:758-762`, conclusion `:765-775`, coverage limitation vocabulary
  `:776-779`, exception counts `:797-800`, `listed` `:801-805`, limitations `:806-818`,
  supersedes newest `:641-646`, invocation binding `:620-626`, completeness `:633-636`.
- Why tests cannot catch it: only two forgeries exist — open→resolved
  (`exception.rs:2032-2043`) and failing→meets (`:2044-2058`). Delete any other
  comparison (for example `human_replaced`, `pending`, `superseded`,
  `unresolved_subjects`, `listed`, the limitation list, the conclusion, the
  supersedes-newest check) and every test still passes. No test removes a JSON key,
  so the `jsonb_typeof(...) IS DISTINCT FROM 'number'` NULL-safety is unproven. The
  domain's `is_consistent` forgery test (`domain/src/exception/tests.rs:594`) checks
  the Rust copy, not the guard.
- Test to add: a table-driven forgery loop over the stored newest summary — one case
  per guarded field (column and document changed together so the table CHECKs pass),
  plus one case per key removed from `effective.summary`, `effective.criteria[i]` and
  `effective.exceptions`; assert each refusal message names its own field.

### H3 — "Not observed later" and rule-opportunity resolution have no PostgreSQL test
- Rule: AC "an exception whose latest revision does not observe it … is `open` and
  says this is not evidence of remediation"; matrix rows "Not observed later" (v2
  lacks the subject) and "Resolved by evidence" (v2 from a new original shows `met`).
- Enforced: `0021…sql:261-283` (`tips`, `rules`, `absent` CTEs of
  `assessment_exception_observations`) and `:313-317` (the `opportunity` arm of
  `resolved_by_evidence`).
- Why tests cannot catch it: no worker test proposes a superseding population, so the
  `tips` / `absent` / `rules` CTEs never return a row (the deviation list says so). Both
  the Rust status (`infrastructure/src/assessment/exception.rs:106-170`, fed by the SQL
  observations) and the SQL status read the same function, so even parity cannot catch
  a wrong `absent` branch. The only "open + not_observed" proofs are the pure domain
  test (`domain/src/exception/tests.rs:89`) and a hand-edited web fixture
  (`web/tests/exceptions.test.mjs:50`).
- Test to add: in `exception.rs`, population v2 `supersedes` v1 without one failing
  subject → that exception `open`, `latest_observed not_observed`, API `status_words`
  ends with the not-remediation sentence; population v2 from a new original with the
  subject `met` → `resolved_by_evidence` through the `opportunity` arm.

---

## Medium

### M1 — The DB disposition guard's own branches are unreachable from the tests
- Rule: closing authority (Audit manager or accountable actor, membership not expired),
  own-Task exception, at most 16, reopen only a closed exception, verified references,
  a closure has ≥1 reference.
- Enforced: `0021…sql:577-601` and the table CHECK `:131-132`.
- Why: the application refuses each case first (`application/src/exception.rs:160-178`),
  so the API 403/409/400 answers come from Rust. The DB test reaches only the session
  branch (`exception.rs:1898-1907`) and closed-twice (`:1908-1916`). Removing the
  authority, own-Task, cap, reopen or reference branch, or the CHECK, fails nothing.
- Test to add: direct inserts in a person's session (`person(session)`) as actor-c
  (assigned Auditor, not accountable), with an expired manager membership, naming
  another Task's exception, a 17th disposition, `reopened` on an open exception, a
  reference with a wrong `original_sha256`, and `closed` with `references: []`.

### M2 — Occurrence forgery checks 2 of about 10 compared columns
- Enforced: `0021…sql:545-553`.
- Why: only `origin` and `evidence` are forged (`exception.rs:1858-1868`). No case
  names a `met` source (the `s.task_id IS NULL` arm), the wrong exception
  (`x.subject` / `x.criterion_root`), another `source_us`, `basis_id`, `criterion_id`,
  `population_id`/`member_ordinal`, or `actor_id`. The forged exception covers one
  first-source kind only.
- Test to add: one case per column, and one occurrence naming a `met` evaluation.

### M3 — Backfill is not tested as an upgrade
- Enforced: `0021…sql:367-418`.
- Why: the re-run (`exception.rs:2063-2125`) runs on a schema-21 database with the
  writer already installed, over evaluation and opportunity data only (see H1). No
  `bootstrap.rs` upgrade case migrates a populated v20 database (with not_met
  evaluations, revisions, opportunities and `replaced not_met` dispositions) to 21.
- Test to add: an `upgrade_contract` case: seed v20 not_met rows of all four kinds,
  apply 0021, compare exceptions and occurrences with the expected set.

### M4 — Derived reopening after a closure is untested in PostgreSQL
- Rule: "A later `not_met` occurrence after closure reopens it (derived)".
- Enforced: `0021…sql:307` (`o_at <= d_at`); Rust `domain/src/exception.rs:236-240`.
- Why: the e2e only reopens by disposition (`exception.rs:1291-1306`). Dropping the
  `o_at <= d_at` term (closure stands for ever) passes; only the domain test
  `a_closure_stands_until_a_newer_occurrence_reopens_it` sees it.
- Test to add: close an exception, record a later not_met (revision) on it, assert SQL
  and API status `open` and that a new effective summary counts it open.

### M5 — Rust/SQL status parity rests on one example per status
- Enforced: SQL `0021…sql:291-321` vs Rust `domain/src/exception.rs:206-245`.
- Why: parity is only implied by the guard accepting the two worker summaries. Edge
  cases (equal `at_us` tie broken by id, same evidence, human `undetermined`, no
  observation, reopened-then-newer) are compared in neither direction.
- Test to add: a parity table that inserts observation fixtures per status edge and
  compares `assessment_exception_status` with `exception_status` over the same rows.

### M6 — Replay recheck asserts a bare 403 and never removes closing authority
- Enforced: `infrastructure/src/assessment/exception.rs:531-561`.
- Why: `exception.rs:1307-1313` checks only `status == 403` after an assignment is
  revoked; the router's own authorization can answer that before the store's
  recheck. Loss of the Audit manager role (assignment kept) on replay is untested.
- Test to add: assert the error code; demote `actor-manager` to `auditor`, replay
  `reopen-0051`, expect 403 `exception_close_forbidden` and no original returned.

### M7 — API viewer scoping is untested
- Why: no API test reads the exception list or detail from another engagement, as
  Admin alone, or with an unknown or foreign exception ID (`exception_not_found`);
  `api/src/exceptions.rs` has only vocabulary/status unit tests.
- Test to add: those four reads in the worker proof, asserting 403/404 and no body.

### M8 — Coverage proof: a cycle can end with no recorded step (unexplained failure)
See "Coverage flake" below. The gap: nothing records or asserts why the cycle ended,
so the failure was undiagnosable.

---

## Low
- **L1** Race waiter detection counts any advisory waiter in the cluster
  (`exception.rs:1960-1972`), not the second connection's PID; a parallel test can
  satisfy it. Correlate by `pid` / `application_name`.
- **L2** `matches!(unscoped, Ok(0) | Err(_))` (`:1988-1991`) cannot fail and does not
  reach the INSERT policy (the SELECT reads nothing). Use a `VALUES` insert with no
  scope settings and assert the RLS refusal.
- **L3** Every web parser case asserts the same `/Invalid assessment response/`
  (`web/tests/exceptions.test.mjs:44-47`), so a case that breaks a different rule
  still passes; distinguish refusal reasons or test each rule's predicate.
- **L4** `exceptions.spec.ts` answers its own POST; it proves the request shape only.
  Server behaviour is proven in the worker test (acceptable, named).
- **L5** Forged-exception disjuncts (root not a root, criterion of another Task) share
  one message with the wrong-ID case (`0021…sql:502-507`); only wrong-ID is forged.
- **L6** No forged summary with a wrong `supersedes` (older or NULL while one exists).
- **L7** `refused()` maps guard messages by substring (`infrastructure/…/exception.rs:506-526`);
  untested ("reference" would also match a future message).
- **L8** "A closure never lowers failing" is confounded: between the two summaries a
  human replacement also changed failing (3→2). Add a summary immediately before and
  after a closure alone.

---

## Coverage flake (`cargo test -p zobba-worker --test coverage`)

Symptom: the proof stopped after 7 model sends with no failure step; four later runs
passed. `settle` waits for exactly 9 sends and `Waiting`
(`worker/tests/coverage.rs:406-421`), so a cycle that ends after send 7 without a step
just times out at 900 s.

Cycle ends that write **no step**: `CycleEnd::Unavailable` and `CycleEnd::Fenced`
(`application/src/work.rs:2246-2263`), and executor cancellation when the authority
poll fails (`worker/src/executor.rs:190-216` → `Observation::Cancelled`, only a
rate-limited `Code::AuthorityFailed` diagnostic).

Hypothesis (best fit): a **timing threshold crossed under load by new 24.3b work**.
1. Primary: every turn's context now calls `exception_snapshot`
   (`application/src/assessment.rs:2366`) → `ENTRIES`
   (`infrastructure/src/assessment/exception.rs:106-123`), one statement that runs
   `assessment_exception_observations` for every exception; that function calls the
   plpgsql `assessment_criterion_root` (one SELECT per lineage step) per evaluation
   and per opportunity row of every population lineage (`0021…sql:246-283`). On the
   coverage fixture (about 20 failing subjects, 7 populations of up to 1,200 × 2
   opportunities by turn 8) this is roughly exceptions × opportunities function calls.
   The runtime has `statement_timeout=4000` (`infrastructure/src/lib.rs:59`); a timeout
   maps to `ReadingError::Unavailable` → `CycleEnd::Unavailable` → no step. Building
   turn 8's context is exactly "after 7 sends".
2. Alternative: the authority poll `current()` takes the organisation advisory lock 205
   and `engagements … FOR UPDATE` (`infrastructure/src/task.rs:94-110, 906-930`) with a
   2 s client timeout (`executor.rs:12`), and every assessment write holds the same two
   locks for its whole transaction (`infrastructure/src/assessment.rs:66-78`). The new
   `exception_record` / `exception_batch` statement triggers lengthen the opportunity
   and summary writes of turn 7; one over 2 s cancels the cycle.

Not a race in ordering or a turn budget: the loopback script is deterministic, and a
budget would fail every run.

To settle it: run the coverage proof with PostgreSQL `log_min_duration_statement=1000`,
`log_lock_waits=on`, and capture the worker `Diagnostics` codes; (1) shows a
`canceling statement due to statement timeout` on the `ENTRIES` query, (2) shows
`AuthorityFailed`. Deterministic reproductions: in a test, hold
`task::lock` for 2.5 s during a cycle (expect cancellation), and `EXPLAIN ANALYZE` the
`ENTRIES` query on the post-turn-7 fixture. Fixes: store `criterion_root` on
evaluations/opportunities (or compute roots once in a recursive CTE) so observations
are set-based and indexed; record a step (or retry) when a context read is
Unavailable instead of ending silently; let the authority poll treat a lock-wait
timeout as "unknown, retry" until the lease really expires. Add an assertion to the
worker proofs that no cycle ended Unavailable/Cancelled.
