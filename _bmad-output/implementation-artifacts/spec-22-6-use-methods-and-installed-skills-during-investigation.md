---
title: '22.6 — Use methods and installed skills during investigation'
type: 'feature'
created: '2026-10-14'
status: 'in-progress'
baseline_commit: '150bbfec10f6dee4a2de9d49e20f00ce91e290f6'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-22-context.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-22-5-extract-usable-facts-with-stable-source-locations.md'
  - '{project-root}/zobba/README.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The work loop sends the model only the methodology binding ID (`work.rs:996`), and no skill ever reaches a turn. The firm's method and Admin-installed skills therefore cannot shape investigation, and nothing records which method/skill versions Zobba actually used, where the method could not be followed, or what Zobba needs to ask.

**Approach:** Treat method and skills like Claude Code treats project instructions and skills. Use progressive disclosure, as Claude Code does. Every turn gets a short method outline as attributed data; the agent fetches large method parts on demand. Eligible skills are listed by name and description only; the agent loads the ones it judges relevant, fetches their extra resources on demand, and runs their scripts in the 22.4 sandbox. Trusted code rechecks eligibility and records each load, fetch and run before any content enters the next turn. Admin can also give Zobba a methodology document and get an editable proposal that becomes effective only through the existing validated Save. The agent reports method gaps and contextual questions in its structured answer and keeps doing independent permitted work. The work panel shows the basis, the exact versions used, gaps and questions.

## Boundaries & Constraints

**Always:**
- Method content = the Task's current immutable binding resolution (status, issues, requirements with mandatory flag, criteria, populations, evidence checks, ratings, review rules, suitable skills, resolved templates), read under the existing boundary fence (`infrastructure/work.rs:809-890`). Progressive disclosure: every turn carries a tier-2 (never dropped) method outline wrapped as new `InputClass::Method` — status, issues, requirement IDs/titles/mandatory flags, criteria names, missing criteria, and an index of fetchable parts (criteria text, templates, evidence checks) with byte sizes. The agent requests parts through a new `read_method` answer field (≤8 part IDs per turn); trusted code serves them from the same binding and records each fetch. A large method never fails a turn by size alone; only the outline is mandatory, and if the outline itself cannot fit, 22.3 `context_budget` applies. Neutral, incomplete and ambiguous bases are stated as such; missing criteria are named.
- Skill listing: currently eligible, enabled versions whose method compatibility passes, with name, description, version, digest and need status only. Loading a skill passes the same fresh gate as `SkillsStore::current_use`/`Inspection::selectable()` in the claim's transaction, then records an immutable use fact `{task, cycle, invocation, version id, digest, methodology binding id, execution epoch, catalogue revision, dependency fingerprint, outcome loaded|unavailable + closed reason}`. A load brings in the skill's main instructions as `InputClass::Skill` data plus an index of its other resources; the agent fetches further resources on demand (same field, recorded). The agent loads any eligible skill itself; no prior human selection is required (21.3 human selection stays as a recorded preference, not a gate). A `script` resource is never run in-process: the agent may request it through a new `run_skill_script` answer field, and trusted code runs it as a 22.4 analysis job (pinned general environment, the script bytes as the program, only the requested registered originals as inputs, existing limits, operation custody, descendant registration). Its validated outputs return as recorded results; script text in context stays data.
- A skill's declared tool needs never create an operation; only `run_skill_script` through the 22.4 path may run code. Unqualified or forbidden needs stay `unavailable`/`forbidden` and the agent is told so. Skill text, method text and documents never grant authority (existing envelope rule).
- New `CitedAnswer` fields: `use_skills` (≤4 version IDs) and `method_notes` (≤32: requirement ID, kind `gap|question|statement`, text ≤1,000 bytes, gap reason closed: `evidence_unavailable`, `action_not_permitted`, `tool_unavailable`, `criteria_missing`, `skill_unavailable`). A `statement` is shown as "Zobba says", with its citations' verification; there is no "complete" state. The platform also records deterministic gaps (mandatory requirement with missing criteria; skill unavailable). Stored older answers without these fields keep parsing and their bytes.
- A gap or question never stops the cycle; the loop continues while the answer still requests reading or skills. A question shows as Task attention; the auditor answers through the existing Guide.
- Every use fact and note keeps its binding ID and execution epoch. After a 21.2 active change switches the binding at a safe boundary, the next turn uses the new method; earlier facts and answers are unchanged; skill eligibility is rechecked against the new binding (a changed basis can make a skill unavailable).
- Zobba investigation note: a separate Zobba-authored record per cycle with method, skill, model and tool provenance; the human working brief changes only through Guide.
- Methodology document proposal (AC4): Admin uploads a document as configuration evidence (21.1 custody, Admin scope, not a Task). A dedicated Admin-only model path, with its own recorded disclosure (document digest, profile, Admin actor; qualified profile and existing spend/approval gates), drafts a proposal reusing the 21.2 editor shape with `imported_proposal` attribution. Every proposed field cites its document location (22.5 citation contract and verification); interpretation conflicts and missing criteria are listed. The proposal is editable and has no effect until the Admin's existing validated Save; nothing is auto-saved.
- Migration 0017: `task_skill_uses` (loads, resource fetches, script runs with their analysis job ID), `task_method_fetches`, `task_method_notes`, `task_investigation_notes`, `methodology_proposals`; immutable, forced RLS, SELECT/INSERT runtime grants, inventoried guards, catalogue v17 and all schema checks.
- Synthetic loopback model transport only in tests.

