# Proposal 2 of 7 (revised) — PRD: new requirement sections and FR-3 revision

Status: APPROVED by the owner on 2026-09-24 as the requirements baseline for PRD revision 4, consistent with Proposal 1. Settles what the product must support; not the technical choices or deployment topology. No implementation authorised.
Artifact: `prd.md` §4 (new §4.14–§4.21), §4.1 FR-3, §4.4 (promotion), §4.5 FR-20/FR-22 scope note. Numbering continues from FR-50; FR-83–FR-90 were appended in the revision. Existing FRs named as HOLDS in `analysis-prd-epics.md` are unchanged.

Carried forward from Proposal 1: investigation within the Mandate without unnecessary prompts; working material distinct from evidence; coverage limitations constrain conclusions immediately; execution, coverage, assessment and review statuses separate.

Requirements state behaviour; Proposal 3 defines the interfaces, storage and deployment mechanisms that satisfy them.

## FR-3 — REVISED

OLD: only allowlisted read operations; a write-capable credential cannot be registered.

NEW:
> **FR-3.** The application owns authorisation policy and checks each proposed tool operation against the task's Mandate before dispatch. Connector adapters and execution environments independently enforce their applicable capability, resource and isolation restrictions. Neither an adapter nor the model may invent, widen or bypass authority.
>
> Operations are authorised against their actual account, resource, destination and effect. Original received evidence and audited operational source records cannot be modified through any path: the agent cannot reclassify a protected source as an output location to obtain write access, and source protection applies through connectors, scripts, browser actions and every other execution path.
>
> A permission denial is recorded as a security event with its reason. It is never retried as a transport failure and never attempted through another tool. Missing information or an unresolved target produces a clarification, not a denial. Content retrieved from documents, mail, pages or memory can never change what is permitted.

## §4.4 — ADD (promotion and recurring checks)

> **FR-51.** Work performed in an engagement can be promoted to an approved recurring check: a versioned procedure artifact bound to its execution requirements (authorised sources and connections, population and period rules, identity and matching rules, criteria and method, evidence requirements, schedule, outcome vocabulary, review responsibility). Promotion goes through the existing approval path; the approver is not the author where independence requires it. Existing FR-13..FR-18 apply to the promoted check.
>
> Each recurring check binds its approved method and execution requirements, including applicable methodology and skill versions, analytical rules or code, parameters, validation requirements and material model and tool configuration. Pinning model configuration records what was approved; it is not a guarantee of identical future model output.
>
> Expected changes to source contents within the approved population, period and source rules are normal inputs, not automatic reasons for re-approval.
>
> Missing or unsuitable inputs constrain the affected assessment. Expired or revoked access blocks the affected operation and produces a truthful access failure and recovery request. Restoring the same approved access does not, by itself, require re-approving the audit method.
>
> Material changes to approved sources, scope, matching rules, criteria, methodology applicability or execution behaviour require the appropriate amendment, validation and approval before affected execution continues. A newly published methodology version is not silently adopted by an existing check.

## §4.5 — SCOPE NOTE

FR-20 (per-Target-System sign-in loop) and FR-22 (record × system Work Item grid) describe the recurring-check execution path and remain valid there. Conversation-led work uses the task execution model in §4.15. Both paths share the evidence, gate, audit-chain and wait mechanisms.

## §4.14 Engagements and tenancy — NEW

