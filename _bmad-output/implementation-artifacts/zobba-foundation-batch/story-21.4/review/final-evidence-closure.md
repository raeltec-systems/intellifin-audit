# Story 21.4 — independent final evidence closure

**The completed evidence supports closure of all three canonical acceptance criteria and all ten frozen matrix rows. No concrete remaining implementation, consumer-contract or required verification gap was found.** The actual final complete Chromium invocation, `repair-browser-full-3`, passed **145/145 in 16.7 minutes**, one worker, zero retries, exit 0. Its before/after manifests and final disk contain the same complete 245-file application source set. Earlier failed invocations remain failed. Root retains workflow status, final publication review, commit and push ownership.

Reviewed 2026-10-02 against baseline `d38e1daed736415ef13e7606345dac71bd1d9f01`. This is independent source, documentation and execution-evidence reconciliation, **not a reviewer rerun**. I read actual source, completed list logs/exit receipts, complete source manifests, named safe proofs and the scoped independent reports. I ran no tests, builds, application binaries or services, changed no application source, and read no private reporter, trace, credential or environment material. Root performed the actual selected-image visual inspection; I independently verified its artifact identities and reconciled the recorded geometry.

## Actual completed gates

Counts below belong to separate invocations and must not be added together. Internal PostgreSQL/HTTP scenario phases are not additional counted tests.

| Gate | Reconciled completed result |
| --- | --- |
| Final complete Chromium, BF3 | `repair-browser-full-3.log/.exit` and safe receipt: **145 passed, 0 failed/skipped/flaky, 1,001,152.249ms**, one worker, zero retries, exit 0. I counted exactly 145 sequential passing case lines, numbered 1–145. |
| Repaired Rust, R | `repair-rust-full.log/.exit`: **305 passed, 0 failed, 3 intentional helper ignores, 44 result sections**, exit 0. The ignored functions are subprocess entrypoints exercised by passing parent tests. The core independent report reconciles the real infrastructure/API aggregate phases. |
| Formatting, lint and build | `repair-fmt`, strict `repair-clippy`, `repair-rust-build` and `repair-rust-test-build` exit 0. After the single comment edit, `repair-rust-comment-build` separately passed in **32.06s**. This is not a repeated integration suite. |
| Web, W | `repair-web-check-12.log/.exit`: generated API comparison, TypeScript and **181/181 units**, exit 0. `repair-web-build-2` passed on unchanged shipping web source; its approximately 528 kB bundle warning remains a warning. |
| Process/schema smoke, S | `repair-smoke.log/.exit`: exit 0, bootstrap **3/3 in 308.23s**, invalid/unmigrated configuration refusal, migration twice, actual API/worker live/ready behavior, database-loss 503 with live processes and same-process recovery. |
| Other required checks | Python **47**, OIDC fixture **56**, inward-boundary check and published-prefix check all exit 0. All **18** published migration/catalogue files 1–9 independently match the Git baseline byte-for-byte. |
| Public query contract, C | OpenAPI generation exit 0, contract **5/5**, actual Axum query parser **1/1**; also covered by R/W. |
| Focused repair evidence | B2 knowledge/source **18/18**, HF3 H1–H4 **5/5**, final failure-follow-up **3/3**, final P9 **1/1**. Their exact source and scope are preserved; BF3 independently supplies the complete combined invocation. |
| Separate historical public recovery, U3 | `repair-legacy-upgrade-3.log/.exit`: **1/1 in 11.7s**, one worker, zero retries, exit 0, using the final common fixture and pinned schema-9 binaries. This is separate from BF3, not a 146th default-suite case. |

## Final source binding

`repair-browser-full-3-source-before.json` was observed at **21:47:34.069082 UTC**, its after manifest at **22:04:18.396996 UTC**, and `source-repair-final.json` at **22:04:50.793143 UTC**. Their complete path/hash maps equal both final P9 focused manifests. I independently hashed every current file and compared the manifest path set with all tracked and unignored files under `zobba/`: **245 actual paths, 245 manifest paths, no extra/missing path, no byte mismatch**. Root metadata outside `zobba/` is a separate scope.

