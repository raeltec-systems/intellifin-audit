# Story 20.5 implementation evidence

Baseline: `adaa83a83ea0c1be462f866f127525417b2e0be1` on
`codex/zobba-foundation-batch`.
Contract: [standing Permissions specification](spec-20-5-standing-permissions.md).
Status: implementation and independent repair review complete; all final local
gates passed. Story 20.5 is ready for owner review on the foundation branch.

## Delivered boundary

The Rust operation store intersects current organisation, engagement, member,
account, Task and complete delegation authority with the Task's accepted upper
bound. The three operating purposes remain distinct: Live inspection, Test
workflows and Audit coordination. Covered work needs no additional human
ceremony. An exact decision cannot override a hard prohibition. The accountable
Task actor or a currently assigned Audit manager can decide; Admin alone and
another Auditor's guidance access do not supply that authority.

Canonical operation meaning binds the account, environment, destination,
recipients, material and hash, attachment identities and hashes, resource version,
purpose and expiry. A stable logical operation key survives lost acknowledgements
and ownership replacement. Immutable operations, decisions, attempts and observed
facts remain separate. A one-use claim crosses the possible-dispatch boundary
before external I/O; unknown or pending effects never justify blind replay.

Schema 4 adds these records without rewriting migration or catalogue versions
1–3. Exact producing Task claims, current owner/cycle/intent/execution, source
binding and current permission are checked at consumption. Shared policy updates
use organisation then engagement locking. Runtime cannot write trusted attachment
registrations or rewrite immutable history. Ordinary Task-policy revisions retain
the accepted snapshot; wider current rules do not silently widen it.

The qualification gateway owns a numeric loopback endpoint and pins its source,
ledger incarnation, route digest and contract version. Source lookup precedes any
new attempt after uncertainty. The owned source atomically checks resource
version, expiry and attachment metadata before effect, deduplicates logical
operations and retains attempt-specific absence fences. Another endpoint or an
empty replacement ledger cannot supply authoritative absence for the original
source. Database connections are released before remote I/O.

Recovery reuses exact receipt custody across normal polling and freshly checks
current lookup authority. Exact late capabilities can record source facts after
Stop or revocation, but cannot restore execution or audience access. Bounded
discovery and authenticated history are pageable. History makes persisted
decisions, deciders, expiries, attempts and source observations inspectable after
reload without exposing receipt secrets or worker custody.

Task cessation considers both child processes and external effects. Pause/Stop
remains effective in either receipt/coordination order. Source-confirmed absence
can obtain a fresh producer only under unchanged Task meaning; source completion,
changed guidance and unresolved child activity do not authorize an old operation.

## Verification

Final combined verification on 2026-10-01:

| Gate | Result | Recorded output |
|---|---|---|
| Locked Rust workspace tests, restricted migration owner and separate runtime | 111 passed, zero failed; two child-process entry points ignored by discovery and invoked by their harnesses | [Rust suite](zobba-foundation-batch/story-20.5/rust-workspace.txt) |
| Actual Chromium through HTTPS OIDC, Rust API and worker | 56 passed | [Browser suite](zobba-foundation-batch/story-20.5/browser-full.txt) |
| Web types, generated contract parity and unit checks | 78 passed | [Web checks](zobba-foundation-batch/story-20.5/web-check.txt) |
| Independent identity fixture | 46 passed | [Fixture tests](zobba-foundation-batch/story-20.5/identity-fixture.txt) |
| Disposable-database/endpoint guards | 47 passed | [Python guards](zobba-foundation-batch/story-20.5/python-guards.txt) |
| Explicit migration, startup refusal, health, database loss and recovery | Passed | [Process smoke](zobba-foundation-batch/story-20.5/process-smoke.txt) |
| Formatting, warnings-as-errors Clippy, locked Rust build, frozen pnpm install, web build and dependency boundaries | Passed | [Commands and all outputs](zobba-foundation-batch/story-20.5/README.md) |

The [source manifest](zobba-foundation-batch/SOURCE-MANIFEST-20.5.json)
records 139 tested source files. Every hash was rechecked after the final runs;
the original six migration/catalogue files also match the approved Git baseline.
The frozen web lockfile and GitHub workflow were not changed. The branch push
does not trigger hosted CI; these are executed local results, not a hosted result.

The final run includes actual PostgreSQL races, source HTTP/process crash and
lost-acknowledgement cases, current claim and policy cutoff checks, source/material
identity, exact refusal, bounded recovery/history, and all retained foundation
scope/control/account-switch regressions. The final minimal event repair was
first checked with the retained Task and new operation targets together (eight
passing tests), then with the entire Rust suite and fresh process/browser runs.

All destructive suites use guarded disposable databases. The final Rust path
uses `zobba_patch20_3_test`, restricted migration owner
`zobba_patch20_3_owner` and separate nonowner runtime `zobba_patch20_3_app`.
Smoke/browser use the separate `zobba_story_20_test` database and `zobba_app`
runtime. Development data is not reset. The real HTTPS OIDC fixture and installed
Chromium exercise the existing browser flows; no browser success is mocked.

Three independent reviewers examined the full tracked and untracked diff before
repairs. [The review record](zobba-foundation-batch/REVIEW-20.5.md) identifies the
accepted findings and independent rechecks. A restricted-role fixture defect
found during the first combined run was repaired by arranging synthetic rows
through the explicit guarded administrative connection; production migration
and runtime privileges were not widened. An early browser setup run refused an
issuer mismatch left by an API fixture. The documented smoke-reset-then-browser
sequence passed, preserving the issuer-rebinding guard. The final combined
run also caught a duplicate `observed` event when inert receipt incorporation
already established the final Task state. The repaired reconciliation block emits
a revision/event only for an actual state change. Independent review confirmed
that external completion/absence and both Pause/Stop receipt orders remain intact;
the final passing runs include this repair.

A later browser run found a retained assertion waiting for a transient scope-loss
notice after the next successful refresh had already cleared it. The page showed
the correct replacement identity and permitted chooser. Only that assertion was
changed: it now checks the stable replacement identity, exact allowed chooser and
absence of old private content before proceeding. Existing old-outbox equality,
no-replay, empty replacement history and durable 403 checks remain intact. The
independent reviewer confirmed the change against App refresh behavior. The
focused replacement test passed three consecutive executions, followed by the
full 56-test browser run. Production Rust and web source did not change for this
test repair.

## Limits and next dependencies

- This qualifies an owned local source. No live connector, customer account,
  production source write, remote exactly-once guarantee or real computer is
  delivered by this story.
- The production foundation worker remains inert. A native model and integrated
  business-operation proposal loop come in later stories. Full browser Needs you
  decisions belong to Story 25.2; this story supplies its authenticated seams.
- Source/material registrations are a trusted qualification boundary, not a
  document-ingestion product or an invitation to trust model annotations.
- Calls, response sizes, pages, operations, attempts and custody replacements are
  bounded. Exhaustion remains explicit and never implies absence or permission to
  resend. Normal polling does not consume another recovery producer each time.
- Story 20.6's membership writes must join the same organisation/engagement
  authority fences. Current access is rechecked now; arbitrary privileged SQL is
  not presented as an atomic application-owned revocation path.
- After owner acceptance, Stories 20.6, 21.1 and early real-computer qualification
  23.1 are dependency-ready. No next story is started here. Paid qualification
  still requires approval of its specific environment, region and spend ceiling.

No merge, deployment or paid resource provisioning is part of this checkpoint.
