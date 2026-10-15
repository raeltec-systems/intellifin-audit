# Zobba build handoff

**Accepted baseline: revision 3 · 30 September 2026.** This is the consolidated implementation handoff for the existing repository. Product discovery is complete for this direction; the work is a brownfield course correction.

Start with the [build sequence](BUILD-SEQUENCE.md) and [first implementation batch](FIRST-BATCH.md). The [active baseline index](../ACTIVE-BASELINE.md) identifies the product, architecture, experience and SPEC contracts. [Epics and stories](../epics.md) contain the acceptance criteria; the standard sprint-status file is the only active execution queue.

Use `bmad-correct-course` for the accepted rebaseline, `bmad-create-epics-and-stories` and `bmad-sprint-planning` for this handoff, and `bmad-build` with an explicit new story ID for implementation. Historical story completion remains historical; no new runtime is claimed here.

## Inspect the experience

Open the [interactive Pair reference](../ux-designs/zobba-design-system-v1.0/source/zobba-working-environment.html). Its scene selector covers the engagement conversation, parallel Tasks, work products, private sign-in, account verification and computer/task control. It uses synthetic fixtures, collects no credentials and requires no service or login. [Rendered screens and interaction checks](../ux-designs/zobba-design-system-v1.0/reference-screens/README.md) accompany it.

## Use the current budget

The [operating budget](../zobba-operating-budget-2026-09-30/OPERATING-BUDGET.md) replaces the old **$300 platform placeholder and computer-only subtotal**. Do not add that earlier subtotal to the new figures. The old revision 3 design package is included as an immutable accepted reference; its earlier cost and review-status statements are superseded by this handoff.

Base monthly service cash is **$1,340.80 / $2,231.33 / $5,617.93** for **one / five / twenty active people**, each headline scenario in one firm, in the proposed **US East (N. Virginia)** region. Shared platform/test costs and customer consumption are separately itemised. Models, speech input, support and a test environment are included; staffing, taxes and the other stated business costs are excluded. These are estimates at declared workloads, not prices or measured capacity. The calculator, rate evidence and independent verifier are bundled.

The remaining commercial decisions are the launch region/processing and retention terms, the qualified application/authentication/service promise, and pricing with bounded included usage. Recommendations and affected gates are in the [handoff](README.md) and budget.

## Package contents and limits

This package preserves repository-relative paths for the active contracts, accepted detailed source, history archives, backlog, standard sprint status, budget and Pair reference. It excludes application source, installed dependencies and nested older ZIP files. Use the repository for implementation and full legacy history. Some historical documents link to source files outside this download.

[Validation](VALIDATION.md) records the actual checks. Planning, calculator and prototype verification do not constitute implementation, security or performance qualification. `MANIFEST.sha256` at the ZIP root covers every packaged file except itself. Rebuild with `python package_handoff.py` in the repository; HTML rendering requires Pandoc.
