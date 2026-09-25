# Tenancy v1

**Status:** normative for the parts below. Story 11.1 (Epic 11, Slice 0; FR-53, FR-54, FR-83, FR-84; AD-8, AD-11, AD-24). Its specification home before this file was the `tenancy-v1` row of the architecture's `CONTRACT-REGISTER.md`, with Proposal 3a §C1.

Epic 11 puts every protected row under an explicit tenant, client, engagement or owner, and makes PostgreSQL enforce it. Nothing may be enforced before it is decided, so this contract starts with the decisions: which class each relation is in, which principals exist, and what each principal may do to each protected table. It creates no column, role, policy, trigger or migration. Stories 11.2–11.11 add those, each in its own section of this file:

| Story | Adds |
|---|---|
| 11.2 | scope columns, composite scope keys, the per-table backfill mapping |
| 11.3 | the migrator and runtime database roles |
| 11.4 | the row-level-security policies built from §5, and the principal wrapper |
| 11.5 | ownership immutability and the draft-binding function |
| 11.6 | execution delegations, the service principals of §4.2, their column privileges |
| 11.7 | routing every unit of work through the wrapper; draining and re-validating queued jobs |
| 11.8 | ownership bindings for historical chains; envelope v2 |
| 11.9–11.11 | tenant roles as capability groups; invitations; removal |

## 1. What this file fixes

- Every relation in every non-system schema is in exactly one of five classes (§2, §3).
- Every protected table has one inventory row (§5): the restrictive boundaries that apply to it, and the commands the permissive grant allows each principal kind (§4).
- Two tests hold both tables to the database and to each other (§6). A migration that adds a relation adds its rows here in the same commit.
- Every judgment call the planning documents do not settle is written down in §7, with the story that must settle it.

The inventory states scope, not capability. Whether an Auditor may approve a version is still the domain gating table's decision; the inventory says which rows a request may reach once the gating table has said yes.

## 2. The five classes

| Class | Holds | Boundaries every command meets | Tenant policy |
|---|---|---|---|
| tenant-owned | the firm's own configuration and methodology: packs, skills, the Permissions Policy, role and capability grants | tenant | yes |
| user-owned | a person's own records inside a tenant: preferences, connections, their request receipts | tenant, owner | yes |
| client/engagement-owned | client material and the work done on it: engagements, tasks, conversations, evidence, artifacts, memory, the Procedures and registered systems that test a client's controls, Runs and every child of a Run | tenant, client, engagement | yes |
| global authentication | Better Auth identity, session, account, verification and sign-in rate-limit rows | none | no |
| platform infrastructure | machinery that holds no tenant data: the job queue, the migration record, the schema generation, the worker heartbeat, release-published platform configuration | none | no |

Rules that go with the classes:

- **Authentication and infrastructure tables never get a tenant policy to make a table count come out even.** They are protected by what the runtime role may do to them (Story 11.3), not by a scope.
- **A null scope column means the level above, never unrestricted.** No engagement means client-level: a Procedure, a registration and a binding have no engagement of their own (D1), and neither, today, does a Run (O3). No client means tenant-level: an unbound draft engagement, and a refused request that names no Procedure (D4). Story 11.4 writes each boundary so that such a row is reached through the level above it (O2), and never by a member of another tenant.
- **A partition has no row.** It takes the class of its root (`pg_partition_root`). pg-boss keeps `job_common` as a partition of `job` and adds a `queue_stats` partition per day, so their names are not stable and are never classified by name.
- **A view, materialized view or foreign table is classified like a table**, so none can become an unreviewed path around the policies. None exists at generation 61.
- **Owning a record personally never overrides a client boundary.** A notification, a read grant or a request receipt that belongs to one person keeps the client boundary beside the owner boundary (D4, D6).

## 3. Classification

One row per relation of the migrated database, schema-qualified, and one class per row. The `public` tables are the ones the Drizzle schema declares; `pgboss` is installed by the release migrator; `drizzle` holds the migration record.

