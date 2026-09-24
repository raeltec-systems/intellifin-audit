# Proposal 3a of 7 — Architecture: foundations (tenancy, engagement and task, Mandate, connectors and credentials)

Status: draft for owner review, 2026-09-24. Proposal 3 is split into 3a (foundations), 3b (sources, evidence, artifacts, execution environment), 3c (agent loop, memory, skills and packs, promotion) and 3d (spine revision 5 text and contract list).
Baseline facts checked on `main` `c18ad36`: no table carries a tenant column; no Row-Level Security; no retrieval index; six `UnitOfWork` classes and 43 `db.transaction(` sites in `packages/infrastructure`; `user_permission_grant` (revisioned, revocable) exists; conversation content is AES-256-GCM under its own key (`RUN_CONVERSATION_CONTENT_KEY`); worker-only secrets are enforced in `config.ts` and by dependency-cruiser rules (`no-credential-resolver-in-web`, `no-browser-execution-in-web`, `no-agent-model-in-web`, `no-evidence-store-in-web`).

Each change below states: (1) requirement mapping and the contracts it supersedes or extends; (2) implementation approach — reused, generalised, introduced — with ownership of state, authorisation, credentials and execution; (3) failure and verification approach; and, explicitly, any change to an existing safeguard.

---

## C1 — Tenancy and scope enforcement

**(1) Requirements:** FR-53, FR-54, FR-83, FR-84; supports FR-80 (retrieval scope) and FR-65. Extends AD-8 and AD-11 (tenant isolation leaves the Deferred list). No contract is superseded; every new contract in 3b–3c inherits this one.

**(2) Approach**

- *Introduced:* `tenant`, `tenant_membership` (user × tenant × role), `client`, `engagement_membership` (user × engagement × role). Every protected table added from now on carries `tenant_id NOT NULL`, and `client_id` / `engagement_id` / `owner_user_id` where the record's meaning requires them (FR-53). Tenant-wide records (methodology packs, skills) carry `tenant_id` only; user-scoped records (preferences, connections) carry `tenant_id` + `owner_user_id`; engagement records carry all three.
- *Storage enforcement:* PostgreSQL **Row-Level Security** on every scoped table, with policies that read a transaction-local setting (`app.actor_id`, `app.tenant_id`) and join to membership tables. The setting is written by **one** transaction wrapper in infrastructure, from the authenticated session's membership — never from a request parameter. The six existing `UnitOfWork` classes and the raw `db.transaction(` sites are routed through that wrapper (a mechanical migration; the wrapper refuses to open a scoped transaction with no principal). The application's own repository filters stay: RLS is the second lock, not the only one.
- *Existing tables:* the current 66 tables gain `tenant_id` by migration, backfilled to the owner's single-owner tenant (decision 3). Their RLS policies are enabled in the same release so the Run/Procedure path is inside the boundary too.
- *Background execution (FR-84):* an `execution_delegation` record (delegating user, tenant, engagement, scope, approved-by, revoked-at) is created when a task is started or a check is promoted; a worker job carries the delegation id, opens its transactions as that principal, and re-reads the delegation's `revoked_at` and the delegating user's current membership at each claim and resume (FR-83). No job ever runs as "the worker".
- *Retrieval:* there is no index today. Any index introduced in 3c (memory, engagement context) stores `tenant_id` and `engagement_id` in each row and filters by scope **before** ranking, inside the same RLS boundary. Caches and summaries (FR-87) are stored records with the same scope, never process-wide.
- *Ownership:* the domain owns the scope model (`packages/domain/src/identity/scope.ts`: tenant, client, engagement, membership, role); the application owns `requireScope`/`resolvePrincipal`; infrastructure owns the RLS wrapper and policies. Authority is derived from `tenant_membership`, `engagement_membership` and `user_permission_grant` (reused, revisioned, revocable), never from an id in a message or URL — ids are selectors that the wrapper checks against membership.

**(3) Failure and verification**

- Negative tests in `tests/integration`: two synthetic tenants, two clients, two engagements; a member of one attempts every read, write, retrieval, export, background claim and connection use across the boundary through the real repositories AND through raw SQL under the wrapper; every attempt must return nothing or refuse. A forged `engagement_id` in a request body or URL must refuse at `requireScope` before any query.
- RLS proof: with policies enabled and a wrong `app.tenant_id`, a `SELECT *` on every scoped table returns zero rows; a migration test asserts every scoped table has RLS enabled and a policy (a table added without one fails CI, the `schema-compat` pattern).
- Delegation tests: a revoked delegation, a removed membership and a downgraded grant each stop a queued and a resumed job before dispatch; the job records the refusal and the reason.
- Run before any personal account is connected (decision 3) and on every release.

