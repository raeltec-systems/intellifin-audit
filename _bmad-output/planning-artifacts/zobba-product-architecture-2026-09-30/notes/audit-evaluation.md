# Concrete audit evaluation and recurring-method design

This note supplies the missing audit semantics beneath the lead Zobba design. It retains the continuing Task, clean Rust backend/schema, adaptive real computer and standing Permissions. It is product/architecture specification, not a build plan. The alternate design contributes coverage, method pinning and persistent finding identity; its blanket external-action confirmations, fixed instruction hierarchy and frozen-permission implications are not adopted.

## Recommended product behavior

Zobba turns an objective into an inspectable **assessment basis**: the question being tested, applicable criterion and source, population/selection, evidence needed, analytical method and reporting limits. It proposes this in ordinary conversation and begins useful discovery. The auditor resolves only a material ambiguity or scope/method choice. No criterion-builder form or mandatory pre-execution procedure approval is introduced for exploratory work.

“Why is this an exception?” opens the criterion in force, exact affected records, source evidence, measured facts, analytical result and any human disposition. “Use the date of final approval” revises the relevant method/basis, recomputes affected evaluations and marks dependent drafts/reviews for reconsideration. Previously presented results remain recoverable. A draft can be improved continuously; approved or issued work always receives a successor version.

The shared mechanism is a versioned assessment ledger underneath conversational work. It supports deterministic checks and professional judgement while preserving their different evidential standing. It is not an execution-script compiler. Browser navigation and investigation remain adaptive; calculations and assessment claims name precisely what they mean.

## 1. Typed criterion and evaluation contracts

Use the following domain records. Keep the convenient user-facing words in the firm's methodology; retain these stable semantic fields underneath so a rating label cannot change the meaning of a missing input.

| Record | Required contract |
|---|---|
| **CriterionVersion** | Stable criterion ID and immutable version; readable assertion; criterion authority and exact source/version/location; effective date interval; applicable business scope; typed applicability test; required fact definitions; assessment mode; approved calculation/rubric version; missing/ambiguous-input policy; materiality/rating mapping; required judgement/review rules. |
| **AssessmentBasisVersion** | Task/engagement scope, objective, criteria versions, period and as-of instant, population/selection manifest, source contracts, analysis/method versions, limitations, and the accountable person's accepted material choices. |
| **FactObservation** | Subject identity, typed fact/value or explicit unavailable/ambiguous state, source snapshot and locator, effective/observed/acquired times as applicable, extraction/transformation reference and any corroboration/conflict. Never an ungrounded model sentence masquerading as a measured value. |
| **EvaluationRevision** | Stable evaluation identity, subject/opportunity key, criterion and basis versions, exact observation/analysis dependencies, applicability result, execution status, assessment verdict when available, reason codes and explanation, assessor/provenance, and current human disposition. Each revision is immutable; a projection identifies the current effective revision. |
| **AssessmentSummaryVersion** | The exact included evaluation revisions; denominator/coverage metrics with their units and manifests; distinct affected-subject counts; limitations; methodology aggregation result; cited findings and review state. |
| **Finding / FindingOccurrence** | A persistent issue and one observation of it in a task/period; supported failure or candidate concern, affected subjects/criterion, evidence, importance under the firm scale, status, responsible person and any follow-up/response. |

Typed facts include Boolean, decimal with scale/unit/currency, timestamp with timezone semantics, date, enum, exact identifier and bounded sets/relations. Preserve identifiers such as `00123` as identifiers. Record conversion rules; do not compare currencies or shift date boundaries silently. Amount thresholds use exact decimal arithmetic, never binary floating point. Policy selection follows the event's effective date; acquisition date is not a substitute.

The assessment mode is one of:

- **Deterministic:** a versioned pure predicate/calculation over grounded typed facts. Use a small Rust domain library for common comparisons, temporal relations, set membership and reconciliations, plus approved sandboxed analysis programs for larger/custom methods. Record code/environment/input digests and outputs. These functions do not drive applications, request credentials or own Task state.
- **Judgement-assisted:** an explicit rubric and supporting/contrary evidence produce a model proposal. Store the model invocation, actual model, rubric version, cited facts, rationale and uncertainty. A model's self-reported confidence is advisory; it cannot establish evidence completeness, turn an unsupported assertion into a fact or bypass human review.
- **Human:** the accountable person records a judgement with rationale and supporting references. Human authorship changes provenance, not the source facts or completeness rules.