| Relation | Class | Why |
|---|---|---|
| `public.audit_event_heads` | client/engagement-owned | The head of each aggregate chain; it follows its aggregate. The two tenantless chains are O1. |
| `public.audit_events` | client/engagement-owned | Every Run's Timeline and the chains of Procedures, registrations and bindings; an event follows its aggregate. The two tenantless chains are O1. |
| `public.audit_run` | client/engagement-owned | A Run tests one client's control; every `run_*` table below belongs to it. Client-level today (O3). |
| `public.auth_account` | global authentication | Better Auth credential account. |
| `public.auth_rate_limit` | global authentication | Better Auth sign-in counters, keyed by client address, before any tenant is known. |
| `public.auth_session` | global authentication | Better Auth session. |
| `public.auth_user` | global authentication | Better Auth identity; one person may belong to several tenants. |
| `public.auth_verification` | global authentication | Better Auth verification record; no served endpoint writes it. |
| `public.evidence_read_grant` | client/engagement-owned | A capability to read one artifact of one Run, bound to the person who asked; owner boundary as well. |
| `public.notification` | client/engagement-owned | Names a client's Procedure and Run and is addressed to one person; owner boundary on reads (D6). |
| `public.population_evidence` | client/engagement-owned | The frozen population bytes of one Run. |
| `public.population_execution` | client/engagement-owned | The population stage checkpoint of one Run. |
| `public.population_row` | client/engagement-owned | Rows of a client's population, reached through the Run's snapshot. |
| `public.population_snapshot` | client/engagement-owned | The reconciled population of one Run. |
| `public.population_source_binding` | client/engagement-owned | Where one client's population comes from (D1). |
| `public.procedure` | client/engagement-owned | A Procedure tests one client's control (D1). |
| `public.procedure_authoring_request` | client/engagement-owned | Drafted prose for one Procedure Version, bound to the person who asked; owner boundary as well. |
| `public.procedure_change` | client/engagement-owned | The receipt of which Drafts one configuration change minted; one receipt per client (D2). |
| `public.procedure_configuration` | platform infrastructure | Release-published model and interpreter configuration, the same for every tenant; the runtime only reads it (D3). |
| `public.procedure_succession` | client/engagement-owned | Succession between versions of one Procedure. |
| `public.procedure_version` | client/engagement-owned | A Procedure's definition, frozen once approved. |
| `public.run_agent_execution` | client/engagement-owned | The agent sign-in checkpoint of one Run. |
| `public.run_agent_turn` | client/engagement-owned | One model turn of one Run. |
| `public.run_agent_work` | client/engagement-owned | The agent work checkpoint of one Run's Work Item. |
| `public.run_control_lease` | client/engagement-owned | Who holds control of one Run. |
| `public.run_control_transfer` | client/engagement-owned | A manager's transfer of control of one Run. |
| `public.run_control_transfer_content` | client/engagement-owned | The governed reason of a control transfer. |
| `public.run_control_transfer_receipt` | client/engagement-owned | The receipt of a control transfer. |
| `public.run_conversation_content` | client/engagement-owned | The governed text of a Run conversation message. |
| `public.run_conversation_message` | client/engagement-owned | A message in one Run's conversation. |
| `public.run_deferred_pause` | client/engagement-owned | An inspection pause proposal bound to one Run's Work Item. |
| `public.run_evaluation_review` | client/engagement-owned | A human decision on one Observation's evaluation. |
| `public.run_evaluation_review_command` | client/engagement-owned | A queued human review decision for one Run. |
| `public.run_evidence` | client/engagement-owned | An Evidence artifact of one Run. |
| `public.run_evidence_capture` | client/engagement-owned | Binds a captured artifact to the Tool Action that took it. |
| `public.run_evidence_integrity` | client/engagement-owned | A post-Run integrity finding on one Run's Evidence. |
| `public.run_evidence_package` | client/engagement-owned | The sealed Evidence package of one Run. |
| `public.run_exception` | client/engagement-owned | A permanent Exception raised on one Observation. |
| `public.run_execution` | client/engagement-owned | The adapter stage checkpoint of one Run. |
| `public.run_flag` | client/engagement-owned | A flag raised on one Run. |
| `public.run_gate_check` | client/engagement-owned | One Evidence Quality Gate row of one Run. |
| `public.run_initiation_request` | user-owned | A person's own request receipt: the decision their request token recorded. It keeps the client of the Procedure it names; a refusal naming none is tenant-level (D4). |
| `public.run_interaction_command` | client/engagement-owned | A command a person gave in one Run's conversation. |
| `public.run_interaction_transition` | client/engagement-owned | A state transition of a conversation command. |
| `public.run_observation` | client/engagement-owned | An Observation of one record in one Run. |
| `public.run_observation_absence` | client/engagement-owned | The absence proof of one Observation. |
| `public.run_observation_check` | client/engagement-owned | A per-Observation Gate check. |
| `public.run_observation_evaluation` | client/engagement-owned | The evaluation of one condition on one Observation. |
| `public.run_replay_recording` | client/engagement-owned | The provider recording copied at the end of one Run. |
| `public.run_result` | client/engagement-owned | The sealed Result of one Run. |
| `public.run_result_review` | client/engagement-owned | The review revision of one Run's Result. |
| `public.run_review_snapshot` | client/engagement-owned | An expiring presentation copy of one Run's record queue, bound to one person; owner boundary as well. |
| `public.run_review_snapshot_row` | client/engagement-owned | A row of that presentation copy. |
| `public.run_session_step` | client/engagement-owned | A Session Step of one Run. |
| `public.run_step_execution` | client/engagement-owned | A Step Execution of one Run. |
| `public.run_tool_action` | client/engagement-owned | A sanitized Tool Action of one Run. |
| `public.run_wait` | client/engagement-owned | An Escalation or pause wait of one Run. |
| `public.run_work_item` | client/engagement-owned | A Work Item of one Run. |
| `public.run_workspace` | client/engagement-owned | The Agent Workspace of one Run. |
| `public.run_workspace_preview` | client/engagement-owned | The preview identity of one Run's workspace. |
| `public.schema_meta` | platform infrastructure | The applied schema generation; the migrator writes it, every process reads it at start. |
| `public.target_system_probe` | client/engagement-owned | Reachability of one registered system; follows its registration. |
| `public.target_system_registration` | client/engagement-owned | A client's system the agent may touch (D1). |
| `public.user_permission_grant` | tenant-owned | A capability grant inside a tenant (today: `run.control-transfer`) (D5). |
| `public.user_role` | tenant-owned | A person's role inside a tenant (D5); Story 11.9 turns roles into capability groups. |
| `public.worker_heartbeat` | platform infrastructure | Worker liveness, one row per host. |
| `pgboss.bam` | platform infrastructure | pg-boss internal. |
| `pgboss.job` | platform infrastructure | The job queue. Its partitions (`job_common` and any per-queue partition) take this class. A job names a Run or a command; the work it starts re-checks scope (Stories 11.6, 11.7). |
| `pgboss.job_dependency` | platform infrastructure | pg-boss internal. |
| `pgboss.queue` | platform infrastructure | pg-boss queue definitions. |
| `pgboss.queue_stats` | platform infrastructure | pg-boss statistics; its daily partitions take this class. |
| `pgboss.schedule` | platform infrastructure | pg-boss schedules. |
| `pgboss.subscription` | platform infrastructure | pg-boss subscriptions. |
| `pgboss.version` | platform infrastructure | pg-boss schema version. |
| `pgboss.warning` | platform infrastructure | pg-boss warnings. |
| `drizzle.__drizzle_migrations` | platform infrastructure | The migration record; only the migrator reads or writes it. |

