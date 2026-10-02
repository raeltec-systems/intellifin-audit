# Story 21.4 H1–H4 harness repair source review

Result: no remaining concrete defect found in the assigned H1–H4 harness repairs. Source-supported closure is recommended for all four repairs, conditional on the lead's final executed-receipt closure. This review does not convert the earlier failed browser invocation into passing evidence.

Reviewed read-only against HEAD/baseline `d38e1daed736415ef13e7606345dac71bd1d9f01`. The supplied complete unstaged diff was independently checked: `repaired-review.diff`, 1,407,965 bytes, SHA256 `36f27824c79d1eb0fb692662cfe7883f04d6dc38a88d350839245dcfd39d82e8`. Read `AGENTS.md`, `root-triage.md`, the five assigned browser sources, their actual unstaged changes and the relevant current App/session/projection/methodology contracts. No tests, builds, services, application edits, staging, commits, skills, secret files or raw traces were used. The only authored file is this report.

## H1 — bound projection verification versus unbound App recovery

`account-binding.spec.ts:253–351` holds the actual successful preference verification response before sign-in reaches the fault phase. It first waits for the initial impact projection to be visible, then releases preference verification and observes its successful bound session response. That sequencing is supported by `skills.ts:213–216` and `knowledge.ts:137–140`: each read awaits its own `verifyMembershipSession` before returning a renderable projection. The preference hold therefore prevents its new postcheck from being mistaken for an impact postcheck.

The refusal phase retains the existing exact expectations: two unbound App session reads, zero bound impact checks, two scoped reads, two real conversation 412s and zero Task command POSTs (`account-binding.spec.ts:314–317`). It still removes the protected workspace and every textarea. Lifecycle triggers still cannot replenish the exhausted allowance (`318–327`). Explicit recovery still performs the third unbound App read, recovers an empty draft and one impact postcheck; only afterward is the separately held recovered preference verifier released and its single postcheck counted (`329–341`). Request classification records header presence and phase, never the session value. The added chronology records real handler/request/response ordering rather than fabricated successful responses.

`account-binding.spec.ts:369–476` holds both actual initial impact and preference verification replies before installing the fault routes. It releases preference first while impact remains held and requires exactly one preference postcheck with zero impact/unbound/scope/refusal counts. It then releases impact and requires its single bound postcheck, still with zero unbound reads. An ordinary real conversation 200 passes through the same route before fault injection. Refresh then retains exactly two unbound session reads, one successful scope read, one engagement 412, one conversation 412, zero commands and an absent protected workspace (`440–462`). The two refused reads arise from actual fixture session rotations and `route.fetch()`, not mocked 412 replies. The emitted chronology explicitly records bound presence, response status, rotations, phases and final counters.

The distinction matches current production contracts: `auth.ts:107–115` leaves App `readSession` unbound and adds the expected-session header only through `readSessionJson`; `membership.ts:160–163` performs the bound session postcheck. `App.tsx:51–62,91–94,147–182,185–208` still provides one shared automatic recovery, blocks further automatic refresh after exhaustion and permits explicit recovery. The harness changes do not increase this allowance or relax the original refusal, scope, draft or no-command assertions.

## H2 — focus the actual protected node before expiry

`auth.spec.ts:164–172` marks the current All engagements button, focuses it and asserts actual focus before expiring membership in the real fixture. The intended window-focus revalidation follows expiry. The test requires the no-assignment result, zero nodes carrying the marker and focus on the current Your engagements heading. This verifies withdrawal of the actual previously focused node, rather than trying to focus an already withdrawn node. The role-demotion and subsequent real session-expiry assertions remain intact. Current App focus handling (`App.tsx:64–89`) only restores a still-connected visible original node and otherwise falls back to current navigation/heading, matching the retained expectations.

## H3 — correlate transport failure before withdrawal assertions

`conversation-review.spec.ts:140–168` first waits for all prior legitimate held handlers to settle. It then installs explicit snapshot and events matchers for engagement-a. Each matched request must be GET with organisation `org-a` and client `client-a`; it is entered into a map keyed by the actual Playwright Request before `route.abort('connectionreset')`. The requestfailed listener fills the same entry. Before checking withdrawal, the test requires a snapshot entry with both completed abort and observed requestfailed timestamps (`165`). A click or unmatched route can no longer satisfy this precondition.

The prior same-scope checks remain: protected text absent during authority checking, retained inner control/methodology nodes while hidden, retained disclosure, the same original focused Pause control after successful recovery, and its methodology content visible again (`124–139`). After the verified transport fault, the Task-details region and both original marked inner nodes must be absent. The evidence attachment is produced while the fault remains installed, before cleanup could permit successful recovery. No timeout, count, visibility, focus or disclosure assertion was weakened. The cause of the original predicate miss remains unproven, as correctly stated in the test and triage.

