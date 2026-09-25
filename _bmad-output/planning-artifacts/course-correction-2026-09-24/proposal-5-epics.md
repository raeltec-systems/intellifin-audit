# Proposal 5 of 7 — Epics: disposition of Epics 1–9 and the new epic plan

Terminology note (owner correction, 2026-09-25): the concept formerly named **Mandate** is named **Permissions** throughout the course-correction artifacts — Agent Permissions (the bounded authority granted to the agent for work in an engagement), Engagement Permissions, Permissions Policy (the administrator ceiling), Permissions Version, Effective Permissions (what each proposed operation is authorised against) and Permissions Summary (what the model is shown). This is a terminology change only; every intersection, versioning, confirmation, source-protection, administrator-limit, revocation and enforcement rule is unchanged, and provider or OAuth connection scopes remain distinct from agent permissions. Contract and module names follow: `permissions-v1`, `packages/domain/src/permissions/`, `permissions_policy`, `engagement_permissions`, `authorizeToolCall(effectivePermissions, call)`.


Status: draft for owner review on 2026-09-24; awaiting a / e / s. Builds on the approved Proposals 1–4 and maps every approved contract (3d §6) to the epic and stories that establish it and the tests that demonstrate it, as 3d's approval requires. No implementation is authorised; sprint-status changes are made by Proposal 7's disposition, not here.

Baseline (`sprint-status.yaml` on `main` `c18ad36`): Epic 1 done (8 stories), Epic 2 done (8), Epic 3 done (11), Epic 4 three done and nine in review, Epic 5 eight in review, Epics 6–9 backlog (8, 7, 6, 9 stories). Everything in Epics 1–5 is on `main` and deployed; it is the compiler-1 path.

Owner decisions this proposal asks for:

| Decision | Proposed choice |
|---|---|
| D-5-1 | **Epic 4 and 5 stories in review close on their existing evidence as the compiler-1 path.** They are merged, deployed and covered by CI; the review state records that nobody signed them off, not that they are unfinished. Each is marked done with the disposition `[COMPILER-1 PATH]`, the retained read, verify and execution obligations of D-3d-4 apply, and no rework is scheduled for them. |
| D-5-2 | **Epic 6 is split, not kept whole.** 6.1 (Exception provenance) and 6.2 (Exception list and disposition) stay as Run-path stories, re-homed in NE-9 for compiler-2 Runs. 6.3–6.5 (submit, approve, finalize a Result), 6.7 (Workpaper Bundle) and 6.8 (reproduce offline) are rebuilt on the artifact model inside NE-5 and NE-4, where their review, signing and export mechanics belong. 6.6 (Overview) is retired with Overview (Proposal 4). |
| D-5-3 | **Epic 7 is deferred indefinitely; Epic 8 is absorbed into NE-9; Epic 9 becomes the standing assurance epic**, generalised from Run to Task and from Target System to connector, with a proof obligation attached to every new epic rather than a final sweep. |
| D-5-4 | **Order and the first acceptance slice.** NE-1 → NE-2 → NE-3 → NE-4 → NE-7 → NE-5 → NE-6 → NE-8 → NE-9 (thin), with NE-8's mockups reviewed before NE-2's first surface is built and the Epic 9 proofs running throughout. The first acceptance (Proposal 6) is NE-1 in full, NE-2, NE-3, NE-4 and NE-7 in full for the connectors and analysis the scenario needs, NE-5, NE-6 and NE-8 in their minimal cut, and NE-9's thin proof. |

---

## 1. Disposition of the existing epics

