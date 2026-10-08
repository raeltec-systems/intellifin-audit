# Zobba — Product and Architecture Direction
## Build the audit agent we now know we want

**From:** Israel Muyoba, Raeltec Systems Limited  
**Assignment:** Develop the product design and technical architecture for Zobba's next direction.

**Our project:** https://github.com/raeltec-systems/intellifin-audit  
**Engineering reference:** https://github.com/openai/codex

This brief replaces `Zobba_Product_and_Target_Architecture_v1.md` and `Zobba_BMAD_Product_Architecture_Handoff.md` as the direction for this design work.

## 1. Start from the product, not from preserving the implementation

Zobba is in early development. It is not an established customer product that we need to migrate without disrupting a user base. We have built useful things, tested assumptions and learned what the product should actually be. That learning is the value of the work so far.

**Design the strongest coherent product from what we now know. Keep existing work where it helps. Rebuild, replace or discard it where it gets in the way.**

The current stack, schema, modules, APIs, procedure engine, Builder, contracts, tests, epic structure and previous deferrals are all open to revision. Previous approval means a decision was appropriate at that point; it does not make that decision permanent. Do not build compatibility layers or keep two engines alive merely to protect development work from replacement.

A clean backend rebuild, a fresh development schema or retiring the earlier execution model completely are valid recommendations. Explain the practical consequences and choose the cleaner path. Rebuilding something with a better understanding is progress, not failure.

We are settling the full product and architecture now. The output is the design we intend to build, followed by an implementation plan derived from it—not a prototype proposal or another general research exercise.

## 2. Understand what led us here

I have used coding agents such as Claude Code and Codex to do real audit work. I gave the agent an engagement folder, instructions about my methodology and working style, and templates. Through conversation, it helped with planning, controls-design assessment, operating-effectiveness testing, population analysis, investigation, working papers and report writing.

The valuable experience was not simply faster drafting. The agent worked through the material, used tools, noticed relationships I had not explicitly asked it to investigate, explained what it found and helped me refine the resulting audit work. I directed the objective and exercised judgement; I did not define every execution step.

We then studied Codex's source code through two independent engineering reports. We now have concrete lessons about task ownership, tool dispatch, context, cancellation, recovery, concurrency and testing. Finally, the supplied dots screenshot made the interaction target tangible: conversation beside the actual computer doing the work, with contextual questions, sign-in handoffs and takeover.

**We are building our own audit-specific harness with that working experience.** Codex is an engineering reference. The dots screenshot is an experience reference. Zobba supplies its own runtime, audit behaviour, methodology, tools, memory and work product.

## 3. The product

> Zobba is an audit agent with its own working environment. An auditor gives it an objective through conversation. It uses applications, reads and analyses information, investigates relevant patterns and produces audit work. The auditor can watch, inspect, question, redirect, take over and review the result.

The product serves internal audit teams, external assurance teams and independent auditors across industries. Firm methodology and engagement context determine how the work is conducted. No employer, demonstration company or example control defines universal behaviour.

The experience spans the audit cycle: understanding the engagement, planning, evidence requests, walkthroughs, testing, investigation, working papers, findings, reporting and follow-up. Successful work can become an ongoing check, and new evidence can bring an unfinished task back into motion.

The underlying reasoning models are replaceable. The harness, the working environment and the audit experience are ours.

## 4. The experience to design

Imagine this conversation:

**Auditor:** “Review the leaver-access process for this quarter. The files are on SharePoint. Check the system as well, investigate anything unusual and prepare our working paper.”

Zobba finds the relevant material, understands the objective and starts useful work. It explains its approach where that helps. It asks about information that actually changes the task, such as which of two conflicting policies applies.

When it needs the application, the auditor sees the real browser or desktop beside the conversation. If sign-in is required, Zobba hands it over, then continues once the session is ready. When a data comparison is needed, it uses an analytical program rather than laboriously copying rows through the interface.

**Auditor:** “Show me why you think this is an exception.”

