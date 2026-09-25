# Owner direction — course correction, 2026-09-24

Recorded verbatim from the owner (Israel) on 2026-09-24. Baseline for analysis: `main` at `c18ad36`.

We are changing IntelliFin Audit from a procedure-led, form-driven application into a conversation-led audit-agent harness. This is a product and architecture correction, not another UI cleanup.

Testing has shown that the current experience asks the auditor to do too much configuration before meaningful work can begin: navigate sections, define structured inputs, select settings and prepare the system to execute a procedure.

The experience I want is how I work with Claude Code over my audit workspace. I explain what I am trying to accomplish. The agent reads the relevant material, uses the available context, proposes an approach, performs work with tools, produces inspectable outputs and works through corrections with me.

The agent must be able to do the audit work—not merely advise me or help me complete forms.

## A. The primary experience should be conversational

An auditor should be able to start with requests such as:

> "Here are the documents for this engagement. Help me understand the process and plan our work."
> "Test whether this control operated effectively during the period."
> "Investigate these exceptions and help me understand where the control failed."
> "Use our report template to prepare a first draft from the findings we have reviewed."

The agent should discover what it can from authorised sources, explain material assumptions and ask targeted questions when information or decisions are genuinely missing. It should not make the auditor manually describe every analytical step or answer every field from the existing procedure builder through chat.

Plans, procedures, working papers, analyses, findings and reports should emerge as structured artifacts that the auditor can open, inspect, edit and approve.

Settings screens still have a place for account connections, permissions, methodology, templates and administration. Most everyday work should happen through the conversation and its associated artifacts.

## B. The harness needs real tools and connections

IntelliFin must connect to the applications where auditors actually work. This includes:

| Area | Target integrations and capabilities |
| --- | --- |
| Documents and files | Google Drive, OneDrive, SharePoint, uploads and authorised local-file access where supported: find and read documents, retrieve relevant versions, obtain working copies and save outputs to approved locations. |
| Email | Gmail and Outlook: find correspondence, read threads and attachments, identify outstanding requests, draft messages and send when authorised. |
| Calendars | Google and Microsoft calendars: read relevant events, check available scheduling information, arrange walkthroughs and update meetings when authorised. |
| Tasks and planning | Todoist, Microsoft Planner and comparable applications: retrieve tasks, create follow-ups, update authorised records and surface deadlines. |
| Technical and business systems | GitHub, authorised APIs, databases and browser-accessible applications: inspect information relevant to the engagement and perform permitted operations. |

These are target capabilities. We should establish a reusable connector framework and phase the integrations, with real connections demonstrated early.

The agent must understand the engagement context when using these tools. For example:

> "Set up a walkthrough with this department on Friday to go through the control we have been discussing."

It should use the current engagement to identify the control, relevant contacts and proposed agenda, consult the calendar, and resolve any missing date, time, time-zone or recipient details. Where confirmation is required, it should present the proposed invitation before creating it, then link the confirmed event to the engagement.

Similarly:

> "Check whether they have sent the evidence we requested."

It should search the relevant correspondence, inspect matching attachments and update or propose an update to the evidence-request record based on what was actually received.

A calendar invitation must not automatically become proof that a walkthrough occurred. An email saying an action is complete must not automatically become verified closure evidence.

## C. Source protection and authorised collaboration must coexist

Original evidence and received documents must remain protected. The normal document-handling pattern should be:

Authorised source → preserved source snapshot → working copy and derived outputs.

The agent should retain the source identity, available version information, acquisition time and integrity information. Analysis and transformations should happen on separate working copies, with outputs linked to the source snapshots used.

Changes to an external source should be captured as a new version, rather than silently replacing the source behind an existing analysis.

At the same time, protecting sources must not prevent authorised collaboration. The agent should be able to create a meeting, prepare an email, create a follow-up task or revise its own working paper within the permissions granted to it.

Permissions should distinguish reading from writing, drafts from sending, source locations from output locations, and routine work from actions requiring confirmation.

As an auditor, I should be able to configure the agent's authority within the access I possess. In an organisational deployment, administrator-defined restrictions must set the outer boundary.

Routine actions within an approved boundary should not require a prompt for every read or calculation. Actions outside that boundary must be blocked or require an explicit decision. Existing requirements for independent approval must remain enforced.

These restrictions must be enforced by the application, connectors and execution environment. Prompts and memory alone are insufficient. Credentials must remain outside model-visible content, and instructions embedded in documents, emails or external pages must not be allowed to change permissions.

## D. The runtime must support actual work and truthful execution

The harness should orchestrate replaceable reasoning models, tools, skills, context and human decisions. IntelliFin should own the audit semantics, permissions, evidence and execution records rather than tying them to one model provider.

The runtime must support multi-step work, sandboxed script execution, document processing, data analysis, appropriate browser interaction, interruptions, resumption and durable background execution. The analysis environment needs controlled filesystem, network, credential and resource access.

