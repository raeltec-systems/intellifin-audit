# Story 21.6 acceptance matrix

The full Rust gate passed **371 tests**, with three parent-owned helper entry
points ignored by the ordinary test runner. Web checks passed **183 tests**;
formatting, strict Clippy, build and process smoke gates passed.

The final full browser run, `browser-full-clean`, passed **159 cases with zero
failures and zero retries**. This includes all fourteen source-library cases,
all three Unicode cases and the sixteen existing evidence cases. The preceding
focused source-library run also passed all fourteen with zero retries in 1.2 minutes.

Root visually inspected the five fresh synthetic screenshots from
`browser-full-clean-results`; the packaged images and manifest identify this
final source-stable run and exact image hashes.

## Verification gates

| Gate | Result | Evidence |
| --- | --- | --- |
| Full Rust | 371 passed; three parent-owned helpers ignored by the ordinary runner | `full-rust-5.log`; includes evidence API contracts, real HTTP, PostgreSQL and S3 tests |
| Web checks and units | 183 passed | `web-check-final-clean.log` |
| Formatting | Passed | `fmt-final-clean.log` |
| Strict Clippy | Passed | `clippy-final-clean.log` |
| Web build | Passed | `web-build-final-clean.log` |
| API/worker process smoke | Passed | `process-smoke-final.log`; startup guards, exact health responses and recovery after database connection loss |
| Current full browser run | 159 passed, zero failures, zero retries | `browser-full-clean.log` |
| Current source-library cases | All 14 passed within the final full browser suite | `browser-full-clean.log`, cases 64–77 |
| Current Unicode cases | All 3 passed within the final full browser suite | `browser-full-clean.log`, cases 78–80 |
| Current existing evidence cases | All 16 passed within the final full browser suite | `browser-full-clean.log`, cases 81–96 |
| Earlier focused source-library gate | 14 passed, zero retries, 1.2 minutes, source unchanged during run | `browser-search-clean-2.log` |
| Historical browser upgrade | 1 passed, 11.8 seconds | `browser-upgrade-review.log`; `accepted schema9 public acquisition survives upgrade and current UI capture recovery with exact deduplication` |
| Earlier scoped library/evidence PG gates | 215 library tests and 3 evidence PG target tests passed | `library-review-repair.log`, `evidence-review-repair.log`; superseded by the completed full Rust gate |
| Qualification guard tests | 6 passed | `qualification-final-clean.log`; not live-provider qualification |

Log basenames resolve under the packaged [gates directory](gates/README.md). The three ordinary-run
Rust skips are `composition::production_constructor_child`, `gateway_worker_helper`
and `reliability_worker_helper`, whose parent tests supply isolated guarded inputs.
The evidence PG target's three tests comprise the custody/search aggregate and two
fixture safety guards; helper invocations are not counted as extra journeys.

## Spec rows

Source/test paths are relative to `zobba/`. Browser IDs resolve to exact titles in
the next table. Supporting Rust and evidence browser regression results below come from the final
Rust gate and the final full browser run, respectively.

