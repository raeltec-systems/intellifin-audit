# Story 24.2 review: Blind Hunter

Scope: `git diff 6b8876a 1819622 -- zobba`. I read the diff first, without the spec. Then I
checked it against the spec (Intent, Boundaries, I/O matrix) and the Story 24.1 review lessons.
Every finding below was checked by reading the code. I dropped findings that I could not prove.

**Counts:** High 0 · Medium 5 · Low 6.

What holds (checked, no finding):

- The statement-level `coverage_batch` guard reads every row of the `added` transition table.
  It fires for multi-row `INSERT ... SELECT unnest(...)` and for `COPY`. `ON CONFLICT DO NOTHING`
  rows are not in `added`, and the primary keys refuse them anyway.
- Members and sample items cannot be added after commit. `ordinal < received_rows` (or `< size`),
  the primary key and the deferred `coverage_complete` count fill every slot.
- Subject uniqueness among non-duplicate members follows from the population CHECKs and the recount.
  Two `in_scope` rows with one subject make `distinct_subjects < in_scope + ...`, and no other
  disposition can make up the difference.
- The SQL recount (per criterion and partition) and the pure `summarise` use the same rules.
  `conclusion()` in Rust and the SQL `CASE` agree. The `no_exception_found` rules for a sample, an
  incomplete population and scope-unknown subjects are correct in both.
- SplitMix64 rejection sampling has no modulo bias. `check_sample` recomputes a seeded selection and
  checks substitutions. `ProposedSample::is_valid` requires `size > 0` and `keys.len() == size` for
  a non-`all_in_scope` sample.
- A control count is verified with `whole_value` (the 24.1 H1 lesson is applied).
- The model cannot write a member, a disposition, a rule verdict or a count. All of these come from
  `build_members`, `PopulationCounts::of`, `evaluate` and `summarise`.
- No percentage or numeric confidence exists in Rust, SQL or the web code. Every displayed count is
  an exact stored count or an exact `count(*)`.
- The `reading_guard` replacement keeps every branch of the 0016 version. It only widens the
  program pin to the new prefix (old prefix still admitted).
- The `"mode":"enumerate"` guard cannot be spoofed through a column or sheet
  name. `json_string` and `python_json` turn an embedded quote into `\"`.

---

## Medium

### M1 — The summary recount guard passes when a criterion entry omits a count (NULL bypass)

- **Where:** `zobba/migrations/0019_assessment_coverage.sql:384-389` (per-criterion check). The same
  problem is in the population and summary `document` CHECKs (for example
  `(document->'summary'->>'failing')::integer=failing_subjects`).
- **Scenario:** A summary row's `document->'summary'->'criteria'[k]` is
  `{"criterion_id":"crit-…"}` with no count keys. Each `(entry->>'met')::bigint <> recount.met` is
  NULL. `false OR NULL OR …` is NULL, and `IF NULL` does not raise. The insert succeeds with counts
  that were never recounted. The CHECK constraints pass for the same reason: a NULL CHECK passes.
  `SummaryRecord::from_document` later needs every key, so the stored summary cannot be read. The
  record is immutable, so `coverage_snapshot`, `coverage_view` and `invocation_coverage` then return
  `Unavailable` for the whole Task, permanently.
- **Spec:** "a summary guard that recomputes every summary count … and refuses any disagreement";
  AC "a forged summary is refused at insert". The CLAUDE.md lesson "a CHECK that evaluates to NULL
  passes" applies here.
- **Fix:** Compare with `IS DISTINCT FROM` everywhere: `(entry->>'met')::bigint IS DISTINCT FROM
  recount.met`, `entry->'undetermined_by_reason' IS DISTINCT FROM recount.by_reason`. In the
  document CHECKs, require each key with `document->'summary' ? 'failing'`, or wrap each comparison
  in `coalesce(..., false)`. Add a test that inserts a criterion entry with a missing key.

### M2 — Opportunities can still be inserted after a summary, so a stored summary can stop matching its rows

- **Where:** `zobba/migrations/0019_assessment_coverage.sql:446-530` (`coverage_batch`, opportunities
  branch). The summary guard at `:340-433` counts a missing opportunity as `unresolved` (`count(*) <
  criteria`, `subjects - count(*)`).