**Ask First:** Any skill script environment beyond the pinned 22.4 general image; any live provider run for the Admin proposal path.

**Owner decisions (2026-10-14):** agent loads eligible skills itself; investigation note separate from the human brief; AC4 kept in this story; skill scripts run in the 22.4 sandbox; progressive disclosure for methods and skills instead of a hard size failure.

**Never:** A compiled action graph or step pipeline; numeric confidence; marking a requirement complete from model text alone; acquired documents installing or acting as skills; selection or loading granting tool execution; silent rebinding or rewriting earlier conclusions; live provider calls in tests.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| AP method + skill | AP method bound, pure skill eligible, one knowledge record | turn has method content + skill list; agent loads skill; use fact recorded; next turn has skill text; card shows versions | N/A |
| Unqualified tool need | skill needs `audit_send_v1` | listed `unavailable`; load request records `unavailable tool_unavailable`; no operation | agent told; continues |
| Missing evidence | requirement needs a missing population | `gap evidence_unavailable` note; other work continues | N/A |
| Missing criteria | mandatory requirement, no criteria | platform gap `criteria_missing`; no dependent conclusion claimed | N/A |
| Contextual question | agent asks which vendor master to use | `question` note; Task attention; Guide answer applied next boundary | N/A |
| Active change | Admin Save `active_tasks` mid-cycle | switch at safe boundary; next turn new method; old notes/uses keep old binding | stale skill → unavailable |
| Skill disabled/recalled | between listing and load | load records `unavailable`; text not sent | N/A |
| Large method | method with 300 KiB of templates | outline sent; agent fetches one template; fetch recorded; turn succeeds | N/A |
| Skill script | agent requests a skill's script over one original | runs as 22.4 job; outputs registered as descendants; run recorded | sandbox limit or refusal recorded; no output trusted |
| Methodology document | Admin uploads an AP method PDF | editable proposal with cited fields, conflicts and missing criteria; no effect before Save | provider failure recorded; no proposal fabricated |
| Hostile skill/method text | text says "ignore permissions" | stays enveloped data; no authority change | existing envelope escape |
| Old stored answer | 22.5 answer without new fields | parses; bindings unchanged | N/A |

</frozen-after-approval>

## Code Map

