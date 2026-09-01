---
title: "Claude Design Handoff: IntelliFin Audit"
status: ready
created: 2026-09-01
updated: 2026-09-01
target: Claude Design
---

# Claude Design Handoff: IntelliFin Audit

Copy the prompt below into Claude Design. Give it access to the three source files listed under **Sources**. Save all returned files in this UX workspace. Source requirements and the two UX spines win if a generated mockup conflicts with them.

---

## Prompt for Claude Design

You are designing the exploratory proof of concept for **IntelliFin Audit**, an agentic continuous-auditing and assurance platform for internal audit teams. Create a coherent, high-fidelity desktop web experience and its visual design contract. This is a product design task, not a landing page.

### Sources

Read these source files before designing:

1. `_bmad-output/planning-artifacts/briefs/brief-IntelliFin Audit-2026-08-31/brief.md`
2. `_bmad-output/planning-artifacts/prds/prd-IntelliFin Audit-2026-08-31/prd.md`
3. `_bmad-output/planning-artifacts/prds/prd-IntelliFin Audit-2026-08-31/addendum.md`

Treat the sources as authoritative for product behavior, domain terminology, roles, requirements, states, and scope. Do not invent features outside the PoC. Flag any unavoidable design assumption.

### Product and UX north star

The product should feel **calm, forensic, trustworthy, and audit-native**. It must not feel like a chatbot, SIEM, RPA tool, or traditional form-heavy GRC platform.

An experienced auditor should immediately feel that the system understands how audit work is executed, evidenced, challenged, and reviewed. A Chief Audit Executive should be able to answer quickly:

> What is failing, what changed, and can I trust the evidence behind it?

The primary mental model is:

> Procedure → Run → Evidence → Result → Auditor Review

AI stays in the background. Auditors interact with Procedures, Runs, Evidence, Exceptions, Results, and Reviews. Agent activity and replay are supporting technical detail, never the dominant interaction.

### Visual inspiration and anti-patterns

Use these references for qualities, not imitation:

- **Linear:** hierarchy, restraint, fast navigation.
- **GitHub Actions:** Run stages, execution status, reruns, and history.
- **Stripe Dashboard:** dense information that remains calm and legible.
- **Splunk or Microsoft Sentinel investigation views:** drill-down from an issue to underlying evidence.
- **Vanta or Drata:** relationships between controls and Evidence.

Do not produce:

- ServiceNow- or Archer-style form density;
- a wall of charts, alerts, or risk heatmaps;
- an exposed RPA workflow builder;
- a chatbot-first interface or persistent AI panel;
- decorative “AI thinks…” language;
- a generic admin dashboard full of KPI cards;
- excessive configuration screens;
- control outcomes communicated by color alone.

### Form factor and navigation

Design a desktop-first responsive web application. `[ASSUMPTION]` Optimize the primary experience for 1280–1600 px wide audit workstations, remain usable at 1024 px, and provide a sensible narrow-screen reading mode without inventing a separate mobile product.

Keep global navigation small:

1. Overview
2. Procedures
3. Runs
4. Review
5. Administration — minimal and role-gated

Run, Evidence, and Exception details are nested destinations, not additional top-level navigation.

### Non-negotiable domain distinctions

Never visually conflate these four concepts:

1. **Run lifecycle:** Queued, Running, Completed, Inconclusive, Run Failed, Canceled.
2. **Evidence Quality Gate:** whether Evidence is authoritative enough to support a conclusion.
3. **System Outcome:** Pass or Control Failure; available only for a Completed Run whose gate passed.
4. **Auditor Review:** Draft, Submitted, Approved, Finalized, plus rejection/disagreement events.

`Completed` is not `Pass`. `Run Failed` is a technical failure, not a Control Failure. `Inconclusive` is not a weak fail or a pass. A reviewer disagreement or “Not an Exception” disposition never rewrites the immutable System Outcome.

Every status needs text, icon/shape, and accessible semantics; color may reinforce but never carry meaning alone.

### Required surfaces

#### 1. Overview

Answer immediately:

- Which Procedures have run recently?
- Which controls Passed or had a Control Failure?
- Which Runs are Inconclusive or Run Failed?
- What needs human attention?
- What changed since the previous Run?
- Is the underlying Evidence complete and reliable?

Use restrained summaries and prioritized lists. Avoid a chart wall. Make attention items actionable and distinguish audit issues from platform/evidence failures.

Include empty states for no Runs yet, no prior Run for comparison, and no attention items.

#### 2. Procedures list and Procedure Detail

Show the four immutable, preconfigured Procedures:

- Terminated users retaining access
- Segregation-of-duties conflicts
- High-value transactions without required approval
- Production configuration deviation

Procedure Detail shows objective, Sources, population, criteria, tolerance/boundary, expected Evidence, and Procedure Version. Users can initiate a Run but cannot author or edit Procedures.

#### 3. Runs list

Provide fast scanning and filtering by Procedure, status, effective period, and initiation time. Show Run identifier, Procedure, effective period, current lifecycle status, System Outcome when available, Evidence Quality Gate state, review state, elapsed/completion time, and change from prior Run where meaningful.

