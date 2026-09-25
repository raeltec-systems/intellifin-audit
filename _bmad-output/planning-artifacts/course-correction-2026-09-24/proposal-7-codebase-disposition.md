# Proposal 7 of 7 — Codebase disposition, the compatibility-tested rename, and sprint-status changes

Status: draft for owner review on 2026-09-25; awaiting a / e / s. Builds on the approved Proposals 1–6 and the two read-only inventories of `main` `c18ad36` (`analysis-backend-inventory.md`, `analysis-web-ux.md`). It says, for every existing component, whether it is **retained**, **generalised**, **superseded** or **retired**; which story performs the change; and which verification obligation remains. It plans the IntelliFin Audit → Zobba technical rename as one compatibility-tested story, and prepares the `sprint-status.yaml` and `epics.md` changes. No implementation, repository renaming, test retirement or deployment is authorised; the Sprint Change Proposal that follows is what carries these changes into the tracking files once approved.

Standing constraints: "Preserve historical evidence, signed content and identifiers that existing records depend on."; "Do not change application code or retire existing tests prematurely merely to make the planning documents pass; tests move with their corresponding implementation and legacy disposition."; execution compatibility for active, queued, paused or in-flight compiler-1 work is retained until it completes or is explicitly migrated, suspended or retired (D-3d-4).

## 0. Decisions this proposal asks for

| Decision | Proposed choice |
|---|---|
| D-7-1 | **The disposition vocabulary is four words and every component gets exactly one.** RETAINED (unchanged, reused as is); GENERALISED (the mechanism stays, its inputs or vocabulary widen, behind its existing tests); SUPERSEDED (kept in force for the compiler-1 Run path, not used by the task path; its read, verify and execution obligations remain per D-3d-4); RETIRED (the write side removed by a named story after its replacement exists; read paths and tests retained until the transition completes). §1 applies it. The inventories' EXTEND becomes GENERALISED and their REPLACE becomes SUPERSEDED or GENERALISED depending on whether the old shape stays in force for compiler-1. |
| D-7-2 | **Rename in two classes, one story (`NE-0.3`), compatibility-tested.** Class A, changeable application identifiers: workspace package names (`@intellifin/*` → `@zobba/*`), the root package, the `INTELLIFIN_*` environment flags (`ZOBBA_*`, old names accepted with a deprecation warning for one release), product copy in the web (wordmark, page titles, sign-out page, chat labels), Dockerfiles and CI filters, vitest and dependency-cruiser aliases, `AGENTS.md` and `CLAUDE.md` text, the Railway project name and the GitHub repository name (owner-performed; redirects keep old URLs). Class B, preserved unchanged: the audit-event envelope and every hashed value (`source` is `web`/`worker`, never a product name); the roles' **stored** values `auditor`, `audit-manager`, `poc-administrator` (a CHECK in generation 3, a trigger in generation 60, and `priorRole`/`newRole` payloads in the immutable chain) — only the TypeScript constant names and the display word change ("Admin"); evidence object keys and namespaces (`evidence-v1:`, `evidence-v2:`); signed manifests, sealed Results, golden fixtures and their producer strings; migration files and the journal; existing correlation-id prefixes; database names; the planning-artifact folder names (`prd-IntelliFin Audit-2026-08-31`, `ux-IntelliFin Audit-2026-09-01`, `architecture-IntelliFin Audit-2026-09-01`) that tests read by path. |
| D-7-3 | **The rename's compatibility proof.** Before merge: the full unit, integration and browser suites green; `pnpm boundaries` green with the renamed aliases; the populated-upgrade proof on a generation-61 database; `audit-chain-golden.json` and every golden vector verifying byte-for-byte; an existing sealed Result and Workpaper Bundle from a pre-rename database verifying under the renamed build; a paused compiler-1 Run resumed on the renamed build; the worker and web images built and started with the renamed packages; old `INTELLIFIN_*` names accepted with a logged deprecation. The rename lands in Slice 0 before NE-1 writes new modules, so no new code is written under the old names. |
| D-7-4 | **Legacy review closure is a story (`NE-0.1`) executed before any verdict is recorded.** It fills Proposal 5 §1b's register from the existing evidence; only its output changes Epic 4 and 5 statuses. This proposal changes none of those seventeen statuses. |
| D-7-5 | **The Builder write path retires at Slice 4, not before.** Until compiler-2 promotion exists, the Builder is the only way to author a Procedure Version; retiring it earlier would remove the Run path's authoring with nothing in its place. From Slice 1 it is reachable only through the Legacy procedures view (Proposal 4 U2) and is no longer the primary experience; at Slice 4 story `NE-0.4` removes the write side (new-procedure form, Draft editors, guided preparation, the web-composed authoring assistant) and keeps every read path (Procedure Detail, Version review, the plan preview, Initiate Run) for existing versions. |
| D-7-6 | **The Northstar synthetic systems, fixtures, golden datasets and mutation harnesses are RETAINED as the compiler-1 test bed and the optional example pack's data, not retired.** The inventory's RETIRE verdicts for them presumed the compiler-1 path would go; D-3d-4 keeps it while any compiler-1 version or Run exists, and its tests keep it honest. `seed-northstar.mts` and the Northstar Railway service follow the same rule. Retirement of any of them is a later transition proposal, taken when the last compiler-1 version is retired. |
| D-7-7 | **`verify-deployed-loancore.mjs` and `acceptance-truth.mjs` are SUPERSEDED, not retired, by a coverage mapping (§4).** Each obligation maps to retained coverage, an equivalent check in the new harness, or an explicitly retired capability; the two files and their workflow stay until every row says retained or equivalent and the Epic 4 and 5 closure register is filled. |
| D-7-8 | **Sprint status and `epics.md` change as §5 and §6 propose**, applied by the Sprint Change Proposal on approval: nine new epics (NE-1..NE-9) plus the standing assurance epic and a disposition epic NE-0; Epic 6 split, Epic 7 deferred, Epic 8 absorbed, Epic 9 generalised; Epic 4 and 5 untouched until NE-0.1 reports. |

