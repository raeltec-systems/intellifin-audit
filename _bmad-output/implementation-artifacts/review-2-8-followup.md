# Story 2.8 — independent repair follow-up

Date: 2026-09-05. Capture: `story28-followup.diff`, 281,095 bytes, SHA-256 `bd4cf7fea98d73fd5e51932afe9aa0daabca4c6ef4c008d099d0f0865727b31a`. Reviewer also inspected the subsequent timestamp/corruption-fixture corrections, history navigation spacing and unused-import removal.

**Conclusion: all twelve repairs resolved at source-review level; no actionable residual defect found.** The reviewer made no edits and ran no tests. Subsequent coordinator-observed full gates passed 1,950 unit, 209 integration and 96 browser tests, plus types, boundaries, migration/no drift and package/production builds.

| Claim | Resolution evidence |
|---|---|
| P1 | Direct selected-version/ownership reads, newest-Draft lookup and keyset history; integration covers 102 versions, browser creates/opens v104 and accesses older history. |
| P2 | Transaction role recheck after the shared lock; blocked revocation test asserts no Draft/job and one audited denial. |
| P3 | SQL filters affected identities before strict conversion; both kinds test unrelated corruption succeeding and affected corruption refusing. |
| P4 | Model-only publication under prompt 1/interpreter v1; unsupported kinds/contracts refused. |
| P5 | New creation reads publication in its transaction and queues that model/revision; stale process dependency test checks stored identity and job digest. |
| P6 | Strict unknown-input schema precedes property/transaction access; malformed inputs cannot open a transaction. |
| P7 | Complete publication identity checked; current pointer carries actual revision; tuple no-op advances current identity, historical replay does not reset it. |
| P8 | Both routes independently resolve recorded activated succession; browser checks Retired predecessor text and history; unloaded data has distinct wording. |
| P9 | Allowlisted telemetry records trusted correlation and returns unknown outcome; action test checks capture. |
| P10 | Synchronous ref guard, duplicate closure proof, and browser loss of committed response with exactly one POST/version and blocked retry. |
| P11 | Controlled Sunday activation persists exact Monday midnight in lifecycle and succession; browser checks stored recurring boundary. |
| P12 | Both owner changes assert exact new snapshot, unchanged predecessor/opposite/unrelated snapshots, then actual queued derivation's compiled inputs. |

The reviewer concluded that the added tests would detect the original twelve failures. Focused runtime checks subsequently reported 26 unit and 17 integration tests passing. Final full-suite results are recorded in the specification and delivery report when complete.

Coordinator incremental review: the focused browser reached the correct Builder (successful POST plus cold GET) after its 10-second URL assertion expired. Only the two New version URL waits changed to a bounded 30 seconds; the single action, version/heading and database assertions, and overall 180-second test limit remain. Inspected both current assertions; this does not alter product behavior or introduce action retries. Fresh browser verification is still required.

The subsequent focused run passed auth, forms, selected Builder, activation and both Retired surfaces, then its history fixture hit the existing plan-consistency constraint. Coordinator inspected the narrow correction: cloned succeeded-plan rows now include `planInputDigest: planAuthoringDigest(base)`, matching their unchanged authored inputs. Version identity/number changes do not alter those inputs. No product code changed; the history/response-loss browser assertions still require a fresh passing run.

The next run reached v104 and the committed-response-loss message. Its generic alert selector also matched Next's route announcer. Coordinator reviewed scoping that assertion to the application main region; the reload text, disabled retry, one request, saved v105 and post-reload recovery assertions remain. This is a test selector correction, not weakened product behavior.
