# Review 24.3b — Edge Case Hunter

Scope: `git diff f91f3f1d a83452e3 -- zobba` (Story 24.3b: exception
occurrences and derived status, exception dispositions, the effective
summary, backfill, API and panel), against
`spec-24-3-revise-evaluations-without-overwriting-facts-or-exceptions.md`
(I/O matrix, owner decisions 2026-10-15, "24.3b delivered" deviations).
Read-only review. Each finding was checked by reading the code paths named;
no code was run. Lessons applied from the 24.1/24.2/24.3a reviews: a bounded
page is never the whole; exact counts never come from a list; replays recheck
authority; Rust/SQL parity; model-controllable input never fails a cycle; a
later read that does not observe something is not evidence about it.

Counts: **High 2 · Medium 7 · Low 10**.

---

## High

### H1 — A newer "not evaluated" judgment opportunity hides the chain head: resolved and human-replaced exceptions fall back to `open`
- **Where:** `zobba/migrations/0021_assessment_exceptions.sql:268-273` (`rules` CTE takes every opportunity of a population tip with `evaluation_id IS NULL`, whatever its verdict, as an observation at its own `created_us`); `zobba/crates/application/src/assessment/coverage.rs:1433-1447` (a judgment whose chain has a later revision, or reads another basis version, is left out of `judgments`) and `:1491-1501` (that subject's opportunity is then recorded with `verdict` NULL, `evaluation_id` NULL, origin deterministic). Same rule in Rust: `domain/src/exception.rs:196-251` reads the same observation rows.
- **Input/state:** judgment J on subject S: r1 `not_met` (exception, occurrence) → late evidence → r2 `met` with `inputs_changed` (status `resolved_by_evidence`), or a person saves `replaced met` on r2 (`replaced_by_human_judgment`). Then the agent proposes a population (first time, or a new version that supersedes an earlier one) and asks `evaluate_population` for J.
- **Wrong output:** S's opportunity is "not evaluated" (verdict NULL) and newer than the chain head, so it becomes the latest observation: `exception_status` returns `open` / `not_observed` with "not evidence of remediation" — although the current head says met and a person's judgment replaced the failure. The panel, the outline counts and every later effective summary move the exception from resolved/replaced back to open. The effective summary over that population also counts S unresolved (`judgment_not_recorded`), so for any population evaluated after a revision the "effective" summary never sees the revision it exists to reflect. The worker proof only creates the population before the revisions, so this is untested.
- **Fix:** do not treat an opportunity without a verdict as an observation (filter `rules` to decided rule opportunities, or rank the chain head above a not-evaluated opportunity of the same subject); better, let a new population's judgment opportunity name the chain (root ID) when the head is a later revision so `assessment_effective_outcomes` resolves it to the head. Add a worker case: revise, then propose a population, then read status and summarise.

### H2 — More than 200 exceptions: the list response reports 0 open / 0 resolved / … beside the true total, and the web refuses the whole response
- **Where:** `zobba/crates/api/src/exceptions.rs:424-447` (`exceptions_response` fills the per-status counts only when `view.exceptions.len() == view.total`; otherwise `ExceptionCounts { total, ..Default }`); `zobba/crates/infrastructure/src/assessment/exception.rs:764` (`take(EXCEPTIONS_SHOWN)` = 200); `zobba/web/src/exceptions.ts:95-96` (`open + resolved + replaced + closed !== total` → `invalid()`).
- **Input/state:** a Task with 201 or more exceptions (a 20,000-row population with a broadly failing rule criterion reaches this easily).
- **Wrong output:** the API states `total: 201, open: 0, resolved_by_evidence: 0, …, subjects: 0` — false exact counts, against the route's own comment "Counts are over every exception of the Task, never over the listed ones". `parseCounts` then throws, so `readExceptions` fails and the panel shows "The exceptions could not be read now" for the whole Task (no list, no effective summaries) until the count drops, which it never does (exceptions are immutable).
- **Fix:** count by status over `all` (already loaded, with derived status) in `exceptions_view` and return those counts; add a test with 201 exceptions and a recorded fixture over the bound.

---

## Medium

### M1 — An effective summary can conclude `no_exception_found` while exceptions of its criteria are open
- **Where:** `domain/src/exception.rs:614-631` (conclusion is the 24.2 `summarise` over effective outcomes; exceptions never enter it); SQL `effective_guard` conclusion block (`0021…sql`, `expected := CASE …`), which requires the same.
- **Input/state:** matrix row "Not observed later": exception from population v1; v2 supersedes v1 and lacks the subject (or the criterion was revised and v2's met is under the new version, which `resolves` does not accept — see L2). Every other subject of v2 meets, deterministic, complete.
- **Wrong output:** effective summary of v2: `no_exception_found`, while the same document lists the exception `open` / "not evidence of remediation". The conclusion reads as remediation by non-observation — the outcome the spec's "Never" list forbids for status.
- **Fix:** when any exception of the basis's lineages is `open`, cap the conclusion at `exceptions_found_inconclusive`/`inconclusive` (or add a limitation such as `open_exceptions_not_observed`), in Rust and in the guard.

### M2 — Exception counts and the listed 50 are Task-wide, not the summary's population or sample
- **Where:** `application/src/assessment/exception.rs:430-436` (`criterion_roots` → `exception_entries(roots)` for the whole Task); `0021…sql` `effective_guard` `x` CTE (`task_id` and `criterion_root` only).
- **Input/state:** a sample summary (`sample_only`: "the counts describe the selected items only, never the population"), or a summary of population B when population A of the same basis lineage, or basis-fact evaluations, hold other failing subjects.
- **Wrong output:** the sample summary shows exceptions of unselected subjects next to a sentence saying every count describes the selected items only; `exception_subjects` can exceed the summary's own `failing` + `unresolved`; and any unrelated exception change elsewhere in the Task changes the summary digest, so an unchanged population gets a new superseding version.
- **Fix:** restrict counted/listed exceptions to subjects of the summary's domain (sample selection or in-scope members), and state Task-wide totals separately if wanted.

### M3 — A closure silently absorbs a concurrent `not_met` it never saw
- **Where:** `0021…sql:307` (`closed` while `o_at <= d_at`, comparing clock times); the writer `exception_record` (`:429-483`) takes no exception lock; `exception_guard` (`:727`) locks only against other dispositions. `created_us` defaults are computed at row insertion, not at commit.
- **Input/state:** an Audit manager closes exception X while a revision, or a long opportunity batch, inserting a new `not_met` for X is in flight: its row time `t_o` precedes the closure's `d_at`, but it commits after the closure's guard read the status.
- **Wrong output:** after both commit, `t_o <= d_at`, so X stays `closed_by_disposition`, though the closer decided without that failure and the spec says a later not_met reopens. Nothing tells anyone.
- **Fix:** have the writer take the same `exception:` advisory lock per affected exception (set-based, sorted), or order occurrences and closures by a commit-ordered sequence instead of `clock_timestamp`. Add a held-lock race test (occurrence in flight vs close).

### M4 — Re-counting the same old judgment over a new population version adds a fresh occurrence and reopens a closure
- **Where:** `application/src/assessment/coverage.rs:1435-1447`/`1034-1052` (an unrevised judgment's opportunity copies `h.first` — the model's own outcome, ignoring a person's `replaced`); writer `0021…sql:443-449` (every `not_met` opportunity is an occurrence at its own time).
- **Input/state:** judgment r1 `not_met` (no revision) closed by an Audit manager, or replaced by a person with `met`. The agent proposes population v2 and evaluates J again.
- **Wrong output:** v2's opportunity carries r1's model `not_met` → a new occurrence at a later time → the closed exception reopens (`open`, latest observed `not_observed`), with no new evidence and no new judgment; the occurrence list shows a model failure a person already replaced; the effective summary of v2 says the subject meets. Same for a rule opportunity over an identical row (same evidence digests).
- **Fix:** do not record an occurrence for an opportunity that names an already-recorded judgment (its chain is the source), or let reopening require an occurrence whose evidence differs from the closure-time one.

### M5 — A person's `replaced undetermined` counts as `replaced_by_human_judgment`
- **Where:** `0021…sql:311`, `domain/src/exception.rs:241-243` (`origin human` and verdict ≠ `not_met`); 24.3a allows `replaced` with `undetermined` (`0020…sql:142`).
- **Input/state:** model `not_met`; an auditor saves `replaced undetermined` ("I cannot tell").
- **Wrong output:** the exception leaves `open` ("a person's verdict replaces the failing judgment") and the open count drops, though nobody decided the criterion is met; the effective summary meanwhile counts the subject unresolved. The open count can be lowered without a finding.
- **Fix:** treat only a human `met` as replacement for status (an `undetermined` replacement keeps `open`, latest observed `not_observed`), in SQL and Rust; owner confirmation if the spec's "≠ not_met" was meant literally.

### M6 — Every turn, panel read and summary guard derives every exception's observations; cost grows with exceptions × Task records
- **Where:** `infrastructure/src/assessment/exception.rs:296` (`exception_snapshot` → `entries(tx, task, None)` for the outline, every turn), `:763` (panel), `0021…sql:237-281` (per exception: scan of all Task evaluations by subject without an index, a plpgsql `assessment_criterion_root` per evaluation and opportunity, `assessment_population_lineage` per population); `effective_guard` calls `assessment_exception_status` for every exception again inside the coverage/effective locks.
- **Input/state:** a 20,000-member population failing one rule criterion (20,000 exceptions), plus some basis-fact evaluations.
- **Wrong output:** context building (outline) runs hundreds of thousands of function calls and nested queries per turn; past `MAX_EXCEPTIONS` it returns `Capacity`, which `context`/`effective_summarise` propagate with `?` — a step error each cycle rather than feedback. Statement timeouts would make every turn `Unavailable`.
- **Fix:** count by status with one set-based query (or store per-exception observation inputs indexed by subject/root), bound the outline read, add an index on evaluations `(task_id, subject)`, and turn capacity into an outline note rather than a failed read.

### M7 — The exception list has no paging: exceptions after the first 200 cannot be reached
- **Where:** `infrastructure/src/assessment/exception.rs:747-815` (`exceptions_view` returns the first 200 in C order, no cursor); `api/src/exceptions.rs` list route has no `cursor` parameter; `web/src/Exceptions.tsx` shows only "N more exceptions are counted but not listed".
- **Input/state:** 201+ exceptions; an Audit manager needs to close subject `ZZ…` (sorted last).
- **Wrong output:** no list page, no search; the detail and disposition routes need the exact `exc-…` ID, which the viewer cannot obtain. The spec's "exception list paging (empty, boundary, bad cursor)" has no implementation to test (and see H2 for what the bound does to counts).
- **Fix:** C-ordered keyset cursor on (subject, criterion_root, id) with exact total, as the 24.3a history route; test empty, exactly 200, 201, and a malformed cursor.

---

## Low

- **L1 — Exception outline lines can be dropped or never shown.** `application/src/assessment.rs` pushes the exception lines last (after revision lines), so the 24.3a outline byte cap drops them first; `exception_snapshot` counts only under the newest 4 basis tips (`exception.rs:310`, `LIMIT 4`, no "N more" line), and an exception whose criterion lineage is not in any of them is counted nowhere in the outline.
- **L2 — A rule exception can never resolve after its criterion is revised.** `resolves` requires the met opportunity's criterion version to equal the failing occurrence's (`domain/src/exception.rs:218-220`, `0021…sql:316`); a new criterion version over a new population stays `open` forever (feeds M1).
- **L3 — Misleading words after a reconsideration-only `met`.** A revision whose only cause is `reconsideration_requested` (or a revision-1 basis evaluation that meets) is not a resolution, so status is `open` with "not observed in the latest revision" — but the latest revision did observe the subject and judged it met.
- **L4 — Population lineages are not bounded or fork-free at insert.** `assessment_population_lineage` stops after 64 steps (`0021…sql:43`), but 0019 neither bounds population lineages nor makes `supersedes` unique, so the deviation "bounded at 64 (the 24.3a bound)" is not enforced; a longer lineage loses old opportunities from `tips`, and a fork gives two tips whose latest observation depends only on creation order.
- **L5 — 16 dispositions per exception, permanently.** After eight close/reopen pairs (`0021…sql:731`), a later not_met reopens the exception and nobody can ever close it again (409 `exception_disposition_capacity`).
- **L6 — Occurrence paging by OFFSET over clock-ordered rows.** `exception_detail` pages `ORDER BY source_us, source_id OFFSET n` (`infrastructure/.../exception.rs:849`); an occurrence committed late with an earlier `source_us` (M3) shifts pages (skip/duplicate). The panel says "More occurrences are recorded than shown" but offers no next-page control.
- **L7 — The recount guard does not recount everything it stores.** `effective_guard` checks only that the inner 24.2 `limitations` codes are in the closed set (not their presence or counts), and does not check `summary_digest`/`digest` against the document; a forged inner limitation list passes.
- **L8 — "at least" on exact counts.** For an incomplete population, `EffectiveLimitation::words` prefixes "at least" to pending reconsiderations, unreviewed proposals and superseded inputs, which are exact counts of recorded heads.
- **L9 — Transient resolved → open.** When population v2 supersedes v1 but is not yet evaluated, v1's rule opportunity is no longer a tip observation; a rule exception resolved under v1.5 reads `open` until v2 is evaluated (same root as H1).
- **L10 — Accepted after replaced not_met.** If a later `accepted` disposition follows a person's `replaced not_met` on the same head, the effective summary counts the model's `met` while the exception stays `open` / `not_observed` (head and occurrence evidence are equal). Honest but contradictory beside each other; say why in the panel.

---

## Checked and sound (no finding)

- First, repeated and not_met → met → not_met on one chain: one exception, one occurrence per not_met; met with `inputs_changed`/`basis_revised`, newer and other evidence resolves; a later not_met reopens to `open` / `not_met`.
- not_met → undetermined / failed / not applicable / absent: `open`, `not_observed`, with the not-remediation sentence (Rust and SQL agree, including the (time, ID) C-order tie-break and the newest-occurrence/newest-disposition order).
- Close with 0 references → 400 (Rust and table CHECK); 9 or duplicate references → 400; unverified or partial-value quote → 409 with index (shared `verified_references` keeps the 24.3a whole-value fix); close of a closed one / reopen of an open one → 409; two closes serialise on the `exception:` lock and the second is refused.
- Authority: Auditor not accountable → 403 `exception_close_forbidden`; Admin only → 403 (`knowledge_audit`); accountable person or Audit manager allowed; an idempotent replay rechecks session, assignment and closing authority before returning the original; same key with a different body or another exception → 409.
- Writer/guards: every evaluation, revision, opportunity and `replaced not_met` disposition writes its occurrence in the same statement; subject, inputs (≤32) and criterion lineage (≤64, Task-scoped) bounds match the source tables, so the writer cannot refuse a legal source row; forged exceptions/occurrences are refused; immutability and RLS hold.
- Backfill on schema-20 data: empty, many and duplicate sources produce one exception per (Task, root, subject) (earliest source first) and one occurrence per source, with the same derivation as the writer; RLS FORCE is restored.
- Effective summary: an unchanged result records nothing; a database refusal is feedback, not a failed cycle; missing opportunities and foreign populations are feedback; samples never conclude `no_exception_found`; distinct-subject counting is correct when one subject fails several criteria.
- Web parser: absent or malformed fields refuse the response; listed = min(total, 50); limitation order and `sample_only` presence are checked; closure needs a reference.
