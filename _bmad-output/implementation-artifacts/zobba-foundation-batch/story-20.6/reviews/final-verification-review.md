# Story 20.6 final verification-gap review

**Result: VG-4 is closed. The five second-repair claims have meaningful regressions. No remaining verification gap was found in this review's scope.**

This independent review read the Story 20.6 specification, the previous verification repair report, the complete frozen-diff inventory, and the relevant production and regression source. It made no source changes and ran no database, browser, or fixture tests, as the implementation lead owns the final combined run. The reported restricted-database 3/3 and membership-browser 16/16 results are not presented as runs performed by this reviewer. Final combined checks remain a checkpoint condition.

## Source identity

- Frozen manifest: `second-repair-freeze.json`, 158 files, SHA256 `e2a38cc6a4825ce470c366c5e3e45df9e6eb06b3a56408cc274c505b279f9d1e`.
- Complete diff: `second-repair-freeze.diff`, SHA256 `9d9a69065e3ca953843ac1115c4b4a93d72b8edb998508ab612c997286cb1521`.
- All 158 working-source hashes matched both before and after inspection. The diff and manifest digests matched the requested identities.

Paths below are relative to `/workspace/intellifin-audit`.

## Dispositions

### VG-4 — Closed: explicit Remove fences only the selected live execution scope

`zobba/crates/infrastructure/tests/membership/renewal_and_remove.rs:173` creates two real Tasks with admitted claims for the same member in different engagements. Both have valid stored delegation heads rooted in their Tasks; the delegation editor is a different Admin (`membership/revocation.rs:132`), so the ancestry condition is exercised rather than merely matching the member as the last editor.

The Save at `renewal_and_remove.rs:202` changes only assignment mode/selection to Remove: roles remain Auditor, membership remains active, and membership expiry remains null. Consequently the all-scopes narrowing predicate cannot mask a broken Remove selector. The test then proves:

- Removed scope access refuses; its execution epoch advances, Task becomes paused, unused claim becomes abandoned, and delegation is revoked (`:205–217`).
- The preserved Task's entire stored row and delegation document remain equal to their captured values; its claim remains admitted (`:218–229`).
- The preserved claim is actually consumed and its basis is current (`:230–231`), rather than merely asserting assignment metadata.
- After explicit regrant, consuming the removed old basis still returns `TaskError::Fenced`, its coordinator returns Idle, and its old delegation remains revoked (`:234–256`).
- The preserved Task and delegation remain unchanged through regrant, and a real observation is accepted into its receipt custody (`:257–271`).

This directly closes the previous counterexamples: selecting all active scopes would fail preserved-row/claim/delegation assertions and successful consumption; selecting no scopes would fail removed epoch/state/claim/delegation assertions. These are source-based counterfactual checks, not a claim that mutation testing was run.

The helper is registered and reached: `membership.rs:141` calls `revocation::verify`, and `membership/revocation.rs:497` calls `renewal_and_remove::verify`. It is part of the ordinary explicitly guarded PostgreSQL membership test, not an ignored or disconnected helper.

### Expiry-crossing and per-assignment renewal — Closed

The storage test at `renewal_and_remove.rs:16` loads an assignment while it has a future expiry, waits for the actual PostgreSQL clock to cross that timestamp without changing the version or fixture state, then saves an unrelated role addition with the retained assignment. It checks the exact stored expiry is preserved, scope access refuses, the claim is abandoned, and delegation is revoked (`:111–123`). An explicit later renewal restores current scope access while the old claim and delegation remain fenced (`:125–164`). Exact retry returns the same receipt without changing the immutable event or Task; changing renewal intent under the same key conflicts (`:139–169`). Omitted and explicit false defaults are also sent directly through the callable runtime SQL function and must recover the identical historical receipt without rewriting its event (`:73–109`).

The real-browser test at `zobba/web/tests/browser/membership.spec.ts:541` opens a checked assignment before its expiry, verifies that real time crosses the boundary, refreshes while retaining the open draft, and saves. It asserts the request's `renew:false`, the exact stored expiry, and absence of effective access. Reopening a later draft makes the expired scope unselected; explicitly selecting it produces `renew:true` only for that scope and a stored null expiry (`:560–569`). The multi-page test separately checks the full per-scope renewal map (`:465–467`). These tests match the actual form timing defect.

The contract tests at `zobba/crates/api/tests/membership_contract.rs:85` verify an optional Boolean scoped to each assignment, canonical false, rejection of wrong JSON types/global renewal, and the existing 32 KiB request bound. Actual HTTP lost-acknowledgement retries at `membership_http.rs:415–459` verify omitted/false equality, changed true conflict, and rejection of Remove plus renewal. The separate command DTO is not exposed as invitation or read metadata.

### Tuple pagination completeness — Closed

`zobba/crates/infrastructure/tests/membership/legacy_upgrade.rs:342` creates the exact prefix-adjacent case: 50 assignments under client `a` and 51 under `a-`. It traverses the real repository pages, asserts both cursor boundaries, and compares the entire ordered vector to the independently constructed 101-item expected set (`:385–388`). It then submits every observed assignment for removal in bounded chunks and proves the correct remaining client/count and ultimately zero active rows (`:390–417`). The earlier mixed ordering would omit/duplicate an item and fail the vector/cursor assertions. Production aggregation, predicate and LIMIT ordering now use the same `(client_id, engagement_id)` tuple (`0005_membership_administration.sql:134–138`).