| Spec row | Direct source-library journeys | Exact supporting tests | Scoped outcome and limits |
| --- | --- | --- | --- |
| Search | B1; B5 checks source labels and complete provenance | Domain `search_query_is_byte_bounded_and_preserves_metadata_unicode`; application `search_matches_only_literal_attributed_fields_with_unicode_lowercase`, `search_unicode_case_mapping_is_context_independent_and_keeps_literal_substrings`; web unit `source search preserves Unicode, uses UTF-8 bounds and canonical query equality`; API contract `bounded_search_documents_literal_query_and_explicit_candidate_coverage` | B1/B5 and supporting Rust/web tests passed. Literal filename/assertion matching uses a 200 UTF-8 byte query bound and context-independent scalar lowercase. The API contract and real HTTP aggregate passed in full-rust-5. |
| Bounded work | B1: dense 50 then 1; sparse empty 256-candidate page then exact later match. B13 repeats dense/sparse navigation at 390px | Application `search_result_limit_continues_at_last_examined_without_skipping_matches`, `search_partial_empty_page_continues_past_256_unmatched_candidates`; web units `bounded evidence pages validate ordered examined-prefix continuation and explicit coverage`, `sparse and empty search pages can continue only through a valid examined prefix` | B1/B13 and supporting full Rust/web/PG tests passed. PG helper `assert_bounded_metadata_search` runs inside aggregate `immutable_scoped_custody_replay_and_post_lock_session_fence`; helper invocations are not extra test counts. Cursor follows the consumed prefix without discarding an overflow match. |
| Query navigation | B1 resets cursor after paging; B2 holds the initial search across a new query; B7/B8 hold an actual later-page response across query/engagement changes | B7/B8 assert `net::ERR_ABORTED`, fresh query/cursor, no stale row or inspector, useful focus and no evidence mutations | B1/B2/B7/B8 passed with the B1/B8 capture repairs. General conversation scope-race tests are not counted as direct evidence-library proof. |
| Inspect | B5 keyboard opens a result; B6 opens the exact Task knowledge source and checks corrupt-byte metadata recovery; B14 opens a reused original from another engagement | Existing `evidence.spec.ts`: `narrow keyboard inspection caps plain text and keeps markup download-only`, `registered provenance remains inspectable when storage configuration or original bytes are unavailable`; web unit `plain-text preview refuses more than 100 lines or 64 KiB before rendering` | B5/B6/B14 and web units passed. Root inspected the narrow preview and desktop source screenshots. The listed existing evidence browser regressions also passed in the current full run. |
| Original | B5/B6/B14 compare downloaded bytes exactly; B5 checks safe filename and balanced Blob creation/revocation; B12 keeps one bounded download through routine checking | Web units `authenticated download verifies bounded actual bytes and content identity before disclosure`, `completed download bytes remain fenced across same-actor session replacement`, `download filename strips path and header controls`; S3 tests `newer_latest_object_cannot_substitute_a_registered_original`, `returned_version_must_match_the_explicitly_requested_version`, `later_corruption_is_refused_before_original_disclosure` | B5/B6/B12/B14 and web units passed. The named S3 tests passed in full-rust-5, and all three existing download-replacement browser variants passed in browser-full-clean. |
| Authority | B3 actual search revocation; B4 uncertain failure/retry; B9/B10 held preview after revocation/replacement; B11/B12 routine-check quarantine; B14 actual source-only denial with destination retained | Existing `evidence.spec.ts`: `completed metadata is withheld after same-actor session replacement`, `failed current-authority recheck hides all evidence while retaining same-session retry`; `knowledge.spec.ts`: `a real evidence source refusal withdraws enclosing knowledge while destination work and unrelated exact recovery survive`; HTTP aggregate `evidence_http_proves_custody_replay_limits_and_authority_after_io` invokes `search::revocation_while_search_waits` | All named B cases passed. Actual API bodies and authority changes underpin the races; transient preview insertion is checked. The direct cross-engagement library case B14 supplements the existing inline-source test. The HTTP aggregate passed in full-rust-5; its helper execution is not an extra standalone count. |
| Narrow/return | B5 uses 390px, keyboard opening, download and opener return; B6 restores knowledge opener; B13 keyboard submits and moves next/previous through dense and sparse pages, then returns from inspection; B14 checks revoked-opener fallback | Existing `evidence.spec.ts`: `verified acquisition keeps source assertions distinct and preserves Task guidance, selection and return focus`, `routine same-session access checks retain an in-flight upload, inspection, file control and focus` | B5/B6/B13/B14 passed. Minimum 4.5:1 hovered-label contrast assertion passed. Root inspected corrected narrow search/preview/keyboard captures and destination-after-denial focus/work state. |

## Exact source-library browser titles

All fourteen tests are in `web/tests/browser/evidence-search.spec.ts`.

