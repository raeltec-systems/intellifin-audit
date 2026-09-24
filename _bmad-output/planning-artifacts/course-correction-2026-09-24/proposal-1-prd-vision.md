# Proposal 1 of 7 (revised) — PRD: vision, primary object, journeys, non-goals, scope

Status: APPROVED by the owner on 2026-09-24 as the basis for PRD revision 4. The approval settles product direction and wording; it does not authorise implementation or pre-approve the contracts in Proposals 2–7.
Artifact: `prd.md` §1, §1.1 principle 4, §1.2, §2.3, §7, §8.1, §8.3. New revision (rev 4).

## §1 Vision — NEW

> IntelliFin Audit is an audit-agent harness. An auditor states what they want to accomplish in an engagement; the agent reads the authorised sources, proposes an approach, performs the work with real tools and connections, produces inspectable artifacts, and works through corrections with the auditor. Agent actions, material decisions, artifact revisions and outcomes are recorded with appropriate provenance and remain subject to human review. Suitable work can be promoted to an approved recurring check that the agent then performs on schedule.
>
> The reusable harness provides real tools and authenticated connections, reusable skills, configurable methodology packages, governed memory and context, a controlled execution environment, and evidence-linked artifacts. Reasoning models operate within this harness and are replaceable. IntelliFin owns permissions, durable work state, provenance, review and execution records.
>
> Firm methodology, organisation knowledge and engagement context configure how the agent works. No particular employer, industry, demonstration scenario or methodology pack defines the universal product behaviour.
>
> These harness capabilities are product requirements in their own right (§4.14–§4.21, added in Proposal 2); their detailed contracts follow in later revisions.

## §1 Primary object and relationships — NEW

> The product's primary business object is the **Engagement**: a scoped body of audit work (client, period, objective, team, authorised sources and authority). Conversation is the primary way work is directed inside it.
>
> The interaction's starting point is lighter than a completed engagement. An auditor can start a conversation in a draft engagement whose objective, period, sources and other details are established progressively. A completed engagement definition is never a precondition for the agent to help. Tenant, client and access boundaries are enforced before any relevant material is accessed; an unresolved detail blocks the affected action, not the whole conversation.
>
> Plans, procedures, request lists, working papers, findings and reports are **Artifacts** the agent builds and the auditor reviews. An **Audit Procedure** describes a test or approach and may be drafted, revised and used for one-time or recurring work. An **approved recurring check** binds a versioned procedure and its execution requirements into an authorised, repeatable definition. A procedure artifact alone does not grant execution authority.
>
> The objects relate as follows; this is a set of relationships and an optional promotion path, not a mandatory linear workflow. Conversation, analysis, evidence acquisition, artifact revision and review are iterative, and many legitimate tasks never become recurring checks.

```
ENGAGEMENT
  ├─ CONVERSATIONS and AGENT TASKS
  │    Directed work, under a Mandate.
  ├─ SOURCES AND EVIDENCE
  │    Preserved source snapshots and registered supporting evidence,
  │    including traceable derived analytical outputs where applicable.
  ├─ WORKING MATERIAL
  │    Separate working copies, scripts, temporary extracts and intermediate outputs.
  ├─ ARTIFACTS
  │    Versioned plans, procedures, request lists, working papers, findings and reports.
  ├─ DECISIONS and REVIEW RECORDS
  │    Attributable; approval enforced where required.
  └─ optionally: PROMOTION → APPROVED RECURRING CHECK → scheduled RUNS → RESULTS
```

> Working material is not automatically evidence, and registration does not by itself establish that an interpretation is correct. Derived analytical outputs may support audit assertions when their inputs, method, provenance and validation are traceable. Generated narrative remains distinct from independent source evidence.
>
> These are conceptual distinctions; this proposal does not prescribe separate database aggregates for each branch.

## §1 Accountability, replay and reproducibility — NEW

Replaces the absolute "every action and conclusion stays … replayable" and "Artifacts … the auditor signs".

> Agent actions, material decisions, artifact revisions and outcomes are recorded with appropriate provenance. Auditors can inspect the work and its supporting evidence. Formal approval is enforced at the applicable review, issue, activation and external-action boundaries; working drafts remain clearly distinguishable from approved or issued outputs.
>
> Browser replay is provided where captured and supported. Analytical work retains the source snapshots, code or queries, parameters and outputs needed for inspection and reproduction. Connector actions retain confirmed results and receipts. The platform preserves what actually happened rather than promising that a future model call will reproduce the same answer. Replay never re-performs a live external action.

## §1.1 Principle 4 — NEW

> **Least privilege is enforced by the platform.** The agent does not modify original received evidence or audited operational source records. Analysis uses preserved source snapshots and separate working copies. Creating or updating working artifacts and performing collaboration actions is permitted only for explicitly authorised resources and operations under a versioned Mandate.
>
> The auditor may configure authority within their own permissions and the administrator's limits. Tenant, client and engagement isolation is enforced from the first implementation. Prompts, memory, skills and external content never grant authority.

## §1.2 Trust Seam — keep the four rules; add a fifth

> **Factual claims are distinguished from other artifact content.** Material factual audit assertions must be traceable to source evidence or reproducible derived analysis. Assumptions, hypotheses, inferences, limitations and unverified claims must be clearly distinguished. User instructions, recorded decisions, recommendations and planning statements retain their appropriate provenance without being misrepresented as evidence of control operation.
>
> Generated narrative is not independent source evidence. Neither a citation nor an inference label, by itself, establishes that a conclusion is verified.

