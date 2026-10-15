# Story 21.4 frontend focused execution reconciliation

**Focused P4–P11/P16 repair evidence is closed on the reviewed source: 18/18 Chromium cases passed, one worker, zero retries, 2.1 minutes, exit 0.** The full 145-case combined invocation and separate upgrade verification are still pending. This report does not close those broader gates or the entire story.

This is independent **source/receipt reconciliation**, not independent execution. The implementation lane ran the invocation; this reviewer read its plain log, exit receipt, source manifests and the three explicitly approved safe artifacts. No tests, builds, browser sessions, services or application edits were performed. No private raw JSON reporter, traces, environment or secret fixtures were read.

## Executed receipt and source identity

The recorded command was:

```text
pnpm --filter @zobba/web test:browser --workers=1 --retries=0 --reporter=list,json knowledge.spec.ts knowledge-sources.spec.ts
```

`repair-knowledge-focused-2.log` lists each of the 18 named cases as passed and concludes `18 passed (2.1m)`. `repair-knowledge-focused-2.exit` contains `0`.

Both `repair-knowledge-focused-2-source-before.json` and `repair-knowledge-focused-2-source-after.json` contain 245 paths. Their file/hash maps are identical to one another, identical to the final `source-repair-five-final.json` reviewed in `ui-runtime-repairs-source-review.md`, and identical to the current files at reconciliation. All five amended source/test hashes match the exact independently inspected hashes below; the unchanged `knowledge-sources.spec.ts` also matches. There is no observed source drift between review, this invocation and reconciliation.

## Repair-to-executed-case mapping

Names below are the actual passed cases in the log. Locations refer to the reconciled final source.

