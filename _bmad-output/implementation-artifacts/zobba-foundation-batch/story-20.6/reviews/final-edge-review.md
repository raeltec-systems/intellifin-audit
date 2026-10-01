# Final independent edge review — Story 20.6

**Result: no remaining blocker in the two reviewed source repairs or the exact local recovery candidate.** This is a focused second-repair review, not a replacement for the lead’s combined checks or the other independent reviews.

## Frozen source

All 158 files in `second-repair-freeze.json` matched their hashes before and after this review. Manifest SHA256: `e2a38cc6a4825ce470c366c5e3e45df9e6eb06b3a56408cc274c505b279f9d1e`. Full diff SHA256: `9d9a69065e3ca953843ac1115c4b4a93d72b8edb998508ab612c997286cb1521`. No repository source was edited and this reviewer made no database connection or mutation.

## Closed findings

1. **LEGACY_CURSOR_ORDER_MISMATCH — closed.** `zobba/migrations/0005_membership_administration.sql:134` now orders the JSON aggregation by `(client_id, engagement_id)`, exactly as the continuation predicate and bounded SELECT do. The period separator is unambiguous for validated scope IDs. The real PostgreSQL regression in `zobba/crates/infrastructure/tests/membership/legacy_upgrade.rs:342` creates 50 `a` scopes and 51 `a-` scopes, requires the complete ordered list exactly once, pins both continuation cursors, removes all three returned chunks and checks that none remains active. The lead-executed contract log reports 3 passed, no skipped/failed tests (`ui-second-repair-guarded-reset.log`). I inspected the assertions and log; I did not rerun that database suite.

2. **LEGACY_EXPIRY_MODE_SWITCH — closed.** `zobba/web/src/MembershipWorkspace.tsx:149` captures both completeness and the original assignment set when opening the editor. Rendering and command construction use the captured completeness, so a same-version refresh cannot convert an incomplete draft into a replacement. The real-browser regression at `zobba/web/tests/browser/membership.spec.ts:511` loads 101 assignments before actual expiry, refreshes to 100 at the same version, keeps the edited role, asserts a preserve/empty command, then verifies all 100 remaining assignments and the unchanged expired row. The lead’s browser log reports all 16 membership cases passing.

## Independent browser exercise

I separately built the frozen client to `/tmp/zobba-review-20-6/final-edge-dist` and ran actual Chromium against an owned loopback HTTP mock, with no shared runtime or database. Both cases passed:

- Open an incomplete 101-assignment draft, edit the role, refresh with a complete 100-assignment response: Save remains `preserve` with no assignment payload.
- Repeat with one explicitly selected removal before refresh: Save remains `remove`, carries only that selected scope with `renew: false`, and retains the original expected version and role edit.

Evidence: `final-edge-build.log`, `final-edge-mock.mjs`, `final-edge-mock.jsonl`. These checks independently prove client command behavior; durable storage evidence comes from the real suites cited above.

## Local incident recovery

The updated exact-candidate review is appended to `/tmp/zobba-development-recovery-20-6/independent-reviewed-repair.md`. I verified the candidate definitions, approved DDL delta, all five original ledger tuples, target/unused-draft/data-preservation guards, successful 32-table rehearsal and final CLI readiness, plus socket/wrong-target/replay/missing-marker refusal logs. No concrete blocker remains to adapting only the exact database target from the restored clone to `zobba_story_20` and updating its comment. That concurrence is limited to this exact candidate after the full story checks pass and with a fresh development backup. The actual development database has not been repaired by this review.


## R1 candidate recovery follow-up

The subsequent R1 change leaves the reviewed pagination and UI paths byte-identical. All 159 files in `r1-freeze.json` matched before/after the follow-up. I independently rechecked the regenerated recovery definitions, unchanged non-function DDL and guards, all five incident-ledger tuples, successful 32-table rehearsal, CLI readiness and all four refusal cases. No recovery blocker remains. The exact current candidate hashes and target-only adaptation concurrence are in the **Final R1 recovery recheck** section of `independent-reviewed-repair.md`; they supersede the earlier candidate hashes in this report’s original review.
