# Epic 1 Context: Sign in, roles, and the registered synthetic environment

<!-- Generated from planning artifacts. Regenerate with compile-epic-context if planning docs change. -->

## Goal

Establish the trusted foundation for every later audit workflow: a deployed web-and-worker monorepo, authenticated access with application-owned roles, tamper-evident product audit events, sanitized operational telemetry, a consistent Ledger Signal shell, administrator-managed users and read-only Source registrations, and a wholly synthetic Northstar environment with golden test populations. The result is a usable PoC boundary in which only authorized people can act and the agent can reach only explicitly registered, read-only systems.

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

- Support Auditor, Audit Manager, and PoC Administrator roles. Better Auth establishes identity and session only; authorization comes from application-owned role data. Unauthenticated requests receive no protected Procedure, Run, Evidence, Exception, live/replay, or administration data, and out-of-role actions are denied and audited. Role changes apply on the next request without silently canceling existing Runs.
- PoC Administrators manage users, Target System registrations, credential references, Population Source bindings, and diagnostics, but cannot author or approve Procedures or alter Evidence, evaluations, Results, or reviews. Auditor and Audit Manager capabilities remain separated, including the prohibition on approving a Procedure Version one authored.
- Every registered Target System is web, desktop, API, or versioned file and records an allowlisted origin or application identity, opaque credential reference, permitted read actions, expected attribute labels or locator patterns, and optional secondary key. Write-capable credentials are rejected. Secret values remain outside application data and never enter the web process.
- Population Source bindings record location, schema, an independently supplied declared-count mechanism, and sensitive-field masking designations. Missing count declarations must remain visibly invalid for Procedure submission; manual-upload bindings support only a `once` Schedule.
- Product audit events cover security, configuration, lifecycle, execution, Evidence access, review, notification, export, and failure activity with attributable actor, event type, UTC time, source, outcome, session identifier, and correlation identifier. Mutation must be detectable.
- Operational logs, traces, and errors contain only allowlisted scalar fields. Credentials, Evidence, tool/provider payloads, snapshots, signed URLs, and AI inputs/outputs are forbidden; automated negative tests must prove credential-shaped data is removed.
- All fixtures use synthetic data and visibly identify the synthetic environment. Target Systems must independently reject writes from audit credentials. Golden datasets include compliant, true-Exception, boundary, missing/ambiguous/stale/uncapturable, injection, wrong-record, and malformed-key cases, with expected outcomes stored separately from executable rules.
- Web and worker deploy separately from one repository. PostgreSQL 18 is verified at bootstrap; migrations run only in the release pipeline. Pull requests must pass type checking, boundary checks, unit tests, and migrations against PostgreSQL 18. Core web workflows must remain keyboard accessible and pass automated WCAG 2.1 AA checks.

## Technical Decisions

- Enforce inward dependencies: `domain` imports no outward layer; `application` imports only `domain`; `infrastructure` implements inward-owned ports; web and worker are composition roots. Framework, persistence, queue, telemetry, identity-provider, and vendor SDK types cannot enter business/application code.
- PostgreSQL is the transactional system of record. State changes and their append-only events commit atomically through an application-owned Unit of Work; direct database access stays in infrastructure adapters and migration tooling.
- Use one product event store. Events chain per aggregate, with system-wide events falling back to `platform`; a locked aggregate-head row allocates gapless, commit-ordered sequences. Serialize event bytes as UTF-8 RFC 8785 canonical JSON and link each event to its predecessor with SHA-256. Keep checked-in golden and tampered vectors produced and verified independently.
- Keep product audit evidence separate from operational telemetry while propagating one correlation chain. Use a single allowlist sanitizer, static Pino redaction, Sentry with default PII and AI payload capture disabled, and sanitized breadcrumbs/spans. Workers write connectivity and health diagnostics; web only reads them.
- The `registrations` domain module alone computes the SHA-256 registration digest over canonical JSON containing exactly the system kind, origin/application identity, credential reference, permitted actions, attribute label patterns, and secondary key. A referenced registration change publishes an event in the same Unit of Work so the procedures module can later mint a platform-authored draft.
- Runtime configuration and secrets are validated only at process composition roots. Releases preserve a rolling schema/contract compatibility window, and each process refuses unsupported schema ranges.
- Use UUIDv7 identifiers, UTC `timestamptz` in storage, ISO 8601 UTC at boundaries, and string identifiers that preserve leading zeros.

## UX & Interaction Patterns

- Use the Ledger Signal shell: navy sidebar, top bar, notification bell, breadcrumbs on detail routes, and an EnvironmentRibbon stating that the PoC uses read-only synthetic systems and does not issue assurance conclusions. Administration appears only for PoC Administrators.
- Reuse the design-system Sidebar, Button, StatusBadge, Banner, EnvironmentRibbon, EmptyState, Tabs, and Icon components. Teal is the sole interaction color, the `#0F766E` focus ring is never suppressed, and status always combines text and an icon rather than relying on color.
- Preserve distinct status families. Human-attention states use the local `info-solid` badge with a user icon; Completed is neutral. Tables require scoped headers, captions, and a focusable first-cell link with no row click handlers. Disabled actions retain their position and expose an accessible reason. Administration mutations use focus-trapping routine confirmation dialogs.
- The interface is desktop-first, responsive below 1024px, factual and restrained, sentence case, and UTC throughout. Empty states must never imply that an empty collection is a passed control.

## Cross-Story Dependencies

- The monorepo, CI, deployment, and database baseline gate all other work. The audit-chain implementation becomes the unchanged basis for later Run Timelines.
- Identity and role enforcement governs shell visibility and every administration capability. User, Target System, and Population Source administration depend on it.
- Registration digests and change events feed Procedure Version freezing and platform-authored drafts in Epic 2. Population count declarations feed later Gate reconciliation; sensitive-field designations feed masking and audited unmasking.
- The synthetic Northstar systems and independently versioned golden expectations underpin later end-to-end tests, Regression Runs, and demonstrations.