> **FR-52.** An Engagement is the primary business object: client, period, objective, team membership, authorised sources and connections, and the Mandate in force. An engagement starts as a draft with any of these unset; the agent may work on what is set, and an unset detail blocks only the action that needs it.
>
> **FR-53.** Every protected record has an explicit owning tenant and applicable access scope. Client, engagement and user associations are required where appropriate to the record's meaning. Tenant-wide or user-scoped records (methodology packs, user preferences, client knowledge, connections that serve several authorised engagements) are deliberately scoped — not made accessible through absent client or engagement identifiers. Identifiers supplied by a browser or model are selectors, never proof of access. Reads, retrieval, writes, exports, background jobs and credential use enforce the applicable ownership, membership and grants. The owner's personal workspace is a single-owner tenant with the same enforcement.
>
> **FR-54.** Isolation is proven, not assumed: negative cross-scope tests (a member of one client's engagement cannot read, retrieve, be shown, or act on another client's material, memory, indexes, cached context, artifacts, background work or credentials) run in CI before any personal account is connected, and the same tests run against every later release. The boundaries apply to retrieval indexes, cached context, artifacts and background execution, not only to database queries.
>
> **FR-83.** A recorded Mandate version establishes the task's approved authority, but does not preserve permissions that have subsequently been revoked. Current grants, administrator restrictions and applicable approvals are checked before dispatch and again when resuming or retrying affected operations.
>
> **FR-84.** Background tasks and scheduled checks execute under an identifiable execution principal and an approved delegation. The system records the responsible human and authorising decisions, enforces current permission restrictions, and does not borrow another user's credentials or depend on an indefinitely active interactive session.

## §4.15 Conversation and agent tasks — NEW

> **FR-55.** A conversation is a durable, engagement-scoped record. Auditor messages are model input on a request channel; they never carry authority. Authority changes only through typed, attributable, revision-guarded commands, and explicit confirmations are recorded as such (the existing receipt discipline: received → interpreted → queued → applied / refused / superseded, never inferred from state).
>
> **FR-56.** An Agent Task is the unit of directed work: it has an owner, an engagement, a Mandate version, a state machine, a lease, a budget (steps, time, tokens) reserved before paid work, a step ledger (each tool call with its arguments digest, effect class, outcome and receipt), and chained audit events in the same transaction as each platform effect. Tasks survive worker restarts, can be paused, cancelled and resumed at tool boundaries, and can run in the background with the auditor away.
>
> **FR-57.** The agent asks a targeted question when information or a decision is genuinely missing. A question is a durable wait with a deadline. Free-text answers and conversational requests may inform plans, resolve questions and propose authorised application operations. They do not themselves execute commands or grant authority. Existing closed-option decision mechanisms (FR-27) remain available where an exact, bound decision is required; they are not the only way an auditor can communicate with the agent.
>
> **FR-58.** The agent's reasoning models are replaceable behind a common, application-owned invocation model that carries messages, tool schemas and results; provider identity, prompt version and usage are recorded on every turn; no raw provider text or rejected output is retained; requests and responses are scanned for credentials as a supplementary safeguard. Which content may reach which provider is governed by FR-89.
>
> **FR-59.** The auditor can watch a task live (timeline, tool calls, captured screens where a browser is used), pause, resume, stop and take or hand over control, with the existing lease and gate rules. See FR-88 for what a stop request does and does not establish.
>
> **FR-87.** Long-running conversations can be continued using scoped retrieval, summaries and durable task state. Summaries and indexes are derived context, not replacements for authoritative evidence, decisions or approvals. Their creation must not silently change the meaning or authority of the underlying records.
>
> **FR-88.** Database records and external effects are not treated as one indivisible transaction. Recovery must account for interruption before dispatch, after dispatch but before a receipt is recorded, and after a confirmed result. Pause and cancellation prevent further dispatch at the supported boundaries and request interruption of in-flight work where supported. The interface distinguishes a stop request from confirmed cessation. An action already performed is not described as undone merely because the task was cancelled.

## §4.16 Mandate and permission model — NEW

