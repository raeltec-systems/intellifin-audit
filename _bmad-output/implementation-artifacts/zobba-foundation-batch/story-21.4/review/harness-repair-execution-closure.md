# Story 21.4 H1–H4 focused execution closure

Result: H1–H4 are closed for the focused repaired invocation. `repair-harness-focused-3.log` records all five selected cases passing in 1.1 minutes with `--workers=1 --retries=0`; its exit receipt is `0`. No remaining concrete harness defect was found after reconciling the executed sources and safe chronology artifacts. The full 145-case invocation and final combined verification reconciliation remain pending and are not closed by this report.

This is a separate supplement to `harness-repair-source-review.md`, which remains unchanged. The earlier source-only review did not establish that H2 could execute successfully: focused attempts 1 and 2 exposed the additional harness defects recorded below. This report supersedes its pending-execution status and its original H2 source hash only for the bounded focused repair closure described here.

## Preserved attempts and the final H2 repair

| Invocation | Observed result | Closure significance |
| --- | --- | --- |
| `repair-harness-focused-1.log/.exit` | 4 passed, 1 failed; exit 1 | H2 timed out at `locator.evaluate` while waiting for exact accessible name `All engagements`, before focusing or expiring membership. App actually renders `← All engagements`. This is failed evidence, retained as such. |
| `repair-harness-focused-2.log/.exit` | 4 passed, 1 failed; exit 1 | With the accessible name corrected, H2 reached the marked/focused control and failed at the synchronous membership-expiry `runtime.sql` call with `Synthetic browser database mutation failed`. No SQLSTATE or detailed cause was captured. This is also retained failed evidence. |
| `repair-harness-focused-3.log/.exit` | 5 passed; exit 0; 1.1m; zero retries | All H1–H4 cases completed on the final reconciled sources. |

The exact locator now matches `App.tsx:299`. The three existing authority mutations in this H2 case now await the existing `sqlAsync`, with identical SQL and unchanged disposable-target guards and child-process deadlines. This follows the existing explicit `CLAUDE.md:263–266` instruction to await asynchronous admin SQL when authority locks can contend: blocking Node can prevent the fixture proxy from forwarding an API commit. That documented failure mechanism justifies the repair; the generic focused-2 exception alone does **not** prove a particular SQLSTATE or identify the precise lock holder. No such cause is claimed here.

The final H2 source retains the original role-demotion, focused-node withdrawal, current-heading focus, session expiry, retained cookie and real 401 checks. Its added safe chronology contains only phase/event/path/status, and its final confirmation entries occur after those assertions. No timeout, recovery allowance, count or visibility expectation was relaxed.

## Exact-source reconciliation

Baseline remains `d38e1daed736415ef13e7606345dac71bd1d9f01`. Independently compared the full `files` maps in these three manifests; all 245 path/hash entries are identical:

| Manifest | Observation time UTC | SHA256 |
| --- | --- | --- |
| `source-repair-h2-async-final.json` | `2026-10-02T20:36:53.512976+00:00` | `ec1c99fc01dbd5878600396dab577ae78fb00796c7b75b40cc7ec97597aa5e23` |
| `repair-harness-focused-3-source-before.json` | `2026-10-02T20:37:18.303214+00:00` | `bd1f8d567008112426c3d2d123c08f3761ec06d50bc037916cd1cdf794d714cb` |
| `repair-harness-focused-3-source-after.json` | `2026-10-02T20:38:28.074468+00:00` | `213d644987330fcfb32d3e3f04ce4447966b0b584c3be3b3f4d38c801988efab` |

Current hashes for all five assigned browser files and eight previously inspected contract files also match all three manifests. The four non-H2 browser sources are unchanged from the source review; final H2 is the independently inspected locator/async-SQL/chronology version:

| Source | Final SHA256 |
| --- | --- |
| `zobba/web/tests/browser/account-binding.spec.ts` | `9be947cc7a7127d9ef59f21073fd2985cfc66968b82d246eb08c705ef11d8f64` |
| `zobba/web/tests/browser/auth.spec.ts` | `3fae064f9271148a12bdbb5884f6366204b7b495e964ec5835bd5228257c3b21` |
| `zobba/web/tests/browser/conversation-review.spec.ts` | `3a07a514116e7ae2526e06dcaa5d30028a22c940c4f5b3cb459ef522907c045a` |
| `zobba/web/tests/browser/methodology.spec.ts` | `c4361d77a37cb373f118a200bd3d8222b669e8bfb0bb048f8cbb0168c5064430` |
| `zobba/web/tests/browser/auth-runtime.ts` | `57e8cb31c114958ade33d69f9243333146f4447bc0295dd08bb7bf6da0bfceef` |

The matching current contract hashes for App, auth, membership, skills, useSkillInspection, MethodologyWorkspace and methodology are unchanged from the original source review. `knowledge.ts` now has SHA256 `144c44f13c174b2373a2048e99af7c03553d353a6540c3b6678447124faac317`, also matching all three manifests. Its relevant `readPreference` chain was re-read at current lines 138–141: actual preference read → actual revision verification → bound `verifyMembershipSession`, unchanged in the H1 contract. This reconciliation does not duplicate the separate review of broader knowledge/public-capture changes.

## H1 — actual bound/unbound chronology

Both H1 cases passed. Read the standalone safe artifacts directly:

- `repair-harness-focused-3-results/account-binding-conversati-ba49c-one-bounded-recovery-budget/conversation-recovery-chronology.json`
- `repair-harness-focused-3-results/account-binding-an-engagem-f5043-the-same-recovery-allowance/mixed-recovery-chronology.json`

