---
title: 'Review the pack''s 23 reference screens against the six-scene acceptance set; open the design-acceptance register'
type: 'chore'
created: '2026-09-25'
status: 'ready-for-dev'
review_loop_iteration: 0
context:
  - '_bmad-output/planning-artifacts/ux-designs/ux-Zobba-2026-09-25/EXPERIENCE.md'
  - '_bmad-output/planning-artifacts/ux-designs/ux-Zobba-2026-09-25/DESIGN.md'
  - '_bmad-output/planning-artifacts/course-correction-2026-09-24/proposal-4b-zobba-design-reconciliation.md'
  - '_bmad-output/planning-artifacts/course-correction-2026-09-24/proposal-5-epics.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** The Zobba design pack's 23 reference screens were only partly reviewed in Proposal 4b (screens 03, 04, 06, 11, 14, 15, 17, 18 not individually reviewed), and sixteen surfaces the product needs have no design at all. D-5-6 forbids building a surface before its design is reviewed, and D-5-4 requires this review before Epic 18's shell story (18.3) starts.

**Approach:** Review every reference screen against the six-scene acceptance set (a new conversation; active analysis; artifact and citation inspection in reading and review modes; a material decision; an uncertain external effect; an unattended scheduled result) and against the approved amendments (Proposal 4b §5, §6a); open the design-acceptance register with one row per undesigned surface, its owning story part and the slice that first needs it; record what each screen establishes and what it does not.

## Boundaries & Constraints

**Always:** treat the pack as the authoritative visual and interaction specification and the approved reconciliation as governing amended screens, defaults and copy; keep the pack's closing rule — a rendered mockup proves no integration, security control or execution behaviour; record every review finding against the screen and the scene it fails; keep WCAG 2.2 AA as the target for every new flow.

**Ask First:** any finding that would change an approved decision (D-4-1..4, D-4b-1..7) rather than a screen; any proposal to add a surface the register does not list.

**Never:** design or build application code in this story; approve a screen as proof of behaviour; mark a register row closed without a reviewed design.

</frozen-after-approval>

## Code Map

- `_bmad-output/planning-artifacts/ux-designs/zobba-design-system-v1.0/reference-screens/` -- the 23 screens and their README scenario
- `_bmad-output/planning-artifacts/ux-designs/ux-Zobba-2026-09-25/EXPERIENCE.md` §11, §13 -- the six-scene set and the open questions
- `_bmad-output/planning-artifacts/course-correction-2026-09-24/proposal-5-epics.md` §5 -- the sixteen undesigned surfaces with their story parts and slices

## Tasks & Acceptance

**Execution:**

- `_bmad-output/implementation-artifacts/design-acceptance-register.md` -- create; part A: one row per reference screen (scene(s) it serves, verdict, findings, amendments applied); part B: one row per undesigned surface (surface, owning story part, slice, status `open`) -- the register D-5-6 makes a story-entry criterion
- `_bmad-output/implementation-artifacts/design-acceptance-register.md` -- record the owner's review of the 23 screens (date, reviewer, findings) -- the review record 18.2 promises
- PRD workspace memlog -- append the review outcome -- through `memlog.py`

**Acceptance Criteria:**

- All 23 screens have a verdict; screens 03, 04, 06, 11, 14, 15, 17, 18 are individually reviewed.
- All sixteen undesigned surfaces of Proposal 5 §5 have a register row naming the story part and slice; none is marked closed.
- The register states, per screen, that it is illustrative except the fixed labels and safety-critical patterns adopted as exact copy.
