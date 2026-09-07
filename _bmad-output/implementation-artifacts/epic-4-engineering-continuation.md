# Epic 4 engineering continuation

Status: INCOMPLETE — not accepted, not merged.

## Baseline and handoff

- Branch: `codex/epic-4-agent-runs`; draft PR #24.
- Historical review: `b6bcd466749c56d2c37f8d8a46669dcf0f32d001`.
- Remote inspected: `94978c99622997eaa5eccf968ab210b3a91c2969`; main `12ec596dc3d23907a80a7d395c343a54c4375d5a`. PR #23 remains open.
- Source recovered from GitHub Actions artifact 10009524638; ZIP SHA-256 `9689165b431c0745754ab6ea3a3fc9f4ae19a3471cebcec347b39021b0554e4c`, verified locally. Checkout was clean.
- Prior repairs preserved: migration `380a4ff744f73558fa7ef6bf3e7260cdf1638e16`; provider identity `e0fe4f362485faa1a40bb57c50d29ce2689d9317`; authentication `15d01389bbe2d272f44a0a8ae515ecb061fe7507`.
- Chromium installation is present in the PostgreSQL CI job (`663c959`), preserved.
- Snapshot workflow and delivery payload were already absent. Removed the remaining branch-writing delivery workflow in pushed commit `9a5f2eb370f9e2db28192c0c441354c35cd18a4a`. All inspected delivery runs had terminated.

## First reproduced failure and checkpoint

At `94978c9`, root TypeScript checking failed with `TS1161: Unterminated regular expression literal` in `tests/integration/sealed-evidence-upgrade.test.ts`. The transport had inserted a literal newline in a regex. This checkpoint restores its intended escaped newline; root TypeScript checking then passes using Node 24.20.0 and the repository's TypeScript dependency. This is a test-compilation repair, not populated-migration acceptance.

Current-head CI run 34098512827 ended `action_required`. Green run 34098492301 tested `982fd78`, before the migration repair, and is not evidence for that repair. No gate is waived.

## Remaining work

- Re-run real PostgreSQL 18 fresh and populated upgrade tests; inspect migration compatibility and historical evidence preservation.
- Verify provider-identity and authentication regressions, including cleanup discoverability and approved positive authentication postconditions.
- Stories 4.4, 4.5, 4.6, 4.7, 4.8, 4.9, 4.10, 4.11 remain `ready-for-dev` in the inspected sprint file and are not accepted.
- Complete the specified real worker/application/persistence journeys and all required gates.
- Live Solari audit acceptance remains unverified; a public-page smoke or local Chromium run does not meet it.

Next action: validate this checkpoint through normal CI and repair the first remaining regression before story implementation. No merge or deployment is authorized by this checkpoint's status.

## Populated-upgrade verification checkpoints

- `7c6ab687acfe2c3a115550cbfefebc02ac7d19b6`: 3041 unit tests, full typecheck, boundaries and workspace build pass locally with Node 24.20.0 / pnpm 11.25.0. Hosted CI verifies typecheck/unit/boundaries and container builds. PostgreSQL revealed incorrect assertions in the inherited migration regression.
- `245fc301dc7070e83c24697965a69271e0ecc628`: assert the Drizzle error's PostgreSQL cause.
- `d2930961a2fdf957b78c0192baff906e4fadc1e1`: assert actual sealed-trigger SQLSTATE 23514. CI 34129224665 passes 384 integration tests and reaches the successful populated upgrade, then fails because the test treats a timestamp string as a Date.
- This checkpoint normalizes that timestamp and checks complete evidence, population, snapshot, outcome and seal rows after repeat migration. Real PostgreSQL acceptance remains pending this checkpoint's CI; no claim of acceptance.

Generation 32 compatibility: the preserved repair changes only transactional locks and trigger suspension/restoration around the existing backfill; transformations remain identical. Databases already at generation 32 do not rerun it (the migrator uses the migration journal timestamp); no reset, rollback, or manual replay is required. Databases at generation 31 run the guarded form. The populated test exercises the real migrator and real protection triggers, including transactional rollback. This is an explicit compatibility plan for the inherited historical-file repair, not permission to alter later applied migrations casually.

