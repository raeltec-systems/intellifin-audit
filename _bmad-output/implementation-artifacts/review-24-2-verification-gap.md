# Review 24.2 — Verification gap

Lens: for each acceptance criterion, boundary rule, matrix row and database
guard, which test would fail if the rule were broken? Change reviewed:
`git diff 6b8876a 1819622 -- zobba` against
`spec-24-2-show-exact-population-sample-and-coverage-denominators.md`.
Method: reading code and tests, with mutations done in the head (nothing run,
nothing edited; `git status` clean afterwards).

**Counts: 5 High · 7 Medium · 7 Low.**

## What is well verified

- **AC1/AC2 numbers are independent.** `fixtures/documents/generate.py`
  `ap_population_expected()` computes every count from its own rows in Python.
  `crates/worker/tests/coverage.rs` reads `AP population expected.json` (and
  also uses literal tuples for the population rows). The domain tests
  (`coverage/tests.rs:228,266`) build the same set in Rust and assert literals.
  The 20 failing subjects and 27 failing opportunities are asserted as two
  separate numbers in domain, end-to-end, API and browser tests.
- **Pins.** `published.rs` pins 0001–0018 and v1–v18. I recomputed the 0018 and
  v18 digests and they match. `citation.rs` pin tests tie 0019 to the current
  `DOCUMENT_PROGRAM` and keep 0016's pin.
- **Immutability.** UPDATE, DELETE and TRUNCATE are refused, with their exact
  messages, on all six tables. This is checked for the admin and the runtime
  pool, and inside a reset transaction. TRUNCATE under the reset is shown in a
  transaction that is rolled back.
- **The pure functions.** `summarise` gives the same digest twice. The
  conclusion table has 13 rows, and their inputs are written out by hand. The
  four completeness branches are tested, and so are the SplitMix64 reference
  vectors.

## High

### H1 — No statement-level batch guard rule has a negative test
- **Rule:** `coverage_batch()` at `migrations/0019_assessment_coverage.sql:446-532` holds ten set-based rules:
  - a member is a received row of its own Task's population;
  - a duplicate collapses into the first row of its subject;
  - a selected item is an in-scope member;
  - an opportunity reads a criterion of its population's basis;
  - an opportunity is one in-scope member;
  - an unverified authority cannot yield met or not met;
  - a judgment criterion is decided only by its recorded judgment;
  - a rule opportunity reads only its member's own cells;
  - a judgment opportunity is the recorded judgment;
  - a decided verdict reads its facts.
- **Why a regression is invisible:** none of these ten messages occurs in any
  test (`grep` over `crates/` and `web/`). Two message texts also appear in the
  24.1 tests (`worker/tests/assessment.rs`, `application/src/assessment/tests.rs`),
  but those tests exercise the 0018 evaluation guard, not this one. The only
  coverage is positive: valid batches from the runtime pool. Any rule could be
  weakened to `false`, or its `EXISTS` inverted for the zero-match case, and the
  suite would stay green. No test sends a multi-row INSERT in which exactly one
  row is bad, so a guard that checked only the first or last row of `added`
  would pass. No refusal is attempted as the migration owner, under RLS with
  scope GUCs set.
- **Test to add:** in `database_guards_refuse_altered_coverage_records`, add
  one case per rule. Each case is an `INSERT ... SELECT` that copies several
  stored rows under new keys and alters exactly one row in one field. Examples:
  a member with `ordinal >= received_rows`; `duplicate_of` pointing at a
  `conflicting_duplicate` row; a sample member whose member is `excluded`; an
  opportunity whose member is `excluded`; an opportunity whose criterion is not
  in the basis; `origin='deterministic'` with an input id of another member or
  another digest; a judgment criterion with a deterministic `met`; `met` with
  `inputs=[]`. Assert each refusal message exactly. Run the cases once as the
  admin and once as the owner or runtime role with `zobba.*` scope set, so the
  trigger (not RLS) is what refuses. Positive control: the same multi-row copy
  with no row altered reaches only the primary key.

### H2 — The summary recount is tested for only 3 of its 15 column counts and none of its per-criterion fields; the conclusion CASE has one forgery
- **Rule:** `coverage_guard()` at `0019:338-348` recounts these columns:
  received_rows, unkeyed, duplicate_rows, distinct_subjects,
  excluded_out_of_period, the three scope_unknown counts, in_scope and
  selected. At `:384-391` it recounts, per criterion: applicable, not_applicable,
  applicability_unknown, met, not_met, undetermined, execution_failed,
  not_evaluated, undetermined_by_reason and criterion order. At `:416-420` it
  recounts the subject partition. At `:423-432` it derives the conclusion.
