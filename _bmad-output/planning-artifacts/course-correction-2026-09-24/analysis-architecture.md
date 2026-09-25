# Architecture and contracts vs. the 2026-09-24 direction

Baseline: `main` at `c18ad36`. Read-only analysis. Inputs: `direction-2026-09-24.md`, `ARCHITECTURE-SPINE.md` (rev 4), the 25 files in `docs/contracts/`, and the code named below.

## Summary

1. The spine's safeguards are sound and mostly reusable. They sit on one execution unit that the direction does not start from: an APPROVED, FROZEN Procedure Version built from one of four closed Templates.
2. The hard block is structural, not cosmetic. `audit_run.version_id`, `procedure_id` and the period are `NOT NULL` (`packages/infrastructure/src/db/schema.ts:801-808`). `createRun` refuses anything that is not `ACTIVE` with a frozen review (`packages/application/src/runs/initiate-run.ts:67-68`). The agent loop refuses every Template except P-1 and P-4 (`execute-agent-work-item.ts:481`), and it offers tools only for P-1 (`agent-tool-planner.ts:25`).
3. Four ADs conflict with the direction: AD-2, AD-4 ("no mutation capability through an inward port"), AD-7 (human free text never reaches the model), AD-9 (the Procedure Version fixes read-only tools). AD-23 also conflicts: the compiler is closed to P-1..P-4.
4. Three contracts conflict: `tool-action-v1`, `agent-execution-v1`, `executable-plan-v1`. `durable-escalation-v1` conflicts in part.
5. These parts generalise well: evidence reserve/verify/register, the audit hash chain, durable waits and leases, credential containment by shape, the gate-at-the-call-site pattern, the conversation receipt ledger, and the worker-only secret boundaries.
6. There is no memory store, no connector framework, no OAuth or per-user credentials, no working-copy or derived-output model, no artifact versioning outside Procedure Versions, and no code-execution sandbox.
7. The model layer is not a tool-using agent. It sends JSON through `generateText` with no native tools, one action per turn. Each turn row must bind to a registered browser snapshot of a Work Item (`0034_lethal_romulus.sql`, `validate_agent_turn`).
8. Recommendation: keep the Run/Procedure path as the "approved recurring check" path. Add an Engagement plus an Agent Task execution path beside it. The new path reuses the ports, the chain, evidence, waits, leases and receipts, and a new Mandate policy gate replaces the frozen-Procedure authority. Do not make `audit_run` nullable.

## AD verdict table

