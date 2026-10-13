---
title: '22.5 — Extract usable facts with stable source locations'
type: 'feature'
created: '2026-10-13'
status: 'draft'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-22-context.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-22-4-run-measured-analysis-in-an-isolated-workspace.md'
  - '{project-root}/zobba/README.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Zobba cannot read the documents auditors actually receive — spreadsheets, Word files, emails, text PDFs, scanned PDFs and photos — into facts that say exactly where each value came from. Without stable locators and honest limitations, later evaluation cannot cite or check anything.

**Approach:** Two readers, one fact model. Deterministic parsers (XLSX, DOCX, email, CSV, PDF text layer) run as a server-owned, versioned extractor in a second 22.4 sandbox image; they also render image-only pages to page images. Scanned pages and photos are read natively by the qualified model (as Claude Code and Codex do — no OCR engine, no numeric confidence scores), one page per request, as a recorded disclosure. Every fact carries its source locator, extractor or model version, input digest and how it was read; limitations are explicit words, never silent gaps. The full result is a separate descendant artifact; previews are bounded.

## Boundaries & Constraints

**Always:**
- One fact model: value text, locator (`page`, `sheet!cell` or cell range, `paragraph`/table cell, `message part`/header, byte range), `read_by` = `parser:<name>@<version>` or `model:<provider>/<model>@<profile>`, input original id + digest, and zero or more closed limitations (unreadable, cut_off, ambiguous, structure_unavailable, truncated, unsupported_format, formula_without_cached_value, encrypted, mismatch_between_readers).
- Parser output is the authority for exact values in structured formats; formulas report their cached value and say so, never recalculate. Model-read facts are labelled as model readings and carry the model's own stated limitations; they never become parser-grade facts.
- Where a page has both a text layer and a model reading, compare them and record `mismatch_between_readers` on facts that differ; neither silently wins.
- The extractor program is server-owned (constant or baked into the pinned image, versioned, its SHA bound into the operation); the model never writes it. Extraction is admitted by a trusted server path, not a model tool.
- Model reading reuses 22.1 disclosure custody: one `Send` operation per page with the page image as an attachment bound by digest and the original's classification; the profile must be qualified and support image input and strict structured output. Add image input parts to the model request types and the OpenAI encoder only; the Anthropic encoder refuses them as unsupported until qualified. Size bounds are explicit and per page.
- Full result (all facts, locators, limitations, reader versions) is one JSON descendant; previews are bounded to the existing preview limits and say when they are partial.
- Hostile or oversized input fails the job safely with a closed reason (zip bomb, too many pages/sheets/cells/parts, encrypted, malformed, timeout) and registers no partial facts as complete; macros, external links and embedded objects are never executed or fetched.

**Ask First:** Any parser library beyond those needed for XLSX, DOCX, EML, CSV and PDF text/page rendering; any per-page model request above 4 MB image or 200 pages per document.

**Never:** An OCR engine or numeric confidence scores; macro execution; lossless Office editing; sending a whole document to the model in one request; model-written extraction code; any live provider call in tests (fixtures only, using the existing synthetic transport).

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| XLSX table | sheet with values, a formula, merged cells | facts per cell with `Sheet1!B4`; formula fact uses cached value + limitation | N/A |
| DOCX | paragraphs and a table | facts with paragraph / table-cell locators | N/A |
| Email | .eml with headers, body, attachment | header and body facts with part locators; attachment listed, not parsed | N/A |
| Text PDF | PDF with text layer | facts with page locators from the parser | N/A |
| Scanned PDF | image-only pages | page images rendered; one model read per page; model facts with page locators and stated limitations | unreadable region → `unreadable`, not a guess |
| Both readers disagree | text layer says 1,250.00, model reads 1,280.00 | both facts kept, `mismatch_between_readers` | N/A |
| Hostile file | zip bomb, 10k-sheet XLSX, encrypted PDF, macro file | job fails safely with closed reason; no fact registered as complete | bounded by sandbox limits |
| Model refusal or failure | provider error or invalid structured output | page marked `unreadable` with reason; other pages unaffected | no retry loop beyond the existing bounded policy |
| Locator round trip | any registered fact | resolving its locator against the original returns the same value (parser facts) or the same page (model facts) | mismatch fails the test |

