---
title: "Architecture Reviewer Gate — Adversarial Divergence"
artifact: "../ARCHITECTURE-SPINE.md"
review_type: "independent-unit incompatibility attack"
status: complete
date: 2026-09-01
verdict: fail
severity_counts:
  critical: 3
  high: 5
  medium: 2
  low: 0
---

# Architecture Reviewer Gate — Adversarial Divergence

## Verdict

**FAIL — the spine is coherent at the decision level but is not yet safe for independent lower-level implementation.** Ten seams permit two units to follow every applicable AD literally while adopting incompatible wire formats, atomicity assumptions, trust protocols, or lifecycle semantics. Three affect the central assurance claim: artifact/checkpoint idempotency, cross-module publication of a Completed Result, and integrity-manifest interoperability.

The findings do not call for new infrastructure. They require application-owned contracts, transaction boundaries, canonical encodings, and deployment/recovery rules to close choices that lower-level implementers would otherwise make independently.

## Attack method

For each seam, this review constructs two plausible units built independently from the spine. Each unit honors dependency direction, uses the selected stack only through adapters, and follows the stated ADs. The attack succeeds when the composed units can still lose evidence, disagree on state or bytes, authorize differently, or fail incompatibly.

## Findings

### ADV-01 — Critical — Evidence upload and checkpoint persistence have no composable idempotency protocol

**Seam:** transaction/job semantics; Evidence storage; retries.

**Independently compliant units**

- The `EvidenceStore` adapter implements append-only writes by generating a fresh, never-reused object key for every `put`, returns its SHA-256, and exposes no overwrite path, satisfying AD-5.
- The acquisition stage uploads the artifact, then opens a PostgreSQL transaction to append Evidence metadata and record its revisioned checkpoint, satisfying AD-3 and AD-8. It retries the stage from the first incomplete checkpoint.

**Divergence attack:** the worker crashes after the object write but before metadata/checkpoint commit. On retry it invokes `put` again and receives a second valid unique key. The store cannot recognize the logical duplicate, and the worker cannot discover the unregistered first object. Both units obey their local contracts, yet the composition leaks orphan objects or registers duplicate logical Evidence. The statement that retries “must not duplicate Results or Evidence artifacts” is an outcome, not a protocol.

**Required closure:** define an application-owned logical artifact identity/idempotency key (for example Run + Source + acquisition step + artifact kind + stable ordinal), conditional create semantics, and a recoverable two-resource commit/reconciliation sequence. State which component owns orphan detection, when an artifact becomes registered Evidence, and how retry verifies/reuses an existing digest. Add crash-point contract tests before/after object write, metadata insert, and checkpoint commit.

### ADV-02 — Critical — Completed Run, Result, Exceptions, and audit event can be published in incompatible transactions

**Seam:** state ownership; mutation paths; cross-module transaction boundaries.

**Independently compliant units**

- The `evaluation` module uses its command handler and transaction to persist immutable Result and Exceptions in tables it owns.
- The `runs` module uses its command handler and a separate transaction to transition the Run to `COMPLETED` and append its transition event. Neither module accesses the other’s tables directly, satisfying AD-2 and AD-8.

**Divergence attack:** evaluation commits, then the process fails before Run completion; or the Run commits first and the Result write fails. Queries can observe `RUNNING` with a published Result or `COMPLETED` with no Result. A review command may see different truth depending on which repository it reads. “One transaction boundary per state transition” does not identify the aggregate publication boundary or authorize an application unit of work spanning module-owned repositories.

**Required closure:** name the application orchestration command that atomically publishes Evidence Gate decision, Result, Exceptions, terminal Run state, checkpoint, and audit events. Define whether one PostgreSQL unit of work may coordinate multiple module repositories without violating ownership. State the only observable postconditions and forbid intermediate publication. Apply the same rule to finalization plus its manifest/audit head, or explicitly model a recoverable pre-finalization state.

### ADV-03 — Critical — Signed manifests and audit hash chains lack a canonical byte-level protocol

**Seam:** integrity; export; independent verifier compatibility.

**Independently compliant units**

- The finalization unit serializes a manifest as insertion-ordered JSON, hashes the UTF-8 bytes, and signs them with Ed25519.
- The export verifier parses the same manifest, sorts object keys, emits normalized JSON, and verifies the Ed25519 signature over those bytes. A second audit-event verifier orders equal-timestamp events by UUID while the producer orders by commit sequence.

**Divergence attack:** both units implement a “canonical integrity manifest,” Ed25519, SHA-256, and a hash chain exactly as written, but valid packages fail verification because canonical serialization, field order, number/time encoding, event ordering, genesis value, chain-link bytes, and signature envelope are unspecified. Key rotation or environment replacement further makes a valid historical manifest unverifiable because no key identifier/trust bundle rule is defined.

