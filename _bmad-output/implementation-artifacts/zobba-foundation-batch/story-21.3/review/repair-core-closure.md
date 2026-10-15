# Independent repair closure: P1, P6, P10 and P12

Reviewer: `story_21_3_repair_core_review`, fresh context, same capability as root. Read-only review; no builds, tests, database queries or services. No findings in the assigned subset. This record preserves the review conclusions and evidence pointers; it is not a final-gate claim.

- **P1 closed.** `zobba/crates/domain/src/permissions.rs:759` completes structural/source checks before accepted/current account restrictions, then starts budgeted projection. The account check proves refusal only. `permissions/capability_tests.rs:864` covers explicit account/environment/resource restrictions with zero, previously consumed and full budgets, including accepted/current attribution; line963 preserves malformed-authority precedence. Both tests passed in `repair-1/domain-application-1.log` (lines51/64).
- **P6 closed.** `zobba/migrations/0009_skills.sql:51` creates `(organisation_id, version_id)` matching the restriction count predicate at181. `schema-v9.catalog:1067` records the valid index. The reviewer independently compared all16 published migration/catalogue prefix files with baseline643ed095314d42f576106effd287703824003c73: byte-identical. Schema9 matches raw capture/catalog proof:1,527rows,195,050bytes,3CRs. All4 schema-handoff hashes match.
- **P10 closed.** SQL enforces command bytes at161 and receipt bytes at243 before insertion; exact replay precedes both and status changes bypass install capacity. `infrastructure/tests/skills.rs:1248` and1628 create real repository records, measure PostgreSQL bytes, prove atomic refusal below128rows, unchanged revisions/history, absent refused records, repeated refusal, exact replay and working disable/recall. History remains readable with fresh restricted eligibility. Actual observations:15versions/1,979,880command bytes;100selections/1,046,092receipt bytes. Composed contract passed (`skills-infra-1.log:6`, exit0).
- **P12 closed.** `domain/src/skills/tests.rs:177` declares all7 literal purpose/action tuples plus unsupported analysis independently, checking both mapping and ToolNeed conversion. `infrastructure/tests/skills.rs:1461` installs literal test_read_v1/test_write_v1/analysis_v1 against independently constructed read-only authority: qualified read discovery/selection succeeds, write refuses, analysis unavailable; unqualified read unavailable while write remains forbidden. Unconditionally included in passed composed contract at387.

Proof limits: execution claims rely on supplied receipts. Qualification covers explicit loopback fixture configuration, not external tool execution. Index existence/prefix integrity is established without a performance benchmark. Other repairs and final gates are outside this closure.

## Reviewed source SHA-256

Paths relative to `zobba/`:

| Path | SHA-256 |
|---|---|
| crates/domain/src/permissions.rs | fc7c0602973e4520dfd18bce52256ba680ac06dcea3246ff2b1024dd25007217 |
| crates/domain/src/permissions/capability_tests.rs | cea525c48348e853e7752c4fbe98d8264430b845819769910cf0cf934fd43af1 |
| crates/domain/src/skills.rs | c615427240fb5f26a9ea2d23c06265c99a987b80e0af0161b0f8b61ada8f8f8e |
| crates/domain/src/skills/tests.rs | 299d17a1fc5206429f07fded8decbb6e9afa2fa6b60071cf6df800aea7896a1b |
| crates/infrastructure/src/skills.rs | 4d78cf95db8db4feae8be629e776ab36436cf01371f8996dc80b90589debe9ae |
| crates/infrastructure/tests/skills.rs | a2d0af5a3d48a554c868fe0d3b1d788725e5c0f636378537691e35d8a7a2e261 |
| migrations/0009_skills.sql | c87f0651c52559d6e44d2679580ef3a4cf982949136e5ab1c278b26c4f7366c9 |
| crates/infrastructure/src/schema-v9.catalog | b16826d1e5d024f3c30acbe2ef14ea876ea949d3d61552f78f211232e52a9212 |