> **FR-60.** A Mandate is the versioned authority a task runs under: the intersection of the administrator's ceiling, the auditor's own connected access and grants, and the engagement's scope. It names permitted connector and application operations by effect class — `read`, `draft`, `write-output`, `external-effect` (send, create or update outside the platform) — the source locations (read and snapshot only) and output locations (writable), execution budgets, and which effect classes need explicit confirmation. Source mutation is not an effect class and cannot be granted; the boundary is the actual resource, not the tool's name (FR-3).
>
> **FR-61.** Routine operations inside the Mandate — reads, snapshots, calculations, drafting, investigation of adjacent patterns within the authorised sources — run without a prompt. Operations outside the Mandate are refused (FR-3). Operations the Mandate marks confirm-required are presented with their material details and performed only after an explicit, recorded confirmation bound to those details.
>
> **FR-62.** The application owns authorisation policy and checks each proposed tool operation before dispatch. Connector adapters and execution environments independently enforce their applicable capability, resource and isolation restrictions, and each layer is tested. Neither an adapter, a skill, a memory item, retrieved content nor the model may invent, widen or bypass authority.
>
> **FR-63.** Upstream connector and model-provider credentials are handled only by explicitly authorised server-side authentication, credential-broker and execution components. They are not exposed to the model, browser-visible content, ordinary application logs, audit-chain payloads or generated artifacts. Proposal 3 identifies the narrow components permitted to receive authentication responses, store or refresh credentials, and perform provider revocation; routine UI and application handlers remain outside that secret-handling boundary. Disconnecting an account disables its use at the application authority boundary immediately; it does not depend on a later job completing provider-side revocation. Credential scanning (FR-58) is a supplementary safeguard, not the security model.
>
> **FR-89.** Tenant and engagement policy controls which authorised reasoning providers may receive which audit content, including document text, images, tool results, memory and retained conversation context. Access to a document does not automatically authorise disclosure to every model provider. Model routing and fallback respect that policy. Redacted or minimised representations retain appropriate provenance, and protected originals are not silently altered to satisfy model-input rules.

## §4.17 Connectors, tools and connections — NEW

> **FR-64.** Connectors are a reusable framework: each connector declares its operations with effect class, parameter schema, confirmation default, and the idempotency and reconciliation capabilities it supports; implements one application-owned port; and passes a shared conformance suite (authorisation refusal, partial results, failures, idempotency, receipts). Phased target list: documents and files (Google Drive, OneDrive, SharePoint, uploads); email (Gmail, Outlook); calendars (Google, Microsoft); tasks (Todoist, Microsoft Planner); technical and business systems (GitHub, authorised APIs, databases, browser-accessible applications). The existing browser workspace is one connector.
>
> The tool framework covers both external connector operations and internal capabilities such as searching engagement context, running analysis, creating artifact revisions, proposing memory, requesting decisions and promoting a check. All use the applicable authorisation, provenance and receipt mechanisms under a common governed invocation model; this does not require every capability to share one undifferentiated interface.
>
> **FR-65.** A connection is per user and per tenant: created by the user's own consent flow, stored encrypted, refreshed and revoked only by the authorised credential-broker components (FR-63), audited on grant, use and revocation, and usable only inside engagements where that user is a member and the Mandate names it. A connection may serve several authorised engagements of the same user.
>
> **FR-66.** The system records the intended external operation and its bound material details before dispatch, then records attempts and confirmed results or an explicit unknown outcome. Retries use the connector's declared idempotency and reconciliation capabilities where available. Where an external effect cannot be reliably reconciled, the task pauses for resolution rather than blindly repeating the operation. Receipts distinguish requested, accepted, confirmed and unknown outcomes as applicable; the agent's claim must not exceed what the receipt establishes (confirmation that an invitation was created does not establish that attendees accepted it).
>
> **FR-67.** Access failures, partial searches, empty results and stale data are reported as what they are. An unreachable mailbox or folder is reported as unreachable, never as empty; a search that could not be completed is reported as incomplete. A calendar invitation is not proof a walkthrough occurred; an email saying an action is complete is not closure evidence.
>
> **FR-68.** Personal-account testing uses designated test folders, mailboxes, calendars, recipients and task lists. Enterprise tenant, admin-consent and permission requirements are documented separately and are not claimed proven by personal-account tests.

