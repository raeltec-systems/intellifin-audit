---
title: '22.5 — Read documents natively and cite every claim cleanly'
type: 'feature'
created: '2026-10-13'
status: 'in-progress'
baseline_commit: 'ab500cfde5240df54c88775aca6458a30d8978ab'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-22-context.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-22-4-run-measured-analysis-in-an-isolated-workspace.md'
  - '{project-root}/zobba/README.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Zobba's agent cannot read the documents auditors receive (PDFs, scans, photos, spreadsheets, Word, email), and nothing lets an auditor see exactly where a claim came from. A fixed extraction pipeline would be mechanical; the agent should read with its own tools, as Claude Code and Codex do, while every claim stays traceable and checkable.

**Approach:** Give the agent two reading tools: (1) native reading — PDF and image pages are sent to the qualified model as image input, one page per request, as a recorded disclosure; (2) its own analysis code in the 22.4 sandbox, whose general image gains standard document libraries. The agent answers with structured citations; trusted code re-checks each citation against the original and marks it verified or unverified. The web shows citations the ChatGPT way: a quiet chip at the end of the sentence, a hover/focus card, and Open at the exact place.

## Boundaries & Constraints

**Always:**
- The agent decides how to read; no fixed server extraction pipeline. Model-written programs run only in the 22.4 sandbox under its rules.
- Citation contract: each cited claim span in an answer points to one or more sources `{original id, locator, quoted text}`. Locators: `page` (1-based), `sheet!cell` or range, `paragraph`/table cell, email part/header, byte range for text.
- Trusted verification opens the original and confirms the quoted text at the locator (text layers, cells, paragraphs, email parts, byte ranges; normalized only for whitespace and Unicode NFC). Native page reads verify the page exists and was the page actually sent to the model (by digest). Result per source: `verified` or `unverified` with a closed reason (`not_found_at_location`, `location_missing`, `source_unreadable`, `page_only`). Verification never edits the answer.
- Native reading reuses 22.1 disclosure custody: one `Send` operation per page with the page image digest and the original's classification as an attachment; profile must be qualified with image input and strict structured output. Add image input parts to the model request types and the OpenAI encoder; the Anthropic encoder refuses them until qualified. Explicit per-page bounds. Page images are rendered by trusted code in the sandbox, never by the model's own program.
- The model states unreadable or ambiguous regions in words; these appear in the card as a limitation. No numeric confidence scores, no OCR engine.
- Hostile files stay inside 22.4 limits; macros, external links and embedded objects are never run or fetched.
- Web: a reusable `Citation` chip shows the short file name (`+N` for more sources); hover or keyboard focus opens a card with file, location, quoted text (bounded), an Open button to the evidence viewer at that location, and, only if unverified, the single quiet word "unverified" with its reason. Keyboard and screen-reader accessible (WCAG 2.2 AA); no colour-only meaning. Shown on agent answers in the Task work panel.

**Ask First:** Any library beyond pandas, openpyxl, python-docx, a PDF text/render library and the standard email package in the general image; page images above 4 MB or more than 200 pages per document per Task.

**Never:** A fixed pre-extraction fact database; numeric confidence; sending a whole document in one model request; trusting an unverified citation silently; live provider calls in tests (synthetic transport only); exposing the citation card's quoted text beyond the current viewer's authority.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Spreadsheet claim | answer cites `Sheet1!B4` = "1,250.00" | verified; chip `Trial balance.xlsx`; card shows sheet, cell, value | N/A |
| Wrong value | cites `B4` = "1,280.00", cell holds 1,250.00 | unverified `not_found_at_location` | answer unchanged |
| Scanned page | agent reads page 3 natively, cites page 3 | one disclosure for page 3; source `unverified page_only` unless a text layer confirms the quote | unreadable region shown as limitation |
| Multiple sources | sentence cites PDF p.2 and an email | one chip `Contract.pdf +1`; card lists both | N/A |
| Missing locator | citation has no locator | unverified `location_missing` | N/A |
| Hostile file | zip bomb / encrypted / macro file read in sandbox | sandbox limit or safe refusal; no citation verified from it | closed reason |
| Model failure | provider error or invalid structure for a page | page reading recorded as failed; no fabricated text | bounded existing retry policy |
| Keyboard user | tabs to a chip | card opens on focus, Escape closes, focus returns | N/A |

