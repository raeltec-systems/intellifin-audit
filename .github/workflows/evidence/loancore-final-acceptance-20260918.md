# Final LoanCore acceptance — 18 September 2026

## Decision: ACCEPTED for the bounded synthetic P-1 LoanCore journey

A normal auditor prepared and submitted the clean Procedure through the deployed UI; a genuinely different Audit Manager approved it; an OpenAI-backed Run inspected all three canonical leavers through LoanCore in a persisted isolated Solari workspace; Watch visibly progressed while the same Run was active; the exact fixture results and mandatory evidence passed; auditor UI confirmation sealed the expected result; Replay preserved the work after workspace release; no secret credential value or raw provider handle was detected on the exercised surfaces; and the unchanged defective source ended honestly as inconclusive.

This closes the acceptance assignment in #45. It does not certify real customer data, every feature in every epic, mobile Watch, or native live video. ChatGPT performed the direct implementation/evidence review; no separate human engineer or independent human reviewer is claimed. Auditor and manager are separate temporary acceptance identities exercising the real product UI.

## Release and provenance

- Application revision: `44fb5966dd085f53625d5f9ac77a466a9c18805f`.
- PR #47 fixed evidence MIME delivery through the official signed S3 response without rewriting historical evidence or weakening authorization/digest/size checks.
- PR #48 top-aligned the shared Watch/Replay stage so growing evidence cannot move the workspace image below the viewport. Code, regression tests and explanation were pushed in atomic commits.
- PR #48 CI: `35335573874`; main CI: `35337577678`; normal Release: `35339527945`. All passed.
- Railway web deployment: `155833e3-ded4-4b88-a5a3-3dd4d8794554`; worker: `a685f9f2-c7cf-4251-b0e7-9e899557ed58`; Northstar: `8fa0fd14-4fdd-452f-9e29-11a106b89c8a`. All SUCCESS.
- Actual Run provider/model: OpenAI / `gpt-5.6`, following the owner's explicit provider-change approval. Workspace mode remains Solari.
- Final deployed acceptance workflow: `35340181283`, attempt 1, validation SHA `1b9ee9610e665076a61f3697898bf995fc2e4269`.
- Independent read-only persisted-state verification: `35340470537`, attempt 1, SHA `c099e90d799928bece7e935a29687955ae1888ab`.
- Exact executed observer SHA256: `12ea9f4c3eafe009d3a7f712a746d5c92db14bd90b2536b4db82d820776a91c5`.
- Validation branch: `validation/loancore-watch-closeout-20260918`. It contains workflow-owned validation/evidence only; no workflow deployed or patched application source. This report is an evidence-only checkpoint after the tested release.

## Exact identifiers

| Reference | Identifier |
|---|---|
| Clean Procedure | `01a0b44d-4001-7d5c-a9fe-12bfc4c2d105` |
| Clean Procedure Version | `01a0b44d-4001-72a9-99a0-e2dbaee4d49f` |
| Clean Run | `01a0b44d-b1d2-7596-87e3-7d6dba84e091` |
| Clean source binding | `01a0b44d-27ba-7581-9279-32aced6aad95` |
| LoanCore target registration | `01a0b44d-2f30-7490-bf6f-cba0eac098c1` |
| Negative Procedure | `01a0b451-d84c-77c8-8f80-45249a2edf8f` |
| Negative Version | `01a0b451-d84c-7afc-a580-a73fa5c79fbb` |
| Negative Run | `01a0b452-3b49-71c8-846d-8aac3cc45884` |
| Negative binding | `01a0b451-d08e-7448-8d95-e076dbe42bb7` |

## Required gates and evidence

| Gate | Result and proof |
|---|---|
| Workspace persistence | PASS: Solari identity persisted, length 223; no database persistence failure. Raw value remains internal. |
| Session secrecy | PASS: known raw provider handles absent from exercised UI/API/Timeline/replay metadata and reviewed image content. |
| Procedure creation | PASS: P-1 created through deployed UI; `00-procedure-created.png`. |
| Population Source | PASS: selected binding persisted in `source_snapshot`; section-specific readback, not a shared Saved banner. |
| Target | PASS: exactly one persisted LoanCore web registration. |
| Plan derivation | PASS: successful compiled plan and Re-derived UI. |
| Auditor submission | PASS: persisted UI submission at 11:36:21.219 UTC. |
| Different manager approval | PASS: separate identity/session approved and activated at 11:36:24.703 UTC; self-approval refused; controls hydrated. |
| Run start | PASS: normal UI initiation at 11:36:25.810 UTC. |
| Population | PASS: 3 retrieved, 3 included, 0 excluded, 0 indeterminate. |
| Inspection | PASS: 3/3 inspected; exact username/status/roles captured with source relationship. |
| Expected verdicts | PASS: all six effective values exactly match the independent fixture; no extra exceptions or unexplained unevaluated values. |
| Evidence gate | PASS: 20/20 checks (7 observation, 13 Run-level); required screenshots and structural grounding; current snapshot links work. |
| Watch | PASS: 14 physically visible screen captures with the same Run RUNNING both before and after capture; 8 distinct screen contents covering all 3 records. |
| Replay | PASS: all 15 frames ordered, decoded and digest/size matched after workspace release; playback advances. |
| Secret safety | PASS within exercised scope: credential-entry capture suppressed; all 8 distinct raw images visually reviewed; known-handle page checks and 3 bounded SSE samples passed. |
| Negative regression | PASS: unchanged defective 27-row source ends INCONCLUSIVE, without manufactured observations/evaluations. |
| Application revision | PASS: exact release and Railway deployments corroborated. |
| Validation workflow | PASS: all 36 automated checks; independent readback adds 7 passing checks. |
| Artifacts | PASS: original archive digests and every manifest entry verified; separate visual sign-off retained. |

