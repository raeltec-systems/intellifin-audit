# Epic 4 engineering continuation

Status: INCOMPLETE — not accepted, not merged.

## Current checkpoint — investigate credential baseline failure

- Branch `codex/epic-4-agent-runs`; draft PR24; no merge or deployment.
- Pushed candidate04f2a3ef60fbcc1d02b4c05cffe9459d63a15671 has four green jobs in CI34203072973:3537unit tests/169files, full typecheck/510boundaries,472PostgreSQL tests/39files with fresh/sealed31/populated40 upgrades through41 and22smallmutations, all image checks, and162browser/accessibility tests. P4's corrected stored-read proof passes.
- CI merge09258c7102a32fe5abc6607f56f394eb542fa865 has exactly the candidate tree0f09f3f7c62f0ba02f69c24ce59387f13af4bec6. The worker mutation job101986134368 passes its first four guards, then its credential BASELINE reaches RUN_FAILED instead of AWAITING_AUDITOR. This is not a mutation kill and not an accepted candidate. The same credential case passed in the main browser suite and the earlier complete29guard matrix at f4892c9.
- This diagnostic checkpoint preserves the required wait and all scanners, emits only allowlisted durable diagnostics/booleans on failure, and requires three independent credential lifecycle repetitions in the matrix. These are unconditional required cases, not retries. TypeScript, harness syntax and discovery pass. Runtime cause remains under investigation; hosted reproduction is required.
- Complete earlier29guard evidence and this later failed baseline are committed separately. Production code has not changed since f4892c9; no new failure is dismissed as a flaky pass.
- Live Solari remains blocked by missing Actions secrets/model settings. The supplied key is outside Git. Production prerequisites and target compatibility remain unverified; optional D3 mapping/surface scope, email-unconfigured and later-epic limits are documented in the engineering report.
- Next: push this diagnostic checkpoint, inspect the three unconditional baseline executions, repair the demonstrated cause, and complete the exact-candidate gates. No merge while any critical gate remains open.

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

## Initial remaining work (historical handoff)

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

## Integration progress checkpoint

Normal CI now reports each integration module before its hooks and after completion. The previous PostgreSQL job stayed silent for roughly ten minutes after four passing modules; default aggregate reporting did not identify the active module. The reporter prints only repository file identities, never queries, target content, credentials, or test payloads. Node syntax check passes; it changes no assertions, database behavior, timeout, or merge requirement. Browser form repair 4b94bb8c39d6546d595ee472d8c460dce65ecd52 is pushed with 47 browser/proof unit tests passing. Hosted final acceptance remains pending.


## Explicit P-1 target scope repair

At e324d360f117daa78cec613b07dc87955185ff34, CI34147564576 passes type/unit/boundaries, container builds, fresh/drift migrations through36 and423 PostgreSQL tests; eight tests fail. Five journey tests fail before execution because canonical P-1 validation adds mandatory desktop coverage to explicit web-only scope. Two schema inventory lists have ordering errors; one adapter test expects the obsolete pre-agent refusal. Browser CI passes138/139 including real login/credential containment; only its pre-investigation refusal assertion remains stale. Sealed-evidence populated upgrade, positive authentication, review ledger and isolation integrations pass.

This repair follows the owner's explicit selected-target scope and addendum C's default-target wording. Web-only P-1 now compiles without inventing a desktop; all actually selected targets remain frozen and unsupported desktop execution is still refused. Two failing-before regressions now pass;56 focused target/template tests and domain/root-test typechecks pass. Checkpoint pushed; real journey rerun remains required. No release acceptance, merge or deployment.


## Workspace recovery and public P-4 access checkpoint

After confirmed workspace replacement, normal and recovery worker paths now repeat approved target access before investigation. Forced reauthentication preserves previous attempts/history and rejects failed access. Existing-provider release failure still prevents replacement and retains the cleanup reference. P-4 public-page access requires its exact frozen label contract, bounded credential-free snapshot, nonempty snapshot identifier and parseable count; it never resolves audit credentials or records session-established. Count reconciliation remains the later shared Gate's job.

56 focused provisioning/access tests pass, including replacement reauthentication, ordinary redelivery and public/password/contract negative cases. Full candidate worktree typecheck passes;186 focused P-4/evaluation/access tests pass. Real restart/public P-4 PostgreSQL/browser verification is pending. Parent eb3cd8696d2da81b89612abfb156167b0a649e5e is pushed. This checkpoint is pushed but not accepted; authentication destination hardening, inspector mediation, human Exception lineage and remaining journey verification remain open.


## P-4 shared evaluation checkpoint

The shared domain/application rule evaluator now accepts validated compliance baselines from frozen population rows and the Run period. Duplicate baseline keys remain duplicated and therefore unresolved; missing/invalid/out-of-period observation times remain UNEVALUATED. The actual P-4 producer exposed the missing baseline/freshness input before repair.67 focused evaluator/registration tests pass; the connected P-4 loop's normal, duplicate, missing and prohibited cases pass locally with model/browser fixtures and remain a separate pending checkpoint. Full candidate worktree typecheck passes. Parent c996a75eb870fbb8d42ab3d308ad1069b9d6ccd2 is pushed. This shared-evaluator checkpoint is pushed, not whole-story acceptance.


## First investigation claim foreign-key repair

A first agent claim saved run_agent_work.work_item_id before inserting the referenced Work Item. PostgreSQL's immediate FK rolls back that claim, explaining the authenticated but stalled worker fixture. The repair changes only write order inside the existing transaction. A focused FK regression fails before repair and passes after;19 loop tests pass in the candidate worktree (including the separately uncommitted P-4 case). Static checks currently await concurrent authentication-contract edits; no exact-candidate typecheck acceptance is claimed. Parent72e9afbdf86b3dc7ad8a722fd3e309e8f0dbebba is pushed. This repair checkpoint is pushed; hosted journey retest remains required.


## Connected P-4 checkpoint (Story4.10 acceptance pending)

The worker's P-4 branch now uses model-directed approved snapshot reads, one page Work Item, shared registration/corroboration/rule evaluation, immutable page declaration and existing Run Gate/Result. It preserves duplicate frozen baselines and emits honestly uninspected missing parameters. Page count and identifier bind to the actual registered capture; SQL supplies the registered Observation count independently of the event claim. The original population reconciliation remains intact.

186 focused population/evaluation/declaration/producer/access/loop tests passed before the separate first-claim FK repair;19 loop tests passed afterward. The real PostgreSQL/local Chromium golden P-4 journey is included and awaits hosted execution; it uses an explicitly labeled model proposal stub, actual Northstar page/source and real application/repositories. It is not live-model or Solari acceptance. Concurrent authentication-contract edits currently block an exact full-tree static claim. Parent b8e66c607c6317634c36f25d83ddb3e191782bde is pushed; this incomplete story checkpoint is pushed. Next: hosted golden/found/absence journeys and remaining authorization/inspector/review repairs.


## Hosted regression assertion checkpoint

The two generation36 column inventories now match PostgreSQL's ORDER BY column_name without changing their exact sets. The adapter test verifies web work is left unobserved for the agent, with no Result fabricated. The real sign-in fixture now expects the current unsupported P-2 browser-investigation diagnostic after successful authentication, and safely polls all durable stages to expose future stalls. Explicit empty model keys keep that authentication test from making provider calls. No positive-authentication or credential-containment assertion was removed.

The corresponding failures were reproduced in CI34147564576 at e324d360;138 browser and423 PostgreSQL tests passed there. Candidate typecheck previously passed before concurrent auth-contract work; diff check passes. Hosted rerun is required for these real PostgreSQL/browser changes. Parent2fe58e65d763baaf19c56d58c07ac9ec3df4ad33 is pushed. Checkpoint pushed, no release acceptance or merge.


## Repeated search-form absence repair

CI34149265415 at aafe3b66774b15b8995dafa82fca131d7252206f passes type/unit/boundaries/container builds and429 PostgreSQL tests. The found journey reaches correct grounded registration; its verification query used raw_digest rather than run_evidence.digest. P-4 registers all five expected Observations and matches every golden evaluation; its exact Gate assertion exposes an extra mandatory-value finding under review. Both new fixture teardowns also need the existing immutable-object deletion order.

The actual absence runtime defect concatenated pre/post-search controls, treating a repeated form as duplicate fields. The new positive regression fails before repair and passes after;11 planner tests pass, including true duplicate controls and wrong-control-name refusal. Both searches still need registered complete zero-result snapshots. Parent aafe3b6 is pushed. This focused runtime repair is pushed; exact real-browser absence retest remains pending, no release acceptance.


## Prohibited-baseline Gate regression

The real P-4 golden journey at aafe3b6 registered all five expected Observations and their exact evaluations, but the shared population Gate incorrectly demanded an approved comparison value for an explicitly prohibited parameter. A domain regression reproduced that extra mandatory-values finding. The repair exempts only the empty approved_value of exact P-4 prohibited rows; schema presence and all other mandatory checks remain enforced.33 Gate tests and domain typecheck pass. Parent e179dd81ec54d118443ce505b909be369c63e8cc is pushed. This repair is pushed; the unchanged exact five-row Gate failure assertion remains the hosted acceptance target. CI34149265415 also confirms139/139 browser/accessibility tests passed at aafe3b6.


## Journey verification cleanup checkpoint

The found-journey digest assertion now reads run_evidence.digest, retaining exact stored-byte comparison and credential absence checks. Both disposable journey teardowns follow real protection dependencies: Result/package before capture metadata, Observation before permanent Exception. No trigger or production object is modified. These failures were reproduced in CI34149265415; hosted retest remains required. Parentd8d64f8eb97cfea37b4cc171faef682c5f044825 is pushed; this test checkpoint is pushed.

Release remains blocked independently of CI: project ade2dc6b-9e91-4ecf-bba8-68638389125d, production environment1ea4d58f-afab-498f-9dcd-a195e0009026, worker84394c42-5018-4cb4-9a7a-707b2ca1fe4a has no Solari key, evidence-store variables, audit credential manifest or Exception fingerprint key. Provider key values are unavailable through OAuth. Northstar1a491862-5633-407b-8032-acd1b14113e0 has northstar-production-b312.up.railway.app:4300 and /health configured, but the available HTTP reader refuses that domain; this is not proof the service is down. No deployment, infrastructure, recording or variables changed. Full Solari audit/auth/evidence/result/confirmed-cleanup acceptance is still unverified. Continue code/CI repairs; do not merge.


## Capture completeness checkpoint

Baseline c412f488933b264049c3e0c52df79cc2bbf1b805 is fully green in CI34150032633: all four jobs pass, including432 PostgreSQL tests across34files, fresh and populated migration paths, schema drift, web/worker/Northstar images, and browser/accessibility. This is CI local-Chromium evidence, not live Solari.

This checkpoint repairs screenshot transport degradation through the shared Observation writer and enforces required same-action captures. Missing screenshot remains grounded but cannot Pass. Integrity and unknown screenshot failures no longer become partial success; capture-integrity failure terminates the Run on its first attempt. Regression tests failed before the narrow repair;130 focused tests pass (observation54,registration46,capture9,agent-loop21), and diff check passes. Concurrent auth/review/inspector changes are excluded. Hosted regression remains required for this exact checkpoint. Parentc412f488933b264049c3e0c52df79cc2bbf1b805 is pushed; this checkpoint is pushed. Next: finish durable review lineage and authorized stored-snapshot inspection, then final-schema/full-candidate verification. Live-provider and deployment prerequisites remain blocked as recorded above; PR24 stays draft and main unchanged.


## Rejected-model security audit checkpoint