| Finding | Passed named case and executed assertion contract |
| --- | --- |
| P4 — foreign-origin controls | **“named same-client reuse serves the destination and independently checks reader and accountable Task owner”** (`knowledge.spec.ts:314`, 5.9s). The independently signed-in destination reader sees the reused record, has no correction/reuse controls, and retains enabled destination exclusion/Forget. It also checks distinct origin access loss for viewer and accountable Task owner. |
| P5 — personal preference controls | **“private preference offers its supported Undo and retained outcome names every released destination exactly once”** (`knowledge.spec.ts:427`, 7.8s). The real private preference card has no Task-bound Forget, the API says `can_forget=false`, and owner Undo is enabled. |
| P6 — uncertain request across navigation | **“lost mutation reply and temporary retry capacity preserve one exact command through recovery”** (`knowledge.spec.ts:241`, 4.2s). Real accepted reply is lost, navigation hides recovery, returning knowledge read is held and keeps draft/retry hidden, and explicit retries through a controlled 429 retain byte-identical bodies. The durable event matches and only one projected record exists. **“actual session outage remount preserves exact unsent draft only after its own current read”** (`:222`, 4.1s) additionally verifies exact private draft recovery, no automatic POST and no browser-storage persistence. |
| P6 follow-up — confirmed denial | **“confirmed scope denial clears an uncertain knowledge request without automatic retry or later resurrection”** (`knowledge.spec.ts:525`, 6.1s). The test waits for actual scoped GET 403 and the settled engagement chooser before restoring authority; it then reopens the original Task and requires draft/retry absent and exactly one original command. This is stronger than the former in-flight hiding check. |
| P6 follow-up — real same-account replacement | **“confirmed same-account replacement clears an uncertain knowledge request without automatic retry or later resurrection”** (`knowledge.spec.ts:525`, 6.7s). Only provider-domain SSO cookies are cleared; the application cookie is asserted unchanged before real sign-in. Real session token replacement is required, followed by old-page refresh, private-state removal, Task reopen and no resurrection/automatic retry. |
| P7 — unsupported-original correction entry | **“unsupported originals with no captured records can be corrected through an explicitly selected Task”** (`knowledge-sources.spec.ts:53`, 8.3s). Two actually acquired unsupported originals with empty metadata have no captured source records. The user enters through original inspection and the selected Task, gets an accepted attributable source correction, and both original downloads remain byte-identical. |
| P8 and runtime wire follow-up | **“assertion support can be added and replaced through current originals and exact knowledge while old basis stays inspectable”** (`knowledge.spec.ts:370`, 8.5s). The actual outgoing original-support scope has exactly the permitted keys and values, the real public response is 200, correction removes/replaces support with exact knowledge, and the old revision's original support remains inspectable. The safe wire artifact independently records the successful real POST and exact five-key scope (below). |
| P9 and destination-reload follow-up | **“private preference offers its supported Undo and retained outcome names every released destination exactly once”** (`knowledge.spec.ts:427`, 7.8s). The second actual destination-list response is held; old selection/release controls must be absent until the completed current list permits a choice. Two publications are accepted. The first real Undo reply is lost; exact retry returns the same receipt; subsequent real preference verification is held and the outcome must remain absent; release reveals the exact event and each destination once, including after navigation/remount. The earlier fresh-owner-read fence was preserved and reached in this passing run. |
| P10 — bounded source-I/O deadline | **“public excerpt capture survives source I/O beyond twelve seconds and retains exact nonzero UTF-8 bytes”** (`knowledge-sources.spec.ts:80`, 19.3s). The real object GET is held for 13,250 ms; capture/retry remain in-flight rather than prematurely becoming uncertain, then the UI confirms the actual receipt. Assertions require elapsed time over 12s, exact nonzero byte range/text/version/digest, deduplicated replay, invalid UTF-8-boundary refusal, one result and unchanged original. Ordinary-command deadlines are unchanged in the reviewed source. |
| P11 — local layout during uncertain observation | **“local layout stays usable while one exact observation is uncertain and recovery creates no competing events”** (`knowledge.spec.ts:412`, 4.5s). Actual observation reply is lost, local Reduce/Expand/Reduce remain usable, no competing observation is sent, explicit recovery uses identical bytes, and the final local choice is preserved without an inferred preference being manufactured. |
| P16 and handler-lifecycle follow-up | **“a real evidence source refusal withdraws enclosing knowledge while destination work and unrelated exact recovery survive”** and **“a real guide source refusal withdraws enclosing knowledge while destination work and unrelated exact recovery survive”** (`knowledge.spec.ts:469`, 7.2s / 5.9s). Both require actual source GET 403, parent card/text/editor removal, absence after releasing the stale response, independently usable destination, no automatic mutation retry and byte-identical explicit recovery with the real original receipt. Exact request lifecycle artifacts confirm cancellation, handler completion and awaited cleanup for each branch (below). |

The other passed cases preserve surrounding behavior: distinct Expand openings learn/apply/Undo without reusing consumed observations (`:128`); another assigned reader can use exact released layout without private preference events (`:151`); actual acquisition and Guide produce distinct attributable knowledge with source navigation and narrow-screen inspection (`:171`); correction/exclusion/Forget retain attributable history (`:207`); a held old knowledge response cannot restore a corrected assertion after verification (`:269`); and explicit original correction preserves in-flight form edits and immutable original downloads (`:284`). These are part of the same 18-case receipt, not additional executions.

## Safe artifact reconciliation

The P8 `knowledge-support-wire.json` records:

```json
{"method":"POST","action":"assert","status":200,"dependency_scope_keys":["client_id","engagement_id","kind","organisation_id","owner_id"]}
```

The evidence and Guide lifecycle artifacts each record `held_status=200`, `source_status=403`, `held_failure="net::ERR_ABORTED"`, `held_fulfilled=true`, `protected_withdrawn=true` and `exact_recovery_completed=true`. Both have this event order:

```text
exact-response-held
actual-source-refusal
exact-held-request-failed
enclosing-fragment-withdrawn
held-gate-released
held-fulfill-completed
exact-recovery-completed
cleanup-wait-started
cleanup-wait-completed
```

