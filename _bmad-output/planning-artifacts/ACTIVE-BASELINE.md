# Active Zobba build baseline

**Accepted design: revision 3, 30 September 2026.** This index supersedes earlier planning pointers for new Zobba work. The repository is brownfield: existing code and signed/history records remain; incompatible planning assumptions are retired explicitly. The [course-correction record](sprint-change-proposal-2026-09-30.md) records the owner's authorization and before/after changes.

| Use | Active artifact |
|---|---|
| What to build and verify | [SPEC and adopted companions](../specs/spec-IntelliFin%20Audit/SPEC.md) |
| Product requirements | [PRD](prds/prd-IntelliFin%20Audit-2026-08-31/prd.md), [addendum and dispositions](prds/prd-IntelliFin%20Audit-2026-08-31/addendum.md) |
| Architecture and runtime obligations | [Architecture spine](architecture/architecture-IntelliFin%20Audit-2026-09-01/ARCHITECTURE-SPINE.md), [contract register](architecture/architecture-IntelliFin%20Audit-2026-09-01/CONTRACT-REGISTER.md) |
| Experience and visual contract | [Experience](ux-designs/ux-Zobba-2026-09-25/EXPERIENCE.md), [design](ux-designs/ux-Zobba-2026-09-25/DESIGN.md), [Pair pack](ux-designs/zobba-design-system-v1.0/README.md) |
| Accepted detailed source | [Product/architecture design revision3](zobba-product-architecture-2026-09-30/Zobba-Product-and-Architecture-Design.md) |
| Build sequence and first batch | [Implementation handoff](zobba-build-plan-2026-09-30/README.md), [sequence](zobba-build-plan-2026-09-30/BUILD-SEQUENCE.md), [first batch](zobba-build-plan-2026-09-30/FIRST-BATCH.md) |
| Canonical stories and execution queue | [Epics/stories](epics.md), [standard sprint status](../implementation-artifacts/sprint-status.yaml) |
| Current sizing and cost assumptions | [Operating budget](zobba-operating-budget-2026-09-30/OPERATING-BUDGET.md) |

The accepted design remains a dated snapshot. Its earlier owner-review/planning-pending text is superseded by the owner's acceptance and this active set. Its historical $300 platform allowance and 12-user computer reference are replaced for launch planning by the sized operating budget. It is not necessary to rerelease another broad design report to apply those changes.

Active documents are synchronized interpretations of revision3, not competing alternatives. The SPEC and companions carry build requirements; the backlog expresses delivery scope/dependencies; prototypes show intended experience using fixtures; the budget states capacity/usage assumptions. None is proof of runtime implementation, measured performance or contractual customer support.

Historical PRDs, architecture revisions, UX, epics, source studies and course corrections are preserved under explicitly labelled archives or as dated reference records. Their stable identifiers are not recycled. Old `docs/contracts/` and story files govern historical code until individually adopted or retired in a new implementation story. New work does not need compiler-1/2 coexistence or a Node bridge. Pair tokens/assets and evidence/review/recovery behaviors remain useful reuse sources.

Use the installed BMAD sequence: `bmad-correct-course` for this rebaseline; current `bmad-prd`, `bmad-architecture` and `bmad-ux` update their owned artifacts; `bmad-spec` derives the contract; `bmad-create-epics-and-stories` then `bmad-sprint-planning` produce the execution handoff; `bmad-build` later implements an explicit new story. Do not select deprecated `bmad-create-story` or `bmad-dev-story` as the execution workflow.