Two regressions reproduced missing security.action-denied events: a typed response selecting an unknown tool and the real gateway's invalid-response error. The former now stops before execution; the latter retains the specified bounded retry while writing an ID-only security denial transactionally.23 agent-loop tests pass, including both regressions; diff check passes. No rejected content or destination is logged. Parent7206a83d57b5782d69ba5992f0c9098bd20c61d3 is pushed and its CI34150880550 migration/integration, static/unit and container jobs pass (browser job pending at recording). This checkpoint is pushed; full4.11 mutation acceptance and final candidate verification remain incomplete.


## Mutation-test delivery checkpoint (incomplete Story4.11)

Runtime baseline10b7d563179a78bcebda9a07873766baec80b0d4 passed all four hosted CI jobs in34151306483. The isolated mutation log records ten actually-killed guards,21 selected assertions, exact source/test hashes and red failures. New golden unit/SSR suites pass14tests locally. Both hero injectionstrings and allthree seeded widening instructions are read from fixture artifacts. The surviving SSR preselection trial and missing real-worker/browser coverage are explicitly retained.

This checkpoint adds six real local-Chromium abuse/capture/cleanup cases and a normal CI mutation step in a separate detached worktree. The existing PostgreSQL job installs Chromium, runs integration tests, then runs the selected unit+browser mutation harness and uploads its secret-free report. Browser mutations are not yet verified; this is an incomplete checkpoint, not4.11 acceptance. No delivery/branch-modification automation is reintroduced. Parent10b7d563179a78bcebda9a07873766baec80b0d4 is pushed; this checkpoint is pushed. Next: run the hosted mutation gate, finish hydration/worker abuse cases, and integrate review/inspector/auth migrations37–39 before final verification.


## ProdConsole catalog timestamp checkpoint

A failing catalog regression exposed that the page's existing Snapshot taken at label was absent from the seed registration, while the PG golden fixture supplied a custom superset. Only registration label metadata is corrected; no golden data, timestamps, expected counts or outcomes change. The journey now derives its labels from the catalog and asserts the timestamp read tool is offered. The always-running catalog regression passes; the PG portion is unrun locally. The conflict note preserves the distinction between capture time and publication time.

Further review found the journey still starts at /prodconsole/configuration while the catalog starts at /prodconsole. Implementing and testing genuine model-directed navigation from the seeded landing page is the next4.10 action; this checkpoint does not claim that complete seeded journey. Parentbc7aab652d600de77afc5dfce41715c5cee14ebf is pushed; this narrow catalog checkpoint is pushed. The concurrent LoanCore authentication catalog field is deliberately excluded until its full auth migration checkpoint.


## Generation38 read-grant expansion checkpoint (incomplete inspector)

Review37 `8403cfe59351226ad399cb30cd198632b9cc573f` passes hosted PostgreSQL442 tests, fresh/populated migrations through37, drift, all15 guard mutations, type/unit/boundaries and container jobs in CI34153829134; browser job pending at this entry. Generation38 adds only the bounded16-column capability metadata table and its binding/transition guards, generated from37. No inspector runtime is claimed in this expansion commit. Twenty-nine focused schema tests pass; current broader inspector worktree62 focused tests pass. Generation38 and39 snapshot lineage was generated sequentially and a repeat generation reported no schema changes. Hosted populated/fresh/drift proof through38 follows this push. Next: checkpoint auth39, then finish real inspector worker/route/PG/browser verification. No merge/deployment.


## Exact authentication destination checkpoint

Generation38 expansion pushed as `0c8e3030791483f73321205032764e00ce7376d3`. This checkpoint adds the optional frozen authentication destination across registration validation/digest, admin UI, persistence and actual browser caller. The credential guard authorizes only the configured effective form action; a same-origin business-write action and a missing endpoint fail before credential entry/page I/O. Positive target-specific authenticated-account confirmation remains mandatory. Historical six-key digests remain unchanged when the endpoint is absent; historical frozen versions are not silently enriched and fail closed for credentialed execution. The synthetic LoanCore catalog supplies its existing real form endpoint for newly registered versions.

179 focused domain/application/browser/UI tests pass in the current worktree; they include public-P4 changes scheduled separately. The auth-only stage retains exact endpoint propagation and refusal regressions. Generation39 was generated from38, preserves38's table and marker, and repeat schema generation reports no changes. Real form/browser and fresh/populated upgrade tests are committed for candidate CI. No live remote acceptance or release claimed. Next: push auth checkpoint, finish inspector/P4/runtime abuse checks and verify the exact final candidate.


## Seeded public P4 navigation checkpoint

Authentication39 pushed `bd4a34351a8c700274f7b85610dd076d41fcd360`. P4 now starts at the catalog landing origin, makes a genuine model turn selecting an approved captured link, navigates through the common browser/action gate, then selects actual captured parameter cells for the existing Observation writer/evaluation/Gate/Result path. Empty credential manifests are supported only for this validated frozen public contract; EvidenceStore and fingerprint capabilities remain required. Missing/ambiguous/external/forged navigation fails closed. No fixture-aware deeper URL is inserted by the runtime.

Application P4/sign-in/work-item tests88 pass; startup27 pass after updating the wiring assertion to the scoped execution capability and asserting the nonpublic refusal guard. Story4.10 D2-b/D5 detached-worktree mutations each prove baseline1pass/mutant1failure using existing compiler assertions; the reproducible runner joins the hosted mutation step and report artifact. Full actual PostgreSQL landing-page journey and final browser gates remain candidate CI requirements. No live provider acceptance or merge. Next: finish inspector runtime and hydrated/actual-worker abuse suite, then exact-candidate verification.


## Hydrated and production-worker abuse checkpoint (execution pending)

P4 navigation pushed `5c6623da929d514f7d7d47716fe26fc5e04a656a`. Five actual hydrated golden-question cases assert no preselection and persist only the explicit confirmed closed answer; three synthetic widening-instruction cases boot the production worker with real synthetic form login and object-store fixture, intercepting only the model HTTP response to deliver hostile proposals. The worker must persist denials/waits and no invented Observation or Pass. Test-only preload is never imported by production code.

Script syntax passes. Playwright listing initially refused missing E2E_PASSWORD; with a listing-only synthetic value it discovers eight cases plus three authentication setup cases. This is discovery, not browser execution. Root test TypeScript had passed before these frozen files were staged. Three mutation scenarios require per-case actual assertion failures (hydrated preselection, wrong persisted selection, missing worker security audit). A dedicated normal CI job owns disposable PostgreSQL18 and its own Chromium install and retains the exact report. No transport workflow or branch-writing permission is added. Candidate execution/mutation acceptance remains pending hosted CI. Next: finish inspector runtime, gather exact candidate CI evidence, and fix any concrete failures before acceptance.


## Mutation baseline diagnostic repair

CI34154713417 at `9d7edb30a62946cd316844d292ae170f38811f34` passes type/unit/boundaries but the new mutation job fails before mutation: hydrated-no-preselected-answer baseline. The runner previously discarded its Playwright report before emitting the underlying failure. This repair persists bounded baseline/mutant diagnostics before validation; setup/report failures remain disqualifying and assertions are unchanged. Script syntax passes. Full baseline diagnosis is pending the next CI evidence. Final4.11 matrix review also identified additional real-worker retrieved-attack/resume/terminal-cleanup proof still being implemented; no story acceptance claimed.


## 2026-09-08 continuation — hydrated baseline correction

Remote freshness rechecked at87199d788e04282151c49c218e84823c0d4ca5d4; local scratch resumed at5c6623d and was restored through the two already-pushed exact commits without overwriting inspector WIP. CI34155023877 passes static/unit/boundaries, PostgreSQL through39 plus mutations, and container jobs. Browser8 failures are five closed-option assertions omitting platform Abort and three worker abuse cases without expected security events. This checkpoint corrects only the former to the established Retry/Skip/Abort contract; durable-answer immutability and selection assertions remain intact. Nine wait-command tests pass. Worker/model fixture diagnosis and remaining inspector/abuse work continue.

The owner supplied Solari credentials on2026-09-08; credentials remain outside Git. Local outbound provider connection was unavailable (network approval cancelled), so live acceptance needs an authorized execution path as well as remaining model/storage/target configuration. No live acceptance or merge is claimed.


## Worker abuse prerequisite diagnostics

Hydrated option correction pushed4aa474db196d5330e7f1d5bdf7304733b2951ed8. This checkpoint adds bounded durable stage diagnostics to the three failing actual-worker abuse cases. It leaves the security-event, WAITING, authenticated session, immutable version and no-Pass assertions unchanged. Script/gateway inspection found the synthetic SDK interception itself accepts the provider envelope; hosted stage evidence is needed to identify the preceding failure. Candidate acceptance remains pending.


## Authorized persisted-evidence inspector checkpoint

Parent834519ce6b99791bd9cfc62c86f86b1e56e27998 passes hosted static/unit/boundaries, PostgreSQL migrations/integration and container jobs in34187717446; browser mutation baseline still fails and browser suite remains pending. This checkpoint wires the authenticated inspector through durable grants, production worker AWS signing, bounded server-side HTTP consumption and SHA-256 checks. Roles are rechecked after fetch; expiry/revocation clear capabilities. Active tampering fails the Run; sealed tampering records the existing integrity finding without altering sealed evidence or outcomes. Human-selected matches retain their truthful provenance label.

Local verification:33 focused inspector tests,57 web tests, complete workspace typecheck, dependency boundaries509modules and all builds pass. Nine PostgreSQL tests and three browser journeys are pending hosted execution. This is a pushed implementation checkpoint, not Story4.4 acceptance. The S3 SDK is confined to the worker-only signer subpath. Next: repair the actual-worker/browser mutation baselines, execute this inspector's real hosted flows, finish the negative-test matrix, then run the separate live Solari gate. No merge or deployment.


## Actual-worker negative-test population repair

Inspector checkpoint ca08dfd95e710d6f38d90d7ed67327cb50ebb9fc is pushed. CI34187717446 at834519 proves both hydrated answer mutations killed (five baseline passes and five mutant assertion failures each). Its worker diagnostics establish POPULATION_READY and SIGNED_IN, followed by unsupported-frozen-plan with zero model turns: the complete source contains duplicate E-000107. The negative fixture now freezes an explicit inclusion predicate selecting unique E-000101 while preserving all27 original source rows and the production duplicate guard. The new regression proves one included unique subject and the retained duplicate source. Two fixture helper tests and root-test typechecking pass; actual worker hosted execution remains pending. This checkpoint is pushed, not accepted. Next: execute worker denial baselines, add retrieved-content/resume/cleanup matrix, and verify inspector and live-provider gates.


## Retrieved-content, resume and terminal-cleanup negative checkpoint

Unique-population fixture repair e5e46a9257ad072d40616639c3da4e9eb6c0c90b is pushed. Six new browser cases inject the five golden hostile strings and a combined scope/objective/rule/secret attack into actual authenticated Northstar HTML through a test-only read-through proxy. The production worker captures the content and receives intercepted hostile model output. Tests require an inert durable question, explicit closed Retry answer without forwarding its note, a persisted denied tool, unchanged frozen definitions, ordinary-write trigger refusal, no credentials/Pass, and actual worker-driven browser cleanup after UI Abort. A passive observer does not release on the worker's behalf.

The detached mutation harness adds actual retrieved denial, terminal browser closure and applied frozen-definition guards, with disposal-only SQL mutation and unconditional restoration. Its job budget accommodates the real cleanup interval. Root-test TypeScript passes and Playwright discovers156 total normal cases; discovery is not execution. Both fixture helper tests pass. The separately selected live provider case is excluded from normal CI to prevent accidental provider use or skipped acceptance claims. This checkpoint is pushed but Story4.11 remains incomplete until all actual baselines and per-case guard mutations pass. Next: collect hosted results, correct the separately identified source-duplicate Gate classification, and run the dedicated remote acceptance gate.