## 4. Principals

### 4.1 Principal kinds

- **Member.** A person acting through their own authenticated request: every page, Server Action and route handler of the web. Story 11.4 scopes its permissive grant to the person's memberships.
- **Execution delegation.** Background work the worker does for one named person, under an authority recorded before dispatch and re-checked at every claim and resume (FR-83, FR-84). Today that is the Run pipeline for the Run's initiator (workspace provisioning, population acquisition, sign-in, adapter extraction, agent work, the Run-level Gate, completion, and the recovery re-entries of those stages) and the queued evaluation-review command for the reviewer who submitted it.
- **Maintenance principal.** A named service principal that acts for nobody and holds authority for one operation (§4.2). There is no general-purpose worker identity. A maintenance principal has no person and no membership, so the owner boundary never applies to it, and it meets the tenant, client and engagement boundaries only inside its own row predicate (D7).

### 4.2 Maintenance principals

The closed list. A principal not in this table cannot appear in §4.3 or §5, and a principal here that §5 never grants anything is a definition nobody uses; the inventory test refuses both. **Rows it may reach** is the operation's own selection: Story 11.6 writes it as that principal's policy predicate, and it is the only way the principal meets the tenant, client and engagement boundaries (D7).

| Principal | Authority | Rows it may reach | Runs today as |
|---|---|---|---|
| `authentication-audit` | Records sign-in, sign-out and refused-access events, before or without a member principal. | The `platform` chain's events and head. | `web:auth` in `apps/web/src/sign-in-route.ts`, `sign-out-route.ts`, `require-role.ts` |
| `plan-derivation` | Compiles a Draft's executable plan and records the attempt. | Draft versions with a pending plan derivation, and their Procedures' chains. | `procedures` queue job and its recovery sweep (`derivation-queue.ts`) |
| `run-recovery` | Finds a Run whose stage stopped and hands it back; the resumed work runs as that Run's execution delegation. | `RUNNING` Runs whose stage checkpoint is retrying or whose claim expired, read only. | population, adapter, agent and agent-work recovery sweeps (`population-queue.ts` `startPopulationRecovery`) |
| `wait-timeout` | Closes a wait whose deadline passed and ends its Run Inconclusive through the Run completion path (§4.4). | Runs with an open wait past its deadline, and the rows §4.4 reads and writes for them. | `waits` queue job and the wait recovery sweep (`wait-wake.ts`) |
| `workspace-reaper` | Releases the provider session of a Run that ended and copies its recording. | Ended Runs whose workspace is not released, their versions and recordings. | `workspace-reaper.ts` |
| `evidence-integrity` | Re-verifies each sealed Evidence package after its Run and records what it finds. | Ended Runs with a sealed Evidence package. | `evidence-integrity-sweep.ts` |
| `notification-delivery` | Delivers queued notifications and records each outcome. | Undelivered notifications, and the Run and wait each names. | `notification-worker.ts` |
| `evidence-read-issuer` | Issues or refuses a person's recorded Evidence read request, after re-reading their role, and requeues pending requests. | Pending read grants, and the Run, version, Evidence and requester role each names. | `evidence-read-grants` queue job and its recovery sweep (`evidence-read-grant-queue.ts`) |
| `review-snapshot-expiry` | Deletes expired record-review presentation copies. | Expired snapshots. | `startRecordReviewExpiry` in `record-review-repository.ts` |
| `evaluation-review-recovery` | Finds pending review commands and requeues them; the command runs as the reviewer's execution delegation. | Pending review commands. | `evaluation-review-queue.ts` `startEvaluationReviewRecovery` |
| `registration-probe` | Records whether each registered system answers. | Active registrations and their probe rows. | the separate probe process (`registrations/probe-runner.ts`) |
| `workspace-preview-broker` | Keeps the live preview of a Run's workspace current and serves it to a viewer, re-checking the viewer's session and role itself. | Preview rows of Runs that are `RUNNING`, `PAUSED` or `AWAITING_AUDITOR` with a local workspace `OPEN` or `PROVISIONING`, and the viewer's own session and role. | the broker (`workspace-preview-transport.ts`) and the preview sampler (`workspace-preview-session.ts`), in the worker |

### 4.3 The audit append

Every principal that records an event goes through `appendAuditEvent` in `packages/infrastructure/src/db/audit-events.ts`. Recording an event is part of the operation that records it, not a separate authority, so §5 gives each appending principal exactly the statements the append runs for the aggregates it records:

