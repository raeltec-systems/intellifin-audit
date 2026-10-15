---
title: '24.1 — Bind typed criteria and facts to an assessment basis'
type: 'feature'
created: '2026-10-14'
status: 'review'
baseline_commit: '2be8298686e5ab98fddfe0045ddcad5ab4d19ca8'
review_loop_iteration: 0
context:
  - '{project-root}/_bmad-output/implementation-artifacts/spec-22-5-extract-usable-facts-with-stable-source-locations.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-22-6-use-methods-and-installed-skills-during-investigation.md'
  - '{project-root}/_bmad-output/planning-artifacts/zobba-product-architecture-2026-09-30/Zobba-Product-and-Architecture-Design.md'
  - '{project-root}/zobba/README.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** A method requirement's criteria are free text (`Requirement.criteria: Option<Vec<String>>`, `domain/src/methodology.rs:161`), and an agent answer is cited prose (`CitedAnswer`). Nothing pins which criterion version, period, population and source facts a judgment rests on, so a conclusion cannot be re-tested, and missing evidence, a failed analysis and an observed exception all look alike.

**Approach:** The agent keeps reading and acting natively (22.5/22.6). When it is ready to assess, it proposes criteria, an assessment basis, typed facts and judgments as new structured answer fields. Trusted code turns each proposal into an immutable platform record only after it checks it: authority and fact quotes are re-verified at their exact source location through the 22.5 verifier, typed values are re-parsed from the verified quote under a declared rule, and deterministic criteria are computed by small pure Rust predicates — never by the model. Judgment criteria record the model's rubric, supporting/contrary facts and reasoning in words. Applicability, execution, verdict and origin stay separate fields.

## Boundaries & Constraints

**Always:**
- **Criterion version** (Task-scoped, immutable, successor-linked by ID): assertion text; authority = either the bound method criterion (`binding id, requirement id, criterion ordinal, text digest`, read from the current binding like `method_part`) or a registered original `{original id, locator, quote}` verified by `application::citation::verify`; effective period (civil dates); applicability test; required facts (name, type, unit/currency); method `rule{predicate}` or `judgment{rubric text}`; missing/ambiguous-input treatment (closed: `undetermined` only in 24.1). Unverified authority is recorded but cannot yield `met`/`not_met`.
- **Assessment-basis version**: objective, criterion version IDs, business period + optional as-of instant, methodology binding ID + execution epoch, population/sample *references* (registered original IDs + digests, unit, selection text; denominators are 24.2), limitations, and the invocation that proposed it. Pinned exactly; a later change is a new version, never an edit.
- **Fact observation**: basis ID, subject (exact string, leading zeros kept, ≤128 bytes) and subject unit, fact name, value = typed `{identifier|text|boolean|enum|decimal{digits,scale,unit|currency ISO 4217}|date|instant{utc micros, source offset}}` **or** `unavailable{reason}` / `ambiguous{candidate count}`; source support = one or more 22.5 citation sources (original or 22.4 descendant) with their verification; declared parse rule (closed set, e.g. `decimal_plain`, `decimal_grouped_comma`, `date_iso`, `date_dmy`, `instant_rfc3339`); acquired/effective times. Trusted code re-parses the verified quote under the rule; any mismatch makes the fact `unsupported{type_mismatch}`. No floats anywhere; exact decimal is an in-house `i128` mantissa + scale in `zobba-domain`. No currency or time-zone conversion; comparing different currencies/units is `undetermined{unit_mismatch}`.
- **Evaluation** (one per basis × criterion × subject; 24.3 adds revisions): applicability `applicable|not_applicable|unknown`; execution `completed|failed` (+ closed failure reason); verdict `met|not_met|undetermined` or absent; origin `deterministic|model_proposal`; closed reason (`missing_fact`, `fact_unavailable`, `fact_ambiguous`, `fact_unsupported`, `unit_mismatch`, `unknown_applicability`, `authority_unverified`, `analysis_failed`); input fact IDs + digests. Only an applicable evaluation on supported facts can be `met`/`not_met`. A failed analysis job or evaluator error is `execution failed`, never `not_met`.
- **Deterministic evaluator**: `domain::assessment::evaluate(criterion, facts) -> Outcome`, pure, no I/O, closed predicate set (decimal compare `lt|le|eq|ge|gt` vs constant or fact; date/instant within basis period; identifier equal/unequal across two facts; enum/set membership; fact present). Same inputs → byte-identical canonical output digest. Trusted code runs it when the agent asks `evaluate`; the model never writes a rule verdict.
- **Judgment evaluation**: stores rubric criterion version, supporting and contrary fact IDs, the model's rationale and uncertainty in words (≤2,000 bytes), and its exact invocation. No numeric confidence. Shown as "Zobba proposes", pending human disposition (24.3).
- New `CitedAnswer` fields: `propose_criteria` (≤8), `propose_basis` (≤1), `record_facts` (≤64), `evaluate` (≤16 criterion IDs), `judgments` (≤8). Invalid entries dropped and counted in `discarded`; stored older answers parse with unchanged bytes and bindings.
- Records carry binding ID + execution epoch; after a 21.2 active change, earlier records remain unchanged and new ones use the new binding. Criterion/fact/basis text is attributed data and never grants authority.
- Migration 0018 `assessment_basis.sql` (additive; 0001–0017 and catalogues v1–v17 unchanged): `assessment_criteria`, `assessment_bases`, `assessment_basis_criteria`, `assessment_facts`, `assessment_fact_sources`, `assessment_evaluations`; immutable (UPDATE/DELETE/TRUNCATE refused, `zobba.disposable_fixture_reset` exception as in 0017), forced RLS, SELECT/INSERT runtime grants, insert guard checking claim custody and same-Task references, `SCHEMA_VERSION` 18, `schema-v18.catalog`, inventory checks.
- Web: Task work panel "Assessment basis" — criteria (authority chip via `Citation`), period, population references, facts with typed value and source chip, evaluations showing applicability / execution / verdict / origin as separate words; WCAG 2.2 AA.

