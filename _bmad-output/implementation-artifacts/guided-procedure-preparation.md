# Prepare an audit procedure — the guided authoring direction

**Status:** owner-adopted direction, 2026-09-11. Stories 2.15, 2.9 and 2.10 shipped
in PR #30. The owner's deployed-UI review refines the experience in
`guided-authoring-experience-correction.md`: select established synthetic Template
context and evidence, then design and revise test steps with a central assistant.
That document is the implementation-ready acceptance contract for this correction;
the broader subsequent stories below remain outside this slice.
**Supersedes:** `v2-conversational-authoring.md`, which framed this as v2. The owner moved it
into v1 after reviewing LivePlan; that note stays as the record of how the idea started and the
junior-auditor framing it produced.

> **The pattern is not "AI rewrites a text box". It is: guide the auditor through the
> assignment, turn their inputs into a clear procedure, obtain their approval, then obtain
> independent manager approval before allowing execution.**

Two complementary experiences: **AI-assisted preparation before the Run**, and the **supervised
agent execution** Epics 3–5 already deliver.

---

## 1. What is already enforced, and needs no work

The owner's governance requirements were checked against the code rather than assumed. **Ten of
them are already true**, several more strongly than the direction assumes.

| Requirement | Where it already holds |
|---|---|
| `Draft → auditor approved / awaiting manager review → manager approved → Active` | `PROCEDURE_VERSION_TRANSITIONS` is exactly `DRAFT → SUBMITTED → APPROVED → ACTIVE`, with no shortcut. **`SUBMITTED` already means "the auditor approved this version and sent it for manager review"** — the proposed chain needs no new lifecycle state. |
| Manager requests changes → returns to the auditor, and must be re-approved by the auditor before returning | `SUBMITTED → REJECTED → DRAFT`. A Draft can only leave through `SUBMITTED` again, so the auditor's re-approval is structural. |
| A **different person** must approve — not the same person switching role | `authorApprovingOwnVersion` checks `humanAuthorIds` — **every** human author of the version, not only its creator — and **denies when the author is unknown**. A caller that omits the author is refused rather than trusted. |
| No Run may execute an unreviewed version | `createRun` refuses unless the period's owner is `ACTIVE` **and** carries a frozen review. Manual initiation and rerun share that one function, so there is no second door. |
| No "quick test" that runs an unreviewed procedure | No such path exists. Every Run goes through `createRun`. |
| A non-executing preview | `ExecutablePlanPreview` — derives and renders the plan, calls no Target System, starts no Run. |
| Approval covers the **recurring assignment**, not each occurrence | The Schedule is part of the frozen version; a Run binds the version. A new week needs no new approval. |
| Preparing v4 must not modify v3, and must not inherit its approval | Generation 14 refuses frozen-field updates to `APPROVED`, `ACTIVE` and `RETIRED` rows; new versions start `DRAFT`. |
| Procedure approval ≠ approval of a Run's findings | Separate gated actions; result review is Epic 6. |
| Choosing "logs" must not license exploring every logging system | The frozen registration's `allowed_origins` and `permitted_actions` bound it, `authorizeToolAction` refuses outside them, and the workspace egress allowlist refuses at the network. Three layers, none of them a UI rule. |
| The guided builder and the advanced editor must operate on the same version | They already do — one row, one row-version token, every editor guarding against it. |

**One gap in the execution restriction, named rather than assumed.** Scheduled Runs are Epic 8
and do not exist yet. When they are built they must go through `createRun` like everything else.
That is a rule to pin in Epic 8's spec, not a defect today.

---

## 2. What is genuinely new

