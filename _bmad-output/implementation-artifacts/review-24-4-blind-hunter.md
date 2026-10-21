# Story 24.4 — Blind Hunter review

Scope: `git diff 523ad5f3 a03feb80 -- zobba`. I read the diff first, without the
spec. Then I checked each finding against the spec's Intent, Boundaries, I/O
matrix and the owner decisions of 2026-10-15, and against the lessons of the
24.1–24.3b reviews. Read-only review. I ran no code. Each finding below was
checked by reading the code at the named lines (paths are under `zobba/`,
line numbers are at `a03feb80`).

Counts: High 3 · Medium 7 · Low 6.

## High

### H1. A malformed quote assertion from the model fails the whole cycle (`CycleEnd::Failed`), instead of becoming feedback.

- **Where:** `crates/application/src/work_product.rs:797` (every proposed quote is pushed to `quotes` with no check), `:843` (`verify_quotes(...).await?`); `crates/application/src/assessment.rs:1151-1176` (`verify_sources` → `verify_located`); `crates/application/src/citation.rs:158-160` (`if !answer.is_valid() { return Err(ReadingError::Invalid) }`); `crates/domain/src/citation.rs` `CitedAnswer::is_valid` (`valid_scope_id(&c.original_id) && text_ok(&c.quote, …)`); `crates/application/src/assessment.rs:2316` (`record_draft(...).await?`); `crates/application/src/work.rs:2156` (`Err(_) => Err(CycleEnd::Failed)`).
- **Scenario:** The answer field gives an assertion's `record` as `string(128)` with no pattern, and `value` as `string(1000)`. The model writes a quote assertion with `record = "orig 1"` (a space), or a quote that holds a control character such as U+0007. `decode_draft` keeps it. `assemble` pushes it to `quotes` before any shape check. `verify_located` builds a `CitedAnswer`, `is_valid()` is false, and it returns `ReadingError::Invalid`. `record_draft` returns that error with `?`, `after_answer` maps it to `ModelError::Invalid`, and the work loop ends the cycle as `Failed`. The same model output on a reclaim fails again. The spec says "Model-controllable input never fails a cycle" (and the 24.1–24.3 lessons say the same).
- **Fix:** In `assemble`, push a quote to `quotes` only when `valid_scope_id(original_id)`, its locator parsed, and its quote passes the citation text rule. Give every other quote `QuoteUnverified` (or `BoundExceeded`) as a per-block refusal. Map a `ReadingError::Invalid` from `verify_quotes` to a draft refusal, not to an error. Add a worker test with a bad original ID and a control character in a quote.

### H2. Fact values that the 24.1 rule withholds from a viewer are shown in full in work products, their support lines and their exports.

- **Where:** `crates/application/src/work_product.rs:1698-1711` (`support_line` for `Fact` always prints `pin.value`); `crates/api/src/work_products.rs:404-431` (`assertion_response`: `value: (!withheld).then(...)`, where `withheld` is true only for a quote); `crates/application/src/work_product.rs` `export_view` (citation `value` is withheld only for quotes); compare `crates/api/src/work.rs:975-987` (24.1: a fact value is shown only when one of its sources is an exact original the viewer may read now — "21.6: knowledge never grants the original").
- **Scenario:** A fact's value was read from a quote of original O. Viewer V can no longer read O. In the Task work panel, V sees the fact with `value_withheld = true`. In the work product, V sees "Fact … of S: 1250.00 EUR" in the support line, `value: "1250.00"` in the API assertion, and the same value in the DOCX/XLSX Citations appendix. The export's withheld set has only quote originals, so V's own export and V's download both pass. The spec's support endpoint is "values withheld by the viewer's current access", and its Never list forbids a source's content shown to a viewer who cannot read it now.
- **Fix:** For each fact pin, find the fact's sources and apply the same `exact_original` rule as `work.rs`. Withhold the value in the support line, the API assertion and the export. Put those originals in `withheld_originals`, so the export's withheld digest and the download check include them.