- **Scenario:** The database accepts a summary while some `(population, criterion, member)` slots
  have no opportunity. Those subjects are counted as unresolved. Nothing then stops a later
  transaction from inserting the missing opportunities: the primary key only blocks a duplicate slot.
  After that, an exact recount of the stored rows gives different numbers from the immutable summary,
  and a different conclusion. Trusted code avoids this today: it refuses to summarise until
  `recorded.len() == in_scope` for every criterion. But the database invariant does not hold over
  time, and the guard was added as a second, independent check.
- **Spec:** AC "Given a stored summary, when its member and opportunity rows are re-counted with SQL,
  then every count and the conclusion agree".
- **Fix:** Do one of these. (a) In `coverage_batch`, refuse opportunities for a population that
  already has a summary. (b) Make opportunities all-or-nothing per `(population, criterion)`: add a
  deferred constraint trigger that requires exactly `in_scope` rows, and refuse a later insert for a
  pair that already has rows. (c) Refuse a summary unless every basis criterion has exactly
  `in_scope` opportunities.

### M3 — Unreviewed model judgments count as "met" and can produce `no_exception_found`, with no limitation saying so

- **Where:** `zobba/crates/application/src/assessment/coverage.rs:952-969` and `:1360-1367` (a
  judgment criterion's opportunity copies the 24.1 `model_proposal` outcome).
  `zobba/crates/domain/src/coverage.rs:1201` adds a limitation only when `not_evaluated > 0`.
- **Scenario:** A basis has a rule criterion and a judgment criterion. The model proposes `met`
  judgments for every in-scope subject. `summarise` counts those subjects as
  `meets_every_applicable`, and a complete population concludes `no_exception_found`. The summary
  and the panel never say that the conclusion depends on model proposals that nobody has reviewed.
  Story 24.3 (dispositions) has not been delivered yet.
- **Spec:** The spec allows the newest 24.1 judgment to be used. But the story's rule is "the model
  never counts" and "anything not proven is said in words". A proposed judgment is not proven.
- **Fix:** Add a limitation, for example "Judgment criterion X: N verdicts are model proposals
  (origin model_proposal), not reviewed". As an alternative, treat a summary with a
  `model_proposal` `met` as not allowing `no_exception_found`; that needs an owner decision. Show the
  origin per criterion in the Coverage panel.

### M4 — The reclaim retry ladder runs out after 8 reclaims, and the population read is then Unavailable on every later attempt

- **Where:** `zobba/crates/application/src/reading.rs:1180-1207` (`Err(AnalysisError::Conflict) if
  key.ends_with(POPULATION_KEY)`, `MAX_POPULATION_READ_RETRIES = 8` at `:92`).
  `AnalysisError::Conflict` maps to `ReadingError::Unavailable` (`:595-606`).
- **Scenario:** Every reclaim of the same answer before `record_population` commits makes `-p` and
  every suffix used before it conflict, because each carries an older operation expiry. Each reclaim
  therefore uses up one suffix and starts one more 300-second sandbox job. The earlier job's result is
  thrown away even when it was collected successfully. After the ninth reclaim, all nine keys
  conflict. `enumerate` returns `Unavailable` through `?`, and `coverage_population` passes it out of
  `after_answer`. The answer can never be processed: every later reclaim fails at once in the same
  way, and the Task is stuck retrying a retryable error.
- **Fix:** On a conflict, look up the job already admitted under the key. If it ran the same program
  over the same inputs and was collected, reuse its outputs; only its expiry differs. As an
  alternative, include the claim or operation identity in the key so that each claim gets its own key
  and no fixed ladder is needed. If a ladder stays, its exhaustion must give a recorded feedback line
  ("the population read could not be repeated"), not an endless `Unavailable`.

### M5 — A CSV record with more fields than the header is accepted, so columns shift and a wrong value is evaluated

- **Where:** `zobba/crates/application/src/citation.rs:311-445` (`enumerate_text`). Fields are read
  by header index (`record.get(index)`). A record with extra fields is not refused, and a missing
  field becomes a blank cell (`:421`).
- **Scenario:** Header `Invoice,Paid,Amount`. Row `INV-7,2026-03-05,1,250.00`: the amount is an
  unquoted grouped number. `Amount` reads `"1"`. Under `decimal_plain` it parses as 1, so the
  criterion "amount > 1,000.00 USD" says `not_applicable`. The record is counted as a clean,
  in-scope, not-applicable subject. Nothing tells the auditor that the row was misparsed. This is a
  silently wrong denominator.
- **Spec:** "CSV/plain text is read in process (RFC 4180 …)". RFC 4180 requires each record to have
  the same number of fields as the header.
- **Fix:** Refuse the enumeration (`Unreadable`) when any record's field count differs from the
  header's. As an alternative, mark such a row with a closed `scope_unknown`/unusable disposition so
  that it is counted and shown. A single-column plain-text file is not affected.

---

## Low

### L1 — The members endpoint returns the measure label even when cell values are withheld

- **Where:** `zobba/crates/api/src/coverage.rs:552-572`. `value` is filtered by `shown`, but
  `measure: Some(measure.label())` is not. The web parser (`web/src/coverage.ts` `parseMember`) also
  accepts it when withheld.
- **Scenario:** The grounded measure comes from the currency or unit column cell of the original
  (`measure_of`). A viewer who may not read the original still sees that cell text (for example
  `EUR`, or a unit name).
- **Fix:** Filter `measure` by `shown` as well. Check this in `parseMember` and in the API test (the
  24.1 M5 lesson).

### L2 — Sample keys are withheld when the sample's population is not in the bounded list of 16

- **Where:** `zobba/crates/api/src/coverage.rs:341-348`. `shown` is decided by searching
  `view.populations`, which holds only the newest 16.
- **Scenario:** In a Task with more than 16 populations, a recent sample of an older population
  shows `keys_withheld: true` and "you cannot open this source", even to a viewer who can open it.
  This fails closed, but the sentence is false.
- **Fix:** Look up the sample's population (its `original_id` and digest) by exact ID, or carry them
  on the sample record.

### L3 — The outline's "further records are not listed" count is not exact

- **Where:** `zobba/crates/application/src/assessment.rs:2374-2381`.
- **Scenario:** Coverage lines are pushed through the same byte-bounded `push` after `listed` is
  computed. `unlisted = total.saturating_sub(listed).max(omitted)` mixes two counts (`max`, not a
  sum). Coverage records dropped by the byte bound are not counted correctly. The coverage-specific
  "N further coverage records" line can itself be dropped. The model then sees a number lower than
  the true number of records not listed.
- **Fix:** Count the omitted coverage records separately, and report the sum of the basis, criterion,
  evaluation and coverage omissions.

### L4 — The member page is in receipt order, but the spec asks for a C-ordered page

- **Where:** `zobba/crates/infrastructure/src/assessment.rs` `member_page` (`ORDER BY ordinal`).
- **Spec:** "a C-ordered 50-row cursor page". The OpenAPI text says "in receipt order".
- **Fix:** Correct the spec, or order by `subject COLLATE "C", ordinal` with a composite cursor.
  Receipt order is probably the better choice; record the deviation.

### L5 — The population guard does not bind the cited enumeration job to the population's sheet, header row or columns

- **Where:** `zobba/migrations/0019_assessment_coverage.sql:302-309`.
- **Scenario:** The guard only checks that some collected `enumerate` job of this Task read the same
  original. A population could name a job that read another sheet of that workbook. Also, a workbook
  population with `job_id IS NULL` passes the guard completely, so the in-process claim is not tied
  to the content kind. Only trusted code prevents both cases.
- **Fix:** Compare the job's request literal (sheet, header row, columns) with the population
  document, and require `job_id IS NOT NULL` for a workbook (`sheet IS NOT NULL`).

### L6 — The DB completeness CHECK uses the proposed header row; the domain uses the enumeration's header row

- **Where:** `0019_assessment_coverage.sql` population CHECK (`rows_read <> last_row - header_row`)
  compared with `domain/src/coverage.rs` `completeness()` (`enumeration.header_row`).
- **Scenario:** These are equal today: the xlsx manifest parser checks `header_row ==
  request.header_row`, and the CSV path is forced to header row 1. A later reader that reports
  another header row would get a generic "refused as proposed" instead of a stated reason. This is
  latent.
- **Fix:** Store and check one header row: the enumeration's header row, asserted equal to the
  proposal's header row.
