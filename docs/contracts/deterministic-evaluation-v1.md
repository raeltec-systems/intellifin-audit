# Deterministic evaluation and Exceptions contract, schema 1

This is the normative contract for turning a corroborated Observation into an evaluation and,
where a control failed, into a permanent Exception. It is the last seam of
[observation registration v1](observation-registration-v1.md), and it runs inside the one
registration transaction, over the records exactly as they are being stored.

It is implemented by `packages/domain/src/runs/evaluation.ts` (what an evaluation MEANS) and
`packages/application/src/runs/rule-evaluation.ts` (the seam that supplies it with the frozen
inputs). Neither reads `fixtures/northstar/expectations/` — those files are DATA (AD-12) and
only tests read them.

## There is one rules engine, and it is Story 2.4's

`evaluateComplianceRecord` in `packages/domain/src/procedures/plan-compiler.ts` already
implements the approval rule, the permission-pair rule, the closed applicability grammar, the
exact decimal comparisons and the conservative evidence handling — over the conditions the
Procedure Version FROZE and under the compiler version it froze them with. This contract wires
an Observation into that function and maps the answer back onto §B.1's evaluation shape.

A second engine would agree with the first on every case anybody thought to try and diverge on
the first one nobody did, and the divergence would be an audit conclusion. The reduction is the
same one function too: `reduceComplianceEvaluations`, Exception then Unevaluated then Compliant,
with an absent evaluation represented rather than filtered out.

Nothing here consults a model, re-derives a condition from authored prose, or reads anything
outside the three frozen inputs below. Evaluation is **pure**: no clock, no store, no I/O. That
is two requirements, not hygiene — it runs inside a PostgreSQL transaction, and the story's own
acceptance criterion is that repeating it over identical Observations under the same version
yields identical results.

## The three frozen inputs

| Input | Where it comes from | Why it is not read from somewhere else |
| --- | --- | --- |
| the compiled conditions | `plan.inputs` — the version's frozen `complianceConditions`, compiler version and threshold | a current Procedure could have moved |
| the included population | `run_population_row`, as Story 3.2 froze it | `plan.observations` is the UNION across every Target System: P-3 declares `amount`, `currency` and `processed_time`, which live in the population and not in the approvals system |
| the Reference Sources | the bytes the Session Steps froze, re-read through `freezeArtifact`/`readRegisteredArtifact` | what the evaluator consults must be what the freeze established, not what was fetched |

The seam is **built by the stage**, not injected into it. A composition root holds none of the
three, so a seam it supplied could only ever be `NO_EVALUATION` — which is exactly how an
adapter Run would come to register every Observation as unevaluated forever with nothing saying
so. `NO_EVALUATION` remains for a producer with no compiled conditions.

## The values a rule may read

Only the Template's **declared** Observation fields
(`COMPLIANCE_OBSERVATION_FIELDS[templateId]`), and nothing else. The population rows and the
extraction rows both carry columns no condition names — P-2's `username` and P-3's `memo` are
the seeded prompt-like strings — and a value no rule can read is a value no rule can be steered
by. They are Evidence, they are frozen, they are served verbatim, and they do not enter the map.

The population supplies the base and the Observation's own grounded attributes win: the Target
System's reading of a field is what was observed. A field is read through `Object.hasOwn`, so a
Target System answering with `constructor` addresses nothing.

`found` is §B.1's three-valued state narrowed to the boolean the compiled grammar reads. An
`ambiguous` match has **no** boolean reading and is left absent, so a condition naming `found`
is `missing or invalid Observation field found` rather than quietly false.

### The population record must be unique

`populationValues` is `null` unless the included population carries **exactly one** row for the
record key. A duplicate primary key is an Evidence Quality Gate event and the two rows genuinely
disagree — P-3's TX-500008 is 210,000.00 in one row and 215,000.00 in the other — so first-wins,
last-wins and a union each answer a question the population cannot answer. `null` makes the
record ambiguous, which is Unevaluated.

### A role expansion is a LIST of entries