| Epic | Disposition | What carries, what changes |
|---|---|---|
| 1 Sign in, roles, synthetic environment | DONE, EXTENDED by NE-1 | Identity, roles, audit chain, telemetry and the Northstar fixtures carry. Registrations and bindings stay for the Run path. NE-1 adds tenant, client, engagement and delegation on top of the same identity. |
| 2 Author and approve a Procedure | DONE, RETIRED as primary path (Proposal 7) | Version lifecycle, independence, frozen fields, platform-authored drafts, the compiler-1 compiler and the plan preview carry into NE-5 and NE-9. The Builder, guided preparation and the authoring assistant are retired on the write side with D-3d-4's compatibility retained. |
| 3 Run an adapter Procedure to a sealed Result | DONE, RETAINED | The Run path, unchanged; `freezeArtifact`, the Gate, the outcome table and Result sealing are what NE-4 and NE-9 generalise. |
| 4 The agent on a web Target System | REVIEW → DONE `[COMPILER-1 PATH]` (D-5-1) | The browser workspace, credential containment, capture suppression, escalation waits and the negative suites carry; the browser becomes one connector in NE-3. |
| 5 Watch, pause, replay | REVIEW → DONE `[COMPILER-1 PATH]` (D-5-1) | Live channel, controller lease, pause and cancel boundaries, Replay carry; the channel generalises to tasks in NE-2 and View workspace in NE-8. |
| 6 Investigate, review, finalize, reproduce | SPLIT (D-5-2) | 6.1, 6.2 → NE-9; 6.3–6.5, 6.7, 6.8 → NE-5 and NE-4; 6.6 retired. |
| 7 Desktop Target System | DEFERRED indefinitely | Named in the spine's deferred list; no generic desktop connector is in scope. |
| 8 Runs without anyone watching | ABSORBED into NE-9 | Schedule enqueue, missed starts, unattended completion, handover, regression-before-activation and regression visibility keep their mechanics under compiler-2 with D-3d-1's case sets; the thin proof ships first and the rest follows with its transitions blocked until built. |
| 9 Oversee and measure | GENERALISED, STANDING | 9.1, 9.2, 9.4–9.6, 9.8, 9.9 generalised (Run → Task, Target System → connector, injection surface → documents, email, calendar); 9.3 and 9.7 re-based on engagement and task metrics (AD-13 extended); every new epic below names its Epic 9 proof obligation. |

## 2. The new epics

Each epic: goal; contracts established (3d §6); requirements; stories (title — contract it establishes — test that demonstrates it); its minimal cut for the first acceptance; what it leaves blocked.

### NE-1 — Tenancy, scope and delegation

**Goal:** every protected row is scoped and enforced from the first migration; background work runs under a bounded delegation; historical chains are bound to their tenant. Runs before any personal account is connected (owner decision 3).

**Contracts:** `tenancy-v1`, `audit-event-envelope-v2`. **Requirements:** FR-53, FR-54, FR-83, FR-84, FR-80 (index rows). **ADs:** 8, 11, 22, 24.

| Story | Establishes | Demonstrated by |
|---|---|---|
| 1.1 Classify every table and write the policy inventory | classification table, policy inventory | the unclassified-table test; the inventory test |
| 1.2 Add scope columns, composite scope keys and the owner's tenant backfill | scoped columns, composite FKs | populated-upgrade proof; cross-scope FK insert refused |
| 1.3 Create the migrator and runtime roles; rotate connection strings | roles | the deployed-role fixture (`NOSUPERUSER NOBYPASSRLS`, owns no table) |
| 1.4 Force RLS with permissive grants and restrictive boundaries; the principal wrapper | policies, `SET LOCAL` wrapper | positive tests per principal class and operation; cross-boundary reads and writes through repositories and raw SQL; principal leak tests |
| 1.5 Ownership immutability trigger and the hardened draft-binding function | immutability, binding | member of A and B moving a record refused; initial binding succeeds; second binding, non-member client and plain UPDATE refused |
| 1.6 Execution delegations and service principals with column privileges | delegation, principals | revoked delegation and removed membership stop queued and resumed jobs; reconciliation principal updates only its columns |
| 1.7 Route every unit of work and raw transaction through the wrapper; drain and re-validate queued jobs | migration steps e–g | a scoped transaction without a principal refused; `SUPPORTED_SCHEMA_MIN/MAX` moved |
| 1.8 Ownership bindings for historical chains; envelope v2 for new segments | envelope v2, binding | tampered-ownership test; tenant export verifies alone; v1 bytes verified under v1 rules |

