# Story 20.1 review record

30 September 2026. Reviews used the accepted story specification and the full
tracked/untracked change from `a4041ee2b5bb4c10410ee3fa9bb16482a5b6b57d`.
No files were staged to construct the review diff.

The independent second agent reproduced the documented least-privileged
migrator/runtime setup in a separate disposable database. Formatting, strict
Clippy, Rust tests, generated interface/type checks, web tests/build, boundary
fixtures and actual process smoke passed. Its hardcoded smoke-role finding was
fixed and independently retested. Root inspected actual desktop/narrow renders
and keyboard refresh, with no browser errors or overflow. Hosted CI is unrun.

Three additional fresh-context BMAD layers ran in parallel: blind review,
edge-case review and verification-gap review. Their concrete findings below are
patches within the existing bootstrap, isolation and truthful-health contract;
none changes approved product intent. The independent reviewer agreed with the
materiality and prepared targeted post-patch checks.

| Finding | Consequence/severity | Route and required repair |
|---|---|---|
| Public-first function lookup before foreign-schema refusal | Foreign code can run with migrator authority; high | Patch: catalog-first lookup and qualified preflight references; sentinel test |
| Candidate metadata is read before relation shape is fully established | A foreign view can execute during refusal; high | Patch: validate permanent table shape before reading contents; no-invocation fixture |
| Column-level metadata writes evade table checks | Writable runtime admitted; high | Patch: inspect column privileges and prove refusal |
| Reachable SET ROLE authority is incompletely checked | NOINHERIT is insufficient protection; high | Patch: inspect effective reachable role authority |
| Restricted current role can mask elevated session identity | Runtime retains recoverable privilege; high | Patch: refuse mismatched authenticated/effective identity |
| Replication and powerful predefined roles are omitted | Runtime can exceed database-only read authority; high | Patch: refuse concrete prohibited capabilities |
| Migration target validation is weaker than runtime validation | CLI reports success for unusable/unsafe role; medium | Patch: share effective-role validation before mutation and after grants |
| Interruption can leave an unrecoverable empty SQLx ledger | Fresh setup cannot safely retry; medium | Patch: atomic bootstrap or narrowly validated empty-ledger recovery |
| Foreign standalone types evade inventory | Nonempty foreign schema admitted; medium | Patch: cover composite/range/shell types |
| Persistence, defaults and rewrite rules are incompletely checked | Nondurable or altered metadata admitted; high | Patch: validate these concrete schema properties |
| Foreign metadata can allocate unbounded result contents | Refusal can exhaust memory; medium | Patch: bounded rows and server-side value comparisons |
| Migration lacks a whole-session network deadline | CLI can hang after a connected socket blackholes; medium | Patch: bounded migration session and released connection/lock |
| Direct Rust tests lack development-database exclusion | Destructive fixture can affect configured development data; high | Patch: guard every destructive test entrypoint |
| URL overrides/aliases evade identity or proxy checks | Wrong database may reset, or loss test misses its target; high | Patch: validate effective identity and reject unsupported overrides |
| Raw/dynamic Rust includes evade boundary checks | External source can enter the new build; medium | Patch: resolve or reject concrete unsupported include forms |
| TypeScript/Vite aliases evade boundary checks | Historical source can enter the web bundle; medium | Patch: validate resolved/configured paths |
| No-mutation snapshots cover names only | Data/definition/privilege changes are not detected; medium | Patch: strengthen the snapshot |
| Database-loss smoke does not prove recovery | Existing process reconnection remains unverified; medium | Patch: restore connectivity and check the same processes |
| Browser health consumption/retry lacks a retained regression | Valid unavailable response can render Ready while checks pass; medium | Patch: owned automated browser regression through the proxy |
| Elevated nonowner rejection lacks direct fixtures | Role-check regression can evade owner-only tests; medium | Patch: isolated elevated-role regression fixtures |
| Migration serialization has only sequential proof | Lock regression can permit concurrent bootstrap; medium | Patch: controlled lock-contention fixture |

## Acceptance

Accepted under the owner's batch authorization after all patches and independent
retest passed. No material review finding remains unresolved.

Final gates: formatting, strict Clippy, locked Rust build/tests (seven tests,
including the expanded real PostgreSQL contract), frozen web install, generated
contract/type checks, two web tests, production web build, 44 script regressions,
boundaries, process smoke and one owned browser regression. The intentional
Unavailable-label mutation failed the browser assertion and was restored.

The independent second agent reproduced both alias escapes and verified their
refusal, passed the restricted-migrator database contract, and exercised the
actual direct-test development guard with a retained sentinel. Its API and worker
recovered readiness in the same processes after proxy restoration. Bootstrap
interruption now rolls back ledger, schema and grants atomically; it does not
adopt foreign partial ledgers. Root inspected the final infrastructure and browser
regression and reconciled all findings.

Limits: PostgreSQL 18.4 local proof; alternate live PostgreSQL versions, hosted CI,
remote TLS and deployment remain unqualified. Version refusal has unit coverage
and inspected runtime wiring. Story 20.2 must implement validated migration-prefix
upgrades before adding its schema. No paid cloud resources were used.

The complete staged diff exposed one upstream trailing space in the verbatim OFL
notice (line22). Its source bytes remain preserved; all other changed files pass
`git diff --check` against the baseline with that single notice excluded.
