# Reconciliation: Product Brief → PoC PRD Package

## Input reviewed

- Source: `briefs/brief-IntelliFin Audit-2026-08-31/brief.md`
- Compared with: `prd.md` and `addendum.md`
- Standard: only meaningful source ideas or constraints that are missing, distorted, or silently narrowed are reported.

## Overall assessment

The PRD package faithfully carries forward the product thesis, human-accountability boundary, four-procedure PoC, synthetic/read-only constraint, evidence-quality gate, reproducibility requirement, safe-failure behavior, preconfigured procedure scope, web application with background runners, and reusable-product-foundation intent. Most omissions are reasonable consequences of scoping the document to an exploratory PoC.

Three material gaps remain.

## Material gaps

### 1. The PoC may not prove the product's agentic execution claim

The brief defines governed hybrid automation as part of the proposition: deterministic testing supplies repeatability while bounded agents handle navigation, extraction, classification, or interpretation when rules alone are insufficient. The PRD preserves the safety boundary but makes the substantive proof optional: Open Question 3 asks whether an AI-assisted extraction step is required at all, and §8.2 defers model-assisted classification beyond tightly bounded extraction experiments.

This is a meaningful narrowing because a PoC implemented only as deterministic adapters and orchestration could prove evidence-grade control testing without proving the specifically agentic part of IntelliFin Audit's concept. The PRD should either require one bounded, adversarially tested agentic acquisition/extraction path or explicitly state that the PoC does not validate the agentic differentiation and identify the next-stage proof required.

### 2. Implementation economics and buyer value are recognized but not measured

The brief identifies time-to-first-trusted-test, implementation effort, component reuse, auditor hours saved, testing frequency, false-positive rate, reviewer approval rate, and cost per completed test as central commercial risks or future targets. The PRD carries forward reuse and hidden-services burden only as qualitative counter-metric SM-C3; it sets no collection method, baseline, or provisional PoC measure for setup effort, manual intervention, or reviewer effort.

For an exploratory PoC, commercial targets need not be invented. However, failing to instrument these quantities means the PoC may demonstrate technical correctness while producing no evidence about the Chief Audit Executive's desired outcome or the services-heavy implementation risk. At minimum, the PRD should require measurement of procedure-specific build/setup effort, manual interventions per Run, Run/review effort, and shared-component reuse, with targets deferred until baseline evidence exists.

### 3. Future private/customer-hosted deployment is deferred without a preservation constraint

The brief treats enterprise security, data residency, private deployment, customer-hosted runners, credential isolation, and tenant isolation as part of regulated-enterprise readiness. The PRD appropriately excludes enterprise deployment certification and customer-hosted deployment from the PoC, but it only lists these capabilities as deferred. It does not preserve the established commercial direction as a downstream design constraint or require the PoC foundation to avoid coupling evidence acquisition and execution irreversibly to one shared-hosted topology.

This does not require building private deployment now. The missing constraint is narrower: architecture work following the PRD should preserve separability of the web control plane, runner/executor, credentials, and evidence storage so that data-residency and customer-hosted execution remain feasible. The exact topology can remain a later decision.

## Deliberate scope cuts that are not reconciliation gaps

- Procedure authoring, approval lifecycle, scheduling, continuous monitoring, alerts, and duplicate-exception management are explicitly deferred for the preconfigured exploratory PoC, consistent with the user's later decisions.
- Desktop and arbitrary legacy automation are excluded from the PoC, consistent with the brief's own assumption that controlled web, file, and structured sources should validate the evidence model and runner first.
- Production integrations, production data, commercial GRC integrations, broad industry control packs, and autonomous assurance opinions are correctly outside the PoC boundary.
- Detailed synthetic schemas, matching rules, procedure thresholds, state models, and evidence-package contents are visibly marked as assumptions in the addendum rather than silently presented as settled source decisions.