- **What is tested:** `worker/tests/coverage.rs:1350-1377` forges
  `failing_subjects` (changed together with meets), `in_scope` (changed together
  with not_applicable_to_any), `failing_opportunities`, and one conclusion
  (`exceptions_found` instead of `exceptions_found_inconclusive`).
- **Why a regression is invisible:** delete any other `IF recount.x <> NEW.x`
  line and no test fails. The `selected` check and the whole per-criterion loop
  are among these. The CHECK constraints do not take over: the forged values
  can satisfy `failing + meets + unresolved + na = coalesce(selected, in_scope)`.
  The conclusion CASE is never tested on these branches:
  - `no_exception_found` for a complete population (no stored summary reaches it);
  - "a sample never concludes `no_exception_found`" (the end-to-end sample has
    failing = 1, so the `sample_id IS NULL` term can be removed);
  - scope-unknown subjects counting as unresolved (the end-to-end populations
    have zero scope unknown);
  - `inconclusive`;
  - the `count(*) < criteria` term (a member missing an opportunity).

  The spec asks for "the SQL recount refusing a forged summary for each counted
  field separately". That is not met.
- **Test to add:**
  - One `forged_summary` case per count column, each keeping the CHECKs true
    (for example, received_rows+1 with a document change; unkeyed+1 balanced by
    a duplicate change). Each case asserts its own message.
  - One case per criterion field (`jsonb_set` on `summary,criteria,0,met`, and
    so on), asserting `criterion <id>`.
  - Conclusion forgeries on a sample summary
    (`no_exception_found` → `concludes … : inconclusive`).
  - A complete clean population: a small sheet, or a population built only
    from the 960 rows that meet every criterion. This reaches
    `no_exception_found` positively.
  - The Edge sheet (scope unknown > 0), to prove `inconclusive`.

### H3 — The row guards, the deferred count guard and the derived-completeness CHECKs are never refused in a test
- **Rule:** `coverage_guard()` at `0019:287-324` has nine refusals:
  - invocation and binding custody;
  - population basis in its own Task;
  - successor in its own Task;
  - original registered by its digest;
  - enumeration job collected over the exact original, in enumerate mode;
  - sample from a population of its own Task;
  - summary of its own population and basis;
  - summary sample of its population;
  - summary states its population's completeness.

  In addition, `coverage_complete()` at `0019:542-570` (deferred) requires that
  a population holds exactly its counted members and a sample exactly its
  selected items. The population CHECKs at `0019:44-58` make completeness,
  reason and reconciliation derived, with `received_rows = rows_read`.
- **Why a regression is invisible:** no message from this list appears in any
  test. Examples of weakening that would pass every test:
  - accepting `completeness='complete'` with `exhaustive=false`;
  - accepting a population with fewer stored members than it counts;
  - accepting a summary whose completeness differs from its population.

  "Completeness never claimed without proof" is therefore proven only in Rust
  (`coverage/tests.rs:336-430`), never at the database layer, which is the layer
  the spec trusts last.
- **Test to add:** forged `INSERT ... SELECT` copies, each changing one field:
  - population: `exhaustive=false` while still complete;
    `rows_read <> last_row-header_row`; `declared_count` changed;
    `job_id` set to a render job's ID; `original_sha256` of another version;
    `basis_id` of another Task;
  - summary: `completeness_reason` changed;
  - deferred guard: in one transaction, insert a population with one member
    fewer and assert the refusal at `COMMIT`; do the same for a sample
    (`size` + 1).

### H4 — Viewer withholding and current authority are untested at the route level, on both the work view and the members route
- **Rule:**
  - Work view: `api/src/coverage.rs:343-365` withholds sample keys and
    substitutions (`keys_withheld`) unless the viewer may read the exact
    original now.
  - Members route: `api/src/coverage.rs:665-678` sets `values_withheld` from
    `viewer_originals` and gates subject and cell texts through `member(...,
    shown)`.
  - Members route: `Ok(None) → Denied` for a population this Task does not
    hold, plus the session fence (commit `be9f411`, `admission_fence` in
    `infrastructure/src/assessment.rs`).
- **Why a regression is invisible:** the only negative test is a unit test of
  the pure `member()` with `shown=false` (`api/src/coverage/tests.rs:131`). The
  route's own computation (`let shown = readable(&originals, &page.population)`)
  can be replaced by `true`. In the same way, `keys_withheld: !shown` and
  `keys: if shown {…}` in `sample()` can be made unconditional. The end-to-end
  test asserts only `values_withheld == false` for an auditor who can read the
  source (`worker/tests/coverage.rs:1079`). The fixture equality pins only that
  positive JSON. No test calls the members route:
  - with another Task's population ID;
  - as a viewer without engagement assignment;
  - after revocation;
  - with a changed `X-Expected-Session`.
