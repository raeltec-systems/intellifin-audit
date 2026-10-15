# Story 21.4 five runtime follow-up repairs — independent source review

**No concrete remaining defect found in the five assigned repairs. Source closure is supported; fresh browser execution closure remains pending.** This review does not convert either earlier failed invocation into passing evidence.

Scope: the five follow-ups in `runtime-repair-followups.md` after the first repaired focused browser invocation reported **13 passed / 5 failed**. This reviewer read the failed invocation log, the unchanged-product P8 negative-control log and safe `knowledge-support-wire.json`, the final application/test code, and both final manifests. No application edits, tests, builds, browsers, service operations or raw secret fixtures/traces were performed/accessed. The P16 handler received a second, non-overlapping source review by `/root/story_21_4_ui_repair_review/p16_runtime_harness`; its findings were reconciled below.

The earlier `ui-repair-source-review.md` is preserved unchanged (SHA256 `4a069248bdfe06d75523ffe2e46838b063f45721a6532d847adb1bd8ec3080d0`). Its source-only assessment did not discover the wider runtime Engagement object at P8 or the P9 destination-reload race. Actual browser failures established those defects. This report covers their later repairs rather than rewriting that history.

## Findings and repair assessment

### P8: canonical support scope at the actual wire boundary

The negative control's actual POST returned **400**, and its dependency scope contained `client_name`, `engagement_name`, `organisation_name` and `roles` in addition to the five supported wire keys. That establishes the prior structural spread defect; a TypeScript `Scope` annotation did not narrow the runtime Engagement object.

`knowledge.ts:78` now constructs `knowledgeEngagementScope` from `parseScope(scope)`. The existing parser at `engagements.ts:11–18` validates and returns a new object containing only `organisation_id`, `client_id` and `engagement_id`. Adding `kind: 'engagement'` and `owner_id: null` therefore creates exactly the supported five keys. `KnowledgeSupport.tsx:41–43` uses that canonical projection after reading the actual original and preserving its exact evidence ID, version and digest. It no longer spreads the wider caller object. Knowledge-reference support continues to use the strictly parsed knowledge scope from the exact response.

The amended real-browser test at `knowledge.spec.ts:370–409` retains the same outgoing-request scope-key assertion that failed on old product code. It reads the actual request body and actual status, writes only safe key/status metadata, requires exact scope values, then requires public HTTP 200 through `knowledgeReceipt`. It still corrects original support to exact knowledge support and inspects the retained old revision/basis. No server validation or response was loosened or mocked. The added unit at `knowledge.test.mjs:215–221` passes a wider Engagement-shaped object and checks exact canonical keys, plus invalid identity rejection.

**Assessment:** the source repair addresses the demonstrated defect. The negative control remains expected-failing evidence; the complete positive browser journey must still pass on these bytes.

### P9: retire destination choices during reload and preserve outcome freshness

`InspectionPreference.tsx:55–67` retires the previous list, loaded flag, cursor and selected destination before starting the read. A new list becomes selectable only after a successful read owned by the current controller, exact owner and current readiness. At `:80–83`, loading disables the load/select/release controls; because `loaded` is false, the old selector and release control are absent while the read is active. A late old response cannot clear a choice made against an old visible selector because that choice is no longer available. The current successful callback does not reset a subsequent selection.

The held real-list proof at `knowledge.spec.ts:434–448` repeats the destination load with the actual `/api/engagements` response held, requires old selection and release controls absent, releases the real response, selects the intended destination against the completed list, and requires a real accepted preference publication. It retains both destination publications. The exact Undo replay and outcome proof at `:450–466` remains intact: the first real Undo reply is lost; the next request body and returned receipt must match exactly; the subsequent real preference verification is held; the outcome must be absent until that verification is released; then the exact event and each affected destination once must appear, including after navigation/remount.

The previously reviewed outcome read-sequence fence (`InspectionPreference.tsx:13–28`) remains unchanged: an outcome requires the current owner/activation to be verified and a completed read later than the receipt. No timeout or count relaxation replaces that assertion.

**Assessment:** the destination race is addressed without removing the separate Undo freshness contract. Browser execution remains required.

### P16: correlate and settle the held request without suppressing errors

The earlier Guide case remains failed evidence: its `route.fulfill: Route is already handled!` error by itself cannot prove earlier assertions completed or classify the error as harmless cancellation. The evidence counterpart's pass does not close the Guide branch.

The final parameterized case at `knowledge.spec.ts:469–523` records the exact held route's `Request` object and records `requestfailed` only for object-identical requests (`:495–503`). It requires both completion of that route's `fulfill` and `ERR_ABORTED` for that same browser request (`:513`). These are distinct facts: completed route handling is not successful browser delivery. Its safe lifecycle artifact records status/order/booleans without private request headers or text.

Normal execution waits for the held handler to complete before advancing. Every exit releases the gate and then awaits `page.unrouteAll({ behavior: 'wait' })`; the listener is removed and the lifecycle artifact written in a nested `finally` (`:518–521`). There is no catch around `fetch` or `fulfill`, and arbitrary route errors remain test failures. This removes premature plain-unroute cleanup without relabeling errors as expected.

The authority assertions are preserved: real 403 at the exact evidence/Guide source pathname; enclosing card, protected text and editor gone; late-response release followed by repeated absence checks; destination objective enabled and destination heading present; no automatic competing mutation; explicit retry byte-identical to the original and receipt equal to the real accepted receipt; unrelated destination assertion visible. Removing the whole card also removes its nested basis/provenance/source preview. No product authority callback was changed in this five-file repair.