Zobba opens the relevant analysis and supporting records. The auditor can inspect them, challenge the interpretation and request an edit. The working paper updates, with the change visible. The conversation and task remain intact.

**Auditor:** “Let me take over for a moment.”

Control moves to the auditor. After handback, Zobba observes the current state and carries on. It remains responsive to guidance while other work is running.

**Auditor:** “Run this check each month and bring the exceptions to me.”

Zobba turns the suitable method into a recurring definition with the necessary review, sources, period rules and expected outputs. Subsequent results return to the same working relationship.

That is the target. The auditor does not complete a setup wizard, author execution scripts or manually enter provenance fields before receiving help.

## 5. Direction established through our discussions

**Conversation leads.** Requests, explanations, questions and corrections happen naturally. Forms have a place in administration and configuration; they are not the primary audit workflow.

**Zobba does the work.** Routine operations and relevant investigation proceed within Permissions. It chooses suitable tools and pursues useful leads. Questions are for genuine ambiguity, missing access or consequential decisions—not permission to perform every calculation.

**The workspace is real.** The auditor watches and controls the actual environment being used, not a simulated activity display. The panel also shows tables, documents, evidence and changes when those are more useful than the desktop.

**Rust is the starting direction for our own agent engine.** Design the backend coherently around that engine. A broader Rust backend is welcome where it is cleaner than maintaining old TypeScript services and bridges. Use appropriate technologies for the web interface, browser drivers and analytical programs; language uniformity is not the objective.

**Zobba remains Zobba.** Use the Pair identity, the term Permissions, and the three roles: Auditor, Audit manager and Admin. Admin manages configuration, users, methodology and skills; audit review and issuance remain audit responsibilities. Zobba's interface surrounds deliverables that follow the firm's templates.

**Scope follows the vision.** Managed computers, takeover, sign-in, long-running context, memory, parallel work, schedules and event-driven continuation belong in the product design. Earlier deferrals do not exclude them. Delivery can be incremental without defining the product as a permanently reduced demonstration.

## 6. Capabilities the architecture must bring together

| Capability | What the product needs to do |
|---|---|
| **Conversation and task coordination** | Turn an objective into continuing work; accept guidance during execution; explain progress; ask targeted questions; manage several tasks without losing their context. |
| **Managed computer** | Provision and operate browser and desktop environments, open files and supported applications, maintain working sessions, suspend idle compute and recover the work. |
| **Live viewing and control** | Show the actual session; support takeover and handback; distinguish agent control, human control, sign-in and reconnection; remain usable from narrower screens. |
| **Tools and connections** | Work with document stores, email, calendars, repositories, task systems and business applications. Design for Google Drive, Gmail, Microsoft OneDrive/SharePoint, Outlook, calendars, GitHub and task tools such as Todoist. Use direct APIs, MCP integrations or computer interaction as appropriate. |
| **Analysis and documents** | Read PDFs, scans, Office documents, spreadsheets, CSVs and email; inspect embedded images; run code and queries over large populations; produce useful working papers, reports, workbooks and PDF exports. |
| **Context and memory** | Maintain the active engagement, previous decisions, corrections and unresolved questions. Compact long conversations without losing important context. Learn reusable preferences and relevant client knowledge. |
| **Methodology and skills** | Configure phases, testing approaches, templates, rating scales and review requirements. Discover and load suitable skills. Help turn supplied methodology documents into usable configuration. |
| **Continuing work** | Work after the auditor closes the tab; resume when evidence arrives; run scheduled checks; notify the responsible person of meaningful results, blockers and decisions. |
| **Delegated and parallel work** | Assign independent analyses to helper tasks, coordinate their results and keep shared applications and documents consistent. |
| **Audit deliverables and review** | Link conclusions to evidence and analytical methods, show limitations, support correction and collaborative review, and distinguish a draft from approved or issued work. |
| **Users and organisational operation** | Support individual use and teams, engagement assignments, account connections, model configuration, Permissions and separation of client work. |