The source reconciliation is qualified precisely:

- During R, five declared web files changed: three product files (`InspectionPreference.tsx`, `KnowledgeSupport.tsx`, `knowledge.ts`), the knowledge browser test and its unit test. No backend file changed during that invocation. Later W/build/browser gates cover the repaired web behavior.
- From R-end/S-end to the final source, shipping web files are unchanged. The later browser changes are `auth-runtime.ts`, `auth.spec.ts`, `evidence.spec.ts`, `knowledge.spec.ts` and `skills.spec.ts`; the sole backend delta is the comment below.
- BF1-end to BF2-start changed only the four independently reviewed browser files: `auth-runtime.ts`, `evidence.spec.ts`, `knowledge.spec.ts`, `skills.spec.ts`. The owned SQL chain, exact App authority gate, complete handler settlement and bounded sign-in diagnostics are covered by `full-run-followup-review.md` and the passing focused/full receipts.
- BF2/U3/final-three-case source to BF3 changed only the reviewed P9 assertions and one Rust comment. The P9 test now checks a sorted **copy** for unique expected membership, retains the untouched original receipt, and checks original receipt order in the initial and remounted DOM. It preserves exact retry equality, owner-current-read withholding and the two byte-identical intercepted POSTs. The preference reviewer independently reversed the two exact test hunks to the complete BF2 file hash.
- In `crates/infrastructure/src/knowledge.rs`, the only change is `// affected engagement only once, in first-release order.` → `// affected engagement only once, in publication-ID order.` Current hash is `074a15f557996974e7d62d98ad92d45495e25591d8f13e3c56fafde4740ec94d`. I independently reversed that exact single occurrence and recovered the complete previously tested hash `a3906375bf0d42f8e6b2734b81f46546cdd438536ce94fea87ba89a2a8ab31de`. **Executable backend source is unchanged; backend file bytes are not identical.** The warm workspace rebuild passed before the final browser run. R/S are not relabeled as executions on the later comment bytes.

## Canonical acceptance and frozen matrix

I reconciled canonical Story 21.4 in `epics.md`, the unchanged frozen specification and accepted knowledge context with the final verification map, repair closure, consumer contract and frontend verification narrative. AC1 is represented by Direction/Acquisition/Retrieval/Promotion; AC2 by actual Preference learning and Forget/Undo; AC3 by Correction/Revocation and current-authority Retry/races. No criterion is substituted with a manual editor, an enabled control, or a model-consumption claim.

