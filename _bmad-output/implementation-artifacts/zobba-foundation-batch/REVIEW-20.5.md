# Story 20.5 independent review

Baseline: `adaa83a83ea0c1be462f866f127525417b2e0be1`.
Contract: [20.5 specification](../spec-20-5-standing-permissions.md).

Three fresh, context-free reviewers at the session's model capability reviewed
the full tracked and untracked change: blind review, edge cases and verification
gaps. All were launched before collection; root collected all three final results
before consolidating the repairs with the original implementation lead. Nothing
was staged for review.

Initial full-diff SHA-256:
`6d288e8b39c545f6ae1d7201434e184f851da904ed5725333bd5a387b1de7a3f`.

The first combined run passed 111 Rust tests, 56 Chromium tests, 78 web tests,
46 identity-fixture tests and 47 Python guards, plus formatting, Clippy, builds,
boundaries and process smoke. Those results precede review repairs and are not
final checkpoint acceptance.

## Accepted implementation repairs

All findings below are patches within the existing exact-authority, current
claim, attributable decision and factual recovery contract. No product intent,
published schema prefix or next-story scope changes are required. Duplicate
reports of the same recovery and pagination defects were consolidated.

| Finding | Consequence | Required repair and regression |
|---|---|---|
| Task row validation omits exact producing claim | High: an abandoned same-owner producer can dispatch | Check claim state and full producer binding; test same-owner replacement and forged bindings |
| Delegation revision authorizes only its proposed parent | High: another Task owner can replace a victim's delegation | Authorize existing ownership and proposed lineage; test separate accountable actors |
| Task policy revision drops accepted authority snapshot | High: ordinary narrowing prevents all future admissions | Preserve accepted upper bound; test new admissions after ordinary narrow/broad revisions |
| Reconciliation leaves active work permanently waiting | High: confirmed source absence cannot obtain a fresh retry basis | Reconcile active state under current Task fences; test coordination before source response |
| Terminal receipt preceding first Stop/Pause coordination leaves Pending | High: Continue/Resume remains blocked despite factual cessation | Handle both receipt/coordination orders without restarting paused/stopped work |
| Every recovery poll consumes another permanent producer slot | High: repeated unknown responses exhaust observation capacity | Reuse bounded custody with fresh lookup authority; observe completion after more than 32 polls |
| Unresolved discovery exposes only the first 50 attempts | High: later effects cannot be reconciled | Bounded cursor traversal with more than 50 unresolved attempts |
| Recovery source is not durably bound | High: another endpoint can falsely declare original effects absent | Bind source identity and refuse a different source; qualify two actual endpoints |
| Source lookup checks operation completion before attempt absence | High: an old absent attempt acquires a contradictory result | Preserve attempt tombstones after a later attempt completes |
| Only submitted resource-version substitutions are checked | High: unchanged approval can act on a changed source resource | Atomic expected-version source precondition and stale-resource zero-effect test |
| Attachment classification comes from the proposal | High: a mislabeled attachment can appear covered | Validate immutable attachment metadata through the trusted qualification boundary |
| Safe read seam omits persisted decisions and attempt facts | Medium: reload cannot explain approval or observed outcome | Bounded authenticated history, fresh audience checks and secret exclusions |
| Expiry is checked before potentially stalled consumption writes | High: an expired operation can acquire dispatch custody | Final time check with a deterministic expiry-crossing transaction regression |
| Refusal tests only conflict with an earlier allow key | High regression gap: fresh human refusal is unproven | Persist fresh refusal; assert no attempt or source send |
| Source identity comparisons have no negative response tests | High regression gap: unrelated terminal response can appear valid | Independently mismatch operation, attempt and fingerprint over real HTTP |
| Shared policy tests do not cross repository engagement scopes | High regression gap: global revocation may become local | Change organisation/member/account policy in one engagement and consume in another |
| Invalid UTF-8 path returns plain text | Medium: documented typed error contract breaks | Map path rejection to sanitized JSON 400 and exercise real HTTP |

## Final disposition

All accepted findings are repaired. The final executed gates are recorded in
[the implementation evidence](../story-20-5-implementation-evidence.md).

The verification reviewer independently inspected the Task repair and found one
additional ordering: both the external absence and inert-child completion can
arrive before the first coordination. Root repaired that order and added it to
the regression matrix. The same reviewer rechecked the change and found no
further concrete issue in that repair; this was source inspection, not an
executed test claim.

The reviewer subsequently inspected the repaired domain/application contracts,
operation store, Task fences, source/material authority, history and recovery
against the full matrix and canonical Story 20.5. No concrete remaining defect
was found in that core-library inspection.

The final independent pass inspected the gateway, actual HTTP source, API and
regression assertions. It found no remaining concrete defect or verification gap.
The reviewer checked that fresh refusal, mismatched source responses and shared
policy revisions now have direct assertions, and that the delayed-write expiry
tests demand exact refusal errors and zero persisted attempts rather than passing
on a generic timeout. All 19 relevant source entries matched the frozen manifest.
Root owns the complete executed verification; the reviewer did not claim to have
run those tests.

The final combined run then caught a retained Task regression: an inert receipt
had already established the final state and emitted `observed`, but the new
reconciliation block recorded that same transition again. Root guarded the final
update/event on an actual state or cessation change. Both the implementation lead
and verification reviewer independently inspected this repair. The reviewer found
no defect and confirmed the external-only completion/absence and Pause/Stop
orders remain intact. The retained Task target and new operations matrix passed
together (eight tests); the full Rust and affected process/browser gates were
restarted against the repaired source. Their final results, not the failed
intermediate run, determine checkpoint acceptance.

A subsequent browser run caught a timing-sensitive retained test assertion. It
required a scope-withdrawal notice to remain visible after a replacement-account
refresh. `App.tsx` deliberately clears that optional notice on the next successful
refresh, after withdrawing the old scope. The captured failure showed the correct
replacement identity and allowed chooser. Root changed only the test to assert
that stable identity/chooser and absence of old protected content; the exact old
outbox equality, no-replay, empty replacement history and durable 403 assertions
remain unchanged. Independent review checked the concrete patch against App
refresh behavior and found no defect or masked authorization failure. Production
source did not change. Focused repeated and full browser results are recorded
with the final evidence.

During focused verification, two synthetic fixture mistakes were corrected. The
policy-expiry request initially exceeded its policy's allowed lifetime, so correct
admission refused before the intended barrier. Its request now fits the policy,
the owner lease crosses a bounded deadline, and every case asserts the expected
error. The delegation ownership proof temporarily assigned a second auditor and
initially left that assignment in place; the fixture now removes only its added
membership and assignment before retained negative-audience checks. The final
operations target passed all five tests, including the complete new Task,
policy and cutoff matrices. No production authority check was relaxed.

History pagination uses 51 real decisions and actual lost-acknowledgement/source
facts. Additional guarded attempt/observation metadata rows exercise page
cardinality; that fixture is explicitly distinguished from actual external
effects. Actual gateway crash, effect, lookup and replay assertions run against
the owned HTTP source.
