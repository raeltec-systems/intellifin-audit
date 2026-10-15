---
title: '24.4 — Create firm-shaped work products with supported claims'
type: 'feature'
created: '2026-10-15'
status: 'ready-for-dev'
baseline_commit: '1819622e4c58ec5e4f6caf5ca4db83be4b6b370c'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/spec-24-1-bind-typed-criteria-and-facts-to-an-assessment-basis.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-24-2-show-exact-population-sample-and-coverage-denominators.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-24-3-revise-evaluations-without-overwriting-facts-or-exceptions.md'
  - '{project-root}/_bmad-output/planning-artifacts/zobba-product-architecture-2026-09-30/Zobba-Product-and-Architecture-Design.md'
  - '{project-root}/zobba/README.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** After 24.1–24.3 a Task holds verified facts, evaluation chains, coverage summaries, dispositions and exceptions, but its only output is a cited conversation answer (`CitedAnswer`, `domain/src/citation.rs:335`). There is no working paper: no stable document with claim identifiers, no link from a sentence to the exact evaluation or count it states, no firm template, no shelf, no export, and nothing that notices when a cited evaluation is revised. A drafted paper today could state "no exceptions" beside a summary that says inconclusive, and nobody would see it.

**Approach:** The agent drafts the work product itself, natively, as it does its other work: it chooses the bound firm template, writes the sections, and writes each claim in its own words with the exact records the claim rests on. Trusted code — not the model — checks every claim against those records before a version is recorded: stated outcomes, counts, statuses, fact values and quotes must equal the records, and every figure in a claim's sentence must be one of the checked values. Prose that is not a checked claim is recorded only as labelled "Zobba's judgment" or narrative and may carry no figures. Versions are immutable; claim currency (current / needs refresh) is derived on read from the pinned record identities. A person edits a draft by creating a new version. Exports are rendered by trusted code from one exact version and carry its identity, citations, coverage and limitations.

## Boundaries & Constraints

