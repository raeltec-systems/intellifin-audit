# Review 24.4 — Edge Case Hunter

Scope: `git diff 523ad5f3 a03feb80 -- zobba` (Story 24.4, work products with
checked claims), read against the spec's I/O matrix and owner decisions and the
lessons of `review-24-1…24-3b-*.md`. Read-only. Figure-rule findings were
confirmed with a scratch binary linked against `zobba-domain` (outside the
tree; the tree is clean).

Counts: **4 High, 9 Medium, 15 Low.**

## High

### H1 — One malformed quote assertion fails the whole answer cycle

- **Where:** `crates/application/src/work_product.rs:797` (every quote of the
  plan goes into `quotes` with no check), `:843` / `:707`
  (`verify_quotes` → `verify_sources(...)?`), `crates/application/src/assessment.rs:1169`
  → `crates/application/src/citation.rs:158` (`if !answer.is_valid() { return Err(ReadingError::Invalid) }`;
  `CitedAnswer::is_valid` requires `valid_scope_id(original_id)` and
  `text_ok(quote)`, `domain/src/citation.rs:447-449`). `record_draft` then
  returns the error (`:1415-1424` `.await?`), `after_answer` propagates it,
  `work.rs:740` maps it to `ModelError::Invalid`.
- **Input/state:** the model writes a claim whose assertion is
  `{"kind":"quote","record":"","detail":"…","value":"…"}`, or a record with a
  space or `.`, or a `value` that is blank/whitespace (all allowed by the answer
  schema: `string(128)`, `string(MAX_QUOTE_BYTES)`).
- **Wrong output:** instead of per-block `quote_unverified` / `unknown_record`
  feedback, the answer step errors with `Invalid` and the cycle ends; a reclaim
  replays the same stored answer and fails the same way (24.3a H2 shape).
  Violates "model-controllable input never fails a cycle".
- **Fix:** before `verify_quotes`, refuse (per block) any quote whose
  `original_id` is not a scope ID, whose quote fails `text_ok(MAX_QUOTE_BYTES)`,
  or whose locator is absent; only pass well-formed sources to
  `verify_sources`. Add a worker case with an empty quote and an invalid ID.

### H2 — A numeric record identifier anywhere in the version whitelists that figure in every claim

- **Where:** `crates/domain/src/work_product/figures.rs:148` (`add_record` puts
  pure-digit tokens in `numbers`), `:240-243` (`statement_figures_v1` skips any
  token in `numbers`), `crates/application/src/work_product.rs:726-764`
  (`identifiers` is built once per version from every pinned record's subject,
  criterion ID, basis ID and every summary criterion — kept blocks included).
- **Input/state:** any pinned record in the version has a numeric subject
  (invoice/employee numbers are commonly digits) or a numeric criterion ID
  (`1`, `2`, `14`…). E.g. an outcome claim about subject `14` elsewhere in the
  paper, and a claim "14 of 1,000 applicable invoices had no recorded approver"
  asserting `count(not_met)=15` and `count(applicable)=1000`.
- **Wrong output:** recorded as a checked claim stating a count no record holds.
  Experiment: `statement_figures_v1("14 of 1,000 …", {15,1000}, ids∋"14") = Ok`.
  This is the matrix's "Wrong figure" row passing.
- **Fix:** scope identifier numbers to the claim's own pins and only where the
  token is used as an identifier (e.g. require an adjacent ID label or a
  `subject` token exactly at a position the renderer would place it); simplest:
  never let a pure number resolve as an identifier in a claim statement unless
  it is that claim's own pinned subject *and* not also a rendering-shaped
  number. Add a test with a numeric subject.

### H3 — The web refuses any version whose claim blocks are not in template-section order

- **Where:** server numbers claims in *block* order
  (`crates/application/src/work_product.rs:1775-1778` `number += 1`), the API
  regroups blocks by *template section* (`crates/api/src/work_products.rs:531-541`),
  and the web parser requires section-grouped claims to be numbered 1..n
  (`web/src/work-product.ts:232`). Nothing requires blocks to follow template
  order (`Version::is_valid`, `assemble`, SQL `work_product_complete`), and a
  person may reorder.
- **Input/state:** the agent writes a `results` claim before a `summary`
  claim while the template lists `summary` first; or a person uses the editor's
  Move up/down across a section boundary (`WorkProductDocument.tsx:203-208`
  swaps flattened entries but the block keeps its section).