## Source identity Gate classification repair

Retrieved-abuse checkpoint6c9b7174d375b8445ff15bf8cdc7f81ec68dff44 is pushed. Review against addendumH found a production defect behind the earlier fixture problem: missing or duplicate included source identities incorrectly terminated RUN_FAILED before the shared Gate. Two regressions reproduced the absent Gate call. The narrow repair preserves all source rows and calls the existing run-level Gate, which records mandatory/duplicate findings and seals INCONCLUSIVE without a model turn, invented Observation, first-duplicate selection or human escalation.

After repair25 loop tests and49 combined loop/Gate/Result tests pass; application and root-test typechecking pass. Two new PostgreSQL journeys assert exact Gate diagnostics, unchanged source rows/artifact keys/digests, no Observations/waits and idempotent sealed Result on redelivery. They await hosted execution. This repair checkpoint is pushed; acceptance remains pending the exact candidate's integration/browser gates. Next: checkpoint the executable Solari gate and complete final verification.


## Executable live Solari gate checkpoint (remote execution blocked)

Source-identity Gate repair bff6fe19e96e7548239edf4f0d24db04f7152604 is pushed. This checkpoint supplies the dedicated live Playwright configuration and read-only GitHub Actions workflow. Explicit PR label solari-live-acceptance selects the exact same-repository head; the job starts disposable PostgreSQL, builds/migrates the candidate, and runs the actual worker/model/Solari adapter against the existing approved public Northstar. No target infrastructure or provider recording is enabled. The real worker acquires the full source and freezes one employee, captures actual structural/PNG evidence, preserves pending C2 human review and must acknowledge remote cleanup before expiry. Only secret-scanned JSON IDs/digests/configuration evidence are retained.

Root-test typechecking passes; dedicated discovery lists exactly1case; normal discovery excludes it. Eight configuration refusal checks passed without network/DB I/O; workflow YAML parses with contents:read and a20minute job bound. Live execution has NOT run. The supplied Solari key remains outside Git, but local provider network access was unavailable and this GitHub connector cannot set or inspect encrypted Actions secrets/variables. To execute, the runner needs Actions secret SOLARI_API_KEY, one real model provider secret, and its exact model-ID variable (see the committed runbook). These settings remain unverified; no substitute local result or skipped gate is accepted. This checkpoint is pushed. Next: finish exact-candidate hosted verification and execute this concrete gate once its runner credentials are configured. No merge/deployment.


## Inspector PostgreSQL setup repair

Candidate610436c691e1fce79e1937d6e134d25fb7cd0433 passes local3491unit tests/164files, complete typechecking,509module boundaries and workspace builds; hosted static/unit job also passes. CI34188703157 PostgreSQL executes449tests successfully, but all9new inspector cases fail before execution because queue provisioning issues rawBEGIN on the eight-connection race-test pool (postgres-js UNSAFE_TRANSACTION). The fixture now provisions queues with a separate single-connection client, as release migration does, and retains eight connections for the actual concurrency assertions. No product protection or test assertion changes. The nine cases remain unaccepted pending the next hosted run. Additional final review identified Story4.5 absence-proof persistence/surface and canonical negative journeys plus two4.7 durability cases being completed. No merge/deployment.


## Wait restart and singleton enqueue checkpoint

Parent01bf266bad556018a90c755ed4b3fb5485fdb540 passes hosted458PostgreSQL tests/36files, including all9inspector cases, fresh/populated migrations, drift, all17selected unit/browser/P4mutations, static/unit/boundaries and container builds inCI34189147917. Main browser/mutation jobs remain pending. Two additional Story4.7 durability cases now hold a real uncommitted singleton enqueue while a competing producer blocks, and recreate the wait repository to recover an overdue open wait with unchanged closure metadata. The concurrent test observes actual PostgreSQL blocking instead of relying on a sleep or a lock on an already-committed row. Focused wait-file typechecking passes; actual PG execution is pending.

An internal agent produced unpublished local commit e59b6550010d5c1ac0710c400a45c6b2ec91d246 prematurely. Its exact commit is retained on local checkpoint/agent-waits-e59b655; this reviewed checkpoint includes all its changes plus the corrected uncommitted-enqueue setup. Remote history advances normally from01bf266 with no force push, and concurrent uncommitted feature work is preserved. This checkpoint is pushed; no story acceptance or merge is claimed. Next: complete persisted absence metadata/canonical negative journeys and verify the final schema candidate.


## Actual search provenance and incomplete-search repair

Wait durability checkpoint533285adaabae2934b11b55b1de1dc4f46c27620 is pushed. Two regressions reproduce copying the expected employee key into the proof despite a differing performed query, and continuing model execution after an explicitly incomplete captured result. Proof keys now come from the saved sanitized action parameters, with control labels establishing their declared identity; the planner's independent scope guard remains intact. Captured incomplete searches stop deterministically as UNINSPECTED and feed the shared Gate. An empty partial page retains an unproven absence; a nonempty partial page never fabricates an absent Observation. Neither asks a human to guess completeness.

Both regressions fail before repair;55 focused loop/planner/Observation tests pass after repair, including zero/nonzero partial-result cases. Actual canonical D12/D14 browser/PostgreSQL journeys are supplied in the next absence checkpoint and remain pending hosted execution. This repair is pushed; no acceptance or merge claimed.


## Canonical Northstar empty-result declaration repair

Search-fact repairbd271cbf5d4b2903865d14d69f5ba49b277566d5 is pushed and current root/application typechecks pass. Real-page D12 testing found canonical LoanCore zero-result pages omitted the declared result summary, while the simplified integration fixture supplied it. A failing Northstar regression now requires the truthful zero-of-zero summary alongside the existing no-accounts text. The target renderer emits it only when its actual matched row count is zero; the browser's completion predicate is unchanged. All34Northstar server tests pass after repair. This checkpoint is pushed; canonical browser/PG and live deployed-target verification remain required.


## Persisted absence proof and auditor surface checkpoint

Canonical Northstar summary repair2e9a36ac907a3235682f03991cfab988fcafea6b is pushed. Generation40 adds an immutable, Observation-bound absence provenance row with actual searched keys, declared expected keys, empty-result Evidence and completeness. The separate canonical metadata digest is bound into the registration audit event; the existing thirteen-key Observation wire digest remains unchanged. Historical rows are not backfilled. Shared transactional registration writes the metadata and refuses changed proof on redelivery.

The Observation card renders every proof leg as inert data, explicitly distinguishes incomplete and historical missing proof, and opens the captured empty-result document through the existing authenticated route/durable worker/S3 grant path. It does not invent a matching-row locator. Exact persisted proof/Evidence binding controls this whole-document mode. Five PostgreSQL cases cover persistence, immutability, replay and historical/sealed behavior; the browser suite now includes actual absent-proof inspection, forged Evidence refusal and accessibility.

UI and persistence regressions both demonstrated red then green.102 focused tests and all affected typechecks pass; generation40 derives from39 and repeat generation reports no drift. The5PG cases and4browser cases are unrun locally; hosted execution is required. This checkpoint is pushed but4.5 acceptance remains pending canonical D12/D14 journeys and exact-candidate CI. No merge/deployment.


## Canonical absence negative journeys checkpoint

Persisted absence feature1fdb1ea1ecc1d455d94cd5f40a5a1bcc447f71c5 is pushed. Three PostgreSQL/local-Chromium tests now read P-1 D12/D14 expectations from disk and use the real Northstar handler and form authentication. D14 exercises the model-tool-selected worker loop against the real partial result, requiring UNINSPECTED/INCONCLUSIVE without a human wait. D12 separately proves that the stricter runtime scope guard refuses the exact mistyped key before browser I/O, then deliberately fault-injects a downstream mistyped search through the real browser, saved Tool Action, capture, shared registration and Gate to require query-key-mismatch/UNINSPECTED/INCONCLUSIVE. This fault-injection test is labelled explicitly; it does not weaken runtime authorization or claim autonomous live-model evidence.

Root-test typechecking and test discovery pass. The three real PG/browser cases are unrun locally and must pass hosted CI through generation40. Sprint status now reflects work in progress for4.4–4.11 instead of stale ready-for-dev labels; none is marked accepted before its gates. This checkpoint is pushed. Next: run full exact-candidate verification, repair any observed failures, update PR24/release evidence, and execute the blocked live Solari gate when runner credentials and the approved target are ready.


## Retrieved abuse retry contract and snapshot comparison

Generation40 candidate6d1463f720eccae2b06ccbfcd66bc2b7c2fce5b6 passes all3499local unit tests/164files and hosted static/type/boundary checks. HostedCI34190426682 finds a real new SQL trigger defect (unqualified found conflicts with PL/pgSQL FOUND), so integration acceptance remains red; a forward compatibility migration is underway. Its8wait durability tests and7migration tests pass.

The retrieved-worker browser fixture now compares decoded values from this Run's registered structural snapshots, preserving exact hostile text despite JSON quote escaping. After the explicit authorized Retry exhausts its one additional cycle, Story4.7 requires FAILED/INCONCLUSIVE rather than another human wait. The corrected test requires two cycles, bounded attempts, no open wait, sealed Inconclusive Result and actual production worker cleanup. All6cases and the3guard mutations remain selected. Root-test TypeScript and11focused fixture tests pass; actual hosted browser/mutation execution remains pending. No product guard or runtime behavior is changed by this checkpoint. It is pushed; no acceptance, merge or deployment claimed.


## Forward absence-trigger compatibility repair

Retrieved fixture4397e844cb46836716edb4f00954aa229fce55bd is pushed. Generation40 integration failures reproduced SQLSTATE42702 on actual shared registration because PL/pgSQL FOUND conflicts with the unqualified Observation column. Generation41 only replaces the trigger function with qualified relation columns. It retains Run locking, exact absent Observation ownership, immutable updates, parent-bound deletion and refusal after package sealing. Published40 remains byte-for-byte unchanged; no existing proof/evidence/Observation/result is rewritten.

A real populated40-to-final regression now executes the preceding migrator, inserts historical absent Observations and a sealed Run, reproduces42702, upgrades, checks original facts/artifact bytes unchanged and historical proof still missing, verifies new proof registration plus ordinary mutation/sealed-insertion refusal, and repeats migration safely. Local root-test typechecking,42schema/range/compat tests and schema generation/drift pass. PostgreSQL regression is committed but unrun locally; hosted execution must establish green. This checkpoint is pushed and remains unaccepted until final gates pass. Next: repair canonical landing navigation and collect final-schema integration/browser results.


## Serial mutation-runner budget correction

Forward migration8f1ecc5d11c4375da84f845594213d4172f265cd is pushed. Static review of the now-reachable six-case mutation path finds its fixed10minute subprocess deadline could kill the process before six serial120second denial assertions finish. The harness now permits each selected case's existing240second budget plus120seconds setup, under the unchanged60minute CI job ceiling. This changes no assertion, product execution limit or mutation success rule: every selected case still must fail an assertion after its guard is removed. JavaScript syntax check passes; hosted complete per-case mutation evidence remains pending. This separate test-infrastructure checkpoint is pushed.


## Cross-Run remote release repair

Mutation-runner checkpointe49276dac7bf4f75b8ce0aba58ba2240e4704931 is pushed. Final isolation review found release could send a Solari release request for a known session despite a different Run reference; a forged local mode could also falsely report success without teardown. Two regressions fail before repair (34pass/2fail). The adapter now checks the complete known live identity before any teardown or provider I/O. Unknown-live persisted cleanup after restart remains supported.