A criterion may combine deterministic facts with a judgement rubric; record the sub-results and declare where judgement affects the overall assertion. Do not describe the combined result as entirely deterministic.

Keep these fields separate:

| Field | Values and meaning |
|---|---|
| Applicability | `applicable`, `not_applicable`, `unknown`. A supported exemption is not a pass; unknown applicability remains in the coverage accounting. |
| Evaluation execution | `not_started`, `waiting`, `completed`, `failed`, `canceled`. This is whether the evaluator ran, with the related operation/attempt if relevant. |
| Criterion verdict | `met`, `not_met`, `undetermined`, or absent when no valid assessment exists. Only applicable evaluations can be met/not_met. Unknown applicability or inadequate evidence may yield a completed `undetermined` assessment with explicit reasons. |
| Assessor provenance | `deterministic`, `model_proposal`, `human`, or a declared composite with constituent references. “Unevaluated” is never an origin. |
| Human disposition | `unreviewed`, `accepted`, `replaced`, `needs_reconsideration`; linked to immutable decisions and exact revision. Work-product approval/issuance is a separate lifecycle. |

Examples of reason codes are `source_unavailable`, `population_incomplete`, `ambiguous_identity`, `conflicting_policy`, `missing_required_fact`, `stale_evidence`, `applicability_unknown`, `calculation_error`, `not_selected`, and `verified_absence`. Codes support correct behavior; the auditor sees a short concrete explanation.

## 2. Coverage and denominators are first-class data

Create a population manifest before making a population-level claim. It identifies the unit of analysis, source/query/period, record identity and duplicate policy, acquired snapshots, declared-versus-retrieved reconciliation, pagination/end-of-stream proof, inclusion/exclusion rule and every exclusion reason. “We retrieved 1,000 rows” alone is not proof that the population has 1,000 records.

Each metric has a unit, scope, calculation, numerator/denominator when meaningful, source manifest and certainty (`known`, `bounded`, `unknown`). Never turn an unavailable count into zero. Keep these sets distinct:

1. Received source rows, including duplicates and rejected rows.
2. Resolved business subjects/versions. Duplicate rows may map to one subject; conflicting versions stay visible until resolved. An unresolved duplicate cannot silently disappear or inflate a denominator.
3. In-scope, excluded-with-reason and scope-undetermined subjects.
4. Selected subjects under the full-population or sampling method.
5. Applicable, not-applicable and applicability-unknown **criterion opportunities** within the selected subjects.
6. Opportunities resolved as met/not_met, undetermined, pending, failed or canceled, and the corresponding distinct subjects.

The manifest preserves mappings between these sets, allowing exact reconciliation without claiming every source row is one business subject. Use a partition only where it actually partitions the same grain. Never sum failures across criteria and call the total “records with exceptions”; count distinct affected subjects separately.

A denominator is labelled in the UI and export: for example “20 affected payments out of 1,000 payments requiring approval”; per-criterion metrics say “15 late approvals out of 1,000 applicable payments, with 20 undetermined.” Show counts before a percentage. If completeness is unproven, describe the inspected/acquired set and withhold the population-wide rate. When the universe is known but some assessments are missing, a known exception count can be a stated lower bound, not a final clean/failed population rate.

For samples, store the population frame/version, selection purpose, unit, method, size, strata, seed or chosen identities, replacements/exclusions and justification. Statistical inference is emitted only by a pinned validated method whose assumptions and confidence/tolerance parameters are recorded. Judgemental samples support conclusions about tested items and the stated professional interpretation, not an automatically calculated population confidence claim. A request for a different sample creates a new selection version.

A verified zero eligible population is reported as “No eligible items for this period; operating effectiveness was not demonstrated.” It is not automatically “control passed.” A methodology may define a separate no-activity disposition; that choice must remain explicit. A comparison/search that found no rows is not evidence of absence unless its source/coverage contract makes the search exhaustive for that assertion.

## 3. Missing input, failure, exceptions and review

The runtime and audit assessment must react differently to the following cases:

| Case | Execution/evidence fact | Assessment behavior |
|---|---|---|
| Approval log was acquired completely for an identified payment and contains no required approval | Successful acquisition, verified absence for that payment/period | `not_met` if the criterion requires that approval. Cite the completeness proof and exact lookup. |
| Approval endpoint timed out or the account cannot see the relevant history | Failed/blocked acquisition; input unavailable | `undetermined` or evaluation waiting, with limitation. Never “approval absent.” Retry/reconnect follows the operation contract. |
| Evaluator crashes or expression fails on unsupported data | Failed computation | No newly valid verdict; retain prior revision as prior/stale, surface the failure and preserve inputs. A failure is not a control exception. |
| Applicability depends on an unreadable threshold policy | Criterion basis unresolved | Applicability unknown; do independent work but do not choose a convenient policy. |
| Evidence supports a failure even though another part of the population is missing | Supported local failure plus incomplete wider coverage | Retain the supported exception; limit the wider conclusion. Missing inputs must not hide real exceptions. |
| Low model confidence or plausible suspicion | Judgement proposal/uncertainty | Candidate concern or undetermined; request targeted evidence or judgement. Do not label a confirmed finding solely on model confidence. |

Persist automated/model proposals, human decisions and effective assessments separately. A person can accept a supported proposal, request work, correct facts/basis, or replace a professional judgement with reasons. Their decision cannot erase an acquisition failure, enlarge coverage, remove an original exception occurrence or make a deterministic `15:03 > 15:00` result false. A correction to facts reruns the calculation; a justified alternative interpretation becomes a new criterion/basis or human assessment revision. A methodological exception/waiver, where permitted, is a visible disposition with its own authority and rationale, not a retroactive “met”.

Audit managers may review and approve only within their assigned engagement authority. Independence checks use the human contributor set for the exact work under review; clicking “accept Zobba's draft” makes a person accountable, and another model never counts as the independent reviewer. Team default: a different eligible Audit manager reviews the preparer's work. An explicit Admin-saved solo methodology can permit the same eligible audit-role holder to self-review; record `self_reviewed` and never describe it as independent. Admin configuration authority alone grants neither review nor issuance.

Review binds the assessment summary, included evaluation revisions, basis/criteria/method versions, required evidence and exact work-product version. A material change creates a successor and invalidates only the affected approval dependency set; the unaffected review history remains. The issued package is immutable. Human overrides must themselves be in the content seen by the reviewer. The normal UI explains the changed conclusion/limitation and shows who decided, rather than requiring the user to manipulate provenance fields.

Supported failures create finding occurrences. Use a persistent finding identity scoped to organisation/client/check family, criterion lineage, canonical system/resource/subject and issue kind; store occurrences separately with period/evaluation/evidence references. A safe scoped digest may help lookup but is not sufficient identity proof. Compare canonical fields, record merges/splits, and do not carry a finding across materially changed criteria without explicit lineage mapping. “Not observed this period” is different from “remediated”; closure requires appropriate follow-up evidence or an attributable human disposition. Retain candidate concerns separately from supported exceptions.

## 4. Recurring method contract

Promotion creates a **CheckVersion** as a readable assessment method, not a recording of the conversation or browser clicks. The engine is the same continuing-task engine. Its method constraints are typed data and versioned analysis/rubric packages; it may adapt how it navigates a source and may investigate related exceptions within authority.

A CheckVersion contains:

| Contract section | Exact content |
|---|---|
| Purpose and assertion | Objective, engagement/client scope, business period, assertions and criteria/rating versions. |
| Sources and rebinding | Canonical provider/tenant/account/system/resource selectors; allowed period-dependent discovery; source schema/meaning/coverage/freshness contracts; matching keys and allowed transformations. |
| Population and selection | Unit of analysis; inclusion/exclusion and duplicate rules; reconciliation proof; full-population or pinned sampling method. |
| Evaluation method | Deterministic program/predicate versions and environment digest; judgement rubrics and approved model-routing profile/version; required inputs, permissible adaptive retrieval, uncertainty behavior and required review. |
| Result contract | Required tables/work products/templates, coverage measures, finding identity, limitations, summary aggregation and deliverable review/issuance rules. |
| Authority and capacity | Narrowed standing Permissions and scoped service delegation, purpose, allowed effect classes, current-authority rechecks, resource/usage limits, responsible owner and escalation recipients. |
| Continuing work | Schedule/timezone, calendar period/as-of rules, source-event selectors, evidence waiting window, missed-start/backfill policy, overlap policy, deadlines and notification policy. |
| Approval identity | Immutable content digest, source task/basis, proposer, exact human approval and independence/solo-review label, effective-from time and superseded version. |