### Exact result

| Record | Username | Account status | Role | C1 | C2 effective |
|---|---|---|---|---|---|
| E-000102 | b.tembo | Disabled | LOAN_VIEWER | COMPLIANT | COMPLIANT, confirmed |
| E-000103 | c.zulu | Active | LOAN_OFFICER | EXCEPTION | COMPLIANT, confirmed |
| E-000105 | e.kabwe | Disabled | COLLECTIONS_AGENT | COMPLIANT | COMPLIANT, confirmed |

The independent oracle is `fixtures/northstar/expectations/p-1-live-acceptance.json`. It was not provided to the audit agent. After three auditor confirmations through the normal UI, the clean Run is COMPLETED with sealed CONTROL_FAILURE, result version 2. CONTROL_FAILURE is the correct detection of the deliberately active E-000103 account, not a software failure.

Auditor `AX13QFDqKGv4pZjXKoecR0aTsjImbclO` and manager `6xcUSY0dun94khZRnRvIO8K7O5t3X77j` are different identities. C2 confirmations persisted at 11:39:16.783, 11:39:20.782 and 11:39:23.782 UTC. Independent readback verifies the effective review overlay; original machine proposals remain immutable and are not rewritten from pending to confirmed.

### What Watch actually proved

At 1440 by 1000, all 14 counted RUNNING captures had visible fraction 1.0, unobscured image centre and scrollY 0. No production DOM/CSS mutation was used. The growing rail no longer displaced the workspace. Sign-in is narrated without exposing credential entry, followed by safe authenticated navigation, search, search results, account opening and inspection for every canonical record.

Watch is sequential, per-action screen capture, not native live video or high-frame-rate streaming. Observed delivery gaps were about 8 seconds median and 14 seconds maximum. The previous image remains between captures. This meets the assignment's behavioral Watch test but does not establish a universal latency service level or continuous-video capability.

All 15 Watch screenshots and all 8 distinct underlying images were reviewed. The last Watch screenshot was taken after COMPLETED and is not counted as RUNNING proof. Replay after release was reviewed separately. All 15 current and all 15 historical frames decode and match their registered bytes. Current and historical structural links each passed 12 checks. Historical Run `01a0b39a-9c62-7671-a424-994f989f6880` remains readable without rewriting its immutable evidence.

### Negative regression and cleanup

The defective source is still 27 retrieved, 19 included, 4 excluded and 4 indeterminate, with duplicate E-000107, invalid dates and diagnostic `population-key-unresolved`. It ends sealed INCONCLUSIVE with 0 observations and 0 evaluations. Before/after source bytes have the same SHA256 `6079dcca9f6675d6bc0fffe2a8db1b6966fce688ca3ace249d78c9751424b173`.

Both workspaces are RELEASED. All three temporary identities (auditor, manager, administrator `CfTkf2b7nhTAUk5B0wzQ2XBtxXBj4mmC`) have zero sessions and zero roles, verified independently after workflow cleanup. Procedures, approval/review history, Runs and evidence were preserved. No direct SQL lifecycle/configuration bypass was used.

## Artifacts and verification

| Evidence | Workflow | Artifact ID | ZIP SHA256 |
|---|---|---|---|
| Final visible acceptance | 35340181283 | 10544927223 | `1995ec3e84afe5eb8a7ae5a55a4e00dd72fa29c92a16260e0f42212b68bee99c` |
| Independent persisted readback | 35340470537 | 10544947088 | `3710b1244a0afdfd5ef277c19608afa1541ac341c8deb72971a1a63312ff0751` |
| Read-only progress | 35340787732 | 10545071628 | `35b148e0161caf521990950a7749d3bef84ec8f16aabd54fd0a68cc9ea3e2b01` |
| Observer precheck | 35336517677 | 10543502989 | `6cebd1a46096229ead602daad4db39d40af14d6316d6315c949fb303730f31d7` |

All 181 final-acceptance manifest entries and both independent-readback manifest entries were checked for byte length and SHA256. The raw harness intentionally retains `accepted:false` and `visualReviewRequired:true`; it reports `phaseComplete:true`, 36 passing checks and no failures. That raw artifact was not altered. The separate SIGNOFF.json adds the completed direct visual review and records ACCEPTED.

Delivered package: `IntelliFin_LoanCore_Final_Acceptance_2026-09-18.zip`, 196 files, 23,360,001 bytes, SHA256 `fd4c3437b3b91e88932c69dee7ec52e93b1d5d5bac44944daf94745d6e559e4b`. Includes REPORT.md, SIGNOFF.json, deployment provenance, artifact index, per-evidence digests, Watch ledger, original evidence, original archives and package manifest.

Separate delivered report SHA256: `80ad8dc236efa94604b2cc1191a15e936a7a62046af04ce03fa441b9b91ecdc2`; sign-off JSON SHA256: `ca6ba87438d1d37fbae6c6674470d209a18896963ebc872abbe7471c00535719`.

## Remaining boundaries, not hidden acceptance claims

No blocking item remains for this specified synthetic acceptance. Native video, mobile/tablet Watch, real customer populations, exhaustive console telemetry, all future epics and an independent human audit opinion were not certified. Non-secret synthetic usernames, application-owned workspace aliases and credential-reference names may be displayed; actual secret values and raw provider/session handles must not be. A transient Review queued message can coexist briefly with the already-sealed result; the independently persisted result, decisions and retained result display establish completion, not that transient message.