1. **The Run lock.** For every aggregate id shaped like a UUID (`isUuidText`) — a Run's, a Procedure's, a registration's or a binding's, not only a Run's — the append takes `audit_run` `FOR KEY SHARE`. For an aggregate that is not a Run no row matches, but the statement still needs the SELECT privilege, the UPDATE privilege on a column and the policies' `USING`. `platform` and `procedure-platform-configuration` are not UUIDs and take no Run lock.
2. **The chain.** It inserts the aggregate's head into `audit_event_heads` (on conflict, nothing), locks the head `FOR UPDATE`, inserts into `audit_events`, and updates the head's `last_sequence` and `last_event_hash`. It never selects from `audit_events`.
3. **Command receipts.** `projectRunInteractionEvent` (`packages/infrastructure/src/runs/run-interaction-projection.ts`) returns at once unless the payload carries a UUID `commandId`; then it selects `run_interaction_command` `FOR UPDATE`, reads the prior `run_interaction_transition` and inserts the next one. The events that carry one are the facts of a conversation command (an answered Escalation; a pause, deferred-pause, resume or stop request; a pause the worker applies; a cancellation, by the web or at a worker boundary), a control transfer, and the pause-superseded and deferred-pause-superseded events that `completeRun` appends. Any caller of `completeRun` can append those two, so every caller in §4.4 holds these grants.
4. **Narration.** For an event `packages/application/src/runs/run-conversation-events.ts` narrates (workspace created, capture registered, agent work, Observations registered, Escalation raised, pause requested, paused, resumed, control transferred, Result sealed), it reads the conversation's highest sequence and inserts a `run_conversation_message`.

| Principal | Aggregates | Command receipts | Narrated events |
|---|---|---|---|
| `member` | `platform`, Procedure, Run, registration, binding | yes | yes |
| `execution delegation` | Run | yes | yes |
| `authentication-audit` | `platform` | no | no |
| `plan-derivation` | Procedure | no | no |
| `wait-timeout` | Run | yes | yes |
| `workspace-reaper` | Run | no | no |
| `evidence-integrity` | Run | no | no |
| `notification-delivery` | Run | no | no |
| `evidence-read-issuer` | Run | no | no |

What the table requires of §5, each rule held by the inventory test:

- every principal with `INSERT` on `audit_events` is in this table, and every principal in this table has that `INSERT`;
- each holds `SELECT`, `INSERT`, `UPDATE` (or `UPDATE(last_sequence, last_event_hash)`) and `LOCK` on `audit_event_heads`;
- each with a UUID aggregate (Procedure, Run, registration, binding) holds `SELECT` and `LOCK` on `audit_run`;
- "Command receipts: yes" requires `SELECT` and `LOCK` on `run_interaction_command`, and `SELECT` and `INSERT` on `run_interaction_transition`;
- "Narrated events: yes" requires `SELECT` and `INSERT` on `run_conversation_message`;
- a maintenance principal marked "no" holds none of those projection or narration grants: its events carry no `commandId` and none is narrated, so such a grant would be one it never uses.

The aggregates in use at generation 61 are `platform` (sign-in, sign-out, refused access, users, roles and permission grants), each Run, each Procedure, `procedure-platform-configuration` (the release script, §4.5), and each registration and binding.

### 4.4 The Run completion path

`completeRun` in `packages/application/src/runs/complete-run.ts` is the one way a Run reaches a terminal state. Four callers reach it: the Run's execution delegation; a member cancelling a Run that no worker holds, or answering an Escalation with Abort; a member whose read of an active Run's Evidence fails verification, which fails the Run; and `wait-timeout`. Whoever reaches it reads the Gate rows, the evaluations and their reviews, the population facts and rows, the package artifacts and the missing frames, and writes the Result, the Evidence package seal, the abandoned Evidence reservations, the Run's state, the withdrawal of an open wait and the settlement of a deferred pause. It appends the Result-sealed event, which is narrated, and can append the pause-superseded and deferred-pause-superseded events, which carry a `commandId` (§4.3). §5 carries those grants on each of the three principal kinds.

### 4.5 Outside the runtime

- **The release migrator** (Story 11.3) owns every table. It runs migrations and backfills and the release scripts `scripts/seed-identity.mts`, `scripts/seed-northstar.mts` and `scripts/apply-platform-configuration.mts`, and it queues plans for existing Drafts at migration time. It is not a runtime principal and has no inventory row.
- **Infrastructure duties** touch only platform-infrastructure tables: pg-boss queue maintenance, the worker heartbeat and the schema-generation check at start. They need table privileges (Story 11.3), not a principal.
- **Better Auth** reads and writes only global-authentication tables, through the sign-in, session and sign-out handlers.

## 5. Policy inventory

One row per protected table, derived from the production code's access paths: a static audit of the application's own statements on `main` at `429e08c` — the web, the worker, the application and infrastructure packages and the operator scripts, every read, write and locking read traced to the process that runs it. Trigger functions are not application statements: decision D8 handles what they read, never by widening a grant here. Story 11.4 proves the rows by running every suite under the policies; a grant found missing there is added here, with the path that needs it, in the same commit.

How to read a row:

- **Boundaries** are the restrictive policies. `tenant`, `client` and `engagement` compare the row's scope with the principal's memberships; a null scope column means the level above (§2), never unrestricted. `owner` compares the person the row belongs to (its recipient, actor or requester) with the principal's person, and applies to members and execution delegations only (D6). A bare `owner` restricts every command; `owner(SELECT)` restricts only the commands it lists. A user-owned table has a bare `owner`. A boundary appears at most once in a row.
- A maintenance principal meets the `tenant`, `client` and `engagement` boundaries only inside its own row predicate, **Rows it may reach** in §4.2 (D7).
- **Member** and **Execution delegation** list the commands that kind's permissive grant allows, whatever the person's role. The domain gating table still decides capability.
- **Maintenance principals** list `` `principal`: COMMANDS ``, one entry per principal, separated by `;`. Each entry grants at least one command, and a principal appears at most once in a row.
- The commands are `SELECT`, `INSERT`, `UPDATE`, `DELETE` and `LOCK`, and no other. `—` means no grant. `UPDATE(a, b)` is an update of those columns only; Story 11.6 turns it into a column privilege. An unqualified `UPDATE` is a row-level grant.
- `LOCK` is a locking read: `FOR UPDATE`, `FOR NO KEY UPDATE`, `FOR SHARE` or `FOR KEY SHARE`. PostgreSQL requires the SELECT privilege and the UPDATE privilege on a column for it, and applies the SELECT and UPDATE policies' `USING`, although nothing changes. So a cell that grants `LOCK` also grants `SELECT`, and a `LOCK` without `UPDATE` is built as an UPDATE policy whose `WITH CHECK` is false: the lock succeeds and no update passes. Without `LOCK` the append of §4.3 would be refused.
- A cascade from a parent (`ON DELETE CASCADE`) needs no grant on the child: PostgreSQL runs referential actions as the owner of the referencing table.