- **Wrong output:** `parseVersion` throws; the version view (and its support,
  editor and exports panel) is "could not be read" for that version forever
  (versions are immutable). DOCX/XLSX show `[3] [1] [2]` in reading order.
  Also the editor's initial draft is flattened in section order
  (`WorkProductDocument.tsx:177-179`), so saving any text edit silently
  reorders blocks the person never moved.
- **Fix:** either number claims in template-section order on the server (view,
  limitations, export) or have the API return blocks in version order and let
  the web check that order; make the editor start from the version's block
  order and move blocks only within their section. Add a fixture with
  cross-section order.

### H4 — The web rejects every template whose section IDs are not lower-case snake case

- **Where:** `web/src/work-product.ts:70-73` (`/^[a-z][a-z0-9_]{0,63}$/`) used
  for `section_id`, section `id` and `missing_required`; the server accepts any
  `valid_scope_id` (`[A-Za-z0-9_-]{1,128}`) for template sections
  (`domain/src/methodology.rs:236`, `TemplateRef::is_valid`, SQL CHECK).
- **Input/state:** a firm template with sections `Results`, `test-results`,
  `1_scope` or a 65+ character ID (all valid in 21.2/21.3 methodology).
- **Wrong output:** `parseSummary` (shelf, via `missing_required`) and
  `parseVersion` throw: the Task's and engagement's work-product shelf and every
  version of such a product are unreadable in the web.
- **Fix:** use `identifier` (the server's rule) for section IDs; add a fixture
  with an upper-case, hyphenated section.

## Medium

### M1 — The figure rule is bypassed by numerals that are not `Nd` digits, by signs, and by figure swaps

- **Where:** `figures.rs:13-27` (`ND_ZEROS` is Unicode 15.1; Rust 1.98 is
  Unicode 16), `:52-85` (tokens), `:191-202` (`decimal` inserts only the
  unsigned rendering; a leading `-` is trimmed from the token).
- **Confirmed by experiment:** claim "fourteen of 1,000 …" with counts
  {15, 1000} → Ok; "¹⁴ of 1,000" → Ok; "Ⅻ of 1,000" → Ok; "-15 of 1,000"
  → Ok (sign not checked: a positive fact 1250.00 may be stated "-1,250.00");
  narrative "about twenty items failed", "item ¹ failed", "𜳵 items failed"
  (U+1CCF5, Unicode 16 `Nd`) → Ok. Values are a set, so "1,000 of 15
  applicable invoices" (swapped) also passes.
- **Fix:** refuse `No`/`Nl` numerals (or any `char::is_numeric`) outside
  identifiers, generate `Nd` from the toolchain's Unicode (`char::is_numeric`
  plus `to_digit`-style check) or test the table against `char` at build;
  treat a sign before a figure as part of it; consider a closed number-word
  list for narrative. Spelled numbers are the owner's call; at least state it
  in the README.

### M2 — Verdict words are checked only for quote-only claims, and never against the asserted verdict

- **Where:** `crates/application/src/work_product.rs:906-917`.
- **Input/state:** claim "No exceptions were found among 1,000 applicable
  invoices" with only `count(applicable)=1000`; claim "All invoices met the
  criterion in the period" with only `period{basis}`; claim "INV-0042 met the
  criterion" with `outcome(INV-0042, not_met)`; "no exceptions" with
  `conclusion(exceptions_found_inconclusive)`.
- **Wrong output:** recorded as checked claims — exactly the Problem
  statement's "states 'no exceptions' beside a summary that says inconclusive".
- **Fix:** require a verdict word to be backed by an outcome/conclusion/
  exception (or a `met`/`not_met`/`failing_*` count) assertion of the claim, and
  refuse a statement whose verdict words contradict the asserted verdict or
  conclusion (closed mapping). At minimum extend `verdict_without_record` to
  claims with no outcome/conclusion/exception assertion.

### M3 — An acceptance (review state only) marks claims "needs refresh: effective outcome changed" and blocks human edits

- **Where:** `crates/domain/src/work_product.rs:1192-1196` compares `review`
  as well as verdict/origin; `crates/application/src/work_product.rs:965-983`
  refuses a person's edit when `rebuilt != pins`.
- **Input/state:** v1 cites an unreviewed head; an auditor saves `accepted` (or
  `needs_reconsideration`) without changing the verdict.