Pin an approved routing policy and qualified model set appropriate to the assessment mode, and record every actual model used. A permitted model substitution used solely for navigation or non-material extraction need not require reapproval if it remains within the approved capabilities/disclosure profile and its output is validated against the same source contract. A new model/rubric that materially changes judgement, meaning, required capability or processing destination requires a new reviewed CheckVersion. Deterministic calculations remain tied to exact code/environment inputs. This avoids either freezing a withdrawn model forever or silently changing assurance.

The check lifecycle is `draft → in_review → approved → active → suspended/retired`. Rejection returns a new editable draft, with decision history. Ordinary draft edits save directly and show their diff; they do not each request approval. Owner labels, notification preferences and schedule timing within already approved bounds can change through an attributable administrative revision without repeating method approval. Criteria, source meaning, material method, broadened authority and required review changes create a semantic CheckVersion requiring review before activation. Schedule editing alone does not activate authority. Approval and activation can be one human action when all dependencies validate. A recurring check may publish an automatic **draft assessment**, send allowed notifications and prepare work products. It cannot record human approval or issue an audit report automatically. An “asks first” operation becomes a durable decision wait with no effect dispatched; unrelated safe work can continue. Unattended execution never manufactures a yes, and the product should not prohibit creating the wait that enables later human continuation.

A Check service delegation is Zobba's authority to run scoped work, not an OAuth credential and not permission to impersonate a departed employee. Every connection separately records credential owner/principal, consent grant/expiry, permitted shared or organisation use and accountable maintainer. Removal of a connection owner, consent expiry or token revocation blocks affected new dispatch, including scheduled work. Use provider-supported organisation/application consent for unattended shared sources where appropriate; otherwise retain the named-user dependency visibly. A new owner supplies their own authorised consent or an Admin configures a supported service identity; copied tokens or relabelled ownership do not transfer access. Reassignment requires current source identity/coverage and Check binding validation, with a reviewed semantic version if the account/scope changes materially. Reassigning a check owner or reviewer is separately attributable and requires current audit role/engagement assignment. Keep acquired historical evidence under retention/access policy without assuming continued live-source access.

At occurrence creation, bind an immutable **ExecutionBinding**: CheckVersion, explicit period/timezone/as-of, canonical current source identities/versions, refreshed account identity, current narrowed authority, methodology versions, routing selection, analysis environment and budget. Recheck at dispatch. Pins preserve interpretation; they do not preserve revoked access.

### Rebinding and change handling

| Observed change | Recommended treatment |
|---|---|
| OAuth refresh for the same verified account, credential rotation, machine replacement, browser layout change | Operational rebinding under current authority; record it. Fresh observation/reconciliation applies. No definition change if semantic source/action bounds are unchanged. |
| New monthly file/object chosen by an approved period selector | Validate identity, period, schema, coverage and freshness; bind its exact version to the occurrence. An arbitrary similarly named file is insufficient. |
| Source gains a harmless extra column | Accept only under the approved schema-compatibility rule; record it and keep required fields/units/key semantics unchanged. |
| Required field meaning/unit, source account/client/environment, criterion, material analysis, sample design, judgement rubric, expanded Permissions or disclosure destination changes | Suspend the affected work; create a new CheckVersion and human review. Never silently remap the old method. |
| Permissions narrow, membership removed, account revoked, model withdrawn with no qualified alternative | Block affected new dispatch and show the dependency failure. Reconnect/reassign under authority or review a replacement; no automatic widening. |
| Underlying policy has a newer version | Keep the explicit effective-date selection rule; detect and present relevant drift. A check cannot keep reporting against a knowingly inapplicable pinned policy merely because its old definition was approved. |
| Source correction arrives during a still-open occurrence | Acquire a new snapshot and create an assessment revision; do not mix different as-of snapshots inside a supposedly consistent analysis. |
| Material evidence arrives after completed/approved/issued result | Create a linked correction execution/revision for that occurrence; preserve the earlier result and review. |

A layout change may justify new navigation, not a new interpretation. The agent can investigate a lead beyond the frozen method, but additional exploratory findings are labelled separately; changing the recurring assurance assertion requires a new method version.

## 5. Occurrences, idempotence, overlap and backfill

