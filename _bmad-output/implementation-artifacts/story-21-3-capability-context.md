# Story 21.3 capability and producer context

Prepared 2 October 2026 after verified, independently reviewed and pushed Story 21.2 checkpoint `643ed095314d42f576106effd287703824003c73`. Canonical scope is `epics.md:403–425`: installed manifests/catalog, Admin enable/disable, method applicability, provenance/tool needs, and current-policy selection fences. This adds neither skill invocation nor an analysis runtime.

## Recommendation

Keep capability inspection inside Permissions. Add a bounded, read-only query over its **same accepted/current policy documents and account restrictions**, returning candidate compatibility rather than `PermissionVerdict`. A skill selection records an attributable technique/version choice, never an operation, confirmation, dispatch capability or expanded Task authority.

Do not manufacture `CanonicalOperation` values to probe `evaluate`. Do not treat a skill name, friendly tool description, Admin enablement, method recommendation or saved selection as authority. Do not build a second skill allowlist which bypasses Permissions.

## Actual source contracts

- `domain/src/permissions.rs:63–214`: operations require exact material/digest, account/environment, destination, resource/version, recipients, attachments and expiry. A rule permits one exact `(purpose, action, account, environment, destination, resource)` tuple, recipient/classification subsets and a deadline. Within a bound, rules are alternatives; between policy documents, bounds intersect.
- `permissions.rs:240–288,344–469`: account/source restrictions and complete root-to-leaf delegation chains are mandatory. Both accepted and current hard bounds must cover an operation. Standing coverage determines `Standing` versus `NeedsDecision` only **after** hard checks. Empty standing rules do not mean a tool is forbidden. Current widening cannot enlarge accepted authority.
- `infrastructure/src/operation.rs:152–218,606–728`: private loaders already retrieve the Task's accepted snapshot and current heads for its exact identities. One accepted snapshot has one account policy; there is no existing multi-account Task authority registry. New operation admission requires the accepted actor to match the operation actor. Do not search other accounts for a convenient grant.
- `operation.rs:94–107,252–310,354–395,885+`: organisation policy lock precedes engagement/Task fences; projection and consumption recheck authority, source, method and Task basis. Consumed history retains actual source outcomes. `application/src/operation.rs` currently has no capability-read port.
- Verified 21.2: `domain/src/methodology.rs:147–190` has exact `suitable_skills` version references. `MethodologyStore::task_basis` and `infrastructure/src/methodology.rs:284` expose bound-method explanation/current-use fencing. `suitable_skills` records suitability advice and is not a new capability grant. The current schema has no separate machine-readable required-skill-invocation field.

## Small contract

Application-owned query, conceptually:

`inspect_skill_needs(viewer, scope, task_id, server_loaded_manifest) -> CapabilityInspection`

The server resolves the current Task, bound method, exact installed manifest and accepted authority. Do not accept policy snapshots, arbitrary probe tuples or an authority actor from the browser. Keep the **viewer/selector** separate from the **Task authority actor**: a teammate's audit access does not substitute their member policy into the accepted snapshot. Label compatibility as being for the Task's accepted authority; selection itself follows current Task/audit access rules. Admin catalog control does not grant that access.

Use a finite, versioned server-owned tool/effect vocabulary mapped to existing `Purpose`/`Action` and owned adapter/source constraints. A manifest declares needs and can narrow them; it cannot create mappings, destinations, trusted account metadata or overrides. Start with conjunctive required needs. Avoid arbitrary Boolean policy expressions and silently dropping a forbidden declared need. Unrecognized manifest identifiers fail validation; recognized but unimplemented capability kinds are unavailable. Pure technique metadata can be installed and inspected without claiming a runtime exists.

Return exact skill/version/digest, catalog revision/status, method binding identity, per-need status/reason, observation time and an opaque dependency fingerprint. Keep separate:

| Capability result | Meaning | New selection |
|---|---|---|
| `Unavailable(reason)` | Missing acceptance/support, inaccessible or unreadable inputs, uncertain policy integrity, failed read, or bounded-query capacity reached. No compatibility conclusion. | Refuse; allow inspection of otherwise authorized catalog metadata. |
| `Forbidden(reason)` | Authoritative current/accepted hard constraint proves the declared need cannot be met: revocation, expired hard coverage, empty common tuples, source mismatch, invalid purpose/account boundary, etc. | Refuse. |
| `CompatibleNeedsExactDetails` | The declared need has surviving hard-bound possibilities, subject to the unresolved exact operation and current-use checks. It says nothing about dispatch, execution availability, or permission for all inputs. | May record the technique choice if catalog/method/access gates also pass. |

Catalog status is separate: disabled/recalled/inapplicable/missing versions remain explanatory historical facts, not selectable candidates. A catalog outage is unavailable, not “no skills” or a policy denial. Missing accepted authority is unavailable with a repair reason, not implicit permission. Unauthorized requests receive the existing opaque access refusal, without revealing another scope's policy/catalog existence.

## Conservative Permissions-owned compatibility query

1. Reuse/extract the structural pair checks from `evaluate`: valid snapshots/time; identical scope/actor/Task; same ordered delegation identities and length; complete valid parent chains; current versions not older; equal-version documents exactly equal; no revoked or future-dated document. Do not skip an ancestor, repair a changed parent, or fall back to a root grant. Corrupt/unreadable stored state is unavailable; a reliably observed revoked/replaced authority is forbidden. Both prevent selection.
2. Inspect **hard bounds first**. Intersect whole rule regions, starting with the actual rules of one bound and joining every accepted/current hard bound by the exact six-field tuple. Intersect recipients and attachment classifications; take the earliest deadline. Discard expired regions and tuples rejected by declared needs or either account restriction. For `Send`, an empty recipient intersection cannot represent any valid operation. Empty attachment intersection still permits an attachment-free operation unless the declared need requires attachments; unknown required input details stay explicitly unresolved.
3. Preserve alternatives and correlations. Never union different destinations/resources into a grant, or union recipients/classes across different rules and then test their pieces independently. Example: organisation permits `(recipient A, class X)` or `(recipient B, class Y)`, while another layer permits only `(A,Y)`. There is no attachment-bearing common region even though independent recipient/class unions overlap. Likewise, organisation read/resource A and engagement read/resource B do not establish read compatibility.
4. Keep this a bounded projection, not a general solver: at most eight rules per document already exist. Deduplicate regions; eliminate a region only if another with the same tuple contains both sets and has an equal/later deadline. Cap intermediate regions/work (ordinary starting choice: 256 regions and a fixed comparison budget). If a complete answer cannot be produced within the bound, return unavailable, never forbidden or an optimistic match. Retain enough internal reason provenance to explain which bound removed candidates; do not expose raw policy tuples unnecessarily.
5. Share rule-key, subset/deadline, snapshot-pair and account-purpose predicates with `evaluate`; keep the latter's exact-operation semantics unchanged. The query must not construct a `CanonicalOperation`, `OperationDecision` or `ConsumedOperation`, nor call admit/consume/gateway APIs. No new policy documents are persisted by discovery.
6. Standing is advisory detail only. The smallest honest output is “An exact action may require a decision.” Optionally query standing coverage through the same region machinery constrained by surviving hard regions. Empty standing intersection means an exact decision would be needed for these possibilities; nonempty means only that **some** details might fit standing authority. Never label a skill `Standing`, “pre-approved”, or “ready to execute”. A decision cannot override a hard denial.

Account predicates must retain today's exact behavior: live inspection requires Read, Live environment, a non-None read restriction and survival through takeover; test workflows require a verified Test environment, listed resource and cleanup identity; audit coordination requires Audit environment and a listed audit resource. Compare accepted/current `SourceBinding` including source, ledger incarnation, endpoint digest and contract version. A changed endpoint/ledger is not the same source merely because account labels match. Discovery cannot prove trusted attachment identity/digest/classification or material/resource-version validity before those inputs exist; report that limitation and retain the existing exact admission checks.