| | Size |
|---|---|
| **Templates structured around risk, control, objective and criterion reference** — the governing document an institution already has, in the form this product already uses | Small, but **addendum §C changes first** (see §7) |
| **AI drafting per section** — the auditor's rough words become a professional draft they accept, edit or reject | Medium |
| **Section state splits in two** — "drafted" is not "reviewed by the auditor" | Small, and load-bearing |
| **Material proposals as explicit, unapplied changes** with a stated basis | Medium |
| **Cross-section dependency flagging** when an upstream decision changes | Medium |
| **Reference documents (design inputs) vs Evidence (execution inputs)** as separate ideas | Medium |
| **The manager's consolidated review view** | Small — `VersionDiff` and `AgentSummary` are most of it |
| **Three-column layout** — outline, section, assistance panel | Small |

---

## 3. The section model

Presented as **"Prepare an audit procedure"**, not "Configure an agent".

| Section | The question the auditor is asked | What assistance prepares |
|---|---|---|
| Risk, control and objective | "Which control are we testing, and what do we need to establish?" | The objective, tied to the Template's risk and control, with the policy criterion named separately |
| Scope and period | "Which records, entities, systems and period are included?" | The population definition, inclusion and exclusion criteria, the testing period |
| Evidence to review | "What evidence should the agent examine?" | Evidence types, the fields or content that matter, approved locations, access prerequisites |
| Audit steps | "What should the agent do with that evidence?" | Ordered instructions that preserve the auditor's intended work |
| Assessment criteria | "What is compliance, an exception, or an unresolved item?" | Conditions, thresholds and escalation questions, grounded in the supplied criteria |
| Frequency and handling | "When should this repeat, and when should the agent stop or ask?" | Frequency, period rule, operating limits, escalation instructions |
| Review and submission | "Does this accurately describe the work you intend to delegate?" | The consolidated procedure and an execution summary, for auditor approval |

**A guided path, not a rigid interview.** An experienced auditor jumps straight to Assessment
criteria or edits the whole procedure; someone new works down the list.

### Evidence: what is reviewed, separately from where it lives

The auditor first chooses a **kind**:

- **Files and documents** — reports, minutes, data extracts, spreadsheets
- **Logs and audit trails** — activity records, access logs, change histories
- **System configuration or settings** — the values and controls visible in an approved application

Only then: **"Where should the agent obtain or inspect this evidence?"**

For the PoC a location is an uploaded file or an already registered system. No
document-management integration is needed to prove the experience.

---

## 4. Two kinds of assistance, and they must not be confused

**Improve wording** — grammar, structure, expression. Does not deliberately change scope or
criteria.

**Suggest improvements** — proposes additional checks, evidence or clarifications, and says
plainly that these change the assignment.

A material proposal is shown as an **unapplied change**:

> **Suggested change:** Add a check that access was disabled within 24 hours.
> **Basis:** Selected access-management policy, clause identified in the supporting document.
> **Additional evidence needed:** Termination timestamp and disablement timestamp.
> **Status:** Not applied.

Where no supporting criterion was supplied, it must say so rather than invent a policy reference.

### Why this cannot be automated away

**Even a wording-only rewrite is reviewable, because nothing here can guarantee semantic
equivalence for prose.** The platform already has that guarantee for the *plan* —
`equivalentExecutablePlan` refuses a model answer whose meaning differs — but that works because
a plan is a compiled structure. There is no compiler for a sentence.

So the mechanism for prose is **show the diff and require acceptance**, not a check. The failure
this prevents is concrete:

> "Check **all** terminated employees" → "Review a **representative sample** of terminated employees"

That silently narrows the test and changes what the Result means. Likewise "immediately" →
"within 24 hours", a new privileged-role definition, an added application, or a one-off test
becoming daily.

**A related gap worth naming:** `scopeWideningWarnings` (FR-8) already flags an instruction that
widens scope — a write verb, an out-of-scope origin, an unregistered system. It does **not**
detect scope being *narrowed*, because until now only a person could narrow it and they knew
they had. An assistant that rewrites prose makes narrowing reachable, so it needs its own
answer.

---

## 5. Section states

```
Not started → Drafting → Needs clarification → Reviewed by auditor
```

- Polished AI text is **still a draft** until the auditor accepts it. Generating does not
  complete a section.