- **Test to add:** in the worker end-to-end test, after the positive reads:
  1. Revoke the auditor's evidence-original read, or register the population
     under an original the viewer cannot open. Then GET the work view and
     assert `samples[0].keys_withheld == true`, `keys == []`,
     `substitutions == []`, `filename == null`, and that no `INV-` text
     appears anywhere in the body.
  2. GET members and assert `values_withheld == true`, every `subject == null`,
     every `cells[].text == null`, and `total` unchanged.
  3. GET members for a population ID of another Task (403) and with a
     mismatched `X-Expected-Session` (412).

### H5 — Judgment criteria over a population, and the "changed grain" row, are untested where the rule actually lives
- **Rule:** `application/src/assessment/coverage.rs:952-970`
  (`judgments_at_unit`: model-proposal judgments whose facts are all at the
  population's subject unit, newest per subject) and `:1328-1367` (a judgment
  opportunity takes that judgment, else `not_evaluated`). On the database side,
  the judgment-opportunity rule is at `0019:516-526`.
- **Why a regression is invisible:**
  - Every application and end-to-end test uses rule criteria only.
  - The domain test (`coverage/tests.rs:604`) feeds `summarise` hand-made
    opportunities with `verdict: None`. It proves only that `summarise` counts
    `not_evaluated` and writes the limitation. It does not prove that trusted
    code withholds a judgment recorded at unit `invoice` from an `invoice_line`
    population.
  - Mutations that pass every test:
    - drop the `subject_unit == unit` filter;
    - drop the `origin == ModelProposal` filter;
    - pick the oldest judgment instead of the newest.
  - The fixture `Lines` sheet, built for this matrix row, is never read
    (see M2).
- **Test to add:** in `application/src/assessment/tests.rs`, set up a judgment
  criterion in the basis, with 24.1 judgments recorded for subjects at unit
  `invoice`. Then:
  - A population at unit `invoice` gives opportunities carrying those exact
    judgments (`evaluation_id`, digest, verdict).
  - A second population at unit `invoice_line` (the `Lines` sheet, grain
    `[Invoice, Line]`) gives every opportunity `not_evaluated`, and the summary
    limitation says why.
  - Two judgments for one subject: the newest is used.
  - End to end: the same flow, so the database judgment-opportunity guard is
    exercised positively.

## Medium

- **M1 — Reclaim suffixed-key retries are untested.** `application/src/reading.rs:1185-1206`
  retries a `Conflict` on a `…-p` key under `…-p1` up to `…-p8`; for any other
  key it returns the conflict. No test calls this path. Three mutations would
  pass every test:
  - removing the branch, so a reclaimed population read fails as a conflict and
    no manifest is recorded;
  - removing the `ends_with(POPULATION_KEY)` guard, so non-population
    conflicts become silent retries;
  - removing the bound.

  Add: a stub `AnalysisPort` that answers `Conflict` for the bare key, and for
  `-p1`..`-pN`. Assert that admission succeeds at `-p(N+1)`, that the error is
  surfaced after `-p8`, and that a non-population key surfaces the conflict at
  once.
- **M2 — The fixture's Edge and Lines sheets are generated but never read.** In
  `generate.py`, the `edge` and `lines` sheets cover:
  - conflicting duplicate `000123`;
  - `31/02/2026` under `date_dmy`;
  - a blank period;
  - an unkeyed row;
  - the invoice-line grain.

  No Rust, Python or browser test names them. These matrix rows are therefore
  proven only on hand-built `Enumeration` values in the domain. They never go
  through `document.py` enumerate → `enumeration_manifest` → `build_members` →
  the database batch and count guards → the members route
  (`disposition=scope_unknown`). Add an end-to-end turn proposing the Edge
  sheet and assert the stored dispositions and reasons: 2 ×
  conflicting_duplicate, 1 × period_unparsed, 1 × period_missing, 1 × unkeyed,
  1 × in_scope. Also assert that the summary conclusion is `inconclusive` (this
  closes part of H2), and that the members route returns the key `000123`
  exactly.
- **M3 — A workbook population with no enumeration job is accepted by the
  database.**
  - **The defect:** `0019:300-308` checks the job only
    `IF NEW.job_id IS NOT NULL`. Nothing ties `job_id IS NULL` (CSV or plain
    text read in process) to the original's media type, so a forged xlsx
    population with `job_id` NULL passes. The enumerate-mode check
    (`position('"mode":"enumerate"' …)`) is also never tested negatively; a
    render job's ID would be the natural forgery.
  - **Fix and tests:** fix the guard by requiring `job_id` exactly when the
    original's media type is a workbook. Then test both forgeries.
- **M4 — Admission of the replaced document program is untested at the
  database.** `0019:607-627` now admits two pinned programs. The pin tests
  check only that the hashes appear in the migration text. No database test
  shows:
  - that a document-environment job with an altered program (an appended line,
    or a tail that does not match the regex) is refused;
  - that a job running the 22.5 program is still admitted;
  - that a render naming an enumeration job behaves as intended.

  Add these three INSERT cases.