Support no Runs, no matching filters, Queued, Running, Completed, Inconclusive, Run Failed, and Canceled states. Reruns create linked history rather than replacing an earlier Run.

#### 4. Run Detail — the anchor screen

This is the most important screen. Give it the highest design attention and produce multiple states.

Its hierarchy must expose:

- Procedure tested and Procedure Version
- Run identifier, effective period, lifecycle, timestamps, and actor
- a prominent Evidence Quality Gate summary
- population reconciliation and evaluated/unevaluated counts
- immutable System Outcome, visually separate from review state
- Exception count and prioritized Exception list
- human review state, reviewer, time, and rationale/disagreement
- change since the previous Run
- actions appropriate to role and state: cancel, rerun, submit, approve, reject, finalize, export

Create at least these Run Detail variants:

1. Completed + Pass + Evidence Gate passed + not yet reviewed
2. Completed + Control Failure + Exceptions + submitted for review
3. Inconclusive because record counts do not reconcile
4. Run Failed because a required Source could not be acquired
5. Approved Result awaiting deliberate finalization
6. Finalized, immutable Result

When Inconclusive, do not show a control conclusion. Explain what failed, which Source/check is affected, why the Evidence is not authoritative, and the safe next action.

#### 5. Evidence Quality Gate and Evidence Package

The gate is not a decorative badge. Show check-by-check status and diagnostic detail for:

- Source access
- declared population
- exact record-count reconciliation, with zero tolerance
- pagination completeness
- schema validity
- mandatory fields
- duplicate primary keys
- freshness
- integrity digest

Allow drill-down to Evidence inventory. Each item can show Source, acquisition method, artifact or snapshot ID, collected-at UTC time, original time-zone context, effective period, record count, version, integrity digest, and preserved original artifact.

Make partial Evidence visibly non-authoritative. Never imply that “zero Exceptions” equals Pass unless the gate passed.

#### 6. Exception Detail and provenance

Make provenance visually clear and easy to follow:

> Source record → matched record or transformation → compared values → control rule and version → deterministic Exception

Show:

- Exception identifier and state
- violated criterion and boundary
- source systems and exact record identifiers
- original and normalized values
- values compared and calculation
- match keys and ambiguity state
- transformation history
- Procedure Version
- notes, owner, and disposition history
- “Confirmed” or “Not an Exception” human disposition

“Not an Exception” requires rationale and must leave the deterministic Exception and System Outcome visible. For terminated users with multiple accounts, support grouped employee-level context with account-level outcomes.

Include contained display of malicious prompt-like Evidence as inert source data; never render it as system instruction or trusted markup.

#### 7. Review queue and Review Detail

Review should feel like deliberate audit-workpaper sign-off, not social approval.

Show submitted Results awaiting action, reviewer identity, Procedure, System Outcome, Exception count, Evidence Gate state, submission time, and prior decisions. Review Detail must let an Audit Manager inspect the Run, Evidence, lineage, transformations, and Workpaper Bundle before deciding.

Interactions:

- Approve or reject a Submitted Result.
- Rejection requires rationale and returns the Result to Draft through a preserved review event.
- Finalize only an Approved Result.
- Finalization is clearly irreversible and requires deliberate confirmation.
- After finalization, all Evidence, Exceptions, Results, and Reviews are read-only.
- Record disagreement with a System Outcome or Exception using required rationale; disagreement is additive, not an override.

#### 8. Execution Trace — secondary detail

Place agent activity behind an explicit technical-detail affordance on Run Detail. Show ordered stages, sanitized tool calls, navigation/extraction steps, retries, errors, transformations, rule evaluations, component versions, and correlation identifier.

Use a GitHub Actions-like staged history as inspiration, but keep it subordinate to Evidence and Result. Never expose secrets. Never turn this into a workflow builder.

#### 9. Minimal Administration

Role-gated PoC surfaces only:

- users and roles;
- synthetic Source configuration;
- Source connectivity;
- runner health, retries, failures, duration, and correlation identifiers.

Administration cannot alter Evidence, System Outcomes, or finalized Results. Do not design enterprise tenant management, production retention configuration, or broad integration setup.

### Roles and action visibility

- **Auditor:** initiate/cancel/rerun, investigate Evidence and Exceptions, add notes, set human dispositions, submit a Completed Result.
- **Audit Manager:** all Auditor actions plus approve, reject, finalize, and record disagreement.
- **PoC Administrator:** manage users and synthetic Sources; view diagnostics; never alter audit Results or Evidence.
- **Chief Audit Executive:** `[ASSUMPTION]` use the Overview and read-only detail views as an executive consumer; do not add a separate executive dashboard.

Actions that are unavailable due to role or state should explain why. Do not silently hide state-dependent constraints when the explanation helps audit understanding.

### Interaction and state behavior