The model can reason about what analysis is needed and generate or select code. Actual calculations and comparisons should be executed through appropriate tools, with the method and results preserved.

Tool operations must produce verifiable outcomes. The agent may say a meeting was created, an email was sent or a document was saved only after the corresponding operation is confirmed. Uncertain outcomes must be reconciled before retrying in a way that could create duplicates.

Access failures, incomplete searches and stale data must be visible. An inaccessible mailbox is not "no response received," and an unavailable folder is not an empty folder.

## E. Skills, methodology and memory are core capabilities

The harness needs reusable skills for activities such as context discovery, planning, document review, population analysis, control testing, reconciliation, investigation, evidence assessment, working-paper preparation and reporting.

Skills describe how to approach work. Connections provide access. Tools perform actions. Memory and retrieved context inform the work. These need clear responsibilities in the architecture.

Firms and audit teams should supply their own methodology, phases, templates, rating scales, sampling conventions, reporting structures and approval requirements. Do not hard-code the conventions from my current workspace as universal audit rules.

The memory system should distinguish:

- User preferences.
- Firm or department methodology.
- Organisation or client knowledge.
- Engagement facts, decisions and unresolved questions.
- Conversation and execution state.
- Confirmed reusable lessons.

Corrections should persist at the appropriate scope so the auditor does not have to keep repeating them. However, a one-off wording change must not silently become firm methodology, and an unverified hypothesis must not become an accepted fact.

Routine work and execution state should persist through normal application operations. Promotion of knowledge into broader or more authoritative use should follow the appropriate review rules.

Memory needs provenance, ownership, access scope, versioning and supersession. It can point to evidence and approvals but must not replace them. Client-specific context must not leak into another client's engagement.

## F. Artifacts must be inspectable, correctable and evidence-linked

The product should manage plans, procedures, request lists, analytical outputs, working papers, findings and reports as real, versioned working objects.

The auditor should be able to say:

> "This conclusion is overstated. We only have evidence for part of the period."

The agent should revise the affected artifact, preserve its history and identify any related conclusions or approvals that require reconsideration.

The system must distinguish source evidence, traceable derived analysis and generated narrative. A generated assertion is not evidence merely because the agent wrote it confidently.

Review should address population completeness, period relevance, source freshness, contradictory information, unsupported inferences and limitations—not only whether a report is internally consistent.

Use the attached Claude reference brief as a reference for the intended experience and its lessons: persistent corrections, direct source access, investigative assistance, and the difference between instructed behaviour and enforced safeguards. Treat its organisation-specific conventions as examples. The brief covers one auditor's workspace and explicitly does not assess IntelliFin's implementation. *(Not available in the analysis session; not yet filed.)*

## G. Continuous assurance remains a core goal

The product should support the end-to-end audit working relationship: planning, fieldwork, control-design and operating-effectiveness testing where applicable, investigation, reporting, review and follow-up.

A successful investigation or test developed through conversation should be capable of becoming an approved recurring check.

The agent should then perform that work on schedule, preserve evidence, surface exceptions and limitations, and prepare outputs for human review. Material changes to the approved method, criteria, sources or authority must be versioned and governed rather than accumulating silently in memory.

The agent should also notice relevant patterns beyond the literal request. It may investigate within its authorised mandate, while keeping exploratory signals separate from confirmed findings. Material scope expansion or new access requires the appropriate approval.

Execution success, input completeness, assessment and review status must remain distinct. A task that ran successfully against incomplete data must not be presented as a passed control.

## H. Keep the product neutral and test with personal accounts

IntelliFin is my independent product. It must remain usable across industries, employers and audit disciplines, including internal-audit teams, external-audit firms and specialist auditors.

Initial connector testing will use my personal Google, Microsoft and other authorised accounts—not employer systems or company information. Use synthetic engagements and designated test folders, calendars, recipients and task lists.

The first connector demonstration should show the agent finding a document, preserving the original, analysing a working copy, producing an output, using email or calendar context and completing an explicitly authorised collaboration action.

It should also prove that prohibited source changes are refused and connection failures are reported honestly.

Identify enterprise account, tenant and permission requirements separately. Personal-account testing must not be represented as proof that every organisational integration works.

## I. What should change in the existing product and plan

Use the consolidated main baseline you identified, c18ad36, for the course-correction analysis.

Stop expanding the form-driven procedure builder as the primary experience. Assess the remaining epics against this direction before continuing their implementation.

Determine which existing components should be retained, extended, replaced or retired. Preserve valuable foundations such as evidence integrity, durable execution, authorisation, approval controls, review history and traceable decisions.

Where an existing architectural contract restricts the intended agent experience, identify the conflict and propose a replacement that preserves the underlying safeguard.

Do not assume a full rewrite or a language migration. Equally, do not assume the existing architecture can support this merely by changing its screens. Assess that from the code.

## Working mode

Incremental. The outcome should be a coherent plan for building this audit-agent harness, with a manageable first end-to-end demonstration and a clear path to the broader product.