## H4 — real denial, current chooser and no draft resurrection

`methodology.spec.ts:327–342` creates an actual unsaved private draft, installs a wait for the selected organisation's real 403, disables the Admin membership through the guarded fixture and triggers access refresh. It then requires the visible Your organisations chooser, the current no-Admin result and no Package name field. After restoring authority, it refreshes, re-enters the real organisation, waits for New methodology to be enabled and again requires no Package name field and no Edit methodology form. The earlier save, oversized refusal, capacity refusal, frozen exact lost-reply recovery, Undo, exact Task template content, retained original Task binding, new-Task notice and recall journey are unchanged by this repair.

The current implementation supports that transition directly: `MethodologyWorkspace.tsx:73–86,99–117` clears both local draft/pending/receipt state and retained organisation custody on definite denial, clears selected organisation metadata and returns 403/404 to the chooser without globally denying an otherwise valid session. Its chooser copy and rendering are at `207–215`; `methodology.ts:315–318` implements the custody deletion. The repaired assertions therefore follow current behavior rather than obsolete transient copy. Browser assertions establish observable withdrawal and no resurrection through the real restored-authority flow; the source supplies the internal custody-clearing evidence. No raw prior trace was opened for this source-only review; confirmation from execution/approved response evidence remains the lead's closure step.

## Shared runtime and execution boundary

The assigned `auth-runtime.ts` source was also inspected. Default startup retains the guarded dedicated loopback `*_test` database requirements and calls the complete smoke database guard before mutation (`198–208`). Schema-10 cleanup/readiness accommodates the knowledge schema; the historical schema-9 reset/upgrade path is explicit and separate. The newly exposed process-status/read-only exact-event helpers do not replace any H1–H4 real browser request or assertion. No H1–H4 success is manufactured by runtime helpers. This is a bounded harness review, not independent closure of the historical upgrade or public knowledge capture workflows owned by other reviewers.

The scoped `git diff --check` completed cleanly. No browser case or runtime was executed by this reviewer. Final closure still needs passing receipts on these exact source hashes, including both H1 chronologies and H3's correlated abort/requestfailed entry; H4 needs the actual denial and restored-authority journey to complete. Any source changes after these hashes require reconciliation before this review is used.

## SHA256 source manifest

| File | SHA256 |
| --- | --- |
| `zobba/web/tests/browser/account-binding.spec.ts` | `9be947cc7a7127d9ef59f21073fd2985cfc66968b82d246eb08c705ef11d8f64` |
| `zobba/web/tests/browser/auth.spec.ts` | `a8f0c28b2c2117eefb1921303afeb158b833af7a73a1e0460d2916c5483f2c9c` |
| `zobba/web/tests/browser/conversation-review.spec.ts` | `3a07a514116e7ae2526e06dcaa5d30028a22c940c4f5b3cb459ef522907c045a` |
| `zobba/web/tests/browser/methodology.spec.ts` | `c4361d77a37cb373f118a200bd3d8222b669e8bfb0bb048f8cbb0168c5064430` |
| `zobba/web/tests/browser/auth-runtime.ts` | `57e8cb31c114958ade33d69f9243333146f4447bc0295dd08bb7bf6da0bfceef` |
| `zobba/web/src/App.tsx` | `b6d01bf4c872ab7db998de7eb80dab46cfbecbcf499f6fd09f1f47abdd0a9763` |
| `zobba/web/src/auth.ts` | `844a625456b9b6fed59b66d25691383f25fc0aed46207f761dd99e93713c7f90` |
| `zobba/web/src/membership.ts` | `d9871ad043c57840bd34c63f7e3cf5f81de45c7c2eaccf2db52ce30f51a1f65e` |
| `zobba/web/src/knowledge.ts` | `b1f8bc408312866e3ed5c1b797f9d433c005d898c4013aa0a554b481bca14c22` |
| `zobba/web/src/skills.ts` | `b71044858a695794661faa5c69dde5715a03224e2ecf945b89c97d50a69264c2` |
| `zobba/web/src/useSkillInspection.ts` | `23026772b24f065ebe0c07a937ae578f6e1263569301c2b1d7db69b01cc8fc87` |
| `zobba/web/src/MethodologyWorkspace.tsx` | `0ba509698ea541e5288adf566cb34dcea78f27f415df8c6843f49372a4cdcde6` |
| `zobba/web/src/methodology.ts` | `15ffeb91a8178664f0a55b816f61fc29c8d3224c7531b87e12d6228b12065e59` |
| `AGENTS.md` | `517d76b51301a60498b8eb19d79bdeb1915ba807e3d7ce79006970f65da16173` |
| `/tmp/zobba-story-21-4/review/root-triage.md` | `fee243915aecf37278ec4e959a314a86d35736eb92c23e050df43d8d0b78d8bc` |