- **M5 — Sample refusals beyond the seeded mismatch are untested.** In
  `domain/src/coverage.rs:957-1000`, no test reaches
  `SampleRefusal::SizeMismatch` (`all_in_scope` with the wrong size) or any of
  the four `Substitution` branches:
  - replaced not in scope;
  - substitute not among the keys;
  - replaced still among the keys;
  - replaced not in the recomputed selection.

  For `judgmental` samples there is no recomputation, so these checks are the
  only guard. In the application test
  (`a_seeded_sample_is_recomputed_and_a_wrong_selection_refused`), the refusal
  feedback text is not asserted either. Add one case per refusal, and assert
  the feedback in words.
- **M6 — Web parser cases that break two rules, and rules with no case.**
  - In `web/tests/coverage.test.mjs:67`, *'complete without the exhaustive
    statement'* trips both `complete && !exhaustive` and
    `!exhaustive && reason !== 'not_exhaustive'` (`web/src/coverage.ts:94-100`).
    Removing either rule keeps the case green.
  - In `:70`, *'a seeded sample without its seed'* trips both the method/seed
    rule and the seed/algorithm rule (`coverage.ts:129-134`).
  - Rules with no case at all:
    - `no_eligible_items` with nonzero failing, meets or unresolved, or on an
      incomplete population;
    - complete with `truncated: true`;
    - a period column without a rule;
    - an empty grain;
    - the counts rule `distinct_subjects > received - unkeyed - duplicates`;
    - summary completeness/reason pair;
    - `reconciliation: 'not_declared'` with a declared count;
    - member `duplicate_row` without `duplicate_of`;
    - unkeyed with a subject when not withheld;
    - a malformed `next_cursor`;
    - a selected count that does not match the sample size on a summary.

  Split the two cases so each breaks exactly one rule, and add one case per
  missing rule.
- **M7 — Accessibility and "words, not blanks" are only partly proven in the
  browser.**
  - `web/tests/browser/coverage.spec.ts` runs no axe scan; it only computes
    contrast by hand. It samples the first four elements per selector and
    ignores alpha compositing.
  - "At least N found" is asserted only for the zero-row `filtered` population.
    The `cover` population (incomplete `count_mismatch`, 1,256 rows) is never
    asserted to read "at least 1,256 rows found" / "the total is not known". A
    renderer that wrote "at least" only for zero counts would pass.

  Add an axe WCAG 2.2 AA scan of the Coverage region (open and closed member
  lists), and an assertion on the cover population's lines.

## Low

- **L1** — `worker/tests/coverage.rs` asserts the sample summary only with
  `assert_ne!(rows[3].0, "no_exception_found")`. This is trivially true because
  failing = 1. Assert the exact conclusion and the partition, from an
  independent computation over the selected keys.
- **L2** — The positive control `forged_summary(&[])` (`:1379`) asserts only
  that the message lacks "a summary count". A CHECK failure in the copy would
  also pass. Assert the unique violation (SQLSTATE 23505, constraint name).
- **L3** — Owner immutability passes because forced RLS hides every row
  (0 rows affected), not because the trigger refuses. Also untested: DELETE
  under the fixture reset (permitted by `coverage_immutable`), and that the
  reset setting is ignored outside a `*_test` database.
- **L4** — `catalog-signature.sql` `LIMIT` and `lib.rs:1710` were raised from
  4,097 to 8,193 (v19 is 4,367 lines). No test proves that the overflow refusal
  still fires at the new bound.
- **L5** — `domain/src/citation/tests.rs`
  `coverage_answer_bounds_drop_and_count_every_entry_over_them`: the summary
  entry "not an id" is the fourth of four and is dropped by the bound, so its
  invalidity is never tested on its own. Discards for
  `propose_population`/`propose_sample` over the bound (≤1) are not asserted
  there.
- **L6** — The end-to-end per-criterion check compares only applicable, met,
  not_met and undetermined. `not_applicable`, `applicability_unknown`,
  `execution_failed` and `not_evaluated` are not compared, and neither is
  `total_samples`. The coverage totals (4) equal the list lengths, so a total
  taken from `len()` would pass. Add a Task with more than
  `MAX_OUTLINE_COVERAGE` records, or lower the bound in a test.
- **L7** — The end-to-end sample keys come from `seeded_selection` in the code
  under test. The domain's "independently computed with Python" vector
  (`coverage/tests.rs:722`) is one 3-of-10 case, and no script that produced it
  is committed. Commit the generator (as `make-*-golden.py` precedents do), and
  add a 25-of-1,200 vector matching the end-to-end sample.