## §4.18 Sources, evidence and working material — NEW

> **FR-69.** Every source the agent reads is preserved as a source snapshot before analysis. A source snapshot records the acquired representation, its digest, available provider identifiers and version metadata (external id, path, revision or etag, modified time, owner where available), acquisition details (time, actor or principal, connection used) and the request that produced it. Missing metadata or limitations in the acquired representation are explicit; no value is invented. For query or paginated extraction, the record includes the request parameters, extraction boundaries and available completeness or consistency evidence. The system must not imply a complete or consistent source snapshot merely because some bytes were saved. A changed external source produces a new snapshot version; an existing snapshot is never replaced.
>
> **FR-70.** Analysis runs on separate working copies. Working material (copies, scripts, temporary extracts, intermediate outputs) is retained with the task but is not evidence. A derived analytical output becomes registered supporting evidence only when its inputs (snapshot digests), method (script or query and parameters, with its own digest) and validation are recorded and traceable.
>
> **FR-71.** Provenance distinguishes acquired source material, received material, derived analytical outputs and generated narrative. A traceable and validated analytical output may support an audit assertion. Generated narrative does not become independent source evidence merely because the agent produced it; a generated summary or log can prompt a question but never counts as evidence.
>
> Every input to an analysis or a run is assessed on independent axes, each of which may be *unknown / not established* where the required evidence is unavailable: availability and acquisition success; freshness or "data as at"; completeness and coverage; period relevance; provenance and validation status. A source can be current and partial, or complete and outside the relevant period. An empty result is interpreted through the source and population contract, never automatically as a pass or a failure. These statuses appear on the output a reader sees.
>
> **FR-72.** Missing, incomplete, stale or out-of-period inputs constrain the assessment they affect immediately, in supervised and scheduled work alike; the agent may continue on the available material but may not imply assurance over an untested population. Execution status, input and coverage status, audit assessment, and review or issue status remain separate. Supported exceptions stay visible when the broader assessment is inconclusive.

## §4.19 Artifacts — NEW

> **FR-73.** Plans, procedures, request lists, working papers, findings and reports are versioned working objects with history, supersession, a review state (draft / reviewed / approved / issued, as the methodology requires for that type) and an author record. Working drafts are always distinguishable from approved or issued outputs.
>
> **FR-74.** Material factual assertions in an artifact link to source evidence or traceable derived analysis; assumptions, hypotheses, inferences, limitations and unverified claims are labelled. Instructions, decisions, recommendations and plan statements keep their own provenance and are never shown as evidence of control operation.
>
> **FR-75.** Revising an artifact preserves its history and identifies related conclusions, artifacts and approvals that depend on the revised content and need reconsideration; an approval given on an earlier version does not carry over silently.
>
> **FR-76.** Artifact types, structures and templates come from the loaded methodology pack (FR-77); the platform supplies the versioning, review, provenance and dependency mechanisms.
>
> **FR-90.** The agent can create and revise usable documents and spreadsheets in the formats selected for the delivery phase, using approved methodology templates. It preserves relevant structure, formatting and embedded content, validates the produced file, and makes it available for inspection or authorised saving to a connected output location. Unsupported template features or generation limitations are reported rather than silently dropped. The initial supported formats and their fidelity tests are named in the implementation plan. An Artifact is a usable deliverable, not only a database record or a block of chat text.

## §4.20 Skills, methodology packs and memory — NEW