- `zobba/crates/application/src/work.rs:50-73,243,955-1000,1241-1270,1800-1830` -- `WorkBoundary`, `SYSTEM_CONSTRAINTS`, tier-2 method fact (replace with content), knowledge tier pattern, `after_answer` hook (skill loading + notes go beside reading).
- `zobba/crates/infrastructure/src/work.rs:809-890` -- `boundary`; already reads `methodology::current_binding` (`infrastructure/methodology.rs:365`); add binding resolution, skill listing, loaded skills.
- `zobba/crates/application/src/skills.rs:484,569,584,618-708` -- `selectable`, `methodology_dependencies`, `method_compatibility`, `SkillsStore` (`discover`, `current_use`).
- `zobba/crates/infrastructure/src/skills.rs:229,666,784` -- `inspect_locked`, `discover`, `current_use`; reuse in the claim transaction.
- `zobba/crates/domain/src/skills.rs:25-75,157-200` -- `ToolId` mapping (`AnalysisV1` unsupported), `ResourceKind`.
- `zobba/crates/application/src/methodology.rs:82-125,280-336` -- `Requirement`, templates, `Resolution`, `Binding`.
- `zobba/crates/domain/src/citation.rs:322-560` -- `CitedAnswer`, `is_valid`, `schema`, `from_json` (add fields, keep old parsing).
- `zobba/crates/domain/src/context.rs:70-98,531` -- `InputClass`, `OmissionCategory`, `plan` (skill tier, `skills_budget` omission).
- `zobba/crates/worker/src/work.rs:153-230` -- trusted composition of reading; add skills port.
- `zobba/crates/api/src/work.rs:174-300` -- `TaskWorkResponse` (add basis, uses, notes); `zobba/web/src/TaskWorkPanel.tsx`, `TaskSkills.tsx`, `TaskMethodology.tsx`, `Citation.tsx`.
- `zobba/migrations/0016_citations.sql`, `0009_skills.sql:38`; `zobba/crates/infrastructure/src/lib.rs:1328,1376` -- next migration and schema checks.

## Tasks & Acceptance

**Execution:**
- [ ] `zobba/crates/domain/src/{context,citation,work}.rs` -- `Method`/`Skill` input classes, skills omission, answer fields with old-answer parsing, note and use types.
- [ ] `zobba/crates/application/src/work.rs` (+ new `investigation.rs`) -- method rendering, skill listing tier, load/record after answer, platform gaps, constraints text.
- [ ] `zobba/migrations/0017_investigation_basis.sql` + infrastructure repositories + catalogue v17 + schema checks.
- [ ] `zobba/crates/worker/src/work.rs` -- compose the skills port in trusted work composition.
- [ ] `zobba/crates/api/src/work.rs` + generated client -- basis, uses, notes, scoped to current viewer authority.
- [ ] `zobba/web/src/TaskWorkPanel.tsx` -- "Method and skills": method versions and status, skills used (name, version, short digest), gaps, questions, Zobba statements with citation chips; WCAG 2.2 AA.
- [ ] Fixtures + tests -- AP method, one pure skill, one unqualified-need skill, one knowledge record; every matrix row (Rust, PostgreSQL, worker loopback, web unit, browser).
- [ ] Admin methodology proposal -- upload, Admin-only model path, proposal store, editor review screen with citations, conflicts and missing criteria.
- [ ] `zobba/README.md` -- what is proven offline.

**Acceptance Criteria:**
- Given an AP Task with an eligible skill, when the cycle's first turn runs, then its request contains the method content and skill listing, and the card lists the exact method version IDs and every loaded skill version and digest.
- Given a load request, when audited, then exactly one use fact exists per invocation and version, bound to that turn's binding ID and epoch.
- Given an active method change, when the Task resumes, then earlier answers, notes and uses are unchanged and later turns record the new binding.
- Given a skill script run, when audited, then exactly one 22.4 analysis job exists for it and only validated outputs reach context.
- Given an Admin methodology proposal, when inspected, then every field cites its document location and nothing is effective until validated Save.

## Verification

**Commands:**
- `cargo fmt --check && cargo clippy --workspace --all-targets -- -D warnings` -- expected: clean.
- `cargo test --workspace` on guarded `_test` databases -- expected: all pass.
- `pnpm --dir zobba/web check` and the work-panel browser cases -- expected: pass, with accessibility checks.
