---
title: '24.2 — Show exact population, sample and coverage denominators'
type: 'feature'
created: '2026-10-15'
status: 'review'
baseline_commit: '0400e7a35a52d7723e3950bf004f2b954daa67ff'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/spec-24-1-bind-typed-criteria-and-facts-to-an-assessment-basis.md'
  - '{project-root}/_bmad-output/planning-artifacts/zobba-product-architecture-2026-09-30/Zobba-Product-and-Architecture-Design.md'
  - '{project-root}/zobba/README.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** 24.1 pins a basis to population *references* (`PopulationReference{original_id, unit, selection}`, `domain/src/assessment.rs:1112`) and evaluates at most 64 subjects per request from agent-recorded facts (≤1,024 per basis). Nothing says how many records a source holds, which were deduplicated, excluded or never resolved, which were sampled, or how many criterion opportunities were met, failed or stayed unknown. A summary today could only count a bounded page, which can read as a clean population.

**Approach:** The agent keeps deciding what to read and how to scope the work. When it has found the population source, it proposes a *population manifest* (which registered original, sheet, header row, grain columns, period column, typed value columns, whether the source is exhaustive) and, if it samples, a *sample manifest*. Trusted code — not the model — reads every row of the exact original through the trusted document program in the 22.4 sandbox, builds the manifest, evaluates rule criteria over every in-scope member with the 24.1 pure `evaluate`, and computes an immutable coverage summary with a pure Rust function. The database re-checks the summary counts with exact SQL aggregates over the stored member and opportunity rows. Anything not proven is said in words; an unknown count is never shown as zero or as a number.

## Boundaries & Constraints