**Always:**
- **Work product** (new `work_products`, Task-scoped, immutable): ID, Task, title (1–200 scalars, scope-label rules), kind closed `working_paper | analysis | finding_summary | report_draft`, template = `{methodology binding ID, template id, template version, source_version_id}` resolved from the Task's *current* binding (`domain::methodology::ResolvedTemplate`, read like `method_part`); the built-in neutral starter is allowed and always labelled "Neutral starter (not firm methodology)". A template not in the binding is refused.
- **Version** (new `work_product_versions`): product, `version` n (1 = no predecessor), `predecessor_id` = head at write time (one successor per head, per-product advisory lock; a write naming any other base is refused naming the head), author origin `agent{invocation}` | `human{actor}`, ordered blocks, canonical document digest (RFC 8785-style canonical JSON through the existing domain serialiser), `missing_required` (template section IDs that are required and empty), binding ID + execution epoch, database time. Never edited.
- **Blocks** (≤64 per version, each with a stable block ID that survives versions, its template section ID, `author_kind agent|human`, `author_id`, `authored_in_version`): `heading{text}`; `narrative{label: judgment | narrative, text ≤4,000 bytes}`; `claim{statement ≤1,000 bytes, assertions 1–8}`; platform blocks the agent only *places* and trusted code renders: `coverage{summary id}`, `exceptions{basis id}` (24.3b), `limitations` (one per version; appended by trusted code if absent). A version holds ≤48 claims; the whole draft ≤64 KiB.
- **Assertions** (closed; each pins record ID + record digest + the asserted canonical value): `outcome{evaluation id, verdict}` — the ID must be the current chain head (24.3a) and the verdict its *effective* outcome including disposition and origin label; `count{summary id, measure, criterion?, value}` — measure closed over the 24.2/24.3b summary fields (`received_rows, distinct_subjects, in_scope, selected, excluded, scope_unknown, applicable, not_applicable, met, not_met, undetermined, execution_failed, not_evaluated, failing_subjects, failing_opportunities, meets_every_applicable, unresolved`), value equal to the stored exact count; `conclusion{summary id, code}` equal to the stored closed conclusion; `exception{exception id, status}` equal to the derived status (24.3b); `fact{fact id, value}` equal to the 24.1 typed canonical value of a supported, grounded fact; `quote{citation source}` verified now by `application::citation::verify` (whole value, 24.1 rule); `period{basis id}` (the basis civil period, so dates may be stated). Same-Task records only.
- **Statement figures** (rule `statement_figures_v1`, pure domain fn): every maximal run of digits (with `,` `.` grouping/decimal and `-` date separators) in a claim statement must equal, after normalisation, a rendering of a value asserted by that claim (count, decimal, date, period bound). Narrative and judgment text may contain **no** decimal digit (any Unicode `Nd`); figures belong in claims. A claim whose assertions are all `quote` cannot state a verdict word from the closed list (`met`, `not met`, `no exception`, `exception`, `pass`, `fail`, `compliant`), case-insensitive whole words.
- **Recording.** New answer field `draft_work_product` (≤1 per answer): `{product? (absent = new), title, kind, template{id, version}, base_version?, blocks:[{keep: block id} | new block]}`. Trusted code verifies every new claim, keeps referenced blocks byte-for-byte (original author and support pins), and records the version only if *all* checks pass; otherwise nothing is recorded and per-block feedback (block index, closed reason: `outcome_mismatch`, `count_mismatch`, `conclusion_mismatch`, `status_mismatch`, `fact_mismatch`, `quote_unverified`, `superseded_support`, `unsupported_figure`, `figure_in_narrative`, `verdict_without_record`, `unknown_record`, `stale_base`, `template_unbound`, `section_unknown`, `human_block_dropped`, `bound_exceeded`) goes back inside the untrusted-content envelope. The agent may not change or drop a human-authored block; it keeps it by ID. Model-controllable input never fails a cycle.
- **Claim currency** (pure `domain::work_product::currency(pins, current) -> Current | RefreshNeeded{reasons}`, derived on read, never stored): `evaluation_revised` (head moved), `disposition_changed` (effective outcome changed on the same head), `summary_superseded` (a newer summary or effective summary of the same population lineage), `exception_status_changed`, `fact_superseded` (a successor basis replaced the fact, 24.3a), `source_withdrawn` (quote no longer verifies). A source the *viewer* may not read now is `withheld` (24.1 `value_withheld`), never stale. The shelf, version view and agent outline show exact counts of claims needing refresh; opening a version never presents a stale claim as current. Refresh is the agent drafting a successor version (Guide or its own initiative); nothing rewrites a version.
- **Coverage and limitations visible.** Each `count`/`conclusion`/`outcome` claim shows a platform coverage line from its summary or basis (completeness words "at least N found" / "not known", sample "selected items only", 24.2 rules). The limitations block lists every cited summary's limitation codes in words, basis limitations, exception "not observed in the latest revision; this is not evidence of remediation" sentences, `missing_required` sections and claims needing refresh — all from records, none from the model.
- **Human edit** (POST `/engagements/{e}/tasks/{t}/work-products/{p}/versions`, Origin, CSRF, `X-Expected-Actor`, session-bound key, strict body `{base_version, blocks}`): currently assigned Auditor or Audit manager (24.3a disposition authority; Admin alone refused), rechecked in the write transaction. A person may edit narrative/heading text, edit a claim's statement (its assertions kept and re-verified, figures rechecked), remove or reorder blocks. Same verification as the agent; a refusal is 409 with the same closed reasons. Stale base → 409 `stale_base` naming the head (merge is 24.6). No second approval ceremony.
- **Shelf and inspection.** GET `/engagements/{e}/work-products?cursor=` and `/…/tasks/{t}/work-products` — exact count, C-ordered 50 page, only Tasks the viewer may see now: title, kind, version n, originating Task, review state word **Draft** (24.5 adds others), claims needing refresh, missing required sections. GET version detail and GET `/…/versions/{v}/claims/{block}/support` (pinned and current record view, values withheld by the viewer's current access). Web: shelf in the Task panel; document view by template section; claim → citation chip → support/evidence preview (`Citation.tsx`) → Back to claim restores the claim selection and keyboard focus; a newer version is announced, never swapped in (UX-DR44); "Zobba's judgment — not checked against records" label on judgment blocks; accessible structured editor (native controls, byte counters, focus return); WCAG 2.2 AA.
- **Export** (POST `/…/versions/{v}/exports` `{format: docx|xlsx, key}`, any viewer who may see the Task): rendered in process by trusted deterministic Rust (renderer `zobba-export-v1`, in-house stored ZIP + CRC-32 and minimal OOXML, no new crate), from the exact version only. Contents: title; "Source revision: <version ID> · version n · sha256 <digest>" on the first page and in the footer; page numbers (DOCX footer PAGE field); every template section in template order, required-but-empty ones as "Not completed in this version."; claims numbered with `[n]` internal links to a Citations appendix (record kind, ID, digest; for quotes the original's filename, locator and quote, or "withheld for this viewer"); claims needing refresh at export time marked "Needs refresh: <reason>"; coverage and limitations; "Preparation and review: Prepared by Zobba (agent)[; edited by <names>]. Review state: Draft — not reviewed." XLSX: sheets `Work product`, `Claims`, `Citations`, `Coverage` (exact counts; one `SUM` formula whose cached value equals the stored total); every text cell is an inline string, never a formula. Same version + format + withheld set → identical bytes. Bytes go to the evidence object store under the export ID; new `work_product_exports` records version, format, renderer, withheld digest, digest, size, namespace/version, requester, time, refresh count. GET `/…/exports/{x}/content` re-verifies size/digest and requires the viewer's current withheld set to equal the export's (else 409 `export_scope_changed`).
- **Migration 0022 `work_products.sql`** (additive; 0001–0021 and catalogues v1–v21 byte-unchanged): `work_products`, `work_product_versions`, `work_product_blocks`, `work_product_assertions`, `work_product_exports`. Immutable (UPDATE/DELETE refused; TRUNCATE only under `zobba.disposable_fixture_reset=on` in a `*_test` database), forced RLS, runtime SELECT/INSERT, guards: claim custody (agent) or human authority (scoped function), same Task for every pinned record, base = head under the advisory lock, version n = predecessor + 1, closed vocabularies and bounds, and **record agreement recomputed in SQL** — `outcome` against the head/effective-outcome function of 24.3a, `count`/`conclusion` against the summary columns, `exception` against the 24.3b status function, `fact` against the stored canonical value; kept blocks byte-equal to their source block. `SCHEMA_VERSION` 22, `schema-v22.catalog`, inventory lists/grants/function checks, `published.rs` pins 0021/v21.
- Old answers decode with unchanged bytes and schema digests; the investigation outline gains one exact-count work-product line per product (version, claims needing refresh, missing required).

**Ask First:** Any new crate or Python wheel (PDF writer, fonts, zip); PDF output; firm DOCX/XLSX template files (logos, styles, cell maps); human-created assertions; an agent dropping human blocks; issue, review or recipient features (24.5); merge of concurrent edits (24.6); any live provider run.

**Never:** A recorded version containing an unchecked claim; a model-written count, verdict, status, coverage line or limitation; figures in narrative; numeric confidence; silently presenting a stale claim as current; editing or deleting any version, block, assertion or export; an export rendered from anything but one exact version; a quote shown to a viewer who cannot read its original now; screenshot-only papers; arbitrary Office round-trip claims; a compiled step pipeline; live provider calls in tests.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| AC1 publish | 24.2 AC2 fixture; agent drafts AP working paper on the bound template; claim "15 of 1,000 applicable invoices had no recorded approver" with `count(not_met, A)=15`, `count(applicable, A)=1000` | v1 recorded, Draft on shelf; claim current, coverage line "population complete"; limitations lists `exceptions_found_inconclusive`, unresolved 20 | N/A |
| Wrong figure | statement says "14 of 1,000" | nothing recorded; feedback `unsupported_figure` (block 3) | no cycle failure |
| Wrong value | `count(not_met, A)=14` | `count_mismatch` naming the stored 15 | nothing recorded |
| Verdict mismatch / superseded | `outcome(INV-0042, met)` while head is `not_met`; or cites revision 1 after revision 2 | `outcome_mismatch`; `superseded_support` naming the head | nothing recorded |
| Figures in prose | judgment narrative "about 20 items failed" | `figure_in_narrative` | nothing recorded |
| Judgment prose | narrative label judgment, no digits | recorded; shown "Zobba's judgment — not checked against records" | N/A |
| Quote-only verdict | claim "the control passed" with only a `quote` | `verdict_without_record` | nothing recorded |
| Missing required section | template section `conclusion` required, empty | recorded; `missing_required=[conclusion]`; shelf and export say "Not completed in this version." | N/A |
| Unbound template | template not in current binding | `template_unbound` | nothing recorded |
| AC3 refresh | after v1, 24.3a revision 2 changes INV-0042; later an auditor `replaced` another; a new summary supersedes | v1 opened: those claims `needs refresh` with `evaluation_revised` / `disposition_changed` / `summary_superseded`; shelf count 3; v1 bytes unchanged | N/A |
| Withheld source | viewer lost access to an original | quote "withheld for this viewer", claim not stale; export records withheld digest | N/A |
| Human edit | assigned auditor edits narrative, removes a claim | v2 author human, kept blocks unchanged with their authors | stale base → 409 `stale_base` naming head; Admin-only / unassigned → 403 |
| Agent drops human block | v3 omits a human block | `human_block_dropped` | nothing recorded |
| AC2 DOCX export | v2, docx | source revision line + footer, page numbers, required sections, `[n]` links to appendix, limitations, "Draft — not reviewed"; repeat export identical digest | object store failure → retryable 503, nothing recorded |
| XLSX export | v2, xlsx; a statement begins with `=` | inline string, not a formula; `SUM` cached value equals stored total | N/A |
| Stale-at-export | export of v1 with 3 refresh claims | marked "Needs refresh: …"; export row refresh count 3 | N/A |
| Download scope | another viewer with a different withheld set | 409 `export_scope_changed`; they request their own export | N/A |
| Forged row | INSERT of an assertion whose count differs from the summary | database refuses, message names the assertion | N/A |
| Old answers | 24.3 answers | decode, bytes and schema digests unchanged | N/A |

</frozen-after-approval>

## Code Map

- `zobba/crates/domain/src/citation.rs:335-375` -- `CitedAnswer`; add `draft_work_product` (≤1) beside the 24.1/24.2 fields; keep old-answer decode and schema digests.
- `zobba/crates/domain/src/assessment.rs:69-192` (`vocabulary!`, outcome vocabularies), `:1668` `output_digest`, `:1793` `answer_fields`/`:2050` decode pattern -- copy for the new vocabularies and decoder. `zobba/crates/domain/src/coverage.rs:1048-1130` -- `Partition`, `Summary`, `Conclusion`, `conclusion` (the measures a `count` assertion may name). `domain::revision` (added by 24.3a/24.3b) -- `effective`, `exception_status`.
- New `zobba/crates/domain/src/work_product.rs` (+ `work_product/tests.rs`, `lib.rs` module, `SCHEMA_VERSION` 22 at `lib.rs:24`) -- types, bounds, canonical digest, `statement_figures_v1`, verdict-word list, `currency`. New `zobba/crates/domain/src/work_product/export.rs` -- deterministic stored-ZIP/CRC-32 writer, DOCX and XLSX writers (pure: version view in, bytes out).
- `zobba/crates/domain/src/methodology.rs:213-232,359-362,549-570` -- `TemplateSection{required}`, `TemplateDefinition`, `ResolvedTemplate`, neutral starter. `zobba/crates/application/src/investigation.rs:527,634` -- read the current binding like `method_part`; add the product outline line.
- `zobba/crates/application/src/assessment.rs:66` `ASSESSMENT_CONSTRAINTS` (add a work-product paragraph), `:225` `AssessmentStore`, `:1403` `after_answer` (call the new hook after assessment records), `:2174` `feedback_text` (reuse envelope), `:2278` `outline`. New `zobba/crates/application/src/work_product.rs` -- record verification (calls `citation::verify` at `application/src/citation.rs:135`), human edit command, export command; `application/src/evidence.rs:53` `EvidenceObjects` for export custody.
- `zobba/crates/infrastructure/src/assessment.rs:66` `claimed`, `:79` `scoped`, `:659` `view` -- patterns; new `infrastructure/src/work_product.rs` (repository, head lock, shelf cursor, currency reads). 24.3a disposition repository (added by 24.3a) -- human authority/key pattern; `infrastructure/src/task.rs:146` `wake` not needed.
- `zobba/migrations/0018_assessment_basis.sql:234-373`, `0019_assessment_coverage.sql:277-607` -- guard, recount, immutability, fixture-reset patterns; `0020`/`0021` (added by 24.3a/24.3b) -- head and effective/status SQL functions the 0022 guard calls.
- `zobba/crates/infrastructure/src/lib.rs:124,131,154,533-536,590-596,635,1708` -- inventory lists, function checks, catalogue chain (`schema-v22.catalog`). `zobba/crates/infrastructure/tests/published.rs` -- pin 0021/v21.
- `zobba/crates/api/src/tasks.rs:79-104` -- route registration; `api/src/work.rs:180,342,947` -- `TaskWorkResponse` (add bounded products with exact totals) and `value_withheld`; 24.3a disposition handler (added by 24.3a) -- mutation-scope pattern. New `api/src/work_products.rs`; `openapi.json`; `web/src/generated/api.ts`.
- `zobba/web/src/TaskWorkPanel.tsx`, `AssessmentBasis.tsx`, `Coverage.tsx`, `Citation.tsx` -- new `WorkProducts.tsx`, `WorkProductDocument.tsx`, `work-product.ts`; tests beside `web/tests/assessment.test.mjs`, `web/tests/browser/coverage.spec.ts`.
- `zobba/fixtures/documents/generate.py` -- AP firm template fixture (sections, one required) and expected export facts JSON.

## Tasks & Acceptance

**Execution:**
- [ ] `zobba/crates/domain/src/work_product.rs` (+ tests) -- vocabularies, bounds, digest, figure rule, verdict words, currency; every matrix row's pure part; determinism by repeat digest.
- [ ] `zobba/crates/domain/src/work_product/export.rs` (+ tests) -- ZIP/CRC-32 (check against known vectors), DOCX/XLSX writers; byte-identical repeat; formula-injection and section tests.
- [ ] `zobba/crates/domain/src/citation.rs` -- `draft_work_product` field, schema bounds, old-answer compatibility.
- [ ] `zobba/crates/application/src/work_product.rs` + `assessment.rs` hook/outline -- verification, keep-by-ID, envelope feedback, human edit and export commands.
- [ ] `zobba/migrations/0022_work_products.sql`, `infrastructure/src/work_product.rs`, `schema-v22.catalog`, `lib.rs`, `published.rs` -- tables, guards with SQL recomputation, immutability, RLS; PostgreSQL tests: fork refusal under concurrency, forged assertions, stale base, authority, reset exception.
- [ ] `zobba/crates/worker/tests/work_product.rs` -- synthetic-model end-to-end: AC1 publish, each refusal reason, AC3 refresh after a 24.3a revision, keep-by-ID of a human block.
- [ ] `zobba/crates/api/src/work_products.rs` + `openapi.json` + generated client -- shelf, detail, support, edit, export, download; tests for authority, idempotent/conflicting retry, withholding, scope-changed download.
- [ ] `zobba/web/src/` shelf, document view, editor (+ unit, browser case: claim→citation→evidence→back with focus, keyboard edit, contrast).
- [ ] `generate.py` outputs; a test unzips each export and checks the XML for source revision, sections, citation anchors and cached formula value; `zobba/README.md` -- what is proven offline.

**Acceptance Criteria:**
- Given a recorded version, when any claim is recomputed against its pinned records, then every assertion agrees and every figure in its statement is one of its asserted values.
- Given a supporting record changes after publication, when the version is opened, then the affected claims show needs refresh with a closed reason and the version bytes are unchanged.
- Given an export, when its bytes are inspected, then they name the exact source version and digest, keep every required template section, and resolve every `[n]` to a citation entry.
- Given any work-product row, when UPDATE or DELETE is attempted outside the fixture reset, then the database refuses it.

## Design Notes

The agent writes; trusted code checks. A claim is a sentence plus the records it rests on, and the check is mechanical only at the boundary: the sentence's figures must be values the records hold, and the records must say what the claim says. Everything else (structure, wording, which claims to make) is the agent's.

```text
claim C3 (section "results"):
  "15 of 1,000 applicable invoices had no recorded approver."
  assertions: count{sum-…9, not_met, crit-A, 15}, count{sum-…9, applicable, crit-A, 1000}
  platform line: Population complete · 1,000 applicable · unresolved 20 (see Limitations)
```

24.1–24.3 lessons applied: whole-value verification; record agreement recomputed in SQL; feedback in the envelope; viewer-scoped values; exact queries for heads, never bounded lists; model mistakes become feedback.

Size: about 6,900 tokens, far above the 1,600 target (24.1–24.3 were also large). **[S] Split** (recommended, same reason as 24.3): **24.4a** = work products, verified claims, shelf, currency, human edit, inspection (migration 0022/v22); **24.4b** = DOCX/XLSX exports and export identity (migration 0023/v23 for `work_product_exports`). Exports only read immutable versions, so 24.4a ships complete without them. **[K] Keep** as one story with one migration 0022.

## Verification

**Commands:**
- `cargo fmt --all --check && cargo clippy --workspace --all-targets -- -D warnings` -- expected: clean.
- `cargo test --workspace --locked -- --test-threads=1` on a guarded `_test` database -- expected: all pass.
- `pnpm --dir zobba/web check` and the work-product browser case -- expected: pass with accessibility and contrast checks.

**Manual checks:**
- Open the fixture DOCX and XLSX exports in Word/LibreOffice and Excel: pagination, footer revision line, working `[n]` links, `SUM` value, no formula from text.

## Open Questions (owner decisions)

**Owner decisions (2026-10-15):** kept as ONE story (K, owner's choice; single migration 0022/v22). Decisions 2–7 approved as recommended (independent advisor agreed): in-house Rust DOCX/XLSX writer in the API process, no new crate, byte-identical; no PDF in 24.4 (named follow-up); no digits in narrative/judgment blocks, EXCEPT closed identifier tokens that resolve to a record or template section (e.g. criterion labels `A1`, standard references `ISA 315`, `FY2025` in a heading); human edits text and claim sentences (rechecked), removes/reorders blocks, new assertions come from the agent via Guide; the agent may never change or drop a human block; an export is downloadable only by a viewer whose current withheld set matches the export's. Condition: CI must open the fixture DOCX and XLSX in LibreOffice headless (not only unzip/grep).

1. **Split.** (a) Recommended **S**: 24.4a then 24.4b, as above. (b) **K**: one story.
2. **How exports are rendered.** (a) Recommended: in-house deterministic Rust writer (stored ZIP, CRC-32, minimal OOXML) in the API process — no new crate, reproducible digest, no sandbox job. (b) A trusted render program in the 22.4 sandbox with the approved python-docx/openpyxl; needs a new collection path because 0015 descendant media types exclude Office files.
3. **PDF.** (a) Recommended: not in 24.4; a named follow-up story (accessible tagged PDF needs a library or a large in-house writer); users save DOCX as PDF meanwhile. (b) In-house minimal PDF now (WinAnsi text only, untagged, refused for other characters). (c) Add a pinned PDF wheel and open font to the analysis image.
4. **Figures in prose.** (a) Recommended: no digits in narrative/judgment; figures only in checked claims. (b) Allow digits in narrative, with the whole block labelled unverified.
5. **Human editing scope.** (a) Recommended: edit text, edit claim statements (re-verified), remove/reorder; new assertions come from the agent via Guide. (b) Full human claim authoring with a record picker.
6. **Agent and human blocks.** (a) Recommended: the agent keeps human blocks by ID and may not change or drop them. (b) The agent may drop them, listed in a change summary.
7. **Who may download an export.** (a) Recommended: any viewer whose current withheld set equals the export's; others render their own. (b) Exports always render every quote withheld and anyone on the engagement may download.
