# Epic 1 Context: Sign in, roles, and the registered synthetic environment

<!-- Compiled from planning artifacts. Edit freely. Regenerate with compile-epic-context if planning docs change. -->

## Goal

The PoC Administrator registers the systems the agent may touch and the users who may work; Auditors and Audit Managers sign in and see only what their role allows. This epic delivers the runnable monorepo, a tamper-evident audit trail, application-owned roles, the shell UI with its status vocabulary, an Administration surface for users, Target System registrations, and Population Source bindings, and a synthetic Northstar Financial Group environment seeded with golden populations. Every later epic builds on it and none is required for it to work.

## Stories

- Story 1.1: Bootstrap the monorepo and deploy web and worker
- Story 1.2: Record tamper-evident audit events with sanitized telemetry
- Story 1.3: Sign in and act only within an application-owned role
- Story 1.4: Application shell and Ledger Signal tokens
- Story 1.5: Manage users and roles
- Story 1.6: Register a Target System with a read-only credential
- Story 1.7: Register a Population Source binding
- Story 1.8: Synthetic Northstar systems seeded with golden populations

## Requirements & Constraints

- Three roles exist: Auditor (author, submit, run, supervise, answer Escalations, investigate Exceptions, confirm Agent-Judged evaluations, submit Results), Audit Manager (all Auditor actions plus approve/reject Procedure Versions and approve/reject/finalize Results — never a version or Result path they authored), and PoC Administrator (users, Target System registrations, credential references, Population Source bindings — cannot author or approve Procedures, and cannot alter Evidence, evaluations, or finalized Results under any path).
- Identity/session comes from Better Auth only; role is resolved from the application's own identity data, never the identity provider. Unauthenticated requests reach no Procedure, Run, Evidence, Exception, Live View, Replay, or administration data — every route family needs an automated test proving this.
- Every command/query outside a role's allowance is refused with the exact stated reason (see the action-gating table below) and the refusal is audited; a revoked role blocks new actions on the next request without abruptly ending an existing session.
- Adapters and the Audit Agent may invoke only allowlisted read operations; a credential whose capability check reports write access cannot be registered, and the block message is exactly "Audit credentials must be read-only."
- A Target System registration stores kind (web, desktop, API, or versioned file), allowed origins or application identity, an opaque credential reference, permitted read actions, per-attribute expected field label or locator pattern, and an optional secondary matching key. Any change to these fields on a registration already referenced by a Procedure Version creates a platform-authored draft requiring re-approval, with the confirmation warning "This change creates a platform-authored draft for {n} Procedures and requires approval."
- A Population Source binding stores location, declared schema, and a declared-count mechanism (signed cover sheet or count endpoint); a binding with no declared-count mechanism saves with a visible warning that Procedures cannot submit against it. A manual-upload binding is upload-only and valid only for a `once` Schedule. Bindings also carry which fields are designated sensitive for masking in list views.
- Every security, configuration, authoring/approval, Schedule, Run, Evidence, Escalation, notification, evaluation, review, export, error, and model/prompt-change event is recorded with actor (human, Schedule, Audit Agent, Adapter, or platform), event type, UTC time, source, outcome, session identifier, and correlation identifier; the record is append-only and mutation is detectable.
- Telemetry (logs, traces, error reporting) is strictly separate from product audit evidence: only allowlisted scalar fields pass, PII/AI-payload capture is disabled, and a negative test proves no credential-shaped value ever reaches a log line or error event.
- Web and worker deploy as separate Railway containers from one repository; migrations run only through the release pipeline, never at process startup, and each process refuses to start against an unsupported schema range.
- CI must pass type checking, dependency-boundary checks (below), unit tests, and migrations against a real PostgreSQL 18 service on every pull request.
- Every fixture and golden dataset is synthetic only — no production or personal data — and this is asserted by an automated test on every dataset.
- Success criteria this epic underwrites: the read-only boundary is provably enforced (no write ever reaches a Target System from an audit credential), and the golden Northstar populations exist so every later Procedure has something real to inspect.

## Technical Decisions