Give every planned business window a stable occurrence key `(check_id, logical_period_key)` and persist schedule revision, nominal due instant, explicit UTC bounds and business timezone alongside it. The logical period key is defined by the method, such as `2026-08` for the monthly August test or an explicit delta window. Do not include CheckVersion or schedule revision in the occurrence identity: activating a new version or moving the due time must not accidentally create a duplicate occurrence for the same business window. Ordinary due-time edits preserve the existing slot. A material change to the window definition requires an explicit activation-period mapping and linked superseding revision; it cannot silently create overlapping duplicate work for the same period. New evidence in the same logical period creates an evaluation revision under that occurrence. Version assignment uses an atomic activation cutoff and is pinned once admitted; an explicit superseding rerun is a linked execution attempt/revision under the existing occurrence. A separately requested test run is visibly ad hoc and never satisfies a scheduled occurrence by accident.

Evidence requests keep separate states for **received**, **verified/registered**, and **request satisfied**. Receipt of an email or file only establishes arrival. Verify object identity, scope, expected period/type, integrity and required coverage before using it; satisfaction requires the request's actual evidence conditions, not merely a matching filename or sender. A partial response keeps missing items open and can unblock only supported work. A person may accept an explicit limitation or revise the request, without converting incomplete evidence into complete evidence. Duplicate arrival wakes once; rejected/quarantined material does not satisfy a request.

For event-driven checks, use canonical provider event/object identity plus object version and trigger contract; deduplicate retries in the inbox. Where several events concern the same business window, coalesce them under a window/occurrence key and record the consumed versions. For evidence-arrival continuations, key the wakeup by subscription + source object/version + target Task. Webhooks are hints; reacquire and verify before declaring new evidence.

Default: **one admitted active occurrence per Check**, including a run waiting for evidence or human input; retries/recovery retain the slot. Independent approved parallel checks may still run. When a later slot becomes due, create its due record, mark it delayed by the active occurrence, and notify after the configured lateness threshold. Do not queue unlimited expensive computers or silently collapse monthly periods. Waits release compute but retain the logical overlap constraint. To avoid an indefinite blockage, default the evidence/decision window to the next scheduled due time; on expiry, close the older occurrence as incomplete with its known results/limitations, then admit the next. A firm can approve a different deadline or explicit independent-overlap policy. A later answer/evidence item creates a linked correction rather than reopening a closed occurrence invisibly.

Default schedule semantics: firm's selected IANA business timezone; monthly checks cover the previous complete calendar month; store UTC boundaries and local calendar labels. Define business-calendar/holiday adjustments explicitly when used. For a daylight-saving skipped local time, fire at the next valid local instant; for a repeated time, fire once at the first occurrence, with a unique slot key. Show these rules in schedule details. Do not reinterpret a scheduled business period as a rolling number of hours.

After downtime, record every missed slot. Automatically catch up only the latest due occurrence if within its approved lateness window; older slots remain “not run” until bounded backfill is authorised. Backfill is one readable request listing periods, effective CheckVersions, source availability, expected limits/cost and serial/concurrency policy. Within an already approved catch-up rule no extra confirmation is needed; beyond it, ask once for the batch. Never apply today's new criteria to prior periods without saying so; distinguish historical-method reconstruction from a deliberate current-method retrospective. Historical source snapshots may be unavailable, in which case report that limit rather than fabricating the original state.

Duplicate job delivery, worker restart and a lost notification return the original occurrence/task/operation receipts. A source refresh or rerun creates a new assessment revision, not duplicate finding occurrences or a second external send. External effects use operation idempotence/reconciliation independently of schedule deduplication.

## 6. Concrete example: accounts-payable approvals

The auditor requests: “Review August's supplier payments above K50,000 against our approval policy. Follow unusual cases and prepare the working paper.” This example uses a sample firm's own policy and threshold, not a Zobba universal rule.

Zobba establishes two criteria from the effective policy: **C1:** a required approval occurred before payment release; **C2:** its approver held an authorised role at that time. It acquires the AP ledger and authoritative approval/role records. API acquisition and SQL handle the population; the actual browser is used to investigate an exception and obtain a document available only in the application. It can navigate differently next month without changing C1/C2.

The registered population manifest reconciles 1,250 unique acquired payments: 50 outside August; 1,200 in-period; 200 at/below K50,000 and not applicable to this test; **1,000 applicable payments**. For 20 payments, approval-history retrieval failed. They remain in the denominator with explicit limitations. C1 and C2 results are:

| Criterion | Met | Not met | Undetermined | Applicable payments |
|---|---:|---:|---:|---:|
| C1: approval before release | 965 | 15 | 20 | 1,000 |
| C2: authorised approver | 968 | 12 | 20 | 1,000 |

Seven payments fail both criteria. Therefore the result is **20 distinct payments with supported exceptions**, **960 meeting both criteria**, **20 undetermined**. There are 27 failed criterion opportunities, not 27 exception payments. The population-level conclusion is limited by the 20 missing histories; the exceptions already demonstrated remain valid.

The conversational result could read:

> I found approval exceptions in 20 of the 1,000 payments requiring approval: 15 were approved late and 12 used an unauthorised approver; seven had both issues. I could not assess 20 other payments because their approval history was unavailable. The remaining 960 met both tests. The working paper contains the exception list and the missing-history request. Its overall conclusion remains limited until those histories are resolved.

The normal result view shows this summary, Exception payments, Coverage, Working paper and How it was assessed. A selected exception opens the policy paragraph, payment and approval timestamps, effective role evidence, comparison program/version and its evaluation revision. The 20 missing histories show `source_unavailable`, not failed controls. Execution can finish the requested investigation with limitations while the assessment remains incomplete and human review remains Draft. The UI can show “Work completed with limitations”; the underlying acquisition failures are retained.

If the auditor supplies valid delegated-authority evidence, Zobba registers it, evaluates its effective period and recomputes C2 under a new basis revision. The original proposed exception remains in history; any replacement is attributable. A reviewer cannot simply erase the 20 missing records or label the entire population compliant.

“Run this monthly” proposes a Check with C1/C2, the K50,000 effective-policy selector, previous-month period, ledger/approval/role source contracts, exact comparison method, matching/coverage rules, a restricted service delegation, a permitted routing profile, a deadline before the next run, owner/reviewer and exception notification. The next occurrence runs the same method on new bound source snapshots; browser navigation remains adaptive. New policy thresholds, a different ERP account or a material method change create a revised definition. A token refresh does not.

## 7. Integration into the lead design and business choices

Add the assessment records under Evidence/work products and Knowledge/methodology. The Rust audit-domain module owns pure applicability, exact calculations, evaluation validity and aggregation invariants. Sandboxed programs return measured inputs/results; the evidence module registers their lineage; Task authority controls all work, questions, budgets and dispatch. Review owns human disposition and exact-version approval. Continuing work owns CheckVersion/ExecutionBinding/occurrences, using the same Task engine. No second compiler, procedure engine, model bridge or universal twenty-row Gate is introduced.

Ordinary choices are resolved above. No new owner decision is needed for typed facts, honest denominators, immutable revisions, source rebinding, per-occurrence identity or correct uncertainty. The user's confirmed choices of architecture, standing Permissions and honest solo practice remain settled and are not reopened here. Admin saves and versions methodology/skill configuration without a second configuration approval ceremony; substantive audit Check activation and exact-version work-product review remain distinct audit responsibilities. Remaining owner-level decisions are commercial packaging, qualified application support and deployment region, addressed elsewhere in the integrated design. A firm chooses methodology-specific criteria, sampling/inference, tolerances and permitted review exceptions through the designed configuration process; the product designer should not choose them globally.

Useful existing behavior to port: `packages/domain/src/runs/population.ts:34` collection completeness and :193 inclusion accounting; `runs/evaluation.ts:183` conflicting/incomplete reference sources, :350 unsupported compliance and :419 per-criterion evidence facts; :588 stable exception-fingerprint inputs; `packages/application/src/runs/evaluation-review.ts:24` immutable original proposals and :48 attributable review decisions. Preserve those semantics and their golden/adversarial tests, not the frozen Procedure/Run schema, confidence-threshold shortcut, fixed P-template rules or universal result precedence table.

Design-level acceptance examples: known absent approval versus failed retrieval; duplicate/conflicting subject identities; decimal threshold/effective-date boundaries; overlapping criterion failures counted once at subject grain; unknown denominator withheld; sample limits carried to report; zero activity not called effectiveness; override preserving original facts; late evidence invalidating exact dependencies; solo review correctly labelled; same-account refresh versus foreign-account substitution; model/rubric drift; duplicate schedule/event deliveries; missed periods/backfill; suspended owner/delegation; and one occurrence keeping its identity across CheckVersion activation or recovery.