| AD | Verdict | Evidence / what changes |
|---|---|---|
| AD-1 inward dependencies | HOLDS | Connectors and a sandbox become application-owned ports with infrastructure adapters. Add Google/Microsoft SDKs to `no-vendor-sdk-in-business-code` (`.dependency-cruiser.cjs:190`). |
| AD-2 audit core owns meaning | CONFLICT | "A Procedure Version is authored from a Template in the Builder … approval freezes …; a STANDARD Run references only an ACTIVE version". "Templates are data owned by the procedures module" is implemented as build constants P-1..P-4 (`templates.ts:77`). The entity list has no Engagement, Artifact, Connection, Mandate or Memory. **Safeguard:** approved, frozen, independently approved meaning before RECURRING execution; one mutation path. **Replacement:** make Engagement, Agent Task, Mandate, Artifact(+version) and Memory Entry core aggregates. Keep Procedure Version as the frozen unit for recurring checks only. Templates and methodology become tenant data, not constants. |
| AD-3 durable, incremental Runs | EXTEND | Durable job, revisioned checkpoint, Timeline in the same transaction and idempotent stages are all right. The rule text binds execution to "the application-owned plan as ordered Session Steps and Work Items". Widen: the same guarantees for an Agent Task step ledger (tool call = step). Run uniqueness on (Procedure, period) stays for checks only. |
| AD-4 evidence acquisition, two paths | CONFLICT | "No mutation capability is exposed through an inward port". Credential registration refuses write-capable credentials. **Safeguard:** sources are never mutated; credentials arrive just in time and stay out of model-visible content; allowlists. **Replacement:** separate `SourceAccess` (read + snapshot; source mutation stays unexpressible) from `CollaborationAction` (draft, write to approved output locations, send/create meeting), each with an effect class and a confirmation policy. |
| AD-5 sealed, tamper-evident evidence | EXTEND | Reserve → upload → verify → register is generic (`evidence-package.ts:201 freezeArtifact`). Closed kinds (`evidence.ts:37`), a Run-only owner, and sealing only at a terminal Run need widening (see Q3). |
| AD-6 grounded, corroborated Observations | EXTEND | Right principle ("a generated assertion is not evidence"). Implemented only for record/attribute Observations over web_tree/sheet/json. Add claim-level grounding for narrative artifacts (finding → evidence locator) with an "unsupported" status. |
| AD-7 human decisions separate | CONFLICT (one clause) | Revision-guarded, attributable decisions HOLD. "Free text from humans (Escalation notes, rationale) … is never passed to the model" blocks a conversational agent. **Safeguard:** human text cannot change authority, scope, credentials or a typed answer. **Replacement:** auditor conversation is model input on a *request* channel. Authority changes only through typed, revision-guarded commands. Escalation answers stay option-only. |
| AD-8 PostgreSQL system of record | HOLDS | New aggregates live in PostgreSQL through the UnitOfWork. |
| AD-9 bounded, typed, provider-neutral agent | CONFLICT | "Each Procedure Version fixes allowed origins … read-only tools/actions"; "the agent receives the chosen option identifier and nothing else". **Safeguard:** bounded budgets, typed tool calls, provider neutrality, retrieved content cannot widen authority, redacted traces. **Replacement:** a Mandate (admin ceiling ∩ auditor grant ∩ engagement scope, versioned and digest-frozen per Task) fixes tools, locations and effect classes. Keep typed uncertainty, budgets, cancellation and injection containment. |
| AD-10 telemetry ≠ audit evidence | HOLDS | Connector calls run from the worker. "Web never probes providers" already bends: web composes the authoring model (`apps/web/src/bootstrap.ts:172`). |
| AD-11 replaceable deployment | HOLDS (note) | Tenant isolation is on the Deferred list. Direction E ("client context must not leak") makes engagement/tenant scoping a precondition for memory. |
| AD-12 tests defend seams | EXTEND | Add a shared connector conformance suite, fake Drive/Gmail/Calendar, and sandbox negative tests. Golden datasets are per Template (P-1..P-4). |
| AD-13 thesis metrics | EXTEND | Metrics are Procedure/Template scoped. Add engagement/task metrics. |
| AD-14 versioned durable contracts | HOLDS | Needed for the new envelopes (task step, mandate, connector call, memory entry). |
| AD-15 releases preserve Runs | HOLDS | Applies equally to waiting Tasks. |
| AD-16 durable waits | EXTEND | The wait/lease/one-job-per-wait design is reusable. "No model conversation state is persisted across a wait and the model is re-briefed from the frozen plan" does not fit multi-step conversational work. Allow persisted, governed transcript/task state as inert context. Add wait kinds `confirm-action` and `clarify`. |
| AD-17 Timeline + SSE | EXTEND | Streams are per Run (`/api/runs/<id>/events`). The chain is generic (`audit_event_heads` per aggregate). Add engagement/task streams. |
| AD-18 one Observation contract | HOLDS (scope-limited) | Right for recurring checks. "An agent's reading of a file is never the population of record" stays a safeguard for document work too. |
| AD-19 Schedules, regression | EXTEND | This is where "approved recurring check" lands. Regression depends on Template golden datasets. A promoted check needs its own baseline (for example its approved originating Task outputs). |
| AD-20 notifications | HOLDS | Keep platform notifications separate from agent-sent email (a CollaborationAction). Do not conflate them. |
| AD-21 Result sealing | HOLDS | For checks. Execution vs assessment vs review stay distinct (direction G). |
| AD-22 chained events, signed manifests | HOLDS | Aggregate-generic chain (`audit-event.ts`). Families are closed (`AUDIT_EVENT_FAMILIES`). Connector and memory events fit `execution.`/`configuration.`/`security.`; no new family needed. |
| AD-23 plan derivation deterministic | CONFLICT | Compiler 1 is closed to four Templates (`PLAN_LOOKUP_COLUMNS`, `executable-plan.ts:73`; `COMPLIANCE_OBSERVATION_FIELDS` keyed by TemplateId). **Safeguard:** a model never decides what a rule means; identical inputs compile identically; the compiler version is frozen. **Replacement:** a compiler-2 whose input is an approved *method artifact* promoted from a Task (sources, scripts, criteria, expected outputs). It keeps a closed step vocabulary and deterministic condition compilation. Compiler 1 stays for existing versions. |