`RoleExpansion` is `{complete, entries[]}`, never a map keyed by role, and `readRoleExpansion`
reads the served CSV through the same RFC 4180 parser the population and the Structural Snapshot
use. The `entry` ordinal is the boundary: the RoleMatrix declares `AMBIGUOUS_DUAL` twice with
different permissions, and merging them yields `CREATE_PAYMENT + RELEASE_PAYMENT` — a prohibited
pair, and a confident Control Failure where the contract requires Unevaluated.

Every failure is `NO_ROLE_EXPANSION`, which `evaluateRule` treats exactly as it treats an absent
expansion (`incomplete role expansion`, therefore Unevaluated). A role expanded from half a file
is indistinguishable from a role with fewer permissions, and the second reads as Compliant.
Exactly one artifact must be readable as an expansion: zero is incomplete, and so is more than
one, because choosing between two policy files is the same ambiguity one level up.

## The evidence facts, and the Gate outranking the rule

`observationEvidenceFacts` is where the per-record Gate outcome **outranks** the rule verdict:

| Fact | True when |
| --- | --- |
| `inspected` | `coverage` is `COVERED` |
| `complete` | every per-Observation check PASSED |
| `ambiguous` | `coverage` is `AMBIGUOUS`, or the population cannot say which record this is |
| `contradictory` | the corroboration rollup is `CONTRADICTORY` |
| `absenceProven` | `found = false` and `coverage` is `COVERED` |

A record with any failing check is not `complete`, and the compiler then records every condition
`UNEVALUATED` — including one the rule would have called an Exception. An Exception raised on a
record whose identity did not corroborate is a finding about a record nobody has established the
identity of.

`inspected` is where the Template's §C coverage rule reaches the rules. Under `must-appear`
(P-2, P-4) a proven absence is `UNINSPECTED`, so `inspected` is false and every condition is
Unevaluated. Without that, a P-2 account absent from its own Target System was `COVERED`, P-2's
frozen `found = true` applicability did not apply to it, and compiler 1 gives a non-applicable
condition the value `COMPLIANT` — so an account whose permissions nothing could read passed its
own control. The rule table is in `observation-registration-v1.md`.

Because the facts are derived from the coverage and the corroboration, a `COMPLIANT` is
structurally unreachable for a record that is not `COVERED` or whose snapshot contradicts it.
`UNSUPPORTABLE_COMPLIANT` is a second lock on that same door and never turns while the two
agree; it exists because such a value is REFUSED by `registerObservations` and by the
`run_observation_evaluation` composite foreign key, which would roll the whole batch, the Work
Item and the Step Execution back. Degrading an outcome is the right failure; destroying a Run is
not. `evaluation.test.ts` asserts the agreement rather than the unreachable branch.

## The row that is written

Every evaluation this evaluator produces carries origin **`RULE`** — including one that records
an Agent-Judged condition as Unevaluated, because the origin says which evaluator wrote the row
and the deterministic one did. `confirmation` and `confidence` are `null`: §B.1 gives both to an
Agent-Judged evaluation and to no other.

`rationale` is deliberately `null`. A rule's reason is its diagnostics; a free-text rationale is
where retrieved content gets quoted back as the reason for an outcome, which is exactly what the
seeded prompt-like memos exist to catch.

`diagnostic` carries the compiler's own reasons, joined and bounded by the column that holds
them. Two are load-bearing and quoted verbatim:

- **`rule does not name value <v>`** — an attribute value no compiled condition names, with the
  value exactly as it was observed.
- **`condition does not apply to this record`** (`CONDITION_NOT_APPLICABLE`) — the frozen
  applicability predicate said this condition is not about this record. Compiler 1 gives such a
  condition `COMPLIANT`, which is the value stored, because the record's evaluation is the
  compiler's fixed reduction over these values. The reason is recorded so the §H count of
  APPLICABLE conditions (Story 3.8) can exclude it: a row saying only `COMPLIANT` is
  indistinguishable from a rule that was evaluated and passed.

## The Exception

The **first `EXCEPTION`** recorded for a record creates its Exception, in the same transaction
as the evaluation that raised it. There is no later step and no second call site: a control
failure and the durable record of it commit together or neither happens.