## Provider cleanup checkpoint

Persisted provider mismatch regression retains original mode, workspace id and expiry, calls no attach/release/create, and leaves the failed cleanup row discoverable. The additional terminal-expiry regression fails against `56a6b12718832c8a8c2734ed31351827c895029b` (provider error escapes) and passes with this repair: all 20 workspace tests pass. Expired Solari cleanup records `workspace-expired`; unexpired release failures still preserve the cleanup reference for retry. Application typecheck passed. This is local regression evidence; hosted integration remains required.

Checkpoint transport note: `162d030014a42e489638fe568f68475ad63418ae` accidentally contained a truncated decision-log read. `56a6b12718832c8a8c2734ed31351827c895029b` immediately restores the full local copy. No history was rewritten. Subsequent uploads compare the complete local Git tree to the remote tree before advancing the branch.

## Positive authentication checkpoint

The prior marker accepted arbitrary accounts and suffixes. The new exact-account unit regression fails against `8e3389e03de953b88bb9d14ed858b208f6803d7f`; repaired auth/browser/application tests pass (65 in the focused root run; 111 in the combined Northstar/action suite). Failed form submission discards the potentially secret-bearing page with context/browser close fallbacks, retaining provider cleanup identity. Authentication redirects must remain within the selected target, even if another destination is also configured. Real-browser regression adds fresh/valid-existing/stale/unrelated/invalid/wrong-account/suffix/cross-target/failed-submit cases. Local Chromium is unavailable; these browser tests await hosted CI and are not yet accepted.

## Verified repair baseline

`966e4780fa83d1e0c0a6c7b7fbc91a2f66135ab9` is pushed and all CI 34130364168 jobs pass: typecheck/boundaries/unit; PostgreSQL 18 fresh migration, schema drift, 392 integration tests (25 files), including real populated sealed upgrade and 10 real Chromium authentication cases; container build/startup guards; full accessibility and shell browser suite. This is the verified A/B/C repair baseline, not Epic4 acceptance.

This further migration-regression checkpoint replaces placeholder evidence digests with actual synthetic artifact bytes and their SHA-256 digests and verifies those bytes after upgrade and repeat migration. The final-schema migrator still runs unchanged. Its hosted verification is pending. Next: complete4.4 capture and registration plus the4.6 model loop, then durable waits/review and golden/negative journeys.

Remote acceptance blocker confirmed by read-only inspection: no local Solari credential; Railway production worker `84394c42-5018-4cb4-9a7a-707b2ca1fe4a` in project `ade2dc6b-9e91-4ecf-bba8-68638389125d`, environment `1ea4d58f-afab-498f-9dcd-a195e0009026`, has no `SOLARI_API_KEY`. OAuth returns variable names only. Existing Northstar domain is `northstar-production-b312.up.railway.app`; no infrastructure or variables were changed. Model key names exist in production but their values are not available to this checkout. No live-provider acceptance or deployment claimed.

## Story4.4 registration checkpoint (incomplete story)

Identity/value grounding split now refuses the entire Observation batch through the existing registration command. Removing that guard causes the new regression to fail; restoring it passes all81 focused domain/application Observation tests. The13-key wire schema and digest contract remain unchanged. This checkpoint is locally tested; hosted CI and actual capture/worker/persistence/UI journey remain required.4.4 is not complete.

## Story4.4 structural substrate checkpoint (incomplete story)

The web_tree parser, media type and corroboration are implemented for bounded grouped semantic nodes, with controls distinct from data cells. Optional completion metadata requires a producer-specific postcondition; no declared count is inferred from node count. Independent Python golden fixture plus parser/corroboration negatives pass24 focused tests. Domain typecheck/build pass. Desktop remains explicitly unsupported. Capture, persistent work-item execution and inspector wiring are still in progress;4.4 is not accepted.

## Story4.4 artifact storage checkpoint (incomplete story)