**Assessment:** no remaining concrete handler defect found by either source reviewer. A fresh passing run and its correlated lifecycle artifact must establish runtime closure; the old error remains unclassified beyond the observed failure.

### P6: confirmed scope denial before restoration

`knowledge.spec.ts:532–535` installs the exact scoped GET/403 waiter before actual assignment revocation and refresh. It waits for that refusal **and** the settled `Your engagements` chooser before checking that pending retry/editor are gone. Only then does it restore the fixture authority, refresh and reopen the engagement. Final assertions at `:544` reopen the original Task, require neither retry nor draft to reappear, and require exactly one originally submitted command.

This closes the prior proof hole: temporary hiding while App access was still in flight can no longer satisfy the denial prerequisite. The unchanged App behavior clears scoped custody in its actual 403/404 branch before choosing the list (`App.tsx:131–145`).

**Assessment:** source now sequences restoration after actual settled denial. Runtime closure remains pending.

### P6: provider-only SSO clearing before real same-account replacement

`knowledge.spec.ts:537–542` reads the old application session, verifies that the application cookie exists, clears only cookies for provider domain `127.0.0.1`, and asserts that the application's `__Host-zobba-session` cookie is unchanged before signing in in the replacement page. Cookie values are compared in memory, not logged. The established runtime uses issuer `https://127.0.0.1:9444` and application origin `https://localhost:<port>`; the existing methodology custody fixture uses the same provider-only clearing approach. This is a provider fixture correction, not a synthetic application logout.

The test then requires a genuinely different session token after real sign-in, refreshes the original page, and checks pending request/editor clearing. The final original-Task reopen and one-command assertion remain. It does not clear all cookies or preemptively erase the app's old session to manufacture the expected disappearance.

**Assessment:** the fixture now reaches the intended same-account replacement contract while preserving the old application session until replacement. Runtime closure remains pending.

## Source and evidence identity

All **245** paths in `source-repair-five-final.json` matched their current on-disk hashes at review completion. Comparing that manifest with the unchanged-product negative-control after-manifest yielded exactly the five files listed below; no other path differed. All five also matched `repair-five-frontend-source.json`.

```text
144c44f13c174b2373a2048e99af7c03553d353a6540c3b6678447124faac317  zobba/web/src/knowledge.ts
3218fb1c27918d452c218b8262802f22521bf68551393943489410a1f8faff8c  zobba/web/src/KnowledgeSupport.tsx
c44ab18bad7225b45f8078088da6bba98cbaa98dce0f487b2a28402c9c453d8f  zobba/web/src/InspectionPreference.tsx
b0a723a6698eac0fa14baa961b97b4ba15532275e4a17bf2e9867318d047057f  zobba/web/tests/knowledge.test.mjs
c24a13d553dd55e0f000e8cd363867b689466f8f975c1fdf14bac40a9126d2b8  zobba/web/tests/browser/knowledge.spec.ts
3dda06b9a676d8155c48e9c990229a4156039480c5c49a9d2f264826a1fcfdf8  zobba/web/src/engagements.ts (canonical scope parser)
b6d01bf4c872ab7db998de7eb80dab46cfbecbcf499f6fd09f1f47abdd0a9763  zobba/web/src/App.tsx (unchanged custody/denial owner)
2d65eb8128a24d6019ff28dc9aba88395f41c6ec0ed073463f9e167a34047548  zobba/web/src/TaskKnowledge.tsx (unchanged source-withdrawal owner)
23026772b24f065ebe0c07a937ae578f6e1263569301c2b1d7db69b01cc8fc87  zobba/web/src/useSkillInspection.ts (unchanged activation/request fence)
09db5ca7b5718ed23058532ce290e9f850204530ed84ff88defb12ddcb5cda85  zobba/web/src/useKnowledgeCommands.ts (unchanged command custody)
e1c89897d87dc687279164d47cab9d2347497166e7ea19c09278fe267c5d0657  zobba/web/tests/browser/methodology-custody.spec.ts (provider-only replacement precedent)
c5d86042de59d433bdc67a36294842b692aa1f56aa348941aad671b7caed2d40  /tmp/zobba-story-21-4/source-repair-five-final.json
e4fd6430ad3c8637eb942d58e3aa230dcfa223337961594e5d74201ba057c3b6  /tmp/zobba-story-21-4/repair-five-frontend-source.json
026d736bbedb906a3abbda5afd4a91fbc7816501488bb87dbd7627acf3a3a2e0  /tmp/zobba-story-21-4/review/runtime-repair-followups.md
357e7707be52f17f3a05df0b954d147f359abc435b2819b7d9a30b107a5aa2a5  /tmp/zobba-story-21-4/repair-knowledge-focused-1.log
a63db756f2320964ca0654a6a9b49dfc95abad888f4f049b2d0acae882ce8b3a  /tmp/zobba-story-21-4/repair-support-wire-negative.log
1006fc78aef1158bee93290293836aa2bccd1f22537c00d36ebf60d77367d05a  /tmp/zobba-story-21-4/repair-support-wire-negative-results/knowledge-assertion-suppor-c99dd-old-basis-stays-inspectable/knowledge-support-wire.json
```

Later changes to these hashes require the affected source/assertions to be rechecked. Root/lead own final static, combined and browser execution; this report records no new test result.