All36browser-adapter unit tests pass after repair, including correct/repeated release, restart, provider failure retry and confirmed absence; infrastructure typechecking passes. No live request occurred. This repair and regression checkpoint is pushed; actual remote isolation and final hosted checks remain required. The current-checkpoint summary above is refreshed to distinguish supplied credentials from unavailable encrypted runner configuration.


## Live acceptance reporting containment

Remote release repair6f18f64efcaf8ea41d1ccdc58289d8ff426c909d is pushed. The selected live audit gate now scans the synthetic application's derived session token as well as raw/provider credentials without printing operands. A forced or unconfirmed worker shutdown cannot leave the gate or artifact accepted. The runbook explicitly distinguishes byte scanning from visual credential absence, which is covered by credential-entry capture suppression tests. Root-test typechecking and diff checks pass. Live execution remains blocked by runner configuration; this checkpoint adds no remote acceptance claim or network activity and is pushed separately from the product repair.


## Held decision concurrency proof

Live reporting checkpoint ed330ff4599b64ecdfd43c3ffad98c8ec3f7b30c is pushed. Exact-spec review found existing tests demonstrated a row lock or concurrent starts rather than held competing decisions. The wait test now holds the actual answer/cancellation/seal transaction uncommitted, starts both a real timeout and a second answer, observes both blocked in PostgreSQL and invisible uncommitted closure, then requires one CANCELED Result, superseded wake and closed-answer refusal. The evaluation test holds the actual first confirmation transaction while the second blocks, verifies no visible decision before commit, then retains the existing stale-revision, final sealing, immutable proposal/package and replay assertions.

These tests change no runtime behavior. Root-test typechecking passes. Real PostgreSQL execution remains hosted-only and pending; this checkpoint is pushed without an acceptance claim.


## Canonical LoanCore landing navigation repair

Held decision checkpointfa8dc31e4ee28e5a5e3e485b2077067f36d98bb9 is pushed. Canonical D12/D14 execution exposed a genuine landing-page gap: LoanCore published only fixture-valued example queries, while the bounded planner correctly refused those links. LoanCore now exposes the generic search page and the model may select a captured query-free, in-origin navigation tool. A page carrying either declared identity datum is not a generic landing page; unrelated employee record links remain refused. The runtime never constructs a fixture route or borrows its employee values.

Restoring the two old production files produces120passes/3newregression failures; repaired Northstar/planner/worker-loop suites pass123tests. Application, Northstar and root-test typechecks pass. Canonical PostgreSQL/Chromium journeys await hosted verification. This repair checkpoint is pushed without claiming local fixtures are autonomous live-model acceptance.


## Exact escalation/review guard mutations

Canonical navigation781e20911d14ed2ba914855bb7921146557edde9 is pushed. A new isolated-worktree harness fills three explicit story checks: actual planner single-grounded-match resolution, production PostgreSQL closed-wait refusal, and inclusive Agent-Judged confidence threshold. The first case deliberately targets the planner used by the worker rather than an unused helper. The PostgreSQL mutant preserves independent state/revision/SQL guards and must fail the precise duplicate-answer assertion.

At exact781e209, each of the two unit baselines passes1test and its mutation fails that named assertion; the harness restores sources and records hashes/errors. The real PostgreSQL case is not locally run. CI now invokes all3after the existing17mutations and retains its JSON alongside them. Missing DB, missing tests, skipped tests, setup/import errors and non-assertion failures cannot count as kills. JavaScript syntax and diff checks pass; this checkpoint is pushed with full hosted mutation acceptance pending.


## Executable concurrent Solari isolation gate

Exact guard-mutation checkpoint6f4e1f54463eed2e5f452e9b97e998fcdcf2cf59 is pushed. The separately selected live workflow now contains two cases: actual-worker/model audit first, then exactly two overlapping managed Solari sessions through the actual Run initiation, workspace provisioning, population acquisition, authentication, cancellation and release application stages. The second case proves fresh B authentication/storage/cache state while A is authenticated, holds an A operation while B reads, refuses forged Run references and out-of-scope browser requests, and requires A closed/unusable while B remains usable before confirming B cleanup. Non-secret browser sentinels do not modify audited records or install authentication.

Reports retain persisted provider/Run IDs, configuration, denial events and pre-expiry cleanup without credentials. Interception inside a remote browser is explicitly distinguished from an independently configured provider firewall, and distinct managed browser sessions do not prove worker-process memory isolation. No live mutation kills are claimed. The workflow stops after first failure, so a failed audit/cleanup never silently allocates the pair. Normal browser discovery excludes both live specs; the dedicated config discovers exactly2cases. Root-test typechecking and diff checks pass. Neither live case has run; encrypted runner/model configuration and target compatibility remain critical blockers. This checkpoint is pushed and never substitutes for remote acceptance.


## Live worker exit regression

Paired isolation gateb16b1cf13e4b039e090c02a7f06fa26fb80e0149 is pushed. The live worker helper still treated an already-closed nonzero exit as successful shutdown, or ignored one occurring during shutdown. Two persistent regressions reproduce those paths while two clean-exit controls pass. Both paths now refuse with fixed secret-free errors; all4cases pass and root-test typechecking passes. The tests simulate child process events only, with no real worker/provider/network. Dedicated discovery remains exactly2livecases. This separate test-gate repair is pushed; live execution is still unaccepted.


## Actual worker notification and timeout browser journeys

Live exit regressionefbec9d5a6c3721ddbc0b8103b12c769c718a824 is pushed and the full local suite passes3514tests/165files on its code. The escalation browser suite now boots the built worker for real in-app notification delivery to the initiating Auditor and every Audit Manager, verifies recipient inbox/deep links and accessibility, and records email honestly as unconfigured. It preserves the existing option/answer containment assertions.

The timeout journey now restarts the worker to consume the already-persisted wake, requires timeout closure, INCONCLUSIVE Result and sealed package, preserves original artifact bytes/digest/metadata, and checks idempotent notification delivery after restart. It retains the late-answer refusal before the wake runs. No test directly closes the wait or fabricates the terminal Result. These duties are intentionally exercised with acquisition/model/provider unconfigured; this does not claim a new agent-model journey. Worker shutdown has a30second bound and fails on abnormal/forced exit. TypeScript passed before the narrow shutdown addition; final typecheck is running. Hosted PostgreSQL/browser/accessibility execution remains pending; the three scenarios are discovered but not accepted locally. This checkpoint is pushed.


## Canonical search versus stronger pre-I/O denial

Worker timeout checkpointd7bd9b4d023d7aa17ab5071483a785a51f232d6b is pushed. Current local typechecking, workspace builds and509dependency boundaries pass, following3514unit tests. Hosted PostgreSQL on efbec9d5a6c3721ddbc0b8103b12c769c718a824 now passes canonicalD14 and the actual downstreamD12mistyped search/registration/Gate case; only the separate stronger-prevention expectation remains wrong.

Material contract distinction: canonicalD12 describes an executed mistyped search, whose proof must remain UNINSPECTED/INCONCLUSIVE. The additional prevention case instead submits model-authored parameters before browser I/O; the established action-denied stop contract in domain/runs/limits.ts requires terminal RUN_FAILED and a security event. The test now requires that precise cause/diagnostic/state, no performed search and no Observation. The canonical downstream expectation and fixture remain unchanged. This is a test-contract correction, not a relaxation or runtime repair. Root-test TypeScript passes; exact hosted final execution remains required. This checkpoint is pushed.


## Actual P-1 worker through human evaluation review

Candidate eeca93c5cf1c547942945235e40260fd36ea9ce8 passes470realPG tests/39files, final41 upgrades/drift and20selected guard mutations, plus hosted static and image jobs. Its browser job has154passes/3failures under repair; no acceptance is implied.

Two new browser journeys initiate a real frozen P-1 Run from Procedure Detail, boot the compiled worker, use canonical Northstar form authentication and actual search/capture/Observation/evaluation persistence, then confirm or reject the pending machine proposal through Run Detail. Final worker commands must produce the shared sealed PASS or CONTROL_FAILURE Result while retaining original machine evaluations, Observations and Evidence. Rejection requires the worker-signed Exception; both views run the accessibility gate. The explicitly named test-only HTTP provider fixture selects opaque approved actions and proposes C2, without manufacturing audit rows or bypassing credentials. It is synthetic model testing, not live autonomous acceptance.

Root-test TypeScript, preload JavaScript syntax and discovery of both cases pass. No local PostgreSQL/browser execution occurred. The checkpoint is pushed for hosted verification; product behavior and acceptance criteria are unchanged. Worker shutdown is bounded and diagnostics are fixed, without raw provider logs.


## Existing grounding surface regression correction

Actual human-review journey checkpoint99864d73aff429f985ceb0da62d3ebb77f01c741 is pushed. Hosted eeca93c browser failure showed the older Run surface test still clicked a removed disclosure. The current inspector deliberately displays match provenance and grounded attributes directly. The regression now requires those headings, exact protected identity/roles snapshot links, original/normalized values, locators, corroboration and accessibility. Its seeded metadata has no S3 object, so the case is accurately named; separate evidence-inspector cases exercise real worker-backed reads. No production behavior or assertion gate is relaxed. Root-test TypeScript and diff checks pass; hosted rerun remains required. This checkpoint is pushed.


## Reviewable per-case hosted mutation evidence

Grounding correctionbfa30319f9f966be34c7dea0a454463b8e9802d5 is pushed. GitHub returned artifact10042933102 for eeca93c's20successful mutation checks, but local materialization of the returned download URL is refused with HTTP403. The artifact link remains available in GitHub. Future CI now mirrors the existing sanitized synthetic mutation JSON into job logs, including exact source/test hashes, removed guards and actual per-test assertion failures. The reporter parses data only; it cannot execute content, write the branch or modify audit state. Missing files are labelled missing rather than accepted; the existing runner still owns all pass/fail decisions. JavaScript syntax and a read of the existing committed local report verify reporting. This separate CI checkpoint is pushed; no additional mutation success is claimed.


## Authorized notification bell count repair

Mutation reportingb55e5beb5d4e1f3c29dcadd84ff99898fe7a6ab5 is pushed. Hosted eeca93c exposed a product defect: real notifications reached recipients and inboxes, but RootLayout never supplied the bell count. Two focused regressions fail before repair; all4layout cases and7telemetry cases pass afterward. The shell now reads the exact authorized open-wait count using the same fresh-role/initiator/manager predicate as the inbox, without its100row display limit. Anonymous/degraded identities query nothing; query failure leaves the count unknown and emits only a fixed diagnostic, never the database exception or parameters.

Real-PG regression now checks count/inbox parity, Auditor revocation, Manager visibility and restored authorization. The existing browser test retains its unread-bell assertion and verifies exact count against its visible fixture waits. The timeout test establishes its own delivered-row baseline before restart, removing dependence on another test having passed, and checks count after durable timeout closure. Web/root-test TypeScript, focused unit tests and3scenario discovery pass; hosted PG/browser/full regression acceptance remains required. This repair and its regressions are pushed in one coherent checkpoint. Next: let all exact-candidate jobs finish and evaluate the explicitly selected live gate; no merge/deployment.


## Hosted final-review evidence and exact label correction

Notification repairb165de77b1391fc9674b38a96b5e3c01ddb6862b is pushed. CI34194630181 tests synthetic merge23cfc6683b8fd55631fd4e4169dad9eb6e15c947, whose treebf8fac782ecb99db2fec7394b9bbcd7938c01ef6 exactly matches that PR head. Its static checks, images,470PG tests/39files, migrations/drift and20selected mutations pass; the corrected3escalation browser scenarios pass. The complete browser job has155passes/3failures/1unrun: whole-source P1 cannot become pending, a teardown-status read races its commit, and Field label's substring locator also matches untrusted provenance labels. Those are being repaired; no acceptance claimed.

