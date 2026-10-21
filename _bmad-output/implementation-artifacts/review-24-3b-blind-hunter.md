# Story 24.3b — Blind Hunter review

Scope: `git diff f91f3f1d a83452e3 -- zobba`. I read the diff first, without the
spec. Then I checked the findings against the spec's 24.3b Intent, Boundaries,
I/O rows and the "24.3b delivered" deviations, and against the lessons in the
24.1, 24.2 and 24.3a reviews. Read-only review. No code was run; the cost
estimate in H1 is from reading the code, not measured.

Counts: High 1 · Medium 5 · Low 5.

## High

### H1. Exception status is derived again for every exception, on every turn and in every effective-summary insert. At the declared population bound this can pass the 4-second statement timeout, and then the Task cannot proceed.

- **Where:** `infrastructure/src/assessment/exception.rs:104-122` (`ENTRIES`), `:167-184` (`entries`), `:277-335` (`exception_snapshot`), `:747-790` (`exceptions_view` calls `entries` and then `exception_snapshot`, so it derives every status twice); `migrations/0021_assessment_exceptions.sql:237-281` (`assessment_exception_observations`), `:780-796` (`effective_guard` calls `assessment_exception_status` for every exception); `application/src/work.rs:2207-2213` (`assessment.context` on every turn; `Unavailable`/`Capacity` → `CycleEnd::Unavailable`); `infrastructure/src/lib.rs:59` (`statement_timeout` 4000 ms).
- **Scenario:** A population of 20,000 rows (`MAX_POPULATION_ROWS`) is evaluated with a rule that fails for a few thousand subjects. Each failure gives one exception. For each exception, `assessment_exception_observations` does three things:
  - It scans the Task's evaluations by the `(…, task_id, created_us)` index (there is no `(task_id, subject)` index) and calls the plpgsql `assessment_criterion_root` for each match.
  - It walks every population of the Task with `NOT EXISTS` and the `assessment_population_lineage` set-returning function.
  - It joins opportunities by subject.

  `exception_snapshot` runs this for **all** exceptions of the Task in one statement, every turn, only to show four counts per basis. So the cost grows with exceptions × evaluations of the Task. Thousands of exceptions at a few milliseconds each go past 4 s. Then every turn ends `Unavailable` and is retried for ever, and the rows cannot be removed. `effective_guard` repeats the same derivation inside one INSERT statement, plus up to about 32 calls to `assessment_effective_outcomes`, so at this size no effective summary can be recorded either. A timeout (57014) is not in `refusal()`'s list, so it is `Unavailable`. The model controls the scale, because it asks for `evaluate_population`.
- **Fix:**
  - Give the outline counts a cheap path, or cache them per statement. Do not derive per-exception observations over the whole Task on every turn.
  - Add an index on `assessment_evaluations(organisation_id, client_id, engagement_id, task_id, subject)` and on the root lookup (or store `criterion_root` on evaluations, revisions and opportunities when they are written).
  - Remove the second derivation in `exceptions_view`.
  - Add a load test at the 20,000-row bound with a realistic number of failures, under the real 4 s timeout, for the outline, `exceptions_view` and `record_effective`.

## Medium

### M1. A disposition's time is used as the time of the observation. So an `accepted` (or `needs_reconsideration`) saved later can make an older met revision count as "newer than the failing occurrence", and the exception becomes `resolved_by_evidence`.

- **Where:** `0021…sql:254` (`at_us = greatest(head_us, newest disposition created_us)` for any disposition kind); `:313-317` and `domain/src/exception.rs:206-224` (`resolves` requires `at_us > failing.at_us`).
- **Scenario:**
  1. t=10: a deterministic chain head R2 of criterion C, subject S, is `met` with cause `inputs_changed`.
  2. t=20: a later population version gives the rule opportunity (C, S) `not_met`. This is a new occurrence and the newest observation, so the status is `open`, which is correct.
  3. t=30: an auditor saves `accepted` on R2. R2's observation time becomes 30. It is now the latest observation and newer than the occurrence, its evidence differs, and its cause is `inputs_changed`. So the status is `resolved_by_evidence`, with the words "a later evaluation of new evidence meets the criterion". This is false: the newest evidence fails.

  The population tip still counts S as failing in the effective summary. So one summary has a resolved exception and a failing subject for the same thing. The spec requires "met … with a newer source". An acceptance is not a newer source, and per spec `accepted` is not sign-off.
