# Architecture Reviewer Gate — Rubric and Regulated Data-Integrity Lens

**Artifact reviewed:** `ARCHITECTURE-SPINE.md`  
**Review scope:** BMad good-spine checklist plus security, auditability, evidence integrity, and safe-failure invariants  
**Review mode:** independent reviewer; the spine was not edited  
**Mechanical lint:** pass — 0 findings from `lint_spine.py`

## Gate Verdict

**Needs revision before build handoff.** The spine is unusually strong on audit-domain ownership, deterministic outcomes, safe inconclusive states, review attribution, and adapter boundaries, but four load-bearing integrity/security seams remain underspecified enough that separate implementation units could produce materially different trust guarantees.

## Severity Summary

| Severity | Count |
| --- | ---: |
| Critical | 0 |
| High | 4 |
| Medium | 5 |
| Low | 2 |

## High Findings

### H-1 — Evidence recovery does not cover the evidence objects

**Affected decisions:** AD-5, AD-11, AD-12; PoC acceptance envelope  
**Problem:** AD-11 requires daily PostgreSQL backup and a restore test, while the binary Evidence is explicitly outside PostgreSQL in a bucket that has neither versioning nor object lock. The acceptance envelope claims a 24-hour RPO/eight-hour RTO, and AD-12 says restore behavior is tested, but the spine does not define any backup, replication, inventory, or recovery mechanism for bucket objects. Restoring relational metadata without its referenced Evidence produces an internally consistent database that cannot substantiate its Results. The absence of an application overwrite path does not protect against accidental deletion, compromised infrastructure credentials, provider loss, or teardown mistakes.

**Why high:** Loss of one artifact breaks reproduction, evidence completeness, signed Workpaper Bundles, and the platform's central assurance claim. A database-only recovery plan can falsely appear successful.

**Disposition:** **Autofix.** Require an explicit EvidenceStore recovery rule for the PoC: immutable/append-only application credentials with no delete permission; a separate, tightly controlled teardown identity; a periodic object inventory reconciled to PostgreSQL; recoverable backup/copy of every sealed artifact and manifest; and an end-to-end restore test that reconstructs a sealed Run and verifies every digest. State whether the RPO/RTO covers both metadata and objects.

### H-2 — Cross-store sealing has no crash-consistent commit protocol

**Affected decisions:** AD-3, AD-5, AD-6, AD-8  
**Problem:** PostgreSQL owns metadata and lifecycle state while EvidenceStore owns binary objects, but these systems cannot participate in one atomic transaction. The spine says an Evidence Package is sealed and then evaluated, yet does not decide the ordering, recovery, or reconciliation behavior when a worker crashes between object upload, digest calculation, metadata commit, and package sealing. This permits orphaned objects, metadata pointing to missing or partial objects, duplicate artifacts after retry, or a sealed package whose required objects were never durably verified.

**Why high:** The Evidence Quality Gate can only fail safely if its input package is itself known to be complete and durably retrievable. Idempotent stages do not by themselves solve a cross-store commit gap.

**Disposition:** **Autofix.** Define a recoverable protocol: upload to a unique provisional key, stream/hash and close, verify object existence/size/digest, transactionally register the immutable artifact, and seal only after all contract-required artifacts pass an availability-and-integrity precondition. Retries must reuse or reconcile acquisition idempotency keys. Add an orphan/missing-object reconciler and specify that any unresolved mismatch yields `INCONCLUSIVE` or `RUN_FAILED` per addendum H, never evaluation.

### H-3 — The integrity signature lacks a durable trust anchor and key lifecycle

**Affected decisions:** AD-5, AD-11  
**Problem:** AD-5 signs a canonical manifest with an “environment-held Ed25519 key,” but does not define key identity, custody, rotation, revocation, public-key retention, or the threat model the signature is meant to resist. An actor that can alter PostgreSQL/object state and replace or use the application environment key can recompute the audit hash chain and sign a new manifest. Without a preserved key ID and independently trusted public-key history or external anchor, later verification may establish internal consistency but not historical authenticity.

**Why high:** “Tamper-evident” is a load-bearing product claim. The current rule can be implemented as a same-environment checksum with stronger branding than security.