- `exception_id` is **derived**, never minted: RFC 9562 §5.8 UUIDv8 over a SHA-256 of the
  canonical JSON of `[runId, observationId]`. Run-stable, so a redelivered batch reaches the row
  it already wrote instead of raising a second finding about one record. A unique index on
  `observation_id` says the same thing where no command can route around it, and the insert is
  `ON CONFLICT DO NOTHING`: the existing Exception stands.
- `fingerprint` is **HMAC-SHA-256** over the RFC 8785 canonical JSON of exactly five keys —
  `condition_ids`, `population_record_key`, `procedure_id`, `target_system`, `template_id` —
  written key by key and never by spread. The **Run is deliberately absent**: a fingerprint
  identifies the FINDING, so the same control failure recurring next month fingerprints the same
  and is recognisable as the same finding. The Run is on the row beside it.
- It is **keyed**, not a plain digest: an unkeyed hash over a small closed vocabulary of record
  keys and condition ids is a dictionary anybody holding the fingerprints can invert, and the row
  it is written into is permanent. `fingerprint_key_id` is retained beside every fingerprint so
  a rotated key still says which key produced which value.
- The key reaches the evaluator as an `ExceptionFingerprinter` **port with no field holding it**:
  `JSON.stringify` of that object yields `{"keyId":"…"}`, so no checkpoint, audit payload,
  Timeline event, log field or error message has anywhere to pick the secret up from. It is
  `EXCEPTION_FINGERPRINT_KEY`, the worker's alone; without it the adapter stage is **disabled by
  name**, exactly as an absent `CREDENTIAL_TOKENS` disables it. An Exception with no fingerprint
  must not exist, and no evaluation happens at all without a key.
- The row carries the conditions that failed and every reason the rules gave — **every violating
  permission pair**, verbatim.
- Generation 23 puts two rules below the command, because neither is a CHECK: an Exception can
  never be **UPDATEd**, and it can never be **DELETEd while the Observation it was raised on
  still exists**. Removing a whole Observation is a different act — it takes the record and its
  digest with it, and the registration event still names both — so the foreign key cascades and
  the deferred constraint trigger passes at commit.

The registration event carries `exceptions` and `exceptionIds`, so a row that later went missing
is still accounted for in the chain.

## The golden populations

`tests/unit/golden-evaluation.test.ts` runs both golden populations through this pipeline and
asserts every named per-record case of `fixtures/northstar/expectations/p-2-sod-conflicts.json`
and `p-3-high-value-approvals.json`; `tests/e2e/population.spec.ts` asserts the P-2 cases again
against a real Run of the real Procedure through the real synthetic service.

**If a case disagrees with the implementation, the implementation is wrong.** The expectations
are frozen and the compiled rules are frozen; a disagreement is a finding, not a licence to edit
either.

Two cases punish a reasonable-looking shortcut and both are asserted against the datasets on
disk, so removing either from the DATA fails the test rather than making the implementation look
right:

- **P-2 account AG-1007 appears twice with different role lists.** The extraction carries it
  twice too, so the match is `ambiguous` and nothing resolves it; the population carries it twice
  as well, so `populationValues` is `null`. Any dedupe produces a confident wrong answer.
- **RoleMatrix declares `AMBIGUOUS_DUAL` twice with conflicting permissions.** Merging them
  reports a Control Failure where the contract requires Unevaluated.

P-3's TX-500007 carries no `processed_time`, so the frozen inclusion rule cannot place it in or
out of the Period: Story 3.2 marks the row INDETERMINATE and it never reaches an Observation. Its
Inconclusive is the population Gate's, not a per-record evaluation, and the golden test pins that
this is the only case reached that way.

Both full golden populations end **Inconclusive** by design.

## Role-privilege policy on an Agent-Judged condition (added 2026-09-08)

