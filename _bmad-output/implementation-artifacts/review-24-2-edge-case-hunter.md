# Review 24.2 — Edge Case Hunter

Story: `spec-24-2-show-exact-population-sample-and-coverage-denominators.md`
Change reviewed: `git diff 6b8876a 1819622 -- zobba` (branch `codex/zobba-foundation-batch`).
Method: read-only branch and boundary walk of `document.py` (enumerate), `reading.rs`
(`enumeration_manifest`, `enumerate`, reclaim keys), `citation.rs` (`enumerate_text`),
`domain/src/coverage.rs`, `application/src/assessment/coverage.rs`, migration 0019,
`infrastructure/src/assessment.rs`, `api/src/coverage.rs`, `web/src/coverage.ts`,
`web/src/Coverage.tsx`. One scratch openpyxl experiment (outside the tree) confirmed
H1 and M2. The tree is unchanged.

Counts: **High 2 · Medium 5 · Low 16**

---

## High

### H1. A real Excel date cell never parses: every dated row becomes `scope_unknown period_unparsed`

- `zobba/crates/application/src/reading/document.py:339-340` (`cell_texts`), used by
  `enumerate_xlsx` at `:559`; `zobba/crates/domain/src/coverage.rs:481-486` (`parse_cell`),
  `:574-586`; `zobba/crates/domain/src/assessment.rs:424-431` (`parse_iso`), `:486-506`
  (`parse_rfc3339`).
- Input: an AP export whose "Invoice date" column holds real Excel dates (the normal
  case). openpyxl with `data_only=True` returns `datetime.datetime(2026, 3, 5, 0, 0)`
  (confirmed), so the texts are `["2026-03-05T00:00:00", "2026-03-05 00:00:00"]`.
  `date_iso` splits on `-` and refuses `05T00:00:00`; `date_dmy` refuses both;
  `instant_rfc3339` needs `Z` or an offset and refuses both.
- Wrong output: every keyed row is `scope_unknown period_unparsed`; in scope = 0; the
  conclusion is `inconclusive` for every real workbook. A date *value* column (AC2
  criterion B, "approved on or before paid") is `unsupported{type_mismatch}` on every
  row, so the criterion is `undetermined` everywhere. It fails closed (no false pass)
  but the feature does not work for the common input, and the matrix does not cover it.
- Why the tests pass: `fixtures/documents/generate.py:270,302,310-315` writes every date
  as a **text** string, so no test reads a typed date cell.
- Fix: in `cell_texts`, emit the date-only form first for a `datetime` with a zero
  time (`value.date().isoformat()`) and also for a `datetime.date`; keep the full
  ISO form as a later text. Add a typed-date sheet to the fixture and a Python and
  end-to-end case (period and a date value column).

### H2. Rows with data but no usable key are never evaluated and do not stop `no_exception_found`

- `zobba/crates/domain/src/coverage.rs:1093-1122` (`conclusion`), `:1124-1254`
  (`summarise`, no limitation for unkeyed rows); SQL twin
  `zobba/migrations/0019_assessment_coverage.sql:433-441`.
- Input: complete, exhaustive population; 1,000 keyed rows all met; 30 rows whose
  invoice cell is blank, whitespace-only, over 256 bytes, over the 128-byte key bound,
  or a merged (non-anchor) cell, while their amount/approval cells are filled (some
  would fail).
- Wrong output: `unkeyed` is counted but is not part of `unresolved` and blocks
  nothing, so the conclusion is `no_exception_found` / "No exception found." while 30
  received records were never assessed. This is the spec's "Never: treating …
  unevaluated … as met".