The first chronology has 23 ordered entries. Initial preference verification is held at sequence 1, delivered at 2 and its session postcheck completes at 3. Fault injection then records exactly two unbound App session requests (4 and 10), two successful scope reads (7 and 13) and two actual injected conversation 412 responses (9 and 15). Explicit recovery alone produces the third unbound session request (16). Its impact bound check is request 18/response 20; the recovered preference verifier remains held at 19, is delivered at 21 and only then performs its separately counted bound check at 22/23. Final counters in that request are `sessionReads=3`, `boundVerifications=1`, `preferenceVerifications=1`. The passing exact-source test additionally establishes unchanged zero-command, private-workspace/textarea withdrawal, lifecycle budget and empty-recovered-draft assertions.

The mixed chronology has 35 ordered entries. The preference check is delivered at sequence 7 while impact remains held; impact's bound postcheck completes at 11. The ordinary non-injected conversation response at 13 is 200. The first unbound App session request is 15, followed by the actual engagement-list 412 at 22; the second is 23, followed by a successful list/scope and the injected conversation 412 at 33. Before and after cleanup, the recorded counters are exactly two unbound session reads, one impact bound read, one preference bound read, one scope read, two refusals split one engagement/one conversation, one ordinary conversation read and zero Task command POSTs. The passing test also requires the protected workspace absent. These observations distinguish successful bound projection checks from the unchanged one-recovery App budget; they do not merely accept an increased total count.

## H2 — actual focus/expiry/withdrawal chronology

`repair-authority-expiry-focus-proof.json` confirms this order:

1. `protected-node-focused-before-expiry`.
2. `membership-expiry-committed`.
3. `window-focus-dispatched`.
4. Actual 403 responses from the scoped conversation and engagement reads, while session/list reads remain 200.
5. `marked-node-withdrawn-and-current-heading-focused`, emitted only after the marked node count is zero and the current Your engagements heading is focused.

Following real authority restoration, the same final case expires the session and records a real session 401 before its final `signed-out-focus-private-scope-withdrawal-and-both-401-refusals-confirmed` entry. That entry follows the assertions for signed-out heading focus, absent prior private scope text, cookie preservation and direct current session/engagement endpoint 401s. The direct API-request responses are not presented as separate page-response events; their verification is established by the executed assertions preceding the confirmation entry.

## H3 — actual transport failure precedes protected-node withdrawal

`repair-conversation-access-fault-proof.json` records the exact scoped snapshot request at 1017ms, completed abort at 1019ms and correlated `requestfailed` at 1028ms with `net::ERR_CONNECTION_RESET`. Fault interception remained installed. The click marker count is 1; Task details, original Pause control and original methodology node counts are all 0. Combined with the passing exact-source test, this closes the required abort-plus-requestfailed precondition before withdrawal assertions while preserving the earlier real inner-DOM/disclosure/focus checks. The cause of the historical predicate miss remains unproven and is not inferred from this success.

## H4 — completed real denial and restored-authority journey

The exact unchanged `methodology.spec.ts` case passed in 38.1 seconds. Its final sequence cannot complete without the actual selected-organisation 403 awaited at lines 329–332. It then verifies the current no-Admin chooser and absent private Package name field, restores authority, re-enters the organisation and requires the New methodology control enabled while Package name and Edit methodology form remain absent. The passing whole case also includes the previously reviewed save, capacity/oversized refusal, frozen exact lost-reply retry, Undo, exact Task template/binding, new-only notice and recall assertions.

No standalone H4 response chronology was supplied or read for this closure. Its actual denial and no-resurrection evidence is the passing, hash-bound test with the explicit real-403 wait and final UI assertions, supported by the unchanged reviewed clearing contract. The test does not substitute a mocked denial or obsolete transient copy.

## Receipt/artifact SHA256

All paths below are under `/tmp/zobba-story-21-4/`.

| Artifact | SHA256 |
| --- | --- |
| `repair-harness-focused-1.log` | `5c3e1d710302c54a4707c3daa1f37ebe6b8a68672394aeacd8bc4122234fcad3` |
| `repair-harness-focused-1.exit` | `4355a46b19d348dc2f57c046f8ef63d4538ebb936000f3c9ee954a27460dd865` |
| `repair-harness-focused-2.log` | `4bdd9e3afcdfab2aaeb15134d86bc62d66e8955e5cec2b386ccb409535c5f09d` |
| `repair-harness-focused-2.exit` | `4355a46b19d348dc2f57c046f8ef63d4538ebb936000f3c9ee954a27460dd865` |
| `repair-harness-focused-3.log` | `8e8a766740b2688da1ce79c4762139099aac7e6b6534f731ed2ef635d9a2db1f` |
| `repair-harness-focused-3.exit` | `9a271f2a916b0b6ee6cecb2426f0b3206ef074578be55d9bc94f6f3fe3ab86aa` |
| `repair-authority-expiry-focus-proof.json` | `ec6650094778a292369f1c1a1f7d56b0edc4e77aa7d4638bef2469458be6bfbf` |
| `repair-conversation-access-fault-proof.json` | `128379bae87c070eac487250f23d7ad7aa86622a73439efa982e64060bfd1b6a` |
| First H1 `conversation-recovery-chronology.json` at the full path above | `f81120dbcc4b1abc902040bb9d1e0816e50a7d372463429a6a9e31291fb47528` |
| Mixed H1 `mixed-recovery-chronology.json` at the full path above | `3d51911c5a1b522e23c871720f1db66f6b1c61c15aa6c18e5a8e3ff90aa254c4` |

Only authorized logs, source manifests, safe extracted/standalone proof artifacts and source files were read. No private raw reporter, trace or environment material was opened; no tests/builds/services or application mutations were run by this reviewer. The lead remains responsible for the running full suite and final combined receipt/source reconciliation.
