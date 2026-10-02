# Independent review: full-browser preference outcome failure

Status: bounded test repair and focused execution closed. The separate full-3 combined run remains pending. This reviewer has not run tests or changed application, test, build, or service state; this is independent source and execution-evidence reconciliation, not an independent test rerun.

## Finding and primary evidence

The BF2 failure is an unsupported alphabetical-order expectation in the browser test. The inspected evidence does not show a product defect or a fixture-order race.

The first 45 lines of the safe `repair-browser-full-2-results/knowledge-private-preferen-5048b-ed-destination-exactly-once/error-context.md` report the exact failing assertion at `web/tests/browser/knowledge.spec.ts:516`: `toHaveText` expected `engagement-a` before the newly created `preference-outcome-…` destination, while the two actual list items contained those exact destinations in reverse order. The locator repeatedly resolved to exactly two items. The timeout was the unchanged 12-second assertion timeout. No private reporter, trace, environment file, or credential was inspected.

The test also makes the same unsupported sorted-array assumption for `first.affected_destinations` on the next line. The failure occurs after the actual first Undo response was captured and lost, the explicit retry returned a fully equal receipt, and the new owner-preference verification was held and released. The failure prevents claiming that this BF2 invocation reached the later remount assertions.

## Contract and source reconciliation

- P9 in `review/root-triage.md` requires successful Undo/withdrawal outcomes, unique affected destinations, current-owner disclosure, and exact receipt recovery without duplicate events. It does not require alphabetical or chronological order.
- `story-21-4-knowledge-context.md`, “Give publication Undo exact semantics,” requires showing affected destinations while retaining history. The frozen preference/Undo/retry rows in the story specification and canonical Story 21.4 add no destination-order requirement.
- `crates/infrastructure/src/knowledge.rs:1767` reads publications ordered by publication ID using C collation. IDs are the publication event's random token (`token()` delegates to `random_secret()`; publication creation uses `result.event_id`). At lines 1771–1779 it withdraws the publications and appends each destination only on its first encounter. This is stable publication-ID traversal order for those stored publications, not destination-name order. The existing comment “first-release order” is imprecise; it must not be cited as proof of chronological ordering.
- `StoredReceipt` retains the destination vector, and exact replay reconstructs that vector unchanged. `web/src/knowledge.ts:114` rejects duplicate destination IDs without sorting. `InspectionPreference.tsx:25` retains that receipt vector and line 72 maps it directly into the displayed list.
- `InspectionPreference.tsx:14–27` keeps retained outcomes in exact-owner custody and requires the owner's next completed verification read before disclosure, including a fresh read on remount. `useSkillInspection` separately fences owner/activation/request identity. The proposed test repair does not alter this code.
- The destination loader retires old choices before I/O and checks current owner and request identity before replacing them. The test's held second destination read, absent stale selector/release control, exact selected destination, accepted publication responses, and current publications remain required.
- `useKnowledgeCommands` retains the immutable pending request before I/O, sends only on explicit `apply`, and prevents a competing request while pending or in flight. Existing full receipt equality and two byte-identical POST assertions remain part of this test. The separate backend regression for 50 real publications checks unique destination reporting, withdrawal, and exact replay.

The earlier `repair-knowledge-focused-2.log` records this case passing in 7.8 seconds within 18 passing cases. That is preserved historical execution, not evidence that the alphabetical assumption was valid. The present diagnosis follows the primary failure and source, not the earlier pass.

## Reviewed bounded repair

Reviewed temporary proposal: `knowledge-preference-receipt-order.patch`, SHA256 `e173150ec394fa04dcc7dc3475566be121a82421e15f8cd9c6da2998e482ceec`.

The proposal checks that the untouched first receipt has exactly two destinations, both unique, and that a sorted copy has precisely the expected membership. The actual DOM must have two list items in the original receipt order. It retains complete equality between the real retry receipt and the first receipt, the held fresh-owner verification fence, exactly two byte-identical submitted bodies, destination reload retirement, and outcome/event recovery after navigation. No product behavior, retry count, timeout, or authority assertion changes are required.

Recommendation: apply this test-only repair after the active run finishes. Also assert the same exact destination list after remount, alongside the retained event ID, to make retained destination recovery explicit. Preserve the failed full run and rerun the focused case plus the required combined browser verification. Do not sort or mutate the original captured receipt; compare a copy for membership.

The frontend owner subsequently supplied a revised temporary proposal, SHA256 `13b4e44dbca855037f83fb3388c26d262889bd51a92ef5fbe59a6b0cd77e6bac` (2,372 bytes). I inspected it independently. It adds exactly the recommended two-item count and original-receipt-order assertion after remount; the existing retained event ID and unchanged POST count remain. This revised proposal is approved at source level. It has not yet been applied or executed as of this addendum.

## Source identity at investigation