| Frozen row | Concrete reconciled evidence and final browser coverage |
| --- | --- |
| Direction | R/HTTP preserve exact Guide author, command, Task/cycle/text/period and original retry identity; the real coordinator changes Received to Applied without rewriting that identity. BF3 **88** passes automatic attributable projection and exact source navigation. Applied standing is an executed HTTP/owner proof, not an invented browser branch. |
| Acquisition | R/application/storage evidence covers verified pinned object reads, bounded automatic UTF-8 observation, separate metadata assertions, omissions, exact byte boundaries and post-I/O authorization. BF3 **84–85/88** pass unsupported-original correction, actual delayed public excerpt capture and automatic acquisition. U3 separately proves real historical public acquisition followed by upgrade and capture recovery. |
| Preference | R/domain/HTTP cover two distinct explicit openings, private attribution, delayed observation fences, explicit-setting precedence and consumed Undo horizon. BF3 **86–87/96–97** pass actual learning/later application, typed release, usable local layout during uncertainty and retained Undo outcomes. |
| Retrieval | R covers current source/viewer/accountable-actor checks before disclosure, transitive period applicability, 50-item paging/1,024-candidate partial scans, exact known lookup and queued rechecks. C executes the public parser/schema contract; HTTP independently refuses stale Task epoch and stale binding. BF3 **88/92** pass exact navigation and held-success fencing. |
| Correction | R/HTTP cover attributed successors, bounded transitive invalidation, cycles, concurrency, changed-meaning refusal and retained originals. BF3 **84/89/93/95** pass correction without captured records, assertion/source correction, editable exact support and inspectable old basis. Live direction remains owned by Guide admission. |
| Promotion | R/HTTP independently qualify viewer, source Task actor and exact destination Task actor, both same-engagement lock orders, exact replay and same-client isolation. BF3 **87/94** pass typed release and positive named-Task reuse with foreign-origin action limits. No Permissions grant or firm/client-wide writer is created. |
| Revocation | R/HTTP prove source/session/post-I/O/queued authority fences and withhold inaccessible content/provenance. BF3 **98–101**, H2/H3 and methodology custody cases pass actual source/scope/session refusal, parent-fragment withdrawal, no stale resurrection, and retained independently authorized destination work. |
| Forget / Undo | R prevents retry/recovery/recapture from restoring excluded context; 50-publication capacity retains exact retry/withdraw/Undo and unique destinations. BF3 **86/89/97** pass actual Forget/Undo, exact lost-reply recovery and retained destination outcomes. Private Undo remains separate from unsupported Task Forget. |
| Draft interruption | W custody tests, the earlier single-component methodology negative/restoration proof, BF3 **90–91/100–101** and all four methodology custody cases **119–122** cover actual outage/remount, exact-owner current reads, refusal/replacement clearing and no automatic submission. H1–H4 also pass in the combined run. |
| Retry / races | R/HTTP cover actual committed lost replies, immutable retry meaning, atomic dependency/concurrency fences, bounded receipts/envelopes and retained correction/Guide/Pause/Stop controls after refusal. BF3 **91/96–101**, plus the final owned SQL and skill lifecycle cases **82/137**, pass the reviewed recovery and cleanup contracts. |

The final P12 consumer contract remains precise: optional `after`, `text` and `include_inactive`; cursor alphabet/length, Unicode-scalar/control bounds and false default match real parsing. The strict current-source and current-consumer authority contract is unchanged.

## Public source proof and baseline provenance

My earlier P12/P13 source and execution reports independently reconciled the exact baseline Git tree/archive and all **220** extracted baseline source files, plus the successful build records and pinned compiler-output copies. The exact `git archive` identity is **5,683,200 bytes**, SHA-256 `bf9a5ff1e9132d30a7a1ea3d89c75a2b1498ee5dc6869ac1763dcb7ca05d98c5`. The source-set equality was complete, not a selected-file sample.

I rehashed both pinned binaries during this final reconciliation without executing them: schema-9 API **151,556,192 bytes**, SHA-256 `792408ae5b38c696803b3b07bdc78a1ab00f601b2ab638ba390f6d059c8c0099`; CLI **110,120,920 bytes**, SHA-256 `ef24b7e8f91bc41b2dba2bb254481af2b0e5610329dbc8572facf4f3bc95b902`. `schema9-proof-invocation.json` links U3 to those same artifacts and the exact wrapper; its earlier U1 invocation is preserved separately. U3's shared fixture and source test are unchanged in BF3; only the unrelated P9 test and exact backend comment differ.

The final BF3 safe source-I/O proof reports **13,465ms** elapsed with the actual object GET held **13.25s**, byte interval **[11,39)** and exact selected text `😀 exact selected source\r\n`. The unchanged source test also asserts exact original/version/digest/range, invalid mid-codepoint refusal, exact receipt replay, one capture and unchanged original download/object count. No submitted prose substitutes for the object read. Real post-I/O revocation is separately executed backend/application evidence; the public delayed-read case is not mislabeled as a public-route revocation race.

U3 actually reserves/uploads/downloads through the schema-9 public API, retains the same original/database/object fixture, migrates and restarts the API, observes capture revision **0** and `legacy_not_captured`, recovers through the current UI, then restarts the API again. Its safe proof records the **53-byte** original, digest `154a31daf6dcabfb853161ea40d4cf4d9e5464f9072a536ad9aaacc79dcf6504`, storage version `v1`, three captured records, exact and second-key deduplication, and unchanged original receipt/bytes. It does not synthesize omission by deleting knowledge rows. No worker exists in this proof.