Expiry comes from server time and every surviving region, including every delegated bound. Never synthesize an expiry to make an expired grant pass. A displayed validity horizon is only a refresh deadline; revocation may invalidate it earlier. Unsupported analysis or an unrepresentable multi-account query is unavailable. However, an explicit account different from the Task's accepted single-account authority is a proven hard-bound refusal and remains forbidden, including in a manifest that also names the accepted account. Missing acceptance is unavailable. Adding another declared need must not turn an already proven refusal into uncertainty; never load a second account to manufacture compatibility.

## Selection and stale context

Discovery is advisory. `select` receives a logical command key, exact skill/version and expected catalog/method/Task selection revisions. In one short transaction, freshly authorize, load the immutable manifest/current status and Task binding, re-run compatibility, and save the attributable selection plus dependency identities. Reuse Permissions' transaction-local loader/query from the skill repository under the existing organisation → engagement → Task order; do not call a separately committing repository halfway through selection. Serialize catalog status changes with the same documented catalog fence. The lock order is an integration detail to reconcile with verified 21.2.

Recompute present eligibility whenever selected skills are read or admitted for new use. A cached response, unchanged client digest, old Task context or successful selection receipt cannot revive a disabled/recalled version or revoked authority. Lost-response retry may return the exact historical selection receipt **alongside current blocked eligibility**, never an active-use grant. Catalog revision and policy fingerprints identify the observed basis; they are not bearer capabilities or substitutes for a fresh read.

Disable blocks new selections/admissions; recall also marks existing affected selections unusable and identifies dependent work. Preserve historical selection/version/provenance and already-consumed operation/source receipts. Do not rewrite completed outcomes, cancel receipt reconciliation, or silently reselect a newer skill. Future invocation must check the selected skill's current-use gate and then pass real exact operations through unchanged admission/decision/consumption checks; implementing that runtime is outside 21.3. Do not make unrelated existing Tasks/operations require a selected skill.

## Meaningful later validation

- Domain: incompatible exact tuples despite equal tool/action; same-tuple alternative-rule recipient/class correlation; Send with no common recipient; attachment-free versus required attachment; current widening/accepted narrowing; hard-compatible with empty standing; every purpose boundary and source/ledger replacement; expiry at the exact boundary; each delegation ancestor, removed/reparented chains and equal-version tampering; bounded-query exhaustion stays unavailable.
- Cross-contract tests with **real complete operation fixtures in tests only**: every operation returning `Standing`/`NeedsDecision` must project as hard-compatible for matching declared needs (unless explicitly unavailable due to query limits). Known forbidden complete need sets must not admit. Production discovery must never mint an operation to obtain this result.
- PostgreSQL/API: current audit versus Admin-only access, two-client non-disclosure, accepted actor versus viewer separation, no accepted snapshot, failed/corrupt policy reads, atomic disable/revoke racing selection, stale method/catalog revision, exact retry after revocation, and no operations/decisions/claims/wakeups created by discovery or selection.
- Browser: catalog still explains provenance/inputs/tool needs while unavailable; disabled/forbidden choices cannot be selected from an already-open view; selected history remains inspectable with current blocked reason; optional technique choice never erases mandatory method requirements. Test hostile evidence never enters catalog and content/resource digests/provenance remain exact.

These are engineering constraints and verification examples for Story 21.3; the skill implementation is not yet delivered.


## Binding and attribution rules

Load `_bmad-output/implementation-artifacts/zobba-foundation-batch/STORY-21.2-CHECKPOINT.md` and `_bmad-output/implementation-artifacts/zobba-foundation-batch/story-21.2/integration-contract.md` before implementation. Preserve published migrations/catalogues through schema 8 byte-for-byte; the skill schema is an additive suffix. Use the Task's immutable current binding, execution epoch, exact requirement and field/template source IDs. Candidate versions retain context-discovery possibilities and are not the active methodology. Do not re-resolve current catalogue assignments to identify the Task's method. Current pending-change and recall gates override a pinned binding for new skill use.

Record the actual current authorized selector separately from the accountable actor whose accepted Permissions snapshot is inspected. The selector's audit access grants neither their own substitute account nor another policy snapshot to the Task. Exact selection replay returns the original receipt with current eligibility shown separately. Disabled/recalled versions retain history but are not newly usable; recalling one must not prevent reconciliation of an already-consumed operation.

