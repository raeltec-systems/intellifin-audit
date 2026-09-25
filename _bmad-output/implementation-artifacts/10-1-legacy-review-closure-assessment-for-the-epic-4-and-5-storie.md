---
title: 'Legacy review closure assessment for the Epic 4 and 5 stories in review'
type: 'chore'
created: '2026-09-25'
status: 'ready-for-dev'
review_loop_iteration: 0
context:
  - '_bmad-output/planning-artifacts/course-correction-2026-09-24/proposal-5-epics.md'
  - '_bmad-output/planning-artifacts/course-correction-2026-09-24/proposal-7-codebase-disposition.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Seventeen Epic 4 and 5 stories sit in `review` on `main` `c18ad36`. They are merged, deployed and covered by CI, but nobody has recorded whether their compiler-1 acceptance criteria are met by the existing evidence; the course correction classifies them `[COMPILER-1 PATH]` and forbids closing them by reclassification (D-5-1, D-7-4).

**Approach:** Assess each story against its acceptance criteria using the implementation on `main` and the evidence Proposal 5 §1b names; fill the closure register with tested revision, evidence, runtime and environment, unresolved limitations and one verdict per story; derive the sprint-status changes for the seventeen keys from the register only.

## Boundaries & Constraints

**Always:** reuse valid existing evidence as it stands; record the runtime and environment the evidence was produced in (including any Node-version caveat); keep the `[COMPILER-1 PATH]` note in `course-correction-dispositions.yaml`, never in a status value; register the three done stories' (4.1–4.3) evidence without changing their status; where the only missing evidence is a cheap reproducible run on `c18ad36` (a browser spec, an integration file), run it once and record it.

**Ask First:** any verdict of Residual work (name the owner and the residual scope before recording it); any rerun that needs a live provider or a personal account.

**Never:** rerun every historical test indiscriminately; change application code or tests; treat closure as proof of the compiler-2 capability that replaces the story; change Epic 4 or 5 statuses from anything but the register's verdicts.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Sufficient evidence | story ACs met by named reports, CI runs, specs | verdict Done — `[COMPILER-1 PATH]`; status `done` | N/A |
| Missing check | an AC no evidence covers | verdict Remains in review naming the missing check; status stays `review` | N/A |
| Unresolved acceptance failure | evidence shows an AC not met | verdict Residual work with owner and disposition; status stays `review` | ask first |
| Evidence from a non-pinned environment | e.g. Node 22 instead of 24.20.0 | recorded as a limitation on the row; not disqualifying by itself | N/A |

</frozen-after-approval>

## Code Map

- `_bmad-output/planning-artifacts/course-correction-2026-09-24/proposal-5-epics.md` §1b -- the closure register template with the evidence pointers per story
- `_bmad-output/implementation-artifacts/epic-4-*.md`, `epic-5-*.md`, `review-epic-5-stories.md` -- the existing evidence
- `_bmad-output/implementation-artifacts/sprint-status.yaml` -- the seventeen keys under `epic-4` and `epic-5`
- `_bmad-output/implementation-artifacts/course-correction-dispositions.yaml` -- where `compiler_1_path` and `retrospective_required` are recorded

## Tasks & Acceptance

**Execution:**

- `_bmad-output/implementation-artifacts/legacy-review-closure-register.md` -- create; one row per story (4.1–4.12, 5.1–5.8) with tested revision, evidence relied on, runtime and environment, unresolved limitations, verdict -- the assessment's output
- `_bmad-output/implementation-artifacts/course-correction-dispositions.yaml` -- set `compiler_1_path: true` and `retrospective_required: true` for the closed stories -- disposition stays out of the status value
- `_bmad-output/implementation-artifacts/sprint-status.yaml` -- apply the verdicts to the seventeen keys only -- through the sprint-planning tooling, `validate` before and after
- PRD workspace memlog -- append one decision entry summarising the verdicts -- through `memlog.py`

**Acceptance Criteria:**

- Every one of the twenty Epic 4 and 5 stories has a register row; the seventeen in review have exactly one verdict each.
- No status changed except from a recorded verdict; `validate` passes after the change.
- No application code or test changed (`git diff --stat -- apps packages tests scripts` empty).
