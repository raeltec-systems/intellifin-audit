---
title: 'Classify every table and write the policy inventory'
type: 'feature'
created: '2026-09-25'
status: 'in-review'
baseline_commit: '429e08cf703fee6c5320f17b5983948709fd5bdf'
review_loop_iteration: 1
context:
  - '{project-root}/_bmad-output/implementation-artifacts/epic-11-context.md'
  - '{project-root}/_bmad-output/planning-artifacts/course-correction-2026-09-24/proposal-3a-architecture-foundations.md'
---

<frozen-after-approval reason="human-owned intent — do not modify unless human renegotiates">

## Intent

**Problem:** Epic 11 must scope every table before any row-level-security policy exists, but nothing records which scope each of the database's 76 relations belongs to, or which principal may run which command on a protected table. A migration can add a table today and nobody has to decide its scope.

**Approach:** Author `docs/contracts/tenancy-v1.md` with the five classes, one classification row per relation in every non-system schema, the three principal kinds with a closed list of maintenance principals, and a policy inventory row for every protected table derived from the code's real access paths. Hold it with an unclassified-table test against the migrated database and an inventory test over the document.

## Boundaries & Constraints

**Always:** use the exact class names `tenant-owned`, `user-owned`, `client/engagement-owned`, `global authentication`, `platform infrastructure`, one class per relation, schema-qualified. A partition has no row and takes its root's class. Views, materialized views and foreign tables are classified like tables. Global-authentication and platform-infrastructure tables get no inventory row. A protected row's boundaries include its class minimum: tenant (tenant-owned); tenant and owner (user-owned); tenant, client and engagement (client/engagement-owned). Inventory commands come only from `SELECT`, `INSERT`, `UPDATE`, `DELETE` and `LOCK` (a locking read, which PostgreSQL grants only with the UPDATE privilege and the UPDATE policy's `USING`), and every maintenance principal named in a cell is in the contract's closed list. The inventory is derived from the production code's access paths, and says so. Every judgment call the planning documents do not settle is written in the contract as an open decision with the story that must settle it.

**Ask First:** changing a class after the owner has reviewed the classification; anything that writes SQL, a role, a column, a policy, a trigger or a migration (Stories 11.2–11.8).

**Never:** no new product module under `packages/` or `apps/` (Proposal 7 D-7-3: the package rename comes before Epic 11 writes new modules); no change to application code; no edit that weakens or removes an existing test, including the exact table list in `tests/integration/schema-compat.test.ts`.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected Output / Behavior | Error Handling |
|----------|--------------|---------------------------|----------------|
| Every relation classified | migrated generation-61 database | the unclassified-table test passes; classified set equals the database's set | N/A |
| New table, no row | a migration adds `public.x` | the test fails and names `public.x` | N/A |
| Stale row | a row names a relation that no longer exists | the test fails and names the row | N/A |
| Partition | `pgboss.queue_stats_20260925` exists | covered by the `pgboss.queue_stats` row; a row naming a partition fails | N/A |
| Protected table missing from inventory | a client/engagement-owned table has no inventory row | the inventory test fails and names it | N/A |
| Unprotected table given a policy | an inventory row for `pgboss.job` | the inventory test fails | N/A |
| Class boundary missing | a client/engagement-owned row without `engagement` | the inventory test fails | N/A |
| Unknown principal or command | a cell names a principal outside the closed list, or `TRUNCATE` | the inventory test fails | N/A |

</frozen-after-approval>

## Code Map

Verified against `main` at `429e08c` and the migrated generation-61 database. Line numbers are at that commit.

**Schema and database**

- `packages/infrastructure/src/db/schema.ts` -- read-only; the 66 `public` tables. A Drizzle table object carries `Symbol.for('drizzle:Name')`, `Symbol.for('drizzle:Schema')`, `Symbol.for('drizzle:IsDrizzleTable')` and `Symbol.for('drizzle:Columns')` (an object whose values each have `.name`, the SQL column name). drizzle-orm 0.45.2 also puts an own enumerable `enableRLS` function on every table object, so collecting `.name` from every enumerable value lists `enableRLS` as a column; read column names from `drizzle:Columns` only. A test reads these symbols without importing `drizzle-orm` (not a root dependency).
- Database at generation 61 -- `public` 66 tables, `pgboss` 12 (9 roots; `job_common` is a partition of `job`, `queue_stats_YYYYMMDD` are daily partitions of `queue_stats`), `drizzle.__drizzle_migrations`. No views, materialized views or foreign tables. 62 triggers on `public` tables call 57 functions; none is `SECURITY DEFINER`, and 38 of the 57 read a table other than their own (`pg_trigger` joined to `pg_proc`; examples `run_stop_applied_consistency` in `drizzle/0057`, `run_interaction_transition_guard` in `0059`, `bind_permission_event` in `0060`). A trigger function runs with the rights of the statement that fired it, so under row-level security its `EXISTS` sees only the caller's rows, and a guard written as "refuse if such a row exists" passes silently when it cannot see the row.
- `tests/integration/schema-compat.test.ts` -- read-only; exact `public` list; keep it.
- `tests/integration/vitest.config.ts` -- `fileParallelism: false`, so scratch schemas other files create are dropped before this file runs.
- `tests/unit/replay-asset-set.test.ts` -- pattern for reading a contract table off disk and failing by name. `tests/fixtures/*.ts` -- shared test helpers, imported with a `.js` suffix.

**The audit append** (`packages/infrastructure/src/db/audit-events.ts:62` `appendAuditEvent`, the one append path)

- Takes `audit_run` `FOR KEY SHARE` for **every aggregate id shaped like a UUID** (`isUuidText`, line 76), not only for Runs: a Run's, a Procedure's (UUIDv7), a registration's and a binding's. For a non-Run UUID no row matches, but the statement still needs the SELECT privilege, the UPDATE privilege on a column and the policies' `USING`. So `plan-derivation` (appends to `row.procedureId`, `packages/application/src/procedures/derive-plan.ts:24`) needs `SELECT` and `LOCK` on `audit_run`. `platform` and `procedure-platform-configuration` are not UUIDs and take no Run lock.
- Inserts `audit_event_heads` (on conflict nothing), locks it `FOR UPDATE`, inserts `audit_events`, updates the head (`last_sequence`, `last_event_hash`). It never selects from `audit_events`.
- `projectRunInteractionEvent` (`packages/infrastructure/src/runs/run-interaction-projection.ts:52`) returns at once unless the payload carries a UUID `commandId`; then it selects `run_interaction_command` `FOR UPDATE`, reads the prior `run_interaction_transition` and inserts one. Events that carry a `commandId`: `execution.escalation-answered`, `lifecycle.run-resumed`, `lifecycle.run-cancel-requested`, `lifecycle.run-canceled` (web or worker), and from `completeRun` (`packages/application/src/runs/complete-run.ts:440-505`) the pause-superseded and deferred-pause-superseded events. Any caller of `completeRun` can append those, so every caller in §4.4 needs the projection grants.
- Narration inserts `run_conversation_message` (after reading its max sequence) only for the event types `packages/application/src/runs/run-conversation-events.ts` narrates: `lifecycle.agent-workspace` (created), `execution.capture-registered`, `lifecycle.agent-work`, `execution.observations-registered`, `execution.escalation-raised`, `lifecycle.run-pause-requested`, `lifecycle.run-paused`, `lifecycle.run-resumed`, `lifecycle.run-control-lease-transferred`, `lifecycle.result-sealed`.
- Who appends to what: members append to `platform` (users, roles, permission grants), Procedures, Runs, registrations and bindings; the execution delegation to Runs; `authentication-audit` to `platform` only (sign-in, sign-out, refused access); `plan-derivation` to Procedures; `wait-timeout` to Runs, through `completeRun` too (so it can append result-sealed, pause-superseded and deferred-pause-superseded); `workspace-reaper` (`provision-workspace.ts:269,309`, `copy-recording.ts:181`), `evidence-integrity`, `notification-delivery` (`notification-delivery.ts:133`) and `evidence-read-issuer` (`evidence-read-grant.ts:322`) to Runs only, with events that carry no `commandId` and are not narrated.

**Paths the first derivation missed**

- Live preview. The web route calls `WorkspacePreviewProxy.read` → `PostgresWorkspacePreviewStore.authorized` (`packages/infrastructure/src/runs/workspace-preview-repository.ts:47`), which selects `run_workspace_preview` joined to `run_workspace`, `audit_run`, `auth_session` and `user_role` (member). The worker's broker (`workspace-preview-transport.ts:40,45,67,78`) runs the same `authorized` and `current` (`:39`). The sampler (`workspace-preview-session.ts` `tick`, lines ~76-99) calls `publish` (`:26`, an UPDATE of `privacy_epoch, mode, sequence, captured_at, capture_completed_at, expires_at` joined to `run_workspace` and `audit_run`) and `current` on a timer, outside any job claim, while the Run is `RUNNING`, `PAUSED` or `AWAITING_AUDITOR`. `claim` (`:12`, INSERT … ON CONFLICT DO UPDATE) runs at provisioning (`browser-execution.ts:775`), which is the execution delegation.
- Workspace release. `releaseWorkspace` saves through `context.save` (`packages/application/src/runs/provision-workspace.ts:727,798`), which is `workspace-repository.ts:92-96`: an upsert of `run_workspace` (INSERT and UPDATE) and `UPDATE audit_run SET state` with the state the Run already has. So `workspace-reaper` needs `INSERT` on `run_workspace` and `UPDATE(state)` on `audit_run`.
- Rows about other people. Members insert notifications addressed to other people (version submission to every Audit Manager, approval to the author, flag to managers: `notifications/notification-repository.ts:154,166,173`); the delegation inserts Escalation notifications for managers (`runs/wait-repository.ts:380`). A member reads only their own notifications. A member's `evidence_read_grant` updates are all their own (`evidence-read-grant-repository.ts`, `actor_id = input.actorId`); `evidence-read-issuer` updates anyone's. A member's `procedure_authoring_request` reads, locks and updates are their own (`procedures/authoring-store.ts:29,36,45`). Creating a record-review snapshot deletes up to 100 expired snapshots of anyone, then the member's own older ones (`runs/record-review-repository.ts:214-219`); `review-snapshot-expiry` deletes every expired one.
- `packages/infrastructure/src/identity/role-repository.ts:222` `listUsers` reads every `auth_user` row (name, address) with a LEFT JOIN to `user_role`.

**Planning facts the contract must not contradict** (Proposal 3a §C1, `_bmad-output/planning-artifacts/epics.md`)

- Two database roles: the migrator (owns every table, runs DDL and backfills) and one runtime role, `NOSUPERUSER NOBYPASSRLS`, used by web and worker. Every protected table has `ENABLE` and `FORCE ROW LEVEL SECURITY`. A row passes when one permissive policy and every restrictive policy pass.
- Introduced tables: `tenant`, `tenant_membership` (user × tenant × role), `client`, `engagement_membership` (user × engagement × role), `execution_delegation`. There is no client membership. Engagement-owned children carry `tenant_id` and `engagement_id` and reach the client through the engagement; client-bound material carries `client_id` directly.
- D-3a-2: Engagement and Agent Task sit beside `audit_run`, not above it; `audit_run.version_id` stays non-null.
- "Owning a resource personally does not override a client restriction attached to that resource."
- Maintenance work uses "service principals with narrow, operation-specific authority expressed as their own RLS policies", and a service principal is granted column-level `UPDATE` "and no UPDATE privilege on any other column or table". C1 does not say how a service principal's column privileges are separated from the one runtime role's.
- The initial-binding function is `SECURITY DEFINER`, owned by the migrator; how it cooperates with the immutability trigger and RLS is carried into Proposal 3d.
- Story 11.2 adds `tenant_id` to every protected table with a populated-upgrade proof; Story 11.9 demonstrates "a global Audit manager without engagement membership reaches nothing"; Story 13.14a establishes the administrator model policy (`model-policy-v1`).

**Where the worker's duties live** (source of the maintenance principal list)

- `apps/worker/src/main.ts`; each duty is a `start*` function in `packages/infrastructure/src` (`notification-worker.ts`, `record-review-repository.ts:383`, `workspace-reaper.ts:44`, `wait-wake.ts`, `evidence-integrity-sweep.ts:51`, `evidence-read-grant-queue.ts`, `population-queue.ts`, `workspace-preview-transport.ts`, `evaluation-review-queue.ts`, `derivation-queue.ts`); the probe runs in its own process (`registrations/probe-runner.ts`).
- `packages/application/src/runs/complete-run.ts` -- the Run completion path (§4.4), reached by the delegation, by a member cancelling or aborting, by a member whose Evidence read fails verification, and by `wait-timeout`.
- `packages/infrastructure/src/procedures/procedure-repository.ts:580` `updateVersion` rewrites every column (plan derivation writes through it); `:622` `applyConfigurationRevision` is the only writer of `procedure_configuration` (release script); `procedure_change` rows are written by `mintPlatformDraft` from an administrator's registration or binding change, and by the release script.

## Tasks & Acceptance

**Execution:**
- [x] `docs/contracts/tenancy-v1.md` -- the contract: the story table; §1; §2 the five classes and their rules; §3 one classification row per relation (76); §4.1 principal kinds; §4.2 the closed maintenance-principal list with a "Rows it may reach" column; §4.3 the audit append with a table of appending principals; §4.4 the Run completion path; §4.5 outside the runtime; §5 the policy inventory; §6 how it is held; §7 decisions (decided here, and open); §8 findings -- the contract Story 11.1 establishes. Content per Design Notes.
- [x] `tests/fixtures/tenancy-contract.ts` -- parse §3, §4.2, §4.3 and §5; throw only on a structural problem (a missing section, a wrong cell count, a table interrupted by a blank line or a non-table line with rows after it); return every value as written, so each vocabulary rule is a named test case and never a parse error -- one parser for both tests.
- [x] `tests/unit/tenancy-inventory.test.ts` -- the inventory test: one named case per rule in Boundaries and per rule in Design Notes, plus every Drizzle table classified -- fast, no database.
- [x] `tests/integration/table-classification.test.ts` -- the unclassified-table test: every non-system relation, partitions resolved with `pg_partition_root`, compared both ways; a rolled-back probe creating a table, a view, a materialized view and a partitioned table with one partition -- the proof against the real schema.
- [x] `CLAUDE.md` -- a new top section recording the rule (a new relation needs its classification row, and its inventory row when protected, in the same commit) and the lessons in Design Notes; one restart command for the scratch PostgreSQL, consistent with the older entries.
- [x] Mutation proof -- break each rule once in a copy of the document, run the tests, require the named case to fail, restore; record every mutation and its killing case in this spec's Verification.
- [x] `_bmad-output/implementation-artifacts/sprint-status.yaml` -- `11-1` through the generator only.

**Acceptance Criteria:**
- Given the migrated database, when the unclassified-table test runs, then it passes, and it fails with the relation's name after a scratch table, view or materialized view is created in `public`.
- Given the contract, when the inventory test runs, then it passes, and each rule in Boundaries and Design Notes has a case proven by mutation (the rule broken in the document makes a named case fail, never a parse error).
- Given §4.3, when a principal records events, then its §5 grants hold every lock and insert the append takes for its aggregates, and a maintenance principal holds no projection or narration grant its events never use.

## Design Notes

The inventory states scope, not capability: role checks stay in the domain gating table. It is a static audit of the application's own statements; trigger bodies are handled by decision D8 below, never by widening a grant.

**Cells.** Member and Execution delegation cells list the commands that kind's permissive grant allows. A maintenance cell is `` `principal`: COMMANDS ``, one entry per principal, `;`-separated, each entry granting at least one command, each principal at most once per row. `UPDATE(columns)` is a narrow update Story 11.6 turns into a column privilege; an unqualified `UPDATE` is row-level.

**`LOCK`** is `FOR UPDATE`, `FOR NO KEY UPDATE`, `FOR SHARE` or `FOR KEY SHARE`. PostgreSQL requires the SELECT privilege and the UPDATE privilege on a column for it, and applies the SELECT and UPDATE policies' `USING`. So a cell with `LOCK` always has `SELECT` (a test holds it), and a `LOCK` without `UPDATE` is built as an UPDATE policy whose `WITH CHECK` is false: the lock succeeds and no update passes.

**Boundaries** are restrictive policies. `tenant`, `client` and `engagement` compare the row's scope with a person's memberships; null in a scope column means the level above (no engagement: client-level; no client: tenant-level), never unrestricted. `owner` compares the person a row belongs to (recipient, actor, requester) with the principal's person, and applies to members and execution delegations only. `owner(SELECT)` restricts only the listed commands; a bare `owner` restricts every command. A user-owned table has a bare `owner`. A boundary appears at most once per row.

**§4.2** gives each maintenance principal a "Rows it may reach" sentence: the operation's own selection, which Story 11.6 writes as that principal's policy predicate. Draft:
`authentication-audit` -- the `platform` chain's events and head; `plan-derivation` -- Draft versions with a pending plan derivation, and their Procedures' chains; `run-recovery` -- `RUNNING` Runs whose stage checkpoint is retrying or whose claim expired, read only; `wait-timeout` -- Runs with an open wait past its deadline, and the rows §4.4 reads and writes for them; `workspace-reaper` -- ended Runs whose workspace is not released, their versions and recordings; `evidence-integrity` -- ended Runs with a sealed Evidence package; `notification-delivery` -- undelivered notifications and the Run and wait each names; `evidence-read-issuer` -- pending read grants and the Run, version, Evidence and requester role each names; `review-snapshot-expiry` -- expired snapshots; `evaluation-review-recovery` -- pending review commands; `registration-probe` -- active registrations and their probe rows; `workspace-preview-broker` -- preview rows of Runs that are `RUNNING`, `PAUSED` or `AWAITING_AUDITOR` with a local workspace `OPEN` or `PROVISIONING`, and the viewer's own session and role. `workspace-preview-broker`'s authority also covers the sampler's writes ("keeps the live preview of a Run's workspace current and serves it to a viewer, re-checking the viewer's session and role itself").

**§4.3** is a table `| Principal | Aggregates | Command receipts | Narrated events |`: `member` -- `platform`, Procedure, Run, registration, binding -- yes -- yes; `execution delegation` -- Run -- yes -- yes; `authentication-audit` -- `platform` -- no -- no; `plan-derivation` -- Procedure -- no -- no; `wait-timeout` -- Run -- yes -- yes; `workspace-reaper`, `evidence-integrity`, `notification-delivery`, `evidence-read-issuer` -- Run -- no -- no. Rules the test holds: every principal with `INSERT` on `audit_events` is in the table and every row of the table has it; each holds `SELECT`, `INSERT`, `UPDATE` (or `UPDATE(last_sequence, last_event_hash)`) and `LOCK` on `audit_event_heads`; each with a UUID aggregate (Procedure, Run, registration, binding) holds `SELECT` and `LOCK` on `audit_run`; "Command receipts: yes" requires `SELECT` and `LOCK` on `run_interaction_command` and `SELECT` and `INSERT` on `run_interaction_transition`; "Narrated events: yes" requires `SELECT` and `INSERT` on `run_conversation_message`; a maintenance principal marked "no" holds none of those projection or narration grants.

**Inventory corrections to the first derivation** (everything else in it was verified against the code and stays):
1. `run_interaction_command`: execution delegation `SELECT, LOCK`; `wait-timeout` `SELECT, LOCK`; no entry for `workspace-reaper`, `evidence-integrity`, `notification-delivery`, `evidence-read-issuer`. The same four lose their `run_interaction_transition` and `run_conversation_message` entries; `wait-timeout` keeps `SELECT, INSERT` on both.
2. `audit_run`: `plan-derivation` `SELECT, LOCK`; `workspace-reaper` `SELECT, UPDATE(state), LOCK`; `workspace-preview-broker` `SELECT`.
3. `run_workspace`: `workspace-reaper` `SELECT, INSERT, UPDATE`.
4. `run_workspace_preview`: member `SELECT`; `workspace-preview-broker` `SELECT, UPDATE(privacy_epoch, mode, sequence, captured_at, capture_completed_at, expires_at)`.
5. `user_role`: `workspace-preview-broker` `SELECT`.
6. `procedure_change`: client/engagement-owned (decision D2); boundaries `tenant, client, engagement`; member `SELECT, INSERT`.
7. `run_initiation_request`: boundaries `tenant, client, owner` (decision D4).
8. `notification`: boundaries `tenant, client, engagement, owner(SELECT)` (decision D6). The other owner rows (`evidence_read_grant`, `procedure_authoring_request`, `run_review_snapshot`, `run_review_snapshot_row`) keep a bare `owner`.

**§7 Decisions.** Two lists. *Decided here* -- the tests hold these, and each names the story that confirms it before building on it:
- D1 Procedures, registrations and Population Source bindings are client material, client-level, no engagement of their own -- Story 11.2.
- D2 `procedure_change` is client material: a registration or binding change mints Drafts of one client; the release script writes one receipt per client for a platform change. Client/engagement-owned at client level (was tenant-owned, which let any client's member read another client's Draft ids) -- Story 11.2 keys it by client.
- D3 `procedure_configuration` stays platform infrastructure; a tenant's own model policy is Story 13.14a's `model-policy-v1`, a new tenant-owned table then.
- D4 `run_initiation_request` is user-owned and keeps a client boundary, because owning a record never overrides a client boundary: a request naming an existing Procedure carries its client; a refusal naming none carries no client (tenant-level) -- Story 11.2 adds `tenant_id`, `owner_user_id` and a nullable `client_id`.
- D5 `user_role` and `user_permission_grant` are tenant-owned -- Story 11.9 decides whether `tenant_membership` absorbs them.
- D6 The owner boundary is a person's (members and delegations only), and restricts only the commands its row names: people address notifications to others, so `notification` is `owner(SELECT)`. A member's opportunistic purge of other people's expired snapshots is thereby narrowed to their own; `review-snapshot-expiry` removes the rest -- Story 11.4.
- D7 A maintenance principal has no person and no membership; it meets the tenant, client and engagement boundaries only inside its own row predicate (§4.2), per C1's "narrow, operation-specific authority expressed as their own RLS policies" -- Story 11.6 writes the predicates, Story 11.4 lets the boundaries admit a maintenance principal only through them.
- D8 Trigger functions: §5 lists application statements. The 38 trigger functions that read another table become hardened `SECURITY DEFINER` functions (fixed safe `search_path`, `EXECUTE` revoked from `PUBLIC`) owned by a role whose reads the policies do not narrow, so a guard always sees the rows it guards and needs no runtime grant. Listing their reads in §5 instead was refused: it widens every writer's grants, and a guard that cannot see a row passes silently, which no suite detects -- Story 11.3 decides the owning role; Story 11.4 converts them before `FORCE` is enabled (Proposal 3a carried the same hardening questions for the binding function into 3d).

*Open* -- the inventory depends on them and does not decide them; each names the story that must:
- O1 Where the two tenantless chains live (`platform`, `procedure-platform-configuration`) and the boundary of a refused-access event that has no member -- Story 11.2, which adds `tenant_id` to `audit_events` and `audit_event_heads` (Story 11.8 binds historical chains afterwards; it was named first and is too late). `bind_permission_event` reads `platform` events as the administrator (see D8).
- O2 How the client boundary is met, with no client membership: a row with an engagement meets it through that engagement; a client-level row (engagement null) is reached by a member of any engagement of its client (the reading Story 11.9's "a global Audit manager without engagement membership reaches nothing" implies) -- Stories 11.2 and 11.4.
- O3 A Run's engagement: D-3a-2 puts Engagements beside `audit_run`, so every Run and its children are client-level today and nothing in the plan gives a Run an engagement -- Story 11.2 backfills them so.
- O4 Principal resolution: `user_role` is tenant-owned, so under `FORCE` a person cannot read their own roles before the tenant is set, yet the web reads the role on every request and the preview broker authorizes a viewer by session and role. A narrow resolver function, or an owner policy on the membership tables -- Story 11.4, with the wrapper.
- O5 Database roles for maintenance principals: with one runtime role a column privilege is the union over every principal and narrows nothing (members hold row-level `UPDATE` on `audit_run`). Preferred: each maintenance principal is its own `NOLOGIN` role the wrapper enters with `SET LOCAL ROLE` -- Story 11.3 creates them, Story 11.6 grants them.

**§8 Findings** keep the first derivation's six, with finding 3 corrected (every append to a UUID aggregate locks `audit_run`, so every principal that records a Run, Procedure, registration or binding event needs `SELECT` and `LOCK` on it), and add: 7 global authentication has no policy, so member reads of `auth_user` cross tenants (`listUsers`, directory search, name resolution) -- Story 11.4 or 11.9 joins them through membership; 8 the workspace release rewrites `audit_run.state` through the checkpoint writer -- Story 11.6 gives the release its own writer; 9 the preview sampler writes outside any job claim -- Story 11.7 routes it through the wrapper as `workspace-preview-broker`.

**§2** "null means tenant-level" becomes "null means the level above". **§6** lists what each test proves, including that foreign tables are in the relation query but not probed (creating one needs a foreign-data wrapper), and that Story 11.4's suites prove application-statement grants only.

**CLAUDE.md** lessons: a migration edits §3 (and §5 when protected); `LOCK` is its own grant and needs `SELECT` too; the append locks `audit_run` for every UUID aggregate; trigger functions run as the caller and are D8, never a widened grant; a mutation proof must fail its named case, never a parse error; column names come from `drizzle:Columns`, not from the table's enumerable values; the scratch PostgreSQL restart command (mark older copies `[EXTENDED]` if yours differs).

The rows were generated from the access audit and are then committed as the document; from then on the document is the only source, edited by hand, and the tests read only it.

## Verification

**Commands:**
- `pnpm exec vitest run tests/unit/tenancy-inventory.test.ts` -- expected: all pass
- `pnpm exec vitest run -c tests/integration/vitest.config.ts tests/integration/table-classification.test.ts tests/integration/schema-compat.test.ts` -- expected: all pass on a migrated PostgreSQL 18
- `pnpm typecheck` -- expected: exit 0
- Mutation proof -- expected: every mutation fails its named case; record the table here (mutation, rule, killing case, result).

**Results** (2026-09-25; working tree on `fd241a1`; PostgreSQL 18.6 scratch database at generation 61):

- `pnpm exec vitest run tests/unit/tenancy-inventory.test.ts` -- 49 of 49 pass.
- `pnpm exec vitest run -c tests/integration/vitest.config.ts tests/integration/table-classification.test.ts tests/integration/schema-compat.test.ts` -- 4 of 4 and 18 of 18 pass; the exact `public` list in `schema-compat.test.ts` is unchanged.
- `pnpm typecheck` -- exit 0.
- Acceptance 1 against committed objects, beyond the test's own rolled-back probe: a table, a view and a materialized view committed to `public` made the unmodified case "classifies every relation the database holds" fail with `offending: public.ac1_scratch_matview, public.ac1_scratch_table, public.ac1_scratch_view`; after they were dropped all four cases pass, and no `ac1_scratch%` relation is left.
- Mutation proof -- 55 mutations, 55 killed by their named case. Each run used Vitest's JSON reporter and counted as a kill only when the named case was among the failures AND all cases of the file were collected (49 unit, 4 integration), so a parse error could only ever read as "not proven"; none did. The document was backed up, broken once per case, restored from the backup after each case and in a `finally`, and ended byte-identical (sha256 `228f81b6ccd02bdfd9e0887bd21a6007737389a995396961dffcf26b76485d2e`) with both tests green. Harness: `scratchpad/11-1/iter1/mutate.py` in this session's scratchpad (`/tmp/claude-0/-home-user-intellifin-audit/b2e71a94-040e-53b1-9c96-545faa66d3e1/`), which also holds the iteration-1 builder (`assemble.py`, `render.py`, `classification.py`, `inventory.py`, `contract-*.md`) that produced the committed document. "also: n other" counts the other cases the same mutation failed.

| # | Mutation | Rule | Killing case | Result |
|---|---|---|---|---|
| M1 | a second §3 row for `public.run_flag` | one class per relation | unit: names each relation once | killed (also: 1 other) |
| M2 | §3 row `public.run_flag` written `run_flag` | schema-qualified relations | unit: writes every relation schema-qualified | killed (also: 2 other) |
| M3 | `public.run_flag` classed `engagement-owned` | exact class names | unit: uses only the five class names | killed (also: 1 other) |
| M4 | §3 row for `public.run_flag` deleted | every Drizzle table classified | unit: classifies every table the Drizzle schema declares | killed (also: 1 other) |
| M5 | §5 row for `public.run_flag` deleted | protected table missing from the inventory | unit: has exactly one row per protected table | killed |
| M6 | §5 row added for `pgboss.job` | unprotected table given a policy (`pgboss.job`) | unit: gives no tenant policy to an authentication or infrastructure table | killed (also: 1 other) |
| M7 | `run_flag` boundaries `tenant, client` | class boundary missing (no `engagement`) | unit: carries at least its class boundaries on every protected table | killed |
| M8 | `run_flag` boundaries plus `region` | boundary vocabulary | unit: uses only tenant, client, engagement and owner as boundaries | killed |
| M9a | `notification` boundary `owner(READ)` | `owner(COMMANDS)` names known commands | unit: narrows only the owner boundary, and only to known commands | killed (also: 1 other) |
| M9b | `run_flag` boundary `engagement(SELECT)` | only the owner boundary is narrowed | unit: narrows only the owner boundary, and only to known commands | killed |
| M10 | `notification` boundaries `owner, owner(SELECT)` | a boundary at most once per row | unit: names each boundary at most once per row | killed (also: 1 other) |
| M11 | `run_initiation_request` boundary `owner(SELECT)` | a user-owned table has a bare `owner` | unit: gives every user-owned table a bare owner boundary | killed (also: 1 other) |
| M12 | `run_flag` member `SELECT, TRUNCATE` | only the five commands (`TRUNCATE`) | unit: grants only SELECT, INSERT, UPDATE, DELETE and LOCK | killed |
| M13 | `run_flag` member `SELECT(flag_id), INSERT` | only `UPDATE` takes columns | unit: narrows only UPDATE to columns | killed |
| M14 | `notification` `UPDATE(invented_column, …)` | a narrow `UPDATE` names real columns | unit: names only real columns in a narrow UPDATE | killed |
| M15a | `run_flag` member `SELECT, INSERT, SELECT` | a command at most once per principal | unit: grants each command at most once per principal kind | killed |
| M15b | `run_wait` `wait-timeout`: `UPDATE` beside `UPDATE(closed_at, …)` | no `UPDATE` beside an `UPDATE(...)` for one principal | unit: grants each command at most once per principal kind | killed |
| M16 | `run_wait` `notification-delivery`: `LOCK` alone | `LOCK` comes with `SELECT` | unit: grants SELECT wherever it grants LOCK | killed |
| M17 | `run_flag` member `INSERT` alone | someone reads every protected table | unit: lets some principal read every protected table | killed |
| M18 | §4.2 row `review-snapshot-expiry` duplicated | the closed list names each principal once | unit: names each maintenance principal once | killed |
| M19 | `run_flag` gets `` `invented-principal`: SELECT `` | unknown maintenance principal | unit: names only maintenance principals from the closed list | killed |
| M20 | `review-snapshot-expiry`'s only entry removed | every listed principal is used | unit: uses every maintenance principal of the closed list | killed |
| M21 | `review-snapshot-expiry` Rows it may reach `—` | each principal says which rows it may reach (D7) | unit: D7: says which rows each maintenance principal may reach | killed |
| M22 | `review-snapshot-expiry` entry without backticks | an entry is `` `principal`: COMMANDS `` | unit: writes every maintenance entry as `principal`: COMMANDS | killed (also: 2 other) |
| M23 | `` `review-snapshot-expiry`: — `` | an entry grants at least one command | unit: grants at least one command in every maintenance entry | killed (also: 1 other) |
| M24 | `run_wait` names `wait-timeout` twice | a principal at most once per row | unit: names each maintenance principal at most once per row | killed |
| M25 | §4.3 row added for `invented-appender` | appenders are known principals | unit: names only known principals in the audit append | killed (also: 3 other) |
| M26 | §4.3 row `wait-timeout` duplicated | each appender once | unit: names each appending principal once | killed (also: 1 other) |
| M27 | `wait-timeout` aggregates `Run, Engagement` | known aggregates | unit: names only the known aggregates | killed |
| M28 | `wait-timeout` command receipts `sometimes` | receipts and narration are yes or no | unit: answers yes or no for command receipts and narrated events | killed |
| M29a | §4.3 row `evidence-read-issuer` deleted | an `audit_events` inserter missing from §4.3 | unit: lists exactly the principals that insert into audit_events | killed |
| M29b | `evidence-read-issuer`'s `INSERT` on `audit_events` removed | a §4.3 principal without `INSERT` on `audit_events` | unit: lists exactly the principals that insert into audit_events | killed |
| M30 | `plan-derivation` head update `UPDATE(last_sequence)` | the head is locked and advanced | unit: gives every appending principal the head it locks and advances | killed |
| M31 | `plan-derivation`'s `audit_run` entry removed | a UUID aggregate locks `audit_run` | unit: gives every appender of a UUID aggregate SELECT and LOCK on audit_run | killed |
| M32 | delegation `SELECT` alone on `run_interaction_command` | command receipts need the projection grants | unit: gives every principal whose events carry a command receipt the projection grants | killed |
| M33 | `wait-timeout`'s `run_conversation_message` entry removed | narrated events need the narration grants | unit: gives every principal whose events are narrated the narration grants | killed |
| M34 | `evidence-integrity` given `SELECT, INSERT` on `run_interaction_transition` | a principal marked no holds no projection grant | unit: gives a maintenance principal marked no none of the projection or narration grants | killed |
| M35 | O5 deleted | every decision recorded | unit: records decisions D1 to D8 and open decisions O1 to O5, each once | killed |
| M36 | O5 names no story | every decision names its story | unit: names the story that settles every decision | killed |
| M37 | a §3 reason cites D9 | citations resolve to §7 | unit: cites only decisions §7 records | killed |
| M38 | `procedure` classed `tenant-owned` | D1 | unit: D1: classifies Procedures, registrations and bindings as client material | killed |
| M39 | `procedure_change` classed `tenant-owned` | D2 | unit: D2: classifies procedure_change as client material | killed |
| M40 | `procedure_configuration` classed `tenant-owned` | D3 | unit: D3: keeps procedure_configuration platform infrastructure | killed (also: 1 other) |
| M41 | `run_initiation_request` boundaries `tenant, owner` | D4 | unit: D4: keeps a client boundary beside the owner on run_initiation_request | killed |
| M42 | `user_permission_grant` classed `user-owned` | D5 | unit: D5: classifies user_role and user_permission_grant as tenant-owned | killed (also: 2 other) |
| M43 | `notification` bare `owner` | D6 | unit: D6: restricts only reads of a notification to its owner, and every command elsewhere | killed |
| M44 | `wait-timeout` given `SELECT` on `audit_events` | D8 | unit: D8: widens no maintenance grant for a trigger function's read of audit_events | killed |
| M45 | §1: "The inventory states capability." | scope, not capability | unit: states that the inventory is scope, not capability | killed |
| M46 | §2: "A null scope column means unrestricted." | null means the level above | unit: states that a null scope column means the level above, never unrestricted | killed |
| M47 | §5: "derived from the tests" | derived from the production code, and says so | unit: states that the inventory is derived from the production code's access paths | killed |
| M48 | §5 drops "applies to members and execution delegations only" | owner applies to members and delegations only | unit: states that the owner boundary applies to members and execution delegations only | killed |
| M49 | §5 drops the `LOCK`-without-`UPDATE` clause | a `LOCK` without `UPDATE` is an UPDATE policy whose `WITH CHECK` is false | unit: states that a LOCK without UPDATE is an UPDATE policy whose WITH CHECK is false | killed |
| M50 | §3 row `pgboss.warning` deleted | a relation the database holds has no row | integration: classifies every relation the database holds | killed (also: 1 other) |
| M51 | §3 row added for `public.dropped_long_ago` | a stale row | integration: classifies nothing the database does not hold | killed |
| M52 | §3 row added for `pgboss.job_common` | a partition given a row | integration: gives no partition a row of its own, and classifies every partition root | killed (also: 1 other) |

## Spec Change Log

- **2026-09-25, review loop 1 (bad_spec).**
  - *Triggering findings* (three reviewers, iteration 0): `LOCK` granted without `SELECT`, so the delegation's and five maintenance principals' command-receipt locks could never run; the append's `audit_run` lock described as Run-only, so `plan-derivation` lacked it; the live-preview read, the preview sampler and the reaper's upsert missing from the audit; trigger functions (38 read other tables, none `SECURITY DEFINER`) outside the audit with no decision; an `owner` boundary on "every command" refusing notifications people address to others; maintenance principals with no row scope; the client boundary, a Run's engagement, principal resolution and per-principal database roles undecided and unrecorded; decision on tenantless chains assigned to Story 11.8, after 11.2 needs it; `run_initiation_request` contradicting the contract's own client rule; `procedure_change` exposing Draft ids across clients; the parser throwing on vocabulary errors, so three mutation cases died as collection errors rather than named cases; `enableRLS` accepted as a column; rows after a blank line silently dropped; blanket projection and narration grants on four principals; decision 4 naming no story.
  - *Amended*: Code Map (append lock scope, projection and narration triggers, who appends what, the missed paths, trigger facts, planning facts), Tasks (structural-only parser, the fourth table, the probe objects, the mutation record), Acceptance (named case never a parse error; §4.3 criterion), Design Notes (the `LOCK` definition, per-command `owner`, maintenance predicates, §4.3 table and rules, the eight inventory corrections, decisions D1-D8 and O1-O5, findings 7-9), Verification (mutation record).
  - *Known-bad state avoided*: an inventory that Story 11.4 would build into policies that refuse the product's own append, cancel and preview paths, or that silently weaken guard triggers; tests that pass while a rule is broken or die before naming the rule.
  - *KEEP*: the iteration-0 derivation is saved at `/tmp/claude-0/-home-user-intellifin-audit/b2e71a94-040e-53b1-9c96-545faa66d3e1/scratchpad/11-1/keep-iter0/` (the four files and `CLAUDE.md.diff`); its builder (`assemble.py`, `render.py`, `classification.py`, `inventory.py`, `contract-head.md`, `contract-middle.md`, `contract-tail.md`, and the mutation harness `mutate.py`) runs in place from `…/scratchpad/11-1/` and regenerates that contract byte for byte (`python3 assemble.py <out>`). Keep: all 76 classification rows and their reasons except `procedure_change` (D2) and `run_initiation_request` (D4); every §5 row except the eight corrections; the §4.2 principals, authorities and "Runs today as"; the story table, §1, §2 (null rule corrected), §4.1, §4.4, §4.5; §8 findings 1, 2, 4, 5 and 6; the parser's single module and `.js` import; `describe.skipIf(!databaseUrl)`, `createSqlClient(databaseUrl, { max: 2 })`, the `RollBack` probe transaction and the `pg_partition_root` query; the existing unit case names; the CLAUDE.md section's four lessons, corrected.
