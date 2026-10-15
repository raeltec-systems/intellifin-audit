# Story 24.1 — Edge Case Hunter review

Commit reviewed: `54564e1` (branch `codex/zobba-foundation-batch`).
Method: read the spec I/O matrix, then walked each branch of
`domain/src/assessment.rs`, `domain/src/citation.rs` (decode),
`application/src/assessment.rs` (`after_answer`, documents, outline),
`application/src/work.rs` (hook), `infrastructure/src/assessment.rs`,
`migrations/0018_assessment_basis.sql`, `api/src/work.rs` and
`web/src/assessment.ts` / `AssessmentBasis.tsx`. Findings are from reading the
code paths; no tracked file was changed.

Counts: **High 2 · Medium 5 · Low 11**

---

## High

### H1. A judgment with no facts is decided by the domain but refused by the database, which fails the whole cycle

- Where: `crates/domain/src/assessment.rs:1474-1510` (`judge`),
  `crates/application/src/assessment.rs:1588-1700` (judgment loop),
  `migrations/0018_assessment_basis.sql` evaluation branch of `assessment_guard`
  (`IF NEW.verdict IN ('met','not_met') AND jsonb_array_length(NEW.document->'inputs') = 0 THEN RAISE`),
  `crates/infrastructure/src/assessment.rs` `refusal()` (23514 → `ReadingError::Invalid`).
- Input/state: a judgment criterion with `required_facts: []` (valid:
  `ProposedCriterion::is_valid` only bounds the list) and verified authority;
  a judgment with `supporting: []`, `contrary: []` (valid:
  `ProposedJudgment::is_valid` allows empty lists) and `verdict: "met"` or
  `"not_met"`.
- Wrong output: `prepare` returns `Ok(inputs = [])`, the cited-fact loop is
  empty, so `judge` returns a decided verdict with no inputs.
  `Outcome::is_valid` and `record_evaluation`'s own checks accept it, the
  database guard raises 23514, the repository maps it to `Invalid`,
  `model_error` maps that to `ModelError::Invalid`, and `read_after` ends the
  cycle `CycleEnd::Failed`. A reclaim re-processes the same stored answer and
  fails the same way. One model-proposed entry thus kills the cycle, contrary
  to "invalid entries dropped and counted".
- Fix: make the domain agree with the database. Either require at least one
  required or cited fact for a judgment (in `ProposedJudgment`/`judge`, giving
  `undetermined missing_fact`), or refuse the decided verdict in `judge` when
  `inputs` is empty. Add an application-level check before
  `record_evaluation` so a guard refusal can never be the first line of
  defence for model input.

### H2. More than 1,024 facts in one basis wedges the Task permanently

- Where: `crates/infrastructure/src/assessment.rs` `facts()` (`LIMIT 1025`,
  then `Err(ReadingError::Capacity)` when 1,025 rows exist);
  `crates/application/src/assessment.rs:1374-1380` (`recorded_before` reads
  `store.facts` for every proposed fact) and `:1521` (evaluate reads it);
  nothing in the application or in 0018 bounds facts per basis on insert.
- Input/state: a basis that receives facts over 17+ answers (64 per answer,
  for example a 1,000+ invoice population). The duplicate check for fact
  number 1,025 still reads 1,024 rows, so the insert succeeds.
- Wrong output: from then on every `facts()` call for that basis returns
  `Capacity`. `after_answer` fails with `ModelError::Capacity`, `read_after`
  returns `CycleEnd::Unavailable`, and the reclaim runs the same answer again,
  meets the same `Capacity` and never makes progress. Evaluation under that
  basis is also impossible.
- Fix: refuse (with feedback) a fact that would exceed `MAX_BASIS_FACTS` for
  its basis, in the application and with a database count check in
  `assessment_guard` (under the existing per-record lock, or with a basis-level
  advisory lock so two inserts cannot both pass).

---

## Medium