Generation33 adds structural-snapshot/screenshot kinds to the existing Evidence storage contract, retaining the existing sealing guards. Each kind has a distinct stable reservation/object key.29 focused artifact/schema-range tests pass; the migration was generated from the schema, with the explicit generation marker and build compatibility range added. The producer is not yet wired, so this checkpoint is not an accepted agent journey. Hosted fresh/populated/drift gates will test this generation.

## Supported-substrate regression correction

CI34132656180 on f3ba33e20e5dcee49623e73aba686ed60ab86e72 passes container and full browser/accessibility gates. Unit and PostgreSQL suites each fail one stale test expecting web_tree to be unsupported. The desktop_tree case now retains unsupported rejection coverage; malformed web_tree explicitly fails corroboration-unavailable without matched identity or attributes. Seven focused application tests pass locally. Hosted verification of this correction is pending; no story acceptance claimed.

## Verified generation33 and browser capture checkpoint

026833c1104e8b638b3944114039110f9a157d0c is pushed and all four CI34134813593 jobs pass, including fresh/populated migrations through33, drift, PostgreSQL integrations, container guards, browser/accessibility. The next capture checkpoint adds real bounded GET form search and guarded platform web_tree/PNG production; browser unit25 and action-gate31 tests pass locally, full typecheck passes. Four new real Chromium capture integrations await hosted CI. This is a capture mechanism checkpoint, not accepted4.4: actual worker Observation registration and authorized inspector artifact access remain unfinished.

## Story4.6 model gateway checkpoint (incomplete story)

Real Anthropic/OpenAI SDK adapters implement ordered approved action proposals, structured uncertainty, cancellation/deadlines, sanitized operational failures, measured usage and bounded fallback. Usage already spent by a primary provider is retained; unaccounted attempts are explicit.24 gateway +2 port tests pass; source/build boundary negative tests pass26. Full workspace typecheck passes with the pending worktree. No live model call was made: production key values are unavailable locally. The durable Run ledger and actual loop are not included in this gateway checkpoint and4.6 is not accepted.

## Durable execution and waits checkpoint (incomplete stories)

Generation34 adds operational agent progress/turn/capture bindings, per-population Work Item identity, Run revisions and immutable typed waits. The adapter transaction context is extracted without changing its shared Observation/Evidence/Gate/Result writes. Wait creation atomically records Awaiting Auditor plus one delayed job; answer locks and compares the Run revision, leaves the original wake intact, and abort uses performCancellation. Worker starts the wait consumer and bounded recovery and drains recovery on shutdown; only the release migrator creates the queue. Nine command +three worker tests pass locally. Five PostgreSQL tests cover actual queue rows, partial SQL closure rejection, revision/closure races and timeout sealing; hosted acceptance pending. Model work-item loop, notifications and answer surface remain pending. No Epic4 story is accepted by this checkpoint.

## Capture integration assertion correction

CI34136780203 on31317cc2d5daf78cc143b4858cd278051fec3c97 passes typecheck/boundaries/unit. PostgreSQL runs396 integrations:395 pass, one new capture assertion compares Node Buffer with Uint8Array although the PNG signature bytes match exactly. This correction compares all eight byte values explicitly. It neither skips a check nor changes capture behavior. Candidate34 CI remains pending; full acceptance is not claimed.

## Checkpoint composition correction

CI34137578823 on a64d3078d2d0c2bb2f1941e3c9a73b6ef021dca4 fails infrastructure typecheck before migration/tests: the shared barrel included a notification sender export whose implementation remained uncommitted. This corrective checkpoint removes only that premature export; the notification implementation stays separate. Generation34 hosted verification remains pending.

## Generation34 hosted verification and schema inventory correction

CI34138046009 on a24c5d993551795e259827761f66b2564c09fbfb passes fresh migration, migration drift, populated/repeat upgrade, all five wait integrations, Chromium capture, unit/typecheck/boundaries and container builds. Integration total:400 passed, one failed: the exact public-table inventory omitted the four intentionally added generation34 tables. This correction explicitly lists run_agent_turn, run_agent_work, run_evidence_capture and run_wait; the exact equality gate remains. Hosted verification of this correction is pending. No story acceptance or merge is claimed.