- An unresolved material question **prevents** a section being marked reviewed.
- Today's vocabulary (`done | todo | attention | reference`) has no way to say "written but not
  yet accepted", because until now everything was typed by a person. That distinction is the
  whole point and has to be added.

**Dependency flagging.** When an upstream decision changes, affected sections return to review:

> "The assessment criterion changed. Please review the evidence requirements and audit steps
> before submission."

It neither silently rewrites those sections nor resets unrelated ones.

---

## 6. The three approvals, kept distinct

| | Meaning |
|---|---|
| **Section acceptance** | The auditor agrees with a part of the draft. **New** — a sub-state within `DRAFT`. |
| **Auditor approval** | The auditor reviewed the whole assignment and submits *that exact version* for management review. **Exists** — this is `SUBMITTED`. |
| **Manager approval** | An independent authorised reviewer approves that version for activation. **Exists** — this is `APPROVED`, then `ACTIVE`. |

This settles the open question `v2-conversational-authoring.md` raised: the auditor has **two**
acts of assent, and they are different claims. Section acceptance is "this part is right";
auditor approval is "the whole of it is what I intend to delegate".

A procedure can be fully prepared and not authorised to run, and the interface must say so
plainly:

> **Preparation complete**
> Auditor approved version 3.
> **Awaiting manager review — execution unavailable.**

Not a green "Complete" badge beside a disabled button with no reason.

### What the manager reviews

The Template's risk and control, the objective, scope, evidence, audit steps, assessment criteria,
frequency and uncertainty handling — plus material changes since the last approved version and
any open comments. Not the auditor's AI conversation, and not raw configuration.

Above all: **"This is the work the agent will be authorised to perform."** That summary must be
derived from the executable settings. Approving a good narrative while the agent runs different
rules would defeat the review. `AgentSummary` is already built that way — read entirely from the
frozen plan, compiling nothing — so it is the right foundation.

**Manager actions for the PoC:** *Approve for activation* or *Request changes*, with comments
attached to a section. A manager does **not** silently rewrite and approve their own edit; that
would collapse the author/reviewer relationship. If direct editing is added later, substantive
edits return to the auditor for acceptance first.

---

## 7. The governing document is the Template we already have

Every institution has some governing document that tells an auditor what to test in each area —
a risk register, a risk assessment register, a risk matrix; the name and the format differ by
institution. **That thing is what this product already calls a Template.** In production a
Template would be shaped around whatever the institution actually uses. So there is **no new
entity**, and no PRD revision blocking this: the work is to make the existing Template more
structured, framed around **risk, control, objective and criterion reference**.

### What a Template holds today

`ProcedureTemplate` in `packages/domain/src/procedures/templates.ts` already carries `objective`
for all four, and `controlStatement` for P-1 — `null` for the others, because §C states nothing
there and the module refuses to invent a value where the contract is silent.

So the gap is small and specific:

| Field | Today |
|---|---|
| `objective` | present, all four |
| `controlStatement` | P-1 only; `null` for P-2, P-3, P-4 |
| **risk** — what this control mitigates | **missing** |
| **criterion reference** — the policy or standard clause the test is grounded in | **missing** |

### The mechanical consequence: the addendum is the work

Templates are **build constants pinned to addendum §C on disk**.
`tests/unit/procedure-templates.test.ts` reads the addendum and requires every stored string to
appear verbatim in that Template's block — and, deliberately, *"a stored default that appears
nowhere in the block could never be pinned"*.

**So a new Template field cannot be typed into TypeScript first.** The order is: state it in
addendum §C for each Template, then transcribe it, and the test proves the transcription. That
is a feature — it is what stops a deployment drifting from the contract its own tests assert —
and it means **most of this story is editing the addendum**, with the code following.

### Freezing is already handled

`initialDraftSections` copies the Template's text into the version's `sections` at creation, and
`sections` is part of `FrozenPlanInputs`. **A Template edited later therefore cannot retroactively
change what an approved version says it was testing.** Risk and criterion reference ride that
same mechanism; they need no new freezing rule.