This checkpoint selects the exact two Field label headings rather than all substrings; every existing value/corroboration/link/accessibility assertion remains. The actual current UI has additional provenance labels deliberately containing that phrase. Root-test TypeScript passes. This narrow regression correction is pushed separately.

Selected live gate34194649240 at exactb165de7 fails before provider allocation: SOLARI_API_KEY is empty, and both model-key/model-ID pairs are also empty in Actions. The connector cannot set encrypted Actions secrets. No Solari session or acceptance artifact was created; the second isolation case did not run. Owner settings are required, and this critical blocker prevents merge.


## Confirm durable cleanup after observed browser closure

The preceding exact-label checkpoint is pushed. Hosted b165de7's D9-b browser test observed closed pages and refused cookie access before releaseWorkspace had committed its database row, then immediately read OPEN. Browser teardown and durable cleanup are separate asynchronous facts. The regression now requires both under their existing90second bounds; persistent OPEN/failed references still fail, and the test never releases anything itself. All6golden cases and teardown mutation remain selected. Root-test TypeScript passes; hosted rerun is required. This test-only synchronization checkpoint is pushed separately from production fixes.


## Declared isolated-case source and actual captured inspector

Durable cleanup assertion0199a41470309e0c5055675ede6e66548d42c0a5 is pushed. Hosted b165de7 correctly returned sealed INCONCLUSIVE for the full golden P1 source, contradicting the new review test's pending expectation. Source-wide invalid dates/duplicate keys remain quality failures despite a unique employee inclusion filter. Those protections and the canonical source are unchanged.

The review journey now acquires a separately declared real HTTP CSV containing the unchanged canonical E-000102 row. An independent Python generator derives its actual one-row count, byte digest and synthetic signed cover while retaining canonical values/period/provenance. Three helper regressions exercise actual HTTP acquisition/reconciliation for canonical D1-a/D1-b and refuse ambiguous duplicate E-000107 selection. No runtime model or audit row is fabricated. The whole golden source still cannot become Pass.

The first actual worker review journey also follows its captured account-status grounding link through the durable worker evidence grant, verifies the stored locator returns Disabled, runs accessibility and confirms no signed storage URL reaches the browser. TypeScript, helper3tests and discovery pass. Actual browser/worker execution remains hosted-only and pending. This checkpoint is pushed without acceptance.


## Canonical absence through the compiled worker

Isolated-source/inspector checkpoint07219363d51d997f4bb80096279a795ca43019d5 is pushed. The new D1-a browser journey reads its expected employee and per-case outcome from the canonical P1 file, initiates via the real UI, and drives the actual compiled worker/queue with a named synthetic provider selecting current opaque tools. It authenticates against canonical Northstar, searches every declared key, captures real empty results, persists immutable proof, passes the shared absence judge and seals through the existing Gate. The auditor follows the actual proof Evidence into the protected empty-result inspector; accessibility and credential-free artifacts are asserted.

The runtime never receives fixture expectations and no execution facts or outcomes are seeded. TypeScript, preload syntax and one-case discovery pass; actual local-Chromium/PG execution remains hosted-only and pending. This Story4.5 verification checkpoint is pushed without acceptance.


## Live gate source provenance correction

The canonical absence worker checkpoint is pushed. The selected live single-case audit now uses the same explicitly declared canonical E-000102 source acquired over real worker-local HTTP. Its independent count/digest/synthetic signed cover and source identity are recorded in the secret-free report. The browser remains a real remote Solari session against the approved public Northstar target; source acquisition and S3 transport remain worker-local test fixtures and are explicitly not deployed HR/storage acceptance. This preserves the required real model-directed target investigation without hiding unrelated full-source quality failures. No model/source response interception or fixture-aware runtime logic is added.

TypeScript and source-helper tests pass. The dedicated gate still discovers2cases and has not been rerun; its last selected attempt failed before allocation because Actions lacks Solari/model configuration. This narrow live-gate correction is pushed; recording stays disabled, and no remote acceptance, merge or deployment is claimed.


## Canonical ProdConsole through the compiled worker

The live source correction is pushed. Story4.10's previous PostgreSQL/local-browser journey invoked the actual application stages directly; its required complete worker boundary now has a new browser journey. It initiates the canonical P4 procedure from the UI, starts the compiled worker, uses its real queue, Northstar browser and S3 adapter, and supplies only bounded opaque tool choices through an explicitly synthetic HTTP provider. Expectations and source/page metadata are read from canonical files by the test, never the runtime.

The test asserts the exact five failing §H checks before reading the final golden INCONCLUSIVE Result; all distinct baseline keys receive one shared-engine Observation, including absent required parameter, ambiguous duplicate baseline and prohibited present parameter. Declared/registered count disagreement, snapshot identity/time, deterministic evaluation, actual snapshot/PNG bytes/digests and UI accessibility are retained. No canonical data or runtime behavior changes. TypeScript, preload syntax and one-case discovery pass; hosted execution remains required. This checkpoint is pushed without claiming live autonomy or completed Story4.10 acceptance.


## Required absence-key and token-accounting mutations

The compiled ProdConsole journey is pushed. Final exact-spec review adds two missing mutation gates: slice the actual worker absence producer to its first declared query key, and remove the measured usage increment from the durable agent model turn. Both run existing meaningful assertions over the production path, rather than unused helper logic. On clean detached b165de77b1391fc9674b38a96b5e3c01ddb6862b, all4unit-only harness baselines pass and each mutant fails its named assertion; the added cases preserve both-key coverage and25+18=43token accounting respectively. Source/test hashes and failures are retained in the local report, and hosted CI now automatically selects them alongside the existing3harness cases.

JavaScript syntax and diff checks pass; full real-PG harness execution remains pending. This test-infrastructure checkpoint is pushed separately from the Run-limit Gate production repair. No limit is changed or waived.


## Agent Run-limit Gate repair

Required absence/token mutation checkpointee7ad27c7dcd23a79f9fd614caeda001fdcf4ac3 is pushed. Exact-spec review reproduced a real Story4.6 defect: all three Run-level exhaustion paths sealed directly without required §H rows. Three final-boundary regressions observe zero Gate calls before repair, and three passing-quality Gate cases incorrectly remain COMPLETED when a limit is supplied. The previous skip-Gate assertions described defective behavior and are replaced by the explicit approved contract, not loosened to obtain green.

The existing shared Gate now accepts only a closed RunLimitCause as terminal context. It computes/stores the same20quality rows and events, preserves any independent RUN_FAILED verdict, and otherwise seals the exhausted Run INCONCLUSIVE even if quality checks pass. No false failed §H row is invented. Its return distinguishes actual terminal state from quality decision and redelivery preserves the recorded Result. Only the three agent limits, including a pending-wait-intent inherited deadline, use this path; security/cancellation contracts are unchanged.

All90focused loop/Gate/completion/adapter tests pass, including original snapshot/Observation final-boundary preservation, passing-quality exhaustion and replay. Application/root-test TypeScript and diff checks pass. Three actual PG agent cases now require the20Gate rows, inherited source-start deadline, exact limit cause, sealed INCONCLUSIVE Result/package, unchanged partial/captured bytes/digests and redelivery equality. They are discovered but unrun locally; hosted PostgreSQL acceptance is required. This repair and its regressions are pushed as one coherent checkpoint.

## Actual worker credential response containment checkpoint

Adds the Story4.11 negative in which an authenticated retrieved instruction reaches the real worker's SDK, then the synthetic provider returns the actual synthetic audit token in an otherwise valid proposal. The production scanner must record only FAILED/credential-containment with NULL response, never a Pass. Boolean-only assertions scan every public catalog-discovered Run/aggregate row, object bytes/keys, worker output and rendered UI, before and after real human Abort and confirmed terminal workspace closure. No table allowlist can hide a later Run-owned sink. The seventh worker/hydrated mutation removes that exact response scanner and must fail a meaningful assertion.

Root TypeScript, preload/harness syntax and discovery of the single case pass. No local PostgreSQL/Chromium execution or live-provider result is claimed. Hosted execution and mutation remain pending this checkpoint's push. Runtime parent2d1eec4 passes472 PostgreSQL tests/39files, all22 smaller mutations, fresh/sealed31/populated40 upgrades through41, drift, static checks and images on same-tree CI merge67a4b1d. Browser jobs are still pending. This entry is committed with the test and pushed through a checked, non-forced branch update.

## Canonical second-key navigation repair

Hosted browser job101966262966 at same-tree candidate2d1eec4 revealed a real4.5 gap: the canonical empty-results page has neither controls nor links. The model's tool set therefore had no way to perform the second declared search and reached a durable wait. The planner now offers an opaque navigation back to a previously captured, query-free search-control page only for the same Run/target, a complete zero result and a still-unsearched declared control. The model must choose it; fresh capture precedes the next search. No target route is invented and Northstar is unchanged.

Regression evidence: planner1red/14green before repair; removing executor control-page provenance makes both fresh/restart shared-registration regressions fail UNINSPECTED instead of COVERED. Restored planner/executor47tests pass; application/root TypeScript, absence discovery and preload syntax pass. Teardown now handles a real open wait, and the HTTP action assertion distinguishes canonical form parameter `name` from proof lookup key `full_name`. Full hosted browser acceptance is pending this pushed checkpoint. The separate P1 review journey still returns Inconclusive; its compiled-field mismatch is under repair. Latest5fd2ac0 hosted PostgreSQL472/39,22smallmutations,static and images pass; no final browser/live-provider acceptance.

## Actual compiled-field capture repair

The canonical P1 review journey exposed a4.4 producer defect hidden by hand-trimmed plan fixtures. `plan.observations` is the compiler-supported UNION (documented in deterministic-evaluation-v1), not every target's capture obligation. The agent builder incorrectly inserted ungrounded disabled_time and termination_time placeholders into default LoanCore Observations, forcing the shared Gate to fail and potentially shadowing source values. It now retains the Template's mapped target fields plus explicit Evidence Requirements; missing requested fields still remain ungrounded and fail the same check. No field is invented from fixture metadata.

The new regression derives the real complete plan and reads the canonical account row from disk. Against the defective producer it fails because two unused time fields were emitted; the required-but-uncaptured role control passes. Repaired producer, original Observation tests and transactional registration tests:65passed. Application/root TypeScript passes. Hosted final journey remains pending; no runtime acceptance claim. Capitalized canonical statuses versus lowercase template defaults is a separate recorded configuration conflict, not permission to case-fold captured evidence or broaden frozen rules.

## Explicit target status configuration and truthful captured values

Resolved the canonical status/document mismatch within existing auditor configuration authority: the positive local and live P1 procedures explicitly author and compile `found = false or account_status in [Disabled] else [Active]` before freezing. C2/threshold, default-template definitions, canonical pages and normalization/corroboration remain unchanged. The live report retains the exact expression. Five tests prove default `Disabled` remains an unnamed value, explicit Disabled/Active verdicts and continued lowercase/Suspended refusals. Original captured status and plain-text Roles stay exactly as rendered, rather than asserting an invented lowercase string or JSON list. Existing list-preservation tests remain.

The two compiled-field tests plus five configuration tests pass; root TypeScript passes. P1 failure diagnostics now retain only selected platform execution/Gate fields and synthetic provider markers, never raw worker stderr or model responses. Full browser journeys remain pending the pushed candidate. The prior5fd2ac0 browser job confirmed the new actual-worker credential-containment case passed; its absence and review failures are the repaired paths above. No complete worker mutation/live-provider acceptance yet. Local full suite at5fd2ac0 had3525passes/1environmental boundary failure caused by disappearing rsync temporary source; all26boundary tests passed on focused rerun, and hosted static checks passed.