## Worker model configuration checkpoint (incomplete agent flow)

Optional provider-native keys now compose the worker-only Anthropic primary/OpenAI fallback (or one configured provider), independently of plan derivation configuration. Production non-worker processes reject these keys without echoing values. Model identity carries a validated deployment commit when supplied, otherwise the truthful unidentified-build label. No provider means no gateway, never a scripted fallback.66 focused configuration/startup tests and full workspace/root-test typecheck pass locally. No network model call was made; the actual work-item loop remains in progress.

## Browser deadline and search-containment checkpoint

One absolute action deadline now covers page creation, navigation, actual form entry/submission, capture and authentication proof, with bounded failed-page cleanup preserving workspace/provider identity. Search validates browser FormData before submit and a temporary route aborts mutated main-frame requests before transmission, then falls back to the existing workspace egress guard. Explicit negative Chromium tests cover hidden fields, named submitters, onsubmit mutation and late navigation; blank optional controls remain supported.26 browser unit tests pass locally; new real Chromium regressions await hosted CI (no local browser/PG). This checkpoint does not complete4.6/4.11 or establish live Solari acceptance.

## Agent evidence and turn-ledger helpers (incomplete worker flow)

Capture helpers use existing artifact reservations/conditional upload/readback verification and registration, then bind Evidence to the persisted Tool Action. Found Observations read frozen grouped web_tree cells, require unique exact primary and configured secondary identity, and preserve missing fields as ungrounded. Absence uses the unchanged shared judge; an arbitrary empty page, missing secondary lookup or incomplete result cannot pass. Model turns reserve bounded token capacity durably before provider I/O and retain unknown paid usage conservatively across failure/restart.27 focused helper tests and full typecheck pass locally. Actual loop/repository integration remains in progress; no story acceptance.

CI34139126887 on64df0310afab49ff930bd7cb33fd73d968a0e784 passes PostgreSQL migration/drift/integration, typecheck/boundaries/unit and containers; browser/accessibility was canceled by the next push and is not claimed passed for that SHA.

## Story4.8 connected answer/notification checkpoint (hosted acceptance pending)

Generation35 extends existing notification tracking with scoped wait/run identity and channel outcomes; a SQL binding guard rejects mismatched wait/kind/deadline/procedure/version. Wait creation enqueues initiator plus Audit Managers transactionally. Existing delivery now locks Run then wait, records idempotent in-app/email outcomes and truthfully records email unconfigured. The inbox reads open waits independently of delivery, with current-role checks. Run Detail reads current wait revision and matching execution provenance, renders model rationale/candidate text inert, and answers through the authorized application command and confirmation dialog. Closed fixed options never take labels from retrieved text. Worker uses one bounded non-overlapping delivery poll and drains it on shutdown.

Full workspace/root-test typecheck passes locally.109 focused notification/escalation/configuration checks passed before the last explicit metadata-read guard; the focused41-test surface/command subset passes after it. Migration generation reports no drift. Six actual Playwright cases and PostgreSQL notification/wait/authorization regressions are included for hosted execution; local environment lacks Chromium/PostgreSQL. Email delivery itself is not configured or claimed. Runtime model-raised waits and the remaining Epic4 journeys are still in progress. Latest fully green pushed predecessor is bfdbaa6479ff44f5b253a3c5674f53ed0aaa42af (all four CI34139768109 jobs). This checkpoint is pushed for verification, not accepted for release.

## Escalation checkpoint CI corrections

b04e153acdfdaf24fba15a37c50935304cbef735 is pushed but not accepted. CI34140916737 passes container builds and generation35 fresh/populated/drift migration checks; 406 PostgreSQL tests pass, notification fixture setup fails before its two tests, boundaries detect a notification/wait import cycle, and the browser suite reports one provenance locator mismatch. This checkpoint extracts the shared kind vocabulary, fixes the explicit JSON fixture binding, and scopes the provenance assertion to the actual safety label without removing injection assertions. Local boundaries and 13 focused wait/notification tests pass; hosted verification remains pending. Epic4 remains incomplete; no merge.

