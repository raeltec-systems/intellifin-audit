# Proposal 4b of 7 — Zobba: reconciling the approved UX (Proposal 4) with the Zobba design pack v1.0

Status: draft for owner review on 2026-09-25; awaiting a / e / s. Revisits the approved Proposal 4 with the complete Claude Design pack ("Zobba design system · handoff package v1.0", 25 Sep 2026), filed in the planning workspace at `_bmad-output/planning-artifacts/ux-designs/zobba-design-system-v1.0/` (90 files: BRAND, DESIGN-SYSTEM, DESIGN-TOKENS and `tokens/zobba-tokens.json`, EXPERIENCE-RULES R1–R12, COMPONENT-INVENTORY, PATTERNS P1–P19, ASSET-MANIFEST and assets, 23 reference screens, OPEN-QUESTIONS Q1–Q15, editable sources). Product name: **Zobba** ("The audit agent", by Raeltec) replaces IntelliFin Audit. **Permissions** replaces Mandate (done on 2026-09-25).

Governing rule for this reconciliation: the approved conversation-led audit-harness direction and its safeguards (Proposals 1–3d, 4) are preserved. The pack is the authoritative **design input** (its own HANDOFF §4). Where the pack and an approved requirement or contract conflict, the conflict is listed in §5 with the smallest amendment, and nothing is silently overridden either way. The pack's model-routing and roles material is treated as **input to requirements**, not as approved architecture (§6, §7).

## 0. Decisions this proposal asks for

| Decision | Proposed choice |
|---|---|
| D-4b-1 | **Product name in the artifacts and the code.** Zobba replaces IntelliFin Audit in every product-facing sentence of the PRD, EXPERIENCE.md, DESIGN.md and the course-correction proposals now (three occurrences in the proposals are changed in this commit). Repository identifiers (`@intellifin/*` packages, `INTELLIFIN_*` variables, the repo name, telemetry service names, existing folder names of planning artifacts) are renamed in one dedicated story under Proposal 7's disposition, not piecemeal, so the rename does not become a permanent UI-to-code translation layer and does not break the deployed compiler-1 path mid-flight. |
| D-4b-2 | **Navigation follows the pack (DESIGN-SYSTEM §5): New task · Search · Scheduled checks · Engagements · Recent tasks · Connections · Settings, plus Reviews for audit managers.** Proposal 4's "Needs you" list is not a first-level destination; its content is delivered as the needs-attention badges on Scheduled checks, Reviews and Connections, the Home "Continue" list, pinned decisions in the conversation, and in-app notifications. |
| D-4b-3 | **Organisation connections are named but deferred.** The pack shows "organisation connections set up by Northstar IT" beside personal connections. The approved `connection-v1` is per user and per tenant. First release: personal connections only; the Connections page reserves the "Organisation connection" label and shows none; organisation-provisioned connections need their own contract (admin consent, service identity, per-engagement availability) in a later epic. |
| D-4b-4 | **Model and reasoning-effort choice is added as a requirement (FR-91–FR-93, §6), within administrator policy and under the disclosure policy**, recorded per step; a scheduled check keeps the model and effort it was approved with; a withdrawn model pauses the check (execution `Paused`, reason shown) and the owner's replacement choice is a recorded change that runs the check's regression case set where the pack requires it, not a full re-approval unless criteria change. Cost is visible to administrators only (Usage by engagement). |
| D-4b-5 | **Tenant roles become Auditor · Audit manager · Methodology owner · Administrator** (FR-94, §7), with engagement membership roles (lead auditor, auditor, reviewer) on top; separation of duties: an administrator cannot review or approve audit work, a preparer or contributor cannot review or approve their own, and approval and issue are separate lifecycle records. "PoC Administrator" becomes "Administrator" in product copy. Whether a distinct approver role (partner) exists beside the reviewing audit manager (pack Q14) is the owner's call; default: separate steps, the approver named by the pack's review requirements, an audit manager may hold both where the pack allows and never on work they reviewed as preparer. |
| D-4b-6 | **Accessibility target moves to WCAG 2.2 AA** (adds target size and focus-not-obscured); no allowlist of accepted violations, as today. |
| D-4b-7 | **Pack defaults accepted for its open questions unless you say otherwise:** Q3 provenance footer on by default, firm can switch off, record stays; Q4 light only in the first release; Q5 Lucide at 2px; Q7 30-second panel protection; Q8 promotion eligible for tasks using skills marked available to auditors (and always through the approval path, §5); Q12 the firm supplies templates and a neutral default is designed later; Q13 default model and effort administrator-configurable (the reference names are examples); Q15 cost to administrators only. Q1, Q2, Q9, Q10, Q11 are validations and inputs outside this proposal. |