**Changes to existing safeguards:** the audit chain, evidence rows and Run tables gain `tenant_id`; canonicalisation and historical chain verification are unchanged (the column is outside the hashed envelope). Denial events for cross-scope attempts join the `security.` family. The "web never reads object storage" rule is unchanged.

---

## C2 — Engagement and Agent Task aggregates

**(1) Requirements:** FR-52, FR-55, FR-56, FR-57, FR-59, FR-87, FR-88. Extends AD-3 (durable incremental execution), AD-16 (durable waits), AD-17 (Timeline/SSE) and `durable-escalation-v1`, `run-pause-v1`, `run-request-token-v1`. Does not change `executable-plan-v1`, `run-result-v1`, `run-level-gate-v1`: those remain the recurring-check path.

**(2) Approach**

- *Introduced:* `engagement` (draft-capable: every field but tenant and creator nullable at creation; FR-52), `conversation` (engagement-scoped thread; messages reuse the immutable-metadata + encrypted-content split of `run_conversation_message` with a new owner key), `agent_task` (owner, engagement, conversation, mandate digest, state machine `QUEUED → RUNNING → WAITING → PAUSED → COMPLETED | CANCELED | FAILED`, revision, lease, budget), `task_step` (the step ledger: tool id, effect class, arguments digest, sanitised result reference, receipt state `requested | accepted | confirmed | unknown | refused`, outcome), `task_wait` (kinds `clarify`, `confirm-action`, plus the existing closed-option kinds), `task_interaction_command` (the receipt ledger, same transitions as `run_interaction_command`).
- *Reused, keyed by task:* the claim/lease/revision guard from the agent phase (`guarded`), the controller lease (`run_control_lease` shape), the one-open-wait invariant and deadline job (`run_wait` mechanics, pg-boss singleton `wait:<id>`), the receipt ledger and "first use of a request key decides" rule, the audit chain (aggregate-generic), the live channel (`openRunTimelineStream` generalised to any chained aggregate), pause-at-boundary and cancel semantics.
- *Not relaxed:* `audit_run.version_id` stays `NOT NULL`; a task never writes a Result, Gate row or Exception. Those exist only on the Run path, reached by promotion (3c).
- *Interruption semantics (FR-88):* every external-effect step is written `requested` with its bound material details **before** dispatch, in its own committed transaction; the dispatch happens outside any database transaction; the result is written in a second transaction. Recovery after a crash reads the ledger: a `requested` step with no attempt record is re-dispatched only if the connector declares idempotency for that operation, otherwise it becomes `unknown` and the task waits (`confirm-action`) for a person. A stop request sets a marker honoured at the next boundary; the UI shows "stop requested" until the worker records cessation.
- *Ownership:* domain owns the task state machine and wait rules; application owns the commands (`startTask`, `pauseTask`, `answerWait`, `confirmAction`, `cancelTask`) and the step-ledger writer; infrastructure owns storage and the queue. Execution is worker-only.

**(3) Failure and verification**