## 1. Disposition register (component → disposition → story → verification obligation that remains)

Backend, from `analysis-backend-inventory.md`:

| Component | Disposition | Story | Verification obligation that remains |
|---|---|---|---|
| Canonical JSON, SHA-256/HMAC, audit-event envelope and chain, audit storage | RETAINED; envelope v2 adds `tenantId`/`engagementId` for new segments | NE-1 1.8 | golden vectors byte-for-byte; v1 bytes verified under v1 rules; ownership binding |
| Identity session plumbing (Better Auth, sign-in/out, rate limit), manage users | RETAINED | — | existing suites; invitation path added by NE-1 1.10 keeps `disableSignUp` |
| Role gating table (`roles.ts`, 3 × 24) | GENERALISED: capability groups, membership and scope on top; stored values unchanged | NE-1 1.9; display rename NE-0.3 | `roles.test.ts` and `denial-strings.test.ts` move with 1.9; the 24 compiler-1 actions keep their cells |
| Target System registration, credential capability manifest, probe, registration repository | SUPERSEDED for the task path by `connector-v1`/`connection-v1`; in force for compiler-1 Runs | NE-3 3.4–3.7 | registration suites retained; probe runner retained while registrations exist |
| Population Source binding and repository | SUPERSEDED by `acquisition-v1`; in force for compiler-1 | NE-4 4.2 | binding suites retained |
| Templates P-1..P-4 (`templates.ts`) | SUPERSEDED: the optional example pack (`methodology-pack-v1`); build constants stay for existing versions | NE-6 6.4 | `procedure-templates.test.ts` retained (addendum §C pinned) |
| Draft section editors (`*-draft.ts`) | RETIRED (write side) at Slice 4; read side retained | NE-0.4 | the plan preview reads existing versions; populated-upgrade proof |
| Compliance Rule compiler, executable-plan compiler v1, `equivalentExecutablePlan` | GENERALISED: compiler-2 beside compiler-1; `evaluate` reuses the grammar | NE-9 9.2 | compiler-1 bytes identical for retained versions; golden evaluation test |
| Plan derivation queue and `ModelGateway` | SUPERSEDED for authoring (retired with the Builder); RETAINED for compiler-1 execution | NE-0.4; D-3d-4 | derivation of new compiler-1 Drafts stops when the Builder retires; execution path stays under test |
| Version lifecycle, frozen fields, succession, platform-authored drafts | RETAINED; compiler-2 versions use the same lifecycle | NE-9 9.3; NE-5 5.3 | immutable-versions suites; `mint-platform-draft` tests |
| Guided preparation, section review, submission guard, readiness | RETIRED at Slice 4 | NE-0.4 | none after retirement; browser specs that drive them retire with the surface (the tests move with the story) |
| Writing assistance and authoring adapters (OpenAI Responses) | RETIRED at Slice 4 (the web composes no model, AD-10); receipt pattern reused by NE-2 | NE-0.4; NE-2 2.5 | `AUTHORING_OPENAI_API_KEY` removed from the web's configuration in the same story |
| Conversational preparation actions resolver | SUPERSEDED by `agent-loop-v1`'s command discipline; "only a direct human message dispatches" carried verbatim | NE-2 2.5 | the negation/assent/ambiguity cases re-asserted on the task path |
| Run initiation, cancel, rerun, request token | RETAINED; the token's "first use decides" rule is the model for connector idempotency | NE-3 3.4 | run-initiation suites |
| Population acquisition | SUPERSEDED for the task path by `acquisition-v1`; in force for compiler-1 | NE-4 4.2–4.3 | population suites retained |
| Adapter extraction (HTTP) | SUPERSEDED; in force for compiler-1 | NE-3 3.4 | adapter suites retained |
| Observation registration, corroboration, deterministic evaluation, Exceptions, Gate v1, outcome table, Result, waits, flags, notifications | RETAINED for the Run path; Gate rows classified in v2; compiler-2 Runs write the same tables | NE-6 6.5; NE-9 9.5, 9.8 | the twenty §H rows pinned; outcome table pinned; every existing Run-path suite |
| Workspace provisioning, browser execution, capture suppression, credential containment, credential resolver | RETAINED; the browser becomes one connector on the task path (deferred, 3.11) | NE-3 3.11, 3.13 | browser suites; `credential-containment-v1` scans over new persistence subjects |
| Agent execution loop, model gateway, prompt versions, tool catalogue (`agent-execution-v1`) | SUPERSEDED by `agent-loop-v1`; in force for compiler-1 | NE-2 2.3–2.8 | mutation harnesses retained and re-anchored when lines move |
| Tool Action gate (`tool-action-v1`) | SUPERSEDED by `permissions-v1` for the task path; in force for compiler-1 | NE-3 3.2 | gate killing tests retained |
| Evidence store, `freezeArtifact`, read grants, replay assets, live channel, controller lease, manager transfer, workspace preview | RETAINED and GENERALISED by name (owner namespaces, per-aggregate streams, task control) | NE-4 4.1; NE-2 2.9; NE-8 8.7 | existing suites; the integrity sweep over every owner kind |
| Run conversation chassis (encrypted content, receipts, command intake) | GENERALISED: the backbone of the engagement conversation | NE-2 2.1, 2.5 | receipt discipline tests re-asserted on the task path |
| Record review (presentation snapshot) | SUPERSEDED (shape) for the task path; in force for compiler-1 workspace | — | retained suites |
| Queues, worker main loop, telemetry, config loader, migrator | RETAINED; new queues, allowlist entries and capability sections added | every epic | `startup.test.ts` anchors; telemetry allowlist tests; schema-range test |
| Northstar service, fixtures, golden datasets, expectation files, `seed-northstar.mts` | RETAINED (D-7-6) as the compiler-1 test bed and example-pack data | NE-6 6.4 | fixture tests (`fixtures.test.ts`, synthetic-marker); the Northstar Railway service unchanged |
| `verify-deployed-loancore.mjs`, `acceptance-truth.mjs`, `deployed-loancore-acceptance.yml`, `solari-acceptance.yml` | SUPERSEDED per §4; workflows retained for compiler-1 acceptance | NE-0.5 | the mapping's "retained" rows keep running |
| Mutation-guard harnesses | RETAINED; re-anchored when a line they pin moves; a new harness on the loop's one call site | NE-2 2.3; Epic 9 | anchor-drift refusal; detached-worktree rule |
| `seed-identity.mts`, CI utilities, boundary check, output tail, platform configuration script | RETAINED | — | `entry-point.test.ts` |