Text and speech should direct the same task system. A spoken request is another way to work with Zobba, not a separate execution path.

## 7. Engineering lessons to carry forward

Use **Report A** as the main input for task ownership, the Rust architecture and recovery. Use **Report B and its appendix** for additional implementation patterns, concrete failure cases and test designs. Apply engineering judgement rather than adopting either report wholesale.

The lessons we are taking forward are:

| Lesson | Application to Zobba |
|---|---|
| **One owner for continuing work** | Each task has one authoritative state owner. Commands and accepted guidance are durable; active work is independently interruptible. |
| **Record actions as operations, not chat messages** | Separate the requested operation, its attempts and its observed outcome. Resume from recorded work instead of blindly replaying actions. |
| **Recovery includes reconciliation** | A lost response can leave an action uncertain. Resolve that uncertainty through the actual tool or application rather than having the model invent success or failure. |
| **Context has provenance** | Know which source, decision, skill or memory supplied each part of the working context. Refresh dependent context when information or access changes. |
| **Bound resources throughout** | Control execution capacity, output sizes, queues, model usage and slow-client delivery. A waiting auditor does not occupy a worker indefinitely. |
| **Tools have explicit contracts** | Bind tool identity, account, parameters and results. Tool visibility and an external tool's description are different from permission to execute it. |
| **Use native provider adapters** | Give Zobba its own model-facing representation, with proper handling of tools, images, streaming, effort, continuation and errors across supported providers. |
| **Learn from failure-focused tests** | Exercise interruption between state transitions, stale workers, late results, permission changes, process descendants, conflicting resource identities and slow consumers. |
| **Reuse understandable code** | Adapt coherent units and their tests where that saves work. Track the source revision, modifications and applicable notices. Build the audit-specific behaviour ourselves. |

An exploratory working plan is not a frozen execution script. The agent can investigate within the objective and Permissions. A recurring assurance check has a defined method and criteria. Keep those two forms of work distinct.

Methodology requirements, optional skill advice, user preferences and retrieved content also have different standing. A presentation instruction from the auditor can override optional skill guidance; it cannot silently remove a required audit approval. Model the distinction rather than hard-coding one universal hierarchy for every firm.

The research gives us engineering mechanisms to use. It does not require a new benchmarking project before we can make an architecture decision.

## 8. Design these parts as one system

### A. Agent engine and application backend

Define the Rust runtime, its modules, task state, command handling, scheduler, model adapters, context assembly and tool dispatch. Decide how the broader backend should be organised around it. Prefer clear ownership and a small number of well-justified deployment boundaries over a collection of services inherited from earlier decisions.

Select a coherent persistence and queue approach, including how a task and its queued work are committed together. Existing PostgreSQL, queue and authentication choices can be retained or replaced on merit. Avoid two implementations competing to own the same work.

### B. Workspace and execution

Define the managed-computer backend, operating-system profiles, browser/desktop control, live display transport, file transfer and session recovery. Recommend concrete infrastructure and explain the relevant application support and operating cost.

Separate durable work from the currently running machine. Also separate credential-bearing application sessions from general analytical execution. They should feel like one working environment to the auditor while having appropriately different capabilities underneath.

### C. Sign-in, takeover and human collaboration

Define how an auditor authenticates without putting passwords into the conversation; how control transfers at the actual input gateway; how stale inputs are stopped; and how Zobba resumes from the state left by the person.

Make watch, guide, pause, stop, take over and hand back understandable and distinct. A slow model or tool call must not make those controls unresponsive. Decisions, useful results and accepted guidance survive reconnection.

### D. Permissions and operating purpose

Support three practical cases: inspecting live operational sources, exercising workflows in a designated test environment, and coordinating audit work through documents, email and calendars.

An application test may create synthetic borrowers or submit test approvals. That is different from changing live audited records. Apply the distinction to actual accounts, systems and actions across connectors, browsers and desktop tools.

Build client separation, credential custody and attributable decisions into normal operation. These are product capabilities, not repeated approval ceremonies for routine work.