- **Fix:** In `resolves`, compare the outcome's own record time (`head_us`, the opportunity's `created_us`), not the disposition time. Use the disposition time only for the `replaced` overlay, where the person's verdict really is new. Do this in both the SQL function and the Rust function, and add a parity test for this exact sequence.

### M2. The status reads only the single latest observation, even when another current observation of the same lineage and subject still fails.

- **Where:** `0021…sql:297-320`; `domain/src/exception.rs:196-251`.
- **Scenario:** One exception (lineage C, subject S) has more than one current observation. Examples: a per-subject `evaluate` chain and a population rule opportunity; or two chains from different basis lineages; or two population tips after a fork (populations may fork, see L4). The newest observation is a completed `met` with `inputs_changed`, or a person's `replaced met`. The status is then `resolved_by_evidence` or `replaced_by_human_judgment`, although another current observation is a deterministic `not_met`. The effective summary still counts S as failing, so the exception counts and the failing counts disagree with no limitation that explains why. The spec treats "not observed" conservatively (stay open); a failure that is still observed deserves at least the same care.
- **Fix:** Keep the exception open (and set `latest_observed = not_met`) while **any** current observation is `not_met`. Or state the disagreement as a closed limitation and in the status words.

### M3. An unreviewed model proposal can move an exception to `resolved_by_evidence`. The words then call it evidence.

- **Where:** `0021…sql:313` and `domain/src/exception.rs:208` refuse only `origin = human`. A `model_proposal` head counts as evidence.
- **Scenario:** The model attaches one more verified fact to a judgment of a failing subject (which gives `inputs_changed` and different evidence digests) and proposes `met`. Nobody has reviewed it. The exception's status becomes `resolved_by_evidence` ("a later evaluation of new evidence meets the criterion"), the outline shows "N resolved by evidence", and `exceptions_open` goes down. The effective summary adds `unreviewed_model_proposals` as a Task-wide count, but nothing ties that count to this exception's status. This is close to the spec's Never list ("a model-written … exception status"). The status is derived, but only the model's verdict decides it. The spec's resolved rule does not say whether a proposal qualifies. The worker proof resolves INV-0042 and INV-0055 this way. Owner decision needed.
- **Fix:** Require `origin = deterministic`, or a model proposal with an `accepted` disposition, before a chain head resolves an exception. Or keep it `open` with words such as "a model proposal, not yet reviewed, meets the criterion; not evidence of remediation".

### M4. An effective summary of a sample (or of one population) counts and lists the exceptions of the whole Task, but its words say "over the selected items".

- **Where:** `application/src/assessment/exception.rs` (`exception_entries(basis, &roots)` has no subject filter) → `domain::summarise_effective` (`ExceptionCounts::of(exceptions)` with no domain filter); `0021…sql:781-796` (the guard counts every exception of the Task under the basis roots); `effective_line` ("Effective summary … over the selected items of sample S: … exceptions N … over M distinct subjects").
- **Scenario:** The Task has exceptions on subjects outside the sample, or from another population of the same basis lineage. A summary of a sample of 3 items says `sample_only (3)` and also "exceptions 6 … over 5 distinct subjects". `exception_subjects` can be larger than `selected` or `in_scope`, and nothing refuses that. A reader takes the exception counts as part of the sample's result.
- **Fix:** Filter the exceptions to the summary's domain (sample subjects, or the population's in-scope subjects). Do this in Rust and in the SQL recount, and add `exception_subjects <= coalesce(selected, in_scope)`. Or label the block in words as "all exceptions of this Task under these criteria".

### M5. The number of exceptions has no limit, but every read refuses past a fixed limit. After that, every turn fails, for ever.

