# Story 21.3 account-binding harness closure — freeze 8

Independent bounded review by `story_21_3_repair_ui_review`, 2026-10-02. No remaining finding in the released account-binding harness delta. The complete nine-case file passed on freeze 8. The final combined 123-case gate remains separately owned by root and pending; this report does not claim that gate passed.

Review was read-only apart from this report. I did not run tests, builds, services, database commands, or change application/test source. I inspected the released diff, actual source, supplied execution receipts and request chronology, and recomputed hashes. Earlier UI source and closure reports remain unchanged.

## Source correspondence

`repair-1/source-freeze-8.json` contains 221 files, observed at `2026-10-02T16:01:11.759604+00:00`. I compared its full file map with freeze 6, freeze 7, focused-9 start/end, and current disk source. The only file changed from freeze 6 is `zobba/web/tests/browser/account-binding.spec.ts`; product, backend, generated source and other tests are unchanged. Both focused-9 boundary maps and current disk source match all 221 freeze-8 hashes.

I verified the reconstructed freeze-6 account-binding file against its recorded hash, then replayed `account-binding-final-gates.diff` in memory. The result exactly matches released freeze 8. This independently confirms that the displayed diff is the executed source delta.

| Artifact | SHA-256 |
| --- | --- |
| Current `zobba/web/tests/browser/account-binding.spec.ts` | `a8a878b6767679d6066fe17b879a3dd51146657eb49d170d7649b818ebd47331` |
| `repair-1/account-binding-freeze-6.spec.ts` | `e2ceef4812c225808c72dfd4aa6d4ceb0435a74cbf3e9e545869a9a0906b9fca` |
| Intermediate freeze-7 account-binding source | `24cc6a0d889d6c4352f1f80968b34ce90e9f39790802eb798054c391a8ae393f` |
| `repair-1/account-binding-final-gates.diff` | `42e92886c2470c45bd6d423931a4338429d672477f4e24c97e725836acdbe0ff` |
| `repair-1/source-freeze-8.json` | `b297426838c1923bd02c5e5d10e1337e38a51ef8af7bfa1efec75fd3996255ca` |
| `repair-1/browser-focused-9.log` | `1c52879fc0f4af148fe66841f84d35a2318664f30d83939750e5ef4bc687f9d7` |
| Focused-9 `mixed-recovery-chronology.json` | `39d7e292b373f922728ec3d64ff1234b8689305c376e05f4aebb1fe3542e61ff` |

## Closed harness issues and preserved assertions

1. **App recovery gates distinguish bound projection verification.** The first, second, fifth and sixth cases settle the initial affected-skills projection, and their `/auth/session` handlers bypass requests carrying `x-expected-session` before holding or rotating an App bootstrap reply (`account-binding.spec.ts:60`, `:76`, `:126`, `:134`, `:193`, `:198`, `:216`, `:234`). The ninth case explicitly handles and counts a genuine bound postcheck separately (`:344`). Header presence is classified; no session-header value is logged. This restores the intended App-only injection boundary without hiding those real projection reads.

2. **The original privacy and recovery checks remain.** Case 1 still creates a real uncertain UI request, preserves the exact saved actor-A outbox, observes visible DOM mutations through same-engagement actor replacement, requires zero old identity/draft/recovery disclosure, blank replacement editor, no visible pending request and no task POST. Case 2 retains the same editor DOM marker, exact draft, focus and selection `[5, 12]` after same-actor session rotation. Case 5 retains exactly two App session reads, two real engagement refusals, zero POSTs and complete private-workspace/textarea withdrawal. Case 6 retains an actual held event poll, replacement-cookie mismatch, hidden old identity/workspace before recovery, then the manager identity and blank draft. Protected-GET replacement-cookie and mutation/control/logout CSRF cases are unchanged.

3. **Pre-injection conversation responses no longer count as injected refusals.** Freeze 7 still asserted every intercepted conversation response was `412` from route installation. An ordinary snapshot before the scoped fault rotation can legitimately be `200`. Freeze 8 arms only after the actual scoped response returns `200` and the fixture rotation completes, then captures that armed state at handler entry before `route.fetch` (`:269–283`, `:368–385`). Only requests entering after injection must return and count `412`. An earlier in-flight request cannot be reclassified by a later rotation. Case 7 still requires exactly two App session reads, two scoped reads, two conversation mismatches, no bound postcheck during failure, no task POST and private DOM withdrawal. Focus/pageshow/visibility events cannot replenish the budget; explicit recovery still requires exactly a third App session read, one separate bound verification and blank editor (`:285–305`).

