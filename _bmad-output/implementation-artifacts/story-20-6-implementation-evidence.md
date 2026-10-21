# Story 20.6 implementation evidence

**1 October 2026 (Africa/Lusaka) — implementation complete; ready for owner review.**

Baseline: owner-accepted Story 20.5, `3db538252b2833ca2ecb4342fb7ca9d69cb7582c`.
Contract: [membership specification](spec-20-6-membership-administration.md).
No merge, deployment, external invitation delivery or cloud spending occurred.

## Delivered behavior

Admin can administer organisation membership, roles, expiry and engagement
assignments through ordinary validated Save. Admin alone receives membership
metadata, not audit content or sign-off authority. Private one-use invitations
bind fixed terms to a signed verified recipient and configured issuer. Acceptance
rechecks the exact session and current authority after database lock waits.
Attributable immutable receipts support exact retries without regranting access.

Membership changes protect the last eligible Admin and fence affected Task
execution, unused claims and delegation. Other assigned engagements stay usable;
regrant cannot revive old execution. Retained assignment expiry survives elapsed
time while an editor is open. Explicit renewal/widening of finite grants
conservatively fences old execution even if the old deadline is still future.
Unchanged-expiry, `renew:false` edits preserve their ordinary behavior.

Large legacy membership sets have complete bounded paging and preserve/remove
editing. An expiry-driven refresh cannot turn a partial editor into replacement.
Private drafts, invitation terms and retry state are bound to the exact browser
session. Fragment navigation preserves pending, uncertain and completed sign-out.
Schema 5 uses narrow inventoried SQL entrypoints with exact grants, owner,
search-path and definition checks; runtime receives no general membership DML.

## Verification

| Final gate | Result | Output |
|---|---|---|
| Locked Rust workspace, restricted migration owner and separate runtime | 129 passed; 0 failed | [Rust](zobba-foundation-batch/story-20.6/rust-workspace.txt) |
| Actual Chromium, HTTPS OIDC, Rust API/worker and PostgreSQL | 72 passed; 0 failed/skipped | [Browser](zobba-foundation-batch/story-20.6/browser-full.txt) |
| Web types, generated contract parity and unit checks | 89 passed | [Web](zobba-foundation-batch/story-20.6/web-check.txt) |
| Independent identity fixture | 54 passed | [Fixture](zobba-foundation-batch/story-20.6/identity-fixture.txt) |
| Disposable target/endpoint guards | 47 passed | [Guards](zobba-foundation-batch/story-20.6/python-guards.txt) |
| Strict startup, repeated migration, dependency loss and recovery | Passed, including bootstrap 3/3 | [Smoke](zobba-foundation-batch/story-20.6/process-smoke.txt) |
| Frozen install, formatting, warnings-as-errors Clippy, builds and boundaries | Passed | [Commands and results](zobba-foundation-batch/story-20.6/README.md) |

The Rust count includes two compile-fail documentation tests. Two ignored discovery
entries are subprocess helpers invoked by their owning process tests; they are
not omitted qualification scenarios. All 159 tested source files match the
[source manifest](zobba-foundation-batch/SOURCE-MANIFEST-20.6.json). Published
migrations/catalogues 1–4 remain byte-identical to the accepted baseline.
These are executed local checks; pushing this branch does not trigger hosted CI.

Three independent reviewers examined the complete change and repairs.
[Review dispositions](zobba-foundation-batch/REVIEW-20.6.md) retain findings,
intermediate failures and independent rechecks. The final expiry tests block the
real UPDATE after fence selection, cross the actual PostgreSQL deadline, then
prove old claims/delegation remain unusable after renewal. They also prove
preserved-scope consumption, exact replay and unchanged-expiry countercases.
The retained Task concurrency test identifies the actual later backend and its
specific blocker; its lock-order assertion was not reduced to an arbitrary wait.

## Local development incident and completed recovery

A test-diagnosis command accidentally used the development migration URL and
applied published migration 4 plus an unpublished draft of migration 5 to
`zobba_story_20` at `2026-10-01T11:44:55.735656Z` (13:44:55 Africa/Lusaka).
No reset or deletion occurred. The incident was disclosed and development kept
read-only until an explicit reviewed repair was ready. General/test toolchain
activation now clears development URLs; development requires separate opt-in.

The repair first passed on a separate restored copy. Guards require the exact
loopback database, user and port, all five original ledger tuples, the known old
catalogue and unused draft tables/proof fields. Wrong-target, Unix-socket,
repeated-execution and missing-marker probes refused. A PostgreSQL logical schema
restore normalizes expression trees, so rehearsal used owned schema migrations
plus backup data; strict application catalogue checks were not weakened.

After all final checks, a fresh PostgreSQL 18.4 backup was verified and the
[exact local repair](zobba-foundation-batch/story-20.6/local-unpublished-draft-repair.sql.txt)
committed successfully. All **32 application tables**, published ledger entries
1–4, and existing function ownership/ACL/attributes were preserved. Only the
known unpublished version-5 checksum changed after the approved DDL delta.
Strict schema readiness then passed. The
[recovery record](zobba-foundation-batch/story-20.6/local-recovery.json) and
[independent review](zobba-foundation-batch/story-20.6/reviews/local-recovery-review.md)
record exact hashes and guards. Private backups, row contents, session material
and row fingerprints remain outside Git. There is no general checksum-repair
mechanism in application startup or migrations.

Final migration-5 SHA384:
`f37f620b90745b6e2e86f886df697ffe1be074a70372a77194109a12713a9f341cfd2ab1abcadd71ed271e221bee3ba3`.
Final catalogue SHA256:
`b23577d5beda191b0d2cae44dd742d9655ed75d732218f1d4ccdaf3cd0c48fc8`.

## Browser inspection and limits

Root and implementation reviewers inspected the final
[desktop](story-20-6-evidence/membership-desktop.png) and
[390-pixel mobile](story-20-6-evidence/membership-mobile.png) captures. Controls
remain readable without horizontal overflow; saved-member focus is asserted;
no private invitation link or unexpected console error appears in the
[recorded facts](story-20-6-evidence/membership-ui-evidence.json).

- Invitations are private copyable links, with no email delivery or Sent claim.
  Uncertain browser commands remain in memory; leaving the page discards that
  local retry request. Secret plaintext is not stored for later retrieval.
- Recipient proof requires an OIDC callback within five minutes; this does not
  assert forced password/MFA reauthentication. Missing/unverified/unusable-string
  email permits normal sign-in without proof; malformed JSON claim types may be
  rejected by the unchanged pinned SDK. Address support is bounded ASCII.
- Out-of-range legacy expiry values refuse migration atomically and require an
  explicit operator correction; values are not silently coerced into grants.
- Revocation qualifies the implemented Task/claim/delegation paths. No computer
  or live connector hooks are claimed. Early real-computer qualification remains
  in sequence under the [unapproved environment/spend proposal](zobba-foundation-batch/QUALIFICATION-PROPOSAL.md).

Story 21.1 is the next implementation in this authorised batch. Story 21.2 can
then bind methodology to this owned membership authority.