### M1. A fact that names a still-running (or not-yet-recorded) job is recorded permanently as `analysis_failed` (open issue 1)

- Where: `crates/application/src/assessment.rs:68-76` (`JobState::Failed`
  includes "not yet ended"), `:1442-1444`; `infrastructure/src/assessment.rs`
  `job_state` (`EXISTS completed`); guard in 0018 requires `analysis_failed`
  whenever no `completed` event exists.
- Input/state: the agent cites a job of this Task that is `admitted`,
  `running` or `unknown` (Unknown → Completed is a legal transition in
  `domain/src/analysis.rs:342`).
- Wrong output: the fact stores `support=unsupported, support_reason=analysis_failed`
  and `job_state="failed"`; every evaluation reading it is
  `execution failed analysis_failed`. Records are immutable and the UNIQUE
  `(basis_id, subject, name)` plus the `recorded_before` check forbid
  re-recording the fact in the same basis, so the false statement "the
  analysis failed" stays and the agent must create a new basis version and
  re-record every fact. Also a race: if the job gains its `completed` event
  between `job_state()` and the insert, the guard refuses the row (23514) and
  the cycle fails (`CycleEnd::Failed`).
- Fix: add a third state (`pending`) and refuse to record such a fact (feedback:
  "job X has not ended; record the fact after it completes"), so nothing
  immutable is written; make the guard accept the same three-way meaning. Read
  the job state inside the insert transaction to remove the race.

### M2. An applicability test that cannot be decided hides the real reason (matrix rows "Value mismatch" and "Missing input" not met for the AP criterion)

- Where: `crates/domain/src/assessment.rs:1391-1407` (`Test::Undetermined(_)`
  drops the inner reason).
- Input/state: the matrix AP criterion has applicability `amount > 1,000.00`.
  Facts: amount `1280.00` against a cell holding `1,250.00` (type_mismatch),
  or no amount fact, or amount `unavailable`, or amount in EUR.
- Wrong output: every case is `applicability unknown · undetermined ·
  unknown_applicability`. The matrix requires `fact_unsupported` for the value
  mismatch, and the acceptance criterion says absent input and other causes
  must differ by reason. The tests
  (`domain/src/assessment/tests.rs:355`, `application/src/assessment/tests.rs:690`)
  assert the weaker behaviour, so the deviation is pinned rather than caught.
- Fix: keep `applicability unknown` but record the inner closed reason
  (`fact_unsupported`, `missing_fact`, `fact_unavailable`, `fact_ambiguous`,
  `unit_mismatch`), reserving `unknown_applicability` for a predicate that
  cannot otherwise explain itself; or add a separate applicability-reason field.

### M3. Subjects after the 64th in byte order can never be evaluated

- Where: `crates/application/src/assessment.rs:1528-1545`.
- Input/state: a basis with more than 64 subjects for a criterion's facts.
- Wrong output: the loop takes the first 64 subjects (byte order) before it
  skips subjects that already have an evaluation. A later `evaluate` of the
  same criterion takes the same first 64, finds them all evaluated, writes
  nothing, and subject 65+ is never evaluated under that basis. The feedback
  text implies a later request would continue.
- Fix: filter out already-evaluated subjects first (an exact query per
  subject, or one exact read of the basis × criterion evaluations), then take
  64.

### M4. An evaluation can be pinned before its basis's facts are complete, and the basis stays open

- Where: `crates/application/src/assessment.rs:1495-1585`; 0018 (no freeze of a
  basis once evaluated). Relates to open issue 2 (proposals and evaluate in
  the same answer).
- Input/state: answer 1 records `amount` facts and asks `evaluate`; answer 2
  records the `approver` facts for the same basis and asks `evaluate` again.
  Or some facts of answer 1 were dropped on decode but `evaluate` still ran.