| Table | Boundaries | Member | Execution delegation | Maintenance principals |
|---|---|---|---|---|
| `public.audit_event_heads` | tenant, client, engagement | SELECT, INSERT, UPDATE, LOCK | SELECT, INSERT, UPDATE, LOCK | `authentication-audit`: SELECT, INSERT, UPDATE(last_sequence, last_event_hash), LOCK; `evidence-integrity`: SELECT, INSERT, UPDATE(last_sequence, last_event_hash), LOCK; `evidence-read-issuer`: SELECT, INSERT, UPDATE(last_sequence, last_event_hash), LOCK; `notification-delivery`: SELECT, INSERT, UPDATE(last_sequence, last_event_hash), LOCK; `plan-derivation`: SELECT, INSERT, UPDATE(last_sequence, last_event_hash), LOCK; `wait-timeout`: SELECT, INSERT, UPDATE(last_sequence, last_event_hash), LOCK; `workspace-reaper`: SELECT, INSERT, UPDATE(last_sequence, last_event_hash), LOCK |
| `public.audit_events` | tenant, client, engagement | SELECT, INSERT | SELECT, INSERT | `authentication-audit`: INSERT; `evidence-integrity`: INSERT; `evidence-read-issuer`: INSERT; `notification-delivery`: INSERT; `plan-derivation`: INSERT; `wait-timeout`: INSERT; `workspace-reaper`: INSERT |
| `public.audit_run` | tenant, client, engagement | SELECT, INSERT, UPDATE, LOCK | SELECT, UPDATE, LOCK | `evidence-integrity`: SELECT, LOCK; `evidence-read-issuer`: SELECT, LOCK; `notification-delivery`: SELECT, LOCK; `plan-derivation`: SELECT, LOCK; `run-recovery`: SELECT; `wait-timeout`: SELECT, UPDATE(state, revision), LOCK; `workspace-preview-broker`: SELECT; `workspace-reaper`: SELECT, UPDATE(state), LOCK |
| `public.evidence_read_grant` | tenant, client, engagement, owner | SELECT, INSERT, UPDATE, LOCK | — | `evidence-read-issuer`: SELECT, UPDATE(status, denial_code, signed_url, signed_url_expires_at, capability_media_type, capability_digest, capability_size), LOCK |
| `public.notification` | tenant, client, engagement, owner(SELECT) | SELECT, INSERT | INSERT | `notification-delivery`: SELECT, UPDATE(delivered_at, in_app_outcome, email_outcome, email_outcome_at) |
| `public.population_evidence` | tenant, client, engagement | SELECT, UPDATE | SELECT, INSERT, UPDATE | `evidence-integrity`: SELECT; `wait-timeout`: SELECT, UPDATE(state, raw_digest, size) |
| `public.population_execution` | tenant, client, engagement | SELECT | SELECT, INSERT, UPDATE | `run-recovery`: SELECT |
| `public.population_row` | tenant, client, engagement | SELECT | SELECT, INSERT | `wait-timeout`: SELECT |
| `public.population_snapshot` | tenant, client, engagement | SELECT | SELECT, INSERT | `wait-timeout`: SELECT |
| `public.population_source_binding` | tenant, client, engagement | SELECT, INSERT, UPDATE, LOCK | — | — |
| `public.procedure` | tenant, client, engagement | SELECT, INSERT | SELECT | — |
| `public.procedure_authoring_request` | tenant, client, engagement, owner | SELECT, INSERT, UPDATE, LOCK | — | — |
| `public.procedure_change` | tenant, client, engagement | SELECT, INSERT | — | — |
| `public.procedure_succession` | tenant, client, engagement | SELECT, INSERT | SELECT | — |
| `public.procedure_version` | tenant, client, engagement | SELECT, INSERT, UPDATE, LOCK | SELECT | `evidence-read-issuer`: SELECT; `plan-derivation`: SELECT, UPDATE(plan_attempts, compiled_plan, plan_status, plan_failure_reason, plan_derivable, plan_input_digest, updated_at), LOCK; `workspace-reaper`: SELECT |
| `public.run_agent_execution` | tenant, client, engagement | SELECT | SELECT, INSERT, UPDATE | `run-recovery`: SELECT |
| `public.run_agent_turn` | tenant, client, engagement | SELECT | SELECT, INSERT, UPDATE | — |
| `public.run_agent_work` | tenant, client, engagement | SELECT, UPDATE | SELECT, INSERT, UPDATE | `run-recovery`: SELECT |
| `public.run_control_lease` | tenant, client, engagement | SELECT, INSERT, UPDATE | — | — |
| `public.run_control_transfer` | tenant, client, engagement | SELECT, INSERT | — | — |
| `public.run_control_transfer_content` | tenant, client, engagement | SELECT, INSERT, LOCK | — | — |
| `public.run_control_transfer_receipt` | tenant, client, engagement | SELECT, INSERT | — | — |
| `public.run_conversation_content` | tenant, client, engagement | SELECT, INSERT, LOCK | — | — |
| `public.run_conversation_message` | tenant, client, engagement | SELECT, INSERT | SELECT, INSERT | `wait-timeout`: SELECT, INSERT |
| `public.run_deferred_pause` | tenant, client, engagement | SELECT, INSERT, UPDATE | SELECT, UPDATE | `wait-timeout`: SELECT, UPDATE(state, superseded_at, superseded_reason) |
| `public.run_evaluation_review` | tenant, client, engagement | SELECT | SELECT, INSERT | `wait-timeout`: SELECT |
| `public.run_evaluation_review_command` | tenant, client, engagement | SELECT, INSERT, LOCK | SELECT, UPDATE, LOCK | `evaluation-review-recovery`: SELECT, LOCK |
| `public.run_evidence` | tenant, client, engagement | SELECT, UPDATE | SELECT, INSERT, UPDATE | `evidence-integrity`: SELECT; `evidence-read-issuer`: SELECT; `wait-timeout`: SELECT, UPDATE(state, digest, size) |
| `public.run_evidence_capture` | tenant, client, engagement | SELECT | SELECT, INSERT | `wait-timeout`: SELECT |
| `public.run_evidence_integrity` | tenant, client, engagement | SELECT, INSERT | SELECT | `evidence-integrity`: SELECT, INSERT; `wait-timeout`: SELECT |
| `public.run_evidence_package` | tenant, client, engagement | SELECT, INSERT | SELECT, INSERT | `evidence-integrity`: SELECT; `wait-timeout`: SELECT, INSERT |
| `public.run_exception` | tenant, client, engagement | SELECT | SELECT, INSERT | — |
| `public.run_execution` | tenant, client, engagement | SELECT | SELECT, INSERT, UPDATE | `run-recovery`: SELECT |
| `public.run_flag` | tenant, client, engagement | SELECT, INSERT | — | — |
| `public.run_gate_check` | tenant, client, engagement | SELECT | SELECT, INSERT | `wait-timeout`: SELECT |
| `public.run_initiation_request` | tenant, client, owner | SELECT, INSERT | — | — |
| `public.run_interaction_command` | tenant, client, engagement | SELECT, INSERT, LOCK | SELECT, LOCK | `wait-timeout`: SELECT, LOCK |
| `public.run_interaction_transition` | tenant, client, engagement | SELECT, INSERT | SELECT, INSERT | `wait-timeout`: SELECT, INSERT |
| `public.run_observation` | tenant, client, engagement | SELECT | SELECT, INSERT, LOCK | `wait-timeout`: SELECT |
| `public.run_observation_absence` | tenant, client, engagement | SELECT | SELECT, INSERT | — |
| `public.run_observation_check` | tenant, client, engagement | SELECT | SELECT, INSERT | — |
| `public.run_observation_evaluation` | tenant, client, engagement | SELECT | SELECT, INSERT | `wait-timeout`: SELECT |
| `public.run_replay_recording` | tenant, client, engagement | SELECT | SELECT, INSERT | `workspace-reaper`: SELECT, INSERT |
| `public.run_result` | tenant, client, engagement | SELECT, INSERT | SELECT, INSERT, UPDATE, LOCK | `wait-timeout`: SELECT, INSERT |
| `public.run_result_review` | tenant, client, engagement | SELECT | SELECT, INSERT, UPDATE, LOCK | — |
| `public.run_review_snapshot` | tenant, client, engagement, owner | SELECT, INSERT, DELETE | — | `review-snapshot-expiry`: SELECT, DELETE, LOCK |
| `public.run_review_snapshot_row` | tenant, client, engagement, owner | SELECT, INSERT | — | — |
| `public.run_session_step` | tenant, client, engagement | SELECT | SELECT, INSERT, UPDATE | — |
| `public.run_step_execution` | tenant, client, engagement | SELECT | SELECT, INSERT, UPDATE | — |
| `public.run_tool_action` | tenant, client, engagement | SELECT | SELECT, INSERT | `wait-timeout`: SELECT |
| `public.run_wait` | tenant, client, engagement | SELECT, UPDATE, LOCK | SELECT, INSERT, UPDATE, LOCK | `notification-delivery`: SELECT, LOCK; `wait-timeout`: SELECT, UPDATE(closed_at, closure_kind, answer_option_id, actor), LOCK |
| `public.run_work_item` | tenant, client, engagement | SELECT | SELECT, INSERT, UPDATE | — |
| `public.run_workspace` | tenant, client, engagement | SELECT | SELECT, INSERT, UPDATE | `run-recovery`: SELECT; `workspace-preview-broker`: SELECT; `workspace-reaper`: SELECT, INSERT, UPDATE |
| `public.run_workspace_preview` | tenant, client, engagement | SELECT | SELECT, INSERT, UPDATE | `workspace-preview-broker`: SELECT, UPDATE(privacy_epoch, mode, sequence, captured_at, capture_completed_at, expires_at) |
| `public.target_system_probe` | tenant, client, engagement | SELECT | — | `registration-probe`: SELECT, INSERT, UPDATE(state, observed_at, observed_by) |
| `public.target_system_registration` | tenant, client, engagement | SELECT, INSERT, UPDATE, LOCK | — | `registration-probe`: SELECT |
| `public.user_permission_grant` | tenant | SELECT, INSERT, UPDATE | — | — |
| `public.user_role` | tenant | SELECT, INSERT, UPDATE, DELETE, LOCK | SELECT | `evidence-read-issuer`: SELECT; `workspace-preview-broker`: SELECT |

