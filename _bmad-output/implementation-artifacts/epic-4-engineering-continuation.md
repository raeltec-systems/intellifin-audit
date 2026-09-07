# Epic 4 engineering continuation

Status: INCOMPLETE — not accepted, not merged.

## Current checkpoint — durable review dispatch (not accepted)

- Latest fully hosted-verified SHA: `fbd9c10d3d0827b1ff06c7910288ea2b9e99fbc3`; CI `34152702255` passes all four jobs. PostgreSQL: 439 tests / 35 files, including fresh/populated migrations and drift. Browser isolation mutation gate: all 15 deliberate guard removals detected by passing-baseline/failing-mutant assertions. This is local Chromium, not remote Solari evidence.
- This checkpoint adds generation 37 durable review commands, a dedicated worker queue, fresh authorization at execution, worker-only Exception signing, immutable original proposal/finding history, and effective-condition UI projection. Web reports pending until worker transaction commits. Recovery retains pending work when the signer is unavailable.
- Local focused review/application/repository/queue/UI validation: 82 tests pass. Production worker E2E and PostgreSQL command regressions are committed for hosted execution; candidate acceptance is pending those checks.
- Stories 4.4–4.11 remain under final verification. Inspector access, exact frozen authentication destinations, seeded P4 model navigation and additional hydrated/worker abuse checks remain separate worktree checkpoints. No merge or deployment.
- Live gate remains blocked by unavailable Solari credentials and production worker evidence/credential/fingerprint configuration. Next action: push this coherent review checkpoint, verify hosted results, then deliver inspector/authentication checkpoints and repeat affected gates.
- Delivery: this entry travels with the atomic commit; the matching commit is pushed immediately after creation. It does not declare its own untested SHA accepted.

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