## 1. What the pack settles that Proposal 4 already required (adopt as is)

| Pack | Proposal 4 / architecture | Note |
|---|---|---|
| R1.1 no forms for starting work; Home composer "What are we auditing today?" with starters | U3 conversation directs real work; U2 New opens a conversation immediately | Starters (Test a control, Analyse a population, Draft a working paper, Plan a walkthrough) are skill entry points (3c C11). |
| R1.2 first-person unboxed replies; "Zobba is …" chrome | U3 attribution establishes the speaker | Adopt the voice rule (BRAND §6). |
| R1.3 meaningful activity, not every tool call; R11.2 no fake counts | U4 activity summary with grouped steps; no manufactured progress | Adopt the activity list anatomy. |
| R1.5 one clarification per turn, suggested replies plus free text, paused step named | 3a C2 `clarify` wait; U3 free-text answer resolves its clarification | Adopt; a suggested reply submits the text as the answer. |
| R2.1–R2.3 workspace panel opens when useful; Pin · Expand · Close; From-task line | D-4-1 contextual panel; U2 resize, expand, close | Adopt the five layout modes and R2.2 protection (Q7). |
| R2.4 read-only browser; Take over | source protection (3a C3); controller lease and transfer (existing) | "Take over" is the existing control lease; Zobba pauses until handed back. |
| R3.1–R3.4 chrome is Zobba, the artifact is the firm template's; overlays not exported | 3c C11 packs supply templates; 3b C7 renderings | Adopt. |
| R4.1–R4.4 claim → citation → preview → drawer → back to claim; E-references; location formats per type | U4 citation with return; 3b C8 region binding | Adopt E-references as the display form of evidence ids, L-references for limitation records. |
| R5.1 direct edits save a new draft without approval ceremony; R5.2 Zobba proposes, never silently changes a conclusion; R5.3 typographic diff; R5.4 approved or issued work returns to review | D-4-2; 3b C7 immutable versions, reconsideration | "Undo" restores the previous draft as a new version; nothing is rewritten. |
| R6.1–R6.5 Permissions naming, at-a-glance sentence, seven-section detail, Activity record with decision basis | permissions-v1; Permissions Summary; step ledger receipts | Adopt the seven sections as the presentation of Effective Permissions: Can read (read), Can write (draft, write-output to working copies and drafts), Asks first (external-effect and confirm-required), Never (source mutation and Permissions Policy exclusions), Scheduled checks, Connections, Administrator limits. |
| R7.1–R7.5 one decision surface, action-specific labels, invalidation on change, per-operation outcomes | D-4-2; 3a C4 two-axis results | Adopt the labels (Allow and send · Edit first · Don't send) and the outcome sentences as fixed patterns. |
| R8.1–R8.2 review is a named human act, shown separately from assessment and execution | 3b C7 lifecycle records; four statuses | Adopt. |
| R9.2 unattended runs never take asks-first actions | 3c C12 compiler-2 has no external-effect step | Stronger than the pack: nothing to ask. |
| R9.3–R9.4, DESIGN-SYSTEM §6 six status dimensions; "Completed is execution, not assessment"; "Didn't run" has no assessment | Proposal 1 UJ-6 four statuses; U5 | Adopt the pack's vocabulary (§3). |
| R10 scope-aware search, attributed results, stale-index notice | 3c C10 retrieval coverage; U2 lists across clients without merging | Adopt Search as a first-level destination. |
| R11 honest states; DESIGN-SYSTEM §12 message patterns | U6 state-dependent sentences | Adopt the patterns; U6's recorded-state rule still governs which sentence applies. |
| §11 connections show no tokens or scopes; "A connection lets Zobba reach a system. It doesn't grant every resource…" | 3a C4; U4 accounts, capabilities and permitted locations as three things | Adopt the sentence as fixed copy. |
| §14 accessibility, claim → evidence → return by keyboard, step-granularity live regions | U10 | Adopt; target per D-4b-6. |

## 2. What the pack adds that Proposal 4 did not have (adopt into EXPERIENCE.md rev 2)

- **Identity and visual system.** Pair concept; symbol, wordmark, lockups, app icon, favicon, notification template from `assets/`; Graphite, Linen, Iris; Hanken Grotesk and IBM Plex Mono; Iris means "Zobba is here" and never an audit result; audit semantics independent of the brand (BRAND §3). DESIGN.md's "Ledger Signal" token set is replaced for the chrome; artifacts keep the firm's template typography.
- **Guidance versus Stop (R1.4, P4, P5).** Guidance typed while a step runs is "queued for the next step" and later "applied"; Stop halts the current step and says what was kept. Maps to 3c C9 (messages inform the next turn; boundary checkpoints). Amendment in §5 (Stop requested versus ceased).
- **Pair mark states and motion (DESIGN-SYSTEM §4)**: idle, working, waiting, complete; one animated mark per region; reduced motion; the mark never carries a result.
- **Select a statement and ask (P6)**: "Selected · location" tag; answers carry citations.
- **Working-data view, browser view, changes view, draft-correspondence view** as panel types.
- **Engagement page (RS 10)**: tasks, working papers and artifacts, scheduled checks, Permissions summary, Team, Client contacts, Sources, Methodology.
- **Scheduled checks list (RS 12)** with the separate dimensions per row; **scheduled result (RS 13)**: actor line, assessment chip, readable conclusion, Exceptions · Coverage · Evidence · How it ran, Mark as reviewed, Discuss this result, suggested follow-up through the confirmation flow.
- **Home (RS 01)**: greeting, composer with engagement, permissions and model chips, starters, Continue list.
- **Reviews (RS 20, 21)** for audit managers: queue grouped Waiting for your review · Returned with your notes · Reviewed recently; reviewing a paper with anchored review notes (not exported), Return with n notes, Mark as reviewed, "Approval and issue are separate steps"; Zobba's checks for the reviewer ("all 14 evidence links open · figures agree with working data · limitations carried into the conclusion") shown as checks, never as approval.
- **Settings › Administration (RS 22, 23)**: Users and roles, Models and providers, Connections policy, Administrator limits (the Permissions Policy), Data and retention, Audit log; Permission defaults and Methodology and skills for their owners.
- **Composer model and effort chip (RS 19)** — see §6.
- **Layout tokens, breakpoints (600 / 1024 / 1600), table rules, forms, search states, empty and degraded states** (DESIGN-SYSTEM §1, §7–§9, §12, §13).
- **Fixed labels and safety-critical message patterns (EXPERIENCE-RULES §12)** become the exact-copy set of U11; everything else in the screens is illustrative.

## 3. Status vocabulary: one table, six dimensions (replaces Proposal 4 U5)

| Dimension | Readable states (pack) | Approved internal state it presents |
|---|---|---|
| Execution | Not started · Running ("Zobba is …") · Paused · Stopped by you · Completed · Didn't run · Interrupted | Agent Task and Run lifecycle (3a C2, Run path); `Stopped by you` appears only when cessation is recorded (§5) |
| Wait | Needs your input · Needs your permission · Queued (guidance) | `clarify`, `confirm-action`, closed-option waits; guidance is a queued message. `reconcile` shows as "Needs your input · reconciliation" (§5) |
| Input and coverage | Complete · Partial (L-reference) · Unavailable · Stale | `input-quality-v1` dimensions (availability, coverage, freshness, period relevance); the summary chip is derived and the dimensions stay separately inspectable |
| Audit assessment | No exception · Exception(s) · Inconclusive · Not assessed | Result outcome (`run-result-v1`) and artifact assessment |
| Review and issue | Draft · Not reviewed · In review · Returned · Reviewed by [name] · Approved · Issued · Superseded | `artifact-version-v1` lifecycle records; `In review` and `Returned` are added (§5) |
| Connection | Connected · Connecting · Limited · Needs reconnecting · Disabled · Error · Not connected | `connection-v1` states (`active`, `pending`, `disabled`, `revoked`, `refresh-unresolved` → Needs reconnecting) |

Kept for inspection and review mode only, never as default chips: claim support (Supported · Not yet supported · Contradicted · Awaiting review · Cannot be checked automatically), action outcome per operation (Sent · Sent, not confirmed · Confirmed · Blocked · Failed before sending), data quality per acquisition. Every chip has a glyph and a word; dimensions never merge (DESIGN-SYSTEM §6).

## 4. What the pack does not cover (Proposal 4's rules stand; screens to be designed under the pack's rules before those stories are built)

| Gap | Governing rule |
|---|---|
| Memory: "Remembered for your preferences", proposal cards, scope and verification status, retirement | Proposal 4 U4, 3c C10; no screen in the pack |
| Draft engagement without a client; client binding moment | 3a C2, U6 "Client not selected"; RS 10 shows a bound engagement only |
| Needs-reconsideration flag and impact records on artifacts | 3b C7; not in the artifact state chip set (add "Needs another look" as a flag, not a state) |
| `reconcile` decision surface (keep observing · mark done with reference · retry with duplication warning · abandon) | 3a C2, U4; the pack has the message pattern (R7.5 unknown) but no decision surface |
| Sharing a working draft versus issuance; PDF export | Proposal 4 U1, 3b C7 |
| Promotion approval: method review, compiler mapping, unresolved issues, second-person approval, "Awaiting approval" state on Scheduled checks | 3c C12; RS 12 shows active checks only (§5) |
| Regression case sets and a version pending regression | 3d D-3d-1 |
| Retention decisions, holds, deletion (Data and retention is named, not designed) | 3b C5 `retention-v1` |
| Tenant switching for a person in two firms | 3a C1 |
| Legacy procedures view (compiler-1 Runs, Run Detail, Live View, Replay) | Proposal 4 U2, D-3d-4 |
| Organisation connections (deferred, D-4b-3) | — |
| Invitation and sign-up flow (RS 23 "Invite people", "Invited") | §7, FR-95 |

## 5. Conflicts with approved requirements or contracts, and the smallest amendment

| # | Pack says | Approved says | Smallest amendment |
|---|---|---|---|
| 1 | R1.4 / P5: "Stop halts the current step, keeps the work so far and says what was kept." | FR-88, U10: the interface distinguishes a stop request from confirmed cessation; an action already performed is never described as undone | Keep the pack's copy for the confirmed state; add the transient "Stop requested" state (working mark, "Stopping after the current step…") between the press and the recorded cessation. Execution chip `Stopped by you` only after cessation is recorded. |
| 2 | R9.1 / P12: promotion from the task menu, a schedule form in conversation, "confirmation in chrome"; R9.1 "keeps the task's method and permissions" | FR-51, 3c C12: promotion constructs a reviewed method artifact by selection, compiles it, and the Procedure Version goes through submit → independent approval → activation; a Permissions Version is frozen at approval | The task-menu entry and the in-conversation schedule form stay as the **start** of promotion. The check appears under Scheduled checks as **Awaiting approval** (a Review-and-issue state on the check) until the second person approves; the method view (Proposal 4 U4) is where the reviewer looks. "Keeps the task's method and permissions" reads as "the method artifact selected from the task and the Permissions Version bound at approval". |
| 3 | RS 12 shows only Active, Paused, Waiting, Didn't run checks | Blocked transitions (3d §8): a version whose configuration requires regression stays `APPROVED` pending regression | Add "Awaiting approval" and "Pending regression" as check states in DESIGN-SYSTEM §10; no next run while either holds. |
| 4 | §11: organisation connections "set up by Northstar IT"; LoanCore "not available as a connection" | `connection-v1`: per user, per tenant, user consent | D-4b-3: personal only in the first release; the label is reserved. "Not available as a connection · client supplies extracts" is a **source** entry (Drive folder) and stays. |
| 5 | §5b: the auditor chooses model and effort; a withdrawn model pauses the check and the owner chooses another | FR-58: providers replaceable behind one invocation model, identity recorded; FR-51: material model configuration recorded on the check, not a promise; FR-89: disclosure policy governs which provider may receive which content | New FR-91–FR-93 (§6) under the disclosure policy: the chip offers only providers and models the policy permits for this engagement's content; disabled ones show the policy reason; the choice is recorded per step; a scheduled check keeps its approved model and effort; a withdrawal pauses the check and the owner's replacement is a recorded change with regression where the pack requires it (D-4b-4). |
| 6 | R3.5: artifact states Draft → In review → Approved → Issued (+ Superseded); §6: Not reviewed · In review · Reviewed by · Returned | `artifact-version-v1`: draft → reviewed → approved → issued as lifecycle records | Add `review-requested` (shown "In review") and `returned` (shown "Returned · n notes") lifecycle records, and review notes anchored to a location, not exported. Content stays immutable per version; the record set grows, the state model does not change meaning. |
| 7 | §5a: roles Auditor · Audit manager · Methodology owner · Administrator; RS 23 per-engagement assignment, Invite people, Remove access | `roles.ts`: auditor · audit-manager · poc-administrator; 3a C1 tenant and engagement membership; 3c C11 "pack owner"; Better Auth `disableSignUp`, seed-only users | D-4b-5 and FR-94–FR-95 (§7): Methodology owner becomes a tenant role (the pack owner); `poc-administrator` is displayed "Administrator" (identifier renamed with D-4b-1's story); engagement membership roles carry lead auditor, auditor, reviewer; an invitation flow is a new requirement and the seed path remains for acceptance environments. |
| 8 | §14: WCAG 2.2 AA | NFR: WCAG 2.1 AA | D-4b-6. |
| 9 | Notifications: OS notification templates; "Zobba completed the weekly leaver check · inconclusive" | AD-20: in-app only; recurring notification policy deferred (3d §8) | In-app notification carries the sentence; OS or push delivery stays deferred with the notification-policy contract; the template icon assets are filed for then. |
| 10 | Scenario: Lumina Assurance auditing Northstar Bank plc over Outlook, SharePoint, AccessGate, LoanCore | Owner decision 2: the first acceptance uses the owner's personal Google Drive, Gmail and Calendar with synthetic data; Microsoft connectors are phased later | No design change. Proposal 6 adopts the firm and client names for the synthetic scenario and keeps Google connectors; the reference screens remain illustrative. |
| 11 | R2.4: browser read-only "unless permissions say otherwise" | 3a C3: source mutation is never grantable; the browser is a connector under Permissions | The phrase means write-output to a permitted output location; it never means a source. Copy: "read-only on client systems". |
| 12 | Breakpoints 600 / 1024 / 1600; Proposal 4 kept "below 900px live controls withdraw as today" | Proposal 4 U10 | Adopt the pack's breakpoints; the live browser view uses a full-screen surface below 1024 and safety controls stay reachable (DESIGN-SYSTEM §13). |

## 6. Model routing and reasoning effort — requirements for decision (D-4b-4)

What the pack shows: a composer chip "[Model] · [Effort] ▾"; a menu of models with provider and a note, unavailable models disabled with the reason; effort Low · Medium · High · Max; footer "Set by your administrator · recorded in How it ran"; a mid-task change applies from the next step and is noted; scheduled checks keep model and effort; Administration › Models and providers with processing region, per-engagement availability, defaults and two toggles; Usage by engagement.

Already covered: provider neutrality and the invocation model (3c C9); provider, model and prompt version recorded per turn (FR-58); the disclosure policy deciding which provider may receive which content, blocking rather than silently selecting another (FR-89, 3a C4); pinned model configuration on a check recorded, not promised (FR-51); no provider logos and no model names in artifacts (pack; 3b C7).

Needs clarification: what "reasoning effort" maps to per provider (a provider parameter with a closed four-level vocabulary and a per-adapter mapping, recorded as chosen and as sent); how a per-engagement availability rule is expressed (the disclosure policy already carries approved deployments per tenant and engagement — availability is the same document, not a second one); whether effort affects budgets (it changes cost and time, not the Permissions budget; the budget stays in tokens, steps and time).

Proposed requirements:

> **FR-91.** An auditor may choose the model and reasoning effort for a task from the set the administrator's model policy and the engagement's disclosure policy permit. Unavailable models are shown disabled with the reason and never hidden when the auditor could expect them. The choice applies from the next step, is recorded per step with provider, model, prompt version and effort, and never appears in an artifact.
>
> **FR-92.** Administrators configure providers, models, processing regions, per-engagement availability, the default model and effort, and whether auditors may change the model or choose the highest effort. The configuration is audited, versioned and applied through the disclosure policy; it cannot widen what the disclosure policy permits.
>
> **FR-93.** A scheduled check keeps the model and effort it was approved with. If that model is withdrawn or becomes unavailable under policy, the check pauses with the reason and its owner chooses a replacement; the replacement is a recorded change to the check and runs the check's regression case set where the methodology requires it. Cost and usage are visible to administrators by engagement.

Not decided by this proposal: which providers and models ship and the default (pack Q13, an implementation selection under `disclosure-policy-v1`); cost visibility beyond administrators (Q15).

## 7. Roles and user management — requirements for decision (D-4b-5)

What the pack shows: four roles with what each adds and cannot do; a Users and roles page with role, engagement assignment and status (Active, Invited); Invite people; Remove access; the reviewer named per engagement; an administrator cannot review or approve; a preparer cannot review their own work; Reviews for audit managers; approval and issue as separate steps (Q14).

Already covered: application-owned roles read on every request, never cached (existing); tenant and engagement membership with scoped authority (3a C1, D-3d-2); independence over the responsible human and contributors (3b C7); `run.control-transfer` as a separate grant; pack ownership for methodology (3c C11); "Approval and issue are separate steps" (3b C7).

Needs clarification: whether Methodology owner is a tenant role or a per-pack grant (proposal: a tenant role that owns every pack of the tenant, with per-pack delegation later); who holds the platform capability to approve a Procedure Version when the audit manager was the reviewer of the same paper (the retained rule: never the author or contributor; the reviewer may approve where the pack allows); whether "Remove access" revokes engagement membership only or the account (both, as two commands); invitation delivery (no mail transport exists today; an invitation link the administrator copies is the minimum).

Proposed requirements:

> **FR-94.** Tenant roles are Auditor, Audit manager, Methodology owner and Administrator; engagement membership names each person's role in that engagement (lead auditor, auditor, reviewer). Every capability requires the tenant role, current engagement membership where the object is engagement-scoped, and the independence rules for that object. An administrator cannot review or approve audit work. A preparer or contributor cannot review or approve their own work. Review, approval and issue are separate, attributable records; the methodology names who may approve and who may issue within these rules.
>
> **FR-95.** Administrators invite people by email to a tenant role, assign and change engagement membership, and remove access from an engagement or from the tenant; each action is audited and takes effect on the next request. An invited person completes sign-in through the invitation; there is no open sign-up. The last administrator cannot be removed.
>
> **FR-96.** A reviewer can return a version with notes anchored to locations in the artifact; notes are visible to the preparer, retained with the version's review records, and never exported.

## 8. Artifact updates once approved

- **EXPERIENCE.md revision 2** = Proposal 4's approved rules restated in the pack's structure: Foundation (Zobba, Pair, voice), Navigation (DESIGN-SYSTEM §5, D-4b-2), Interaction rules R1–R12 as amended in §5, Component patterns (COMPONENT-INVENTORY plus the §4 gaps), Status system (§3 above), Per-surface states (Proposal 4 U6 plus DESIGN-SYSTEM §12), Roles and gating (Proposal 4 U7 revised per §7), Key flows (Proposal 4 U8 mapped to PATTERNS P1–P19), Accessibility (WCAG 2.2 AA, DESIGN-SYSTEM §14), Testing (Proposal 4 U11 with the fixed-label set from EXPERIENCE-RULES §12).
- **DESIGN.md** is replaced for the chrome by BRAND, DESIGN-SYSTEM and DESIGN-TOKENS (`zobba-tokens.json` is the token source `tokens.test.ts` reads); the "Ledger Signal" section is retired; the artifact-specific state families are re-expressed as §3's six dimensions plus the inspection-only vocabularies; the existing `claude/` prototype note stays as history.
- **Proposals 1–5**: product name (D-4b-1, applied to the three occurrences now); Proposal 4's U2, U3, U5, U10 amended per §1–§5; Proposal 5's NE-8 stories re-based on the pack (8.1 becomes "review the pack's 23 screens against the six-scene set and design the §4 gaps under the pack's rules before their stories"; identity assets and tokens become story 8.0); the new FR-91–FR-96 get stories in NE-2 (composer chip, per-step recording), NE-3 (model policy under the disclosure policy), NE-1 (roles and membership), NE-8 (Reviews, Users and roles, Models and providers).
- **Proposal 6**: scenario names (Lumina Assurance, Northstar Bank plc) for the synthetic data; Google connectors unchanged.
- **Proposal 7**: the identifier rename story (D-4b-1); `seed-identity` and the acceptance seeds; the `roles.ts` identifiers.

## 9. Acceptance obligations added

The pack's HANDOFF §6 checklist becomes part of every UI story's acceptance (identity and colour, conversation and activity, workspace and evidence, decisions and permissions, honesty, accessibility), alongside Proposal 4 U11's rule that exact-copy tests cover only the fixed labels and safety-critical patterns. The pack's own closing sentence is carried verbatim: a rendered mockup is not proof that an integration, security control or execution behaviour works; permissions enforcement, confirmation invalidation, per-operation outcome reporting and evidence capture are verified in the implemented system.