## 6. How this contract is held

- **The unclassified-table test** (`tests/integration/table-classification.test.ts`, against a migrated PostgreSQL 18) proves that §3 classifies exactly the relations the database holds. It lists every table, partitioned table, view, materialized view and foreign table outside the system schemas, resolves each partition to its root with `pg_partition_root`, and compares both ways: a relation with no row fails and is named, and a row naming a relation the database does not hold fails and is named. A row naming a partition fails. In a transaction that always rolls back, it creates a table, a view, a materialized view and a partitioned table with one partition, and proves the check names the first four and not the partition. Foreign tables are in the query but not in the probe, because creating one needs a foreign-data wrapper.
- **The inventory test** (`tests/unit/tenancy-inventory.test.ts`, no database) proves the document against itself and against the Drizzle schema. Every Drizzle table is classified; class and relation names are well formed; every protected table has exactly one inventory row, and no authentication or infrastructure table has one; each row carries its class boundaries, each boundary at most once, and a user-owned row a bare `owner`; commands and maintenance principals come from the closed lists; every §4.2 principal is used and says which rows it may reach; each maintenance entry is well formed and grants something, each principal appears at most once per row and each command at most once per principal; `LOCK` comes with `SELECT`; an `UPDATE(...)` names only real columns; some principal reads every protected table; the rules of §4.3 hold; each decision of §7 is held and names its story; and the rules Story 11.4 builds policies from are stated in §1, §2 and §5. Each case has been proven by breaking its rule in this document and watching that case fail — the case, never a parse error.
- **What neither proves.** Both tests read this file; neither runs a statement under a policy. Story 11.4's suites prove §5 by running the product under the policies, and they prove the application-statement grants only: what a trigger function reads is D8's.
- **The rule for changes.** A migration that adds, renames or drops a relation changes §3 in the same commit, and §5 when the relation is protected. `tests/integration/schema-compat.test.ts` still pins the exact `public` table list beside it.

## 7. Decisions

Judgment calls the planning documents do not settle. Each names the story that settles it.

### Decided here

The tests hold these; each names the story that confirms it before building on it.

- **D1. Procedures, registrations and Population Source bindings are client material:** client/engagement-owned at client level, with no engagement of their own. A Procedure tests one client's control against that client's systems and population; versions, successions and probes follow their parent. The alternative, tenant-owned configuration shared across clients, is refused. Confirmed by Story 11.2 before it adds `client_id` to them.
- **D2. `procedure_change` is client material.** A registration or binding change mints Drafts of one client, and the release script writes one receipt per client for a platform change. Client/engagement-owned at client level: as tenant-owned it let any client's member read another client's Draft ids. Story 11.2 keys it by client.
- **D3. `procedure_configuration` stays platform infrastructure.** It is release-published, identical for every tenant, and the runtime only reads it. A tenant's own model policy is Story 13.14a's `model-policy-v1`, a new tenant-owned table then.
- **D4. `run_initiation_request` is user-owned and keeps a client boundary,** because owning a record never overrides a client boundary. A request naming an existing Procedure carries that Procedure's client; a refusal naming none carries no client and is tenant-level. Story 11.2 adds `tenant_id`, `owner_user_id` and a nullable `client_id`.
- **D5. `user_role` and `user_permission_grant` are tenant-owned.** A role and a capability grant hold inside one tenant. Story 11.9 decides whether `tenant_membership` absorbs them.
- **D6. The owner boundary is a person's (members and execution delegations only), and restricts only the commands its row names.** People address notifications to others, so `notification` is `owner(SELECT)`: a person reads only their own, and may still create one addressed to somebody else. `evidence_read_grant`, `procedure_authoring_request`, `run_review_snapshot` and `run_review_snapshot_row` keep a bare `owner`, so a member's opportunistic purge of other people's expired record-review snapshots is narrowed to their own, and `review-snapshot-expiry` removes the rest. Confirmed by Story 11.4.
- **D7. A maintenance principal has no person and no membership.** It meets the tenant, client and engagement boundaries only inside its own row predicate (Rows it may reach, §4.2), per C1's "narrow, operation-specific authority expressed as their own RLS policies". Story 11.6 writes the predicates; Story 11.4 lets the boundaries admit a maintenance principal only through them.
- **D8. Trigger functions are not grants.** §5 lists application statements. The 38 trigger functions that read a table other than their own become hardened `SECURITY DEFINER` functions (fixed safe `search_path`, `EXECUTE` revoked from `PUBLIC`) owned by a role whose reads the policies do not narrow, so a guard always sees the rows it guards and needs no runtime grant. Listing their reads in §5 instead was refused: it widens every writer's grants — the guards on `run_conversation_message` and `run_interaction_transition` read `audit_events` when `wait-timeout` writes those tables, yet no maintenance principal's own statements read `audit_events`, and §5 gives none of them that read — and a guard that cannot see a row passes silently, which no suite detects. Story 11.3 decides the owning role; Story 11.4 converts them before `FORCE` is enabled (Proposal 3a carried the same hardening questions for the binding function into 3d).