## §2.3 Journeys — NEW (generic), then the first acceptance case

Six industry-neutral journeys replace UJ-1..6:

- **UJ-1 Establish context and plan.** The auditor opens or continues a draft engagement and states an objective. The agent reads the authorised material, says what it found, what it assumed and what it still needs, and proposes a plan artifact the auditor edits; the edit is versioned.
- **UJ-2 Perform analysis and testing.** The agent obtains source snapshots, works on separate copies in a controlled environment, and produces derived outputs linked to their inputs, with population completeness and period relevance stated.
- **UJ-3 Investigate signals.** The agent may identify and investigate relevant patterns beyond the auditor's literal request when the investigation remains within the agreed objective, authorised sources, permitted operations and execution limits of the current Mandate. It records material investigative steps and distinguishes hypotheses, signals and confirmed findings. New access, material scope expansion, or changes to approved criteria or recurring-check definitions require the applicable approval. Within an approved recurring run, adjacent investigation must not silently change the formal check or its result.
- **UJ-4 Correct and review artifacts.** The auditor corrects an overstated result; the agent revises the artifact, preserves its history, flags related conclusions and approvals for reconsideration, and proposes — never silently applies — retaining the correction in memory at the appropriate scope.
- **UJ-5 Coordinate evidence requests, correspondence and walkthroughs.** The agent reads relevant correspondence and attachments to update or propose updates to the request record, and prepares meetings and messages; an external action is presented with its material details and confirmed before it is performed, and the confirmed result is linked to the engagement.
- **UJ-6 Promote to a recurring check and run it.** Suitable work is promoted to a versioned procedure with its execution requirements; approval is by someone other than the author where independence requires it; a scheduled run reports Pass / Exception / Inconclusive / Failed-to-run truthfully. Execution status, input and coverage status, audit assessment, and review or issue status remain separate. "Pass / Exception / Inconclusive / Failed-to-run" is user-facing summary vocabulary, not a single interchangeable state model. Successful execution can produce an inconclusive assessment; a completed draft is not an approved or issued result.

**Coverage limitations (applies to UJ-2, UJ-3 and UJ-6):**

> Missing, incomplete, stale or out-of-period inputs must constrain the assessment they affect, whether encountered during supervised analysis or scheduled execution. The agent may continue useful work on the available material, but must not imply assurance over an untested or unsupported population. Supported exceptions remain visible even when the broader assessment is inconclusive.

In the first acceptance case the post-exit login is an investigative signal, while the partial application-user population is a coverage limitation that constrains the relevant conclusion immediately, independent of whether the signal is investigated. Proposal 6 carries these distinctions into the acceptance criteria: deferring advanced scheduling or drift management does not defer the basic checks that establish that the approved definition ran against authorised, suitable inputs.

**First acceptance case (owner decision 2), mapped onto the journeys:** a synthetic leaver-access engagement. UJ-1: the control wording, period and sources are discovered in Google Drive files and one assumption is stated. UJ-2: the leaver list, directory extract and application user list are snapshotted and traced on working copies. UJ-3: a post-exit login and a partial user population surface as signals. UJ-5: a Gmail evidence thread is read to update the request record, and one calendar invitation to a designated test recipient is proposed, confirmed and created. UJ-4: the auditor corrects an overstated result and the memory proposal appears. UJ-6: the analysis is promoted to a monthly check, approved by a second person, and one scheduled rerun runs, including a deliberately incomplete input reported Inconclusive. Prohibited source changes are refused and a connection failure is reported honestly. The scenario is acceptance data, not harness behaviour.

## §7 Non-goals — REVISED

Removed: "free-form conversational procedure authoring"; "broad Adapter catalog… cross-industry control library" (replaced by: *no connector is promised beyond the phased list; no methodology is universal*); "root-cause analysis, finding management, or audit-plan management".

Replaced:

> **Data and environments.** Initial development and acceptance use synthetic engagement material and designated resources in the owner's personal accounts. Employer systems and confidential organisational audit data are excluded from these tests. Real-data adoption requires separately satisfied security, privacy, isolation, permission and operational-readiness gates.
>
> **Sending and external effects.** In the first connector journey, sending an email or creating an invitation requires explicit confirmation of the proposed action and its material details. Recurring notifications may operate under an explicitly approved notification policy defining recipients, permitted content and triggers. Neither a general account connection nor vague conversational assent authorises unrestricted sending.
>
> **Deterministic evaluations.** Recorded deterministic evaluations cannot be overwritten or silently relabelled. Auditors may challenge the inputs, criteria, method or interpretation. Corrections follow the appropriate versioning, approval and rerun process, preserving the original result and decision history.

Kept: no autonomous issuance of assurance opinions; no actions outside authorised systems and operations.

## §8.1 / §8.3 — REVISED

The P0 capability map is replaced by the first complete end-to-end acceptance (Proposal 6). It includes a thin recurring-execution proof — promotion, second-person approval, one scheduled rerun, and a deliberately incomplete input yielding Inconclusive — so the bridge from conversation-led work to an approved scheduled run is demonstrated. Fuller scheduling and recurring-check capabilities (missed starts, handover, regression, drift detection, notification policies) are later phases and move from §8.3's "deferred" list into the epic plan (Proposal 5). "Conversational authoring" and "unstructured documents as sources" leave §8.3.

## Why

Direction §A–§I; the reference brief §8.1–8.3 and §9; owner edits of 2026-09-24. This proposal refines the PRD text only; it does not authorise implementation or settle the contracts reserved for Proposals 2–7.