</frozen-after-approval>

## Code Map

- `zobba/crates/domain/src/analysis.rs:107-238` -- `AnalysisEnvironment`, `server_allowlist()` (add the extraction environment), `AnalysisRequest`, `canonical_material()`, `MEDIA_TYPES` (:166, add json-only for extraction).
- `zobba/crates/application/src/analysis.rs:89-121,418,1170-1260` -- `AnalysisTarget::operation`, `admit`, `collect`/descendant registration; no production admission caller exists yet.
- `zobba/crates/infrastructure/src/analysis/fargate.rs:75,148-164` and `zobba/crates/worker/src/main.rs:118` -- single-environment Fargate config; must become multi-environment.
- `zobba/crates/infrastructure/src/analysis/mod.rs:269,314,341` -- `descendants()`, `receipt()`, `original()` (inputs only from `evidence_originals`).
- `zobba/crates/domain/src/model.rs:10,445` -- `ModelMessage` is text only; `MAX_INPUT_BYTES`.
- `zobba/crates/application/src/model.rs:38-160` -- `ModelRequest` validation, disclosure binding (`Action::Send`, destination/account match), input classes.
- `zobba/crates/infrastructure/src/model/native.rs:16,171,236-247,445,627` -- `MAX_STREAM_BYTES`, qualification check, OpenAI strict json_schema, wire encoders.
- `zobba/crates/domain/src/permissions.rs:60-120` -- `CanonicalOperation`, `Attachment{id,digest,classification}`.
- `zobba/crates/application/src/knowledge.rs:221,357` and `zobba/crates/domain/src/evidence.rs:3,136` -- existing byte-range excerpts, `Omission`, `plain_preview`, `MAX_ORIGINAL_BYTES`.
- `zobba/migrations/0015_analysis.sql`; `zobba/crates/infrastructure/src/lib.rs:119-149,477-503,1448` -- next migration 0016 and every schema check to extend.

## Tasks & Acceptance

**Execution:**
- [ ] `zobba/crates/domain/src/extraction.rs` -- fact, locator, reader, limitation types; result document schema and validation; locator resolution rules.
- [ ] `zobba/deploy/extraction/` -- pinned extraction image (parsers + page renderer, digest-pinned) and the versioned server-owned extractor program.
- [ ] `zobba/crates/domain/src/analysis.rs` + Fargate/worker config -- second allowlisted environment; multi-environment task definitions.
- [ ] `zobba/crates/application/src/extraction.rs` -- trusted admission of extraction jobs, result validation, per-page model reading via disclosure custody, reader comparison, registration of facts and full result.
- [ ] `zobba/crates/domain/src/model.rs`, `application/src/model.rs`, `infrastructure/src/model/native.rs` -- image input part, per-page bounds, OpenAI encoding, Anthropic refusal.
- [ ] `zobba/migrations/0016_extraction.sql` + repository + schema checks -- facts and limitations, immutable, RLS.
- [ ] Fixtures + tests -- one per matrix row, including locator round trips, hostile files and synthetic-transport model reads.
- [ ] `zobba/deploy/qualification/*.tf` + tests, `zobba/README.md`, `zobba/deploy/RUNBOOK.md` -- extraction task definition, what is proven offline.

**Acceptance Criteria:**
- Given any registered fact, when it is inspected, then its reader, input digest and locator are present and a model reading is never presented as a parser fact.
- Given an extraction, when its full result is requested, then it is a separate descendant and previews state when they are partial.
- Given the production composition, when a model-read page is sent, then exactly one recorded disclosure operation covers it and its digest.

## Verification

**Commands:**
- `cargo fmt --check && cargo clippy --workspace --all-targets -- -D warnings` -- expected: clean.
- `cargo test --workspace` on guarded `_test` databases with Docker live -- expected: all pass; extraction fixtures run for real in the extraction image.
- `terraform -chdir=zobba/deploy/qualification test` -- expected: all pass.