**Ask First:** Adding any crate (decimal, time zone database); IANA zone arithmetic; Admin-authored structured criteria in the methodology editor; any live provider run.

**Never:** Floating-point money or dates-as-strings comparisons; a free-text verdict field; numeric confidence; a model-written deterministic verdict; a compiled step pipeline; treating execution failure or missing evidence as `not_met`; silent currency/date substitution; editing a stored record; live provider calls in tests.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Rule met | AP basis; invoice INV-0042 amount `1,250.00` USD from `Trial balance.xlsx!Sheet1!B4`; criterion "approval required above 1,000.00 USD" with approver fact | fact verified + parsed `125000/2 USD`; applicable; `met`, origin deterministic; re-run gives same digest | N/A |
| Value mismatch | fact typed `1280.00`, cell holds `1,250.00` | fact `unsupported type_mismatch`; evaluation `undetermined fact_unsupported` | no verdict |
| Missing input | no approver fact recorded | `completed`, `undetermined missing_fact` | N/A |
| Unavailable source | agent records approver `unavailable evidence_unavailable` | `undetermined fact_unavailable`; distinct from exception | N/A |
| Analysis failed | fact depends on a failed 22.4 job | `execution failed analysis_failed`, no verdict | job ID kept |
| Observed exception | approver absent from complete approval history fact (`boolean false`, supported) | `not_met`, deterministic | N/A |
| Currency mismatch | threshold USD, fact EUR | `undetermined unit_mismatch` | no conversion |
| Leading zeros / date / zone | subject `000123`; `date_dmy` `05/03/2026`; instant `2026-03-05T23:30:00-05:00` | ID kept exactly; date 2026-03-05; instant UTC 04:30 next day + offset −05:00; period test uses civil date of the declared fact, never acquisition time | N/A |
| Not applicable | amount ≤ threshold, applicability "amount > 1,000.00" | `not_applicable`, no verdict; not a pass | N/A |
| Judgment criterion | rubric "segregation adequate given org chart" | model_proposal with rationale, supporting/contrary facts, invocation; no confidence number | provider failure recorded; nothing fabricated |
| Unverified authority | criterion cites a quote not at its locator | criterion stored `authority_unverified`; evaluations `undetermined` | N/A |
| Old answer | 22.6 answer without new fields | parses; bytes unchanged | N/A |

</frozen-after-approval>

## Code Map