- Strict inward dependency direction: `domain` imports nothing outward, `application` imports only `domain`, `infrastructure` implements ports `application`/`domain` own, and `apps/web`/`apps/worker` are the only composition roots. Business/application code must never import Drizzle, pg-boss, the Workspace Provider SDK, the AI SDK, Resend, S3, Railway, Better Auth, Next.js, Pino, or Sentry types — enforced in CI, not by convention.
- A registration digest is SHA-256 over RFC 8785 canonical JSON of exactly `{kind, allowed_origins | application_identity, credential_ref, permitted_actions, attribute_label_patterns, secondary_key}`, computed by one domain function owned by the `registrations` module (not recomputed elsewhere).
- One audit event store: system-wide events (auth, registration, Procedure Version, Schedule, notification, export) chain on their own aggregate or on a shared `platform` aggregate, using the same hash-chain mechanism a Run's Timeline will reuse later. Events are UTF-8 RFC 8785 canonical JSON, each linked to its predecessor by SHA-256, with a transactionally allocated, gapless, commit-ordered sequence taken under that aggregate's head-row lock.
- Operational telemetry and product audit evidence are architecturally distinct pipelines with one shared allowlist-based sanitizer; the web process never itself probes Target Systems or providers — connectivity/health rows are worker-written and web-read only.
- Deployment: web and worker are separate containers from one repo; Railway hosts PostgreSQL 18 (verify `server_version` at bootstrap) and object storage; secrets and config are read only inside each process's composition root via a validated schema. Releases follow expand → migrate/backfill → deploy → drain → contract; a schema/contract compatibility window must be honored across a rolling deploy.
- Tests defend the domain/adapter seams: golden datasets, expected terminal outcomes, and confirmation scripts are versioned data (not embedded in rule implementations) and are mirrored into `tests/fixtures`; Playwright covers keyboard access and automated WCAG 2.1 AA checks as part of CI.
- Stack seed for the monorepo: Node.js 24 LTS, TypeScript 7, Next.js 16, React 19, pnpm 11, Drizzle, postgres.js, pg-boss, Better Auth, Vercel AI SDK (Anthropic + OpenAI providers), Zod, Pino, Sentry, Vitest, Playwright. Workspace layout: `apps/web`, `apps/worker`, `packages/domain`, `packages/application`, `packages/infrastructure`, `tests/fixtures`, `tests/integration`, `tests/e2e`.

## UX & Interaction Patterns

- Shell: sidebar (Overview, Procedures, Runs, Review, and Administration for PoC Administrators only), top bar with a notification bell, and an EnvironmentRibbon; breadcrumbs on every detail route. Reuse the Sidebar, Button, StatusBadge, Banner, EnvironmentRibbon, EmptyState, Tabs, and Icon components from the inherited Ledger Signal design system rather than rebuilding them; StatusBadge is extended locally with one new `info-solid` family only.
- Every color, type role, radius, and spacing value is a CSS variable at the documented value; teal is the only interactive color; the focus ring is `#0F766E` and is never suppressed.
- StatusBadge families: neutral, neutral-solid, info, success, warning, danger, danger-outline, plus the local `info-solid` ("needs a human" — Awaiting Auditor, Pending Confirmation, Agent-Judged pending, Work Item Awaiting, each with the user icon). No status is ever conveyed by color alone. Completed renders neutral.
- Data tables use `<th scope>`, a caption, and a focusable link in the first cell — never row-level click handlers. Empty states are a headline plus one sentence naming what would appear, and must never imply a passed control or offer a mutating call to action. A disabled action keeps its position and states its reason both in an "Unavailable actions" panel and as its accessible description, never tooltip-only. Confirmation dialogs trap and restore focus, close on Escape, and come in three weights — routine, routine-with-rationale, and finalization (destructive-only) — use the routine weight for admin mutations in this epic.
- Layout collapses per the documented breakpoints below 1024px; at ≥1280px the sidebar is visible with two-column detail layouts.
- Exact per-role denial strings to reuse verbatim: "PoC Administrator cannot author Procedures or start Runs.", "PoC Administrator cannot alter evaluations, Results, or reviews.", "Only an Audit Manager can approve a Procedure Version.", "You cannot approve a version you authored.", "Only an Audit Manager can approve a submitted Result." PoC Administrator can only manage users, registrations, bindings, and diagnostics.

## Cross-Story Dependencies

- Story 1.1 (monorepo, CI, deploy) gates every other story in this epic and every later epic — nothing else can land until it exists.
- Story 1.2's audit-chain mechanism (hash-linked events, per-aggregate sequence) is the same mechanism a Run's Execution Timeline reuses unchanged in later epics — get the chain semantics right here rather than special-casing it later.
- Story 1.3 (roles) gates the visibility rules Story 1.4 (shell), 1.5 (user management), 1.6 (Target System registration), and 1.7 (Population Source binding) all depend on.
- Story 1.6's registration digest and change-triggers-a-platform-authored-draft behavior is consumed by Epic 2 (Procedure authoring/approval) — a Procedure Version freezes against exactly this digest.
- Story 1.7's declared-count mechanism and sensitive-field masking are consumed by Epic 2's Population Source binding step and by Epic 3's Evidence Quality Gate reconciliation.
- Story 1.8 (synthetic Northstar systems + golden populations) is the fixture foundation every later epic's acceptance testing, Regression Runs, and demo runs depend on; it has no epic-1-internal dependents but blocks realistic testing everywhere else.