Web, from `analysis-web-ux.md`:

| Surface | Disposition | Story | Verification obligation that remains |
|---|---|---|---|
| Sign-in, session, health, auth routes | RETAINED | — | `sign-in-readiness.spec.ts`, rate-limit tests |
| Overview | RETIRED at Slice 1 (Home, Continue and the notification panel replace it) | NE-8 8.2, 8.3a | the attention information's tests move to 8.2 |
| Procedures list, Procedure Detail, Version review, plan preview | SUPERSEDED as top-level navigation; reachable through Legacy procedures; approval flow RETAINED and reused by compiler-2 versions | NE-8 8.2; NE-9 9.3 | `version-review.spec.ts`, `immutable-versions.spec.ts` retained |
| Procedure Builder (new, edit, guided preparation, writing assistant, authoring chat) | RETIRED at Slice 4 (write side); plan and rule wording renderers GENERALISED into the artifact view | NE-0.4; NE-5 5.8 | `procedures.spec.ts`, `builder-steps.spec.ts`, `hero-workflow.spec.ts` and the guided-authoring specs retire with the surface, in that story |
| Runs list | SUPERSEDED as navigation; Scheduled checks and Run views inside Engagements | NE-8 8.2, 8.12 | `runs.spec.ts` retained for the Run page |
| Run Detail (five tabs), Evidence inspector, Result, Gate, Exceptions, Review tab | RETAINED; reached from the engagement; reused by compiler-2 Runs | NE-8 8.12; NE-9 9.8 | every `runs/*` test and spec retained |
| Live View, Replay | RETAINED; View workspace reaches them | NE-8 8.7 (deferred) | live and replay specs retained |
| Auditor Workspace v1.1 (conversation, record review, controller lease, preview) | GENERALISED: plumbing reused; the fixed-vocabulary console is not the destination; remains for compiler-1 Runs | NE-2 2.1, 2.5; NE-8 8.3 | workspace specs retained while the surface exists |
| Administration — users | GENERALISED: Users and roles with invitations and removal | NE-8 8.11 | `administration.spec.ts` (sign-out without JavaScript) retained |
| Administration — sources, systems | RETAINED for the Run path; Systems and Sources under Settings › Administration | NE-8 8.11 | `sources.spec.ts`, `northstar.spec.ts` retained |
| Notifications page, bell | GENERALISED: the notification panel with the complete attention view | NE-8 8.2 | `escalations.spec.ts` moves with 8.2 |
| Reviews queue | GENERALISED: Reviews with anchored notes | NE-8 8.10 | `review-words.test.ts` moves with 8.10 |
| App shell, breadcrumbs | GENERALISED to the pack's navigation | NE-8 8.2 | `shell.spec.ts`, `breadcrumb-rules.test.ts` move with 8.2 |
| Design system (tokens, badges, Banner, ConfirmDialog, DataTable) | GENERALISED under the Zobba tokens; the compiler-1 surfaces keep the old contract until their stories | NE-8 8.0, 8.9 | `tokens.test.ts`, `status.test.ts`, `copy.test.ts`, `stylesheet.test.ts` re-pointed in 8.0 and 8.9 |
| Badges gallery | RETAINED | — | axe scan |
| Run control, events, frames, preview APIs | RETAINED and GENERALISED to tasks | NE-2 2.9; NE-8 8.7 | route tests |

