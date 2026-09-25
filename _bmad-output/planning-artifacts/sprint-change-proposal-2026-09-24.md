---
title: "Sprint Change Proposal — Zobba course correction of 2026-09-24"
status: approved (owner, 2026-09-25) — course correction complete; controlled story preparation authorised
created: 2026-09-25
baseline: "main c18ad36 (includes PR #51 Auditor Workspace v1.1 and PR #52 UI cleanup)"
branch: claude/ecstatic-turing-mxntoc
scope_classification: Major
proposals: "_bmad-output/planning-artifacts/course-correction-2026-09-24/ (Proposals 1, 2, 3a, 3b, 3c, 3d, 4, 4b, 5, 6, 7 — all approved)"
---

# Sprint Change Proposal — Zobba course correction of 2026-09-24

This is the final decision document of the `/bmad-correct-course` run started on 2026-09-24 (Incremental mode). It consolidates the eleven approved proposals into one record and asks for one final approval. Three kinds of statement are kept apart throughout: **approved decisions** (the owner's a/e/s record), **planned work** (stories, slices, gates that will happen), and **verified results** (what has actually been established on `main`). Nothing in this document is a verified result unless it says so.

Standing owner constraints, verbatim, binding on every story: "No implementation is authorised." (until explicit implementation authorisation); "Do not hard-code the scenario into the harness."; "Initial connector testing will use my personal Google, Microsoft and other authorised accounts—not employer systems or company information."; "Personal-account testing must not be represented as proof that every organisational integration works."; "Credentials must remain outside model-visible content, and instructions embedded in documents, emails or external pages must not be allowed to change permissions."; "Build tenant, client and engagement scoping with enforcement from day one"; "Preserve historical evidence, signed content and identifiers that existing records depend on."; "The invitation secret is protected from model context and ordinary logs."; "Do not change application code or retire existing tests prematurely merely to make the planning documents pass; tests move with their corresponding implementation and legacy disposition."

## 1. Issue summary

**Trigger.** The owner's direction of 2026-09-24 (`course-correction-2026-09-24/direction-2026-09-24.md`, sections A–I): the product must become a conversation-led audit-agent harness — an auditor states what they want to accomplish in an engagement, the agent reads authorised sources, proposes an approach, performs the work with real tools and connections, produces inspectable artifacts and works through corrections, and suitable work can be promoted to an approved recurring check. Firm methodology, organisation knowledge and engagement context configure the agent; no employer, industry, scenario or methodology pack defines universal behaviour. Existing safeguards (evidence integrity, durable execution, authorisation, approval controls, review history, traceable decisions) are preserved.

**Evidence of the gap on `main` `c18ad36`** (`analysis-prd-epics.md`, `analysis-backend-inventory.md`, `analysis-web-ux.md`): the primary experience is a form-driven Procedure Builder over four hard-coded Templates; the one "conversation" is a fixed-vocabulary command console over one Run with no model reply; no connector to documents, mail or calendars exists; the PoC is single-tenant; EXPERIENCE.md's own rule reads "free text reaches the agent nowhere". Roughly half the backend (audit chain, durable execution, evidence integrity, gate, approvals, waits, live channel, credential containment) is provider-neutral and exactly what the direction preserves.

**Later inputs folded in:** the owner's terminology correction (Mandate → Permissions), the Zobba design pack v1.0 and Pair identity (product name Zobba, by Raeltec), the role consolidation to Auditor · Audit manager · Admin, and the owner's edit passes on every proposal.

## 2. Impact analysis

| Area | Impact |
|---|---|
| PRD | Superseded §1 vision, journeys, principle 4, non-goals, scope; revised FR-3; new §4.14–§4.21 with FR-51–FR-96; FR-1–FR-50 held with `[COMPILER-1 PATH]` markers where they presume the Builder; WCAG 2.2 AA; owner constraints in §6. **Done as documentation: PRD revision 4 (`492ff62`).** |
| Addendum | Additive `[COMPILER-1 PATH]` dispositions (§C, §D, §E, §H); no row changed. **Done: revision 5.** |
| Architecture | Spine revision 5: every AD amended or held with a verdict block, AD-24–AD-34 added, conventions, stack, seed, capability map, deferred list, ownership, blocked transitions, verification obligations; a contract register of 54 rows (23 NEW, 8 EXTENDED, 20 HOLDS, 2 SUPERSEDED, 1 RETIRED). **Done: `c5c8352`, `c831c7f`.** Contract files under `docs/contracts/` are written by the stories that establish them (planned). |
| UX | EXPERIENCE.md and DESIGN.md revision 2 under `ux-designs/ux-Zobba-2026-09-25/`, built on the Zobba pack; the 2026-09-01 spines kept intact with a superseded note for the compiler-1 surfaces. **Done: `63eb98e`, `15c7b30`.** Design-acceptance register of 16 undesigned surfaces (planned, gates stories). |
| Epics and stories | Epics 1–3 done and retained; Epics 4–5 in review, classified compiler-1, closure by evidence review (story 10.1); Epic 6 split; Epic 7 deferred; Epic 8 absorbed; Epic 9 standing; new Epics 10–19. Four gated delivery slices after an isolation prerequisite. (Planned; tracking changes applied on this approval.) |
| Technical | Tenancy with RLS from the first migration; Engagement and Agent Task beside `audit_run`; Permissions gate per operation; connectors, worker-side OAuth broker, disclosure and model policy; sources, derivations, artifacts, sandbox, agent loop, memory, packs, promotion via compiler-2. Rename IntelliFin Audit → Zobba in two classes. All planned; none built. |
| Deployment | No change now. Production continues on `main`'s current images; the rename's GitHub and Railway cutovers are separately authorised subtasks (Proposal 7 §2). |

**Verified results on this branch (documentation only):** the eight unit-test files that read planning documents off disk pass (273 tests; run under Node 22 because Node 24.20.0 is not installed in the planning container — a caveat that stays attached); DESIGN.md revision 2's frontmatter equals `zobba-tokens.json` with zero differences; no application code or test was changed (`git diff c18ad36 --stat -- apps packages tests scripts` is empty). These establish planning consistency only.

## 3. Recommended approach

**Direct adjustment with a fundamental replan — Major scope.** No rollback: the retained foundations are exactly the parts the direction keeps, and the compiler-1 path stays executable for existing work (D-3d-4). No MVP reduction: the first acceptance is a bounded end-to-end proof (Proposal 6) delivered as four gated slices after an isolation prerequisite (Proposal 5 D-5-5), a slice of every epic except Epic 7 and not a separate prototype.

**Rationale.** The conflict is concentrated in the four hard-coded Templates, the Builder and the Northstar demonstration stack; the durable-execution, evidence-integrity, authorisation and audit-trail machinery generalises behind its existing tests. Isolation is proven before any personal account is connected; the gate is never permissive; every slice has its own proofs; incomplete capability stays visibly incomplete.

**Risk.** Highest: tenancy retrofit on a 61-generation schema (mitigated by the classification table, forced RLS with restrictive boundaries, the populated-upgrade proof, Slice 0's isolation suite); prompt injection through documents, mail and pages (a residual risk evaluated behaviourally per model and prompt version, never claimed away); the acceptance depending on a live provider and personal accounts (labelled as such, never as organisational proof). Effort and timeline are set by the slices, not estimated here; each slice completes when its gate passes.

## 4. Detailed change proposals (approved)

### 4.1 Product (Proposals 1, 2, 4b — PRD revision 4)
- Vision, primary object (Engagement; Artifacts; approved recurring check as an optional promotion path), accountability and reproducibility, principle 4 (least privilege enforced by the platform), fifth Trust Seam rule, six industry-neutral journeys with coverage limitations, revised non-goals and scope (Proposal 1).
- FR-3 revised; FR-51 (promotion and recurring checks); FR-52–FR-54, FR-83, FR-84 (engagements and tenancy); FR-55–FR-59, FR-87, FR-88 (conversation and agent tasks); FR-60–FR-63, FR-89 (Agent Permissions and disclosure); FR-64–FR-68 (connectors and connections); FR-69–FR-72 (sources, evidence, working material); FR-73–FR-76, FR-90 (artifacts); FR-77–FR-80, FR-85, FR-86 (skills, packs, memory); FR-81, FR-82 (controlled execution) (Proposal 2).
- FR-91–FR-93 (model and effort choice, administrator model policy, scheduled checks and unavailable models); FR-94–FR-96 (three tenant roles as capability groups, invitations and removal, review notes and return) (Proposal 4b).
- Terminology: Permissions (Agent Permissions, Engagement Permissions, Permissions Policy, Permissions Version, Effective Permissions, Permissions Summary); OAuth connection scopes stay distinct. Product name Zobba; technical identifiers renamed only by story 10.3.

### 4.2 Architecture (Proposals 3a–3d, 4b — spine revision 5 and the contract register)
D-3a-1..4 (tenancy in the database and application; Engagement and Agent Task; Permissions per operation; connections with a worker-side broker and sealed handoff), D-3b-1..4 (owner-namespaced evidence; sandbox profile; produced files; recoverable registration), D-3c-1..4 (native tool-calling under one platform-owned boundary; memory; packs under a mandatory minimum; promotion via compiler-2 with bounded `assist`), D-3d-1..4 (reviewed regression case sets; scoped approval authority; response windows separate from validity; compiler-1 compatibility retained). AD-1..AD-23 verdicts, AD-24..AD-34, the 54-row register, `model-policy-v1` owned by `connections`.

### 4.3 Experience (Proposals 4, 4b — EXPERIENCE.md and DESIGN.md revision 2)
D-4-1..4 (conversation-primary workspace with a contextual panel; the gate decides need and consequences decide weight; progressive disclosure; review around the artifact or decision); D-4b-1..7 (Zobba and Pair; the pack's navigation with the notification panel as the complete attention view; user-owned connections; model selection scoped; three roles; WCAG 2.2 AA; the pack's open questions decided individually). Precedence: the pack is the visual and interaction specification; the approved reconciliation governs amended screens, defaults and copy.

### 4.4 Epics, stories and delivery (Proposal 5)
D-5-1..7: Epic 4 and 5 review stories close only against an evidence review (story 10.1, closure register); Epic 6 split; Epic 7 deferred, Epic 8 absorbed, Epic 9 standing; slices govern delivery and epics govern capability ownership, with a never-permissive gate; four slices after Slice 0 with one slice-to-story matrix; design-gated stories with the story-split rule; invitations, removal and the Reviews queue inside the first acceptance. Requirements traced to stories, including FR-91–FR-96; a retained-work register of 17 mechanisms; an explicit first-acceptance-versus-deferred boundary; incomplete capability stays visibly incomplete (parts a/b/c, partially-demonstrated requirements).

### 4.5 Acceptance journey (Proposal 6)
D-6-1..5: reviewed, bound initial case set at first activation without a separate regression execution for the example pack (method validation still required; unavailable-regression configurations blocked); two monthly boundaries under an isolated test-controlled scheduler and business clock through the production scheduling path, labelled as such; `verify-acceptance-journey.mjs` as the primary verifier with legacy checks retired only against a coverage mapping; five case kinds (real connector operation, provider simulation, hybrid, controlled time, application-policy or membership change); one connected personal Google account, a controlled recipient, three role identities and one disposable identity. The 23-person disjoint fixture manifest with stage-versioned expectations; the monthly population rule as part of the method; twenty stages covering Flows A–L.

### 4.6 Codebase disposition, rename and tracking (Proposal 7)
D-7-1..8: one planned disposition per component or path (retained · generalised · superseded · retired); the task-path dispatch rule (authenticated requests and decisions direct work; successive authorised operations under Effective Permissions and delegation; external content grants nothing); two-class rename with `poc-administrator` retained as the storage and wire value behind the `Admin` display and one tested mapping, flag aliases with a conflict error, the code rename in Slice 0 and GitHub/Railway cutovers separately authorised; legacy closure before verdicts; Builder retirement conditional on the Slice 4 acceptance with unfinished authoring work dispositioned and operational actions preserved; the Northstar test bed retained; obligation-level harness mapping where "equivalent" stays a plan until evidence exists; tracking changes within the file's lifecycle vocabulary (Epics 10–19, NE-8 shifted by one, a separate disposition record, validation before and after).

## 5. Tracking changes applied on this approval

On approval of this document, story 10.2 applies — with the sprint-planning tooling's `validate` run before and after, and the three checks the owner named (superseded work not regenerated as ordinary backlog; deferred work never selected for implementation; completing a bounded part never completes its parent):

1. `epics.md` revised: Epics 10–19 appended (Proposal 5 §2 and §4a; NE-8 numbering shifted per Proposal 7 §5); Epics 6–8's superseded, deferred and absorbed stories converted to disposition tables; Epics 1–9 annotated; decisions recorded in §0; the requirements inventory mirrors the PRD's individual FR dispositions.
2. `sprint-status.yaml`: `project: Zobba`; new keys for Epics 10–19 in `backlog`; superseded, deferred and absorbed story keys removed; epics 6–8 stay `backlog`; Epic 9 story headings re-titled; Epics 4 and 5 untouched until 10.1 reports.
3. `_bmad-output/implementation-artifacts/course-correction-dispositions.yaml` created: one entry per old story and per new part (`disposition`, `replaced_by`, `parent`, `slice`, `compiler_1_path`, `retrospective_required`) and the NE-8 numbering cross-reference.

Story preparation may then begin with 10.1 (legacy review closure), 10.2 (tracking update) and 18.2 (screen review and design register); none changes application code.

## 6. Outstanding gates and what still requires evidence

| Gate or obligation | Owner | State |
|---|---|---|
| Explicit implementation authorisation | Owner | **Not given.** Application implementation, repository and hosting renaming, test retirement and deployment remain unauthorised. |
| Legacy review closure verdicts for the seventeen Epic 4 and 5 stories | Story 10.1 | Pending; no verdict recorded by any approval. |
| Slice 0 isolation suite on the implemented storage, principal, membership, delegation and migration paths | Epic 11, Epic 9 | Planned; no personal account is connected before it passes. |
| Slice 1–4 gates (Proposal 5 §4b) | each slice | Planned. |
| Design-acceptance register: 16 undesigned surfaces, each designed and reviewed before its story part | Story 18.2 and the owning stories | Planned; the 23 pack screens reviewed against the six-scene set first. |
| Implementation selections still requiring evidence: sandbox backend and profile (D-3b-2 criteria), sealed-box library, document-processing libraries and calculation engine, retrieval index and any embeddings provider, first connector SDK versions, the provider deployments and models under `model-policy-v1`, the controlled scheduler and business clock's isolation | the epics that select them | Open; each recorded with its rationale in its story; a selection that cannot satisfy a contract is rejected or raised as a scoped change. |
| Rename compatibility proof (Proposal 7 §2) and the two external cutovers | Story 10.3 and owner-authorised subtasks | Planned; no bundle verification is claimed because no signed Workpaper Bundle exists yet. |
| Builder retirement gate and the unfinished-authoring inventory | Story 10.4 | Planned; conditional on the Slice 4 acceptance. |
| Legacy harness coverage mapping with evidence per "equivalent" row | Story 10.5 | Planned. |
| The first acceptance record (Proposal 6): stage-versioned fixture, verifier, identity manifest, real-versus-injected labels, secret-scanned report | Slice 4, Epic 9 | Planned; the specification is approved, nothing is implemented or passed. |
| Behavioural injection evaluations, reported per model and prompt version | Epic 12, Epic 9 | Planned; a residual risk, never a guarantee. |
| Real-data adoption gates (security, privacy, isolation, permission, operational readiness) | later | Not part of this correction; synthetic data and personal designated resources only. |

## 7. The reference brief's twelve verification questions, answered against `main` `c18ad36`

1. Population completeness, matching rules and the outcome vocabulary: yes for the compiler-1 contract (§H rows, opaque exact keys, §E.1 outcomes); the four user-facing words are summary vocabulary over four separate statuses (FR-72). 2. Immutable hashed evidence with derived artifacts linked to source digests: yes for Evidence and Observations; derivations with retained method objects are new (`derivation-v1`). 3. Agent-judged confirmation with the confirmer recorded separately: yes (evaluation review ledger, human decisions, independence). 4. Tenancy and engagement scoping at the storage layer: **no** — the first and mandatory change (Epic 11). 5. Idempotent resume and duplicate-run detection: yes (request tokens, revisioned checkpoints, logical uniqueness by check and period). 6. A model-provider abstraction suitable for customer hosting: yes in shape (AI SDK behind application ports); customer-hosted deployment itself stays deferred. 7. Where a conversational layer attaches: to the engagement and Agent Task beside the Run model, reusing the Run conversation chassis, not as a separate service (AD-25, AD-31). 8. Human edits to artifacts in the audit trail: yes for Procedure Versions and reviews; artifact versions with lifecycle records generalise it (`artifact-version-v1`). 9. Per-input freshness on the output a reader sees: partly (population `generated_at`, freshness Gate row); the independent input-quality dimensions are new (`input-quality-v1`). 10. Internal-consistency assertions distinguished from source-of-record reconciliation: yes via corroboration against the preserved snapshot; claim classes and the four check kinds generalise it. 11. Source provenance captured and generated inputs barred as evidence: yes for Observations (origin, corroboration); the four provenance classes make it general. 12. Issue state beyond execution state: no today beyond Result sealing and Procedure Version states; lifecycle records draft → reviewed → approved → issued are new (`artifact-version-v1`).

## 8. Implementation handoff

**Scope classification: Major** — a fundamental replan with product, architecture and experience revisions. **Routed to:** the Product Manager (PRD revision 4 is the product baseline; Proposal 6 is the acceptance) and the Solution Architect (spine revision 5, the contract register, the epics' contract obligations); the Developer agent takes stories only after implementation authorisation, beginning with 10.1, 10.2 and 18.2. **Deliverables:** this document; the eleven approved proposals; PRD revision 4 and addendum revision 5; spine revision 5 with `CONTRACT-REGISTER.md`; EXPERIENCE.md and DESIGN.md revision 2; the memlog (entries 48–62); the tracking changes of §5 once applied.

**Success criteria for the correction:** the tracking files validate before and after §5; every story of Epics 10–19 names its contract, its tests, its slice and (where applicable) its design gate; the first acceptance record is produced by the Slice 4 candidate with every check in §5 of Proposal 6 computed and required; the compiler-1 path remains executable, verifiable and exportable throughout; nothing deferred is implied by a design screen or a status value.

## 9. Decision index

Owner decisions of 2026-09-24: 1 (example pack), 2 (synthetic leaver-access scenario on personal Google accounts; not hard-coded), 3 (tenancy enforced from day one; isolation proven before personal accounts). Proposal decisions, all approved with their stated qualifications: D-3a-1..4, D-3b-1..4, D-3c-1..4, D-3d-1..4, D-4-1..4, D-4b-1..7, D-5-1..7, D-6-1..5, D-7-1..8. Corrections: Mandate → Permissions (2026-09-25); roles consolidated to Auditor · Audit manager · Admin (2026-09-25); Zobba and the Pair identity (2026-09-25). Full record: the PRD workspace memlog, entries 48–62.

## 10. Approval

**Approved by the owner on 2026-09-25:** "The approved direction is now settled: Zobba, the conversation-led audit harness, with the Pair identity, Permissions, and the three roles—Auditor, Audit manager and Admin. Move from course correction into controlled story preparation." The course-correction workflow is complete; the tracking changes of §5 and story preparation are authorised. Application implementation, repository or hosting renaming, test retirement and deployment still require explicit implementation authorisation.

Approval of this Sprint Change Proposal completes the course-correction workflow and authorises the tracking changes of §5 and story preparation. It does **not** authorise application implementation, repository or hosting renaming, test retirement or deployment; each requires explicit implementation authorisation.