### H3. The only verdict check is bypassed by adding any non-quote assertion. A claim can say "the control passed" while it rests only on a quote and a `period` (or a `fact`).

- **Where:** `crates/application/src/work_product.rs:906-917` (`verdict_without_record` only when **every** pin is a quote); `crates/domain/src/work_product.rs` `Pin::renderings` (`period` and `fact` give no verdict).
- **Scenario:** The I/O row "Quote-only verdict" is refused: "the control passed" with one `quote`. The model adds `period{basis-…}` (any basis of the Task) to the same claim. Now not every pin is a quote, so no verdict check runs, the figure rule finds no figures, and the version is recorded with a verdict sentence that no outcome, conclusion or exception record supports. The same works with any `fact` assertion. The rule exists so that a verdict needs a verdict record; a `period` or `fact` pin is not one.
- **Fix:** Refuse a verdict word unless the claim has at least one `outcome`, `conclusion` or `exception` assertion (the assertion kinds that hold a verdict). Add the quote + period and quote + fact cases to the tests.

## Medium

### M1. A claim's sentence is never checked against the verdict, conclusion or status that its own assertions hold. The spec's own problem example ("no exceptions" beside an inconclusive summary) is still recorded.

- **Where:** `crates/application/src/work_product.rs:861-919` (the `claim` closure checks only figures and, for quote-only claims, verdict words).
- **Scenario:** Claim "No exceptions were found." with `conclusion{summary-…, exceptions_found_inconclusive}` passes every check: the conclusion equals the record, the sentence has no figures, and not all pins are quotes. Also "The criterion was met for INV-0042" with `outcome{eval-…, not_met}` passes. The platform's support line shows the true value, but the sentence that a reader reads says the opposite. This matches the spec's literal rule set, but not its Problem ("A drafted paper today could state 'no exceptions' beside a summary that says inconclusive, and nobody would see it") or "the records must say what the claim says".
- **Fix:** Owner decision. A cheap, mechanical guard: when a sentence uses a verdict word from the closed list (or "no exception(s)"), require an assertion whose value is that verdict (`met` ↔ outcome `met` / count `met`; "no exception" ↔ conclusion/exception status that states none), else `outcome_mismatch`/`conclusion_mismatch`. At least show a contradiction marker on read.

### M2. A pure-number record subject anywhere in the version exempts that number from the figure rule in every claim.

- **Where:** `crates/application/src/work_product.rs:726-764` (`identifiers` adds every head, fact and exception subject of the whole version with `add_record`); `crates/domain/src/work_product/figures.rs:241` (`allow_numbers && identifiers.contains_number(token)` in claim statements).
- **Scenario:** Subjects are customer data and are often numbers (`000123`, employee number `250`). Claim A pins `outcome` for subject `250`. Claim B pins `count(not_met)=15` and says "250 invoices had no approver". "250" is not one of B's checked values, but it resolves as an identifier, so B is recorded. The spec says each figure must be a value "asserted by that claim"; the owner's exception is for identifier tokens, not for a number used as a count.
- **Fix:** Build the pure-number set per claim, from that claim's own pins only (and, better, only when the token is the pin's subject text exactly and is not used where a count would stand). Keep the version-wide set for tokens with a letter.

### M3. Large or numerous work products are left out of the agent's context, so the agent cannot keep a person's block and can never refresh that product.