</frozen-after-approval>

## Code Map

- `zobba/crates/domain/src/analysis.rs:147-172` -- general environment allowlist and `GENERAL_IMAGE_DIGEST`; the general image gains document libraries (new pinned digest everywhere it is asserted).
- `zobba/crates/application/src/analysis.rs:418,1170-1260` -- sandbox admission and descendant registration to reuse for page rendering and agent programs.
- `zobba/crates/domain/src/model.rs:10,445` -- `ModelMessage` is text only; add image parts.
- `zobba/crates/application/src/model.rs:38-160` -- `ModelRequest` validation and disclosure binding (`Action::Send`).
- `zobba/crates/infrastructure/src/model/native.rs:16,171,236-247,445,627` -- body bound, qualification, OpenAI strict schema and wire encoders.
- `zobba/crates/domain/src/permissions.rs:60-120` -- `CanonicalOperation`, `Attachment`.
- `zobba/crates/application/src/work.rs:598,1018` -- `answer_text`; where answers leave the work loop.
- `zobba/crates/application/src/knowledge.rs:357` and `zobba/crates/application/src/evidence.rs:286,362` -- byte-range excerpts, `read_original`, `capture_range` (reuse for text verification).
- `zobba/web/src/TaskWorkPanel.tsx`, `zobba/web/src/EvidenceNavigation.tsx`, `zobba/web/src/design/zobba-tokens.json` -- work panel, evidence viewer navigation, design tokens.
- `zobba/migrations/0015_analysis.sql`; `zobba/crates/infrastructure/src/lib.rs:119-149,477-503,1448` -- next migration 0016 and schema checks.

## Tasks & Acceptance

**Execution:**
- [ ] `zobba/crates/domain/src/citation.rs` -- locator, citation, verification result types and validation.
- [ ] `zobba/crates/application/src/citation.rs` -- trusted verification against originals (XLSX cells, DOCX paragraphs/cells, email parts, PDF text layer, byte ranges) and page-read checks.
- [ ] Model image input -- domain parts, request bounds, OpenAI encoding, Anthropic refusal; per-page native reading with disclosure custody.
- [ ] General sandbox image -- document libraries, new pinned digest, trusted page renderer.
- [ ] `zobba/migrations/0016_citations.sql` + repository + schema checks -- citations and verification results, immutable, RLS.
- [ ] API + generated client -- answers with citations, scoped to current viewer authority.
- [ ] `zobba/web/src/Citation.tsx` + use in the work panel -- chip, `+N`, hover/focus card, Open at location, quiet "unverified".
- [ ] Fixtures + tests -- every matrix row (Rust, web unit, browser), locator round trips, synthetic-transport page reads.
- [ ] `zobba/README.md`, `zobba/deploy/RUNBOOK.md` -- what is proven offline.

**Acceptance Criteria:**
- Given a verified citation, when the auditor clicks Open, then the evidence viewer opens at the cited location of that exact original.
- Given any citation, when inspected through the API, then its verification result and reason are present and the answer text is unchanged by verification.
- Given a native page read, when audited, then exactly one disclosure operation covers that page image digest.

## Verification

**Commands:**
- `cargo fmt --check && cargo clippy --workspace --all-targets -- -D warnings` -- expected: clean.
- `cargo test --workspace` on guarded `_test` databases with Docker live -- expected: all pass.
- `pnpm --dir zobba/web check` and the browser suite for citations -- expected: pass, including keyboard and accessibility checks.