## ProdConsole persisted-read verification correction

CI34199194303 at f4892c9 passes3537unit tests,472PostgreSQL tests,22smaller guard mutations, fresh/populated migrations and image checks. Its browser job101973919472 finishes161passed/1failed: P1 capture/review/absence and credential containment now pass. P4 already passes the complete golden Gate set, five distinct Observations, per-case evaluations and page declaration, then fails an incorrect test expecting read-attribute/read-metadata in the browser HTTP ledger. The production model selects local immutable-snapshot cells; it does not fabricate requests to reread stored evidence.

The corrected test retains every golden assertion and the actual navigation/GET/frozen-origin requirements. It binds the persisted read turn to the Work Item's registered snapshot and declaration, verifies real S3 bytes/digest, rebuilds the catalogue from the saved frozen plan/capture location, checks every selected opaque tool and independently resolves every locator. It requires all parameter/value cells plus the snapshot identifier, count and time, with declaration locators and canonical values checked. Terminal polling uses the actual RUN_FAILED vocabulary. Root TypeScript,18focused ProdConsole tests and Playwright discovery pass; hosted browser verification remains pending this checkpoint. No runtime code, fixture outcome or guard is changed.

The22case hosted JSON source/test hashes independently match current files. A scan of1468tracked/candidate files found zero supplied-key occurrences; all three temporary transport paths remain absent. The remaining worker mutation job is allowed to finish before push so no verification is discarded. No merge, deployment or live-provider acceptance is claimed.

## Worker mutation completion barriers

ProdConsole test correction is atomic commit881dc35338c4a5ae26dc3df9e71b852115a75d77, prepared while the remote branch remains at f4892c9 to preserve its long-running mutation job. This separate test checkpoint preserves all assertions and product budgets but awaits independent durable completion before asserting security denials: WAITING plus AWAITING_AUDITOR for scope instructions, or post-Retry INCONCLUSIVE for retrieved attacks. Those states follow the transaction recording the security event, so a missing event can fail immediately rather than consume120seconds per selected mutant.

Closure still has the full90second RELEASED budget; only delivery of the already-queued passive observer facts gets5seconds after that commit. The observer awaits actual release and queues its exact closed-page/cookie-refusal facts before returning to the release transaction. Scope/objective/rule mutation attempts all remain. No mutation-specific branch or production/harness change is introduced. Root TypeScript and discovery of3worker plus6retrieved cases pass; the new barriers and every mutant require hosted execution. The prepared commit chain will be pushed only after CI34199194303 returns its complete matrix.

## Complete hosted mutation matrix and prepared final verification candidate

CI34199194303 has completed. Headf4892c9 and mergeef9334e share the same complete tree5b5ff42. Static, PostgreSQL472/39 with all22smaller mutations, image checks and the seven-worker/hydrated mutation job101973919659 pass. The latter records32 baseline passes and32 corresponding removed-guard assertion failures across all seven guards. Browser161pass/1P4-ledger-assertion failure is corrected in881dc35338c4a5ae26dc3df9e71b852115a75d77; completion-barrier improvement9a6987fe165520d2bc71673e1e736457f66db2de retains all assertions and budgets. Both test-only commits require the next exact-candidate hosted run.

The engineering report and29guard per-case JSON/Markdown are committed with this documentation checkpoint. Story specifications now record actual in-progress verification, not stale “Not yet run” placeholders; acceptance criteria remain unchanged. This prepared chain is published via a checked non-forced branch update after the current run completes. No live Solari acceptance, merge or deployment is claimed. Actions secrets/model settings and production prerequisites remain blockers.

## Credential baseline failure after four verified mutation guards

CI34203072973 verifies all162browser/accessibility cases, including P4 and credential containment, but its separate mutation job fails BEFORE removing the credential guard: the Run reaches RUN_FAILED rather than its required durable wait. The first four guards kill all selected cases using the new completion barriers. The exact failed baseline is retained in epic-4-credential-baseline-failure.json; the prior full29guard success remains historical evidence, not a substitute.

This checkpoint adds closed-vocabulary Run/stage/turn/step/wait/event diagnostics and child-health/secret-absence booleans. Raw responses, arbitrary stored strings, provider output, logs and SQL errors are never printed. The same120second wait and every scanner remain. The matrix now runs three independent credential lifecycles and requires all three baseline passes and all three meaningful guard-removal failures. Installed Playwright1.62.1 separates repeatEachIndex in its worker hash; discovery confirms three cases plus setup. No assertion-failure retry is configured. Root TypeScript and harness syntax pass. The underlying runtime cause is not yet established.

## Green repeated baseline and deterministic recovery-race reproducer

Pushed82adb8338cfd3c6efb82b664ba4848729e8818ec passes all five jobs in CI34205126512. Its tested merge0ef533e2a22a400f7a960c7a152de72ac3ffe7de shares tree78be9099481a62825a00c22230597b1f2264246b with the head. The browser/accessibility job101992719834 passes162cases. Worker mutation job101992719607 passes all seven guards with34 baseline/removed-guard case pairs, including three independent credential lifecycles. Static, PostgreSQL/migrations/small mutations and container jobs also pass. This does not explain the earlier04f2a3e failure.

Source review establishes a concrete race: reattachment durably changes OPEN to PROVISIONING while a competing delivery can pass the old SIGNED_IN shortcut. The work repository hides the non-OPEN workspace but still reports prerequisites ready; a RETRY work claim then records workspace-missing/RUN_FAILED. Merely handling a busy provisioning result does not close the interval after an earlier caller successfully provisioned.

This explicitly incomplete TEST-ONLY checkpoint adds a real PostgreSQL/local-Chromium regression: reject one secret-bearing response through the real scanner, hold actual reattachment after PROVISIONING, attempt competing work through a fresh repository, require unchanged Run/checkpoint/evidence and no I/O, then release the hold and reach the bounded auditor wait with the original provider identity. Root TypeScript and diff checks pass; the required hosted red reproduction is pending before any runtime repair. The historical failure had no durable diagnostic snapshot, so attributing that exact run to this race remains an inference. No merge, deployment or live Solari acceptance is claimed.

## Proven recovery race; preserve the winning workspace on a lost attach lease

Test checkpoint e55c0013655826723c6a6947e38d39d8aedc216c reproduces the work-claim defect in CI34207151600, PostgreSQL job101999208348: the new held-attachment case expects RUNNING but receives RUN_FAILED;472other integration cases pass. This is a real PostgreSQL/local-Chromium failure, not a temporary-table or mocked-state assertion. The pending-work prerequisite repair is being prepared separately.

This atomic repair covers a second consequence of expired provisioning leases. A controlled-clock regression holds A's attach to an existing unexpired Solari identity, lets B obtain its own claim and commit OPEN, then resumes A. Before repair, A's lost-claim cleanup wrongly releases B's same workspace; the regression fails with a nonempty release list. The complementary new-handle case passes before and after: a losing creator releases only its uncommitted ws-1 while B retains ws-2. Runtime now tracks whether this claim actually created the returned handle and limits lost-claim cleanup accordingly. Existing identity, provider, expiry, winner checkpoint, events and execution history remain intact.

Root focused verification passes54tests across workspace provisioning and agent work; root test TypeScript passes. The real work-claim regression remains intentionally red until the next repair checkpoint. This commit is pushed as an incomplete release checkpoint, not an accepted Epic4 or live-provider result.

## Defer competing work and recover interrupted provisioning

The lost-attachment cleanup repair is pushed as d50e42473dba6d8f63cda7a4307940ccb6aeb71e. This next repair makes durable PROVISIONING/RETRY a pending work prerequisite, while keeping a genuinely absent workspace terminal. Both authentication and work recovery select failed provisioning and expired provisioning leases before executing their existing provision-first handler. Live provisioning leases remain excluded; bounded provider attempts and frozen Run deadlines remain unchanged.

The PostgreSQL regression that failed at e55c001 is retained and strengthened: after the competing work claim defers, recovery excludes the live lease, admits the simulated expired lease, reattaches the original identity through a winning claim, and survives the old claim returning late. Remaining secret-bearing proposals are refused through the real scanner and end in exactly one durable auditor wait. Additional cases cover a real attachment failure, retained identity, fresh-repository recovery, no work/model consumption while pending, and genuinely missing-workspace failure. A separate pre-extraction authentication repository test covers RETRY/expired EXECUTING against failed/expired/live workspace states using explicit crash/lease injection; it is not labeled another live browser journey.

Local verification of the repaired candidate: full unit suite3539tests/169files passes; full workspace/root TypeScript passes;54focused provisioning/work tests pass. Hosted PostgreSQL, final browser/mutation, migrations and build gates remain pending this push. The last fully green candidate remains82adb83; its passing repetitions did not waive the deterministic e55c001 failure. Supplied Solari key is available in chat but cannot be installed into Actions by this connector. Owner has been given the exact settings: SOLARI_API_KEY, OPENAI_API_KEY, SOLARI_ACCEPTANCE_MODEL_PROVIDER=openai and AGENT_OPENAI_MODEL=gpt-5.6-luna; saving them is not yet confirmed. Live acceptance, merge and deployment remain unverified.

## Post-answer accessibility completion barrier

Recovery candidate5944e6fbb47677c855de4531af00e7b2d40bd2cd is pushed; CI34208782831 tests merge33c968a413ee484e4bffb35dc7ee34b993f1a509 with the identical tree077c10bb10808368d52ea0292ec45ee869508474. Static and container jobs pass. Worker mutation job102004634210 stops in its first baseline: four hydrated cases pass, while P3 D9-a reaches the post-answer axe scan and reports document-title missing. No removed guard or later matrix case is accepted from that job.

The answer component sets its success banner before calling router.refresh. The test previously checked the banner and database closure, then scanned without waiting for the refreshed server page. This separate test correction adds positive assertions for disappearance of the open Escalation and the exact Run route title before the unchanged WCAG2.1AA axe scan. A stale UI or absent title still fails, and no rule, violation, outcome assertion or guard-removal requirement is weakened. Hosted verification remains required. The new recovery PostgreSQL evidence is retained separately from this browser timing correction.

At5944e6f, PostgreSQL job102004634150 now passes all476tests/39files, all22smaller guard mutations, fresh/populated/repeat migrations and drift. The formerly failing held-reattachment regression passes in1929ms; failed-attachment recovery, genuinely missing workspace and pre-extraction recovery predicates also pass. Root TypeScript and discovery of all five hydrated cases pass after the new completion assertions. Read-only Railway rendered-variable inspection confirms the worker's effective variable names still omit SOLARI_API_KEY, EVIDENCE_S3_* and CREDENTIAL_TOKENS/EXCEPTION_FINGERPRINT_KEY; this is a deployment prerequisite blocker, separate from configuring Actions for live acceptance. No settings or infrastructure were changed.

## Final standard CI and first configured live attempt

Pushed af3abd673c5a4f7ea54bd0ac4370933d33c36afd passes all five jobs in CI34209932606. Tested merge5150f635e724a68458eda58413a8bcf7cc3543c2 has the identical full tree a62224fb13325afe6ecf44f837f00e2e594cb36e. Hosted evidence:3539unit tests,476PostgreSQL tests,162browser/accessibility cases,22small guard mutations and all7worker/hydrated mutations with34baseline/removed-guard pairs, plus fresh/populated/repeat migrations, drift, TypeScript/boundaries and images. These browser results use local Chromium on the hosted runner.

