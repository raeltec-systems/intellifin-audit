# Executable plan contract, schema 1 / compiler 1

This is the normative interpreter contract for the durable plan emitted by `packages/domain/src/procedures/executable-plan.ts`. Story 2.6 derives and previews this contract; it does not implement or verify execution. A future executor must implement these action semantics and consume the stored validated plan. It must not call the compiler or a model to invent another plan. An unsupported schema/compiler fails closed.

## Representation and authority

`schemaVersion`, `compilerVersion`, ordered `sessionSteps`, ordered `targetSystems[].planSteps`, `observations`, `credentialReferences`, `limits`, and `inputs` together constitute the plan. `inputs` is an explicit snapshot of authored Population Source, Period, scope, inclusion predicate, Gate flags, Target System registrations/instructions, Compliance Rule predicates, Evidence Requirements, Schedule and Template sections. It is not permission to re-derive steps.

An action has a closed versioned meaning below. Its `targetSystemId` binds to exactly the matching frozen registration in `inputs.targets`; no current registration lookup substitutes another contract. Stable step ids identify the Step Execution order. `text` explains the interpreter semantics in the preview and is compiler-authored; text is never an instruction override. Equivalent model labels may validate, but are discarded in favor of the compiler's canonical text. The model cannot change action kinds, ordering, systems, inputs, predicates, evidence, references or limits.

Schema validation returns recursive canonical JSON key order. Serialize that validated object using canonical JSON to obtain the durable byte representation; PostgreSQL JSONB key ordering is not executable meaning. Attempts, timestamps, queue ids, model identity and prompt version live outside those bytes. Compiler and model configuration are frozen on the Procedure Version. Successful repeat attempts produce the same canonical bytes.

## Session actions

| Action | Binding and required behavior |
| --- | --- |
| `create-workspace` | One isolated Run workspace when any selected Target is web/desktop. Enforce each frozen origin/application identity and permitted read action. Neither authored instructions nor retrieved content can widen this authority. |
| `acquire-population` | Read exactly `inputs.sourceSnapshot.contract`; verify its schema, declared counts at file and inclusion levels, complete acquisition and immutable digest. Apply `inputs.inclusionRule` and the explicit inclusive UTC `inputs.period`, preserving per-record identity. Apply zero-record-Pass and versioned-duplicate flags only through their Gates. A Schedule records a future Run-period rule; plan derivation never evaluates it. |
| `sign-in` | Bind the specified web/desktop registration's credential **reference**, allowed identities and read actions. Credential resolution belongs to the later executor's credential boundary, never this derivation or preview. |
| `extract-adapter` | Bind the specified API/file registration. Acquire all declared pages/rows exactly once, preserving extraction provenance and count/coverage evidence. Partial extraction cannot prove absence or Pass. |

Session actions are ordered: optional workspace, population acquisition, then one sign-in/extraction for each selected Target in authored order.

### Run period binding and population checkpoint

Execution binds the Run's separately persisted inclusive UTC `period` as the effective
period input. The draft `inputs.period` and all stored plan bytes remain unchanged.
The source declaration must cover the effective Run period; inclusion applies that
period with the frozen rule. Current Population Source bindings never substitute for
`inputs.sourceSnapshot`, including after the approved version retires.

The population interpreter implements [population acquisition v1](population-acquisition-v1.md).
It accepts plans whose first ordered Session Step is `acquire-population`; a preceding
unsupported workspace action refuses safely. It records that frozen Step id, a durable
attempt id, retry count, original start time and revisioned lease before external I/O.
`POPULATION_READY` completes only that Session Step. The Run remains Running and the
next ordered action is pending; no Target extraction or Result is manufactured.

## Per-target actions

Each Target's plan has `inspect-record`, `capture-observation`, then `evaluate-conditions`. The executor expands this work according to the Template's coverage: P-1 covers every included employee in every selected Target; P-2 covers the full account extraction with per-account role coverage; P-3 covers extraction with a grounded approval result per included transaction; P-4 covers the page/extraction with one grounded Observation per baseline parameter. Expansion must preserve these frozen action ids in Step Execution provenance.

### `inspect-record`: identity and search

The Template id selects this version-1 lookup binding. These exact columns must exist in the frozen Population Source declared schema or derivation fails. Display labels do not silently rename source columns.

