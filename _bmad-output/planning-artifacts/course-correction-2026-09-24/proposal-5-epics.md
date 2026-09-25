# Proposal 5 of 7 — Epics: disposition of Epics 1–9 and the new epic plan

Terminology note (owner correction, 2026-09-25): the concept formerly named **Mandate** is named **Permissions** throughout the course-correction artifacts — Agent Permissions (the bounded authority granted to the agent for work in an engagement), Engagement Permissions, Permissions Policy (the administrator ceiling), Permissions Version, Effective Permissions (what each proposed operation is authorised against) and Permissions Summary (what the model is shown). This is a terminology change only; every intersection, versioning, confirmation, source-protection, administrator-limit, revocation and enforcement rule is unchanged, and provider or OAuth connection scopes remain distinct from agent permissions. Contract and module names follow: `permissions-v1`, `packages/domain/src/permissions/`, `permissions_policy`, `engagement_permissions`, `authorizeToolCall(effectivePermissions, call)`.


Status: revised on 2026-09-25 against the consolidated planning baseline — PRD revision 4 (Proposals 1, 2, 4b), architecture spine revision 5 with its contract register (3a–3d, 4b), EXPERIENCE.md and DESIGN.md revision 2 under `ux-designs/ux-Zobba-2026-09-25/` (Proposals 4, 4b), the Zobba design pack v1.0, the owner's terminology (Permissions) and role consolidation (Auditor · Audit manager · Admin). Awaiting a / e / s. Maps every approved contract (spine revision 5 register) to the epic and stories that establish it and the tests that demonstrate it, as 3d's approval requires; adds traceability for FR-91–FR-96 (model policy, roles, invitations and removal, review notes); names what existing work is retained; and shows how the first usable conversational slice grows into the complete agreed acceptance journey. **No implementation is authorised**; sprint-status changes are made by Proposal 7's disposition, not here. Standing owner constraints carried into every story: "Do not hard-code the scenario into the harness."; "Initial connector testing will use my personal Google, Microsoft and other authorised accounts—not employer systems or company information."; "Personal-account testing must not be represented as proof that every organisational integration works."; "Do not change application code or retire existing tests prematurely merely to make the planning documents pass; tests move with their corresponding implementation and legacy disposition."

Baseline (`sprint-status.yaml` on `main` `c18ad36`): Epic 1 done (8 stories), Epic 2 done (8), Epic 3 done (11), Epic 4 three done and nine in review, Epic 5 eight in review, Epics 6–9 backlog (8, 7, 6, 9 stories). Everything in Epics 1–5 is on `main` and deployed; it is the compiler-1 path.

Owner decisions this proposal asks for:

| Decision | Proposed choice |
|---|---|
| D-5-1 | **Epic 4 and 5 stories in review close on their existing evidence as the compiler-1 path.** They are merged, deployed and covered by CI; the review state records that nobody signed them off, not that they are unfinished. Each is marked done with the disposition `[COMPILER-1 PATH]`, the retained read, verify and execution obligations of D-3d-4 apply, and no rework is scheduled for them. |
| D-5-2 | **Epic 6 is split, not kept whole.** 6.1 (Exception provenance) and 6.2 (Exception list and disposition) stay as Run-path stories, re-homed in NE-9 for compiler-2 Runs. 6.3–6.5 (submit, approve, finalize a Result), 6.7 (Workpaper Bundle) and 6.8 (reproduce offline) are rebuilt on the artifact model inside NE-5 and NE-4, where their review, signing and export mechanics belong. 6.6 (Overview) is retired with Overview (Proposal 4). |
| D-5-3 | **Epic 7 is deferred indefinitely; Epic 8 is absorbed into NE-9; Epic 9 becomes the standing assurance epic**, generalised from Run to Task and from Target System to connector, with a proof obligation attached to every new epic rather than a final sweep. |
| D-5-4 | **Order and the first acceptance slice.** NE-1 → NE-2 → NE-3 → NE-4 → NE-7 → NE-5 → NE-6 → NE-8 → NE-9 (thin), with NE-8's identity assets (8.0) landed and its screen review (8.1) done before NE-2's first surface is built and the Epic 9 proofs running throughout. The first acceptance (Proposal 6) is NE-1 in full, NE-2, NE-3, NE-4 and NE-7 in full for the connectors and analysis the scenario needs, NE-5, NE-6 and NE-8 in their minimal cut, and NE-9's thin proof. |
| D-5-5 | **Four gated delivery slices, each a demonstrable increment of the one acceptance journey (§4).** Slice 0 proves isolation before any personal account is connected; Slice 1 is the first usable conversational slice (ask about authorised files, get an attributed, cited, quality-stated answer, with refusals recorded); Slice 2 adds analysis in the sandbox and a reviewable working paper with corrections and a memory proposal; Slice 3 adds correspondence, one confirmed external effect, independent review with notes and approval by an invited second person; Slice 4 adds promotion and the unattended rerun and is the complete agreed acceptance journey (Proposal 6). A slice is complete only when its validation gate (its Epic 9 proofs, its design-acceptance scenes, its behavioural checks) passes; nothing reaches the acceptance environment with NE-2's stub gate. |
| D-5-6 | **A story whose surface the pack does not cover cannot start until that surface is designed under the pack's rules and reviewed.** The design-acceptance register (4b §10) is part of delivery: each undesigned screen is attached to the story that builds it and to the slice gate that first needs it (§5); the review is a story-level entry criterion, not a final sweep. The 23 reference screens are reviewed against the six-scene set in 8.1 before 8.2 begins. |
| D-5-7 | **Invitations, removal and the Reviews queue are in the first acceptance, not after it.** The acceptance journey's second-person approval needs a second person who was invited by link (FR-95) and who reviews from Reviews with anchored notes (FR-96); so NE-1 1.9–1.11, NE-5 5.9 and NE-8 8.10–8.11 sit in Slice 3's minimal cut. The alternative — seeding the second person and approving from the bell with no notes — would demonstrate approval without demonstrating the role, invitation and review-note requirements the owner approved. |

---

## 1. Disposition of the existing epics