Owner saved the model variables and API secrets. Live34216813131/job102030409623 at af3abd6 confirms nonempty Solari/OpenAI keys and gpt-5.6-luna. The actual worker starts, acquires the single-case population and reaches a RUN_FAILED Result; the required COMPLETED assertion fails. Isolation is not run. No remote authentication, observation or cleanup acceptance is claimed. Earlier34215956572 was a pre-allocation configuration failure.

The first configured attempt also exposes missing report retention: body-only Playwright attachments under the list reporter are not written to the upload glob. This diagnostic-only checkpoint materializes scanned JSON at the named outputPath, attaches its path and emits the same scanned facts to the log. A real-filesystem regression fails with ENOENT against the old body-only behavior, then passes after repair; the secret-bearing control proves no file, attachment or log is emitted. Six focused report/shutdown tests and root TypeScript pass. No audit assertion, runtime protection or provider budget is changed. This checkpoint is pushed for hosted/live verification, not accepted as a release. Next action: rerun the exact pushed candidate and diagnose the retained execution stage and cleanup identity. Production configuration remains a separate blocker; no merge/deployment.

## Authorized synthetic target deployment and live model refusal

Report retention is pushed as70497eb8e9e04ae4282f71844fa6363d89d77597. CI34217326851 passes all five jobs:3541unit,476PostgreSQL,162browser/accessibility cases,22small mutations and7worker/hydrated mutations with34baseline/removed-guard pairs, migrations/drift/builds. Live34217327232 proves Solari allocation and confirmed pre-expiry cleanup, but fails sign-in-contract-failed against the older target.

Owner explicitly authorized updating only Northstar. A one-shot operations branch codex/northstar-acceptance-deploy pins source70497eb and the existing service/environment IDs; it never enters the Epic4 branch. f6d51eb adds that job, fd9f9db enables pinned pnpm before Node setup, and da6fbd2 removes the workflow after the attempt (final operations tree exactly matches70497eb). Deployment34219001411/job102037432996 checks successful source CI and uploads with RailwayCLI5.47.2. Railway deployment65c63c65-db86-407f-80e7-9b097caccd42 is SUCCESS; public health and LoanCore return200 with a real password sign-in form. The later Actions cache-save error is retained as an operational failure, not misreported as a failed rollout. The existing staged patch1342aa17 and service config remain unchanged; no web/worker rollout or migration occurred.

Post-deployment live34219322909/job102038448363, Run01a080b7-8530-778d-a8e3-b2076083aad9, now reaches SIGNED_IN and POPULATION_READY. Real model execution reaches a durable AWAITING_AUDITOR wait with model-invalid-response; no audit Result is accepted and isolation is not run. The harness times out because its wait check incorrectly names AWAITING_INPUT. Cancellation and remote cleanup are confirmed with mode solari, status RELEASED and null cleanup diagnostic. Recording remains false.

This checkpoint corrects the harness to stop on AWAITING_AUDITOR and adds closed failure categories to rejected model turns: output-limit, empty-response, invalid-json, schema-mismatch and invalid-selection. The existing model-invalid-response checkpoint/retry classification stays unchanged; rejected response text is never retained and real usage is still charged. Five diagnostic regressions fail before repair and pass after it, alongside49existing gateway/accounting tests; an additional negative case proves arbitrary provider strings cannot enter diagnostic persistence. Full TypeScript passes. Next action: push and run the actual worker live again to distinguish Luna output-budget exhaustion from response schema/selection failure. This is diagnostic progress, not live audit acceptance; main remains unmerged.

## Diagnostic assertion follow-up

At pushed d1426295498112cb6c8e59e7c0af00ab35bd821b, CI34220819358 passes static, PostgreSQL/migrations and images, but worker mutation job102043249310 fails its three malformed-proposal baselines at agent-worker-abuse.spec.ts:241: the expected diagnostic still omits the new closed suffix. Both earlier hydrated guard pairs pass. The fixture supplies valid JSON with an invented tool ID, so this correction requires exactly model-invalid-response:invalid-selection, retaining every security and outcome assertion. Hosted baseline/removed-guard verification remains required after push; this is not an accepted gate.

Live34220819917 at the same commit confirms authentication and population, then records four model-invalid-response:schema-mismatch failures and an immediate durable AWAITING_AUDITOR wait. Cleanup is confirmed. No raw response is retained, so the exact incorrect field remains unknown; this proves valid JSON with an incompatible shape, not output exhaustion. A separate prompt-contract repair follows.

## Explicit response format repair

The diagnostic assertion follow-up is pushed as48381c711d9bc87419f21d663d25344df791cb96. Four real Luna turns at d142629 failed schema validation after successful Solari authentication. The prompt described parameters without specifying their array representation and described uncertainty without stating its object shape. This separate repair documents both exact existing wire shapes with generic JSON examples and increments AGENT_PROMPT_VERSION from2 to3. It does not change the parser, model, token limit, retry limit or frozen procedure inputs. Raw rejected text remains unretained, so no claim is made about which field Luna supplied incorrectly.

Regression: the new provider-request test fails against the old prompt because the strict example is absent. It passes after repair, including parser acceptance of the supplied example and exact invalid-selection refusal for an invented tool. All56gateway/accounting tests pass; full pnpm typecheck and pnpm boundaries pass (510modules). Hosted exact-candidate standard CI and both real-Solari gates remain pending this push. Next action: trigger the live workflow against this checkpoint, inspect retained stage/turn/cleanup facts, and require the representative audit and workspace-isolation gates. Production worker configuration remains unresolved; no merge or web/worker deployment.

## Align advertised search tools with frozen arguments

Pushed590df4e8b9923516b8aa89d4b9f69fdde63c67e6 passes3548local unit tests/170files. Live34222183373/job102047662370 reaches SIGNED_IN/POPULATION_READY and completes two actual Luna turns, then enters AWAITING_AUDITOR with insufficient-evidence. Remote release is confirmed. This proves the former response-shape failure is resolved for those turns, not that the audit passes. Static, PostgreSQL/migrations and image jobs in CI34222181964 pass; browser and worker mutation jobs were still running at this checkpoint.

Code inspection found a second concrete mismatch: addSearchOption advertises a model-writable parameter name, while executeAgentWorkItem rejects every nonempty model parameter array and the frozen lookup value stays private in parametersByToolId. The model sees neither a value to supply nor an explanation that the platform supplies it. The exact live rationale remains unretained; causation of that specific uncertainty is not asserted. This repair advertises zero writable parameters and explains platform-bound current-record search values. A real work-loop request regression fails before repair (employee_id advertised instead of []), then passes while proving the actual performed search still uses the frozen value. Primary/secondary and invalid-control planner tests retain their exact bound-value checks. All94planner/work-loop/gateway tests pass, as do full TypeScript and boundaries. No model, timeout, token, security, search completeness or evaluation rule changes.

The live failure report now projects only closed phase, uncertainty-kind and selected action-type codes for completed turns, never rationale, parameter values or raw response text. Next action: push this checkpoint and rerun exact-candidate live audit/isolation and hosted gates. Latest work is pending push at authoring; this is an incomplete acceptance checkpoint. Main remains unmerged and production configuration remains unresolved.

## Complete worker response example and phase uncertainty

Search-tool repair d6e8597ae620476d2cb9ef3d230c924ecbda4c1b is pushed. Live34222899942/job102049977293 confirms authentication and one completed action turn selecting navigate/capture-screenshot while also returning insufficient-evidence. The platform correctly raises a durable wait before executing those selected actions, and cleanup is confirmed. It does not pass the remote audit. The retained report contains only closed codes, not the rationale; the reason for that uncertainty remains unproven.

Independent read-only review caught that prompt3's main example still showed nonempty parameters accepted by the generic gateway but refused by the worker. The revised example regression fails on that prompt, then passes with a complete empty-parameter envelope against worker-style parameterNames=[]; a nonempty injection still fails invalid-selection. Prompt4 also explains that actions-phase uncertainty concerns safe next-step selection, while final evidence is still being gathered. This does not force none or bypass any actual uncertainty response, identity check, review or evidence gate. Generic gateway wire compatibility remains intact. No model or execution budget changes.

All103planner/work-loop/gateway/accounting tests and full TypeScript pass before the final uncertainty prose; the affected88gateway/work-loop/accounting tests pass again afterward. Standard590df4e CI static, PostgreSQL/migrations and images pass; its browser/mutation jobs were canceled by the next branch push and are not accepted. Read-only Railway recheck confirms neither web nor worker has EVIDENCE_S3_*; the worker still lacks Solari, credential manifest and fingerprint configuration. Only variable names were returned. Next action: push this incomplete checkpoint, run both actual-provider gates and complete exact final standard CI. No merge or web/worker deployment.

## Preserve verified corroboration in model evaluation context

Pushed86e12c16fb69579490118225b2a51553743c2c5e, live34223252568/job102051129776, now completes actual Luna-directed navigate, search, open-record and read-attribute actions through Solari. Its fifth turn is evaluation with insufficient-evidence; the worker durably waits and confirms remote cleanup. It is not an accepted audit. Static, PostgreSQL/migrations and images pass in CI34223251030; remaining browser/mutation jobs are pending at authoring.

The rule preview computes genuine snapshot corroboration, but the following model request discarded that judged copy and serialized the original Observation's null verdict fields. A new real-work-loop regression fails before repair (expected matched, received null), then passes after reusing the computed judged record for evaluation input. It also proves original roles values are unchanged and the model-facing identity/attributes equal the final independently registered Observation. Registration still uses the original record and repeats shared checks. The human unnamed-value/Unevaluated branch and all model uncertainty, confidence and sealing rules remain unchanged. All103work-loop/Observation/rule/gateway tests and full TypeScript pass. This is a concrete input correction, not proof that it caused the particular live uncertainty.

The live report may now retain the accepted model's bounded user-facing uncertainty summary, after the existing runtime credential guard and whole-report secret scan. No rejected output, hidden reasoning or raw logs are included. This lets a remaining legitimate policy/evidence question be reported precisely instead of guessing or forcing a conclusion. Next action: push, rerun the actual live audit/isolation and exact standard gates, and inspect any retained stop summary. Work remains unmerged; deployment storage/worker configuration is still blocked.

## Confirmed live policy ambiguity; isolate the independent gate

Corroboration repair0c118a8d77f9866e36a0b0fd90cf862e0710af79 is pushed. Live34223964866/job102053454020 again completes real model-directed navigate/search/open-record/read actions. Evaluation returns ambiguous with the accepted user-facing summary: The condition does not define which roles are privileged. This is now direct evidence of the remaining policy question. The worker preserves AWAITING_AUDITOR/insufficient-evidence and confirms remote cleanup. No fabricated proposal, audit Pass or remote-isolation result is recorded.

C2 remains the approved frozen default; no role definition or expected fixture outcome is inserted into runtime merely to make the model agree. Completing this specific live audit requires an approved clarification of the configured C2 judgment criterion. Production evidence storage and worker settings are separate blockers. The remaining independent isolation test can still be verified safely now that cleanup is confirmed.

This workflow-only checkpoint adds explicit PR label solari-isolation-acceptance to select that existing test. The combined gate and maxFailures=1 remain unchanged and failed audit acceptance remains failed. No model calls, recording, infrastructure changes or additional test assertions are introduced. Playwright discovery proves exactly one overlapping-workspace test is selected; YAML and shell syntax checks pass. Next action: push, select the independent gate, finish exact-candidate CI and record precise final blockers in the report. This checkpoint is not accepted as a complete Epic4 release.

## Remote isolation passed; release remains blocked on explicit owner inputs