| File | SHA256 |
| --- | --- |
| `zobba/web/tests/browser/knowledge.spec.ts` | `d032cfdfee3ac38a12514d82c9cc514d156ee0721195ac29e9df1c6cefed2a94` |
| `zobba/web/src/InspectionPreference.tsx` | `c44ab18bad7225b45f8078088da6bba98cbaa98dce0f487b2a28402c9c453d8f` |
| `zobba/crates/infrastructure/src/knowledge.rs` | `a3906375bf0d42f8e6b2734b81f46546cdd438536ce94fea87ba89a2a8ab31de` |

## Execution closure

At the initial investigation, applied-source and execution closure were pending while BF2 was still running. BF2 subsequently completed **144 passed / 1 failed / 145 selected**, one worker, zero retries, exit 1, in 17.1 minutes. Its 245 source entries were identical before and after. That failed invocation remains failed; no receipt has been relabeled.

The reviewed proposal was then applied. I independently compared the complete source manifests and current files:

- BF2 before and after contain the same 245 path/hash entries.
- `source-repair-preference-order-final.json` differs from BF2 at only two paths: the reviewed browser test and the store comment.
- Current `knowledge.spec.ts` SHA256 is `5bd3bbf75957913758d4b8dfd9f0625daa8f878a73f9f417a39280b52b08d4dd`. Reversing the two exact reviewed hunks restores the entire BF2 file hash `d032cfdfee3ac38a12514d82c9cc514d156ee0721195ac29e9df1c6cefed2a94`. No additional browser-test changes are hidden in this comparison.
- The store comment now correctly says “publication-ID order.” Current SHA256 is `074a15f557996974e7d62d98ad92d45495e25591d8f13e3c56fafde4740ec94d`. Reversing that exact one-line comment change restores the complete prior file hash `a3906375bf0d42f8e6b2734b81f46546cdd438536ce94fea87ba89a2a8ab31de`. Executable backend source is unchanged. This byte comparison does not claim another Rust integration run.
- The final manifest, focused-start manifest, and focused-end manifest have exactly equal 245-entry file maps. Independently hashing all 245 current files found no mismatch.

`repair-preference-outcome-focused-1.log` and its exit/receipt record the actual focused browser command passing **1/1**, one worker, zero retries, zero failures/skips/flaky cases, exit 0, in 47.8 seconds (the named case itself took 6.0 seconds). The reviewed and executed case requires:

1. The real private preference offers supported Undo, has no Task Forget control, and the knowledge API reports `can_forget=false`.
2. Two actual accepted publications become current in their selected engagements. During the held second destination-list reload, stale selection and release controls are absent.
3. The first real Undo succeeds server-side but its browser reply is lost. One explicit retry sends byte-identical request data and receives the exact original receipt. The intercepted mutation phase contains exactly those two POSTs.
4. The retained outcome remains absent while its fresh owner-preference verification is held. Only after that real verification completes does the outcome appear.
5. The untouched original receipt contains precisely two unique expected destination IDs. The DOM has exactly two items in original receipt order, without imposing alphabetical order.
6. After navigation/remount, the retained event ID and the same exact two-item destination list appear again. The source requires the remounted owner's own verification before disclosure.

The POST interceptor is removed before the navigation/remount step, so its final `posted.length` assertion is not independent network observation of the remount phase. This closure claims two exact intercepted mutation attempts and receipt deduplication, not a new remount-specific network-counter proof. The reviewed command hook has no automatic submission on remount; separate uncertain-command browser cases remain the broader no-automatic-retry evidence.

`repair-web-check-12.log` and exit record generated contracts/types and **181 unit tests passing**, zero failures, exit 0. This focused evidence closes the bounded BF2 ordering repair. The separate full-3 145-case run is still required and is not covered by this report.

### Executed receipt identities

| Artifact | SHA256 |
| --- | --- |
| `source-repair-preference-order-final.json` | `90042474342f98c962b1b4af37f8b9fa1c849472047731b68bd42416ef2612c0` |
| `source-repair-preference-outcome-focused-1-start.json` | `4d21a2001369ac6e461c4eccf2d24c689daf7bc9cf9e9984f24fc9ec0f5af44e` |
| `source-repair-preference-outcome-focused-1-end.json` | `6c53a1a6248ed8ac8095b80f570e7e7d8ecff7e17400d20e5f1b9ae30c44b17d` |
| `repair-preference-outcome-focused-1.log` | `ed4e3385bd4fd7b88b6156c2bd00700e16152fa499b6c9b5a9a37d485e9e420e` |
| `repair-preference-outcome-focused-1-receipt.json` | `db9ef2085aedad2bd2f21928667fac25237cc0ed2d8a5381798576a31aef135f` |
| `repair-web-check-12.log` | `f9720f698ab69987cf986fc18d8c8cdcd28b7b5fc120794a5cf700559e7eaa62` |