**Required closure:** publish a versioned manifest/hash-chain specification: normative field set and inclusion rules, canonical serialization algorithm, byte encoding, digest/signature inputs, event sequence source, genesis/previous-hash rules, signature envelope, public-key identifier, rotation/retirement policy, and verification-failure behavior. Include cross-implementation golden vectors and a tampered vector. Define whether finalization commits only after a durable signature exists and how a signing outage is represented.

### ADV-04 — High — Serialized boundaries have TypeScript names but no versioned wire contract

**Seam:** shared data shapes; web/worker jobs; database records; exports.

**Independently compliant units**

- Web dispatch serializes an application-owned job type `{ runId, procedureVersionId }` built from one revision of the shared package.
- A separately deployed worker consumes a later application-owned type `{ runId, procedureVersionId, stagePlanVersion }` and rejects the old payload with Zod, satisfying the boundary-validation convention.

**Divergence attack:** both builds compile and obey AD-1/AD-3, but a rolling deploy leaves durable old jobs unreadable. Equivalent divergence is possible for checkpoint payloads, canonical acquisition observations, provenance, and exported manifests because no wire-schema version, compatibility window, unknown-field policy, or upcaster ownership is stated.

**Required closure:** enumerate all serialized contracts and give each a versioned Zod schema owned by `application`: job envelope, checkpoint, Evidence observation/provenance, audit event, and Workpaper/manifest. Define additive/breaking-change rules, producer/consumer compatibility, and upcasting. Contract tests must run old-producer/new-consumer and new-producer/old-consumer fixtures for the supported deployment window.

### ADV-05 — High — Canonical provenance specifies content but not graph identity or semantics

**Seam:** Evidence/provenance; evaluator/acquisition interoperability.

**Independently compliant units**

- An acquisition adapter records original/normalized values, match keys, and transformations as a flat ordered list attached to an artifact.
- An evaluator expects record-level nodes with stable field IDs and edges from source records through normalization and matching to an Exception fingerprint.

**Divergence attack:** each preserves every item named by AD-6 as “structured provenance,” but the evaluator cannot link its compared value back to the exact artifact record/field, and the exporter cannot produce deterministic exception-level lineage. Ordinal row references also become unstable if normalization sorts records. Execution logs cannot safely repair the gap because AD-10 distinguishes telemetry from product evidence.

**Required closure:** define a versioned canonical provenance model with stable identities for artifact, source record, field/value observation, transformation, match, calculation, rule evaluation, Exception, and their directed edges. Specify ordering, cardinality, original-vs-normalized representation, exclusion/ambiguity semantics, and which module creates each identifier. Require acquisition/evaluator/export contract fixtures that reproduce an exception chain without logs or live Sources.

### ADV-06 — High — Failure classification is delegated to composition roots and retries have competing owners

**Seam:** provider ports; failure mapping; retry semantics.

**Independently compliant units**

- The Solari adapter retries transient navigation three times internally, then returns a typed `SourceUnavailable` failure with partial captures.
- The worker applies AD-3’s three acquisition retries and its composition root maps that failure to `RUN_FAILED`; another composition root maps the presence of partial Evidence to `INCONCLUSIVE` under addendum H.

**Divergence attack:** an apparent three-attempt bound becomes up to nine provider attempts, and identical provider behavior produces different product states depending on composition-root mapping. AD-6 says addendum H owns outcome mapping, while the Errors convention says categories map “only at composition roots”; this leaves product meaning outside the audit core and permits incompatible retry counts, partial-Evidence handling, and terminal states.

**Required closure:** make one application policy the sole owner of attempt accounting and terminal failure mapping. Define the closed failure taxonomy and required fields (source, stage, retryability, partial-data status, terminal reason), prohibit hidden adapter retries or include them in the same budget, and map each category to retry/Inconclusive/Run Failed before infrastructure composition. Add identical-behavior adapter conformance cases.

### ADV-07 — High — Provider ports are isolated from vendor types but lack behavioral contracts

**Seam:** `EvidenceAcquisition`, `BrowserExecution`, and `ModelGateway` semantics.

**Independently compliant units**

- A browser adapter treats origin policy as a pre-navigation check, returns DOM text plus screenshots, and reports cancellation when the next action is attempted.
- The controlled-web acquisition adapter assumes origin checks cover redirects/subresources/downloads, cancellation interrupts the current call, and returned content includes a stable snapshot identity suitable for Evidence reconciliation.

**Divergence attack:** both use application-owned types, allowed origins, read-only actions, limits, and cancellation checks under AD-4/AD-9. Yet redirects can escape scope, cancellation can continue side effects, a “successful” observation can lack the snapshot/count Evidence required by the gate, and trace ordering can differ. Similar ambiguity exists for model tool-call ordering, token accounting, timeout ownership, and uncertainty signaling.