> **FR-77.** A methodology pack is versioned tenant data supplied by a firm or team: phases and gates, artifact templates, rating scales, sampling conventions, criteria authority order, reporting structures and approval requirements. The platform ships example packs (including the P-1..P-4 procedures and their fixtures as one optional example pack) and treats none as universal. Changing an active pack version is an approved, audited change.
>
> **FR-78.** Skills are reusable descriptions of how to approach an activity (context discovery, planning, document review, population analysis, control testing, reconciliation, investigation, evidence assessment, working-paper preparation, reporting). Skills describe approach; connections provide access; tools perform actions; memory and retrieved context inform. A skill cannot grant authority or bypass the Mandate.
>
> **FR-85.** The runtime can discover and load relevant approved skills for a task, either from the auditor's explicit selection or from the task's objective and context. Skills are identifiable and versioned, with their purpose, applicable context, required capabilities and expected outputs. The task record identifies the skill and methodology versions used. Loading a skill cannot grant permissions, bypass required decisions or silently alter an approved recurring-check definition.
>
> **FR-86.** Methodology documents, templates and conversational instructions can be used to propose a methodology package. The appropriate owner reviews and approves it. Configuring a methodology must not require changes to the core application.
>
> **FR-79.** Memory is a governed store with six scopes — user preference, firm or department methodology, organisation or client knowledge, engagement facts and decisions, conversation and execution state, confirmed reusable lessons — each with owner, provenance (who, where, which session or evidence), effective dates, version and supersession, and status (proposed / active / superseded / rejected).
>
> Conversation history, artifacts, evidence references, work progress and authorised engagement decisions persist through their normal governed application operations. Storing them does not automatically promote them into reusable memory.
>
> Explicit instructions such as "remember this preference" may constitute the user's recorded confirmation when the user has authority over that scope. The agent must not demand a redundant second confirmation for the same clear instruction.
>
> Agent-inferred preferences, reusable corrections and lessons are proposed with their source, scope and reason. They do not become active reusable knowledge until confirmed or approved by the appropriate owner. Pending proposals may be stored without being treated as active instructions. Broader promotion, including firm-wide methodology or cross-engagement lessons, follows the applicable approval and confidentiality requirements.
>
> **FR-80.** Retrieval filters by tenant, client and engagement before ranking, so client context cannot cross engagements. For policy and methodology, "current" means applicable to the work and period being examined, not simply the newest document; the retriever flags a mismatch between the audit period and the item's effective dates. Precedence (regulation > methodology > engagement decision > user preference) is resolved by the platform; unresolved material conflicts are surfaced rather than settled silently by the model. Memory may point to evidence and approvals but never stands in for them.

## §4.21 Controlled execution environment — NEW

> **FR-81.** Untrusted analysis code executes in an isolated environment whose filesystem, network, credentials, process privileges and resource limits are enforced outside the model and the generated code. The environment cannot access host secrets, other tenants' or engagements' workspaces, protected source locations for writing, or unrestricted external destinations. Network access is denied by default and any exception is explicitly authorised. Inputs are registered snapshot bytes and working copies; outputs are registered as derived material with the code, parameters and results preserved. Required evidence, artifacts and durable task state are preserved independently of the disposable execution environment; retention and cleanup follow the applicable policy rather than retaining every temporary file indefinitely.
>
> The web application cannot run arbitrary analysis code directly or bypass the authorised execution boundary. It may submit governed work and present authorised progress, previews and outputs through controlled application interfaces.
>
> **FR-82.** Supported document processing includes appropriate text, table, spreadsheet and visual inspection paths (PDF, Office, CSV, email MIME, images and scanned pages). Extraction records retain source locators and identify unsupported, missing or uncertain content. Corroboration refers back to the preserved source representation; structured output alone is not proof of extraction accuracy. The agent can use targeted retrieval or fuller document examination according to the task and the auditor's direction; it states material retrieval limitations and does not infer absence from an incomplete search.

## Why

Direction §A–§H; the brief §4 (Examples A–C), §5–§9 and §11 decision 3 (provider data policy); `analysis-architecture.md` Q1–Q6 and recommended changes 1–12; `analysis-backend-inventory.md` hard-coded methodology list; owner edits of 2026-09-24. This proposal states requirements; the contracts that satisfy them are Proposal 3.