**Always:**
- **Population manifest version** (Task/basis-scoped, immutable, successor-linked): basis ID; original ID + SHA-256 (exact current registration, read under the claim's scope); locator scope (`sheet` + 1-based `header_row` for xlsx; whole file for CSV/plain text); subject unit; grain = 1–3 named columns (key = exact cell texts joined, leading zeros kept, ≤128 bytes); optional period column + 24.1 `ParseRule`; ≤8 typed value columns `{header, fact name, FactType, ParseRule, measure | currency column}`; `exhaustive` as the agent declares it (a search export or filtered view is `false`); optional declared control count = a 22.5 citation verified at its locator and parsed `decimal_grouped_comma`/`decimal_plain` with scale 0; selection text; proposing invocation.
- **Trusted enumeration**: new document-program mode `enumerate` (`reading/document.py`) reads the header row and every following row to the sheet's last row (openpyxl values only, `cell_texts` display text, as `locate`), emitting row number + bounded texts of the named columns, `rows_read`, `last_row`, `truncated`. Bounds: `MAX_POPULATION_ROWS` 20,000, `MAX_POPULATION_COLUMNS` 12 (grain + period + values + currency), 256 bytes per cell text; output via a new `ENUMERATE_LIMITS` inside the owner `CEILING`. CSV/plain text is read in process (RFC 4180, UTF-8 only). A failed/limited job, unreadable original, missing header or header text not matching exactly → no manifest, feedback in words; nothing is fabricated.
- **Member dispositions** (one row per received row, one grain): `in_scope`; `excluded{out_of_period}`; `scope_unknown{period_unparsed | period_missing | conflicting_duplicate}`; `duplicate_row{first ordinal}` (all named cells byte-identical to an earlier row; collapsed, counted); `unkeyed` (blank grain cell). A key seen twice with any differing named cell makes every row of that key `conflicting_duplicate`. Typed cells are re-parsed by trusted code under the declared rule; a cell that does not parse is `unsupported{type_mismatch}` and stays visible.
- **Completeness** (closed, derived, never asserted by the model): `complete` only when `exhaustive` is true, `truncated` is false, `rows_read == last_row - header_row`, and the declared control count (if given) equals distinct subjects. Otherwise `incomplete{not_exhaustive | row_bound | count_mismatch}`; `reconciliation` is `matched | mismatch{declared, distinct} | not_declared`.
- **Population evaluation**: new answer field `evaluate_population: [{criterion, population}]` (≤4). For each rule criterion trusted code builds 24.1 `InputFact`s from the member's typed cells (source = `cell:Sheet!<col><row>` of the same exact original, verified by the enumeration read itself; subject grounded by the same row; measure grounded only by a declared currency/unit column in the same row, else `unit_unverified`) and calls `domain::assessment::evaluate` for every `in_scope` member. One immutable opportunity row per (population, criterion, member) with the 24.1 applicability/execution/verdict/reason/origin and the canonical output digest. Judgment criteria are not bulk-evaluated: their opportunities use the newest 24.1 judgment for that subject at the manifest's subject unit, else `not_evaluated`.
- **Sample manifest version**: population ID; method closed `all_in_scope | judgmental | seeded_random{seed u64, algorithm "splitmix64-fisher-yates-v1"}`; size; strata text; justification; selected subject keys; substitutions `{replaced, substitute, reason}`. Trusted code checks every key is an `in_scope` member and, for `seeded_random`, recomputes the selection over the C-ordered in-scope keys (in-house SplitMix64, no crate) and refuses a mismatch. `statistical_inference` is always false in 24.2; a sample summary covers the selected items only.
- **Coverage summary version** (new answer field `summarise: [{basis, population, sample?}]`, ≤2): pure `domain::coverage::summarise(manifest, members, opportunities, criteria) -> Summary`, canonical digest, aggregation rule `subject_partition_v1`. Exact counts: received rows, unkeyed, duplicate rows collapsed, distinct subjects, excluded by reason, scope unknown by reason, in scope (or selected); per criterion: applicable / not applicable / applicability unknown, and among applicable: met / not met / undetermined (by reason) / execution failed / not evaluated, failing opportunities; subject partition over in-scope (or selected) subjects, one grain: `failing` (≥1 not met) / `meets_every_applicable` / `unresolved` (no not met, ≥1 unknown, undetermined, failed or not evaluated) / `not_applicable_to_any`; total failing opportunities. Conclusion (closed): `no_eligible_items` (complete, zero applicable) · `exceptions_found` · `exceptions_found_inconclusive` (failing and unresolved, or incomplete) · `no_exception_found` (complete, not a sample, ≥1 applicable, zero failing, zero unresolved, zero scope unknown) · `inconclusive` · `no_items_found_absence_not_proven` (incomplete, zero received rows). A sample never yields `no_exception_found` for the population; its conclusion names "selected items".
- **Words, not blanks**: when incomplete, every population-level count is shown as "at least N found" and the unknown total as "not known"; no percentages in 24.2 (counts with their denominator unit only); zero applicable shows "No eligible items; operating effectiveness was not demonstrated."
- **Migration 0019 `assessment_coverage.sql`** (additive; 0001–0018 and catalogues v1–v18 byte-unchanged): `assessment_populations`, `assessment_population_members`, `assessment_samples`, `assessment_sample_members`, `assessment_opportunities`, `assessment_summaries`. Immutable (UPDATE/DELETE refused, TRUNCATE only under `zobba.disposable_fixture_reset=on` in a `*_test` database, as 0018); forced RLS; runtime SELECT/INSERT; insert guard (claim custody, same Task/basis, bounds, closed vocabularies) and a summary guard that recomputes every summary count with exact `count(*)` aggregates over the stored members/opportunities and refuses any disagreement or a conclusion its counts do not allow. `SCHEMA_VERSION` 19, `schema-v19.catalog`, inventory lists and grants.
- **API/Web**: `TaskWorkResponse.assessment` gains bounded populations, samples and summaries (exact totals beside them); new GET `/tasks/{task}/assessment/populations/{id}/members?disposition=&cursor=` — exact count plus a C-ordered 50-row cursor page, current viewer authority, cell values withheld unless the viewer may read the original now (24.1 `value_withheld`). Panel "Coverage": population line, completeness and reconciliation in words, exclusions inspectable by reason, per-criterion table, subject partition, conclusion sentence; WCAG 2.2 AA.

**Ask First:** Any new crate (xlsx, CSV, RNG, statistics); raising `MAX_POPULATION_ROWS` or the job ceiling; any statistical inference or projection; percentages; Admin-defined coverage/no-activity dispositions; any live provider run.

**Never:** A count taken from a bounded page or list length; an unknown count shown as 0 or as a blank; a model-written count, manifest member, disposition or rule verdict; treating missing, unsupported, unevaluated or scope-unknown as met; summing failing opportunities across criteria and calling them failing records; extrapolating a sample; "no exception found" on an incomplete population, a sample, or zero applicable; editing a stored record; a compiled step pipeline; numeric confidence; live provider calls in tests.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| AC1 period and applicability | `AP population.xlsx`: 1,256 rows, 6 exact duplicate rows, 1,250 subjects; 50 dated outside the basis period; criterion "amount > 1,000.00 USD" | 6 `duplicate_row`, 50 `excluded out_of_period`, 1,200 in scope; per criterion 200 not applicable, 1,000 applicable; each exclusion listed by reason via the members endpoint | N/A |
| AC2 overlap | criteria A (approver recorded) and B (approved on or before paid) over the 1,000: A 15 not met, B 12 not met, 7 subjects fail both; 20 other subjects undetermined in at least one | failing subjects 20, failing opportunities 27, meets every applicable 960, unresolved 20; conclusion `exceptions_found_inconclusive` | N/A |
| Zero applicable | complete population, every amount ≤ 1,000.00 | not applicable to any = in scope; "No eligible items; operating effectiveness was not demonstrated." | no pass |
| Non-exhaustive search | agent declares a filtered export `exhaustive:false`, 0 rows | `no_items_found_absence_not_proven`; counts "at least 0 found", total "not known" | no pass |
| Row bound | 20,001 data rows (test bound lowered in unit tests) | `incomplete row_bound`; counts are "at least"; never `no_exception_found` | N/A |
| Control count mismatch | cited "Invoices: 1,251", 1,250 distinct | `incomplete count_mismatch`, reconciliation `mismatch 1,251 / 1,250` | N/A |
| Conflicting duplicate | key `000123` twice, amounts differ | both rows `scope_unknown conflicting_duplicate`; subject counts as unresolved, key kept exactly | N/A |
| Unparsed period | date cell `31/02/2026` under `date_dmy` | `scope_unknown period_unparsed`; not excluded, not in scope | N/A |
| Changed grain | second manifest on invoice lines (`unit` invoice_line, grain [invoice, line]) | a new manifest version; its summary stands alone; 24.1 judgments at unit `invoice` are not counted (`not_evaluated`) and a limitation says why | N/A |
| Header mismatch | header `Amount ` vs declared `Amount` | no manifest; feedback names the column | nothing recorded |
| Seeded sample | `seeded_random{seed 42}`, size 25, keys from the agent | recomputed and equal → recorded; summary over 25 selected items, "selected items only" | mismatch refused with feedback |
| Forged summary | INSERT of a summary whose counts differ from the stored rows | database refuses | message names the count |
| Enumeration failure | sandbox job failed or original unreadable | no manifest; feedback; a retry is a new request | job ID kept in feedback |

</frozen-after-approval>

## Code Map

- `zobba/crates/domain/src/assessment.rs:1112-1165` -- `PopulationReference`/`ProposedBasis` (keep; manifests reference the basis). `:1244-1300` `InputFact`, `EvaluationContext`, `Outcome::is_valid`; `:1456` `prepare`, `:1574` `evaluate`, `:1666` `output_digest` (reuse unchanged for bulk opportunities). `:24-55` bounds, `:69-192` vocabularies to copy; `:1791` `answer_fields`, `:2000-2126` decoders (add the three new fields' decoders here or in the new module).
- New `zobba/crates/domain/src/coverage.rs` (+ `coverage/tests.rs`, `lib.rs` module, `SCHEMA_VERSION` 19 at `lib.rs:23`) -- manifest/sample/summary types, dispositions, completeness, SplitMix64 selection, pure `summarise`, canonical digest.
- `zobba/crates/domain/src/citation.rs:348-481` -- `CitedAnswer` assessment fields and bounds; add `propose_population` (≤1), `propose_sample` (≤1), `evaluate_population` (≤4), `summarise` (≤2); older answers decode with unchanged bytes and schema digests.
- `zobba/crates/application/src/reading/document.py:360-404,515-522` -- `locate_xlsx`/`main`; add `enumerate` mode reusing `cell_texts`, `parse_ref`, `bounded`. `zobba/crates/application/src/reading.rs:717` `locate_request` (add `enumerate_request`), `:1122` `document_job`, `:2113` `locate` impl (pattern for the new `enumerate` read), `:764` bounded `manifest` JSON parser.
- `zobba/crates/application/src/citation.rs:48-110` -- `CitationReader`; add a defaulted `enumerate` method (as `byte_context`) so existing readers compile; CSV/plain text read in process from the exact object.
- `zobba/crates/application/src/assessment.rs:225-300` `AssessmentStore` (add population/sample/opportunity/summary writers and exact readers), `:1403-2058` `after_answer` (order: criteria → basis → facts → population → sample → evaluate → evaluate_population → judgments → summarise), `:66` `ASSESSMENT_CONSTRAINTS` (one added paragraph), `:2219` `outline` (exact counts per population/summary).
- `zobba/crates/infrastructure/src/assessment.rs:581-687` -- repository/snapshot pattern under claim custody; add writers, batch insert of members/opportunities in one transaction, exact counts, cursor page.
- `zobba/migrations/0018_assessment_basis.sql:13-385` -- table, `assessment_guard` (advisory lock `:266`), immutability/retained triggers (`:372-373`) to mirror in `0019_assessment_coverage.sql`.
- `zobba/crates/infrastructure/src/lib.rs:124,131,154,233,496-510,563,567-569,597-602,1578,1623,1821` -- inventory lists, function checks, catalogue chain (`schema-v19.catalog`), runtime grants. `zobba/crates/infrastructure/tests/published.rs` -- pin 0018 and v18 digests.
- `zobba/crates/worker/src/work.rs:284-289` -- composes `Assessment` with the reading reader (enumeration comes through it). `zobba/crates/worker/tests/assessment.rs` -- end-to-end pattern.
- `zobba/crates/api/src/work.rs:219-224,436-452,671-760` -- `TaskWorkResponse.assessment`, `assessment_originals`, value withholding; new members route beside it. `openapi.json`, `web/src/generated/api.ts`.
- `zobba/web/src/AssessmentBasis.tsx`, `web/src/assessment.ts` -- add `Coverage.tsx` and strict parsing; `web/tests/browser/assessment.spec.ts` pattern.
- `zobba/fixtures/documents/generate.py:67,273` -- add `ap_population()` → `AP population.xlsx` and small edge workbooks; deterministic, with an `expected` JSON of every count.

## Tasks & Acceptance

**Execution:**
- [x] `zobba/crates/domain/src/coverage.rs` (+ tests, `lib.rs`) -- types, dispositions, completeness, sample recomputation, `summarise`, digests; set arithmetic tests for every matrix row, duplicates, partial history, changed grain, zero population, sample limitation; summary recomputed twice gives the same digest.
- [x] `zobba/crates/domain/src/citation.rs` -- four answer fields, bounds, schema, old-answer decode and schema digests unchanged.
- [x] `zobba/crates/application/src/reading/document.py` + `reading.rs` -- `enumerate` mode and request, `ENUMERATE_LIMITS`, output parsing; Python unit over the fixture workbooks.
- [x] `zobba/crates/application/src/citation.rs` -- defaulted `enumerate` read; in-process CSV/plain text.
- [x] `zobba/crates/application/src/assessment.rs` (+ tests) -- build manifest, verify control count, record sample, bulk evaluate, summarise, feedback in the untrusted envelope, outline counts.
- [x] `zobba/migrations/0019_assessment_coverage.sql`, `infrastructure/src/assessment.rs`, `schema-v19.catalog`, `lib.rs` lists/grants, `published.rs` -- tables, guards (including the recomputing summary guard), immutability; PostgreSQL tests for refusals, RLS, forged counts and the reset exception.
- [x] `zobba/crates/worker/tests/assessment.rs` -- synthetic-model end-to-end over `AP population.xlsx`: AC1 and AC2 numbers, zero-applicable and non-exhaustive cases.
- [x] `zobba/crates/api/src/work.rs`, members route, `openapi.json`, generated client -- bounded view, exact totals, cursor page, withholding.
- [x] `zobba/web/src/Coverage.tsx`, `assessment.ts` (+ unit, browser case with contrast) -- read-only display in words.
- [x] `zobba/fixtures/documents/generate.py` and outputs; `zobba/README.md` -- what is proven offline.

**Acceptance Criteria:**
- Given a stored summary, when its member and opportunity rows are re-counted with SQL, then every count and the conclusion agree, and a forged summary is refused at insert.
- Given the same manifest and opportunities, when `summarise` runs twice, then both outputs have the same canonical digest.
- Given an incomplete population, a sample or zero applicable subjects, when the summary is shown, then no view says "no exception found" or a pass, and every unknown is a sentence, not a number or a blank.
- Given any 0019 record, when UPDATE or DELETE is attempted outside the fixture reset, then the database refuses it.

## Design Notes

Two grains, never mixed. Rows are received; subjects are resolved from rows by the grain; opportunities are subject × criterion. Failing *opportunities* (27) and failing *subjects* (20) are two separately named numbers.

```text
AP population.xlsx  rows 1,256 → subjects 1,250 (6 duplicate rows collapsed)
  excluded out_of_period 50 · in scope 1,200
  A approver recorded:   applicable 1,000 · not applicable 200 · met 975 · not met 15 · undetermined 10
  B approved before paid: applicable 1,000 · not applicable 200 · met 978 · not met 12 · undetermined 10
  subjects: failing 20 · meet every applicable 960 · unresolved 20 · not applicable to any 200
  conclusion: Exceptions found; overall assessment inconclusive
```

The model never counts. It names *where* and *how* (sheet, grain, columns, exhaustive or not); trusted code reads every row and counts; PostgreSQL counts again. The enumeration read is itself the trusted read of the exact original digest, so member cells need no separate 22.5 verification per cell. `exhaustive` is the agent's statement and can only *lower* the conclusion: `true` still needs end-of-sheet and reconciliation proof; `false` always means absence not proven.

## Suggested Review Order

1. `zobba/crates/domain/src/coverage.rs` — dispositions, completeness, SplitMix64 selection, the pure `summarise` and its conclusion rule (tests in `coverage/tests.rs`).
2. `zobba/migrations/0019_assessment_coverage.sql` — the six immutable tables, the row guard (populations, samples, summaries), the statement-level `coverage_batch` guard, the summary recount and the `reading_guard` replacement that admits the new document program.
3. `zobba/crates/application/src/reading/document.py` (`enumerate` mode) and `reading.rs` (`enumeration_manifest`, `enumerate`, population read keys); `citation.rs` (`enumerate_text`).
4. `zobba/crates/application/src/assessment/coverage.rs` and the call order in `assessment.rs` `after_answer`.
5. `zobba/crates/infrastructure/src/assessment.rs` (CoverageStore, batch inserts, member page) and `lib.rs` (inventory, grants, schema 19).
6. `zobba/crates/worker/tests/coverage.rs` — the end-to-end proof and the forged-summary guard checks.
7. `zobba/crates/api/src/coverage.rs` (work-view parts, members route, withholding) and `zobba/web/src/coverage.ts`, `Coverage.tsx`, `tests/browser/coverage.spec.ts`.

## Verification

**Commands:**
- `cargo fmt --all --check && cargo clippy --workspace --all-targets -- -D warnings` -- expected: clean.
- `cargo test --workspace --locked -- --test-threads=1` on a guarded `_test` database -- expected: all pass.
- `pnpm --dir zobba/web check` and the coverage browser case -- expected: pass with accessibility and contrast checks.

## Open Questions (owner decisions)

**Owner decisions (2026-10-15):** all seven recommendations approved (A); kept as one story (K, the lead's recommendation, since the owner did not choose split): 1 trusted document-program enumeration; 2 new opportunities table reusing 24.1 `evaluate`; 3 counts only, no percentages; 4 in-house SplitMix64 + Fisher–Yates recomputed and verified; 5 20,000 rows × 12 columns, above that incomplete; 6 same key with different values → scope unknown, exact duplicates merged and counted; 7 database guard recounts with exact SQL.

Size: about 5,400 tokens (21.7 KB), over the 1,600 target (24.1 was larger and was kept). **[K] Keep** (recommended: manifest, opportunities and summary share one recomputing guard and one fixture, so splitting leaves an unverifiable half) or **[S] Split** — 24.2a population manifest + bulk opportunities + summary; 24.2b sample manifests.

1. **How the population is read.** (a) Recommended: the agent proposes the manifest spec; the trusted document program enumerates every row of the exact original and trusted Rust builds the manifest. (b) The agent's own 22.4 program writes a member list that trusted code accepts as a descendant — rejected by default, because no trusted code would have read the rows.
2. **Bulk rule evaluation.** (a) Recommended: trusted code evaluates rule criteria over every in-scope member into a new opportunities table, reusing 24.1 `evaluate`. (b) Only 24.1 per-subject evaluations count (cannot reach 1,000 subjects within the 1,024-fact basis bound).
3. **Percentages.** (a) Recommended: counts with denominator units only in 24.2. (b) Show percentages beside complete, known denominators.
4. **Seeded random samples.** (a) Recommended: in-house SplitMix64 + Fisher–Yates, recomputed and verified; no statistical inference anywhere. (b) Record the agent's selected keys and seed without recomputation.
5. **Row bound.** (a) Recommended: 20,000 rows × 12 columns per manifest; above it the population is explicitly `incomplete row_bound`. (b) Raise to 100,000 with chunked enumeration outputs (more sandbox time).
6. **Duplicate keys with different values.** (a) Recommended: every row of that key is `scope_unknown conflicting_duplicate`; byte-identical rows collapse and are counted. (b) Treat any repeated key as unknown, even identical rows.
7. **Summary guard.** (a) Recommended: the insert guard recomputes counts with exact SQL aggregates. (b) Store only the Rust digest and recompute in a test, not in the database.

## Review round 1 — progress (WIP checkpoint, 2026-10-15)

Checkpointed before rate limits; `cargo fmt` and `cargo check --workspace --all-targets` are clean. The long suites were NOT run at this checkpoint. Domain, application and api unit tests passed before the checkpoint, and so did the Python `test_document.py` (8 tests).

Done in code (tests named where they exist):
- **A** The summary recount uses `IS DISTINCT FROM` and `jsonb_typeof(...)='number'` for every count, including the new `met_unreviewed`. Every document CHECK is wrapped in `coalesce(..., false)`, and the nullable keys must be present (`?&`). No DB test yet.
- **B** Opportunities and summaries of one population share the advisory lock `coverage:<population>`. A summary is refused unless every basis criterion has exactly `in_scope` opportunities. An opportunity batch for a summarised population is refused. No DB test yet. Because of the first rule, the second one is reachable only after the primary key refuses the row.
- **C** `met_unreviewed` is counted per criterion. A `model_proposal` met blocks `no_exception_found` in Rust (`Unproven.unreviewed_met`) and in SQL. Closed limitation code `unreviewed_model_judgments` with its exact count. Domain tests are in. Spec Design Notes are NOT yet updated.
- **D** Unkeyed rows count as unresolved for a population summary, in Rust and SQL. Closed limitation `unkeyed_rows`. Domain test is in.
- **E** `enumerate_cell` reads typed Excel dates and date-times (`kind` excel_date/excel_datetime, with ISO, day-first and UTC instant forms). A zero-padded number format keeps its leading zeros. `data_end` ignores formatted empty rows. New fixture sheet `Dated` in `AP population.xlsx`, covered by Python tests. Rust parses the new cell shape: `CellKind`, `MemberCell.kind`, a `naive_date_times` count and the limitation `naive_date_times`. Document program re-pinned in 0019 (25140 bytes, 235ceba4…).
- **F** A ragged CSV record is refused (`EnumerationFailure::RaggedRecord`), with words that name the unquoted `1,250.00`. Trailing blank lines are ignored. An empty file says so. The unit test is NOT yet written.
- **G** The `-p1..-p8` ladder is removed. A population read reuses the newest document job of the Task with the exact program: a collected job's result is read again, an unfinished job is run on, and otherwise a fresh key `-p<count>` is used, so the reads never run out. New `ReadingStore::document_jobs`. The repeated-reclaim test is NOT yet written.
- **H** The application feedback (population line, summary line, opportunities line) says "at least … ; the total is not known" when incomplete. Rows and subjects are labelled by their unit. The web is NOT yet done.
- **I** CHECK `(job_id IS NULL) = (sheet is null)`. The population guard decodes the job's request literal and requires the same mode, original, sheet, header row and `columns` (the new population document key). The job must have no failure. The `reading_guard` DB test is NOT yet written.
- **K** L1: the measure is withheld with the values (api test). L2: the snapshot carries `referenced` populations for the samples and summaries (api test). L3: exact outline count. L4: the member page is C-ordered by key, then by ordinal (the cursor is still an ordinal). L6: the enumeration header row must equal the proposal's. L10: limitation `period_not_checked`.

Remaining:
- J: every DB negative test (batch rules with multi-row inserts as owner and superuser, each summary count, row guards, deferred counts, completeness CHECKs, conclusion branches including `no_exception_found`/`inconclusive`/scope-unknown/sample in the DB, viewer-withholding routes, judgment criteria and changed grain through `judgments_at_unit`, Edge/Lines/Dated sheets end to end, web parser cases, the axe scan).
- Web: regenerate `openapi.json` and the generated client (`cargo run -p zobba-cli --locked -- openapi`, `pnpm api:generate`), update the `coverage.ts` parser (structured limitations, `met_unreviewed`, `naive_date_times`, member cell `kind`, the counts rule now that a conflicting key holds ≥2 rows, the measure withheld) and `Coverage.tsx` ("at least" on every count when incomplete, the conflicting-duplicate unit). Regenerate `web/tests/fixtures/task-coverage.json` with `ZOBBA_UPDATE_COVERAGE_FIXTURE=1`.
- The worker e2e expectations need re-running after these changes. The schema-v19.catalog is regenerated.
- Spec Design Notes for C, the full "Review round 1" section and the refreshed Suggested Review Order.