## Current-page read checkpoint

d9b606307aaf27b1956a9e2bd66244f54c505394 is pushed. Its CI passes typecheck, boundaries and container checks; unit exposes native timer rounding (remaining deadline 1ms), browser exposes a second overly broad provenance-body locator. This checkpoint preserves real GET search results for read-attribute without reloading sanitized destinations, checks full untruncated authority/path and scope, and refuses missing response metadata after restart. 29 focused browser tests pass; the nine real-browser capture integrations remain pending hosted verification. Deadline assertions now use a controlled clock without loosening bounds. Not an accepted story or release candidate.

## Escalation question body selector correction

The real browser rendered the question plus both candidate labels as separate inert pre elements. The regression now scopes the expected literal script text to the question's provenance container, retaining the zero executable scripts assertion. Previous CI reached this assertion after successfully checking question provenance. Hosted retest remains required; no assertion was removed.

## Story4.9 evaluation and review backend checkpoint (incomplete story)

Generation36 retains original machine proposals, adds a separately revisioned review aggregate and immutable decision ledger, and binds decisions to the actual pending evaluation and original evidence. Existing CompleteRun publishing is reused by sealResult; intermediate answers preserve Result.version1 and the original package, while the final answer seals version2. Effective counts/findings overlay history rather than rewriting machine rows. Missing historical proposals remain NULL. The adjacent revision reconciles AD21 with the frozen Result shape and single-update trigger; no owner decision is asserted.

139 focused domain/evaluation/registration/sealing/review/schema tests pass locally. Four real PostgreSQL review tests cover concurrent answers, final Unevaluated/Exception/Compliant outcomes, original proposal/package preservation and authorization; hosted execution is pending. The migration consistency check passes locally. The browser surface and genuine model-producing work loop are separate pending checkpoints;4.9 is not accepted. Latest prior push33f36229cad6d5a7d9f0df4887b74141275c7e7b is under CI34143277716. No merge or deployment.

## Story4.9 connected review UI checkpoint (incomplete story)

Run Detail now reads the actual review revision/current pending count, renders original proposal and decision history, confirms fixed values, requires rejection rationale, and invokes the transactional commands. Unknown database errors are stripped before telemetry.20 focused UI/action tests pass; five Playwright cases are discovered and await CI. The existing escalation injection test now checks for executable scripts inside untrusted containers; its former whole-document check counted Next.js framework scripts.

33f36229cad6d5a7d9f0df4887b74141275c7e7b passes typecheck/unit/boundaries, container checks and409 PostgreSQL18 integrations (28files), including9 real Chromium captures and2 notification delivery tests plus fresh/populated/drift migrations through35. Its browser suite has only the above script-selector failure. Backend0a4ccb9e39e248c0750a4b56ad4c10bba47d49ff is pushed and its schema36 verification is pending. No whole-Epic acceptance, merge or deployment.

## Genuine model judgment phase checkpoint (incomplete worker journey)

The real provider gateway now supports a strict evaluation phase after a final captured Observation, binding allowed conditions and platform-supplied Observation identity. It rejects duplicate/unknown conditions and malformed confidence/rationale. Agent prompt2 is separate from unchanged procedure prompt1. The durable reservation includes all evaluation bytes before provider I/O, with a regression refusing an oversized final Observation before any call/write. Gateway/ports/turn/startup focused tests pass locally; live provider credentials remain unavailable. db37d01006019ee66d3fe7ca5e153008a68fd893 is pushed for review UI verification. The actual worker loop is still a separate unaccepted checkpoint.

## Story4.11 browser write/isolation checkpoint (incomplete story)

Code review found the context route allowed same-origin page-script writes despite the Tool Action gate. The context now permits only read methods, with one exact credential-bearing main-frame POST armed solely for real login and revoked in finally.30 browser unit tests pass. Real local-Chromium regressions cover concurrent same-origin cookie/storage isolation, cross-Run reference refusal, release independence, page-script writes never reaching the server, and credential reflection refusing capture; hosted execution is pending. They do not prove Solari isolation or full4.11 acceptance. e1e7c3a171ebdb1c3bcbb7012842f685a6ce3ab9 is pushed; its model/turn/startup focused run passes76 tests locally. Remote-provider acceptance remains blocked by unavailable Solari credentials.