- **Wrong output:** the claim shows `disposition_changed` with the words "a
  person's disposition changed the evaluation's effective outcome", although
  the effective outcome (spec: verdict incl. origin) is unchanged; the shelf
  count rises; any person's edit of that claim's sentence is refused
  `superseded_support`. Every review pass makes the paper look stale.
- **Fix:** compare verdict and origin only for `disposition_changed`; show
  review state as information. If review state must stay pinned, give it its
  own closed reason with accurate words.

### M4 — The agent sees block IDs for at most 4 products, and never for a realistically sized one

- **Where:** `crates/application/src/work_product.rs:2079-2167`
  (`MAX_MESSAGE_PRODUCTS = 4`, products in ID (hash) order, a product is
  omitted *whole* if its part exceeds the ~11 KiB budget; a claim block line
  plus its 160-byte envelope is ~400–500 bytes).
- **Input/state:** a working paper of more than ~20–25 blocks (the bounds
  allow 64 blocks / 48 claims), or a fifth product.
- **Wrong output:** the agent gets only the outline counts: no block IDs to
  keep, no "NEEDS REFRESH" per block, no person's block IDs (it learns them
  only from a `human_block_dropped` refusal on the next answer). Refresh — the
  story's only path for stale claims — costs at least one wasted cycle and
  forces the agent to rewrite every agent block. The 4 shown are arbitrary,
  not those needing refresh. (24.3a H3 lesson.)
- **Fix:** render each product partially (IDs and refresh markers for every
  block first, texts truncated or dropped next), prioritise products with
  claims needing refresh or person blocks, and count omissions per block.

### M5 — An export retried after its object was stored records a digest that does not match the stored bytes

- **Where:** `crates/application/src/work_product.rs:2739-2747`.
- **Input/state:** first attempt stores the object under `wpx-…` and then
  `record_export` fails (database unavailable, session ended); the client
  retries the same key after a record changed (a claim went stale, an
  exception status moved, an editor's label changed), so the re-render differs.
- **Wrong output:** `put_if_absent` → `AlreadyExists` → the *old* object
  version is recorded with the *new* digest and size; every download answers
  integrity failure, and that key is burned.
- **Fix:** on `AlreadyExists`, read the stored object and record its own size
  and digest (or refuse when they differ); add a test with a changed record
  between attempts.

### M6 — Version views and exports render live, unpinned platform data; "identical bytes" does not hold

- **Where:** exceptions block lines and limitations
  (`work_product.rs:1867-1887`, counts from
  `infrastructure/src/assessment/work_product.rs:248-256`), editor labels
  (`:2623-2649`), currency/support/limitations (`:1757-1989`).
- **Input/state:** an exception's derived status changes, a person's display
  name changes, or a claim goes stale between two exports of the same version
  and withheld set.
- **Wrong output:** different bytes for the same version/format/withheld set,
  contrary to the spec and the OpenAPI text; an immutable version's exceptions
  block silently shows new counts with no refresh marker. The counts are over
  every exception of the basis's criterion roots in the Task, not "under basis
  X" as the line says (24.3b M2 lesson).
- **Fix:** document that exports are time-stamped renderings (record the
  render time/currency in the export row) or pin the exceptions counts at
  version time and mark drift as a refresh reason; word the line "for the
  criteria of basis X, Task-wide".

### M7 — A required section with only a heading (or only a platform placement) is "completed"

- **Where:** `crates/domain/src/work_product.rs:832-844`, SQL
  `work_product_complete` missing-required block, `export.rs` `content` test.
- **Input/state:** required section `conclusion` holds only a heading
  "Conclusion" (or only a coverage block).
- **Wrong output:** `missing_required` is empty; shelf, limitations and export
  never say "Not completed in this version." for a section with no written
  content.
- **Fix:** count only narrative/claim (and perhaps placed platform blocks) as
  content; keep Rust and SQL identical.

### M8 — Format characters (bidi overrides, zero-width) let a checked statement display other figures

- **Where:** `text_ok` (`work_product.rs:382-388`, application `:473-479`)
  rejects only `Cc`; `tokens` splits on any non-word character
  (`figures.rs:52-85`); DOCX/XLSX/web render text as is.
- **Input/state:** statement `"1\u{200B}5 of 1,000"` with counts {1, 5, 1000}
  displays "15 of 1,000"; a U+202E override reverses displayed digit order of a
  checked figure.
- **Fix:** refuse `Cf` bidi controls and zero-width characters (U+200B–U+200F,
  U+202A–U+202E, U+2066–U+2069, U+FEFF) in headings, narrative and statements,
  or strip them before the figure check and refuse when they sit inside a
  digit run.

### M9 — Withheld quotes are hidden only in the citation; the claim statement is not

- **Where:** `crates/api/src/work_products.rs:404-437` (value withheld) vs
  `:487` (statement always returned); `export_view` same.
- **Input/state:** quote-backed claim "The policy states: 'Approvals above
  £50,000 need two signatures'" (figures must be the quote's, so restating the
  quote is the natural way to pass the figure rule); viewer cannot read the
  original.