### E. Knowledge and model use

Define engagement context, long-conversation compaction, memory, methodology packages, skill selection and provider continuity. The agent should learn useful preferences and facts while keeping their source, scope and confidence understandable.

Specify model selection and routing across conversation, visual computer use, analysis and review. Give administrators control of permitted models and processing destinations, and show the auditor what configuration is being used. Keep one accountable task even when several models or helpers contribute.

### F. Work products and continuing assurance

Define how files, source snapshots, scripts, calculations, working papers and findings relate. Preserve acquired evidence and make the analytical basis inspectable. Keep execution outcome, input completeness, audit conclusion and human review distinguishable without cluttering normal reading.

Design schedules, evidence-arrival triggers, standing requests and recurring assurance checks. Explain how new information resumes work or revises a conclusion, and how a successful investigation becomes a repeatable check.

## 9. Reassess the existing code on merit

After defining the target, map the current implementation to it. For each significant area, recommend **keep, adapt, rebuild or remove**, with a short reason and its destination in the new design.

Include the existing Builder and procedure-first flow, compiler-1 engine, schema, evidence services, queues, authentication, frontend, test harnesses and deployment setup. None gets an automatic exemption because it is implemented, tested or previously approved.

Preserve useful lessons and tests of behaviours we still want. Replace tests that only enforce a design we are abandoning. Existing development fixtures and synthetic histories are not a reason to retain an obsolete schema or execution engine. Where a clean restart is simpler than a compatibility bridge, recommend the clean restart.

Identify specific information worth carrying forward. Do not assume we need a production-style migration programme for a product still being developed.

## 10. The deliverable

Produce **one coherent product-and-architecture package**, with a short owner-facing summary and the technical detail beneath it:

1. **Product design:** the complete working experience, principal workflows, interaction states, roles and responsibilities.
2. **Target architecture:** recommended stack, module and deployment boundaries, state ownership, model/tool interfaces, managed workspace, sign-in, takeover, memory, background work and evidence flow. Include diagrams and normal/recovery sequences.
3. **Existing-code disposition:** what to keep, adapt, rebuild and remove; explain where starting fresh is the better decision.
4. **Planning-document revision:** the PRD, experience rules, architecture and contracts that need to change to describe this product consistently. Replace obsolete assumptions rather than accumulating contradictory addenda.
5. **Capability dependencies:** the order in which the architecture becomes a usable product. This becomes the basis for the next epics and stories; it is not constrained to the previous numbering or slice boundaries.

Recommend concrete choices. Resolve ordinary engineering decisions yourself and explain the reasoning. Bring me the few consequential choices that affect the experience, commercial model, operating cost or overall architecture, with a recommendation for each.

Use both studies and inspect the relevant source where a decision depends on it. Refresh the project state so your disposition reflects work actually present. Focus additional research on unresolved architectural choices, not repeating the broad Codex study.

**Complete the product and architecture design first. We will review that design together and derive the build plan from it.**

## Reference material

- **Primary study:** `Zobba-Codex-Source-Study-2026-09-29(1).md` — task ownership, recovery, context and Rust architecture; particularly §§4–7.
- **Supporting study:** `codex-source-study.md` and `codex-source-study-appendix.zip` — implementation mechanisms, policy probe, execution/recovery cases and test evidence; particularly §§4 and 9.
- **Engineering source:** `https://github.com/openai/codex`. Both studies examined `8ffd91e42aa001b7e897bea812b02f89264f9fa0`.
- **Our code and planning:** `https://github.com/raeltec-systems/intellifin-audit`, including the course-correction documents and existing implementation.
- **Experience reference:** the supplied dots screenshot showing conversation, an actual computer workspace, contextual clarification, sign-in and takeover.
- **Visual identity:** Zobba's accepted Pair design pack.

The studies' earlier prototype recommendations, language preferences and legacy-preservation assumptions are research positions, not instructions that override this brief.

**Design Zobba around the audit working relationship we want to create. Make the codebase serve that design.**