Canonical acceptance is Story 21.3 in `planning-artifacts/epics.md`: installed vetted package plus Admin enablement exposes manifest inputs/provenance/method applicability; acquired instruction-like files remain evidence; current catalog and policy restrictions prevent use despite old context. The local current-use port is independently exercised without implementing invocation. No model calls, resource scripts, analysis workers or computer runtime are delivered by this story.

## Verification ownership

Follow the batch context for guarded databases and service ownership. The implementation owner exclusively coordinates builds and database/service suites; root and independent reviewers inspect read-only. Preserve all preceding checkpoint evidence and development state. Stop only owned test services after completion. Record actual invocation arguments, source manifests, matrix assertions and full exit receipts. Use a fresh story evidence directory. Reuse the documented fixture `run setup` path, Unicode parity, active-identity/non-expiring-Admin regressions, exact-account switch protections and populated upgrade checks.

## Time and dependent limitations

Selection and new-use eligibility must finish staged/deferred writes before their final time-sensitive current-authority and current-methodology check, following the repaired methodology/operation practice. A deadline crossed during a blocked transaction must not commit an eligible selection under stale observation time. Preserve Pause/Stop and do not introduce execution or automatic work merely by selecting a technique. A neutral or incomplete method is an honest limitation, not a universal ban on unrelated pure techniques; evaluate exact declared applicability and required inputs, and refuse unsupported dependent claims.

`resolution.version_ids` is the selected assignment-candidate list, not an exhaustive content dependency list. Retain requirement field source IDs and each template's original `source_version_id`; a historical exact template can be outside both selected and pinned candidate IDs. Do not lose that source's recall or neutral provenance when recording a skill selection's method basis. This does not make a historical template source the Task's current entire methodology.

## Inspection lifecycle

Reuse the verified methodology panel's current-owner/request-ownership pattern: intentional cancellation invalidates request ownership before aborting and preserves hidden same-owner inner disclosures. Exact owner/session replacement and real current-read failure/timeout still withdraw content. Preserve the user's actual focused inner node and open state; marking only an outer section cannot verify that promise. Follow the updated CLAUDE lifecycle lesson and keep current authority checks independent of retained presentation state.

## Installation and suitability labels

Explicit Admin installation records who selected the package and its exact source/revision/license. Structural validation and resource digests do not establish independent content certification; label the recorded installation and provenance accurately. Acquired evidence cannot acquire this standing by naming itself SKILL.md.

In the verified schema, `Requirement.mandatory` protects the requirement and its inherited content. Preserve its `suitable_skills` references and source explanation, but do not infer an obligatory invocation from that field or from placement under a mandatory requirement. Selection cannot remove any requirement, and this story supplies no execution claim.

## Dependency release

Story 21.2 passed 225 Rust / 107 zero-retry Chromium / 131 web / 56 fixture / 47 Python checks and all twelve required gates. Its implementation/test/build/service ownership is released; owned IdP9444/9446 stopped, development4310/9443/9445 preserved. Root removed only idle `zobba/target/debug/incremental` after confirming no Rust build process; binary/dependency caches and all evidence/private fixtures remain. Approximately11GiB free at handoff. Preserve this checkpoint and its exact published migration/catalogue prefix through8.

## Verified runtime availability reconciliation

The current source adapter is the worker's explicitly configured loopback qualification gateway. The API has no production qualified-tool registry. A policy's `SourceBinding` does not establish tool availability. Evaluate current/accepted Permissions so an authoritative hard denial remains `Forbidden`; otherwise compatible operation needs lacking a server-owned supported binding are `Unavailable`. Pure techniques remain selectable.

Contract/API fixtures may supply an explicit server-configured qualification binding to exercise the actual positive selection/current-use transaction, matching source, ledger, endpoint and contract version. This is local fixture qualification, not a production/runtime availability claim. No browser-controlled qualification flag, fabricated permission-probe operation or invocation is permitted. Record that production availability limit in the consumer contract; it does not change the frozen story intent or require new authority policy.