| ID | Exact title | Current case result |
| --- | --- | --- |
| B1 | `bounded dense and sparse search pages disclose coverage and reset the cursor for Unicode queries` | Passed in browser-full-clean.log |
| B2 | `late source search cannot replace a newer query and query navigation never mutates` | Passed in browser-full-clean.log |
| B3 | `a held successful search is refused after actual assignment revocation` | Passed in browser-full-clean.log |
| B4 | `an unavailable search withdraws results and focuses a permitted retry surface` | Passed in browser-full-clean.log |
| B5 | `390px keyboard inspection preserves exact provenance and verified original bytes, then returns to its opener` | Passed in browser-full-clean.log |
| B6 | `Task knowledge opens its exact source in the library and restores the knowledge opener` | Passed in browser-full-clean.log |
| B7 | `a held later source page is cancelled after selecting a new query` | Passed in browser-full-clean.log |
| B8 | `a held later source page is cancelled after selecting another engagement` | Passed in browser-full-clean.log |
| B9 | `a held inspector preview never discloses stale private material after assignment revocation` | Passed in browser-full-clean.log |
| B10 | `a held inspector preview never discloses stale private material after same-actor session replacement` | Passed in browser-full-clean.log |
| B11 | `routine access checking preserves a held knowledge-source preview until current verification` | Passed in browser-full-clean.log |
| B12 | `routine access checking preserves a held knowledge-source download until current verification` | Passed in browser-full-clean.log |
| B13 | `390px keyboard search traverses dense and sparse pages and returns from inspection to the exact result` | Passed in browser-full-clean.log |
| B14 | `reused knowledge opens its exact original from another engagement and source-only revocation preserves destination work` | Passed in browser-full-clean.log |

## Verified repairs

- Scalar Unicode search: `metadata_search_case_key` applies `char::to_lowercase`
  independently to each scalar, then compares literal substrings. It performs no
  normalization, locale-specific casing or full Unicode case folding, and leaves
  accepted metadata and FEFF unchanged. The new application test
  `search_unicode_case_mapping_is_context_independent_and_keeps_literal_substrings`
  passed in full-rust-5. Real HTTP helper
  `unicode_metadata_search_uses_context_independent_case_mapping` covers Greek
  filename and all five assertion prefixes, exact returned metadata, literal
  punctuation and decomposed-accent nonmatches inside
  `evidence_http_proves_custody_replay_limits_and_authority_after_io`, which passed
  in full-rust-5. README and API query documentation match these exact semantics.
- PG ordering: the earlier full Rust failure at `evidence.rs:666` was a random
  acquired-original ID sorting after `search-0256`, legitimately consuming an extra
  nonmatching candidate. PG and HTTP fixtures now independently read the scoped
  C-ordered ID stream and assert exact consumed-prefix counts and cursors. The
  256-candidate/50-result limits, six pages and exact 257 synthetic matches remain
  asserted. The repaired PG target passed all three tests in both its scoped gate and full-rust-5.
- B11/B12: the original 120-second transfer deadline now covers the routine
  readiness check and publication wait. Content is hidden while checking; exact
  source metadata and a fresh audience check must succeed before publication.
  Owner/source/retry changes, denial and unmount still cancel. Both browser cases
  advance the actual 30-second callback with Playwright clock, hold only workspace
  assignment discovery, and let the real transfer body and its own source check
  finish. They passed with one uncancelled transfer and no early Blob publication.
- B13: dense next/previous pages, exact-ID inspector return, sparse empty-page
  continuation and previous-page recovery all passed at 390px. The real original
  is found on its actual C-ordered page; no random-ID ordering assumption remains.
- B14: actual knowledge reuse into a named destination Task leads through
  `Open in evidence library` to original scope/version/digest/provenance and exact
  bytes. Origin-only assignment revocation removes source inspection and protected
  knowledge while destination conversation, Task controls and unsent draft remain
  owned and usable; useful focus and fallback return passed.
- B1/B8: Chromium/CDP could not retrieve a browser response body after a
  headers-only `waitForResponse`. The logs did not prove the exact superseded
  request, so no production defect or cancellation relaxation was inferred. Both
  tests now buffer the unchanged real upstream response and associate it with the
  exact completed browser `Request`. B1 still checks GET/200, canonical query,
  cursor reset, empty 256-candidate partial page and exact later match. B8 still
  checks the destination path/org/client, GET/200, empty query/results, absent
  inherited cursor, complete zero-candidate coverage, old-page cancellation and
  focus. No independent retry or fabricated response was introduced. Both passed
  in the focused fourteen-case gate and the current full browser run; no equivalent browser body-read pattern remains
  in this test file.

## Current inspected safe screenshot evidence

Root visually inspected all five fresh synthetic-only captures below from
`/tmp/zobba-batch-21-6-22-1/browser-full-clean-results/`. Each relative artifact
path resolves under that directory. Their journeys passed in the final 159-case
browser run with zero failures and zero retries.