Every "tests move with the story" cell is the implementation of the standing rule: no test is retired or re-pointed by this proposal, and none is retired to make a planning document pass.

## 2. The rename story (`NE-0.3`), compatibility-tested

**Inventory on `main` `c18ad36`:** 623 files reference `@intellifin/*` (486 `domain`, 357 `application`, 352 `infrastructure`, 8 `worker`, 7 `northstar`, 6 `web`); the root package is `intellifin-audit`; three `INTELLIFIN_*` flags (`LOW_DISK` ×13, `LOW_MEMORY` ×2, `LIVE_SOLARI` ×3); 42 product-copy lines in `apps` (wordmark, `<title>`s, sign-out page, "Message IntelliFin…", "Conversation with IntelliFin", `platform: 'IntelliFin'`); three Dockerfiles and four workflows filter by package name; vitest and dependency-cruiser aliases; `.railway/railway.ts` names the project `intellifin-audit`; `AGENTS.md` and `CLAUDE.md`. Fifteen test files contain the product name — eight of them as **planning-document paths**, which do not change (Class B).

**Class A — changed in the story:** `@intellifin/*` → `@zobba/*` everywhere (imports, `package.json` names, Dockerfile filters, aliases, subpath exports); root package `zobba`; `INTELLIFIN_*` → `ZOBBA_*` with the old name honoured and a deprecation line logged for one release, then removed by a later story; product copy to Zobba with the identity from the pack (8.0 supplies the wordmark; the story changes only text); `AGENTS.md`/`CLAUDE.md` prose; Railway project and GitHub repository names are owner actions performed after the story merges, with `.railway/railway.ts` updated to the new project name in the story and the old GitHub URL redirected.