- Fix: add `counts.unkeyed` (for a population summary, not a sample) to the
  `unresolved` term of `conclusion` in both Rust and the SQL guard, or make any
  unkeyed row force `inconclusive`, and push a limitation ("N rows have no usable key;
  they were not assessed"). To keep genuinely blank trailing rows from blocking a
  pass, classify a row whose every named cell is blank separately (for example
  `blank_row`, or simply not received) — see M2.

---

## Medium

### M1. A numeric key loses its displayed leading zeros and format

- `document.py:312-330` (`number_text`), `:337-338`; key built from the first text in
  `coverage.rs:519-526`.
- Input: invoice number stored as the number `123` with number format `000000`
  (displayed `000123`). `number_text` returns `["123", "123"]`; the format is ignored.
- Wrong output: subject key `123`. The spec says "key = exact cell texts …, leading
  zeros kept"; a 24.1 judgment or fact recorded at the displayed key `000123` is not
  matched (`judgments_at_unit`, `assessment/coverage.rs:952-973`), so the judgment
  criterion stays `not_evaluated`; a control cited by key, a sample key or the
  members list shows a value the auditor does not see in Excel. `000123` (text) and
  `123` (number) rows in one sheet become two different subjects.
- Fix: for an integer cell whose format is all `0`s, add the zero-padded form as the
  first text (`str(whole).zfill(len(fmt))`); or record that a numeric grain cell was
  used and say so in the population line. Add a fixture row.

### M2. `sheet.max_row` counts styled or blank trailing rows

- `document.py:542` (`last_row = sheet.max_row`), `:552-553`, `:556-566`.
- Input: a sheet whose data ends at row 1,259 but whose cells are formatted (number
  format, fill, border) down to row 1,300, or to row 1,048,576. Confirmed: a formatted
  empty cell raises `max_row`.
- Wrong output: (a) 41 phantom received rows, each `unkeyed`; with H2 fixed they would
  also block the conclusion; (b) formatting to the sheet end makes `total` > 20,000, so
  the population is `incomplete row_bound` ("not every row could be read") although
  every data row was read.
- Fix: compute the last row as the last row with any non-empty value in any column
  (scan `sheet.iter_rows(values_only=True)` backwards, or track while reading), report
  both the styled and the data end, and treat an all-blank named-cell row after the
  last data row as not received. Add a fixture with styled trailing rows.

### M3. A conflicting-duplicate *subject* count is labelled as rows

- `web/src/Coverage.tsx:113` (`same key, different values {found(…conflicting…, 'row', …)}`);
  also `assessment/coverage.rs:886-917` (`population_line`: "{} with an unknown
  scope" adds period *rows* and conflicting *subjects*).
- Input: key `000123` twice with different amounts (matrix row "Conflicting
  duplicate").
- Wrong output: `scope_unknown_conflicting_duplicate` is 1 (distinct subjects,
  `PopulationCounts::of` `coverage.rs:810-815`, SQL `count(DISTINCT m.subject)`), the
  panel says "1 row", and the "Scope unknown" member list then shows 2 rows. The spec
  requires counts "with their denominator unit".
- Fix: label it with `p.subject_unit` ("1 invoice, 2 rows"), or expose the row count
  as well; in `population_line` say rows and subjects separately.

### M4. On an incomplete population the summary view shows bare numbers

- `web/src/Coverage.tsx:123-149` (criterion table `number(…)`, outcome list
  `number(…)`); `assessment/coverage.rs:919-941` (`summary_line` feedback likewise).
- Input: `not_exhaustive` or `row_bound` population with failing items.
- Wrong output: "Applies 1,000 · Met 975 · … · with at least one exception: 20" with
  no "at least … found" and no "total not known" beside them. Only the completeness
  sentence and the in-scope line carry the qualifier. The spec says "when incomplete,
  every population-level count is shown as 'at least N found' and the unknown total
  as 'not known'".
- Fix: when `completeness !== 'complete'` (population summaries), render every cell
  through `found(…, false)` or add a caption/column note "at least; the total is not
  known", and do the same in `summary_line`. Add a browser assertion for the
  incomplete summary.

### M5. A population read can be wedged after eight reclaims

- `zobba/crates/application/src/reading.rs` `run_job` (`MAX_POPULATION_READ_RETRIES = 8`,
  the `Err(AnalysisError::Conflict) if key.ends_with(POPULATION_KEY)` branch);
  `impl From<AnalysisError> for ReadingError` maps `Conflict` to `Unavailable`
  (`reading.rs:595-606`).
- Input: the same answer is reclaimed repeatedly (worker restarts, lease loss) before
  the population is recorded. The base key and each of `-p1 … -p8` already exist with
  an earlier operation expiry, so each admission is a `Conflict`.
- Wrong output: from the ninth reclaim on, `enumerate` returns `Unavailable` every
  time; the answer never records its population and the cycle retries forever. Each
  earlier reclaim also starts a fresh enumeration job (up to 300 s wall) instead of
  reusing a collected one.
- Fix: before admitting under a new suffix, look up the job already admitted under
  the key (or suffix) and reuse it when it is collected for the same request; on
  exhaustion return a definite feedback ("the population read could not be admitted;
  propose it again") rather than `Unavailable`, or derive the suffix from the claim
  epoch so it cannot run out.

---

## Low

- **L1. Instant periods use the UTC calendar date.** `coverage.rs:580-584`: an
  `instant_rfc3339` period of `2026-01-01T00:30:00+02:00` is 31 December in UTC, so a
  row at the period edge is `excluded out_of_period`. Say "UTC date" in the period
  limitation or compare in the instant's own offset.
- **L2. A formula cell without a cached value reads as blank.** `data_only=True`
  (`document.py:535`) gives `None` for a formula never calculated by Excel; the row
  becomes `unkeyed`, `period_missing` or a missing fact, i.e. "blank" for a cell that
  has content. Detect formulas (second, non-`data_only` load of the named columns or
  check `cell.data_type == 'f'`) and say "formula with no saved value".
- **L3. Merged cells.** Non-anchor cells of a merged grain range are `None` →
  `unkeyed` with no reason. Report merged ranges in the named columns, or propagate
  the anchor value only when the agent states it.
- **L4. CSV ragged records are silent.** `citation.rs` `enumerate_text`: a record with
  fewer fields than the header gives blank cells (`texts: Some(vec![])`); extra fields
  are ignored; a trailing empty line (`…\r\n\r\n`) becomes an `unkeyed` row. Refuse a
  record whose field count differs from the header (or flag it), and ignore a final
  empty record.
- **L5. CSV parse is unbounded before the row bound.** The whole ≤10 MiB file is
  split into `Vec<Vec<(String, usize, usize)>>` before `max_rows` applies; a file of
  commas allocates millions of fields in the worker. Stop after `max_rows + 1`
  records (count the rest) and cap fields per record.
- **L6. Plain text is parsed as CSV.** A plain-text line with a comma or a quote is
  split or refused as `unreadable`; the spec says plain text is "one column per line".
- **L7. An encrypted/legacy workbook with a sheet named reports `unsupported`.**
  `reading.rs` `enumerate`: non-`PK` bytes plus a sheet → `Unsupported`; the Python
  path would have said "encrypted_or_legacy". Detect OLE before the CSV branch.
- **L8. Empty CSV says "header mismatch".** `enumerate_text` returns
  `HeaderMismatch{first column}` for zero records; say "the file is empty".
- **L9. Over-bound key is `unkeyed` with no reason.** A grain cell over 256 bytes or a
  key over 128 bytes is `unkeyed` exactly like a blank; the members list says "No
  key". Add a reason (`blank`, `over_bound`, `not_a_key`).
- **L10. No period column, no limitation.** `ProposedPopulation.period` is optional;
  without it every keyed row is in scope and the summary can conclude for the basis
  period with no statement that period membership was not checked. Add a limitation.
- **L11. Measure label is shown when values are withheld.** `api/src/coverage.rs`
  `member`: `measure` (the currency or unit text read from the measure column cell) is
  returned even when `shown` is false. Withhold it with the other cell values.
- **L12. Database does not tie a workbook population to its read.** `coverage_guard`
  checks the job only `IF NEW.job_id IS NOT NULL` and only that its program contains
  `"mode":"enumerate"`; a workbook population with `job_id` null, or naming an
  enumeration job of another sheet/header/columns, is accepted. Require a job when
  the original is a workbook and compare sheet, header row and columns with the
  request literal.
- **L13. Members endpoint filters by kind only.** `/members?disposition=scope_unknown`
  cannot list one reason; the exact count per reason is only in the summary. Add an
  optional `reason` filter (with its own exact count).
- **L14. Judgment opportunities are frozen at the first evaluation.** A 24.1 judgment
  recorded after `evaluate_population` is never counted for that population
  ("already evaluated" feedback, `assessment/coverage.rs:1324-1333`); the feedback
  should say a new population version is needed.
- **L15. Small wording and unit issues.** `population_line` puts "at least" on rows,
  subjects and in scope but not on unkeyed, duplicate, out-of-period and scope-unknown
  counts; a seeded sample with size larger than the in-scope set is refused as
  "selection mismatch" rather than "size larger than the population"; the duplicate
  member reads "repeats received row {ordinal+1}" beside a Row column that shows sheet
  row numbers, so the two numbers do not match (`Coverage.tsx:61`); "Show more rows"
  unmounts while loading and focus falls to the page (`Coverage.tsx:66`).
- **L16. Member document size with control characters.** A member document is capped
  at 16,384 bytes (`0019:111`); twelve 256-byte cells of C0 control characters escape
  to 6 bytes each in JSON text and exceed it, so the whole population is "refused as
  proposed". Bound by the escaped length or reject control characters in stored cell
  text.

---

## Checked and found sound

- Exactly 20,000 data rows: `read = 20000`, `truncated = false`, complete; 20,001:
  `truncated = true`, `incomplete row_bound`; `enumeration_manifest` refuses a
  non-truncated read whose `rows_read ≠ last_row − header_row`, non-increasing rows,
  rows past `last_row`, wrong cell counts and texts over 256 bytes.
- Header-only sheet / CSV: zero rows, complete if exhaustive → `no_eligible_items`;
  incomplete zero rows → `no_items_found_absence_not_proven` (Rust and SQL agree).
- Header row beyond the sheet, a duplicated header, a header with a trailing space:
  `header_mismatch` naming the column; nothing recorded.
- Dispositions: exact duplicates collapse to `duplicate_row{first}` and the first row
  then takes its period decision; any differing named cell (including an over-bound
  `None` vs text) makes every row of the key `conflicting_duplicate`; period edges
  are inclusive; blank → `period_missing`, unparsable/over-bound → `period_unparsed`;
  the DB pairs (`disposition`/`reason`/`duplicate_of`) match `Disposition::from_parts`.
- Multi-column keys are injective (`|`/`\` escaped only when more than one part).
- Completeness order (not exhaustive → row bound → count mismatch) is the same in
  Rust and the population CHECK; reconciliation matched / mismatch / not declared is
  derived, and a declared count needs a verified whole-value quote with scale 0.
- SplitMix64 + Fisher–Yates: rejection sampling is unbiased (`limit` is a multiple of
  `n − i`); `size` is clamped to `n`; seed text is validated to `u64` in the decoder,
  the DB (`seed::numeric ≤ 2^64−1`) and the web parser; `all_in_scope` with zero
  in-scope subjects records an empty sample; substitutions are checked both ways.
- `summarise` and the SQL recount agree: per-criterion buckets sum to the subjects,
  undetermined by reason sums to undetermined (`stated_in_words` for a model proposal
  with no reason), failing subjects use "any not met", failing opportunities are a
  separate sum, a subject with fewer opportunities than criteria is unresolved, and
  sample summaries filter by the selected subjects. A sample never yields
  `no_exception_found`; zero applicable yields `no_eligible_items` only when complete.
- Statement-level guards check membership, duplicate targets, in-scope opportunity
  members, judgment-only verdicts for judgment criteria, inputs bound to the member's
  digest, and the deferred recount of members and selected items at commit.
- Member paging: exact count per disposition in the same transaction; `ordinal > after`
  with `-1` for the first page; a 51st row gives `next`; a cursor at or past the end
  gives an empty page and no `next`; a non-digit or >u32 cursor is 400; an unknown
  population is refused like any out-of-scope record; subject, cell texts and values
  are withheld unless the viewer may read the exact original now.
- Web parser re-checks the partition, failing-opportunity sum and the "never a pass"
  rules; unknown totals are sentences; the scroll region is focusable and labelled.