| Template | Population lookup and matching policy |
| --- | --- |
| P-1 | Search `employee_id`, then `full_name` if the ID search has no match. Ground exact normalized employee identity. A name-only candidate without a matching employee identity requires human candidate resolution; fuzzy automatic matching is forbidden. |
| P-2 | Exact normalized `account_id` joins a population account to its grounded extracted role list. Expand roles using the versioned RoleMatrix before permission-pair evaluation. Unknown roles, incomplete expansion or conflicting entries remain Unevaluated. |
| P-3 | Exact normalized `transaction_id` joins approval decisions. Capture approval id as corroboration, preserve every matching decision and never select arbitrarily among duplicates/contradictions. |
| P-4 | Exact normalized `parameter` joins the population baseline parameter to the grounded production parameter name. Require one effective approved baseline at Observation time. Missing, stale or partial data remains Unevaluated. |

### Compiler-1 identifier normalization

Identifiers are opaque strings under addendum §B. Compiler 1 authorizes no lossy or equivalence-expanding transformation: compare the stored Unicode code-point sequence exactly. Preserve leading zeros, letter case, leading/trailing/internal whitespace and Unicode composition. Do not parse numeric identifiers, trim padding, case-fold, apply NFC/NFKC, transliterate or infer aliases. Here the normalized identifier is the validated original string, not a guessed reformatted identifier. Missing, empty or whitespace-only mandatory identifiers still fail their Gate; a non-exact or ambiguous identity follows the existing human-resolution path, never an automatic match.

This conservative definition follows exact matching and the no-fuzzy rule without inventing an identifier equivalence. It may require human resolution for differently formatted identifiers, which is preferable to falsely matching distinct identities. A future source-specific normalization policy changes executable matching meaning and therefore requires a new frozen compiler/contract version and reviewed successor; it cannot be introduced silently by an executor or adapter. Timestamp and decimal normalization remain their separately defined typed rules.

The target's frozen `secondary_key` is additional corroboration, never a replacement for primary identity. Use its frozen `attribute_label_patterns` to ground the relevant displayed attributes; inability to locate or ground one is a diagnostic, never a guessed mapping. Target-specific saved Audit Instructions provide navigation/read guidance within these semantics. They cannot change lookup keys, scope, Gates or matching authority.

For an agent-driven absent result, retain the query derived from the sanitized Tool Action log for every declared search key, its equality to the population key under the normalization rules, a grounded empty-result Structural Snapshot, and proof all result pages were consumed. Otherwise the item is Uninspected, not proven absent. Adapter-acquired absence requires the equivalent complete, grounded extraction/request coverage; an empty or timed-out response alone is insufficient.

Exactly one grounded primary-identity match can resolve automatically. Multiple, contradictory, name-only or otherwise unresolved matches raise choose-candidate escalation; until a valid human answer resolves them, they remain Unevaluated and prevent Pass. A resolved human match retains its origin. No matching or normalization uses fuzzy identity inference.

### `capture-observation`: grounding and coverage

Capture the plan's declared Observation fields and the frozen Evidence Requirements. Every Observation links the population key, Target, found/absent/ambiguous state, UTC time, Step Execution, capture method, match origin and Evidence ids. A found record requires a grounded identity attribute.

Agent-driven reads always include platform Structural Snapshot and screenshot. Deterministic attribute values must be grounded in a snapshot or source file/extraction, never screenshot/recording alone. Explicit model-read values keep that provenance and the authored grounding exemption; they do not masquerade as deterministic values. Preserve authored screenshot/recording requirements. Missing coverage, contradictory corroboration or unproven absence cannot Pass.

### `evaluate-conditions`: fixed evaluation

Evaluate each frozen applicability predicate and then its stored compiled rule or retained Agent-Judged definition. Numeric values remain decimal strings with exact comparison boundaries and tolerance; neither the executor nor a model recompiles or silently reclassifies the condition. Agent-Judged results use the frozen confidence threshold. An applicable condition with missing evaluation, missing/unnamed input or insufficient grounded support is Unevaluated with a diagnostic. Reduce record outcomes in the fixed order Exception, Unevaluated, Compliant, subject to the Evidence Quality Gates. A missing C2 evaluation on a found P-1 account remains a Gate failure.

## Limits and error behavior

Compiler 1 freezes three retries per Step Execution, 120 seconds per Step Execution, 10,000 Step Executions per Run, 3,600 seconds per Run and 1,000,000 tokens per Run. Only the retry count is a stated NFR value; the other finite defaults are explicit initial implementation policy. Any change needs a new compiler/contract decision, not a mutable deployment setting that rewrites existing versions.

The later executor must enforce these bounds, deny unregistered/write actions, retain required failure provenance and never turn timeout, incomplete coverage, missing evidence or ambiguity into a guessed Compliant result. This story tests derivation, validation, persistence, queue delivery and preview; runtime target access and evidence capture remain later-epic work.