- Race tests in the existing style: two claimants on one task (one wins, the loser's writes roll back); a stale-revision resume is refused; a lease that expires mid-step is fenced at the next boundary.
- Crash-point tests at the three FR-88 points (before dispatch, after dispatch before receipt, after receipt): restart the worker and assert exactly one external effect where reconciliation is possible and a `confirm-action` wait where it is not.
- A stop requested during an in-flight external effect: the effect completes, the receipt is recorded, the task ends `CANCELED` with the performed action visible and never described as undone.
- SSE contract test: a task stream replays `seq > cursor` with no gap or duplicate, the AD-17 property.

**Changes to existing safeguards:** AD-7's clause "free text from humans is never passed to the model" is replaced (3d): messages are model input on the request channel; authority still changes only through typed commands. AD-16's "no model conversation state is persisted across a wait" is replaced by "governed, scoped, encrypted transcript state is persisted and re-supplied as inert context; the Mandate is re-derived on resume."

---

## C3 — Mandate and the authorisation gate

**(1) Requirements:** FR-3, FR-60, FR-61, FR-62, FR-83. Supersedes `tool-action-v1`'s scope source and action vocabulary; keeps its gate shape. Amends AD-4 and AD-9 (3d).

**(2) Approach**

- *Introduced:* `mandate_policy` (administrator ceiling per tenant: allowed connectors, effect classes, confirmation defaults, budgets), `engagement_mandate` (the auditor's grant for an engagement: connections named, source locations, output locations, effect classes enabled within the ceiling, confirmation choices). The domain computes the **effective Mandate** = ceiling ∩ grant ∩ engagement scope ∩ the user's current connected access, as a canonical-JSON document with a SHA-256 digest (the registration-digest pattern), and freezes the digest on the task.
- *Gate:* `authorizeToolCall(mandate, call)` in `packages/domain/src/mandate/`, the `authorizeToolAction` shape: pure, ordered rules, first refusal wins, closed denial vocabulary, `Object.hasOwn`/`includes` over request input. Order: connection permitted → operation declared by the connector → effect class enabled → resource inside the permitted location class for that effect (a source location is never writable, whatever the operation is called) → parameters valid against the declared schema → budget → confirmation satisfied if required. Called at the port call site in application (`performToolCall`), never in an adapter.
- *Resource boundary (FR-3):* locations are typed per connector (a Drive folder id, a mailbox and label, a calendar id, a URL origin and path) and classified `source` or `output` on the engagement Mandate. The sandbox (3b) mounts sources read-only and has no connector access at all; a browser action's write is refused by the same location rule as a connector write. Reclassifying a location from source to output is an engagement Mandate change: audited, and refused while a snapshot from that location is registered as evidence for an open artifact unless a second person approves.
- *Re-derivation (FR-83):* at every dispatch, resume and retry the effective Mandate is recomputed from current grants and membership; if it is **narrower** than the frozen digest, the narrower one applies and the step is refused with `mandate-narrowed`; if wider, the frozen one still applies until the auditor re-freezes.
- *Denial vs clarification:* a gate refusal is `security.action-denied`, terminal for that step, never retried and never re-attempted through another tool; a schema failure for a missing parameter is a `clarify` wait, not a denial.
- *Ownership:* domain (policy computation, gate), application (call-site enforcement, receipts), infrastructure (storage). The model never sees the Mandate document; it sees only the tool descriptors the Mandate permits.

**(3) Failure and verification**

- Unit: every rule of the gate has a killing test; a table walks (effect class × location class × operation) and asserts the refusal vocabulary; source-write through connector, script and browser each refuse.
- Mutation harness (the existing `verify-*-mutations.mjs` pattern): remove the location rule, the re-derivation, or the "narrower wins" branch, and a named test must fail.
- Integration: revoke a grant between dispatch and resume; downgrade a connection's scope at the provider (simulated); both refuse before I/O and record the reason.

**Changes to existing safeguards:** `PERMITTED_READ_ACTIONS` and the test banning write verbs stay for Target System registrations on the Run path; the connector vocabulary has effect classes instead, and the *resource* rule carries the source-protection guarantee that the verb ban carried before. `CredentialProvider.describe`'s "read-only or refuse" wall stays for registrations; connections use the capability declaration in C4.

---

## C4 — Connector framework, connections, credential broker, model-data policy

**(1) Requirements:** FR-63, FR-64, FR-65, FR-66, FR-67, FR-68, FR-89. Extends `credential-containment-v1`, `agent-workspace-v1` (the browser becomes one connector), `workspace-capability-v1` (tokens are capabilities) and AD-4/AD-10.

**(2) Approach**

- *Connector framework (introduced):* `ConnectorDescriptor` (id, version, operations: name, effect class, parameter schema, confirmation default, idempotency capability `none | key | lookup`, location types), a `ConnectorPort` in application implemented per provider in infrastructure, and a shared conformance suite every adapter must pass (refusal, partial result, transport failure, idempotent retry, receipt shape, honest empty/unreachable distinction). Internal tools (search context, run analysis, revise artifact, propose memory, request decision, promote check) implement the same descriptor and go through the same gate and ledger; they are not connectors but share the invocation model (FR-64).
- *Connections (introduced):* `connection` (tenant, owner user, connector, account label, scopes granted, state `active | disabled | revoked`, created/last-used/disabled-at) and `connection_secret` (encrypted refresh/access tokens, AES-256-GCM under a **new** key `CONNECTION_SECRET_KEY`, AAD-bound to the connection id — the conversation-content pattern, separate key). Disconnect sets `state = disabled` in the same transaction that audits it; the gate reads state, so use stops immediately (FR-63); provider-side revocation is a queued worker job that can fail without reopening access.
- *Credential broker (the narrow components FR-63 asks Proposal 3 to name):*
  - `apps/web/app/api/connections/[connector]/callback/route.ts` — receives the provider's authorisation response. **Recommended:** it stores the single-use authorisation code, encrypted, with a two-minute expiry, and enqueues the exchange; it never holds a client secret or a token. Alternative (named, not recommended): exchange in the web route with the client secret available only to a `connection-broker` module — simpler UX, but it puts a provider secret and tokens in the web process, which every existing rule avoids.
  - `packages/infrastructure/src/connections/connection-broker.ts` — worker-only; performs the code exchange, refresh, and revocation; the only reader of `CONNECTION_SECRET_KEY` and of the OAuth client secrets. Guarded by a new dependency-cruiser rule `no-connection-broker-in-web`, planted in `tests/unit/boundaries.test.ts` like its siblings.
  - `packages/infrastructure/src/connections/connector-credentials.ts` — resolves a connection into a `ResolvedCredential` (the existing closure shape: no field holds the token; `authorize(headers)`, `discloses(bytes)`, `redact(text)`), wrapped by `guardedCredentials` so every artifact freeze and model request is scanned.
  - Routine UI and application handlers never touch any of the three.
- *Receipts (FR-66):* the step ledger records the intended operation and bound details before dispatch; each connector's operation declares `idempotency: none | key | lookup`; `key` means the adapter sends a client-generated key the provider honours; `lookup` means the adapter can find the effect afterwards (e.g. a calendar event by extended property); `none` means an unknown outcome pauses the task. The agent's narration is generated from the receipt state, so it cannot claim more than `confirmed` establishes.
- *Honest failures (FR-67):* the `ConnectorResult` type is a union — `ok(data, completeness)` / `partial(data, reason)` / `unreachable(reason)` / `denied(reason)` / `empty(contract)` — and the descriptor declares which the operation can return; an adapter that maps an exception to `empty` fails the conformance suite.
- *Model-data policy (FR-89):* a `disclosure_policy` per tenant (and optional per engagement) maps content classes (`document-text`, `document-image`, `tool-result`, `memory`, `conversation`, `evidence-excerpt`) to permitted providers. Every item placed in a model request carries its class and scope; the model gateway (3c) refuses to build a request for a provider the policy does not permit for any item, and fallback only selects providers permitted for all items. Redaction produces a derived item with provenance pointing at the original; originals are untouched.
- *Ownership:* domain (descriptor and result types, policy evaluation), application (ports, conformance suite, gate call site), infrastructure (adapters, broker, secret storage), worker (all runtime connector I/O), web (callback route only, plus the connections settings UI which reads state, never secrets).

**(3) Failure and verification**

- Conformance suite run against every adapter and against a hostile fake adapter that returns secrets in bodies, invents completion, or maps outages to empty results — each must fail a named case.
- Broker: the callback route test asserts no token and no client secret ever appears in the web process (config typing refuses the keys there, as `SOLARI_API_KEY` is refused today); the boundary test plants the import.
- Revocation: disconnect, then an in-flight task step that needs the connection is refused at the gate before I/O; provider revocation failure leaves the connection disabled.
- Receipt tests per idempotency capability: crash after dispatch with `key` → exactly one effect after retry; with `lookup` → found and confirmed, not repeated; with `none` → task waits and no second dispatch.
- Policy: an item of a forbidden class blocks the request to that provider and the fallback; the test asserts the provider adapter was never called.
- Personal-account acceptance (FR-68): designated test folder, label, calendar and recipient; enterprise requirements written up separately, not claimed.

**Changes to existing safeguards:** `CREDENTIAL_TOKENS` (static Bearer manifest) stays for Target System registrations; connections are a second, per-user credential source with the same containment shape. The "worker-only secrets" rule gains `CONNECTION_SECRET_KEY` and the OAuth client secrets. The credential scan remains supplementary (FR-63).

---

## Material decisions in 3a for the owner

- **D-3a-1 Storage isolation by Row-Level Security plus application filters** (recommended), versus application filters alone. RLS is the second lock and is testable table by table; it costs a mechanical pass over the existing transaction sites and `tenant_id` on the existing 66 tables.
- **D-3a-2 Engagement and Agent Task beside `audit_run`, never a nullable `audit_run.version_id`** (recommended). The Run stays the recurring-check unit; promotion is the bridge.
- **D-3a-3 Mandate re-derivation: narrower wins at every dispatch/resume/retry** (recommended), versus refusing any difference. Refusing on any difference would stall a task whenever an unrelated grant widens.
- **D-3a-4 OAuth exchange in the worker via a short-lived stored code** (recommended), versus exchange in the web route with a web-held client secret.