**Disposition:** **Discuss, then autofix the selected boundary.** For the synthetic PoC, explicitly limit the threat model and expose signer key ID plus a separately preserved public-key fingerprint. Introduce a `ManifestSigner` port now. Before customer data, bind it to managed KMS/HSM or an equivalent isolated signer, retain verification keys across rotation, record signing time and algorithm/key ID in the manifest, audit sign operations, and define compromise/revocation behavior. If external anchoring is not required, say which privileged threats remain out of scope.

### H-4 — Credential isolation and outbound data containment are promises without an enforceable seam

**Affected decisions:** AD-4, AD-9, AD-10, AD-11  
**Problem:** AD-4 requires least-privilege credentials scoped by Procedure, Source, and environment, but the architecture defines no credential reference/store boundary, lifecycle, or worker retrieval rule. “Secrets enter at composition roots” could lead one implementation to place all source credentials in shared worker environment variables. AD-9 fixes allowed origins and tools but does not say that origin/egress policy is enforced outside the model/browser session, nor does it govern which Evidence may be sent to a model provider, provider retention/training settings, DNS rebinding/private-address access, redirects, or exfiltration through tool arguments.

**Why high:** A cross-system audit runner concentrates privileged access. Prompt-injection resistance at the prompt layer does not contain a compromised browser session, adapter, worker, or overbroad provider request.

**Disposition:** **Autofix.** Add an inward-owned `CredentialProvider`/opaque credential-reference seam. Persist references, never secret values; fetch just in time for one Run/Source; expose only the minimum adapter-specific capability; revoke/rotate independently; and audit retrieval without logging values. Enforce origin and network egress allowlists at the sandbox/network layer, including redirect and resolved-IP validation. Require Procedure-versioned model data policy and minimization/redaction; block sending Evidence to providers that do not meet configured retention/training/residency constraints. Add contract and adversarial tests.

## Medium Findings

### M-1 — Audit hash-chain ordering is ambiguous under concurrency

**Affected decisions:** AD-5, AD-7, AD-8  
**Problem:** “Product audit events form a hash chain” does not define the chain scope (global, tenant, Run, or aggregate), sequence allocation, or transactional locking rule. Concurrent commands can fork a chain unless the head and sequence are serialized. A global chain also creates an avoidable write bottleneck and complicates tenant isolation.

**Disposition:** **Autofix.** Choose the chain scope, define monotonically increasing sequence semantics, and update the event plus chain head in the same transaction with locking or compare-and-swap. Verification must detect missing, duplicated, reordered, and forked events.

### M-2 — Atomic dispatch contains an unnecessary escape hatch

**Affected decision:** AD-3  
**Problem:** Run transition and dispatch are atomic “where supported,” even though the adopted pg-boss/PostgreSQL stack is specifically capable of sharing the transaction. Two teams could legitimately implement different reliability guarantees.

**Disposition:** **Autofix.** Make atomic state-plus-dispatch mandatory for the adopted stack. Defer a transactional-outbox substitute as the required condition for any future dispatcher that cannot share the transaction.

### M-3 — Tenant isolation is neither decided nor explicitly deferred

**Affected decisions:** AD-7, AD-8, AD-11; Deferred  
**Problem:** The PoC appears to be single-organization, but the spine never states whether tenant identity exists in the domain/schema or whether the database is deliberately single-tenant. Deferred work mentions tenant administration, not tenant data isolation. This leaves repository filtering, uniqueness constraints, object-key namespaces, audit-chain scope, authorization, and future migration free to diverge.

**Disposition:** **Defer explicitly.** State that the synthetic PoC is a single-tenant deployment and that no multi-tenant security claim is made. Before a design-partner production pilot, decide the tenant isolation model and bind tenant context through repositories, authorization, EvidenceStore namespaces, jobs, telemetry, exports, and cryptographic/audit-chain scopes.

### M-4 — Sensitive Evidence reads and denied attempts are not unambiguously auditable

**Affected decisions:** AD-7, AD-10  
**Problem:** AD-7 authorizes every Evidence read/export, while AD-10 lists broad “Evidence” audit events but does not explicitly require events for view/download attempts, successful reads, denied reads, or issuance/use of short-lived object access. Different implementations could log only mutations and exports.

**Disposition:** **Autofix.** Enumerate auditable access events and their minimum fields: actor, tenant/environment, Run/artifact, purpose or action, decision, policy/role, UTC time, correlation ID, and session/access-token identifier without the token itself. Record denied attempts and signed-access issuance; decide whether successful object retrieval is confirmed by the application or storage access log.