- `zobba/crates/domain/src/methodology.rs:161-204` -- `Requirement` (criteria are strings); authority source for method-backed criteria. `zobba/crates/application/src/investigation.rs:501,527,634` -- `criteria_missing`, `method_part`, `outline` (add an assessment-basis outline tier and outline hint for the new fields).
- `zobba/crates/domain/src/citation.rs:58-77,300-360,828-960` -- `Locator`, `CitationSource`, `CitedAnswer` (add fields; keep old decode), `Verification`, `decide`, `VerifiedSource`; reuse for fact and authority support.
- `zobba/crates/application/src/citation.rs:48-130` -- `CitationReader`, `verify` (reuse to verify fact quotes and criterion authority).
- `zobba/crates/domain/src/investigation.rs:24-200` -- `vocabulary!` macro and bounds pattern to copy for the new closed vocabularies; new `zobba/crates/domain/src/assessment.rs` (types, exact decimal, dates/instants, parse rules, `evaluate`).
- `zobba/crates/application/src/work.rs:573-760` -- `WorkReading`/`WorkInvestigation::after_answer`; add a `WorkAssessment` hook beside them (record, verify, evaluate, continue loop).
- `zobba/crates/infrastructure/src/investigation.rs` -- repository pattern under claim custody; new `infrastructure/src/assessment.rs`.
- `zobba/migrations/0017_investigation_basis.sql:54-250` -- table, insert-guard, immutability and fixture-reset pattern; `0016_citations.sql:123-170` -- citation source columns/checks to mirror.
- `zobba/crates/infrastructure/src/lib.rs:520,1419-1455` and `zobba/crates/domain/src/lib.rs:22` -- inventory, catalogue chain (`schema-v18.catalog`), `SCHEMA_VERSION`.
- `zobba/crates/worker/src/work.rs` -- trusted composition of the new hook. `zobba/crates/api/src/work.rs:178` -- `TaskWorkResponse` (add assessment section, scoped to viewer authority). `zobba/web/src/TaskWorkPanel.tsx`, `Citation.tsx`, `work.ts`, generated client.
- `zobba/fixtures/documents/Trial balance.xlsx`, `generate.py` -- extend with AP invoice/approval rows for fixtures.

## Tasks & Acceptance

**Execution:**
- [x] `zobba/crates/domain/src/assessment.rs` (+ `lib.rs`) -- types, exact decimal, civil date, instant with offset, parse rules, closed vocabularies, pure `evaluate`, canonical output digest.
- [x] `zobba/crates/domain/src/citation.rs` -- five answer fields, bounds, schema, old-answer decode unchanged.
- [x] `zobba/crates/application/src/assessment.rs` + `work.rs` hook -- verify authority and fact quotes via `citation::verify`, re-parse, record, evaluate on request, judgment recording, outline tier text.
- [x] `zobba/migrations/0018_assessment_basis.sql`, `infrastructure/src/assessment.rs`, `schema-v18.catalog`, `lib.rs` chain, `SCHEMA_VERSION` 18.
- [x] `zobba/crates/worker/src/work.rs` -- compose the hook.
- [x] `zobba/crates/api/src/work.rs` + `openapi.json` + generated client -- assessment section.
- [x] `zobba/web/src/TaskWorkPanel.tsx` (+ small `AssessmentBasis.tsx`) -- read-only display.
- [x] Tests -- every matrix row: domain unit (typed date/currency/zone/null fixtures, determinism by repeat digest), PostgreSQL (immutability, RLS, guard), worker loopback (synthetic model), web unit, one browser case.
- [x] `zobba/README.md` -- what is proven offline.

**Acceptance Criteria:**
- Given an evaluated criterion, when its basis is inspected, then criterion version, period, population references and every input fact are pinned with typed units and verified source support.
- Given the same basis and facts, when a deterministic criterion is evaluated twice, then both records have the same output digest.
- Given absent input, failed analysis or a supported exception, when evaluated, then the three records differ by reason/execution/verdict and only the exception is `not_met`.
- Given any stored record, when an UPDATE or DELETE is attempted outside the fixture reset, then the database refuses it.

## Design Notes

The model proposes; the platform records only what it can re-check. A fact is a pair: the verified quote (22.5) and a typed value that trusted code derives from that quote under a named rule. So "1,250.00" in `B4` and `{digits:125000, scale:2, currency:USD}` are linked deterministically, and the model cannot assert a number the source does not show.

```text
record_facts[0] = {subject:"INV-0042", unit:"invoice", name:"amount",
  value:{decimal:"1250.00", currency:"USD"}, rule:"decimal_grouped_comma",
  sources:[{original:"orig_tb", locator:"Sheet1!B4", quote:"1,250.00"}]}
```