**Required closure:** attach normative behavioral contracts to every outbound port: pre/postconditions, redirect/download/subresource policy, read-only action vocabulary, cancellation acknowledgment, timeout/limit accounting, stable observation requirements, tool-call ordering, uncertainty/failure semantics, and trace/redaction responsibilities. AD-12’s adapter contract tests should reference one shared conformance suite rather than adapter-specific happy paths.

### ADV-08 — High — Deployment permits incompatible web, worker, schema, and migration versions

**Seam:** deployment; durable jobs; migrations.

**Independently compliant units**

- A new web image applies a reviewed migration, writes a new Procedure/checkpoint representation, and enqueues the current job envelope.
- An old worker image still processing durable jobs uses the previous schema and stage plan. Both are separately runnable processes from the same repository and each is valid for its build.

**Divergence attack:** rolling deployment can break active Runs, old jobs, or review queries even if ADV-04’s message is syntactically readable. No component owns migrations; there is no expand/contract rule, minimum compatible build, startup compatibility check, drain strategy, or rollback constraint. Recording deployed build version aids diagnosis but does not prevent incompatibility.

**Required closure:** define one migration owner and an expand/migrate/contract policy; specify supported web/worker/database compatibility, deployment order, worker draining, durable-job survival across rollback, and startup refusal on incompatible schema/contract versions. Keep Procedure Version immutable, but separately version execution stage plans and persistence schemas.

### ADV-09 — Medium — Actor and authorization time semantics are undefined across asynchronous work

**Seam:** authentication; authorization; audit attribution.

**Independently compliant units**

- Web authorizes `InitiateRun` using the user’s current application role and stores the initiating user ID.
- Worker treats the dispatched Run as a service-principal command and never re-resolves the user’s role; an alternative worker rechecks the user on every resumed stage and fails after role revocation. Both can claim every command is role-authorized and every event has an actor.

**Divergence attack:** a role change between dispatch and execution yields continued execution in one build and terminal failure in another. Audit events may attribute stages to the initiator, the service principal, or the model agent, making “actor/agent” inconsistent. Evidence URLs issued before revocation can also outlive the authorization decision without a defined maximum or revocation behavior.

**Required closure:** define principal kinds (human initiator, service worker, external agent), delegation and attribution fields, which authorization is snapshotted versus re-evaluated, and how revocation affects queued/running Runs. Publish the application permission matrix and short-lived Evidence-access TTL/revocation rule as a shared policy used by commands, queries, and exports.

### ADV-10 — Medium — Recovery covers PostgreSQL but not the Evidence/key trust set

**Seam:** deployment; backup/restore; integrity/export.

**Independently compliant units**

- Operations restores PostgreSQL within the stated RPO/RTO using the daily backup and brings web/worker back online.
- Evidence remains in the live bucket, while the environment-held Ed25519 private/public-key configuration was recreated or lost; alternatively bucket objects from the restored database window no longer match the object set.

**Divergence attack:** the relational system is recovered and all AD-11 database requirements pass, but Runs cannot load/export because Evidence objects or the verification trust bundle are missing/mismatched. AD-12 asks for “restore behavior” without stating the recovery unit, so a database-only test and a full trust-set test both satisfy the words differently.

**Required closure:** define the recoverable unit as PostgreSQL state + Evidence objects + signing verification keys/configuration, with coordinated RPO/RTO and restore ordering. Back up or otherwise guarantee the synthetic PoC bucket and public verification keys; define private signing-key recovery/rotation separately. Test a restored finalized Workpaper end to end, including digest, audit chain, signature verification, and authorized export.

## Coverage matrix

| Requested attack surface | Findings |
| --- | --- |
| Shared data shapes | ADV-04, ADV-05 |
| State ownership | ADV-02 |
| Mutation paths | ADV-02, ADV-09 |
| Transaction/job semantics | ADV-01, ADV-02, ADV-04, ADV-08 |
| Evidence/provenance | ADV-01, ADV-05 |
| Integrity/export | ADV-03, ADV-10 |
| Authentication/authorization | ADV-09 |
| Provider ports | ADV-06, ADV-07 |
| Failure mapping | ADV-06 |
| Deployment | ADV-04, ADV-08, ADV-10 |

## Gate exit criteria

The reviewer gate can pass when the spine or a binding companion supplies:

1. a crash-safe Evidence artifact registration/idempotency protocol;
2. atomic publication boundaries for terminal Run/Result and finalization state;
3. versioned canonical manifest, hash-chain, and signature verification specifications with golden vectors;
4. versioned serialized contracts and structured provenance semantics;
5. application-owned failure/retry policy and provider conformance contracts;
6. rolling-deployment/migration compatibility rules; and
7. asynchronous actor/authorization plus full trust-set recovery rules.

Until then, adapter contract tests cannot be written against a single truth; independently generated implementations can pass local tests and still diverge at composition.
