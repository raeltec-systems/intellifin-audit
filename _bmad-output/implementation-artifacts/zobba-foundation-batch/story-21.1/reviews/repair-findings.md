# Story 21.1 consolidated independent review repairs

All three same-capability context-free BMAD review layers returned before triage.
Baseline e28a4ccb551cb8e37131b64b4cdb20bc479c270e. Pre-repair full gates passed
166 Rust /98 web /89 Chromium; this does not close the findings below.
Root classifies these as ordinary implementation/verification patches under the
existing captured intent, not new architecture or a product-intent/spec gap.
No frozen-spec change or review-loop re-derivation is needed.

| ID | Severity/category | Source and required repair |
| --- | --- | --- |
| R01 | high / patch | `infrastructure/src/evidence/s3.rs`: namespace normalizes endpoints that SDK addresses differently, including omitted vs explicit regional endpoint in virtual-hosted mode and trailing slash. Bind all effective destination inputs without collapsing distinct SDK requests; conservative rejection of changed config is acceptable. Prove actual SDK request/signed-URL addresses for default/explicit, path/virtual-hosted and slash variants. |
| R02 | high / patch | `infrastructure/src/evidence/mod.rs`, new migration6/catalogue: registry/recovery SQL default collation disagrees with browser ASCII/code-unit ordering. Use explicit byte ordering in cursor predicates, order and supporting indexes; verify mixed-case IDs under a non-C default collation. Keep published prefixes1–5 unchanged. |
| R03 | high / patch | `web/src/evidence.ts`: valid escaped source assertions exceed the16KiB draft reader while save accepts them. Choose a bounded envelope covering every valid serialized request plus draft fields; validate consistently on save/recover. Prove maximum quote/backslash cases survive reload with the exact key. |
| R04 | medium / patch | `EvidenceWorkspace.tsx`, evidence client: validate complete filename/source payload before persisting/freezing it. Multibyte inputs may fit HTML maxLength but exceed UTF8 byte limits. Keep invalid fields editable, issue useful validation feedback and send/persist no reservation until valid. |
| R05 | medium / patch | Same UI: local >10MiB validation must show size correction, not storage outage/uncertain reservation. Prove no network/reservation or persisted retry. |
| R06 | medium / patch | Metadata/API/client/UI capacity: distinguish100-incomplete-reservation saturation from two-I/O-slot transient saturation. Do not send Retry-After1 or say retry shortly for durable quota. Explain finishing an existing reservation frees a slot. Keep immutable custody; do not invent abandonment/deletion lifecycle in this story. Document the finite quota and lack of abandonment/expiry honestly. |
| R07 | medium / patch | Evidence paging: preserve displayed registry/recovery cursor across routine same-session revalidation; provide previous/first navigation with bounded retained state. Explicit acquisition may still refresh canonical first page. Browser proof must use later page, revalidate, retain that page and navigate back. |
| R08 | medium / patch | Acquisition UI: once verified registration receipt is accepted, subsequent list-refresh failure must not recast it as uncertain acquisition or tell user to retry a cleared draft. Preserve receipt/provenance independently, distinguish refresh failure; uncertain authority still withdraws private projections until reverified. Add real browser regression. |
| R09 | medium / patch | Explicit evidence selection should focus/scroll to inspection heading after a long registry, and have a reliable return target. Preserve conversation/composer and avoid stealing focus during routine refresh. Test keyboard/narrow/later-page behavior. |
| R10 | medium / patch | Recovered pending reservation must show its immutable expected digest/size/source assertions read-only before finishing, with honest unverified/unknown labels. Do not require uploading just to see what will be attributed. Test differing same-name source assertions. |
| R11 | low / patch | API/browser filename sanitization truncates away valid extensions and uses inconsistent limits. Preserve a bounded sanitized extension while shortening basename; align outputs and cover long names, Unicode, dots/path/header characters and empty fallback. |
| R12 | medium / patch | API/OpenAPI generated binary uploads/downloads currently describe integer arrays. Declare actual raw binary request/response schemas and regenerate; add meaningful contract regression. |
| R13 | medium / patch | Production router composition is bypassed by all injected evidence tests. Add isolated synthetic-config production-constructor/process proof: valid ZOBBA_EVIDENCE_BUCKET enables storage_configured and accepts scoped reservation without live S3 access; missing/invalid configuration stays honestly unavailable. Never enable insecure production transport or use paid endpoints. |
| R14 | high / patch | Existing120s test excludes outer authenticated router and HTTP client10s means integrated test cannot catch outer15s regression. Exercise complete middleware composition: I/O retains >15s window, times out at120s and releases capacity, ordinary metadata stays15s. Use actual composed boundary with controlled time if practical, no weakened authority. |
| R15 | medium / patch | Add restricted-PG100-incomplete boundary proof:101st distinct key refused with unchanged rows, exact replay and changed-payload refusal still correct, completing an original frees one slot and other actor/scope is not consumed. |
| R16 | medium / patch | Strengthen existing browser provenance proof: rendered measured digest/size and verified storage version equal registered values, storage version differs from user assertion, unknown/source fields are attributed correctly. Current label-only assertions miss substituted rendered values. |

Duplicate reports were consolidated only for the same claim/action. The broader
request to add a new abandonment or administrative custody lifecycle is outside
this fixed direct-upload contract; R06 addresses the real misleading behavior
without claiming such a lifecycle. No unrelated pre-existing deferral is recorded.

All source/testing changes remain with original implementation lead and disjoint
children. Root owns story status, independent rechecks, evidence and checkpoint.
Keep explicit guarded *_test targets, separate migration/runtime roles and owned
9444. Preserve development and9443. Do not commit/push, merge/deploy or spend.
After focused repairs pass, freeze and provide exact change/test evidence for
independent rechecks. Re-run required combined gates; preserve pre-repair logs.
