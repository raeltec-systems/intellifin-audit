---
title: '21.6 — Find working material without losing provenance'
type: feature
created: '2026-10-03'
status: done
story_key: 21-6-find-working-material-without-losing-provenance
baseline_commit: 67a290173dea7212b600d00ec5bad3f5bd52a6c0
review_loop_iteration: 0
authorization: 'Owner authorised this batch and routine engineering; no live services or spending.'
context:
  - '{project-root}/AGENTS.md'
  - '{project-root}/_bmad-output/implementation-artifacts/epic-21-context.md'
  - '{project-root}/_bmad-output/implementation-artifacts/batch-21-6-22-2-build-context.md'
---

<frozen-after-approval reason="owner-authorised canonical Story21.6 and accepted producer dependencies">

## Intent

**Problem:** Registered working sources can be paged but not searched; source navigation does not consistently lead to the original library with visible provenance.

**Approach:** Extend the current engagement's evidence library with bounded source search and accessible result-to-provenance/preview/original navigation, including Task knowledge source links. Preserve acquisition and recovery.

## Boundaries & Constraints

**Always:** Current viewer/session and exact engagement authority before search and disclosure; immutable originals; explicit source/version/scope/acquisition standing; safe original download distinct from a bounded inert preview; current provenance and useful return focus. Treat filename/source metadata as attributed assertions, not verified business truth. Preserve accepted Unicode values and schemas1–10.

**Ask First:** External credentials, paid services, deployment or wider publication authority.

**Never:** Search inaccessible scopes, infer extracted document meaning, render active originals inline, claim partial/empty pages prove absence, persist private previews or replace existing evidence/Task owners.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|---|---|---|---|
| Search | Several originals match filename or source assertions | Current-scope source/version/acquisition rows; bounded query and deterministic pages | Invalid input gives actionable validation |
| Bounded work | More than50 matches or sparse matches beyond a scan boundary | At most50 returned and bounded examined candidates; explicit continuation/coverage | Partial empty page offers continuation, not absence |
| Query navigation | Query/page/engagement changes while response is held | New query resets pagination; stale result cannot replace current page | Cancel stale request; no automatic mutation |
| Inspect | Keyboard open result and navigate provenance | Exact original scope/id/version/digest, acquisition actor/time, asserted metadata; preview labelled bounded | Unsupported/corrupt original keeps honest metadata and recovery |
| Original | Download from library or knowledge source | Authenticated pinned original bytes; safe attachment filename and revoked Blob URLs | Integrity/access refusal never becomes a usable download |
| Authority | Session replacement, current denial or revocation during search/preview | Hide results/preview/provenance, cancel requests, discard stale disclosure, focus permitted surface | Uncertain failure stays unavailable until fresh scoped verification |
| Narrow/return |390px viewport, keyboard, inspection close | Operable search/pages/open/download; readable source; return to opener or useful fallback | No focus into hidden or revoked content |

</frozen-after-approval>

## Code Map

Paths are relative to `zobba/`.

- `crates/domain/src/evidence.rs`, `application/src/evidence.rs:EvidenceMetadata` — existing immutable records and custody; add an explicit bounded search read contract without changing acquisition semantics.
- `infrastructure/src/evidence/mod.rs:{begin,current,list}` — exact-scope transaction, session fences and C-ordered paging. Bound candidates before text filtering; preserve current recheck before commit.
- `api/src/evidence.rs:{EvidencePageQuery,list,authority,final_authority}` — search wire validation and repeated authority; current preview/download remain verified post-I/O.
- `web/src/evidence.ts` — strict parser, no-store requests, exact audience verification and safe download; retain Rust-compatible Unicode rules.
- `web/src/EvidenceWorkspace.tsx:{refresh,inspect,close}` — existing acquisition/recovery, page state, focus and Blob custody. `KnowledgeSource.tsx`/`TaskKnowledge.tsx` supply exact evidence-reference navigation.
- `crates/{api,infrastructure}/tests/evidence*.rs`, `web/tests/browser/evidence.spec.ts` — real storage, permission races, pagination and keyboard baselines; avoid weakening their assertions.

## Tasks & Acceptance

**Execution:**
- [x] `crates/{domain,application,infrastructure,api}/src/evidence*` — implement bounded current-scope search and coverage/cursor contract; preserve existing evidence consumers.
- [x] `web/src/{evidence,EvidenceWorkspace,KnowledgeSource,TaskKnowledge}*` and styles — searchable library, complete result labels and exact accessible navigation; preserve session/draft ownership.
- [x] `crates/*/tests`, `web/tests`, generated OpenAPI/types — execute search, pagination, late-response/revocation, original-vs-preview and Unicode contracts.
- [x] `README.md` and safe story evidence — document actual limits, commands, source identity and executed browser inspection.

**Acceptance Criteria:**
- Given multiple authorised matching sources, when results render, then each identifies source/version, scope and acquisition status with bounded pagination.
- Given a result is opened, when its inspector appears, then source lineage and safe original download remain distinct from a preview.
- Given access changes during navigation, when the next request occurs, then cached results/previews are invalidated and focus returns to a useful permitted surface.

## Spec Change Log

## Design Notes

Use the existing current-engagement evidence library; knowledge references lead to their exact original, without copying source text into a second registry. A search continuation must cover examined candidates without skipping eligible matches; filtered/partial pages never establish global absence. No migration is required merely to read already registered metadata. Keep incomplete acquisition reservations separate from registered originals.

## Verification

Run relevant Rust domain/application/API/PostgreSQL tests, generated contract/type/web units, fmt/strict Clippy/build and a real Chromium source-library journey. Execute every matrix row, including more than50 records, sparse continuation, query races, actual source refusal, exact original bytes and390px keyboard/focus behavior. Root coordinates shared builds and combined regressions with22.1. Record actual counts, exits, manifests and inspected safe images; independent review precedes completion/push.

Executed local verification is recorded in the [checkpoint and evidence](zobba-foundation-batch/story-21.6-22.1/README.md): 371 Rust passes, 183 web passes, 159 browser passes with zero retries, and the supplemental guards/process smoke. Independent source review and targeted repair rechecks are recorded separately from root's suite executions.

Implementation is complete and ready for owner review. The canonical sprint queue remains at review until acceptance.

## Suggested Review Order

**Search contract**

- Bound examined work while retaining exact cursors and honest partial coverage.
  [evidence.rs:143](../../zobba/crates/application/src/evidence.rs#L143)

- Enforce current source scope before matching attributed metadata.
  [mod.rs:240](../../zobba/crates/infrastructure/src/evidence/mod.rs#L240)

- Recheck current viewer authority around the HTTP response.
  [evidence.rs:523](../../zobba/crates/api/src/evidence.rs#L523)

**Working experience**

- Keep search, pagination and inspection within the coordinating workspace.
  [EvidenceWorkspace.tsx:29](../../zobba/web/src/EvidenceWorkspace.tsx#L29)

- Quarantine bounded transfers during uncertainty; retain exact source ownership.
  [EvidenceSourceInspector.tsx:20](../../zobba/web/src/EvidenceSourceInspector.tsx#L20)

**Verification**

- Exercise dense and sparse pages, Unicode and real browser authority races.
  [evidence-search.spec.ts:70](../../zobba/web/tests/browser/evidence-search.spec.ts#L70)

- Prove cross-engagement source denial preserves destination work.
  [evidence-search.spec.ts:432](../../zobba/web/tests/browser/evidence-search.spec.ts#L432)

- Inspect exact checks, limitations, source reconciliation and safe visual evidence.
  [README.md:1](zobba-foundation-batch/story-21.6-22.1/README.md#L1)