### M-5 — Stable Exception fingerprints may expose normalized business identifiers

**Affected decision:** AD-6; rerun/change comparison convention  
**Problem:** The fingerprint formula includes normalized business keys but does not state whether the stored/displayed fingerprint is derived with a keyed one-way construction. Direct concatenation or an ordinary hash of emails, employee IDs, account numbers, or transaction keys can leak low-entropy identifiers through logs, URLs, exports, or offline guessing.

**Disposition:** **Autofix.** Specify a canonical encoding plus tenant/environment-scoped HMAC (with key ID/version) or an opaque persisted correlation identifier. Keep clear business keys only in access-controlled Evidence/provenance, not in identifiers or telemetry.

## Low Findings

### L-1 — Stack currency is asserted but not evidenced in the artifact

**Checklist dimension:** named technology is verified-current  
**Problem:** The spine states that the seed was verified on 2026-09-01 and pins exact versions, which passes lint, but includes no verification references or compatibility evidence. This review was constrained to the spine and therefore could not independently validate the version claims.

**Disposition:** **Ignore for content if verification exists in the decision log; otherwise record sources or a reproducible version-check command outside the spine.**

### L-2 — Finalization has no append-only correction/supersession path

**Affected decisions:** AD-5, AD-7  
**Problem:** `FINALIZED` correctly freezes evidence and review state, but the spine does not say how a later discovered error, signing-key compromise, or required correction is represented without mutation. Implementers may add an unsafe “reopen” command or leave no valid correction path.

**Disposition:** **Defer explicitly.** Finalized records must remain immutable; corrections create a linked superseding review/workpaper/version with an append-only reason and preserve the original. Define this before any external assurance reliance.

## Good-Spine Checklist Assessment

| Checklist item | Assessment | Notes |
| --- | --- | --- |
| Fixes real divergence points for the level below | **Partial** | Strong domain and adapter rules; cross-store commit, secrets/egress, signer trust, and evidence recovery remain divergent. |
| Every AD is enforceable and prevents its stated divergence | **Partial** | Most rules are testable. AD-3's “where supported,” AD-4's credential promise, and AD-5's unspecified chain/signing mechanics weaken enforcement. |
| Nothing under Deferred permits silent divergence | **Partial** | Production data/storage gates are appropriately deferred; tenancy and post-finalization correction need explicit decisions or deferrals. |
| Named technology is verified-current | **Unverified in this pass** | Exact versions are pinned and the artifact asserts a same-day verification; no external evidence was reviewed. |
| Ratifies rather than contradicts brownfield code | **Not applicable / no conflict visible** | The spine presents a greenfield structural seed. |
| Covers source capabilities | **Pass** | Capability map covers all cited FR/NFR ranges; core Procedure → Run → Evidence → Result → Review semantics are represented. |
| Does not weaken inherited parent decisions | **Not applicable** | No parent architecture spine is identified. |
| Every owned dimension is decided, deferred, or open | **Partial** | Deployment, operations, testing, data, and security are substantially covered; tenant isolation and complete evidence-object recovery are not. |

## Integrity and Safe-Failure Strengths

- Deterministic evaluators alone issue Pass/Control Failure; agent output cannot become the System Outcome.
- Evidence insufficiency, ambiguity, exclusions, and unevaluated records cannot silently count as compliant.
- Procedure approval/version freezing, version-compatible comparisons, original/normalized values, transformations, and build/provider metadata strongly support reproducibility.
- Machine outcomes and human review/disposition are correctly separated and attributed with optimistic concurrency.
- Evidence is content-addressed by digest, package sealing is explicit, reads/exports verify integrity, and the Workpaper Bundle is designed for offline review.
- Prompt-like retrieved content is treated as untrusted and rendered inert; agent execution has bounded origins, actions, tokens, steps, and cancellation.
- Operational telemetry is correctly separated from product audit evidence, with explicit redaction constraints.

## Recommended Gate Action

Apply H-1, H-2, H-4, M-1, M-2, M-4, and M-5 as clear spine fixes. Resolve the intended PoC signing threat model for H-3 and explicitly defer the production-grade signer. Add the tenant and finalized-correction boundaries to Deferred. Re-run lint and the independent gate after amendment.