## Contract verdict table

| Contract | Verdict | Reason |
|---|---|---|
| `adapter-extraction-v1` | HOLDS | Deterministic API/file extraction for checks. Reference Source pattern reusable. |
| `agent-execution-v1` | CONFLICT | P-1/P-4 only. The model picks platform-built opaque `toolId`s and may not author any parameter (invariants 1-3). Turns are bound to a Work Item snapshot (inv. 16). **Keep:** gate before port, credential scan of request/response (inv. 7), untrusted-retrieved field (inv. 8), closed request shape, refusal audited without text. **Replace with** a generic tool-loop contract: the model supplies parameters, a schema plus the Mandate gate validate them, and results return as data. |
| `agent-limits-recovery-v1` | EXTEND | Reservation-before-I/O, leases, bounded retry and sweeps are generic. Bound to `run_agent_work` (one row per Run) and a Run deadline from `population_execution.started_at`. |
| `agent-workspace-v1` | EXTEND | Egress = frozen `web` origins. The browser becomes one tool under the Mandate's origin set. The local-mode weaker guarantee stays stated. |
| `capture-grounding-absence-v1` | HOLDS | "Absence needs proof" is exactly direction D ("unavailable folder ≠ empty folder"). Reuse for mailbox/folder searches. |
| `credential-containment-v1` | EXTEND | Containment by shape, byte scanner, guard-by-wrapping and the registration wall generalise. Resolution is a static env manifest `CREDENTIAL_TOKENS` of Bearer tokens (`config.ts:213`, `credential-resolver.ts`). No per-user OAuth, no refresh, no scopes. |
| `deterministic-evaluation-v1` | HOLDS | For checks. Template-bound fields. |
| `durable-escalation-v1` | EXTEND (partial CONFLICT) | Closed kinds; "an answer conveys only its option ID". Conversational `clarify` needs typed free answers treated as data, never authority. |
| `evaluation-review-sealing-v1` | HOLDS | Proposal ≠ evaluation; human confirm/reject. Same pattern for agent-drafted findings. |
| `evidence-package-v1` | EXTEND | See Q3. |
| `executable-plan-v1` | CONFLICT | "A future executor must … consume the stored validated plan. It must not call the compiler or a model to invent another plan." Plus the closed per-Template lookup table. Keep for checks. Do not require it for conversational work. |
| `live-timeline-channel-v1` | EXTEND | Per-Run stream. Generalise to any chained aggregate. |
| `live-view-v1` | HOLDS | Browser session viewer. N/A to connector work. |
| `observation-registration-v1` | HOLDS | Single write path for record Observations. Derived outputs need their own registration seam. |
| `population-acquisition-v1` | EXTEND | Closed Northstar-shaped API envelope and cover-sheet declaration. Real Drive/Excel populations need a declaration-less path whose limitation is stated (the `none` count mechanism already exists). |
| `replay-asset-set-v1` | HOLDS | Browser frames. Connector/sandbox steps need a tool-call ledger, not frames. |
| `replay-v1` | HOLDS | "Reaches nothing outside the platform" should also hold for Task replay. |
| `run-flag-v1` | HOLDS | Pattern reusable. |
| `run-level-gate-v1` | EXTEND | The §H rows (completeness, freshness, contradiction) match direction F's review list. Artifact review needs an equivalent checklist that does not depend on 20 fixed rows. |
| `run-pause-v1` | HOLDS | Pause at the next tool boundary generalises. |
| `run-request-token-v1` | HOLDS | The "first use decides" idempotency is the model for external writes (send, create event). |
| `run-result-v1` | HOLDS | Execution/Gate/outcome distinction = direction G. |
| `structural-snapshot-v1` | EXTEND | Substrates web_tree/sheet/json (`desktop_tree` refused). Add document substrates (docx/pdf text, xlsx, email MIME) with locator grammars. |
| `tool-action-v1` | CONFLICT | `PermittedReadAction` has 8 literals and write verbs are banned (`target-system.ts:40-81`). Scope = `ProcedureTargetSnapshot` + frozen population values. Methods are GET/HEAD/POST. **Keep:** pure ordered gate, first refusal wins, gate at the call site not the adapter, denial = security event never transport, one sanitized log shape. **Replace:** the scope source (Mandate) and the action vocabulary (connector tool descriptors with effect classes). |
| `workspace-capability-v1` | HOLDS | Provider handles are capabilities. Same rule for OAuth tokens and connector session URLs. |

