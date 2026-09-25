---
title: 'Apply the course-correction tracking changes'
type: 'chore'
created: '2026-09-25'
status: 'done'
review_loop_iteration: 0
---

## Intent

**Problem:** After the Sprint Change Proposal's approval, `epics.md`, `sprint-status.yaml` and a disposition record must reflect Epics 10–19, the dispositions of Epics 6–9 and the bounded parts, within the tracking tooling's vocabulary.

**Approach:** Regenerate `epics.md` from Proposal 5 and Proposal 7, run the sprint-planning tooling's `generate` and `validate`, write `course-correction-dispositions.yaml`, and run three checks (no superseded key regenerated as backlog; no deferred Epic 7 story selectable; no part key completing a parent).

## Record of execution (2026-09-25)

- `epics.md`: Epics 10–19 appended (135 story and part headings from Proposal 5 §2 and §4a plus Epic 10 from Proposal 7); Epics 6–8's stories converted to `Superseded` and `Deferred` headings with their replacements; Epic 9's stories re-titled to the generalised proofs; Story 4.12's heading added so its key is regenerated; §0a and the requirements dispositions added.
- `sprint-status.yaml`: regenerated with `project: Zobba`; 191 stories, 19 epics; only lifecycle statuses; 31 old keys (6.x, 7.x, 8.x, 9.x old titles, the old 4.12 key) dropped and recorded in the disposition record.
- `course-correction-dispositions.yaml`: created.
- Validation and the three checks: see the commit that carries this file.