| Epic | Disposition | What carries, what changes |
|---|---|---|
| 1 Sign in, roles, synthetic environment | DONE, EXTENDED by NE-1 | Identity, roles, audit chain, telemetry and the Northstar fixtures carry. Registrations and bindings stay for the Run path. NE-1 adds tenant, client, engagement and delegation on top of the same identity, and the three tenant roles (Auditor · Audit manager · Admin) as capability groups with invitations and removal (FR-94, FR-95); the `poc-administrator` identifier is displayed "Admin" until Proposal 7's rename story. |
| 2 Author and approve a Procedure | DONE, RETIRED as primary path (Proposal 7) | Version lifecycle, independence, frozen fields, platform-authored drafts, the compiler-1 compiler and the plan preview carry into NE-5 and NE-9. The Builder, guided preparation and the authoring assistant are retired on the write side with D-3d-4's compatibility retained. |
| 3 Run an adapter Procedure to a sealed Result | DONE, RETAINED | The Run path, unchanged; `freezeArtifact`, the Gate, the outcome table and Result sealing are what NE-4 and NE-9 generalise. |
| 4 The agent on a web Target System | REVIEW → DONE `[COMPILER-1 PATH]` (D-5-1) | The browser workspace, credential containment, capture suppression, escalation waits and the negative suites carry; the browser becomes one connector in NE-3. |
| 5 Watch, pause, replay | REVIEW → DONE `[COMPILER-1 PATH]` (D-5-1) | Live channel, controller lease, pause and cancel boundaries, Replay carry; the channel generalises to tasks in NE-2 and View workspace in NE-8. |
| 6 Investigate, review, finalize, reproduce | SPLIT (D-5-2) | 6.1, 6.2 → NE-9; 6.3–6.5, 6.7, 6.8 → NE-5 and NE-4 (6.3–6.5 gain review notes and return per FR-96); 6.6 retired with Overview (the pack's Home and notification panel replace it). |
| 7 Desktop Target System | DEFERRED indefinitely | Named in the spine's deferred list; no generic desktop connector is in scope. |
| 8 Runs without anyone watching | ABSORBED into NE-9 | Schedule enqueue, missed starts, unattended completion, handover, regression-before-activation and regression visibility keep their mechanics under compiler-2 with D-3d-1's case sets; the thin proof ships first and the rest follows with its transitions blocked until built. |
| 9 Oversee and measure | GENERALISED, STANDING | 9.1, 9.2, 9.4–9.6, 9.8, 9.9 generalised (Run → Task, Target System → connector, injection surface → documents, email, calendar); 9.3 and 9.7 re-based on engagement and task metrics (AD-13 extended); every new epic below names its Epic 9 proof obligation. |

### 1a. Retained work register — what carries, and where it is reused

Every mechanism below exists on `main` today, stays in place, and is reused by the named epic. Nothing here is rebuilt; each is generalised behind its existing tests, which move only with their implementation story (D-3d-4).

| Retained mechanism (where it lives) | Reused by |
|---|---|
| Better Auth identity, application-owned roles read per request, `requireAction`, denial sentences, `seed-identity` | NE-1 (tenant membership and delegation layered on the same identity; FR-94 capability groups); the identifiers renamed only in Proposal 7 |
| Audit event chain (RFC 8785 canonicalisation, locked heads, families), `sanitizeTelemetryFields`, `TELEMETRY_FIELD_KEYS` | NE-1 1.8 (envelope v2, ownership bindings); every new epic's events; AD-10 extended |
| The release-only migrator, `SUPPORTED_SCHEMA_MIN/MAX`, the populated-upgrade proof | NE-1 (scoped migration, drain and re-validate); every migration |
| pg-boss queues with transaction-bound send, recovery sweeps, the maintenance principal | NE-2 (task jobs), NE-3 (broker jobs), NE-9 (scheduler) |
| `freezeArtifact` (reserve, upload, verify, register), `S3EvidenceStore.putIfAbsent`, credential guard, sealed packages and the integrity sweep | NE-4 4.1 (owner-namespaced reservations, new kinds), 4.9; Epic 9 integrity proof over every owner kind |
| `run_request_token` "first use decides" | NE-3 3.4 connector idempotency; NE-2 2.6 dispatch claims |
| Run-level Gate, `GATE_CHECKS`, outcome table, `completeRun`, Result sealing, four separate statuses | NE-9 9.5 (pack check sets over the closed mechanism), NE-6 6.5 (rule classification) |
| Deterministic evaluation (`evaluateComplianceRecord`), compiler-1 and `executable-plan-v1` | compiler-2's `evaluate` step where the grammar applies (NE-9 9.2); compiler-1 retained for existing versions |
| Procedure Version lifecycle, independence rule, frozen-field triggers, platform-authored drafts (`mint-platform-draft`) | NE-9 9.3 (compiler-2 versions through the same lifecycle), NE-5 5.3 (impact records through the same minting path), NE-9 9.11 (model replacement as a proposed change) |
| Browser workspace (`PlaywrightBrowserExecution`, egress allowlist, capture suppression, form sign-in origin check), `credential-containment-v1` | NE-3 3.11 (the browser as one connector under the Permissions gate), 3.13 |
| Durable waits (`run_wait`, one-open-wait, delayed wake, recovery sweep), closed-option Escalations, receipts | NE-2 2.5 (task waits `clarify`, `confirm-action`, `reconcile` on the same table shape), NE-8 8.5 |
| Live channel (LISTEN/NOTIFY, SSE cursor and heartbeat), `LiveGate`, controller lease and `run.control-transfer` | NE-2 2.9 (`live-channel-v2` per task and engagement), NE-8 8.7 (View workspace, Take over) |
| Pause and cancel at boundaries, `Stop requested` versus recorded cessation, `lifecycle.cancellation-superseded` | NE-2 2.5, NE-8 8.5 and 8.7 |
| Replay, Run Detail (five tabs), Live View, the Legacy procedures surfaces | NE-8 8.2 (reachable by their auditors), NE-9 (scheduled-check Runs reuse Run Detail) |
| Auditor Workspace v1.1 plumbing: encrypted conversation content, server-side interpretation before action, receipt-bound commands (received → interpreted → queued → applied / refused / superseded), audit-chained history | NE-2 2.1 (conversation), 2.5 (receipts); the fixed-vocabulary command console itself is not the destination |
| Evaluation review ledger, human decisions overlay, `run_result_review` | NE-9 9.8 (Exception provenance and disposition), NE-5 5.4 (revision-bound decisions modelled on it) |
| Northstar synthetic systems, golden populations, expectation files read off disk (AD-12) | the compiler-1 example pack (NE-6 6.4); Proposal 6's synthetic data follows the same "acceptance data, not harness behaviour" rule |
| The mutation harnesses (`verify-*-mutations.mjs`, detached worktree, anchor drift), credential-containment acceptance scans, the isolation of test databases | Epic 9 standing: the loop's one call site (NE-2), the gate (NE-3), every new persistence subject discovered from the catalogue |
| `copy.test.ts`, `status.test.ts`, `tokens.test.ts`, `stylesheet.test.ts`, `roles.test.ts`, `denial-strings.test.ts` reading the planning documents off disk | NE-8 8.0 and 8.9 re-point them to the revision-2 documents and the pack's `zobba-tokens.json` **in the story that builds each surface**; until then they read the 2026-09-01 documents, which were left intact |

## 2. The new epics

Each epic: goal; contracts established (3d §6); requirements; stories (title — contract it establishes — test that demonstrates it); its minimal cut for the first acceptance; what it leaves blocked.

### NE-1 — Tenancy, scope and delegation

**Goal:** every protected row is scoped and enforced from the first migration; background work runs under a bounded delegation; historical chains are bound to their tenant. Runs before any personal account is connected (owner decision 3).

**Contracts:** `tenancy-v1` (as amended by 4b §7: three role groups, invitation lifecycle, removal commands, last-administrator rule, revocation on dispatch and resume), `audit-event-envelope-v2`. **Requirements:** FR-53, FR-54, FR-83, FR-84, FR-80 (index rows), **FR-94, FR-95**. **ADs:** 8, 11, 22, 24.

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
| 1.9 Tenant roles as capability groups — Auditor · Audit manager · Admin; engagement assignments (lead auditor, auditor, reviewer) as scoped responsibilities; Reviews visibility by responsibility and capability; `poc-administrator` displayed "Admin" | `tenancy-v1` §roles, `permissions-v1` §visibility (FR-94) | an Admin who approved a pack cannot approve a working paper, a finding, a report or a check definition and cannot issue; a global Audit manager without engagement membership reaches nothing; a role change leaves contributor restrictions in force; Reviews absent for a person with no review responsibility |
| 1.10 Invitations: create bound to recipient, tenant, role assignments and proposed engagement access; single-use, expiring, revocable; Copy invitation link; acceptance by a verified identity; the secret protected from model context and ordinary logs | `tenancy-v1` §invitations (FR-95) | wrong recipient, expired, replayed and revoked invitations refused; an inviter who lost authority before acceptance; a forwarded link confers nothing; the secret absent from telemetry, audit payloads and any model request (containment scan); no open sign-up path (the existing `disableSignUp` proof re-asserted) |
| 1.11 Removal: from an engagement, from a tenant, and the separate account action; last active administrator cannot be removed or demoted (transactional, the existing last-holder lock reused); pending invitations and affected delegations handled explicitly; revocation enforced on protected requests and on dispatch, resume, retry and background work (with 1.6) | `tenancy-v1` §removal (FR-95) | concurrent last-administrator removal refused; cross-tenant membership preserved on tenant removal; background dispatch after removal refused with a reason; a dispatched external action keeps its reconciliation path; reinstatement restores no old grant; authorship and approvals preserved |

**Minimal cut:** all of it (1.9–1.11 are exercised by Slice 3's invited second person; their storage and enforcement land with the scoped migration). **Blocked after:** organisation-managed connections, enterprise SSO and provisioning, transactional email for invitations. **Epic 9 proof:** the isolation suite with two tenants, two clients, two engagements, two users, on every release; the invitation and removal negatives as runtime tests. **Design gaps attached (D-5-6):** invitation creation and acceptance screens (RS 23 partly; acceptance not designed); tenant switching for a person in two firms.

### NE-2 — Engagement, Agent Task and the agent loop

**Goal:** a draft engagement with a conversation; an Agent Task that executes tool calls durably under a delegation; waits, receipts, resumption; the live channel per task.

**Contracts:** `engagement-task-v1`, `agent-loop-v1` (as amended by 4b §6: invocation record with requested and actual configuration per call; boundary rule for model changes), `working-context-v1`, `live-channel-v2`. **Requirements:** FR-52, FR-55–59, FR-87, FR-88, **FR-91**. **ADs:** 3, 7, 16, 17, 25, 31.

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
| 2.10 Model and effort per invocation: the task's selected or default configuration; requested versus actual provider, deployment, model id, prompt version and effort recorded per model call and linked to the step; per-adapter effort mapping with a closed vocabulary; a change applies at the next safe boundary and regenerates nothing | `agent-loop-v1` §invocation record (FR-91) | a step with two model calls retains both configurations; a non-model step acquires no model setting; an unsupported effort is unavailable or explicitly remapped and recorded, never silently ignored; a mid-task change applies from the next boundary with no regenerated or repeated work; higher effort grants no budget |

**Minimal cut:** all but 2.9's engagement stream; 2.10 with the administrator default only until NE-3 3.14 supplies the picker set. **Blocked after:** nothing task-side; automatic task-based model routing is not implied by anything here (4b §6). **Epic 9 proof:** the mutation harness on the loop's one call site; the injection evaluation set. **Design gaps attached:** draft engagement without a client and the client-binding moment (built in 8.3, designed before Slice 1).

### NE-3 — Agent Permissions, connector framework, connections and the first connectors

**Goal:** authority as versioned Agent Permissions evaluated per operation; connectors with effect classes and two-axis results; per-user connections through the worker-side broker; Drive, Gmail and Calendar on personal accounts with designated resources; the disclosure policy before every model request.

**Contracts:** `permissions-v1`, `connector-v1`, `connection-v1`, `disclosure-policy-v1` (as amended: model availability per engagement, one enforcement path), **`model-policy-v1` (new)**. **Requirements:** FR-3, FR-60–68, FR-89, **FR-92**. **ADs:** 4, 9, 26, 27. Connections are user-owned in the first release (D-4b-3): credentials owned by and authorised for a user, whatever the provider account is; organisation-managed connections keep their own later contract.

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
| 3.14 Administrator model policy: enabled provider deployments and capabilities, default model and effort, whether auditors may change the model or choose the highest effort; versioned and audited; the picker set = policy ∩ engagement disclosure policy ∩ required capabilities ∩ execution limits, with unavailable choices disabled and stating the reason; one enforcement path | `model-policy-v1`, `disclosure-policy-v1` §model availability (FR-92) | a picker toggle cannot override the engagement's data policy; a policy revocation before the next call blocks that call with the cause recorded; a tenant default change leaves active tasks' selections and scheduled checks' approved configuration unchanged; configuration cannot declare a region or data-handling guarantee the service has not established; the reference screen's providers are not seeded as approved selections |

**Minimal cut:** 3.1–3.8, 3.10 (calendar create is the one external effect), 3.12, 3.13, 3.14 (one provider deployment, default and one alternative); 3.9 read-only (draft and send behind the gate but not exercised beyond refusal). **Blocked after:** OneDrive, SharePoint, Outlook, Todoist, Planner, GitHub, databases (the phased list). **Epic 9 proof:** the conformance suite per adapter; the OAuth negative list as runtime tests; enterprise requirements documented, not claimed; personal-account results never represented as proof of every organisational integration. **Design gaps attached:** none beyond the pack's Connections page (RS 11, reviewed in 8.1); the organisation-connections section is not rendered.

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

**Minimal cut:** 4.1–4.6, 4.8, 4.9; 4.7 for the scenario's one script; 4.10 decision and hold only; 4.11 export only. **Epic 9 proof:** the integrity sweep over every owner kind; the retention negative tests. **Design gaps attached:** retention decisions and holds (Data and retention is named in RS 22, not designed) — designed before 4.10's surface, which is after the first acceptance; the input-quality expansion showing Unknown and Out of period beside the pack's four chips (4b §5 row 15) — designed before 8.4.

### NE-5 — Artifacts, claims, review, approval and produced files

**Goal:** versioned artifacts with claims and citations; platform-owned support status; revision-bound decisions; approval binding the deliverable; renderings validated beyond a round trip; issuance as its own event. Absorbs Epic 6's 6.3–6.5.

**Contracts:** `artifact-version-v1` (as amended by 4b §7: `review-requested` and `returned` lifecycle records, review notes with disposition, export rule), `rendering-v1`. **Requirements:** FR-73–76, FR-90, **FR-96**, FR-40–44 as re-based. **ADs:** 7, 29.

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
| 5.9 Review request and return: `review-requested` and `returned` records; notes anchored to a location in the exact version with author, response and disposition; Mark as reviewed neither approves nor issues; notes excluded from client-facing renderings by default and included in authorised workpaper, archive and verification exports; one eligible independent person may satisfy review and approval where the pack permits | `artifact-version-v1` §review notes (FR-96) | a returned version is unchanged and its notes are retained on the next submission; notes absent from a client rendering and present in an authorised archive export; unresolved substantive notes stay visible under the pack's decision rules; a preparer's self-check recorded as a check, never as review |

**Minimal cut:** 5.1–5.5, 5.6 for `.docx` only, 5.7 draft share, 5.8's working paper and finding, 5.9 (D-5-7). **Blocked after:** `.xlsx` rendering, additional formats, multi-reviewer workflows the platform lacks. **Epic 9 proof:** the fidelity test set; the circular-citation and provenance negatives. **Design gaps attached:** the needs-reconsideration flag and impact records on artifacts (a flag, not a state); draft sharing versus issuance and PDF export; the provenance footer per Q3 (on by default, firm-controlled, no silent identifiers in exported metadata) — each designed before 5.3, 5.7 and 5.6 respectively.

### NE-6 — Memory, retrieval, skills and methodology packs

**Goal:** scoped retrieval; six memory scopes with ownership and verification status; skills and packs as versioned tenant data under the mandatory minimum; a usable start without a pack.

**Contracts:** `memory-v1`, `skill-v1` and `methodology-pack-v1` (as amended by 4b §7: Admin creates, maintains, approves, activates and retires; creator, maintainer and approver recorded; configuration-change controls; approved checks keep their pack version), `run-level-gate-v2` (classification). **Requirements:** FR-77–80, FR-85, FR-86, FR-94 (methodology half). **ADs:** 32, 33.

| Story | Establishes | Demonstrated by |
|---|---|---|
| 6.1 Retrieval index rows under RLS; filter before rank; coverage in results; direct full reads | retrieval | client-B item absent; stale index then direct read; period spanning two policy versions |
| 6.2 Memory items: scopes, ownership, delegation, lifecycle and verification status | `memory-v1` | explicit instruction `active` and `user-reported`; inferred item `proposed` and invisible as instruction; non-owner refused |
| 6.3 Configured precedence and proposed conflicts | precedence | two packs resolve differently; prose conflict recorded not decided |
| 6.4 Pack schema, validation, activation by an Admin as an audited configuration change; the example pack from `templates.ts` (P-1..P-4 and fixtures, optional) and the minimal neutral example template (Q12) | `methodology-pack-v1` | example pack validates; undefined state refused; activation audited; engagement keeps its version; an Admin's activation confers no audit-approval right |
| 6.5 Gate rule classification (platform-mandatory, methodology-configurable, legacy-template-specific) | `run-level-gate-v2` | a pack omitting a mandatory rule refused; every rule classified |
| 6.6 Skills: descriptor, admission, discovery, loading, recording | `skill-v1` | unmet capability reported and denied; unapproved skill not loaded; task records versions |
| 6.7 Bootstrap without a pack; starter selection; pack proposal from documents | bootstrap | useful work before selection; promotion blocked naming the configuration; proposal `proposed` until an Admin approves it as configuration |
| 6.8 Compaction records and context re-evaluation on permission change | `working-context-v1` §compaction | correction survives compaction; revoked content absent on resume |
| 6.9 Pack and skill accountability records (creator, maintainer, approver); a methodology change cannot bypass a platform-mandatory Gate rule, waive an independent approval or reach client evidence; an approved check keeps its pack version after a new version is activated; methodology-scope knowledge promotion by Admin only within that scope | `methodology-pack-v1` §accountability, `skill-v1`, `memory-v1` §promotion (FR-86, FR-94) | a pack omitting a platform-mandatory rule refused; an Admin cannot confirm another person's preference, engagement or client memory item; the check's pack version unchanged after activation of a newer pack |

**Minimal cut:** 6.1 (index over artifacts and messages), 6.2 for user-preference, client-knowledge and engagement-facts, 6.4 with the example pack and the neutral template, 6.6 for the pack's four starter skills (Test a control, Analyse a population, Draft a working paper, Plan a walkthrough) as skill entry points, 6.7 bootstrap, 6.9 accountability records. **Blocked after:** cross-scope promotion beyond the same client; embeddings until a disclosure-approved provider is selected. **Epic 9 proof:** the scope negatives on retrieval through raw SQL. **Design gaps attached:** memory cards ("Remembered for your preferences", proposal with scope, source and reason, verification status, retirement) — designed before 8.8; Settings › Methodology and skills for Admin (RS 22 names it; the pack-proposal and approval screens are not designed) — before 6.7's surface.

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

### NE-8 — The experience: the Zobba shell, workspace, Reviews and Settings

**Goal:** EXPERIENCE.md revision 2 built on the Zobba design pack v1.0: the Pair identity and tokens; the pack's navigation (New task · Search · Scheduled checks · Engagements · Recent tasks · Connections · Settings, Reviews by responsibility, the notification panel as the complete attention view); the conversation-primary workspace with the contextual panel; readable six-dimension states; one decision surface per decision; Reviews with anchored notes; Settings › Administration. Screens reviewed before they are built (D-5-6).

**Contracts:** EXPERIENCE.md rev 2, DESIGN.md rev 2, the pack (HANDOFF §6 checklist per story). **Requirements:** FR-59, FR-48 re-based, FR-91 (the chip), FR-94–FR-96 (their surfaces), NFR accessibility at WCAG 2.2 AA (D-4b-6). **ADs:** 17 (streams), 29 (review records); Proposal 4 U1–U11 as amended by 4b.

| Story | Establishes | Demonstrated by |
|---|---|---|
| 8.0 Identity and tokens: Pair symbol, wordmark, lockups, app icon and favicon from the pack's assets; `zobba-tokens.json` as the token source; Hanken Grotesk and IBM Plex Mono; light-only UI; Lucide at 2px (provisional); Iris never carries an audit result | DESIGN.md rev 2 §2–§3 | `tokens.test.ts` re-pointed to the pack JSON and green; `stylesheet.test.ts` over the new classes; contrast figures asserted; no status colour reuses Iris |
| 8.1 Review the pack's 23 reference screens against the six-scene acceptance set (a new conversation; active analysis; artifact and citation inspection in reading and review modes; a material decision; an uncertain external effect; an unattended scheduled result); open the design-acceptance register listing every undesigned surface with its story and slice; design each under the pack's rules before its story | U11 gate, 4b §10 | the review record naming screens 03, 04, 06, 11, 14, 15, 17, 18 as reviewed; the register with one row per gap and its owning story; no story in §5 started before its row is closed |
| 8.2 Shell: the pack's first-level navigation; Reviews shown by responsibility and capability; the notification panel with the complete attention view (every open question, confirmation, reconciliation case, memory proposal and result needing attention); Engagements with Scheduled checks and Legacy procedures views; Recent tasks; workspace, client and engagement named in the header; tenant switching; breadcrumbs and the one-landmark rule | U2 as amended by D-4b-2 | shell and breadcrumb tests; an outstanding decision discoverable from the panel without searching old conversations; the panel's "couldn't load" Banner never the empty state; a legacy Procedure opened by its auditor; a person in two firms switches tenants and carries nothing across |
| 8.3 Home and the workspace: the composer ("What are we auditing today?") with engagement, Permissions and model chips and the four starters; the Continue list; the thread with attributed entries and grouped activity; the activity list anatomy; the inspection panel with its five layout modes, Pin · Expand · Close, the From-task line and Q7 protection; guidance queued and applied; select a statement and ask; the draft engagement and client-binding moment | U3, U4, R1–R2, P1–P6 | a first request needs no name or client; context survives opening evidence, changing panels, returning, new activity; a suggested reply submits the text as the answer; pinned or focused content is not replaced while inspected; keyboard citation inspection with return |
| 8.4 Artifact reading view and review mode; citations as E-references opening the evidence at its locator with the claim kept in view; L-references for limitations; the changes view with typographic diff and Undo as a new version; result and quality summaries with the six dimensions separately inspectable (Unknown and Out of period kept) | U4, R3–R5, 4b §5 rows 15, 6 | a working paper read with no technical detail open; matters needing review listed; a direct edit saves a new draft without ceremony; nothing rewritten |
| 8.5 Decision surfaces: one coherent surface per decision with action-specific labels ("Allow and send · Edit first · Don't send", "Create invitation", "Save to Drafts", "Approve version", "Issue report"); clarify with suggested replies plus free text; `reconcile` with only the permitted recovery actions and the two unknown-outcome patterns (4b §5 row 14); Stop requested versus Stopped by you; invalidation on change | D-4-2, R7, P7–P9, 4b §5 rows 1, 14 | no duplicate confirmation; stale details need a new decision; a retry that may duplicate is never presented as safe; a later blocked attempt shown beside the earlier unresolved one; a completed effect never described as undone |
| 8.6 Connections (user-owned; provider, account identity, granted capabilities and permitted locations as three things; readable resource names; Connect from the conversation and return) and Settings › Methodology and skills (Admin) | U4, pack §11, D-4b-3, D-4b-5 | selection by readable identity; consent alone makes nothing usable; no tokens or scopes shown; no empty "Organisation connections" section; an Auditor sees Methodology read-only |
| 8.7 View workspace: the browser view panel and the full-screen surface below 1024px; pause, stop, Take over (the controller lease) across widths; "read-only on client systems" | U10, R2.4, DESIGN-SYSTEM §13 | narrow-screen pause and stop; Stop requested versus ceased; safety controls never hidden by the browser view |
| 8.8 Memory: inline "Remembered for your preferences" with a link; proposal cards with scope, source and reason and Confirm / Reject / Edit scope; verification status on inspection | U4, 3c C10 | explicit instruction shows Remembered with a link and no second prompt; an inferred item is a proposal and never an instruction; a non-owner cannot confirm |
| 8.9 The status system: the six dimensions and the inspection-only vocabularies with glyph and word; the fixed-copy set (EXPERIENCE-RULES §12 as amended); the six-scene visual acceptance; WCAG 2.2 AA automated and manual checks (dragging alternatives, redundant entry, accessible authentication, target size, focus visibility) with no allowlist | U5 → 4b §3, U11, D-4b-6 | `status.test.ts` over DESIGN.md rev 2's table; `copy.test.ts` over the fixed set only; the visual acceptance record per scene; axe plus the manual checklist per new flow |
| 8.10 Reviews: the queue grouped Waiting for your review · Returned with your notes · Reviewed recently; reviewing a paper with anchored notes; Return with n notes; Mark as reviewed; "Approval and issue are separate steps"; Zobba's checks for the reviewer shown as checks, never as approval | RS 20–21, FR-96, 4b §5 row 6 | a returned version unchanged with notes retained; the reviewer's Approve control bound to the revision; a contributor meets the refusal; checks never labelled approval |
| 8.11 Settings › Administration: Users and roles with Invite people (Create invitation / Copy invitation link; Auditor, Audit manager, Admin only), per-engagement assignment, Remove access (engagement, tenant, account as separate actions), Invited state; Models and providers (FR-92); Connections policy; Administrator limits (the Permissions Policy); Data and retention (named); Audit log | RS 22–23, FR-92, FR-94, FR-95 | invitation choices offer three roles; the invitation link never appears in a model request or log; last-administrator removal refused with the sentence; the model policy screen seeds no approved provider from the reference screen |
| 8.12 Scheduled checks list and the scheduled result: the separate dimensions per row; Awaiting approval and Pending regression states with no next run while either holds; the result page (actor line, assessment chip, readable conclusion, Exceptions · Coverage · Evidence · How it ran, Mark as reviewed, Discuss this result, suggested follow-up through the confirmation flow) | RS 12–13, 4b §5 rows 2–3, U6 | an active schedule found when nothing needs attention; an incomplete input reads Inconclusive with supported exceptions listed and the four statuses separate; "Didn't run" has no assessment |
| 8.13 Search: scope-aware, attributed results across authorised clients without merging contexts, stale-index notice | R10, 3c C10 | a client-B item absent; the stale notice when the index lags |

**Minimal cut:** 8.0–8.6, 8.8–8.12; 8.7 for pause and stop; 8.13 basic. **Blocked after:** OS and push notifications (with the notification-policy contract), a dark theme, organisation connections, a native packaging. **Epic 9 proof:** WCAG 2.2 AA on the six scenes and every new flow; the interaction tests; the pack's closing rule that a rendered mockup proves no integration, security control or execution behaviour. **Design gaps attached:** every row of §5 is built here or in the epic that owns the mechanism; none starts before its design review.

### NE-9 — Promotion and recurring checks (absorbs Epic 8; re-homes Epic 6.1, 6.2)

**Goal:** a method artifact by selection; compiler-2 with `assist`; a Procedure Version that goes through the existing lifecycle; scheduled Runs under a delegation with no invented tests; reviewed regression case sets; FR-51 change classes; the thin proof first.

**Contracts:** `promotion-v1` and `executable-plan-v2` (as amended by 4b §6: approved model configuration on the version; replacement as a proposed configuration change with regression), `regression-case-set-v1`, `run-level-gate-v2` (pack check sets), `agent-limits-recovery-v1` (the three unavailability causes). **Requirements:** FR-51, FR-13–18 as applied, FR-72, FR-84, **FR-93**. **ADs:** 19, 21, 23, 34.

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
| 9.11 A check keeps the model and effort it was approved with; temporary provider failure, model retirement and policy revocation recorded as distinct causes that block or interrupt under the recovery contract; a replacement is a platform-authored proposed configuration change through the versioned path with independent approval and regression as required; completed results unchanged; cost and usage visible to administrators by engagement | `promotion-v1` §configuration change, `agent-limits-recovery-v1` §causes, `model-policy-v1` (FR-93) | a retired model pauses the check with its cause and mints a proposal, never an in-place amendment; a replacement cannot activate without the required approval and regression; a tenant default change leaves the check's configuration unchanged; earlier results byte-identical |

**Thin proof (first acceptance):** 9.1–9.6 with 9.5's `assist` unused by the scenario, 9.11's recorded configuration only. **Later:** 9.7 beyond a signal record, 9.9, 9.10, 9.11's replacement path. **Design gaps attached:** promotion review (method view, compiler mapping, unresolved issues, second-person approval), Awaiting approval and Pending regression on Scheduled checks, regression case sets, the model replacement proposal — the first two designed before Slice 4, the rest before 9.9 and 9.11. **Epic 9 proof:** the minimum recurring safety set on every release.

### Epic 9 — Assurance (standing)

Runs throughout, generalised: isolation suite (NE-1), loop mutation harness and injection evaluations reported per prompt version (NE-2), connector conformance and OAuth negatives (NE-3), integrity sweep and retention negatives (NE-4), fidelity and provenance negatives (NE-5), retrieval scope negatives (NE-6), sandbox isolation against the deployed profile (NE-7), WCAG 2.2 AA accessibility and the six-scene visual acceptance (NE-8), minimum recurring safety (NE-9); engagement and task metrics (AD-13); the credential-containment acceptance scans over every new persistence subject discovered from the catalogue.

## 3. Contract → epic map (the 3d obligation)

| Contract | Epic and stories | Contract | Epic and stories |
|---|---|---|---|
| `tenancy-v1` | NE-1 1.1–1.7, 1.9–1.11 | `derivation-v1` | NE-4 4.5–4.7 |
| `audit-event-envelope-v2` | NE-1 1.8 | `input-quality-v1` | NE-4 4.8 |
| `engagement-task-v1` | NE-2 2.1, 2.2, 2.5, 2.6 | `retention-v1` | NE-4 4.10 |
| `agent-loop-v1` | NE-2 2.3, 2.4, 2.7, 2.8, 2.10 | `export-v2` | NE-4 4.11 |
| `working-context-v1` | NE-2 2.7; NE-6 6.8 | `artifact-version-v1` | NE-5 5.1–5.5, 5.7, 5.9 |
| `live-channel-v2` | NE-2 2.9 | `rendering-v1` | NE-5 5.6; NE-7 7.6 |
| `permissions-v1` | NE-3 3.1–3.3; NE-1 1.9 (visibility) | `memory-v1` | NE-6 6.2, 6.3, 6.9 |
| `connector-v1` | NE-3 3.4, 3.8–3.11 | `skill-v1` | NE-6 6.6, 6.9 |
| `connection-v1` | NE-3 3.5–3.7, 3.13 | `methodology-pack-v1` | NE-6 6.4, 6.7, 6.9 |
| `disclosure-policy-v1` | NE-3 3.12, 3.14 | `run-level-gate-v2` | NE-6 6.5; NE-9 9.5 |
| `model-policy-v1` (new, 4b) | NE-3 3.14; NE-9 9.11; NE-8 8.11 | `code-execution-v1` | NE-7 7.1–7.3 |
| `evidence-package-v2` | NE-4 4.1, 4.9 | `document-extraction-v1` | NE-7 7.4, 7.5 |
| `acquisition-v1` | NE-4 4.2–4.4 | `agent-limits-recovery-v1` (amended) | NE-9 9.11 |
| `promotion-v1` | NE-9 9.1, 9.3, 9.6, 9.7, 9.11 | `executable-plan-v2` | NE-9 9.2, 9.11 |
| `regression-case-set-v1` | NE-9 9.9 | EXPERIENCE.md and DESIGN.md rev 2 | NE-8 |

Each contract's `docs/contracts/*.md` file is authored by the first story listed for it; the register's companion test (contracts on disk versus the register) lands with NE-1 1.1 and grows with every story.

### 3a. Traceability for the requirements added by Proposal 4b

| Requirement | Establishing stories | Demonstrating tests (summary) |
|---|---|---|
| FR-91 Model and effort choice | NE-2 2.10 (record and boundary rule); NE-8 8.3 (the chip); NE-3 3.14 (the offered set) | requested versus actual per invocation; unsupported effort unavailable or remapped and recorded; mid-task change from the next boundary; no budget or evidential effect |
| FR-92 Administrator model policy | NE-3 3.14; NE-8 8.11 (Models and providers) | one enforcement path with the disclosure policy; versioned and audited; default change leaves active work unchanged; no unestablished region claim |
| FR-93 Scheduled checks and unavailable models | NE-9 9.11; NE-2 2.7 (provider continuity) | three causes recorded distinctly; replacement is a proposed change with approval and regression; results unchanged; continuity rules on a provider change |
| FR-94 Roles, scope and separation of duties | NE-1 1.9; NE-5 5.4 (scoped approval, independence over contributors); NE-6 6.4, 6.9 (Admin as configuration approver); NE-8 8.2, 8.10, 8.11 | self-check permitted and self-approval refused; Admin cannot approve audit work or issue; a methodology change bypasses no safeguard; approved checks keep their pack version; accountability records |
| FR-95 Invitations and removal | NE-1 1.10, 1.11 (with 1.6); NE-8 8.11 | wrong-recipient, expired, replayed, revoked refused; inviter lost authority; last-administrator rule; cross-tenant membership preserved; dispatch after removal refused; secret containment |
| FR-96 Review notes and return | NE-5 5.9; NE-8 8.10 | returned version unchanged, notes retained on resubmission; notes absent from client renderings and present in an authorised archive export; reviewed ≠ approved ≠ issued |

## 4. Order, dependencies and the gated slices (D-5-4, D-5-5)

```
NE-1 tenancy ──► NE-2 task + loop ──► NE-3 permissions + connectors ──► NE-4 evidence ──► NE-7 sandbox ──► NE-5 artifacts ──► NE-6 memory + packs ──► NE-8 experience ──► NE-9 thin proof
                 ▲ NE-8 8.0 identity and 8.1 screen review before NE-2's first surface                                                Epic 9 proofs throughout
```

- NE-1 is complete, with its isolation suite green, before any personal account is connected (owner decision 3).
- NE-2's stub gate is replaced by NE-3's in 3.2; nothing ships to the acceptance environment with the stub.
- NE-7 precedes NE-5's rendering and NE-4's re-execution validation.
- NE-8's 8.0 and 8.1 precede 8.2; surfaces land beside the epics they expose, so every slice is walked in the real shell, never in a throwaway prototype.
- The first acceptance is the union of the minimal cuts above, delivered as four gated slices; it is a slice of every epic except Epic 7, not a separate prototype.

### 4a. From the first usable conversational slice to the complete acceptance journey

Each slice is one demonstrable increment of the same journey (PRD §2.3 UJ-1..6; Proposal 6 specifies the synthetic scenario — Lumina Assurance auditing Northstar Bank plc's leaver access over the owner's personal Google Drive, Gmail and Calendar with designated resources). The scenario is acceptance data; no slice hard-codes it.

| Slice | Stories (minimal cuts) | What an auditor can do at the end of it | Validation gate (must pass before the next slice starts) | Designs closed before it (D-5-6) |
|---|---|---|---|---|
| **0 — Isolation proven** | NE-1 all (1.1–1.11); NE-8 8.0, 8.1 | Nothing new in the product; the scoped schema, roles, delegations, invitations and removal exist behind the existing surfaces. | The isolation suite (two tenants, clients, engagements, users; reads, retrieval, writes, exports, background jobs, credentials) green in CI; populated-upgrade proof green; every table classified; no personal account connected yet. | The 23-screen review record; the design-acceptance register opened. |
| **1 — First usable conversational slice: ask about the authorised files** (UJ-1 partial) | NE-2 2.1–2.5, 2.7 (kill and resume), 2.10 (default model); NE-3 3.1–3.8, 3.12–3.14 minimal; NE-4 4.1–4.3, 4.8; NE-6 6.1 minimal, 6.7 bootstrap; NE-8 8.2, 8.3, 8.9 partial | Connect a personal Drive, choose designated folders, start a draft engagement from Home, state an objective, and get an attributed reply that names what was found, assumed and still needed, citing source snapshots with their quality dimensions; answer a clarification in free text; see a refused out-of-scope read recorded as a security event; an instruction inside a document changes nothing. | Epic 9 proofs for NE-1..3 (mutation harness on the loop's call site, gate killing tests, OAuth negatives, Drive conformance, injection evaluation set); scenes 1–2 of the six-scene visual acceptance; WCAG 2.2 AA on the shell, workspace and Connect flow; personal-account results labelled as such. | Draft engagement and client-binding moment; the notification panel's attention view. |
| **2 — Analysis and a reviewable working paper** (UJ-2, UJ-3, UJ-4) | NE-7 7.1–7.5 minimal; NE-4 4.5–4.7, 4.9; NE-5 5.1–5.3, 5.8; NE-6 6.2 minimal; NE-8 8.4, 8.5 (clarify, approval), 8.8 | Have the leaver list, directory extract and application user list snapshotted and traced on working copies in the sandbox; read a working paper with candidate findings, the post-exit login signal and the partial-population limitation visible; open a citation and return; correct an overstated result in the thread and accept the new version with its dependents flagged; see the memory proposal and confirm or decline it. | Sandbox isolation negatives against the deployed profile; fidelity and provenance negatives (generated narrative refused as evidence, circular citation); the integrity sweep over every owner kind; scenes 3–4; WCAG 2.2 AA on review mode, citations and memory cards. | Needs-another-look flag and impact records; memory cards; the input-quality expansion (Unknown, Out of period). |
| **3 — Correspondence, one confirmed external effect, independent review** (UJ-5, UJ-4 approval, FR-94–96) | NE-3 3.9 (Gmail read), 3.10 (Calendar create), NE-2 2.6 (reconcile); NE-5 5.4, 5.5, 5.6 (`.docx`), 5.7 (draft share), 5.9; NE-1 1.9–1.11 exercised; NE-8 8.5 full, 8.6, 8.10, 8.11 | Have a designated Gmail thread read to update the request record; see one calendar invitation to the designated test recipient proposed with its material details, confirm it on one decision surface, and read back its receipt; meet the unknown-outcome pattern when the provider does not confirm; invite a second person by link, who reviews from Reviews, returns with anchored notes, then approves the revised version; a contributor meets the independence refusal; share a labelled draft `.docx` to Drafts. | Gmail and Calendar conformance suites; the reconciliation negatives (no second effect in any case); invitation and removal negatives; FR-96 export rule; scene 5 (an uncertain external effect); WCAG 2.2 AA on Reviews, invitations and sign-in (accessible authentication). | The `reconcile` decision surface; draft sharing versus issuance; invitation creation and acceptance; the Reviews note anchoring beyond RS 21. |
| **4 — Promotion and the unattended rerun: the complete agreed acceptance journey** (UJ-6, Proposal 6 end to end) | NE-9 9.1–9.6, 9.8, 9.11 (recorded configuration); NE-6 6.4, 6.5, 6.9; NE-8 8.12; Epic 9's minimum recurring safety set | Say "run this monthly", review the method by selection, submit; the second person approves from Reviews; the check appears under Scheduled checks with its next run; one scheduled rerun runs under its delegation with nobody watching and reports truthfully, including a deliberately incomplete input reported Inconclusive with supported exceptions visible and execution Completed; a prohibited source change is refused; a connection failure is reported as an access failure with a recovery request. Then the whole journey A–I is walked in order as Proposal 6 specifies. | Minimum recurring safety on every release; the four-status separation on the Result; scene 6 (an unattended scheduled result); the Proposal 6 acceptance record with every check computed also required; the credential-containment scans over every new persistence subject. | Promotion review with Awaiting approval and Pending regression. |

After Slice 4: the rest of NE-3's phased connectors (Microsoft first), NE-5's `.xlsx` and formats, NE-6's cross-scope promotion and embeddings, NE-7's OCR and network contract, NE-9 9.7 beyond a signal record, 9.9, 9.10 and 9.11's replacement path, NE-4 4.10's retention surfaces, and the Proposal 7 rename story — each with its design row closed first.

## 5. Design-acceptance register (D-5-6) — each gap, its story, its slice

| Undesigned surface (4b §4, §10) | Built by | Designed and reviewed before |
|---|---|---|
| Memory: "Remembered for your preferences", proposal cards, scope and verification status, retirement | NE-8 8.8 | Slice 2 |
| Draft engagement without a client; the client-binding moment | NE-8 8.3 (with NE-2 2.1) | Slice 1 |
| Needs-another-look flag and impact records on artifacts | NE-5 5.3, NE-8 8.4 | Slice 2 |
| `reconcile` decision surface (keep observing · mark done with reference · retry with duplication warning · abandon) | NE-8 8.5 (with NE-2 2.6) | Slice 3 |
| Sharing a working draft versus issuance; PDF export | NE-5 5.7, 5.6; NE-8 8.5 | Slice 3 (share); PDF export after Slice 4 |
| Promotion approval: method review, compiler mapping, unresolved issues, second-person approval; Awaiting approval and Pending regression on Scheduled checks | NE-9 9.2–9.3; NE-8 8.12 | Slice 4 |
| Regression case sets and a version pending regression | NE-9 9.9 | before 9.9 |
| Retention decisions, holds, deletion | NE-4 4.10 | before 4.10's surface |
| Tenant switching for a person in two firms | NE-8 8.2 | Slice 1 |
| Legacy procedures view (compiler-1 Runs, Run Detail, Live View, Replay reachable) | NE-8 8.2 | Slice 1 |
| Organisation connections | deferred (D-4b-3) | its own contract |
| Invitation creation and acceptance | NE-1 1.10; NE-8 8.11 | Slice 3 |
| The model replacement proposal for a check | NE-9 9.11 | before 9.11's replacement path |
| The notification panel's complete attention view | NE-8 8.2 | Slice 1 |
| Input-quality expansion (Unknown, Out of period beside the pack's chips) | NE-8 8.4 | Slice 2 |
| Settings › Methodology and skills: pack proposal and approval by Admin | NE-6 6.7, NE-8 8.6 | before 6.7's surface |

## 6. What stays explicitly blocked or deferred

Epic 7 (desktop); NE-3's later connectors; sandbox network exceptions; authored formats beyond `.docx` and `.xlsx`; multi-reviewer workflows the platform lacks; cross-scope memory promotion beyond the same client; embeddings pending a disclosure-approved provider; NE-9's missed starts, handover under succession, drift detection and notification policy, each with its transition blocked; regression-gated activation until 9.9 lands (a version stays `APPROVED` pending regression); model replacement for an approved check until 9.11's replacement path lands (the check pauses with its recorded cause); organisation-managed connections, enterprise SSO and provisioning, transactional email for invitations, OS and push notifications, a dark theme, native packaging; automatic task-based model routing (not implied by the composer chip, 4b §6); the technical rename of `@intellifin/*`, `INTELLIFIN_*`, telemetry names and `roles.ts` identifiers until Proposal 7's compatibility-tested story.

## Why

Direction §I ("assess existing epics"), `analysis-prd-epics.md` §3–§4, Proposals 3a–3d (contracts and decisions), Proposals 4 and 4b (NE-8 and FR-91–FR-96), the owner's terminology and role decisions of 2026-09-25, owner decisions 1–3 of 2026-09-24, and the consolidated baseline (PRD rev 4, spine rev 5, EXPERIENCE.md and DESIGN.md rev 2). No implementation is authorised; the epic plan is the input to Proposal 6 (the first acceptance) and Proposal 7 (the codebase disposition and sprint-status changes).