## Q1 — Frozen plan as a precondition

What assumes a frozen, ACTIVE Procedure Version before any agent work:
- Storage: `audit_run.procedure_id`, `version_id`, `period_from/to` are `NOT NULL` (`schema.ts:801-808`). Every Run child table hangs off `audit_run` (`run_evidence.run_id`, `run_conversation_message.run_id`, `run_wait`, `run_control_lease`, …).
- Initiation: `createRun` → `findPeriodOwner`, and it refuses unless `state === 'ACTIVE' && frozenReview` (`initiate-run.ts:67-68`).
- Worker stage order (`apps/worker/src/main.ts` `handle`): `workspaceRequirement(plan)`, `acquirePopulation` via `populationSessionStep(plan)`, sign-in from `plan.credentialReferences`, then adapter and agent stages. All of them read plan bytes.
- The gate: `authorizeToolAction(scope)` where `scope.target` is the frozen `ProcedureTargetSnapshot` and `scopeValues` is the frozen population (`tool-action.ts:122-174`).
- Agent loop: `planAgentTools` returns no tools unless compiler 1 and P-1 (`agent-tool-planner.ts:25`). The claim refuses anything but P-1/P-4 (`execute-agent-work-item.ts:481`). Work Items are one per population record. A turn requires a registered Work Item snapshot (`validate_agent_turn`).
- Limits: `plan.limits` (compiler-1 constants). The Run deadline comes from the population claim.
- Evidence: `REQUIRED_EVIDENCE_KINDS` is keyed by Template (`evidence.ts:180`). Idempotency key `evidence-v1:<runId>:<kind>:<scope>`. Sealing happens at the terminal Run.
- Outcome: 20 Gate rows, the §E.1 table, and an Exception fingerprint over Procedure/condition.
- The conversation surface (PR #51) is Run-bound, calls no model, and interprets commands only (`run-conversation.ts:6-15`).

Minimum change, with safeguards kept:
1. Add aggregates `engagement` and `agent_task` (task has owner, engagement, state machine, revision, lease, pg-boss job). They are independent of `audit_run`. Do NOT make `audit_run.version_id` nullable: the Gate, Result, CHECKs and period uniqueness all rely on it.
2. Add `mandate` (versioned authority policy: tool descriptors, source vs output locations, effect classes, confirmation rules, budgets). Admin ceiling ∩ auditor grant ∩ engagement scope. The domain computes it and hashes it with canonical JSON (the registration-digest pattern). Its digest is frozen on the task at start and on each step. This replaces "the Procedure Version fixes the tools".
3. Reuse, keyed by the task instead of the Run: the step ledger (analogue of `run_tool_action`), the lease/revision claim (`guarded`), token reservation before I/O, waits (`run_wait`-shaped with `task_id`), and interaction receipts (`received→…→applied|refused|superseded`).
4. Namespace evidence by owner: `evidence-v2:<ownerKind>:<ownerId>:<kind>:<scope>` through the same `freezeArtifact` and guard. `role` and the seal rules are reused.
5. Chain events on the engagement/task aggregate. `appendAuditEvent` is already aggregate-generic.
6. Outputs are Artifacts with review status. A Task never writes a System Outcome, a Result or an Exception. Those remain Run-only and are reached by promoting a Task's method into a Procedure Version (compiler-2) that goes through the existing approval (author ≠ approver).

## Q2 — Tool actions → connector permissions

Generalises as is, or with small changes:
- Gate shape: a pure domain function, ordered rules, first refusal only, closed denial vocabulary, `Object.hasOwn`/`includes` against request input (`tool-action.ts:174-248`).
- Gate location: at the port CALL SITE in application (`performToolAction`, `execute-agent-steps.ts`), never inside the provider adapter.
- Denial → `security.action-denied`, terminal, never retried as transport (`stopCauseForDenial`).
- One sanitized action log (`run_tool_action`, `surface` column). Add a `connector` surface. Destinations sanitized (no query, no userinfo); outcome `performed|denied|failed`; `ON CONFLICT DO NOTHING`.
- `ResolvedCredential` closure containment, `guardedCredentials` wrapping, `discloses/redact` byte scan before any persistence (`freezeArtifact`), credential scan of every model request and response (agent-execution inv. 7), `FORBIDDEN_PAYLOAD_KEYS` in the chain, capture suppression as a type-level union.
- Worker-only secrets enforced in `config.ts:327-380`, and `no-credential-resolver-in-web` / `no-browser-execution-in-web` / `no-agent-model-in-web` in dependency-cruiser.
- Egress interception and `withinFrozenOrigin` (the path-boundary origin rule) extend to connector base URLs.
- The interaction-command receipt ledger (`run_interaction_command`, `run_interaction_transition`) plus the proposal → explicit confirmation → existing command → receipt pattern. This is the template for "present the invitation before creating it" and for "confirmed only after the operation is confirmed".
- `run-request-token-v1` "first use decides": the model for idempotent external writes and reconcile-before-retry.

Hard-coded to "read-only browser/API against a registration":
- `PERMITTED_READ_ACTIONS` (8 literals) and a test banning `MUTATING_VERBS` (including `send`, `create`, `update`) (`target-system.ts:40-81`). `permitted_actions` is inside the registration digest.
- The registration wall: a write-capable credential is refused ("Audit credentials must be read-only"). `CredentialProvider.describe` proves read-only only.
- Scope = `ProcedureTargetSnapshot`. Parameters must equal a frozen population value (`scopeValues`). A Gmail query, a date or a recipient can never pass.
- `TOOL_ACTION_METHODS` = GET/HEAD/POST. POST exists only for a sign-in form.
- Credentials: a deployment-level static JSON manifest of Bearer tokens (`CREDENTIAL_TOKENS`) keyed by opaque reference. No per-user connection, no OAuth consent/refresh/revocation, no scopes. `authorize` writes only `Authorization: Bearer`.
- Roles: 3 fixed roles and one explicit grant (`EXPLICIT_PERMISSIONS = ['run.control-transfer']`, `roles.ts:14-16`). There is no per-user delegated authority and no admin-ceiling model. The `user_permission_grant` table (revisioned, revocable) is the reusable seed.

Needed: a connector registry; a per-user connection store (encrypted OAuth tokens, worker-only refresh, revocation audited); `ConnectorTool` descriptors with an effect class `read | draft | write-output | external-effect (send/invite) | source-mutation (never expressible)`; location classes (source vs output); a confirmation policy per effect; the Mandate gate; idempotency keys and outcome reconciliation per external write.

## Q3 — Source → snapshot → working copy → derived outputs

Maps well:
- Preserved snapshot = reserve → `putIfAbsent` → read back → size/SHA-256 compare → `REGISTERED` (`freezeArtifact`). The object store never overwrites. A credential scan runs before upload. Registration is never demoted. Post-hoc integrity sweep. Capture provenance (`captured_at`, `capture_method`, `capture_time_source`, gen 32). Worker-signed read grants (the web never reads the store, `no-evidence-store-in-web`).
- "Changes to an external source captured as a new version": the reconcile-not-overwrite rule already turns a changed-bytes redelivery into an integrity refusal. Keying the reservation by source revision would turn that refusal into a new version.
- Source freshness and completeness checks exist for populations (§H freshness, `population_snapshot.generated_at`).

Missing:
- Source identity/version: `run_evidence` has `registration_id` (Target System) and an object key. It has no provider, external file id, drive/path, revision id/etag, modified time, owner, or retrieval query.
- Owner: evidence is Run-owned (`run_id NOT NULL`). Idempotency key and object keys are Run-scoped (`evidence.ts:290-344`). Kinds are closed to 5 (`population, reference-source, adapter-extraction, structural-snapshot, screenshot`).
- Working copies: none. Every stored byte is immutable Evidence, and there is no mutable, versioned working file.
- Derived outputs: no transformation/lineage table. AD-14 names a "transformation" provenance node that is not implemented. There is no link from an output to the snapshots and scripts used.
- Artifact versioning: only Procedure Versions are versioned. Working papers, findings and reports have no version chain or supersession, and no "revise and flag dependent conclusions" graph.
- Sealing is only at a terminal Run. Artifacts need a per-version freeze on approval.
- Substrates for documents and email (the `structural-snapshot-v1` extension).

## Q4 — Memory

No memory or knowledge store exists. The only matches for "memory" in `packages/*/src` are "process memory" comments. The persisted context today:
- Templates: build constants P-1..P-4 (`templates.ts`), pinned to addendum §C by tests. They are not editable, not tenant-scoped and not versioned as data.
- Procedure Version `sections` and `section_preparation` (per-version authoring review state, `schema.ts:666`).
- `procedure_authoring_request` receipts (per version and actor, with the model proposal).
- Run conversation: `run_conversation_message` plus AES-256-GCM content bound to (run, message) (`conversation-content.ts`), Run-scoped, gated by `RUN_CONVERSATION_MODE` off/synthetic.
- The audit chain (immutable events; free text is excluded by design).

Reusable for scoped memory: the conversation split (immutable metadata vs separately governed encrypted content, with deletion as a tombstone), which fits memory entries with removal; the audit chain for provenance and promotion events; the Procedure Version state machine plus author ≠ approver, for promotion of firm methodology; `user_permission_grant` revision/revoke semantics; the canonical digest pattern for version identity; the proposal → confirm receipts, for "save this correction?".

Must be new: a `memory_entry` aggregate with scope (user | firm/department | organisation/client | engagement), owner, status (hypothesis | confirmed | superseded | rejected), version plus `supersedes`, provenance links (message, evidence, approval), access scope checked on every read, and a promotion command gated by role and review; retrieval that filters by tenant/client/engagement before ranking, so client context cannot cross engagements; a tenant/client key on every aggregate (deferred in the spine).

## Q5 — Provider neutrality and a generic agent loop

Provider-specific today:
- `AGENT_MODEL_PROVIDERS = ['anthropic','openai']` (`agent-ports.ts:22`). Both adapters use AI SDK `generateText` with a JSON-in-text protocol and no native tool calling (`agent-model-gateway.ts:647`). The prompt version is `'4'` (`agent-model-policy.ts`).
- Plan derivation gateway: `procedures/model-gateway.ts`, Anthropic/OpenAI.
- Authoring hard-codes OpenAI in APPLICATION: `AUTHORING_IDENTITY = { provider: 'openai', modelId: 'gpt-5.6-terra', … }` (`application/src/procedures/authoring-ports.ts:38`). It uses the OpenAI Responses API with `providerOptions.openai` in the web process (`authoring-model.ts`, `apps/web/src/bootstrap.ts:172`).
- Three separate model ports (agent, derivation, authoring), each with its own identity type.

Port shape: `AgentModelGateway.propose(request)` is provider-neutral (application types, closed error codes, usage accounting, cancellation seam, fallback). It is one-shot and phase-closed (`actions|evaluation`). `validateRequest` rejects any top-level key outside a fixed set, the retrieved content is `{source,text}` only, and there is no message history, no tool-result message and no model-authored arguments. A generic loop needs a new port: `step(messages, toolSchemas) → {text | toolCalls[] with arguments} + usage`. The existing budget, fallback and credential-scan wrappers can wrap it.

Durable machinery: pg-boss jobs, revisioned leases (`guarded`), token reservation before I/O, recovery sweeps, waits with a deadline job, controller lease, pause/cancel boundaries and receipts are all shape-agnostic in mechanism. They are bound to the Work-Item-per-record shape in data and code: `run_agent_work` is one row per Run with `workItemId` and `pendingWait`; `run_agent_turn` must reference a Work Item and a REGISTERED structural snapshot (`validate_agent_turn`); the Run deadline starts at population acquisition; resume re-briefs from the frozen plan (AD-16); limits are compiler-1 constants. Verdict: reuse the mechanisms and build a task-scoped checkpoint and step ledger. The current tables cannot host long conversational work as they are.

## Q6 — Sandboxed script execution

None. No `child_process`, VM, WASM runtime or remote sandbox in `packages/*/src` or `apps/*/src`. `@solarisdk/sandbox` is named in the spine stack but is not a dependency in any `package.json`.

Boundaries that would govern it:
- AD-1 / `no-vendor-sdk-in-business-code`: a `CodeExecution` port in application; the provider adapter in infrastructure.
- Worker-only placement, following `no-browser-execution-in-web`, `no-agent-model-in-web`, `no-credential-resolver-in-web`, `no-evidence-store-in-web`: add `no-code-execution-in-web`.
- The web must not execute anything or hold secrets (`config.ts:327-380` pattern).
- AD-11: the web and worker processes stay separate. The `local` workspace mode already records that a same-process sandbox isolates nothing (`agent-workspace-v1` "Process isolation: None"). A script sandbox must be a separate process/VM with no network by default, no credentials, mounted inputs = registered snapshot bytes only, outputs registered through `freezeArtifact`, and the resource limits recorded on the step.
- AD-4/AD-5: script inputs come from registered snapshots and outputs are derived artifacts linked to them; AD-9: the script text and its hash are recorded on the step ledger.

## Safeguards that must survive

- Source evidence is never mutated or overwritten. Reserve → verify → register, digest-checked on every read, never demoted (`evidence-package-v1`).
- Credentials never enter model-visible content, logs, the chain, artifacts or the web process (containment by shape, byte scan before persistence, worker-only secrets).
- Authority is decided by application code at the tool call site, from a frozen policy digest. Retrieved content and memory can never widen it (`tool-action-v1` gate pattern, AD-9).
- A denial is a security event, never a transport retry.
- An external effect is reported only after confirmation; an unknown outcome is reconciled before any retry (receipts, request-token "first use decides").
- Author ≠ approver for anything that becomes recurring or authoritative (Procedure Version approval, `authorApprovingOwnVersion`).
- Human decisions are typed, attributable and revision-guarded; escalation answers are option IDs.
- Machine proposals are never evaluations; a human confirms (`evaluation-review-sealing-v1`).
- Execution success, input completeness (Gate), assessment (outcome) and review status stay distinct (`run-result-v1`, `run-level-gate-v1`).
- Absence requires proof: inaccessible ≠ empty (`capture-grounding-absence-v1`).
- An append-only hash-chained audit trail per aggregate, in the same transaction as the effect (AD-3, AD-22).
- Durable, resumable, lease-fenced execution with budgets reserved before paid I/O.
- Untrusted content (pages, emails, documents, model narration) is rendered inert and labelled.

## Recommended architectural changes

| # | Change | Safeguard preserved | Size |
|---|---|---|---|
| 1 | Add `engagement` and `agent_task` aggregates (state machine, revision, lease, pg-boss job, chained events) beside `audit_run`. Do not relax `audit_run`. | Frozen approval for recurring checks; durable execution | L |
| 2 | `Mandate` policy: admin ceiling ∩ user grant ∩ engagement scope, canonical digest frozen per task/step. A pure domain gate `authorizeConnectorCall` at the call site, reusing the `authorizeToolAction` shape and denial semantics. | Authority enforced by the app, not prompts | M |
| 3 | Connector framework: a `ConnectorTool` descriptor (effect class, location class, parameter schema, confirmation rule); a per-user OAuth connection store (encrypted, worker-only refresh, audited grant/revoke); a connector conformance suite. Source mutation stays unexpressible. | Read vs write vs send; sources protected; credentials contained | L |
| 4 | Generalise evidence: owner-namespaced reservation keys, new kinds (`source-snapshot`, `working-copy`, `derived-output`, `generated-document`), source-identity columns (provider, external id, revision/etag, modified time, query), a lineage table (output → inputs + method/script hash), and freeze on artifact-version approval. | Tamper evidence; traceable derivation | M |
| 5 | Artifact aggregate with versions, supersession, review status, and a dependency graph (a finding cites evidence locators; approvals cite versions) to flag stale conclusions. | Inspectable, correctable, evidence-linked | M |
| 6 | Generic model port `step(messages, tools)` with native tool calls. Wrap it with the existing reservation, fallback, credential scan and closed errors. Unify the three identity types. Move `AUTHORING_IDENTITY`'s provider/model out of application into config. | Provider neutrality; bounded, accounted turns | M |
| 7 | Task step ledger (tool call, arguments hash, sanitized result ref, effect, receipt) plus task-scoped waits `confirm-action`/`clarify` reusing `run_wait` mechanics and interaction receipts. | Resumable, confirm-before-effect, no duplicate effects | M |
| 8 | Sandboxed `CodeExecution` port, worker-only, separate VM, no network/credentials by default, inputs = registered snapshots, outputs registered as derived artifacts. New `no-code-execution-in-web` rule. | Calculations executed by tools and preserved; isolation | M |
| 9 | Scoped memory store (scope, owner, status, version/supersedes, provenance, access checked on read, promotion by review), with tenant/client keys on every aggregate. | No cross-client leakage; hypotheses ≠ facts; methodology governed | L |
| 10 | Compiler-2 plus promotion: a Task's approved method artifact compiles into a Procedure Version (closed generic step vocabulary, deterministic conditions). Existing approval, regression and Schedule apply. Methodology and Templates become tenant data. | Recurring checks stay frozen, approved and reproducible | L |
| 11 | Relax AD-7's clause: auditor messages are model input on a request channel. Authority changes only through typed commands. Escalation answers stay option-only. Amend AD-2/4/9/23 text accordingly (spine revision 5). | Human text cannot change permissions | S |
| 12 | Generalise the SSE/Timeline channel to engagement/task aggregates. | Single live-state source | S |