| Intended pack name | Current source artifact | Journey and inspected evidence |
| --- | --- | --- |
| `source-search-390.png` | `evidence-search-390px-keyb-23e4e--then-returns-to-its-opener/source-search-390.png` | B5: readable hovered narrow result, attribution and acquisition labels |
| `source-preview-390.png` | `evidence-search-390px-keyb-23e4e--then-returns-to-its-opener/source-library-390.png` | B5: bounded inert preview, separate verified original action, capture/recovery controls |
| `source-library-desktop.png` | `evidence-search-Task-knowl-745d3-stores-the-knowledge-opener/knowledge-source-library-desktop.png` | B6: exact source provenance beside retained conversation and Task |
| `destination-after-source-refusal.png` | `evidence-search-reused-kno-db0c8--preserves-destination-work/cross-engagement-source-refusal-destination.png` | B14: source-only denial removes inspection while destination controls and unsent draft survive |
| `keyboard-search-390.png` | `evidence-search-390px-keyb-a9f85-pection-to-the-exact-result/source-search-continuation-390.png` | B13: narrow search and keyboard focus during dense/sparse pagination |

The pack lives at
`/workspace/intellifin-audit/_bmad-output/implementation-artifacts/zobba-foundation-batch/story-21.6-22.1/screenshots/`.
The packaged `README.md` and `manifest.json` identify the final captures above,
with exact image hashes and `browser-full-clean` as their source gate. They replace
the older `browser-search-review` images; the earlier run's **13 passes, one
response-capture failure, zero retries** remain recorded in its gate receipt.
No authentication captures, fixture secrets, raw traces or failed-test screenshots
belong in the safe image pack.

## Preserved regression results and remaining limit

- All three Unicode browser cases passed in `browser-full-clean`: `mixed API-created
  normal and FEFF originals retain exact metadata and download bytes`; `mixed
  API-created pending reservations recover exact drafts after reload and register
  the same originals`; `new source entry trims Rust whitespace and preserves FEFF
  in all five assertion fields` (`evidence-unicode.spec.ts`). The first retains every
  exact metadata/bytes/FEFF assertion and now scrolls to each exact-ID row before
  requiring full visibility with `toBeInViewport({ ratio: 1 })`.
- Existing acquisition/recovery cases passed: `lost reservation acknowledgement
  recovers the exact key on reload and refuses a changed file`; `lost upload
  acknowledgement retries the same registered original across API restart without
  overwrite`; `registry and recovery pages stay bounded and new registration
  refreshes canonical ordering and cursor` (`evidence.spec.ts`).
- Existing download-replacement cases passed for same-actor session, same-engagement
  actor and foreign-scope account replacement. Actual upload revocation, storage
  unavailability, failed authority recheck and same-session in-flight preservation
  cases also passed in the current full browser run.
- [published-prefix.json](published-prefix.json) records all twenty published
  migration/catalogue files 1–10 byte-identical to the accepted baseline. Root owns
  the final source manifest and safe evidence pack.
- All local combined gates completed: Rust, HTTP, PG, S3, web, formatting,
  Clippy, build, process smoke and the 159-case browser suite. This evidence does
  not claim live-provider qualification, external-service testing or deployment.

## Historical failures retained accurately

- Initial cold-build timeout and the next attempt's proven-owned orphan detection
  ran no application journey. Their logs remain retained.
- `full-rust-2` exposed the random-ID examined-candidate assumption at
  `evidence.rs:666`. Exact C-ordered prefix assertions repaired it; full-rust-5
  subsequently passed 371 tests.
- `browser-search-review` had 13 passes and B1's Chromium response-body capture
  failure. `browser-search-clean` had 13 passes and B8's equivalent capture failure.
  Neither is described as a clean run. The completed-request capture repairs then
  passed all fourteen cases in `browser-search-clean-2` and again in the current
  full browser run.
- The earlier full browser run included the auth pagination focus-precondition
  failure, an inner methodology disclosure failure and the Unicode list-viewport
  assumption failure. The auth test now establishes usable conversation and exact
  focused back-node ownership before asynchronous revocation. The Unicode test
  scrolls each richer provenance row before retaining the full-visibility check;
  it no longer assumes all five rows fit in the pane at once. These cases, including
  the methodology disclosure case, have passed in `browser-full-clean`. Their
  earlier failures remain in `browser-full-final.log`; this matrix does not infer
  that the earlier full run was clean.