4. **The ninth case now proves both ordering boundaries through real requests.** It holds the initial actual impact response, installs the App fault routes, releases the impact, and waits for the genuine bound session `200` without consuming any App read, scope read or refusal. It then clicks the real `Latest messages` UI and requires a successful ordinary conversation snapshot through the same route before `Refresh access` (`:387–396`). `ConversationWorkspace.tsx:259` calls `resync`; `conversation-state.ts:234` resets the projection watermark and invokes polling, which requests a snapshot. This is explicit UI resync evidence, not a claim that the two-second timer always causes a snapshot. After explicit access refresh, the assertions remain exactly two App reads, one scoped read, one engagement `412`, one conversation `412`, one bound verification, no task POST and protected-workspace withdrawal (`:397–403`). There are still nine cases; no skip, timeout increase, weakened exact count or added retry appears in the released diff.

5. **Cleanup and failure propagation remain visible.** Cases 1, 2 and 6 release held gates before `unrouteAll({ behavior: 'wait' })`, with replacement-page closure in a nested `finally`. Case 5 also drains routes in `finally`. The ninth case releases its impact gate, drains routes, then writes bounded sanitized chronology in `finally` (`:404–415`). Route assertions and cleanup failures are not caught and ignored. Chronology records at most 200 categorized events containing phases, statuses, header presence and counts, without query strings, cookies, header values or response bodies. The prior negative run's assertion and secondary closed-page cleanup error are preserved as failures; this report does not portray that cleanup as a clean run.

## Execution receipts inspected

All paths below are beneath `/tmp/zobba-story-21-3/repair-1/`.

- **Controlled negative proof:** `browser-focused-7b.log`, `.exit` and `browser-focused-7b-results/account-binding-an-engagem-f5043-the-same-recovery-allowance/mixed-recovery-chronology.json`. Exit 1, one failed case. The held initial impact triggers a real bound session `200`, which the old all-session counter incorrectly consumes as its first read and rotates before explicit Refresh. The following App sequence sees engagement `200`, conversation `412`, then a legitimate next recovery conversation `200` that fails the old assertion. End counts are three all-session reads, two scope reads and one refusal. A secondary closed-page cleanup error is also reported. This proves the classifier defect under that controlled order; it does not establish the exact request order of the original interrupted full-suite failure.
- **Intermediate classifier release:** `browser-focused-8.log` and `.exit`: all nine cases passed in 55.7 seconds, exit 0, one worker and zero retries. Both boundary maps match freeze 7. This receipt is retained as an intermediate pass; source review subsequently identified and corrected the pre-injection conversation assertion dependency.
- **Final complete account-binding file:** `browser-focused-9.log` and `.exit`: all nine cases passed in 48.2 seconds, exit 0, one worker and zero retries. Individual cases passed in 7.9, 5.1, 3.8, 4.1, 2.8, 8.2, 3.1, 2.7 and 4.3 seconds. No failed or skipped case is reported. `source-browser-focused-9-start.json` and `source-browser-focused-9-end.json` match freeze 8 exactly.
- **Final chronology:** `browser-focused-9-results/account-binding-an-engagem-f5043-the-same-recovery-allowance/mixed-recovery-chronology.json` records bound postcheck `200` first; ordinary conversation `200` with `injected: false`; then explicit Refresh, two unbound App session reads, engagement `412`, one scoped `200` with rotation and conversation `412` with `injected: true`. Cleanup before/after counts remain two App reads, one bound verification, one scope read, two total refusals comprising one engagement and one conversation mismatch, one ordinary conversation read and zero task POSTs.
- **Static receipt:** `web-typecheck-final-8.exit` is 0 and its log is empty. Earlier product/static gate results remain those documented in the preceding supplemental report; this test-only review does not claim a fresh full static suite.

## Scope limits and prior records

The controlled negative proof and deterministic final positive chronology validate the harness boundaries. They do not reconstruct the initial full-suite failure or prove every possible network schedule. No separate negative execution removing only the final conversation phase guard is claimed. Source and the real pre-injection `200` prove that retaining the old unconditional `412` assertion would reject this final scenario.

The unchanged product source retains the scope and limitations of the earlier UI closures. The final combined 123-case browser gate remains pending with root; this bounded nine-case pass cannot substitute for it. I recomputed and preserved the prior review hashes:

- `review/repair-ui-source-review.md`: `283ddf7fb3ef6a9e71366954d9d23176180ba01864d9b5bdb9761981dc01febf`.
- `review/repair-ui-closure.md`: `e1eddfc1db7a41ece65bf0c4aa0f4b188d7d4b665482f7d043937f3a32290230`.
- `review/repair-ui-supplemental-closure.md`: `0529519cd2b51be927a77aee8cbe9b2e0b482ab3cdc605c9f235c9be1136321f`.