Independent isolation34224743734/job102055999739 passes at pushed8eafbfbea65a53b651363b56ad93cd690dcf0472. Artifact10055228838 retains scanned original provider identities. Two managed sessions overlap, authenticate separately, isolate cookie/local/session/cache state, deny cross-Run attach/perform/release and intercepted out-of-scope requests, and close through the real application/provider paths. Both releases precede expiry: A2026-09-08T12:12:57.690Z and B12:12:58.342Z. Recording is false and model requests are zero. Worker memory and an independent provider firewall are not asserted. App treee60e9d7f340a8aeed4e3e7c00d3967c5218aabfe and package treeac0912c85598aa47b4d9107588349feb50db6c36 equal runtime0c118a8 exactly.

The representative model-directed audit remains not accepted: live34223964866 at0c118a8 reaches a correct durable C2 wait because the condition does not define privilege. Read-only independent review confirms roles are present/corroborated and the judged-copy repair preserves independent registration and the human unnamed-value branch. No fixture answer or synthetic privilege policy is inserted to force completion. An approved C2 criterion and existing approved private S3/production worker configuration are genuine release blockers. GitHub reports main12ec596dc3d23907a80a7d395c343a54c4375d5a unprotected; no direct push, bypass, merge or candidate web/worker deployment occurs.

This documentation checkpoint refreshes the engineering report and adds epic-4-live-provider-verification.json with bounded accepted proof, exact tested runtime/provider commits, secret-free configuration/Run IDs and cleanup facts. Original provider identities stay in the scanned Actions artifact. A1472tracked-file scan at8eafbfbe finds zero occurrences of the supplied key; temporary snapshot/delivery/payload/deploy transports remain absent. Standard CI34224604065 has static/images green and remaining gates pending at authoring. The following documentation-only head needs its own standard checks; final results are recorded on PR24 after completion. Next action: push this reviewable handoff, finish hosted checks, diagnose any actual failure, and ask only for the approved C2 judgment policy and evidence-storage configuration. This checkpoint is explicitly not a merge-ready Epic4 release.

## D3: the 24-hour disablement window through the complete evidence path (2026-09-09)

Owner decision 2 (addendum §0b) is implemented as one bounded story, `spec-4-12`. A version
declares, per condition, which population column supplies compiler 1's `termination_time`
(`mapping`, time fields only, one column per field across the version, omitted when absent so
frozen rows recompile byte for byte); LoanCore's account page now renders `Disabled time`, the
catalogue registers the label, and P-1 carries it as a VARIANT attribute that the planner offers
and the capture accepts only when the version's Evidence Requirements name `disabled_time`. The
canonical fixture authors C3 beside the explicit C1 (`canonicalLoanCoreCompliance({
disablementWindow: true })`), and the single-case source can join the PeopleHub instant into a
separately declared CSV with its own signed cover (`startCanonicalLeaverSource(id, {
terminationTime: true })`). No approved version, Run or canonical dataset row is rewritten.

Local verification on this host: 8 domain tests (`disablement-window.test.ts`: compile and
refusals, below/exactly/above 24 hours, equivalent offsets, missing/invalid/date-only values,
contradictory evidence, proven absence), 44/44 in `execute-agent-work-item.test.ts` including the
six D3 cases (capture by label, mapped instant, one second past and the exclusive boundary,
date-only source, page without the label, page for the wrong employee, variant only when
requested), the §D E-000105 golden case read from the datasets, and the transcription pins.
Root, domain, application, web and Northstar typechecks pass.

`tests/e2e/disablement-window-journey.spec.ts` ran against the compiled worker, the rebuilt
synthetic LoanCore, PostgreSQL 18 at generation 41 and a real object store: the instant-bearing
source seals PASS after C2 confirmation with C3 origin RULE Compliant, the disablement instant
captured as `2026-08-08T00:00:00+02:00`, normalized `2026-08-07T22:00:00.000Z`, grounded at a
`$.nodes[i].value` locator whose registered bytes hold that cell in the identity's record group;
the date-only source seals INCONCLUSIVE with C3 `missing or invalid Observation field
termination_time`. Both cases passed (20.1 s and 10.0 s; 5 passed with the auth setup). The first
attempt never reached a test: the cold Turbopack compile exceeded Playwright's 180 s web-server
timeout on this host, so the servers were warmed first and reused, which is the documented local
remedy and changes no configuration. Teardown left zero Procedures, Runs or grants behind.

Remaining for this story: Builder authoring of the mapping and the variant requirement belongs to
the hero-workflow usability pass; a deployed LoanCore registration gains the `Disabled time`
label through the authorized configuration flow (a digest change with the Story 2.8 ripple); the
hosted CI browser gate runs the journey on the pushed candidate.

## Hosted mutation gates: anchor drift from the C2 policy line (2026-09-09)

The standard CI runs on `db3c6d3` and `ad238db` failed in both mutation jobs with
`Mutation anchor drift`: the C2 policy commit (`1dee0cb`) widened the worker's audited-retry
guard to `model-policy-contradiction`, and three harness entries (`invalid-provider-security-
event`; `worker-malformed-proposal-security-event` and `retrieved-worker-security-denial`)
anchored on the previous exact line. `6237c4c` repoints the three `before:` anchors; the
mutation (`return;`, the whole security-event guard removed) and its killing tests are
unchanged. A local check confirmed every `before:` anchor across the four harnesses occurs
exactly once, and the guard harness in a disposable detached worktree of `6237c4c` killed all
ten unit-mode mutations (baseline green, mutant red for each), the repointed entry included.
The two abuse-harness entries need the hosted job's real worker journeys and are proven there.
Lesson recorded in CLAUDE.md: a change to a guarded line must repoint its mutation anchors in
the same commit, or the hosted gates stop before proving anything.

## Live acceptance passed on the policy-bound candidate (2026-09-09)

Standard CI `34298099868` on `6237c4c` is green in all five jobs (typecheck/boundaries/unit;
PostgreSQL migrations, integration and the guard-mutation gate; the browser suite including
`disablement-window-journey.spec.ts`; container images; the abuse-mutation gate). The
docs-only head `07f79e2` was pushed and the `solari-live-acceptance` label re-applied.

Live run `34299424112` on `07f79e275b729893754ce23e5eacbc420c706902` passed all three cases in
1.3 minutes of Playwright time, on Solari (`us-west`, recording off), OpenAI `gpt-5.6-luna`,
prompt version 4, against `https://northstar-production-b312.up.railway.app`:

- Policy-bound (E-000102, the frozen role-privilege policy on C2): Run
  `01a083ca-06ee-7ba3-b2d5-becb0f279232` ended `COMPLETED`, outcome `PENDING_CONFIRMATION`,
  Gate passed, five model turns (navigate, search, open-record, read-attribute, evaluation),
  C2 proposal `COMPLIANT` with no diagnostic, one Observation, ten registered artifacts (five
  Structural Snapshots, five screenshots), workspace `RELEASED` at 01:31:16 before its 02:30
  expiry. The harness did not impersonate a reviewer; the proposal awaits an authorized human.
- Undefined-privilege negative case (no policy): Run `01a083ca-7e01-7a3f-b011-5997aaaf8ff1`
  authenticated, performed the same four actions, and the evaluation turn returned
  `ambiguous` with the accepted summary "The privileged-role criterion is undefined."; the
  Run waited durably (`AWAITING_AUDITOR`, `insufficient-evidence`), was cancelled through the
  real command, and its workspace was released. It asked rather than guessed.
- Remote isolation: two overlapping Solari sessions kept authentication and browser state
  apart, refused a forged cross-Run reference and two intercepted out-of-scope fetches, and
  both released before expiry; zero model requests.

The secret-free reports are the run's retained artifact `10084400638`. This is the
representative live acceptance the owner asked for; the review path is proven separately by
`agent-evaluation-journey.spec.ts` and `evaluation-review.spec.ts` with an authorized identity.
A later candidate (the hero-workflow merge) needs its own live result, per the workflow's rule.

## Populated upgrade from production's generation proven (2026-09-09)

Production runs `main` (`12ec596`) at schema generation 14, and the earlier upgrade proof
started from 32. A generation-14 database was therefore built by main's own migrator,
populated by main's own commands (four Procedures across DRAFT, SUBMITTED, APPROVED and
ACTIVE, a published platform configuration and its platform-authored Draft, delivered
notifications, one worker heartbeat) and upgraded in place by the candidate's migrator
(`6237c4c`): exit 0, 12 s, `schema_meta` at 41. Every pre-existing row's generation-14
columns are byte for byte unchanged (nine named tables digested before and after; the two
whose full-row digest moved are exactly the two that gained nullable Epic 4 columns), the
only pre-existing row-count changes are the migration ledger and pg-boss's queue
definitions, schema parity with a fresh generation-41 install is exact (673 columns, 861
constraints, 40 triggers) and the migrator is a no-op when run again. The full account is
`epic-4-populated-upgrade-proof.md`; the readiness table's row now reads passed.

One finding outside the upgrade: two `immutable-versions.test.ts` cases fail on ANY
database that already holds a published platform configuration, fresh or upgraded, because
their cleanup restores the `@current` pointer and that restore throws in the driver for a
pre-existing row. CI never meets it because every CI database is empty; the populated proof
met it because publishing a configuration was one of its steps. It is a test-isolation gap,
not a product defect, and it is repaired in the hero-workflow candidate rather than left as
a note.

## The hero-workflow pass lands on the candidate (2026-09-09)

The usability pass the owner asked for in §3 was built on `codex/epic-4-hero-ux` (six
commits by the UX agent, then this session's `7a8f372` finishing the 24-hour window as a
third condition with its readiness items and the capture offer) and merged with
`codex/epic-4-agent-runs` at `d1d9ade`+`efa6625`. One file overlapped (`builder/actions.ts`:
the mapping shape check from D3 and the honest lost-response sentence from the pass) and
merged cleanly. The whole account is `epic-4-hero-workflow-report.md`; the pictures are in
`hero-ux-screenshots/`.

Gates on the merged tree, PostgreSQL 18 at generation 41: typecheck green (one post-merge
type error in `readiness.test.ts`, where the malformed-mapping probes are deliberately not
the compiled type and now say so with a cast); unit 3641 passed (two `session-route`
timeouts under CPU contention, 38 of 38 alone); boundaries 519 modules; build; browser 34
of 34 across the hero journey, `procedures`, `version-review`, `executable-plan` and the
Story 4.12 journey, with axe clean at every scanned state; every mutation anchor in the four
harnesses occurs exactly once. The one browser test the agent had left red — it drove the
old "Use 24-hour window" swap button — now drives the Timing control and asserts C1 survives;
the six failures after it were its shadow (Playwright restarts its worker after a failure
and runs `afterAll` early).

Two test repairs ride with it, both from the `sql.json` finding recorded in CLAUDE.md:
`immutable-versions.test.ts` restores the `@current` pointer through `::text::jsonb` and
passes with a published configuration in place (the pointer is restored afterwards, which
the pre-repair cleanup could not do — the first reproduction here left a dangling pointer
that broke every Procedure creation on the test database until it was repaired by hand),
and `procedures.test.ts` asserts the SQLSTATE of each raw-SQL Period refusal, so the three
cases reach the CHECK they exist to prove.

Hosted CI on the merge head and the live acceptance on it are recorded in
`epic-4-story-status.md` and on PR 24 as they complete.

## The final candidate is green everywhere (2026-09-09)

`9da4df6`, the merge of the hero-workflow pass, has standard CI `34316930519` green in all
five jobs and the live acceptance `34317015975` passed on the same head (artifact
`10090483703`, secret-free): the policy-bound audit, the undefined-privilege negative case
and the remote isolation gate, on Solari against the hosted Northstar. Nothing remains on
the engineering side of decision 3; what remains is the owner's: the worker inputs in
`epic-4-deployment-readiness.md`, the review of PR 24, and the merge. Epic 5 starts on
`codex/epic-5-live-replay` from this head.
