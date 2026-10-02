# Approved Admin continuity checkpoint

**Owner accepted on 2 October 2026 (Africa/Lusaka): `38d76b019db1e5cb637f8c66e6cde3947c3415b2`. The next dependency-ready batch, Stories 21.2–21.4, is authorised.**

1 October 2026 (Africa/Lusaka). Follow-up to owner-accepted Stories 20.6 and 21.1 with accepted baseline `9a76c5c8aa38f8e7c16ab95bb1f47b7d70f4057a`, on `codex/zobba-foundation-batch`.

Every organisation now requires an active, non-expiring Admin membership linked to an active application identity. Additional temporary Admins remain allowed. Ordinary Save explains a refusal and succeeds after a qualifying replacement exists; no second approver or new identity-administration authority is introduced.

## Delivered boundary

- Migration 7 enforces the invariant at commit for membership edits/removal, identity deactivation/removal and organisation provisioning. Deferred checks permit first provisioning and replacement within one transaction. Existing attribution foreign keys remain intact; harmless unreferenced identities can still be deleted.
- Organisation locks and identity share locks serialize competing changes, including newly inserted or newly qualifying memberships invisible to another transaction. A full actor/organisation index supports lifecycle lookups; same-organisation updates avoid duplicate deferred assertions. Real PostgreSQL barriers verify both winner orders, multi-organisation changes and safe deadlock rollback. Guarded mutations require READ COMMITTED; stale REPEATABLE READ/SERIALIZABLE transactions are explicitly refused.
- An invalid existing organisation causes an atomic upgrade refusal with an operator preflight and explicit remediation instructions. Migration never invents authority. Published migrations/catalogues 1–6 are byte-identical to the accepted baseline.
- Exact schema verification includes trigger definitions, enablement, function bodies, ownership and private execution privileges. Runtime identity-deactivation/deletion authority remains absent.
- Synthetic fixtures receive a separate Admin-only identity for the second organisation. Existing auditors gain no Admin role. Fixture restoration acquires organisation locks before identity rows and runs atomically; production TRUNCATE refusal stays enforced.
- The API exposes only the static public `last_admin` code in a response header, allowing immediate actionable browser guidance even when the body or its cancellation stalls. Older/body-only responses retain a 4 KiB/250 ms bounded fallback; unknown headers and other errors preserve existing handling. Owner SQL diagnostics identify the affected organisation without exposing that detail in the public response.

## Verification

| Check | Result |
|---|---|
| Full Rust workspace, real PostgreSQL/OIDC | 176 passed; 0 failed; 3 expected parent-invoked helper entries |
| Web generated API, TypeScript and units | 113 passed; 0 skipped |
| Full real-browser suite | 99 passed; 0 failed; one worker, no retries |
| Full membership browser file after observation repair | 17 passed; no retries; overlaps full browser count |
| Fixture tests | 56 passed |
| Python test guards | 47 passed |
| Formatting, strict Clippy, Rust build, production web build, boundaries | Passed |
| Process smoke | Passed: repeated migration, readiness/liveness, actual database interruption and same-process recovery |
| Published migration/catalogue prefix | 12 SHA-256 matches against accepted baseline |

Counts are top-level test results, not assertions inside helper contracts. The three Rust harness helpers are deliberately launched by passing parent tests with isolated configuration; no database suite was skipped. Focused bootstrap/continuity and smoke reruns overlap the workspace count.

[Acceptance map](admin-continuity/acceptance-map.md), [exact commands](admin-continuity/executed-checks.md), [machine-readable receipts](admin-continuity/verification-results.json), [tested source hashes](admin-continuity/review-repair-verified-source-manifest.json), and [published-prefix verification](admin-continuity/review-repair-published-prefix-verification.json) retain the evidence. PostgreSQL server 18.4, Rust 1.98.1, Node 24.20.0, pnpm 11.25.0 and Chromium 151 were used; the psql client is 17.11. Tests used only guarded disposable databases; the separate development database was preserved.

The first full browser run passed 97/99. One fixture reset inverted the organisation/identity lock order and received a real 40P01 deadlock; the other failure was a Playwright datetime-local input containing normalized zero seconds. Both were repaired, then the targeted cases and full suite were rerun. Initial compilation/fixture/capture failures and exact corrections are retained in the command history. A post-review smoke wrapper also initially referred to a nonexistent renamed script and exited before execution; correcting that wrapper did not alter application source. Its failed receipt and the real rerun are retained. The first post-review browser run passed 98/99: the remaining assertion tried to read an optional 409 body after the client correctly cancelled it upon reading the new header. Changing that assertion to the real header passed the targeted case, but the next full run again passed 98/99: Chromium could not retain a successful 200 response body for a later receipt assertion. The final test forwards each real API POST once, retains its actual upstream response, and delivers that response unchanged to the browser. It asserts browser status/header equality, exact upstream JSON, actionable UI, unchanged refused state and attributed successful receipts. This case buffers the response and therefore does not test streaming/cancellation timing; the uninstrumented Save/refusal cases and bounded-reader unit tests remain. All 17 membership scenarios and TypeScript passed after the correction. Only this test changed after the passing production/Rust/smoke checks; a source delta proves that boundary. Both failed 98/1 runs and the initial type-only compile error are retained. None is hidden or labelled as an unexplained flake.

Browser evidence: [last-Admin refusal](admin-continuity/last-admin-refusal.png) and [successful temporary-Admin Save](admin-continuity/temporary-admin-saved.png). These show synthetic accounts only; no fixture credentials, private keys, session state or traces are included.

## Independent review

Three context-free BMAD reviews covered the complete patch. Eleven routine repairs addressed the findings and added meaningful regressions; one pre-existing identity-status projection limitation was deferred. Independent production and verification follow-ups found no remaining issues. The final full browser run and all required checks passed; no implementation finding remains open. See [review record](ADMIN-CONTINUITY-REVIEW.md).

## Operating limits and status

Migration and explicit synthetic seeding set READ COMMITTED themselves, with real higher-default entrypoint tests. Use READ COMMITTED for other guarded authority changes and retry an entire transaction after a deadlock or lock timeout. A retry never bypasses `last_admin` or historical foreign-key protection. For planned owner lifecycle work, acquire affected organisation advisory locks in sorted order before identity rows. Referenced identities remain undeletable while historical records need them; deactivation requires replacements in every affected organisation.

External identity-provider availability, human availability and emergency recovery are outside this database invariant. Invalid legacy organisations need separately authorised remediation; this checkpoint grants no recovery bypass. It adds no identity-management route or runtime deletion privilege.

[Specification](../spec-20-6-admin-continuity-safeguard.md) and [approved owner decision](ADMIN-EXPIRY-OWNER-DECISION.md) define this follow-up. Stories 20.6/21.1 retain owner acceptance; subsequent stories remain backlog. No merge, deployment, cloud spending or next batch was performed.
