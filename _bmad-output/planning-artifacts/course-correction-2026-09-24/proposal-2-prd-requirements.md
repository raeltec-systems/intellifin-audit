# Proposal 2 of 7 — PRD: new requirement sections and FR-3 revision

Status: draft for owner review, 2026-09-24.
Artifact: `prd.md` §4 (new §4.14–§4.21), §4.1 FR-3, §4.4 (promotion), §4.5 FR-20/FR-22 scope note. Numbering continues from FR-50. Existing FRs named as HOLDS in `analysis-prd-epics.md` are unchanged.

Carried forward from Proposal 1: investigation within the Mandate without unnecessary prompts; working material distinct from evidence; coverage limitations constrain conclusions immediately; execution, coverage, assessment and review statuses separate.

## FR-3 — REVISED

OLD: only allowlisted read operations; a write-capable credential cannot be registered.

NEW:
> **FR-3.** Every agent operation is authorised by the platform against a versioned Mandate before it is performed, at the point where the platform calls the tool, never inside the tool adapter or the model. Original received evidence and audited operational source records are never modified through any port; that operation is not expressible. Collaboration and output operations (draft, write to an approved output location, send, create, update a working record) exist only as declared connector operations with an effect class, and are permitted only for the resources and operations the Mandate names. A denied operation is recorded as a security event with its reason and is never retried as a transport failure. Content retrieved from documents, mail, pages or memory can never change what is permitted.

## §4.4 — ADD (promotion)

> **FR-51.** Work performed in an engagement can be promoted to an approved recurring check: a versioned procedure artifact bound to its execution requirements (authorised sources and connections, population and period rules, identity and matching rules, criteria and method, evidence requirements, schedule, outcome vocabulary, review responsibility). Promotion goes through the existing approval path; the approver is not the author where independence requires it. Existing FR-13..FR-18 apply to the promoted check. A promoted check runs only against the sources and connections its definition names; drift in a source's shape, an expired connection or a changed methodology version stops the run and requests re-approval rather than running silently.

## §4.5 — SCOPE NOTE

FR-20 (per-Target-System sign-in loop) and FR-22 (record × system Work Item grid) describe the recurring-check execution path and remain valid there. Conversation-led work uses the task execution model in §4.15. Both paths share the evidence, gate, audit-chain and wait mechanisms.

## §4.14 Engagements and tenancy — NEW

> **FR-52.** An Engagement is the primary business object: client, period, objective, team membership, authorised sources and connections, and the Mandate in force. An engagement starts as a draft with any of these unset; the agent may work on what is set, and an unset detail blocks only the action that needs it.
>
> **FR-53.** Every stored record that belongs to a tenant, client or engagement carries that scope, and every read, write, retrieval, background job and connector credential use is filtered by the scope of the authenticated actor's membership and grants. Scope is never taken from an identifier supplied by the model, the browser or a message body. The owner's personal workspace is a single-owner tenant with the same enforcement.
>
> **FR-54.** Isolation is proven, not assumed: negative cross-scope tests (a member of one client's engagement cannot read, retrieve, be shown, or act on another client's material, memory or credentials) run in CI before any personal account is connected, and the same tests run against every later release.

## §4.15 Conversation and agent tasks — NEW

> **FR-55.** A conversation is a durable, engagement-scoped record. Auditor messages are model input on a request channel; they never carry authority. Authority changes only through typed, attributable, revision-guarded commands, and explicit confirmations are recorded as such (the existing receipt discipline: received → interpreted → queued → applied / refused / superseded, never inferred from state).
>
> **FR-56.** An Agent Task is the unit of directed work: it has an owner, an engagement, a Mandate version, a state machine, a lease, a budget (steps, time, tokens) reserved before paid work, a step ledger (each tool call with its arguments digest, effect class, outcome and receipt), and chained audit events in the same transaction as each effect. Tasks survive worker restarts, can be paused, cancelled and resumed at tool boundaries, and can run in the background with the auditor away.
>
> **FR-57.** The agent asks a targeted question when information or a decision is genuinely missing. A question is a durable wait with a deadline; a free-text answer is data on the request channel, never an instruction that widens authority. Escalations with closed option sets (FR-27) remain for the cases that need them.
>
> **FR-58.** The agent's reasoning models are replaceable behind one application-owned port that carries messages, tool schemas and results; provider identity, prompt version and usage are recorded on every turn; no raw provider text or rejected output is retained; credentials are scanned out of every request and response.
>
> **FR-59.** The auditor can watch a task live (timeline, tool calls, captured screens where a browser is used), pause, resume, stop and take or hand over control, with the existing lease and gate rules.