- Run state updates without a full-page reload.
- Prevent overlapping active Runs for the same Procedure Version and period with a clear explanation.
- Cancellation preserves Evidence already collected and marks the Run Canceled.
- Rerun creates a linked new Run; prior Run remains immutable.
- Submission is unavailable for Inconclusive, Run Failed, or Canceled Runs.
- Direct finalization from Submitted or rejected history is denied.
- Mutation after finalization is denied and explained.
- Sensitive fields are masked in lists; detail access remains role-governed.
- Empty states must never imply a Passed control.

### Voice and microcopy

Use precise, restrained, audit-native language. Prefer facts and actions over reassurance or anthropomorphism.

Good:

- “Evidence incomplete. No control conclusion issued.”
- “2 of 500 account records were not reconciled.”
- “System Outcome: Control Failure.”
- “Reviewer disagreement recorded; System Outcome unchanged.”
- “Finalize Result. This action makes the review record immutable.”

Avoid:

- “AI thinks this control failed.”
- “Great news—everything looks good!”
- “The agent got confused.”
- vague “Something went wrong” messages when diagnostics exist.

### Visual-system direction

Create one coherent design direction based on restraint, evidence density, and forensic clarity. Label visual choices not established by the sources as design assumptions.

Requirements:

- calm neutral surfaces and strong text hierarchy;
- crisp, compact data tables without spreadsheet visual noise;
- restrained borders and depth;
- dense evidence detail organized through progressive disclosure;
- monospace only for identifiers, values, digests, timestamps, and trace data—not as a general “technical” aesthetic;
- status colors reserved for semantic state, never decoration;
- Control Failure, Run Failed, and Inconclusive must have distinct semantic treatments;
- Evidence Gate should read as a trust checkpoint, not an alert banner;
- keyboard-visible focus, sufficient contrast, and no status-by-color-only behavior;
- no gradients, glow effects, robot imagery, AI sparkles, chat bubbles, or oversized analytics cards.

`[ASSUMPTION]` A light-first PoC is acceptable. If you propose dark mode, treat it as a token-ready extension, not an additional required mockup set.

### Accessibility floor

- Design for WCAG 2.1 AA contrast.
- All core workflows must be keyboard accessible.
- Preserve a logical focus order in dense detail screens and drawers.
- Statuses require visible text and non-color cues.
- Tables require accessible headers, row focus, and a non-hover path to actions.
- Dialogs must name consequences, trap focus correctly, and return focus on close.
- Do not rely on tooltips for essential evidence or instructions.

### Expected deliverables

Save outputs in:

`_bmad-output/planning-artifacts/ux-designs/ux-IntelliFin Audit-2026-09-01/`

Produce:

1. **`DESIGN.md`** — a complete visual design contract using YAML frontmatter tokens followed by these body sections in this order when present: Brand & Style; Colors; Typography; Layout & Spacing; Elevation & Depth; Shapes; Components; Do's and Don'ts. Frontmatter must contain `name`, `description`, and applicable `colors`, `typography`, `rounded`, `spacing`, and `components` tokens. Use `{path.to.token}` references.
2. **A runnable high-fidelity prototype** in `mockups/`, using the environment Claude Design supports best. It must include working navigation and state switching for the required screens, not static screenshots only.
3. **Individual key-screen artifacts** or directly addressable routes for:
   - Overview
   - Procedures and Procedure Detail
   - Runs
   - all six Run Detail variants
   - Evidence Quality Gate / Evidence Package
   - Exception Detail with provenance
   - Review queue and Review Detail
   - Execution Trace
   - minimal Administration
4. **`DESIGN-HANDOFF-NOTES.md`** listing:
   - design assumptions;
   - component inventory;
   - screen/route inventory;
   - states demonstrated;
   - accessibility decisions;
   - source requirements not represented and why;
   - any unresolved UX questions.

Use realistic synthetic content from Northstar Financial Group and the named Sources: PeopleHub, AccessGate, RoleMatrix, LedgerFlow, ApproveNow, ConfigRegistry, and ProdConsole. Do not use lorem ipsum or generic “System A” labels.

### Completion checklist

Before returning the design, verify:

- Run lifecycle, Evidence Gate, System Outcome, and Auditor Review are visually distinct.
- Every navigation item lands on a meaningful surface.
- Every required state has a visible treatment.
- Run Detail makes Evidence trust and exceptions understandable without opening the Execution Trace.
- Exception Detail shows a complete, readable provenance chain.
- Inconclusive never presents Pass or Control Failure.
- Human disagreement never rewrites deterministic classification.
- Finalization is deliberate and subsequent immutability is visible.
- AI/agent activity remains supporting detail.
- There is no chatbot-first UI, GRC form sprawl, SIEM chart wall, or exposed RPA builder.
- The result is credible to an experienced internal auditor and useful to a Chief Audit Executive.

Return a concise manifest of created files and flag all assumptions or missing source access.

---

## Return instructions

After Claude Design finishes, save or copy its generated files into this UX workspace. Then return to the BMad UX workflow in **Update** mode so `DESIGN.md` and `EXPERIENCE.md` can be reconciled, completed, reviewed, and finalized.