- **Where:** `crates/application/src/work_product.rs:2079` (budget 16 KiB − 4 KiB − 1 KiB = 11,264 bytes), `:2083` (`MAX_MESSAGE_PRODUCTS = 4`), `:2164` (a product whose part does not fit is skipped whole); `:1101-1120` (`dropped_human_blocks`).
- **Scenario:** One claim block's line plus its 160-byte envelope is about 500–700 bytes, so about 16–20 blocks fit. A working paper with 30 blocks (64 are allowed, 48 claims are allowed), or the 5th to 16th product of a Task, is shown only as "N more work products are not shown block by block". The agent has no block IDs. If a person has edited that product, every draft is refused `human_block_dropped`, because the agent cannot name the blocks it must keep. The outline still says "N need refresh", so the agent keeps trying. The product can then be refreshed only by a person (who cannot add assertions).
- **Fix:** Always list every block ID, author and refresh state (a few dozen bytes each, without text) for every product, and bound only the text. Or let a draft say "keep every person's block" and have trusted code add them. Add a test with a 64-block product that has a human block.

### M4. An export retry after a partial failure records a digest that does not match the stored object; the export key then fails integrity for ever.

- **Where:** `crates/application/src/work_product.rs:2732-2749` (`put_if_absent`; on `AlreadyExists` it takes `latest_version` and keeps the newly computed `digest`/`size`); `export_id(actor, key)` has no scope part.
- **Scenario:** First request: the object is stored, then `record_export` fails (DB unavailable, fence, timeout). The person retries with the same key (the client keeps the key for a retry). Meanwhile one claim became stale, or an editor's display name changed, so the new bytes differ. `put_if_absent` returns `AlreadyExists`; the row is written with the new digest and size but the old object version. Every download returns `work_product_export_integrity`, and the key cannot be used again. The same happens if one actor uses one key in two engagements (`export_id` hashes only actor and key).
- **Fix:** On `AlreadyExists`, read the stored object and use it only when its digest equals the new bytes; otherwise refuse with a retryable conflict (or put the digest into the object name). Include the scope in `export_id`.

### M5. A claim's sentence is shown to every viewer, even when it restates a quote that the viewer may not read.

- **Where:** `crates/api/src/work_products.rs:487` (`block_response` returns the statement), support response `statement`; `crates/application/src/work_product.rs` `export_view` (`statement: statement.clone()`); the figure rule allows every figure of a quote in the sentence (`Pin::renderings`, `Renderings::text`).
- **Scenario:** The agent writes "The contract states payment terms of 45 days and a cap of 2,500,000." with one quote of original O. Viewer V cannot read O. The quote is "withheld for this viewer" in the support line and the citation, but the sentence above it holds the same content, in the web, the API and V's own export (whose withheld set matches, so V may download it). The spec's Never list: "a quote shown to a viewer who cannot read its original now".
- **Fix:** When any quote pin of a claim is withheld for the viewer, withhold the claim's sentence too (show "withheld for this viewer"), in the view, the API and the export.

### M6. Coverage and exceptions blocks accept and keep showing a superseded summary or basis without any marker.

- **Where:** `crates/application/src/work_product.rs:1038-1050` (`Coverage` checks only `records.summary(id).is_some()`, not `superseded`; `Exceptions` checks only that the basis exists); `view_of` renders their lines with no currency; `currency` covers claims only.
- **Scenario:** A newer summary of the same population supersedes S1. The agent places `coverage{S1}`, which a `count` claim on S1 would refuse with `superseded_support`. The version is recorded and shows "Population complete · 1,000 in scope … Conclusion: …" from the old summary, as current, in the document and the export. A coverage block placed before the supersession also never shows that it is out of date. Spec: "opening a version never presents a stale claim as current"; platform coverage lines are what readers trust most.
- **Fix:** Refuse a superseded summary/basis in a new coverage/exceptions block (`superseded_support`), and on read show "superseded by a newer summary" on such blocks and count them with the claims needing refresh.

### M7. The figure rule misses digits that are not in its Unicode 15.1 table, numerals that are not `Nd`, and the version title.