## §4.16 Mandate and permission model — NEW

> **FR-60.** A Mandate is the versioned authority a task runs under: the intersection of the administrator's ceiling, the auditor's own connected access and grants, and the engagement's scope. It names permitted connector operations by effect class — `read`, `draft`, `write-output`, `external-effect` (send, create or update outside the platform) — the source locations (read and snapshot only) and output locations (writable), execution budgets, and which effect classes need explicit confirmation. Source mutation is not an effect class and cannot be granted.
>
> **FR-61.** Routine operations inside the Mandate — reads, snapshots, calculations, drafting, investigation of adjacent patterns within the authorised sources — run without a prompt. Operations outside the Mandate are refused. Operations the Mandate marks confirm-required are presented with their material details and performed only after an explicit, recorded confirmation bound to those details.
>
> **FR-62.** The Mandate is enforced at three layers and each is tested: the application gate at the tool call site; the connector adapter (which cannot perform an operation its declared capability does not include); and the execution environment (network, filesystem and credential limits). A prompt, a memory item, a skill or retrieved content can never widen any layer.
>
> **FR-63.** Credentials and connection tokens never enter model-visible content, logs, the audit chain, artifacts or the web process; they are resolved just in time in the worker and are structurally unable to be read back.

## §4.17 Connectors and connections — NEW

> **FR-64.** Connectors are a reusable framework: each connector declares its operations with effect class, parameter schema and confirmation default, implements one application-owned port, and passes a shared conformance suite (authorisation refusal, partial results, failures, idempotency, receipts). Phased target list: documents and files (Google Drive, OneDrive, SharePoint, uploads); email (Gmail, Outlook); calendars (Google, Microsoft); tasks (Todoist, Microsoft Planner); technical and business systems (GitHub, authorised APIs, databases, browser-accessible applications). The existing browser workspace is one connector.
>
> **FR-65.** A connection is per user and per tenant: created by the user's own consent flow, stored encrypted, refreshed and revoked only in the worker, audited on grant, use and revocation, and usable only inside engagements where that user is a member and the Mandate names it.
>
> **FR-66.** An external effect is reported only after the connector confirms it; the confirmed result (identifier, receipt) is linked to the engagement. An operation with an unknown outcome is reconciled (looked up by its idempotency key) before any retry that could duplicate it.
>
> **FR-67.** Access failures, partial searches, empty results and stale data are reported as what they are. An unreachable mailbox or folder is reported as unreachable, never as empty; a search that could not be completed is reported as incomplete. A calendar invitation is not proof a walkthrough occurred; an email saying an action is complete is not closure evidence.
>
> **FR-68.** Personal-account testing uses designated test folders, mailboxes, calendars, recipients and task lists. Enterprise tenant, admin-consent and permission requirements are documented separately and are not claimed proven by personal-account tests.

## §4.18 Sources, evidence and working material — NEW