- **Wrong output:** the quoted text reaches the viewer in the statement while
  the citation says "withheld for this viewer" (spec "Never": a quote shown to
  a viewer who cannot read its original).
- **Fix:** when a claim has a withheld quote, withhold the statement too (show
  "withheld for this viewer"), or refuse statements that contain a quote's
  text verbatim beyond a short bound.

## Low

- **L1 `source_withdrawn` is unreachable for real data.** Original digests are
  immutable and an original the reader cannot see yields `registered = NULL`
  → withheld (`domain/src/work_product.rs:1229-1235`); only a missing
  assertion row reaches it. Quotes are never re-verified on read.
- **L2 Period pins never go stale** (`:1240`), even when the basis is
  superseded.
- **L3 False refusals of ordinary prose:** "31 January 2025", "31/12/2025",
  "1 000", "15–1,000" ranges, "isa 315", "FY2025"/"Q4" in a heading unless the
  template text names them (only template name/ID/section ID/title are read),
  "IAS 16" not in the template.
- **L4 64-block draft is refused as "at most 64 blocks"** after trusted code
  appends limitations (`work_product.rs:1402-1411`, `:1078`); say "63 plus the
  limitations block".
- **L5 Shelf count and page are separate READ COMMITTED statements**
  (`infrastructure/.../work_product.rs:933-951`); a concurrent insert can make
  `products.length > total`, which `parseShelf` refuses.
- **L6 Web bounds tighter than the server:** limitations array 256
  (`work-product.ts:221`) — many cited summaries × limitation codes + refresh
  lines can exceed it; assertion `value` 1,000 bytes vs fact values up to
  1,024; a non-neutral template whose name ends with the neutral label fails
  `parseSummary`.
- **L7 XLSX Coverage sheet heads "Exact count" and totals "Subjects in scope"**
  for an incomplete population (the "at least" line is only in the row above;
  24.2 M4 lesson).
- **L8 Web export uses a new key per click** (`WorkProductDocument.tsx:283`);
  a retry after an uncertain response makes a second export and object.
- **L9 Outline grows past its bound:** product lines are appended after
  `outline_all` already used `MAX_ASSESSMENT_OUTLINE_BYTES` (assessment.rs
  ~2428-2438); check the tier-2 budget can't hit `context_budget`.
- **L10 Basis limitations (model-written 24.1 text) are shown as platform
  limitations** and may carry figures.
- **L11 Verdict list misses common verdicts:** "effective", "ineffective",
  "deficiency", "satisfactory", "approved", "breach".
- **L12 Coverage block is accepted for a superseded summary**
  (`work_product.rs:1038-1050`), only claims check supersession.
- **L13 Count claims on samples / incomplete populations** state bare numbers in
  support lines ("Summary …: 15 not met") — only the coverage line qualifies them.
- **L14 Human-edit replay after re-sign-in:** `version_by_key` is session-bound,
  so a retry from a new session after a lost 201 gets 409 `stale_base` naming
  the person's own version.
- **L15 Empty draft** (no blocks) is recorded as a version with only the
  limitations block; consider refusing a version with no content block.

## Checked and found sound

- ZIP/CRC-32 writer and reader; XML escaping of `& < > "`, C0 replacement,
  U+FFFE/U+FFFF; every XLSX text is `inlineStr` (a leading `= + - @` stays text);
  the one `SUM` range is correct (`first` = row after the summary row) and its
  cached value equals the partition total.
- Kept blocks byte-equal (Rust and SQL), the agent cannot change or drop a
  person's block, a person cannot add blocks or change assertions, base = head
  under the per-product advisory lock (race → `stale_base` naming the head).
- Record agreement recomputed in SQL for outcome/count/conclusion/exception/
  fact/period; same-Task joins; counts NULL for wrong measure/criterion shape.
- Count values parsed exactly (no sign, grouping or leading zero); 0 and 9
  assertions refused; withheld-set binding on download, with size/digest
  recheck.