## Verification

**Commands:**
- `cargo fmt --all --check && cargo clippy --workspace --all-targets -- -D warnings` -- expected: clean.
- `cargo test --workspace --locked -- --test-threads=1` on a guarded `_test` database -- expected: all pass.
- `pnpm --dir zobba/web check` and the work-panel browser case -- expected: pass with accessibility checks.

## Open Questions (owner decisions)

**Owner decisions (2026-10-15):** keep as one story (K); all five recommendations approved (A): 1(a) agent-proposed Task-scoped criteria; 2 no acceptance gate in 24.1; 3 in-house `i128`+scale decimal and UTC-plus-source-offset, no new crates; 4 deterministic and model-proposal origins only; 5 closed pure-Rust predicate set only.

1. **Where criterion versions come from.** (a) Agent proposes Task-scoped criteria citing the method text or a policy document (recommended: matches the native-agent direction and the design's "proposes through conversation"); (b) Admin authors structured criteria in the 21.2 editor first. Recommend (a) now, (b) later as an optional Admin shortcut.
2. **Human acceptance of a basis before evaluation.** Recommend no gate in 24.1: records show origin and the auditor corrects through Guide; review binding is 24.5. Alternative: block evaluation until an auditor accepts the basis.
3. **Exact decimal and time zones.** Recommend an in-house `i128`+scale decimal and UTC-instant-plus-source-offset with no tz database (no new crates). Alternative: add `rust_decimal` and `jiff` for IANA zone arithmetic.
4. **Human judgment entry.** Recommend 24.1 records only deterministic and model-proposal origins; human judgment/disposition stays in 24.3.
5. **Larger deterministic programs.** Recommend 24.1 supports only the closed pure-Rust predicate set; custom sandbox-program criteria (22.4 program digest as evaluator) follow in 24.2/24.3.

## Suggested Review Order

1. `zobba/crates/domain/src/assessment.rs` (+ `assessment/tests.rs`) — closed vocabularies, exact decimal, civil date, instant with offset, parse rules, and the pure `evaluate` and `output_digest`. Read the order of checks in `evaluate`: failed analysis, effective period, applicability, authority, facts, then the predicate.
2. `zobba/crates/domain/src/citation.rs` — the five optional answer fields, their bounds, `assessment_schema()` (only when assessing) and discard counting; old answers decode unchanged.
3. `zobba/crates/application/src/assessment.rs` (+ `assessment/tests.rs`) — `Assessment::after_answer`: criteria authority checks, basis pinning, fact verification through `citation::verify` and re-parse, rule evaluation on request, judgments; the reclaim rule (a re-run of the same answer continues the work and writes nothing).
4. `zobba/crates/application/src/work.rs` — the `A = NoAssessment` parameter, outline/feedback in tier 2, and the hook after reading and investigation.
5. `zobba/migrations/0018_assessment_basis.sql` — tables, CHECKs that mirror the documents, `assessment_guard` (invocation/binding/epoch, same-Task references, job outcome = a `completed` event, decided verdicts on supported facts only), deferred `assessment_complete`, immutability/retention triggers, RLS. Then `schema-v18.catalog` and `infrastructure/src/lib.rs` (inventory, grants, catalogue chain).
6. `zobba/crates/infrastructure/src/assessment.rs` — the repository under claim custody and the scoped view.
7. `zobba/crates/worker/src/work.rs` and `zobba/crates/worker/tests/assessment.rs` — composition and the end-to-end proof (loopback model, real PostgreSQL, S3-protocol originals, Docker sandbox, failing job, database guards, recorded fixture).
8. `zobba/crates/api/src/work.rs`, `openapi.json`, `web/src/generated/api.ts` — the `assessment` section and `assessment_unavailable`.
9. `zobba/web/src/assessment.ts`, `web/src/AssessmentBasis.tsx`, `web/src/TaskWorkPanel.tsx`, `web/tests/assessment.test.mjs`, `web/tests/browser/assessment.spec.ts` — strict parsing and the read-only display with four separate evaluation words.
10. `zobba/fixtures/documents/generate.py` (AP invoices and policy fixtures), schema-18 updates in `scripts/smoke.py`, `web/src/health.ts` and browser runtime helpers, and `zobba/README.md`.