## Independent scopes, final safe proofs and visual review

The existing reports retain their dated scope rather than retroactively claiming final execution:

| Independent report | Scope used in this reconciliation |
| --- | --- |
| `core-repair-execution-closure.md` | P1–P5/P14/P15 actual backend contracts, R receipts and immutable prefix. |
| `ports-repair-source-review.md` / `ports-repair-execution-closure.md` | P12 public contracts and P13 actual object I/O, exact source capture, baseline provenance and public upgrade recovery. |
| `ui-focused-execution-closure.md` | P4–P11/P16 actual consumers and B2, including canonical scope, destination refresh, authority clearing and enclosing-source withdrawal. |
| `harness-repair-execution-closure.md` | H1–H4 exact bound/unbound ordering, actual focused-node withdrawal, matched transport abort and current Admin denial. |
| `full-run-followup-review.md` | Four post-BF1 browser-file changes: owned SQL blocker chain, bounded no-retry sign-in diagnostics, exact unbound App gate and settled handlers. |
| `preference-full-run-review.md` | BF2 diagnosis, exact applied P9/comment reversal, focused1/1, preserved receipt order and explicit measurement boundary. |

Final safe artifacts independently corroborate the repeated combined cases: H2 focuses the actual marked node before expiry, commits the expiry, dispatches focus, receives scoped403 and withdraws the node; H3 records the matched conversation request's actual abort/failure and absent protected fragments. The final owned SQL proof observes the sole unsettled metadata API backend blocked by its owned holder, then the admin blocked by that exact metadata backend, before explicit commit; both children complete and actual metadata returns200. The final skills ledger contains **211 events, zero overflow, 22 exact Request identities and 22 handler-settled entries**, with no handler/body/cleanup failure; bound postchecks continue, only unbound App checks own the authority gate, and cleanup/context close completes. These positive proofs do not diagnose the earlier unsampled failures.

Root and the implementation lead visually inspected the actual final narrow-source, learned-preference and recovered-methodology images. I independently checked all three file byte counts/SHA-256 values against `root-final-visual-review.json`. The final **390×844** geometry has document width **390**, reading area **364×283.640625**, complete exact-source preview, visible navigation/Pause/Stop and no horizontal overflow. This satisfies the declared narrow-navigation inspection within Chromium. I do not represent metadata/hash inspection as my own image-viewing action.

## Preserved failures and limits

BF1 remains **142 passed / 3 failed**, exit1; its original SQL failure phase/cause, rejected callback branch and already-handled route ordering remain unknown. BF2 remains **144 passed / 1 failed**, exit1. Its concrete failure was the unsupported alphabetical-order assertion: the real receipt/UI had both unique required destinations. BF2 did not reach the later remount assertions. The subsequent bounded test repair, focused pass and final BF3 supply that execution; no failed receipt is relabeled.

The earlier pre-review **131/5**, repaired B1 **13/5**, deliberate old-product P8 negative probe, HF1/HF2 **4/1**, diagnostic SQL observer failure, generation/script/type-check orchestration failures and wrong-path upgrade2 failure remain in the failure chronology. Later passes do not invent causes for the earlier blank-page/CDP behavior or unsampled database/callback errors.

The final documents retain these material boundaries:

- Retrieval is bounded to **1,024 examined candidates** and can be partial; exact lookup requires a known reference and empty is not absence.
- A distinct period-change-after-admitted-reuse replay branch has source inspection, not a separately executed scenario. The transitive-applicability and independent authority/replay contracts have executed coverage.
- The browser outcome journey exercises Undo; individual withdrawal shares inspected implementation and backend coverage. No separate browser withdrawal journey is invented.
- P9's mutation interceptor is removed before navigation/remount. Its counter proves two byte-identical mutation-phase attempts; it is not a remount-specific traffic counter. Exact retained outcome after remount is asserted, and separate uncertain-command journeys plus command-hook source cover no automatic submission.
- Historical recovery proves API restart with a local object fixture, not worker restart, external-provider qualification, bulk backfill or invented historical timestamps.
- Measured wire envelopes (**3,408,024**, **3,475,839**, **1,141,526** bytes) are below4MiB, separately from 60,000-byte admission/64KiB storage constraints and the conservative **40,830-byte** compact receipt-header bound. Simultaneous field maxima are not promised admissible.
- No new database-locale, other-browser/native-OS, deployment, customer-data, paid-provider/model-consumption, autonomous execution or generated-workpaper correctness qualification is claimed.