- Wrong output: answer 1 writes `undetermined missing_fact`; it is the one
  evaluation per (basis, criterion, subject), so answer 2 only gets "its inputs
  have changed since. Propose a new basis version". The basis now shows the
  approver fact beside an evaluation saying it is missing. Facts are not
  carried to a successor basis, so recovery means re-recording every fact of
  the population.
- Fix: either refuse new facts for a (basis, subject) that already has an
  evaluation, or let a successor basis inherit the predecessor's facts by
  reference, or defer `evaluate` in an answer until its facts in the same
  answer were all recorded (and report which were dropped).

### M5. Subject and measure (currency/unit) of a "supported" fact are model assertions, not checked against the source

- Where: `crates/domain/src/assessment.rs:689-724` (`ParseRule::apply` takes the
  stated measure), `crates/application/src/assessment.rs:1455-1484`.
- Input/state: cell `B4` holds `1,250.00` in a EUR column (or on the row of
  INV-0050); the agent records subject `INV-0042`, currency `USD`, quote
  `1,250.00` at `B4`.
- Wrong output: the quote verifies and re-parses, the fact is `supported`,
  and a USD threshold gives `met`/`not_met` (deterministic). The "Currency
  mismatch → unit_mismatch" protection and the subject linkage depend on the
  model being honest; a quote `EUR 1,250.00` or `1,250.00 €` fails every
  decimal rule, so the model cannot prove the currency even when the source
  shows it. "Supported" overstates what was checked.
- Fix: at minimum, record measure and subject as `asserted` (not verified) on
  the fact and show it; better, add rules that parse a currency code or symbol
  from the quote (`decimal_with_currency`) and require a second source for the
  subject (e.g. the identifier cell on the same row, checked by locator row).

---

## Low

### L1. Unverified authority still yields `not_applicable`
`domain/src/assessment.rs:1377-1418`: effective period and applicability are
decided before the authority check, so a criterion with unverified authority
can produce `not_applicable` (decided by its own unverified applicability
text). The matrix says evaluations of an unverified criterion are
`undetermined`. Fix: check authority before applicability, or record
`applicability unknown · authority_unverified`.

### L2. A `MemberOf` exception from an unnormalised predicate value
`domain/src/assessment.rs:1352-1357`: fact text/enum values are NFC and
whitespace normalised (`ParseRule::apply`), predicate `values` are not, and
comparison is exact and case-sensitive. A decomposed-form or differently-cased
member gives `not_met` (an exception) for a format difference. Fix: normalise
predicate values with the same `normalize` on decode.

### L3. A non-ISO `DateStyle` makes every basis insert fail
0018 `assessment_bases` CHECK compares `document->>'period_from'` with
`period_from::text`; `date::text` follows the session `DateStyle`. With
`SQL, DMY` it renders `05/03/2026` and the CHECK refuses the row (cycle
fails). Fix: compare `to_char(period_from,'YYYY-MM-DD')` or compare dates
(`(document->>'period_from')::date = period_from`).

### L4. Rust/PostgreSQL control-character parity for subjects and locators
Rust `valid_subject` uses `char::is_control` (Cc only); the CHECK uses
`[[:cntrl:]]`, which under some libc/ICU locales also matches U+2028/U+2029.
A subject with U+2028 would pass Rust and be refused by the database (cycle
fails). Verify against the deployed collation; use an explicit range
(`[\x00-\x1F\x7F-\x9F]`) in SQL to match Rust exactly.

### L5. Web `trim()` parity
`web/src/assessment.ts` `text()`/`subject()` reject values that are blank under
JavaScript `trim()`, which also strips U+FEFF; Rust `trim()` does not. An agent
assertion, objective, rationale or subject of only `﻿` is stored but makes
`parseAssessment` throw, which makes the whole work response invalid in the
browser (not only the assessment section). CLAUDE.md records this exact class
(2026-10-01). Use the shared Unicode White_Space set.