### Open

The inventory depends on these and does not decide them; each names the story that must.

- **O1. Where the two tenantless chains live.** `platform` holds the sign-in, sign-out, refused-access and identity events of people who may belong to several tenants; `procedure-platform-configuration` holds release events. Open with them: the boundary of a refused-access event that has no member. Story 11.2 decides, because it adds `tenant_id` to `audit_events` and `audit_event_heads`; Story 11.8 binds historical chains afterwards (it was named first, and is too late). `bind_permission_event` reads `platform` events as the administrator (D8).
- **O2. How the client boundary is met, with no client membership.** A row with an engagement meets it through that engagement; a client-level row (engagement null) is reached by a member of any engagement of its client — the reading Story 11.9's "a global Audit manager without engagement membership reaches nothing" implies. Stories 11.2 and 11.4.
- **O3. A Run's engagement.** D-3a-2 puts Engagements beside `audit_run`, so every Run and its children are client-level today, and nothing in the plan gives a Run an engagement. Story 11.2 backfills them so.
- **O4. Principal resolution.** `user_role` is tenant-owned, so under `FORCE` a person cannot read their own roles before the tenant is set; yet the web reads the role on every request, and the preview broker authorizes a viewer by session and role. A narrow resolver function, or an owner policy on the membership tables: Story 11.4 decides, with the wrapper.
- **O5. Database roles for maintenance principals.** With one runtime role, a column privilege is the union over every principal and narrows nothing (members hold row-level `UPDATE` on `audit_run`). Preferred: each maintenance principal is its own `NOLOGIN` role that the wrapper enters with `SET LOCAL ROLE`. Story 11.3 creates them; Story 11.6 grants them.

## 8. Findings for later stories

What the audit behind §5 found that this story does not change:

1. **Plan derivation writes the whole `procedure_version` row.** `derivePlan` saves through `updateVersion` in `packages/infrastructure/src/procedures/procedure-repository.ts`, which sets every column, not only the plan fields §5 grants `plan-derivation`. Story 11.6 narrows the writer before the column privilege can apply.
2. **Three member paths write a Run's terminal records.** Cancelling a Run that no worker holds, answering an Escalation with Abort, and a failed verification when a member reads an active Run's Evidence all reach §4.4. Story 11.4's member grants must include those writes, or the policies refuse the product's own cancel and integrity paths.
3. **Recording an event for any UUID aggregate locks `audit_run`.** Every append to a Run, Procedure, registration or binding aggregate takes `audit_run` `FOR KEY SHARE` (§4.3), whether or not a Run row matches, so every principal that records such an event needs `SELECT` and `LOCK` on `audit_run` — `plan-derivation` included, for a Procedure's chain.
4. **The chain verifier has no production caller.** `PostgresAuditChainReader.verify` runs only in tests. Story 11.8's tenant export needs one that production can reach.
5. **The bootstrap script writes roles without an event.** `scripts/seed-identity.mts` sets `user_role` with no audit event, by design; it runs as the migrator, outside the runtime policies.
6. **The runtime locks `auth_user` rows.** Role administration and control transfer take a person's `auth_user` row `FOR UPDATE` to serialize changes to that person (`identity/role-repository.ts` `lockUser`, `runs/run-control-transfer-repository.ts`). The table is global authentication, so no policy applies; Story 11.3 must still give the runtime role the UPDATE privilege on one of its columns, or the lock is refused.
7. **Global authentication has no policy, so member reads of `auth_user` cross tenants.** The user list (`listUsers` in `packages/infrastructure/src/identity/role-repository.ts`, every row's name and address with a left join to `user_role`), the directory search (`pageUsers`, `countUsers`) and name resolution (`namesFor`) read people of every tenant. Story 11.4 or 11.9 joins those reads through membership.
8. **The workspace release rewrites `audit_run.state` through the checkpoint writer.** `releaseWorkspace` saves through `context.save` (`packages/application/src/runs/provision-workspace.ts`), which upserts `run_workspace` and sets `audit_run.state` to the state the Run already has (`packages/infrastructure/src/runs/workspace-repository.ts`). That is why `workspace-reaper` holds `INSERT` on `run_workspace` and `UPDATE(state)` on `audit_run`. Story 11.6 gives the release its own writer.
9. **The preview sampler writes outside any job claim.** `WorkspacePreviewSession` (`packages/infrastructure/src/runs/workspace-preview-session.ts`) publishes the preview on a timer while its Run is `RUNNING`, `PAUSED` or `AWAITING_AUDITOR`, outside the claim of the job that provisioned the workspace. Story 11.7 routes it through the wrapper as `workspace-preview-broker`.