> **FR-69.** Every source the agent reads is preserved as a source snapshot before analysis: bytes stored immutably with digest, size, source identity (provider, external id, path, revision or etag, modified time, owner), retrieval query, acquisition time and the connection used. A changed external source produces a new snapshot version; an existing snapshot is never replaced.
>
> **FR-70.** Analysis runs on separate working copies. Working material (copies, scripts, temporary extracts, intermediate outputs) is retained with the task but is not evidence. A derived output becomes registered supporting evidence only when its inputs (snapshot digests), method (script or query and parameters, with its own digest) and validation are recorded and traceable.
>
> **FR-71.** Every input to an analysis or a run carries a freshness and completeness status (current / carried forward / missing / partial / out of period) and a provenance class (system of record, raw received input, generated). Generated content can prompt a question but never counts as evidence. These statuses appear on the output a reader sees.
>
> **FR-72.** Missing, incomplete, stale or out-of-period inputs constrain the assessment they affect immediately, in supervised and scheduled work alike; the agent may continue on the available material but may not imply assurance over an untested population. Supported exceptions stay visible when the broader assessment is inconclusive.

## §4.19 Artifacts — NEW

> **FR-73.** Plans, procedures, request lists, working papers, findings and reports are versioned working objects with history, supersession, a review state (draft / reviewed / approved / issued, as the methodology requires for that type) and an author record. Working drafts are always distinguishable from approved or issued outputs.
>
> **FR-74.** Material factual assertions in an artifact link to source evidence or traceable derived analysis; assumptions, hypotheses, inferences, limitations and unverified claims are labelled. Instructions, decisions, recommendations and plan statements keep their own provenance and are never shown as evidence of control operation.
>
> **FR-75.** Revising an artifact preserves its history and identifies related conclusions, artifacts and approvals that depend on the revised content and need reconsideration; an approval given on an earlier version does not carry over silently.
>
> **FR-76.** Artifact types, structures and templates come from the loaded methodology pack (FR-77); the platform supplies the versioning, review, provenance and dependency mechanisms.

## §4.20 Skills, methodology packs and memory — NEW

> **FR-77.** A methodology pack is versioned tenant data supplied by a firm or team: phases and gates, artifact templates, rating scales, sampling conventions, criteria authority order, reporting structures and approval requirements. The platform ships example packs (including the P-1..P-4 procedures and their fixtures as one optional example pack) and treats none as universal. Changing an active pack version is an approved, audited change.
>
> **FR-78.** Skills are reusable descriptions of how to approach an activity (context discovery, planning, document review, population analysis, control testing, reconciliation, investigation, evidence assessment, working-paper preparation, reporting). Skills describe approach; connections provide access; tools perform actions; memory and retrieved context inform. A skill cannot grant authority or bypass the Mandate.
>
> **FR-79.** Memory is a governed store with six scopes — user preference, firm or department methodology, organisation or client knowledge, engagement facts and decisions, conversation and execution state, confirmed reusable lessons — each with owner, provenance (who, where, which session or evidence), effective dates, version and supersession, and status (proposed / active / superseded / rejected). Nothing becomes durable beyond execution state without an explicit, recorded confirmation; promotion to firm scope follows the pack's approval rule.
>
> **FR-80.** Retrieval filters by tenant, client and engagement before ranking, so client context cannot cross engagements; precedence (regulation > methodology > engagement decision > user preference) is resolved by the platform and conflicts are surfaced. Memory may point to evidence and approvals but never stands in for them.

## §4.21 Controlled execution environment — NEW

> **FR-81.** Analysis code the model generates or selects runs only in a sandboxed executor in the worker: separate process or VM, no network and no credentials by default, inputs limited to registered snapshot bytes and working copies, resource limits recorded on the step, and outputs registered as derived material with the code, parameters and results preserved. The web process can never execute code or reach the sandbox.
>
> **FR-82.** Document processing (PDF, Office, CSV, email MIME) produces structured snapshots with locator grammars so extracted values can be corroborated against the preserved bytes, as the Structural Snapshot mechanism does for web pages today.

## Why

Direction §A–§H; the brief §5–§9; `analysis-architecture.md` Q1–Q6 and recommended changes 1–12; `analysis-backend-inventory.md` hard-coded methodology list. This proposal states requirements; the contracts that satisfy them are Proposal 3.