### Legacy 101→100 editor transition — Closed

The browser test at `membership.spec.ts:511` opens an incomplete 101-assignment draft while a future expiry is still valid. It establishes that the last active assignment is outside the opening projection, waits for actual expiry, and refreshes to a complete 100-assignment projection with the same organisation version. It then proves the original editor remains in its existing-assignment mode and retains the role edit; the outgoing Save is Preserve with an empty assignment array. After Save, the full expected 100 active assignment IDs match, including the previously unseen assignment, while the expired row retains its exact expiry (`:527–538`). This would fail if fresh props silently switched the open editor to Replace. Production completeness and original-selection baselines are captured with the draft (`MembershipWorkspace.tsx:149–165`).

### Invitation fragment during or after sign-out — Closed

The real-browser test at `membership.spec.ts:385` starts from a genuinely verified invitation and intercepts the logout request before submission, leaving the real session valid. It adds same-document fragments while logout is pending, after acknowledgement failure, and after successful retry. Each fragment is scrubbed; private invitation terms and Accept remain absent. Pending feedback, uncertain sign-out retry, and completed Sign in guidance each remain usable in their respective states. It also asserts no new session read or invitation preview from these fragment events, verifies eventual server 401, and verifies no recipient membership was created (`:404–430`). This covers both the reported completed-logout blank main view and the requirement not to cancel pending/uncertain sign-out intent. Production hash handling preserves those sign-out views while clearing the fragment and private mutation state (`MembershipWorkspace.tsx:412–422`).

## Review limits

This is a focused independent verification review of the second repair. It closes the prior VG-4 gap and assesses the newly added regression claims; it does not replace the implementation lead's final combined suite, root's source/capture evidence, or the separately reviewed guarded development-database repair. No new blocker or scope expansion is requested.


## R1 follow-up — Closed: expiry inside Save is forced at the actual write boundary

This follow-up reviewed the independently reported clock split, the six changed paths, and the new `zobba/crates/infrastructure/tests/membership/expiry_split.rs` source. The R1 manifest contains 159 files and matched before and after review: SHA256 `fd4774a7735e7ab0473d5d99418883009b23903b47ff75e3042a82543f766744`; complete diff SHA256 `33a2368b2df219c17a66963495368549d166f5949fd2ba77e135040f6493bfef`. This remains a read-only source/verification review: no database or fixture runs were performed by this reviewer. The reported focused 3/3 pass is lead-owned; final combined checks remain required.

**The regression forces the actual vulnerable interval.** At `expiry_split.rs:124`, a fixture-only BEFORE UPDATE trigger on `organisation_memberships` waits on advisory lock `(206,919)`. The unchanged production `membership_write` ordering calls `membership_fence` before reaching that UPDATE (`0005_membership_administration.sql:234–235`), and assignment UPSERT follows it. The test holds the advisory lock in a separate transaction, submits the real repository Save, and observes a `membership_write` backend blocked specifically by that transaction's PID (`expiry_split.rs:169–196`). It then asserts that the database clock is still before expiry. Only after the same database clock crosses expiry does it release the barrier (`:197–208`). This proves expiry follows fence classification and precedes the authority write; it is not a pre-expired fixture or a sleep placed before Save. The tests extend the two worker leases to 60 seconds (`:138–139`) so lease timeout cannot supply the expected refusal accidentally.

The three gated cases are distinct:

- **Finite assignment renewal:** `renew:true` is set only on the expiring selected assignment; organisation expiry and roles do not change (`:154–168`). After the gated Save, the stored assignment expiry is null, current scope access succeeds, but the old Task epoch advanced, its state is paused, its claim is abandoned, delegation is revoked, and old claim consumption refuses (`:210–227`). The other engagement's entire Task row and delegation document remain equal, its claim remains admitted, and it can actually be consumed and observed (`:228–238`). Reverting to the former clock-only scope selector would miss this fence and fail these durable assertions.
- **Finite membership made unlimited:** Both assignments use `renew:false`; the old finite organisation deadline is replaced with null. Both engagements' old execution epochs, claims, and delegations must be fenced even though current member access is restored (`:239–253`).
- **Finite membership extended to a later deadline:** The same checks run independently with new expiry `old expiry + 3600`. The test asserts the exact stored result. Thus the fix is not verified only for removing the time limit. Reverting the newly added finite-widening classification would fail these two cases because the original deadline is proven future at classification.

Each gated case also retries the exact command and compares the original receipt and entire immutable event, then checks that the Task row does not advance again (`:255–275`).

**The countercases constrain conservative fencing.** At `expiry_split.rs:40–69`, both assignment and organisation have future finite expiries; an ordinary Save retains the same organisation expiry and `renew:false`. The whole Task row and delegation document remain unchanged, the claim stays admitted, and real consumption/observation succeeds. At `:71–120`, explicitly renewing a still-future finite assignment deliberately fences only that scope even though its stored future expiry is preserved; the other scope's Task/delegation remain unchanged and its claim can be consumed. These checks guard against changing the repair into indiscriminate fencing of every finite assignment or every unchanged membership Save.

The new helper is compiled and invoked by the ordinary guarded membership regression through `membership/revocation.rs:20` and `:500`. Its fixture trigger/function are removed at the end (`expiry_split.rs:278`). Production documentation describes the deliberately conservative future-finite renewal behaviour (`zobba/README.md:75–80`). No further R1 verification gap was found.