### L6. Outline shows the oldest of the recent evaluations
`application/src/assessment.rs:1872-1960` with `infrastructure` `snapshot()`:
evaluations are the newest 256 ordered oldest first, and the outline takes the
first 64 — the oldest of them — so with more than 64 evaluations the agent's
tier-2 outline omits its most recent results. Per-basis fact counts use the
Task-wide newest 1,024 facts and undercount older bases. Fix: take the last 64.

### L7. Job dependency is declared by the model only
A fact's `job_id` is optional and unchecked against its sources; the citation
reader resolves only `evidence_originals`, so the spec's "22.4 descendant"
sources are always `source_unverified`, and a fact can avoid
`analysis_failed` by omitting `job_id`. An unknown job becomes
`source_unverified` with the `job_id` dropped, which reads as "its source was
not verified" although the quote was verified. Record an unknown job as its own
reason, and note the descendant gap in the spec.

### L8. Completed-then-unknown/failed jobs
`job_state` and the guard use "any `completed` event"; the job state machine
allows Completed → Unknown → Failed/Absent. Such a job counts as completed
(`job_state: "collected"` in the document — the stored label says "collected"
but means "has a completed event"). Use the latest terminal event and a label
that says `completed`.

### L9. Criterion and basis keys can shadow IDs
`resolve_criterion` and `resolve_basis` look up same-answer keys before IDs. A
model that uses a previous record's ID as the new key (natural when proposing
a successor) silently redirects `evaluate`, basis lists and facts to the new
record. Refuse a key that has the shape of a record ID (`crit-`/`basis-` +
40 hex).

### L10. Judgment bound reached silently; repeated bound feedback
`application/src/assessment.rs:1662`: the judgment loop `break`s at
`MAX_INVOCATION_EVALUATIONS` with no feedback; the rule loop repeats the bound
line once per remaining criterion. Report once, in both loops.

### L11. Minor validation gaps
- `valid_currency` accepts any three capitals (`XXX`, `ABC`), not ISO 4217.
- `Decimal::parse_grouped` accepts `0,123` and `00,000`.
- `ProposedBasis` allows duplicate population `original_id`s; the web list uses
  `original_id` as the React key (duplicate keys).
- The fact `effective` date is stored on a `supported` fact but is never
  checked against a source.
- An instant near year 1 or 9999 at a large offset renders its UTC form as
  `????-??-??`.
- Feedback lives only in memory; after a process restart where the last
  answer is not re-processed, the next turn has no feedback for it (the
  outline still lists the records).
- Criterion-key de-duplication runs after the 8-entry cap, so a valid
  ninth entry can be discarded as over-bound while a duplicate-key entry
  took its place.

---

## Checked and found sound

- Exact decimal: digits are bounded to 19 and scale to 18, so scale
  alignment in `compare` cannot overflow `i128` (≤ ~10^37); negative zero
  collapses to `0`, which is harmless; render/parse round-trips for every
  bound case, including scale 18.
- Civil dates: leap years (1900 refused, 2000 accepted), month/day bounds,
  `date_dmy` one-digit parts, four-digit years only.
- Instants: `±HH:MM` up to 14:00, `Z`, up to six fraction digits; the matrix
  case `2026-03-05T23:30:00-05:00` gives UTC `2026-03-06T04:30:00Z` and civil
  date 2026-03-05; period test uses the fact's civil date at the source offset.
- Missing, unavailable, ambiguous, unsupported and failed input never produce
  `not_met`; `Present` is never false; unit mismatch is `undetermined`.
- Evaluation guard's NULL handling (`verdict NOT IN (...) OR verdict IS NULL`)
  is correct; immutability/retention triggers and the `*_test` reset
  exception mirror 0017; RLS read/insert policies are forced on all six tables.
- Older answers: absent keys decode as empty lists and the 22.5/22.6 schemas are
  unchanged, so stored answers and request bindings keep their bytes.
- Reclaim: records are found by invocation and ordinal; evaluation ordinals
  continue from the maximum stored ordinal and already-evaluated subjects are
  skipped, so a reclaim writes the same records it would have written.
