# Epic 20 Context: Open an engagement and keep accepted work safe

<!-- Compiled from planning artifacts. Edit freely. Regenerate with compile-epic-context if planning docs change. -->

## Goal

Establish Zobba’s scoped engagement conversation, distinct Tasks, durable commands and current Permissions under the accepted revision-3 Rust/Pair baseline. This context covers the whole epic; the authorised implementation batch is Stories 20.1–20.4. Foundation completion does not establish a complete audit agent or customer launch readiness.

## Stories

- Story 20.1: Start the new application from one reproducible workspace
- Story 20.2: Sign in to an explicitly scoped engagement
- Story 20.3: Accept task commands once and recover them after restart
- Story 20.4: Keep one engagement conversation with attributed task cards
- Story 20.5: Apply standing Permissions to exact recorded operations
- Story 20.6: Administer membership without granting audit authority
- Story 20.7: Deploy a recoverable qualification environment

## Requirements & Constraints

- Scope every Task to one engagement and current organisation/client membership. Roles are Auditor, Audit manager and Admin; Admin alone grants neither evidence access nor audit sign-off. Revocation ends current authority while retaining authorship. The 1 October 2026 owner-approved safeguard requires each organisation to retain an active, non-expiring Admin membership linked to an active identity; additional temporary Admins remain allowed. Membership and identity lifecycle changes must enforce it atomically, including concurrent changes.
- Persist messages; bind commands to author, audience, engagement and exact Task/decision. Repeated keys with identical meaning return the original receipt; changed meaning conflicts. Discussion or another objective does not cancel existing work. Received differs from Applied.
- Guidance and Pause/Stop admission remain available independently of busy execution or slow streams. Controls name their scope and cover delegated work. Pause retains the objective; Stop ends its current work cycle. Explicit continuation creates a new cycle. Report cessation as pending until quiescence or unresolved effects are known.
- Standing Permissions intersect organisation limits, engagement, member, account, resource, purpose and bounded delegation. Distinguish Live inspection, Test workflows and Audit coordination. In-scope work proceeds without another ceremony; uncovered actions require a decision bound to exact material, destination, account, purpose, version and expiry.
- Test permitted access and refusal, pooled scope, guessed IDs, changed roles, lost/duplicate acknowledgements, stale execution and reconnects. Bound work/subscriptions/output. Keep audit records separate from telemetry; exclude credentials, evidence, raw prompts/results and capability secrets from logs.

## Technical Decisions

- Build one modular Rust authority using Axum, Tokio, Serde and SQLx, with separate API/control and worker processes. Use React/TypeScript/Vite and an owned OpenAPI client seam. Domain rules depend inward; delivery, SQL and vendor types stay outside domain meaning. Pin supported toolchain/dependency versions and check boundaries in CI.
- Use fresh PostgreSQL 18 schema and only tables needed by the owning story. Run explicit development/release migrations, never startup migrations; refuse unsupported or unmigrated schemas.
- Commit command acceptance, state changes, durable events and wakeups together in one scoped database transaction. Leased work tables own durability; notifications only accelerate polling. Keep Task/work-cycle identity, command idempotency, owner/execution epochs and intent revision distinct. Durable schemas and interfaces have explicit versions.
- A valid owner epoch does not validate an obsolete instruction. Bind proposals to their producing intent revision; reject, rebase or revalidate contradictory stale proposals and unconsumed claims before dispatch. A stale worker may supply narrowly authorised receipts but cannot restart work.
- Keep logical operations, attempts, canonical requests, one-use dispatch claims and observed outcomes separate. Claim consumption before remote I/O is the possible-dispatch cutoff. Stop/revocation rejects unconsumed claims; consumed claims remain potentially dispatched and require reconciliation before unsafe retry. Do not promise remote exactly-once execution.
- Use Cognito OIDC with Rust server sessions for the deployed identity boundary. Validate issuer, audience, state, nonce and PKCE; derive access from current application membership. Enforce application scope plus forced RLS, non-owner database roles, scoped references and transaction-local context reset. A local test IdP is repeatable test infrastructure, never a production bypass or live qualification claim.
- Later qualification uses Terraform, two-zone ECS/Fargate, RDS Multi-AZ/PITR, private networking/IAM, S3/KMS/Secrets and Cognito. Restore in isolation; reconcile possible effects beyond the restored database horizon before resuming. Qualification is not production launch.
- Selectively reuse legacy fixtures/assets/behaviours with source revision, licence/notices and adapted validation. No compiler, Node domain bridge or old-schema compatibility requirement. Preserve history; no wholesale legacy deletion in this foundation.

## UX & Interaction Patterns

- Use the active Zobba Pair identity, existing tokens/assets and readable conversation beside work. Keep the engagement and selected Task visible. Cards show objective, owner, actual state and an opening action; activity is not a fabricated completion percentage.
- Keep the composer usable while work runs. Start with explicit Task targeting; semantic interpretation arrives later. Opening another Task does not broaden its audience or redirect commands implicitly. Never display fake agent answers or a simulated live computer as delivered capability.
- Distinguish local unsent input, durable receipt, applied guidance and confirmed cessation. Reconnect through a durable cursor with bounded replay, gap handling and resynchronisation. Show failed, missing or stale state honestly.
- Preserve inspection and focus when events arrive. At narrow widths switch between usable views rather than squeezing both panes. Provide labelled keyboard controls, focus return, accessible status announcements and non-colour state cues; target WCAG 2.2 AA.

## Cross-Story Dependencies

- The authorised first batch is sequential: 20.1 → 20.2 → 20.3 → 20.4. It uses synthetic users and a bounded inert executor; models, external tool effects, audit conclusions and real desktop work remain later capabilities.
- Story 20.5 follows 20.3; 20.6 requires 20.2 and 20.5; 20.7 requires 20.1 and 20.5. These remain outside the current four-story batch.
- Authority and operations unlock evidence and early computer qualification. Later full-Task acceptance also requires methods/skills/knowledge, real private computer access, isolated analysis, typed evaluation and human review; none is delivered by this batch.
