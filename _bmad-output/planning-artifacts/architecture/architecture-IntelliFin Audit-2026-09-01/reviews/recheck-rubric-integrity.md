# Architecture Reviewer Gate Recheck — Rubric and Integrity

**Artifact rechecked:** `ARCHITECTURE-SPINE.md`  
**Scope:** Closure of the prior critical/high rubric and regulated data-integrity findings; contradiction scan of the amendments  
**Spine edited:** No

## Verdict

**Pass.** All four prior high-severity findings are closed at the declared synthetic, single-tenant PoC boundary. The amendments preserve the existing deterministic-outcome, evidence-quality, human-review, and safe-failure invariants and create no new critical or high contradiction.

## Prior High-Finding Closure

| Prior finding | Status | Recheck evidence |
| --- | --- | --- |
| H-1 — Evidence recovery omitted bucket objects | **Closed** | AD-11 now treats PostgreSQL, sealed Evidence, and retained verification keys as one recovery unit; uses a separately credentialed recovery bucket; and requires restore drills that reconstruct a finalized Run and verify object digests, audit-chain links, and signatures against the stated RPO/RTO. Recovery credentials are unavailable to web/worker. |
| H-2 — No crash-consistent cross-store sealing protocol | **Closed** | AD-5 now defines reservation, stable idempotency key, conditional object creation, stream/hash close, availability/size/digest verification, transactional registration, retry reconciliation, periodic orphan/missing-object reconciliation, and a seal precondition covering every required artifact. AD-12 exercises crash points around upload/register/checkpoint/seal. |
| H-3 — Signing lacked a trust anchor and lifecycle | **Closed for PoC; production explicitly gated** | AD-5 introduces `ManifestSigner`, versioned canonical bytes, algorithm/key ID/public-key fingerprint/signing time, retained historical public keys, test vectors, and an explicit PoC threat model. AD-11 backs up verification keys. Deferred requires isolated KMS/HSM signing plus compromise/revocation procedures before customer data. |
| H-4 — Credentials and outbound data containment lacked enforceable seams | **Closed** | AD-4 adds opaque `CredentialRef`, an inward-owned `CredentialProvider`, just-in-time Source/environment-scoped capability delivery, secret-free audit events, and a BrowserExecution conformance contract enforced by request interception. AD-9 adds Procedure-versioned model data policy, minimization/redaction, and provider retention/training/residency acceptance. AD-10 adds centralized allowlist-based telemetry sanitization and negative tests. |

## Remaining Critical/High Findings

**None.**

## Residual Non-Blocking Cautions

### Medium — Finalization/signing ordering needs a precise implementation fixture

AD-5 says finalization obtains a signature before the transaction that stores the manifest, final audit event/head, and `FINALIZED` state. Because the manifest and audit-chain bytes are canonical and aggregate events are transactionally sequenced, the implementation must either compute the candidate final event/head under the same locked transaction or reject and retry when the expected aggregate revision/head changes before commit. Add a concurrency fixture proving that no signature can be committed over a stale or non-final chain head. This is an implementation clarification, not a contradiction in the adopted model.

### Medium — Recovery independence is credential-separated, not provider-failure-independent

The recovery copy is shown as another Railway bucket. This closes accidental/application-level deletion and ordinary restore requirements, but not a Railway account/project/provider-wide loss unless the recovery target is isolated at the appropriate administrative boundary. The PoC is synthetic and the spine does not claim that threat coverage, so this is acceptable now. Production storage selection should explicitly decide account/provider/region independence alongside residency and RPO/RTO.

## Recheck Conclusion

The amended spine is suitable for build handoff at its stated PoC scope. Production/customer-data use remains correctly blocked on new adopted decisions for storage, tenant isolation, residency, signing-key custody, retention/WORM controls, and recovery topology.