- **Where:** `crates/domain/src/work_product/figures.rs:13-20` (`ND_ZEROS`, generated from Unicode 15.1); `has_digit` uses only that table; `crates/application/src/work_product.rs:1260` (the title is checked only by `valid_title`).
- **Scenario:**
  - Unicode 16.0 added `Nd` blocks (for example the outlined digits at U+1CCF0, and Garay, Sunuwar, Kirat Rai, Gurung Khema digits). They are not in the table, so a narrative or claim with them passes. The spec says "any Unicode `Nd`".
  - Superscript, circled, fraction and Roman numerals (`³`, `①`, `½`, `Ⅻ`; category `No`/`Nl`) pass in narrative and judgment text.
  - The title is model text shown on the shelf, as the DOCX title and in XLSX, and it may hold any figure: "15 of 1,000 invoices had no approver" with no record behind it.
  - Number words ("about twenty items failed") pass; this is the spec's own I/O example in words. This part is an owner decision.
- **Fix:** Derive the digit test from the toolchain (`char::to_digit` is ASCII-only, so use a generated table pinned to the Rust `char` Unicode version, with a test that compares it with `char::is_numeric` for `Nd`), refuse any `is_numeric()` character outside an identifier in narrative/judgment, and apply `narrative_figures` to the title.

## Low

### L1. A decimal's sign is never checked.

`Renderings::decimal` (`figures.rs:192`) inserts only the unsigned forms, and `tokens` trims a leading `-` (not alphanumeric). A fact value `-1250.00` supports "a gain of 1,250.00", and `1250.00` supports "−1,250.00". Fix: keep the sign in the token and render the signed value; require the sign to match.

### L2. "Same version + format + withheld set → identical bytes" is not true over time.

The bytes also depend on currency now (refresh lines) and on editors' current `display_name` (`labels`). The OpenAPI text promises identical bytes. Fix: say "identical bytes for the same version, format, withheld set, refresh state and editor names", or freeze the labels in the version.

### L3. The XLSX `SUM` does not prove anything about the stored total.

`view_of` computes `total` as the sum of the same four partition cells the formula sums, so the cached value equals the formula by construction, not the summary's stored `in_scope`/`selected`. Fix: use the stored total and refuse the export if the partition does not add up to it.

### L4. The download route does not check that the export belongs to the product in the URL.

`download` reads the export by Task and ID only; `product_id` in the path is ignored, so `/work-products/{B}/exports/{x-of-A}/content` serves A's export. No scope leak (same Task, same withheld check), but the URL lies. Fix: compare the export's version's product with the path.

### L5. The agent-written title is placed in the platform-facts message without the untrusted-content envelope.

`products_text` writes `title` as escaped JSON inside the "platform facts" message, while block text is enveloped as model output. A title is ≤200 characters of model text. Fix: envelope it like block text.

### L6. `source_withdrawn` is effectively unreachable.

Currency compares only the original's stored digest, and `evidence_originals` rows are immutable, so a quote never becomes stale; a 21.4 source correction or a knowledge withdrawal does not mark the claim. Fix (owner decision): derive `source_withdrawn` from source correction/withdrawal records, or re-verify the quote on read.

## Checked and not found

- XLSX formula injection: every text cell is `t="inlineStr"`; the only `<f>` is the fixed `SUM(Cn:Cm)`.
- DOCX/XLSX XML injection: `xml()` escapes `& < > "` and replaces forbidden controls; sheet names, anchors and part names are fixed or numeric.
- ZIP: stored entries, fixed time and order, CRC-32, bounded size; `unzip` bounds every read.
- SQL record agreement: every assertion kind is recomputed in `work_product_batch` inside `coalesce(…, false)`; kept blocks are compared byte for byte at commit; the agent cannot drop or change a person's block (both in Rust and in `work_product_complete`).
- Human authority: `knowledge_audit` plus `evidence_session_locked` in the guard; a worker has no session; the replay path calls the fence before it returns a stored version.
- Stale base: Rust pre-check plus the per-product advisory lock and `predecessor_id` unique key.
- No numeric confidence and no percentage column or field.