- **Where:** `infrastructure/src/assessment/exception.rs:121` (`MAX_EXCEPTIONS = 16 × 20,000`), `:178-180` (`Capacity` when the limit is passed); `work.rs:2210` (`Capacity` → `CycleEnd::Unavailable`).
- **Scenario:** Exceptions are (criterion lineage × subject) over **all** populations and bases of the Task. Nothing limits the number of populations or criterion lineages per Task (0018 and 0019 have no limit per Task). If a Task passes 320,000 exceptions, `exception_snapshot` returns `Capacity` on every turn. The rows are immutable, so the Task cannot recover. This is the 24.3a-H1 class: model-controlled growth makes the context unusable.
- **Fix:** Limit exceptions (or populations and criterion lineages) per Task when they are written, and give feedback. Or make the outline count with an aggregate that never refuses, and page the viewer list.

## Low

- **L1.** `0021…sql:586`: an exception holds at most 16 dispositions, counted over close and reopen together. After 8 close/reopen pairs, nobody can close an open exception or reopen a closed one again. A closed exception then stays closed unless a new occurrence arrives. Name this in words in the panel, or count only one kind against the limit.
- **L2.** `infrastructure/src/assessment/exception.rs:583-611`: the replay inside `record_exception_disposition` returns the stored record without checking `may_close` again. `exception_disposition_by_key` does check it, but in an earlier, separate transaction, so a revocation between the two reads can be answered with 200. Call `may_close` in the write transaction too. Also, `refused()` maps a 23505 (two first writes of one key at the same time) to `Unavailable`/503 instead of reading the winner back as a replay.
- **L3.** `0021…sql:776-779`: the 24.2 coverage limitations inside an effective summary are checked only against the closed codes, not derived from the counts. The guard's comment says "The conclusion and the limitations are the ones those counts allow". A runtime direct insert could leave out `unreviewed_model_judgments`. Only the outer limitations are derived. Derive the inner ones too (as 24.2 should), or correct the comment.
- **L4.** `0021…sql:39-51`, `:261-279`: the population lineage walk stops at 64 versions, but 0019 sets no depth limit and allows forks (there is no UNIQUE on `supersedes`). Past 64 versions, the newest tip no longer reaches the version that held the opportunity. Its `absent` and rule observations then disappear, without any message. Refuse a 65th population version and a second successor, as 0020 does for criteria.
- **L5.** `0021…sql:22-36`, `:504`: when a lineage has more than 64 earlier versions, `assessment_criterion_root` returns a version that is not the root. 0020 refuses this only for versions created after it. If a schema-19 database already has a criterion lineage deeper than 64, the root differs by depth. `exception_batch` then refuses every later `not_met` write for that lineage (`root(criterion_root) ≠ criterion_root`), and the batch of the opportunity or evaluation fails. This is the 24.3a-M2 upgrade class. Add a preflight to the migration.

## Checked and found sound (no finding)

- Occurrence creation: one statement-level writer covers evaluations, revisions, opportunities (bulk batches, set-based) and `replaced not_met` dispositions. `ON CONFLICT DO NOTHING` together with `DISTINCT ON` gives one exception per (Task, root, subject) even under concurrency. The PK `(exception, source_kind, source_id)` prevents duplicate occurrences. A judgment opportunity that is also an occurrence is a documented deviation. The statement guard re-derives every column, and the backfill matches the writer.
- Close/reopen race with a new occurrence: worker writes (`claimed`) and disposition writes both take `task::lock` (organisation advisory lock, then engagement `FOR UPDATE`) before they insert, so a closure cannot hide an uncommitted occurrence that is older than it.
- Authority: the database guard requires `knowledge_audit` (assignment) and `evidence_session_locked` (the person's live session; a worker holds none), and the closer must be an Audit manager or the accountable person. Rust checks `may_close` first. A replay through `by_key` checks the session, the assignment and `may_close` again. With no scope set, RLS refuses. An Admin alone is refused by the admission fence.
- A closure never lowers a failing count: effective outcomes ignore exception dispositions, and the guard recounts every partition number with NULL-safe `IS DISTINCT FROM` and type checks for every key. `listed` and the outer limitations are compared exactly.
- Rust and SQL status rules match (order, tie-break, the closure test `o_at <= d_at`, the rules for human and resolved).
- API words are recomputed (`status_words`, `l.words`) and are not read from stored document text. Every open/not-observed status gives the "not evidence of remediation" sentence. Person rationales do not enter the model outline. No percentage or confidence field was found.
- Web request keys keep the uncertain key (the 24.3a L2 fix is carried over).