The inspected handler correlates `requestfailed` by exact Request object identity, so this is evidence about the deliberately held request, not an unrelated cancellation. Successful handler fulfillment and browser `ERR_ABORTED` are compatible facts: the handler settled while the stale browser request had already been cancelled. The source contains no blanket catch suppressing route failures. Both branches now reached cleanup completion and unrelated exact receipt recovery in a passing invocation.

## Preserved failed history and limits

`repair-knowledge-focused-1.log` remains **13 passed / 5 failed**. Its old P8 400, P9 release timeout, Guide handler error, scope-denial sequencing timeout and provider-form timeout are not relabeled as passes. `repair-support-wire-negative.log` remains the expected-failing old-product control; its safe artifact records the actual **400** and the four unwanted display/role keys. That control was followed by a separate product repair and the present successful exact-key/public-response proof.

The earlier source reviews remain unchanged. This new receipt closes their focused pending execution statements only within the P4–P11/P16/browser scope described above. It does not prove the full combined 145-case suite or separate upgrade, and it is not this reviewer's independent rerun.

## SHA256 identity

```text
144c44f13c174b2373a2048e99af7c03553d353a6540c3b6678447124faac317  zobba/web/src/knowledge.ts
3218fb1c27918d452c218b8262802f22521bf68551393943489410a1f8faff8c  zobba/web/src/KnowledgeSupport.tsx
c44ab18bad7225b45f8078088da6bba98cbaa98dce0f487b2a28402c9c453d8f  zobba/web/src/InspectionPreference.tsx
b0a723a6698eac0fa14baa961b97b4ba15532275e4a17bf2e9867318d047057f  zobba/web/tests/knowledge.test.mjs
c24a13d553dd55e0f000e8cd363867b689466f8f975c1fdf14bac40a9126d2b8  zobba/web/tests/browser/knowledge.spec.ts
8a482f33f911a2534bb72353b96d27817ea5bc3b3696b80c2325e1b895c315b5  zobba/web/tests/browser/knowledge-sources.spec.ts
30f5a52d4929f50606a4c0ed975f5333077d079a4414e63d3be20f8f35074efb  /tmp/zobba-story-21-4/repair-knowledge-focused-2-source-before.json
12035f27c45c096df0dae7ca97a65529945c1c2c765fd6261cbfd36b786f57c2  /tmp/zobba-story-21-4/repair-knowledge-focused-2-source-after.json
c5d86042de59d433bdc67a36294842b692aa1f56aa348941aad671b7caed2d40  /tmp/zobba-story-21-4/source-repair-five-final.json
ba916668e375b476d8e28b56f89f004a7aced5551de1fdc222069ae560c5aedd  /tmp/zobba-story-21-4/repair-knowledge-focused-2.log
9a271f2a916b0b6ee6cecb2426f0b3206ef074578be55d9bc94f6f3fe3ab86aa  /tmp/zobba-story-21-4/repair-knowledge-focused-2.exit
0957d099e8d1fc724e418681b6fcfcc5ec3a85f861e572db3b914c509b557e33  /tmp/zobba-story-21-4/repair-knowledge-focused-2-results/knowledge-assertion-suppor-c99dd-old-basis-stays-inspectable/knowledge-support-wire.json
d184f98622fb7f0aea02689bdd6564f84d391b93b9382ed0f65a505deb0e8844  /tmp/zobba-story-21-4/repair-knowledge-focused-2-results/knowledge-a-real-evidence--6d98e-ated-exact-recovery-survive/knowledge-evidence-source-lifecycle.json
633ae9890ab776abc5dd694f467cf2bd8731c7455355f3fd82d503d5ba848f7f  /tmp/zobba-story-21-4/repair-knowledge-focused-2-results/knowledge-a-real-guide-sou-e5697-ated-exact-recovery-survive/knowledge-guide-source-lifecycle.json
f513efe38f88c75c83074df0f67ca91b1232ec1dd5295001bd63a6e6c4080745  /tmp/zobba-story-21-4/review/ui-runtime-repairs-source-review.md
```