**Class B — never changed:** everything in the hashed audit envelope and every stored hash, digest, signature and manifest; the stored role values (the display word "Admin" and the TypeScript constant `ADMIN` change; `'poc-administrator'` stays the storage and wire value, so generations 3 and 60 and every historical `priorRole`/`newRole` stay valid); evidence object keys and reservation namespaces; migration files, snapshots and the journal; golden fixtures and their `producer` strings; existing correlation-id prefixes (`seed-northstar:`); database and test-database names; telemetry `service` values (`web`, `worker`); the planning folders tests read by path.

**Compatibility proof (D-7-3), run in a detached worktree of the candidate:** unit, integration and browser suites green; `pnpm boundaries` green (the planted violations spelled with the new aliases); populated-upgrade proof from a generation-61 database seeded under the old names; `audit-chain-golden.json`, the registration, binding, observation and snapshot golden vectors byte-for-byte; a sealed Result and Workpaper Bundle produced before the rename verifying after it; a paused compiler-1 Run resumed on the renamed build; images built with the renamed packages and started against the same database; `INTELLIFIN_LOW_DISK=1` still honoured with the deprecation line. The story ships nothing else.

## 3. Legacy review closure (`NE-0.1`) — the process before the verdicts

For each of the seventeen Epic 4 and 5 stories in review: read the story's acceptance criteria; read the evidence Proposal 5 §1b names; record the tested revision, the runtime and environment the evidence was produced in, unresolved limitations already named in CLAUDE.md or the reports; assign the verdict (Done — `[COMPILER-1 PATH]`, Remains in review with the missing check named, or Residual work with an owner). Where the only missing evidence is a run that can be reproduced cheaply on `c18ad36` (a browser spec, an integration file), run it once and record it; nothing is rerun for its own sake. The output is the filled register and the sprint-status change list for those seventeen keys; the Sprint Change Proposal applies it. The three done stories (4.1–4.3) get their evidence registered without a status change.

## 4. Legacy acceptance harness — coverage mapping (D-7-7)

| Obligation in `verify-deployed-loancore.mjs` / `acceptance-truth.mjs` / the two workflows | Disposition |
|---|---|
| Per-record, per-condition comparison against a truth file read off disk; the swap case; every computed check required | EQUIVALENT: `verify-acceptance-journey.mjs` and `acceptance-journey.test.ts` (Proposal 6 D-6-3) |
| Sentences pinned against the pages that render them (`acceptance-sentences.test.ts`) | EQUIVALENT: sentences pinned against EXPERIENCE.md revision 2 |
| Provider session-handle containment counted after the identity is known | RETAINED for compiler-1 browser Runs; EQUIVALENT on the task path: the catalogue-driven containment scan |
| The hydration-marker start guard (`/sign-in` server-renders `data-signin-ready`) | RETAINED: the acceptance workflow keeps the guard |
| Evidence-link check reading the inspector's own failure banner | EQUIVALENT: citation checks in the new harness; RETAINED for the compiler-1 evidence inspector |
| Authoring the P-1 Procedure through the Builder, second-person approval, activation, Run start, Timeline naming the record | RETAINED for compiler-1 (the authoring half retires with the Builder at Slice 4; the approval, activation and Run halves stay) |
| `confirmAgentJudged` walking the real control; the Result compared with the truth after sealing | RETAINED for compiler-1 (`evaluation-review-sealing-v1`); the task path has no `run_result` |
| The negative case (defective 27-row export → the Run stops, the Gate names E-000107) | RETAINED for compiler-1; the task path's analogue is Proposal 6 stage 16 |
| Live Solari audit acceptance (`solari-acceptance.yml`, read-only workflow, provider keys as secrets) | RETAINED while compiler-1 browser execution is retained; not exercised by the new journey (the task-path browser connector is deferred) |
| Report retention rules (secret-scanned facts, no raw logs) | EQUIVALENT: the new acceptance record follows the same rules |