## Unknown Agent-Judged applicability regression

An ambiguous identity can make C2 applicability unknown rather than false. Registration now accepts only UNEVALUATED with no proposal, confidence, rationale, or confirmation in that case; fabricated proposals or compliant values remain refused. The new regression fails on 82a924f and passes with the repair (38 registration tests plus the previously failing loop case; application typecheck passes). No authority or predicate was changed. Pushed checkpoint; full connected journey and hosted acceptance remain pending.

## Connected P-1 worker checkpoint (Stories 4.4–4.7, incomplete acceptance)

The worker now hands frozen web targets from shared population/reference acquisition to a leased model-directed work loop. It captures real browser artifacts, reads model-selected approved fields, registers through the shared corroboration/evaluation writer, and reaches the existing Gate/Result. Exact primary/secondary searches and completeness proof govern absence. Limits and model reservations persist; model-authored scope parameters are denied. Typed decisions retain their original capture and immutable wait provenance across registration failure, expired leases, candidate/unnamed/retry chains, and are consumed transactionally with Observation registration.

Local candidate worktree: full typecheck and 3,327 unit tests pass (150 files), including dependency-boundary self-tests. New real PostgreSQL/local Chromium journey and repository tests are included for hosted CI; they are not local browser or live model acceptance. All model-stub tests are explicitly fixtures. Provider restart reattachment/sign-in still needs repair: inspect alone cannot restore a fresh process's browser context. Inspector artifact access and P-4 integration remain incomplete. This checkpoint is pushed; no story acceptance or merge is claimed. Parent fae04838fe1ff0810a28ded8a0d87b60144f9530. Next: inspect its CI, repair provider restart, complete P-4 and final negative review.

## Review history browser regression

Hosted CI 34144846697 at 82a924f reaches a successful rejection and sealed INCONCLUSIVE Result, then the page omits review history because its composition mounted review only for COMPLETED Runs. This repair also mounts immutable review history for INCONCLUSIVE Runs. The component regression passes (21 review-focused tests); a fixture teardown now deletes Work Items before referenced Evidence, preserving all database protections. Hosted browser verification remains pending. That CI also exposed a sign-in failure and an unfinished/cancelled PostgreSQL job; neither is accepted. Worker-loop checkpoint 2ab4f0933fefccf652655489b9d560b7c63cdeb0 is pushed. Next: repair deadline/retry/order findings and the sign-in regression; finish P-4.

## Agent deadline, ordering and retry regressions

Three regressions fail against 2ab4f09: target processing was employee-major; final Gate still ran after an Observation consumed the remaining deadline; and repeated model uncertainty offered a second extra retry cycle. A fourth isolated regression removes the new locked registration guard and proves that a Run-lock delay then registers one late Observation instead of zero. Repairs recheck limits under the registration lock and before Gate, keep already captured evidence, order all records within each frozen target, and cap action/C2 uncertainty grants through the existing two-cycle budget. 43 focused loop/human-decision tests, application typecheck and diff check pass. Hosted real journey verification remains pending; checkpoint pushed, not accepted. Parent dbd1dd527f2c5b936982f8028d743b59f5e8737a.

## Exact form-action authentication repair

CI 34146625562 at 019bab52 verifies 135 browser cases including repaired review history; four sign-in cases fail from one original authentication refusal. The context write guard had armed HTMLButtonElement.formAction (the document URL when no override exists), rather than the form action actually submitted. resolvedSubmitter now checks explicit override attributes and otherwise uses its associated form action/method. Existing real-form regression covers the native fallback; an additional real-browser case retains explicit formaction override behavior. Browser/proof unit tests and infrastructure typecheck pass; local Chromium is unavailable, so hosted browser verification is required. PostgreSQL CI stalled after early passing modules and is not accepted. This repair is pushed separately from test progress instrumentation.