The owner's decision on P-1's C2 ("Treat any account whose roles look privileged as an
Exception even if disabled"): privilege is **never inferred from a role's name**, never read
from the system prompt, never hard-coded into the runtime and never read from an expectation
fixture. It is an explicit, reviewable **policy binding** frozen with the version, on the
condition it governs:

```
policy: { kind: 'role-privilege', rolesField: 'roles', privileged: [...], nonPrivileged: [...] }
```

- **Where it lives.** `RolePrivilegePolicy` in `compliance-draft.ts`, an OPTIONAL `policy` key on
  `ComplianceConditionInput`. The key is ABSENT (never `null`) on every condition without one:
  a compiled condition is compared byte for byte with its recompilation on every read, so a key
  added to legacy rows would make every stored version read as nothing. `null` on input means
  absent. The compiler accepts it only on a condition that compiles `AGENT_JUDGED` over a
  Template that declares `roles` (P-1, P-2); on a Rule-Classified condition it is refused —
  a policy beside a rule would be a second rule nobody evaluates.
- **The lists are sets.** Trimmed, deduplicated, sorted, disjoint, bounded
  (`ROLE_PRIVILEGE_LIMITS`), no separator characters in a name, at least one name across the
  two. Names are compared EXACTLY — compiler 1 named sets compare exact strings and
  corroboration permits no case folding — so `system_admin` is not `SYSTEM_ADMIN` and
  `SUPER_ADMIN` is unclassified until a policy names it.
- **How the roles value is read.** `readRoleList`: a JSON array of strings is itself (the P-2
  population); a plain-text cell — LoanCore renders `LOAN_ADMIN, SYSTEM_ADMIN` — is split on
  commas, semicolons and line breaks, each entry trimmed. A value that is not a list of names
  is UNREADABLE, never an empty list.
- **Classification** (`classifyRolePrivilege`): any privileged role → `privileged`, whatever
  else the account holds; every role known non-privileged → `non-privileged`; a role in
  neither list → `unclassified`, naming the roles; unreadable → `unreadable`.
- **Before the proposal.** In `evaluateComplianceRecord`'s Agent-Judged branch the policy is
  applied BEFORE the proposal is read: `unreadable` is the missing-field case
  (`missing or invalid Observation field roles`); `unclassified` is §B's unnamed value
  (`rule does not name value <role>`, one per unnamed role), which the Run-level Gate's
  unnamed-value row already matches on any origin. Neither row needs, or may carry, a
  proposal: `agentJudgedNeedsProposal` is the ONE predicate the producer
  (`applicableAgentConditionIds`) and the registrar (`registerObservations`) share, so the
  producer never asks the model about such a row and the registrar refuses a proposal for one.
  The producer raises the existing `unnamed-value` escalation for an unclassified role before
  any paid model turn, exactly as it does for a Rule-Classified unnamed value.
- **After the proposal.** A proposal at or above the threshold that the policy CONTRADICTS
  (COMPLIANT for a privileged account, EXCEPTION for a non-privileged one) is `UNEVALUATED`
  with `Agent-Judged value contradicts the frozen role-privilege policy: <value> proposed for
  roles <list>` — never silently corrected into the value the policy implies. C2 stays
  Agent-Judged and its human-review contract stays intact; clarifying the policy does not
  convert a machine proposal into an approval. The producer treats such a proposal as a
  rejected model answer (`model-policy-contradiction`): the bounded retry cycle, an ID-only
  `security.action-denied` record, then the `retry-or-skip` escalation, so a person decides.
- **The label.** A consistent privileged EXCEPTION carries the owner's own words as its
  diagnostic: `retained privileged assignment <privileged roles>`. It is still `pending`
  human confirmation like every other Agent-Judged value.
- **What the model reads.** `conditionInstructionText` renders the policy under the authored
  prose as ONE instruction; the compiler bounds the pair at `COMPLIANCE_LIMITS.text`, which
  is what the gateway accepts. The system prompt is unchanged.
- **The negative case is kept.** `canonicalLoanCoreCompliance({ c2Policy: false })` is the
  original undefined-privilege C2; without a policy every role is the model's alone to judge
  and the live acceptance expects it to ask rather than guess. With the policy, E-000102
  (LOAN_VIEWER) is non-privileged, E-000118 (LOAN_ADMIN, SYSTEM_ADMIN) is the declared positive
  privilege case, and E-000119 (OPS_GENERIC, XR_TEMP) is in neither list — still ambiguous,
  still escalated, exactly as `p-1-terminated-users.json` D16-b names it.

## Explicit population field mapping for a time condition (added 2026-09-08, D3)

The owner's decision on the 24-hour disablement variant (`disabled_time - termination_time <=
24h`): its complete evidence path is authored, frozen and proven end to end, and it is NOT a
universal mapping platform. A version says, explicitly and reviewably, which population column
supplies a compiler-1 time field that the bound source stores under another name:

```
mapping: [{ field: 'termination_time', column: 'termination_effective_time' }]
```

- **Where it lives.** `PopulationFieldMapping` in `compliance-draft.ts`, an OPTIONAL `mapping`
  key on `ComplianceConditionInput`, ABSENT (never `null`) on every condition without one — the
  same byte-for-byte recompilation reason as `policy`. `normalizeFieldMappings` accepts only a
  field the Template declares with value type `time`, each field at most once, at most
  `COMPLIANCE_LIMITS.mappings` entries, and a column that is an identifier of at most
  `COMPLIANCE_LIMITS.column` characters; the list is sorted by field. `compileComplianceDraft`
  refuses two conditions mapping one field to two columns (`COMPLIANCE_MESSAGES.MAPPING`), and
  `complianceFieldMappings` is the version's one merged set.
- **How it is applied.** `observationRuleValues` reads the population's same-named declared
  columns first, then the explicit mappings — explicit beats a same-named column — and a
  grounded Observation attribute beats both, because the Target System's reading is what was
  observed. A mapping to a column the bound source does not carry supplies nothing: the field is
  `missing or invalid Observation field termination_time` and the condition is `UNEVALUATED`.
  Nothing guesses that two names are one field, and `termination_effective_date` (a date) is
  never promoted to an instant.
- **The other instant is captured by its label, only when the version asks for it.** P-1's
  `disabled_time` is a VARIANT attribute: `variantAttributeLabels` on the Template (`Disabled
  time`), offered by the planner and accepted at capture only when the version's Evidence
  Requirements name the attribute (`attributeLabelFor`) and the target's frozen
  `attribute_label_patterns` permit the label. A default P-1 version therefore never captures it
  and its `required-evidence` check is unchanged; a version that asks for it and meets a page
  without the label fails `required-evidence` (`attribute-ungrounded`) and decides nothing about
  the window. The value is never read from an expectation fixture or a hidden import: LoanCore's
  own account page renders it (`apps/northstar/src/loancore.ts`), the catalogue registers the
  label, and the version freezes both.
- **The comparison is compiler 1's.** The existing duration grammar with the frozen
  `comparison.boundary` — `inclusive` makes exactly 24 hours Compliant, `exclusive` an
  Exception — over UTC-normalized instants (`normalizeObservedAt`), so
  `2026-08-08T00:00:00+02:00` and `2026-08-07T22:00:00Z` are one instant. A missing, invalid or
  date-only value on either side is `UNEVALUATED` with the missing field named; a proven absence
  is not applicable (`found = true` applicability) and C1 is what judges it. Every row this path
  writes is origin `RULE` with no rationale.
- **Where it is proven.** `disablement-window.test.ts` (domain: compile and refusals, below,
  exactly and above 24 hours, equivalent instants in different offsets, missing, invalid and
  date-only values, contradictory evidence, proven absence);
  `execute-agent-work-item.test.ts` (application: capture by label, the mapped instant, a page
  for the wrong employee registers nothing, the variant only when requested);
  `tests/unit/canonical-loancore-compliance.test.ts` (the §D E-000105 golden case, read from
  the datasets); and `tests/e2e/disablement-window-journey.spec.ts` (the compiled worker: the
  termination instant acquired from the declared source with its signed cover sheet, the
  disablement instant captured from LoanCore's page and grounded at a locator in registered
  bytes, a Pass after C2 confirmation; the date-only source seals Inconclusive naming the
  missing value).

## What this contract does not decide

The Run-level Gate rows, the applicable-condition counts and the mapping of a failing Gate to
`INCONCLUSIVE` (Story 3.8); Result sealing and publication (3.9); and the Agent-Judged
evaluation turn, the retained machine proposal and human review, which are
`evaluation-review-sealing-v1.md`.