### Proposed Epic 2 extension stories

Epic 2 is *"Author and approve a Procedure"*, so this is its territory — not Epic 5.

| Story | What it delivers | Depends on |
|---|---|---|
| **2.9** | The procedure outline and the split section state (`Not started / Drafting / Needs clarification / Reviewed`), with the three-column layout | — |
| **2.10** | **Help Me Write** on the prose sections — objective, scope note, audit steps: rough notes in, professional draft out, *Use this draft / Edit / Ask for changes / Keep my wording*, then *Mark reviewed and continue* | 2.9 |
| **2.11** | **Suggest improvements** as explicit unapplied proposals carrying basis, added evidence and status; and the wording-vs-meaning split, including the narrowing check | 2.10 |
| **2.12** | Cross-section dependency flagging on material change | 2.9 |
| **2.13** | The manager's consolidated review view, comments per section, *Approve for activation* / *Request changes* | 2.9 |
| **2.14** | Reference documents (design inputs) kept distinct from Evidence (execution inputs) | 2.9 |
| **2.15** | Structure the Templates around risk, control, objective and criterion reference — addendum §C first, then the constants, then the pinning test | — |

**Recommended first slice: 2.9 + 2.10.** It is the smallest thing that produces the LivePlan
feel, it touches no frozen contract, and the owner can judge the rest after using it.

### One hard constraint on all of it

**The assistance is additive.** The forms stay exactly as they are. If the model is slow,
unconfigured or unavailable, the Builder works the way it works today. That is what makes this
safe in v1 rather than v2: it is help on top of a surface that already works, not a replacement
for one.

**The cost to know about:** this puts paid model calls on the authoring path. Today the only one
there is the plan check, once per save. Writing help runs whenever it is asked for.

---

## 8. The acceptance demonstration

> An auditor starts with rough instructions against a Template, uses assistance to prepare the
> procedure, receives a manager comment, revises and resubmits, obtains approval, and starts the
> agent. At every earlier stage execution is refused with a clear explanation.

**Most of that harness already exists.** `tests/e2e/owner-walkthrough.spec.ts` walks create →
author → submit → approve as a manager → initiate → read the sealed Result through the
interface, against a real worker and real synthetic systems. What it would gain is the structured
Template start, the assistance steps, the manager comment round trip, and the explicit refusal at
each earlier stage.

---

## 9. What we deliberately do not copy from LivePlan

- **Unrestricted document flexibility.** LivePlan lets a user add, remove and reorganise plan
  sections. Presentation here can be flexible, but an auditor must not remove a mandatory scope,
  evidence or approval requirement by deleting a section from the outline.
- **"Make it more persuasive."** The assistant optimises for clarity, completeness, faithful
  interpretation and testability — not rhetoric.
- **LivePlan's "Ready" marker as a governance control.** It is a progress indicator.
  The auditor-to-manager authorisation chain is our design, and the reviewed documentation does
  not show LivePlan supplying anything equivalent.

## 10. What we do copy

- **Guided assistance and ordinary editing operate on the same underlying work.** LivePlan's
  Help Me Forecast turns a guided conversation into normal, editable forecast entries. Ours must
  do the same: the guided builder and the advanced editor both write the one procedure version.
- **Readiness feedback beside the work**, linking to the section that needs attention. That is
  `ReadinessPanel` grown into *Check procedure readiness*, with findings like "privileged roles
  undefined" or "disablement timestamp unavailable" — supporting human approval, never
  substituting for it.
- **Section-appropriate assistance**, rather than one chat box for everything.

---

### Sources reviewed

Documentation only; not a hands-on test inside a signed-in account.

- https://www.liveplan.com/features/ai-powered-liveplan-assistant
- https://help.liveplan.com/using-the-ai-liveplan-assistant
- https://www.liveplan.com/blog/planning/liveplan-assistant-help-me-write
- https://help.liveplan.com/creating-your-business-plan
- https://www.liveplan.com/features/business-plan-builder