**Minimal cut:** all of it. **Blocked after:** nothing; NE-1 is a precondition. **Epic 9 proof:** the isolation suite with two tenants, two clients, two engagements, two users, on every release.

### NE-2 — Engagement, Agent Task and the agent loop

**Goal:** a draft engagement with a conversation; an Agent Task that executes tool calls durably under a delegation; waits, receipts, resumption; the live channel per task.

**Contracts:** `engagement-task-v1`, `agent-loop-v1`, `working-context-v1`, `live-channel-v2`. **Requirements:** FR-52, FR-55–59, FR-87, FR-88. **ADs:** 3, 7, 16, 17, 25, 31.

| Story | Establishes | Demonstrated by |
|---|---|---|
| 2.1 Draft engagement, client binding command, conversation with encrypted content | engagement, conversation | client-scoped read refused before binding and permitted after |
| 2.2 Agent Task aggregate: state machine, budget, lease, step ledger, revision guard | task machine, ledger | two claimants; stale resume refused; budget refused before the call |
| 2.3 The invocation model over the AI SDK as transport only; turn and call identities | `agent-loop-v1` §invocation, response contract | SDK executes nothing; two calls serial; interrupted stream not dispatched; restart replays results |
| 2.4 Parameter binding and the gate call site (with NE-3's gate; a stub `allowed`-only gate until then) | parameter binding | conflicting target refused; platform field injected; schema mistake bounded feedback |
| 2.5 Waits: `clarify`, `confirm-action`, `reconcile`, closed-option; response windows; per-task isolation | waits | free-text answer resolves a clarification; source instruction closes no wait; task B usable while A waits; expiry ends the task `CANCELED` with work kept |
| 2.6 Dispatch claims, operation and attempt identities, reconciliation outcomes | dispatch semantics | lease expiry before and after dispatch; late receipt on the original attempt; no second effect in any reconciliation case |
| 2.7 Resumption from durable state; provider continuity items under conversation controls; provider swap | resumption, continuity | kill mid-call, after result, during wait; authority re-derived; swap with no duplicate effect |
| 2.8 Self-review scoped to material content; instruction categories in context | self-review, provenance | unsupported claim not presented as a finding; deterministic check governs; behavioural injection evaluations reported per prompt version |
| 2.9 Live channel per task and engagement | `live-channel-v2` | gap and duplicate property on task streams |

**Minimal cut:** all but 2.9's engagement stream. **Blocked after:** nothing task-side. **Epic 9 proof:** the mutation harness on the loop's one call site; the injection evaluation set.

### NE-3 — Agent Permissions, connector framework, connections and the first connectors

**Goal:** authority as versioned Agent Permissions evaluated per operation; connectors with effect classes and two-axis results; per-user connections through the worker-side broker; Drive, Gmail and Calendar on personal accounts with designated resources; the disclosure policy before every model request.

**Contracts:** `permissions-v1`, `connector-v1`, `connection-v1`, `disclosure-policy-v1`. **Requirements:** FR-3, FR-60–68, FR-89. **ADs:** 4, 9, 26, 27.

| Story | Establishes | Demonstrated by |
|---|---|---|
| 3.1 Agent Permissions policy and Engagement Permissions as versioned documents; the intersection | authority computation | frozen {A,B} ∩ current {B,C} = {B}; unrelated narrowing refuses nothing |
| 3.2 `authorizeToolCall` with four outcomes; canonical resource identity; source-wins; absolute source protection | gate | killing test per rule; alias, shortcut, moved file, redirect, unresolvable target; mutation harness |
| 3.3 Permissions Summary to the model; internal tools with `connection: none` | summary | the model sees no Permissions document; internal tool passes the gate without a connection rule |
| 3.4 Connector descriptor, port, two-axis result, conformance suite, hostile fake | `connector-v1` | timeout after dispatch is `unknown-after-dispatch`; unverifiable success fails validation; empty versus unreachable |
| 3.5 Connections, secrets under `CONNECTION_SECRET_KEY`, disconnect ordering | `connection-v1` §connections | dispatch after local disable refused; refresh after disable cannot reactivate |
| 3.6 OAuth: attempt, PKCE, sealed handoff, callback validation, mix-up defence per provider | §attempt, §callback | swapped state, wrong user, wrong tenant, replay, expired attempt; both mix-up defences |
| 3.7 The broker: exchange attempts, no code reuse after possible dispatch, refresh recovery, rule `no-connection-broker-in-web` | §broker | failed-before-dispatch retried; lost response after redemption never resends; duplicate exchange jobs; refresh loss follows recorded behaviour; boundary plants |
| 3.8 Google Drive connector (read, snapshot, list, write-output to designated folders) | first connector | conformance suite; personal-account acceptance on designated folders |
| 3.9 Gmail connector (read a designated label, attachments as `received` snapshots, draft; send behind `external-effect`) | second connector | conformance; a send needs confirmation with bound details |
| 3.10 Calendar connector (read, create-event behind `external-effect`, read-back) | third connector | conformance; created event read back and receipted |
| 3.11 Browser as a connector under the Agent Permissions | `agent-workspace-v1` re-homed | existing browser suites pass under the gate |
| 3.12 Disclosure policy per tenant and engagement, applied before every outbound request including fallback | `disclosure-policy-v1` | restricted item blocks primary and fallback; derived summary inherits; unknown classification blocks |
| 3.13 Bound `ResolvedCredential` for connections; the credential guard over connector traffic | containment | a credential outside its bound destination refused; scans on every freeze and model request |

**Minimal cut:** 3.1–3.8, 3.10 (calendar create is the one external effect), 3.12, 3.13; 3.9 read-only (draft and send behind the gate but not exercised beyond refusal). **Blocked after:** OneDrive, SharePoint, Outlook, Todoist, Planner, GitHub, databases (the phased list). **Epic 9 proof:** the conformance suite per adapter; the OAuth negative list as runtime tests; enterprise requirements documented, not claimed.

### NE-4 — Sources, evidence, working material and derived outputs

**Goal:** every source read is a snapshot with identity and quality; analysis runs on working copies; derived outputs are registered with derivations and validations; three sealing units; governed retention; engagement export.

**Contracts:** `evidence-package-v2`, `acquisition-v1`, `derivation-v1`, `input-quality-v1`, `retention-v1`, `export-v2`. **Requirements:** FR-69–72, FR-45–47 (export). **ADs:** 5, 6, 14, 28. Absorbs Epic 6's 6.7 and 6.8.

| Story | Establishes | Demonstrated by |
|---|---|---|
| 4.1 Owner-namespaced reservations and the new kinds through `freezeArtifact` | `evidence-package-v2` | every owner through reserve, upload, verify, register; redelivery reconciles |
| 4.2 Source snapshots with identity, limitations and acquisition records; content versus acquisition identity | `acquisition-v1` | unchanged reacquisition on a later date; retry versus new observation; identical bytes from two sources |
| 4.3 Extraction records with coverage and consistency; the two-axis result on acquisition | extraction | partial at page 3; `coverage: complete, consistency: unknown`; empty under contract |
| 4.4 Source evolution relationships, impact records versus notifications | supersession | next-period extract flags nothing; a correction flags the dependent finding |
| 4.5 Working material revisions and copy steps | working material | a revision cannot be cited; promotion registers a derived output |
| 4.6 Derivations with retained method objects; the four check kinds; validation records; recoverable registration | `derivation-v1` | repeatable-but-wrong method stays unsupported; checksum-only refused; crash between upload and metadata reconciled |
| 4.7 Reproducibility comparators and re-execution as a recorded validation (with NE-7) | reproducibility | byte and semantic comparators; model-assisted step never claims identity |
| 4.8 Independent input-quality dimensions and dependency-specific propagation | `input-quality-v1` | current-but-partial; complete-but-out-of-period; post-period report with in-period content; unknown freshness |
| 4.9 Task manifests (always recorded), supplements, grants by owner | sealing | incomplete manifest named; late receipt as supplement; grant for A cannot read B |
| 4.10 Retention decisions, holds, dependencies, availability status | `retention-v1` | deletion under hold refused; export names the deleted item |
| 4.11 Engagement export and offline reproduction (Epic 6.7, 6.8 rebuilt) | `export-v2` | a tenant export verifies alone; a derivation reproduces offline from the bundle |

**Minimal cut:** 4.1–4.6, 4.8, 4.9; 4.7 for the scenario's one script; 4.10 decision and hold only; 4.11 export only. **Epic 9 proof:** the integrity sweep over every owner kind; the retention negative tests.

### NE-5 — Artifacts, claims, review, approval and produced files

**Goal:** versioned artifacts with claims and citations; platform-owned support status; revision-bound decisions; approval binding the deliverable; renderings validated beyond a round trip; issuance as its own event. Absorbs Epic 6's 6.3–6.5.

**Contracts:** `artifact-version-v1`, `rendering-v1`. **Requirements:** FR-73–76, FR-90, FR-40–44 as re-based. **ADs:** 7, 29.

| Story | Establishes | Demonstrated by |
|---|---|---|
| 5.1 Artifact and immutable version; lifecycle records; frozen-field triggers | aggregates | content update refused through repository and raw SQL; decisions projected |
| 5.2 Claims, classes, citations, support-status transitions | claims | factual without citation fails; generated narrative refused; pending-review for proposed interpretations; model `supported` moves nothing |
| 5.3 Dependencies, impact records, `needs-reconsideration` through `mint-platform-draft` | reconsideration | correction flags dependents; observation notifies only |
| 5.4 Review request, scoped approval authority, independence over humans, revision-bound decisions | approval | Audit Manager without membership refused; contributor self-approval refused; stale revision refused; concurrent edit lands on the old version |
| 5.5 Approval binding (content, claims, citations, assessments, template version, rendering) | binding | later rendering not approved; one review satisfies both where the pack allows |
| 5.6 Renderings: `.docx` and `.xlsx` in the sandbox (NE-7), validation layers, feature matrix, blocking defects, PDF export | `rendering-v1` | embedded screenshot present; stale formula cache blocking; omitted limitation blocking; harmless limitation recorded |
| 5.7 Draft sharing versus issuance; output-location writes with receipts | issuance | draft share labelled and receipted; issuance without approval refused; source location refused |
| 5.8 Example pack artifact types: plan, procedure, request list, working paper, finding, report | types | a firm pack with different types runs end to end |

**Minimal cut:** 5.1–5.5, 5.6 for `.docx` only, 5.7 draft share, 5.8's working paper and finding. **Blocked after:** `.xlsx` rendering, additional formats, multi-reviewer workflows the platform lacks. **Epic 9 proof:** the fidelity test set; the circular-citation and provenance negatives.

### NE-6 — Memory, retrieval, skills and methodology packs

**Goal:** scoped retrieval; six memory scopes with ownership and verification status; skills and packs as versioned tenant data under the mandatory minimum; a usable start without a pack.

**Contracts:** `memory-v1`, `skill-v1`, `methodology-pack-v1`, `run-level-gate-v2` (classification). **Requirements:** FR-77–80, FR-85, FR-86. **ADs:** 32, 33.

| Story | Establishes | Demonstrated by |
|---|---|---|
| 6.1 Retrieval index rows under RLS; filter before rank; coverage in results; direct full reads | retrieval | client-B item absent; stale index then direct read; period spanning two policy versions |
| 6.2 Memory items: scopes, ownership, delegation, lifecycle and verification status | `memory-v1` | explicit instruction `active` and `user-reported`; inferred item `proposed` and invisible as instruction; non-owner refused |
| 6.3 Configured precedence and proposed conflicts | precedence | two packs resolve differently; prose conflict recorded not decided |
| 6.4 Pack schema, validation, activation as an audited change; the example pack from `templates.ts` | `methodology-pack-v1` | example pack validates; undefined state refused; activation audited; engagement keeps its version |
| 6.5 Gate rule classification (platform-mandatory, methodology-configurable, legacy-template-specific) | `run-level-gate-v2` | a pack omitting a mandatory rule refused; every rule classified |
| 6.6 Skills: descriptor, admission, discovery, loading, recording | `skill-v1` | unmet capability reported and denied; unapproved skill not loaded; task records versions |
| 6.7 Bootstrap without a pack; starter selection; pack proposal from documents | bootstrap | useful work before selection; promotion blocked naming the configuration; proposal `proposed` until an Admin approves it as configuration |
| 6.8 Compaction records and context re-evaluation on permission change | `working-context-v1` §compaction | correction survives compaction; revoked content absent on resume |

**Minimal cut:** 6.1 (index over artifacts and messages), 6.2 for user-preference, client-knowledge and engagement-facts, 6.4 with the example pack, 6.6 for two skills, 6.7 bootstrap. **Blocked after:** cross-scope promotion beyond the same client; embeddings until a disclosure-approved provider is selected. **Epic 9 proof:** the scope negatives on retrieval through raw SQL.

### NE-7 — Controlled execution environment and document processing

**Goal:** a documented, tested sandbox with a recorded profile, network-disabled; document extraction with region binding and spreadsheet calculation rules; the rendering engine.

**Contracts:** `code-execution-v1`, `document-extraction-v1`. **Requirements:** FR-81, FR-82. **ADs:** 30.

| Story | Establishes | Demonstrated by |
|---|---|---|
| 7.1 Select and document the backend and profile (an implementation selection recorded with rationale); `no-code-execution-in-web` | D-3b-2 | the deployed-profile assertion; boundary plants |
| 7.2 `CodeExecution` port, supervisor, mounts, output collection, limits, execution record as `execution-log` | port | isolation negatives; forged stdout ignored; unsafe output rejected; limits end with diagnostics |
| 7.3 `local` mode: development-only, synthetic fixtures, never a fallback | mode | isolation unavailable fails; `local` refused in production |
| 7.4 Extraction programs: PDF with page images, `.docx`, `.xlsx` with formula, cached and recalculated values, CSV, email MIME, OCR | `document-extraction-v1` | per-format cases; stale cache detected; macro not executed; corrupt file `unsupported` |
| 7.5 New substrates and locator grammars; corroboration against the preserved representation | substrates | wrong claim `contradicted`; unresolved OCR `not-machine-checkable` |
| 7.6 Rendering engine images for `.docx` and `.xlsx` and PDF export | `RenderingEngine` | round trip plus the NE-5 fidelity set |

**Minimal cut:** 7.1–7.4 for CSV, `.xlsx` read and PDF text, 7.5 for `sheet` and `pdf`, 7.6 for `.docx`. **Blocked after:** network exceptions; OCR beyond the acceptance fixture. **Epic 9 proof:** the isolation suite on every release against the deployed profile.

### NE-8 — The experience: workspace, Needs you, Settings

**Goal:** EXPERIENCE.md revision 2 built: conversation-primary workspace, inspection panel, activity summary, Needs you, Connections and Methodology settings, View workspace, readable states, one decision surface per decision. Mockups reviewed first.

**Contracts:** EXPERIENCE.md rev 2, DESIGN.md delta. **Requirements:** FR-59, FR-48 re-based, NFR accessibility. **ADs:** 17 (streams), Proposal 4 U1–U11.

| Story | Establishes | Demonstrated by |
|---|---|---|
| 8.1 Desktop and narrow-screen mockups or prototype for the six scenes; owner review | U11 gate | the review record |
| 8.2 Shell: Engagements (with Scheduled checks and Legacy procedures views), Needs you, Settings; breadcrumbs; tenant and engagement in the header | U2 | shell and breadcrumb tests; Needs you Banner when not loaded |
| 8.3 Workspace: thread, attributed entries, activity summary, inspection panel with resize, expand, close and return | U3, U4 | context survives opening evidence, changing panels, returning, new activity; keyboard citation inspection |
| 8.4 Reading view and review mode for artifacts; result and quality summaries | U4 | normal reading without technical details; matters needing review listed |
| 8.5 Decision surfaces: clarify, confirm-action with bound details, reconcile with permitted actions only, approval, issuance | D-4-2 | no duplicate confirmation; stale details re-asked |
| 8.6 Connections and Methodology settings; Connect from the conversation and return; readable resource names | U4 | selection by readable identity; consent alone makes nothing usable |
| 8.7 View workspace for browser tasks; pause, stop, take control across widths | U10 | narrow-screen pause and stop; Stop requested versus ceased |
| 8.8 Memory inline "Remembered" and proposal cards | U4 | explicit instruction shows Remembered with a link |
| 8.9 Readable state families and the fixed-copy tests; the six-scene visual acceptance | U5, U11 | `status.test.ts` over DESIGN.md; the visual acceptance set |

**Minimal cut:** 8.1–8.6, 8.8, 8.9; 8.7 for pause and stop. **Epic 9 proof:** WCAG 2.1 AA on the six scenes; the interaction tests.

### NE-9 — Promotion and recurring checks (absorbs Epic 8; re-homes Epic 6.1, 6.2)

**Goal:** a method artifact by selection; compiler-2 with `assist`; a Procedure Version that goes through the existing lifecycle; scheduled Runs under a delegation with no invented tests; reviewed regression case sets; FR-51 change classes; the thin proof first.

**Contracts:** `promotion-v1`, `executable-plan-v2`, `regression-case-set-v1`, `run-level-gate-v2` (pack check sets). **Requirements:** FR-51, FR-13–18 as applied, FR-72, FR-84. **ADs:** 19, 21, 23, 34.

| Story | Establishes | Demonstrated by |
|---|---|---|
| 9.1 `promotable-method` schema and promotion by selection | selection rule | calendar invitation, failed attempts and exploratory branch excluded; period rule included; historical acquisition id refused |
| 9.2 Compiler-2: vocabulary with `assist`, deterministic over a validated specification, unresolved issues, reviewable mapping | `executable-plan-v2` | identical bytes twice; ambiguity blocks submission; model discrepancy blocks activation |
| 9.3 `compiler = 2` Procedure Versions through the existing lifecycle, exercised with compiler-2 | binding | author cannot approve; frozen fields; changed rule requires regression and cannot activate while deferred |
| 9.4 Scheduled Runs under an activation delegation; duplicate suppression; interruption recovery; pinned-definition verification | thin proof | duplicate delivery once; restart resumes; revocation between steps stops dispatch |
| 9.5 Execution with `assist` steps; quality checks constraining dependents; the Gate over the pack's check set; four statuses on the Result | execution | no model turn outside `assist`; incomplete input yields Inconclusive with visible exceptions and `execution: completed` |
| 9.6 FR-51 change classes: ordinary inputs, access failure with recovery request, material change minting a draft, identity-preserving rename | change classes | rename runs; boundary move mints a draft; reconnect by display name refused |
| 9.7 Signals and separate investigative tasks with the impact path | investigation | result digest unchanged; impact record and rerun proposal |
| 9.8 Exception provenance and disposition for compiler-2 Runs (Epic 6.1, 6.2 re-homed) | Run path | existing tests with a compiler-2 version |
| 9.9 Regression case sets: versioned, reviewed, bound to the candidate; expected-difference review (Epic 8.5, 8.6 re-based) | `regression-case-set-v1` | reproduced-but-wrong result fails; unsuitable last Run refused; intentional correction passes only its approved expectations; live source refused |
| 9.10 Missed starts, handover under succession, drift detection, notification policy (Epic 8.2–8.4 re-based) | later | transitions blocked until each lands |

**Thin proof (first acceptance):** 9.1–9.6 with 9.5's `assist` unused by the scenario. **Later:** 9.7 beyond a signal record, 9.9, 9.10. **Epic 9 proof:** the minimum recurring safety set on every release.

### Epic 9 — Assurance (standing)

Runs throughout, generalised: isolation suite (NE-1), loop mutation harness and injection evaluations reported per prompt version (NE-2), connector conformance and OAuth negatives (NE-3), integrity sweep and retention negatives (NE-4), fidelity and provenance negatives (NE-5), retrieval scope negatives (NE-6), sandbox isolation against the deployed profile (NE-7), accessibility and the six-scene visual acceptance (NE-8), minimum recurring safety (NE-9); engagement and task metrics (AD-13); the credential-containment acceptance scans over every new persistence subject discovered from the catalogue.

## 3. Contract → epic map (the 3d obligation)

| Contract | Epic and stories | Contract | Epic and stories |
|---|---|---|---|
| `tenancy-v1` | NE-1 1.1–1.7 | `derivation-v1` | NE-4 4.5–4.7 |
| `audit-event-envelope-v2` | NE-1 1.8 | `input-quality-v1` | NE-4 4.8 |
| `engagement-task-v1` | NE-2 2.1, 2.2, 2.5, 2.6 | `retention-v1` | NE-4 4.10 |
| `agent-loop-v1` | NE-2 2.3, 2.4, 2.7, 2.8 | `export-v2` | NE-4 4.11 |
| `working-context-v1` | NE-2 2.7; NE-6 6.8 | `artifact-version-v1` | NE-5 5.1–5.5, 5.7 |
| `live-channel-v2` | NE-2 2.9 | `rendering-v1` | NE-5 5.6; NE-7 7.6 |
| `permissions-v1` | NE-3 3.1–3.3 | `memory-v1` | NE-6 6.2, 6.3 |
| `connector-v1` | NE-3 3.4, 3.8–3.11 | `skill-v1` | NE-6 6.6 |
| `connection-v1` | NE-3 3.5–3.7, 3.13 | `methodology-pack-v1` | NE-6 6.4, 6.7 |
| `disclosure-policy-v1` | NE-3 3.12 | `run-level-gate-v2` | NE-6 6.5; NE-9 9.5 |
| `evidence-package-v2` | NE-4 4.1, 4.9 | `code-execution-v1` | NE-7 7.1–7.3 |
| `acquisition-v1` | NE-4 4.2–4.4 | `document-extraction-v1` | NE-7 7.4, 7.5 |
| `promotion-v1` | NE-9 9.1, 9.3, 9.6, 9.7 | `executable-plan-v2` | NE-9 9.2 |
| `regression-case-set-v1` | NE-9 9.9 | EXPERIENCE.md rev 2 | NE-8 |

## 4. Order, dependencies and the first acceptance slice (D-5-4)

```
NE-1 tenancy ──► NE-2 task + loop ──► NE-3 permissions + connectors ──► NE-4 evidence ──► NE-7 sandbox ──► NE-5 artifacts ──► NE-6 memory + packs ──► NE-8 experience ──► NE-9 thin proof
                 ▲ NE-8 mockups reviewed before NE-2's first surface                                                          Epic 9 proofs throughout
```

- NE-1 is complete before any personal account is connected (owner decision 3).
- NE-2's stub gate is replaced by NE-3's in 3.2; nothing ships to the acceptance environment with the stub.
- NE-7 precedes NE-5's rendering and NE-4's re-execution validation.
- NE-8 mockups (8.1) are reviewed before 8.2; surfaces land beside the epics they expose, so the acceptance is walked in the real shell.
- The first acceptance slice is the union of the minimal cuts above and is what Proposal 6 specifies; it is a slice of every epic except Epic 7, not a separate prototype.
- After the first acceptance: the rest of NE-3's phased connectors, NE-5's `.xlsx` and formats, NE-6's promotion and embeddings, NE-7's OCR and network contract, NE-9 9.7–9.10.

## 5. What stays explicitly blocked or deferred

Epic 7 (desktop); NE-3's later connectors; sandbox network exceptions; authored formats beyond `.docx` and `.xlsx`; multi-reviewer workflows the platform lacks; cross-scope memory promotion beyond the same client; embeddings pending a disclosure-approved provider; NE-9's missed starts, handover under succession, drift detection and notification policy, each with its transition blocked; regression-gated activation until 9.9 lands (a version stays `APPROVED` pending regression).

## Why

Direction §I ("assess existing epics"), `analysis-prd-epics.md` §3–§4, Proposals 3a–3d (contracts and decisions), Proposal 4 (NE-8), owner decisions 1–3 of 2026-09-24. No implementation is authorised; the epic plan is the input to Proposal 6 (the first acceptance) and Proposal 7 (the codebase disposition and sprint-status changes).