The frozen final four handoff documents now consistently say implementation verification is complete, index all six bounded execution-review scopes and preserve BF1/BF2, the comment-only backend byte difference and the stated limits. Their dated historical sections remain historical. Root's remaining workflow/publication work is distinct from an unverified story requirement.


## Inspected artifact identities

Paths below are relative to `/tmp/zobba-story-21-4/`, except `_bmad-output/` paths, which are repository-relative. Hashes pin the inspected final versions. All successful gate exit sidecars read `0`; their common SHA-256 is `9a271f2a916b0b6ee6cecb2426f0b3206ef074578be55d9bc94f6f3fe3ab86aa`. The manifest pins all 245 application files; this list does not replace that complete map.

```text
fb6ccca0e5a41adb5415ace4b053817a2cec7dcbc55e5cd3640a25ff25240d13  _bmad-output/planning-artifacts/epics.md
01361676b3fe9a9fe99073a95b20438e02494415a8c83aad56ad7d2f29ff8d86  _bmad-output/implementation-artifacts/spec-21-4-remember-scoped-working-knowledge-with-its-basis.md
0a69af8fa6b67774a9b693671792205d1d21765d58bfd3ebc03ba7f3a68aaac9  _bmad-output/implementation-artifacts/story-21-4-knowledge-context.md
f775ce859f008dfeae5751d5dd54d36f208a754cc80d815e23110478fddf6b22  repair-browser-full-3.log
4be1cdd31ea22cfefb3b16c3fefb1d9b944b318b7e1034b961706dab3ac30d9a  repair-browser-full-3-receipt.json
9a271f2a916b0b6ee6cecb2426f0b3206ef074578be55d9bc94f6f3fe3ab86aa  repair-browser-full-3.exit
d791b51ba7e11452c4de703270a4adf0461bc09f69bc93e5a9069e276360349c  repair-browser-full-3-source-before.json
0165339ba6843ddfc00743399636677f8220a3eb30817930c32c15c695323fef  repair-browser-full-3-source-after.json
8ce30f5c2524290fbcfd28c5507056561e73e5f2358f1586941612030286a3a2  source-repair-final.json
567bfc6e245295e1f18bd852d3e7d98d2f105d60fec018783495378924c3735e  repair-final-gates.json
1481623ec381404e153a4037d0c393efad763a95aeb1638440c479c4d831c4e1  repair-source-reconciliation.json
c45f707a72ded680c691b8cae7b3123b91c0e0a0e5b31ad9b7cfce50f306c2e7  repair-final-handoff.md
000584c2d047565dc62b87a8b13276a314408d2f25737cb32dcbacfa49da84ec  verification-map.md
96861f837b78682e25416246dfacca2d7f9936dc20641989cb6bd32f9467673c  repair-closure.md
74610dbdb9756cdc30643f0704707d8fc012bf427781937c93f80744ee09227c  consumer-contract.md
5f917d2b2c9f8338e5179d9ba3a994008dbb6b4bddcb114157048c21980e9a2f  knowledge-frontend-verification.md
a47a70818cf1e8c3ecda268bad8be744d8cda076cbbae637b0bdb8deb9c5baa8  repair-rust-full.log
9489b12fa989898d132240391301bbccb9d765863201196a5116baf92a973fd8  repair-smoke.log
f9720f698ab69987cf986fc18d8c8cdcd28b7b5fc120794a5cf700559e7eaa62  repair-web-check-12.log
ec7eee68428a75ef40228311d535d935ea43d63cc97b5f436b244ba21a8e3c8a  repair-web-build-2.log
edc91b18ed87adbc5d8b5947ad46d188e1f1c58cf1467523ee9a8c3b7cafe9c1  repair-rust-comment-build.log
b0b272f5b00cd0c0162c6eb9becaebdc66365255d10a1576e44d1eb50f2d9e7d  repair-api-contract.log
40365b1c81829cb1108bf766997467d4c45032683baf4e4c7a2405b83d9d544d  repair-api-query.log
474bc5d31e4f64bdb6d0d860bad0f6849bf3e4f2082f655528a048ca88048349  repair-api-generate-2.log
ba916668e375b476d8e28b56f89f004a7aced5551de1fdc222069ae560c5aedd  repair-knowledge-focused-2.log
8e8a766740b2688da1ce79c4762139099aac7e6b6534f731ed2ef635d9a2db1f  repair-harness-focused-3.log
2a73506666fa80c410c012ec225478c96e37de4bacc271333f32790aff7bf81f  repair-full-failures-focused-1.log
ed4e3385bd4fd7b88b6156c2bd00700e16152fa499b6c9b5a9a37d485e9e420e  repair-preference-outcome-focused-1.log
f3659ee8cb61264afdd8be6a9725d8870df13249c42a4487558ecb7ab0741915  repair-legacy-upgrade-3.log
31ea27c8ccd51eab290c3972cbeebdead281da1624d5eb279c168eb90ad18c1b  schema9-source-proof.json
3b55a01af0ca2c480399a250bcf68fd0cfc4386cd036f6a9905572a1e1fc1bf7  schema9-browser-artifacts.json
ea07fc01dd33a2c1ef13ba2c21c18ecae17265997b7463ae42c570f8c04169cd  schema9-proof-invocation.json
272186f194b921af7b32b9b5c2fc22ed6da30ff876c069f0f360b1e01ad4b75a  repair-legacy-public-capture-final-proof.json
cc090e0f3427c9536b406ac0e77a107c4b6fedfab184d586f818ace1f3711e15  repair-public-source-io-final-proof.json
7b9811c933043f585b5b934f9c6b4b68c0f47688d01e00e3aa06de073d499fb7  repair-authority-expiry-focus-final-proof.json
0ba376c5f5b3e5eb7d199be1f032a1d5807c76228cbc5d5ac3db02de5a9a5ced  repair-conversation-access-fault-final-proof.json
ac7fde1258de2e7b20a8a74eb5217e18f3ee978ebae739bc8edebf729793d7d8  repair-owned-blocker-chain-final-proof.json
2d77b07adb328e1df151371eb797939b1fe1b3ee77fd93d9ec3a91ea497fa63d  repair-skills-route-lifecycle-final-proof.json
690a99af44d9f5487651980f2e2a60612f436acecd4bd960d9c82607f9976b5e  root-final-comment-only-proof.json
2e23c1ec7c41735a3c380606bd9e971d3dbb939dc3bcd50fafa58819c6d16ec2  root-final-visual-review.json
a09fd8502879b715f0608830c61c7b6f67c6b4ccb1cdbb923850b029b50f3e8d  repair-final-visual-inspection.json
305b2e0211bc59db344b02280fd2aa4ef66bf691909c532d29a1f84f8aa27d02  review/core-repair-execution-closure.md
e89eac5a2026a35018520d8fc2c4a8e0f77164d8ec014f6598d2fd4e819f386c  review/ports-repair-execution-closure.md
cf8d604df1f3f31045a0e8d21f6faf88b0ab440251281dfe371a0b369ca33abe  review/harness-repair-execution-closure.md
adb7331313a1f5b4c15d279e47992a6d504e49415f547eaa856f4cf870356f4f  review/ui-focused-execution-closure.md
6dccf3c9a3fdb9e9b29e35fbcb8c836a4bce1599d2de094af49ee9b701754741  review/full-run-followup-review.md
17fa787037ef7746134627d61a8fc9d3da1e803e8d106d1701f90d637f6fea09  review/preference-full-run-review.md
```