Retirement of the two scripts and `deployed-loancore-acceptance.yml` is a later transition, taken when the compiler-1 rows above are themselves retired.

## 5. `sprint-status.yaml` changes (applied by the Sprint Change Proposal)

- `project: Zobba` (documentation only; the tracking file's `project_key` unchanged).
- **Epics 1–3:** unchanged (`done`).
- **Epics 4, 5:** unchanged until `NE-0.1` reports; then each story key takes its register verdict (`done` with a `[COMPILER-1 PATH]` note, or stays `review`).
- **Epic 6:** `6-1` and `6-2` → `backlog` under NE-9 (keys `9-8-…` re-homed, old keys marked `moved`); `6-3`, `6-4`, `6-5` → `moved` to NE-5 5.4/5.5/5.9; `6-7`, `6-8` → `moved` to NE-4 4.11a/4.11b; `6-6` → `retired` (Overview). The `epic-6` line becomes `split`.
- **Epic 7:** `epic-7: deferred`; stories unchanged in `backlog` with a `deferred` note.
- **Epic 8:** `epic-8: absorbed` into NE-9 (`8-1`, `8-3` → 9.4; `8-2`, `8-4` → 9.10; `8-5`, `8-6` → 9.9).
- **Epic 9:** `epic-9: standing`; stories generalised in place (9.1, 9.2, 9.4–9.6, 9.8, 9.9) or re-based (9.3, 9.7) with their new proof names.
- **New epics, all `backlog`:** `epic-ne-0` Disposition and rename (`ne-0-1-legacy-review-closure`, `ne-0-2-sprint-status-and-epics-update`, `ne-0-3-compatibility-tested-rename`, `ne-0-4-retire-the-builder-write-path` (Slice 4), `ne-0-5-legacy-harness-coverage-mapping`); `epic-ne-1` … `epic-ne-9` with every story of Proposal 5 §2 as a key, bounded parts as separate keys (`ne-2-5a-…`, `ne-2-5b-…`), and the slice as a note; `epic-ne-8` carries `ne-8-0-identity-and-tokens` and `ne-8-1-screen-review-and-design-register`.
- **Retrospectives:** `epic-4-retrospective` and `epic-5-retrospective` become `required` once their closure verdicts land.

## 6. `epics.md` changes

A revision that appends the nine new epics with Proposal 5's story tables and the slice-to-story matrix, annotates Epics 1–9 with §1's dispositions and Proposal 5 §1, records D-5-1..D-5-7, D-6-1..D-6-5 and D-7-1..D-7-8 in its §0, replaces its requirements inventory's FR range with FR-1..FR-96 (FR-1..FR-50 marked as HOLDS with `[COMPILER-1 PATH]` where the PRD marks them), and names the acceptance journey (Proposal 6) as the first acceptance. The 2026-09-04 timing correction stays.

## 7. What remains unauthorised after this proposal

Application implementation, the rename, test retirement and deployment, until the course-correction workflow completes (the Sprint Change Proposal is approved) and implementation is explicitly approved. Story preparation may begin on approval of the Sprint Change Proposal; the first stories are `NE-0.1`, `NE-0.2` and `NE-8 8.1`, none of which changes application code.

## Why

Direction §I ("determine which existing components should be retained, extended, replaced or retired… preserve valuable foundations"); D-3d-4; D-4b-1 (the technical rename as a dedicated compatibility-tested story); D-5-1 and Proposal 5 §1b; D-6-3; the two inventories; the owner's approvals of 2026-09-25.
