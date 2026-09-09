# Epic 4 engineering verification report

**Implementation in final verification; Epic4 is not accepted or merged. Only the separately authorized synthetic Northstar update has deployed.**

Branch `codex/epic-4-agent-runs`, [draft PR24](https://github.com/raeltec-systems/intellifin-audit/pull/24).
Historical owner review was `b6bcd466749c56d2c37f8d8a46669dcf0f32d001`.
The inspected takeover head was `94978c99622997eaa5eccf968ab210b3a91c2969`,
not the historical SHA. Main was `12ec596dc3d23907a80a7d395c343a54c4375d5a`.
PR23 is the older Epic3 branch; this candidate includes its later owner-review repairs.
The [continuation log](epic-4-engineering-continuation.md) retains chronological
commits, red/green regressions, pushed checkpoints and unsuccessful verification attempts.

## Repairs and handoff security

| Repair | Delivered behavior and proof | Atomic checkpoints |
| --- | --- | --- |
| Sealed generation31 → final schema upgrade | Actual release migrator on real preceding schema, completed/sealed Runs and artifact bytes. Unguarded backfill fails; migration rollback restores guards. Historical bytes/digests, outcomes and unrelated metadata remain unchanged; ordinary mutation remains prohibited; repeat migration is safe. Fresh installation also runs in PostgreSQL18 CI. | `380a4ff`, regression repairs `7c6ab68`–`966e478`, real-byte proof `c74ef79` |
| Persisted provider identity | Provider mode + session ID + expiry survive restart/configuration changes. Solari → local cannot falsely attach/release/replace. Unavailable cleanup remains discoverable, including terminal Runs. Confirmed expiry is distinct from provider failure. Known cross-Run/mode release is rejected before provider I/O. | `e0fe4f3`, `8e3389e`, `6f18f64` |
| Positive authentication | Real form login; bounded target/account postcondition; exact frozen credential destination. Fresh/valid sessions pass; stale/unrelated cookies, login-page HTTP200, bad credentials/account markers and cross-target destinations fail. Failed credential pages are discarded with cleanup identity retained. | `15d0138`, `966e478`, `bd4a343` |
| Temporary delivery transport | Inspected historical workflows/payloads/runs, preserved genuine product changes and PostgreSQL-job Chromium installation. Snapshot/payload already absent; remaining branch-writing delivery workflow removed. No stored delivery payload is executed. | Chromium `663c959`; removal `9a5f2eb` |
| Later verification findings | Immutable absence metadata, forward generation41 trigger repair, notification bell count, shared Gate on all three Run limits, captured-history second-key navigation, and target-field capture scope. Each has a reproduced failure and focused regression. | `1fdb1ea`, `8f1ecc5`, `b165de7`, `2d1eec4`, `f7d76d6`, `0662270` |

Generation32 compatibility is explicit: databases already at32 do not replay it;
31 upgrades use the narrow release transaction with exclusive locks and two named
triggers restored before commit. There is no runtime bypass or invented provenance.
Generation40 is preserved;41 replaces the published PL/pgSQL function to qualify
`o.found` instead of colliding with PL/pgSQL `FOUND`. Populated40 upgrade coverage
retains historical absence-proof gaps rather than manufacturing a backfill.

## Story status

These are implementation and verification distinctions, not interface-only completion claims.

| Story | Implemented path | Acceptance status |
| --- | --- | --- |
| 4.1 | Persisted isolated workspace identity, recovery, bounded retry/expiry and cleanup | Local/state and provider-adapter regressions pass; remote allocation/authentication/cleanup demonstrated; remote managed-state isolation passes at8eafbfbe; representative audit remains blocked by C2 |
| 4.2 | Read-only scoped browser actions, request interception and exact real form destination | PostgreSQL/local Chromium authentication, denial and script-write tests pass |
| 4.3 | Just-in-time worker-only credential resolution, capture suppression, request/response/artifact scans | Credential regressions pass; actual-worker malicious response passed at5fd2ac0; actual-worker response-scanner mutation passes at f4892c9 |
| 4.4 | Captured web_tree + PNG, same-snapshot identity, shared transactional registration/corroboration/evaluation, protected stored-evidence inspector | Unit/PG and canonical worker → inspector journeys pass at f4892c9. Optional D3 binding limitation below |
| 4.5 | Actual searched values, both identity keys, complete registered empty capture, immutable proof/digest and whole-document inspector | PG, key-removal mutation and canonical worker journey pass at f4892c9 |
| 4.6 | Genuine model gateway and approved tool selection, measured usage/reservations, inherited deadlines, all limit causes through shared Gate, inert retrieved content | Provider conformance, PG limit/sealing/replay and token-removal mutation pass; real model turns demonstrated, complete live audit pending |
| 4.7 | Typed durable waits, closed options, one transactional wake, leased work checkpoints and restart/resume | PG real queue/restart/held-transaction tests and unique-match mutation pass |
| 4.8 | Fresh-authorized answers, revision/closure guards, timeout, real cancellation, initiator/manager notifications and exact shell count | PG command races, browser notification/answer/timeout journeys and both hydrated-answer mutations pass at f4892c9. Email truthfully unconfigured |
| 4.9 | Original machine proposal + immutable human decision overlay, durable worker review command, shared Exception signing and one-time sealing | PG confirm/reject/Unevaluated/races, threshold mutation and canonical compiled-worker confirm/reject journeys pass at f4892c9 |
| 4.10 | One page Work Item, one Observation per distinct baseline key, real shared reconciliation/evaluation and exact failing Gate set | Canonical PG, both guard mutations and the corrected compiled-worker browser proof pass at82adb83. Persisted selections resolve against approved snapshot locators and actual stored bytes; all golden Gate/Observation/evaluation/declaration checks remain |
| 4.11 | Dynamic golden attacks, hydrated closed answers, real worker SDK denial, catalog-discovered credential sink scans, overlapping browser-state isolation, workspace egress and terminal closure | All29 guard mutations pass at82adb83, including seven actual-worker/hydrated mutations with34 baseline/removed-guard case pairs. Recovery fixes pass476-test PG suite; remote managed-state isolation passes at8eafbfbe; final standard CI remains pending |

Principal feature checkpoints: grounded capture/registration `6a1e1e0`, `60bf745`,
`f3ba33e`, `d96b7fe`, `bfdbaa6`; model gateway/composition/loop `31317cc`, `64df031`,
`e1e7c3a`, `2ab4f09`; durable waits/answers `ae3037f`, `b04e153`; review/sealing
`0a4ccb9`, `db37d01`, `8403cfe`; P4 `2fe58e6`, `9576065`; inspector `ca08dfd`;
actual-worker abuse/credential tests `9d7edb3`, `6c9b717`, `5fd2ac0`.
All runtime Observations, evaluations, evidence and Results use the original shared engine.

## Current verification checkpoint

Runtime candidate **0c118a8d77f9866e36a0b0fd90cf862e0710af79**, tree
`4258e987dcf2f12a38d77c0818ff7b01887bc822`, is pushed. The subsequent
workflow/documentation checkpoint **8eafbfbea65a53b651363b56ad93cd690dcf0472**
selects the existing independent remote-isolation test without changing runtime code.
[Standard CI34224604065](https://github.com/raeltec-systems/intellifin-audit/actions/runs/34224604065)
is pending at this report update; the following documentation checkpoint must receive its
own [current PR checks](https://github.com/raeltec-systems/intellifin-audit/pull/24/checks).
[Independent isolation34224743734](https://github.com/raeltec-systems/intellifin-audit/actions/runs/34224743734)
**passes** at8eafbfbe. The full audit gate remains failed on explicit C2 policy ambiguity;
independent isolation does not replace it. Post-commit check results and exact final tested
SHA are recorded in the PR status and final handoff, without describing this prepared report
as proof that a pending job passed.

Last fully green standard candidate **70497eb8e9e04ae4282f71844fa6363d89d77597**
passes all five jobs in
[CI34217326851](https://github.com/raeltec-systems/intellifin-audit/actions/runs/34217326851):
3541unit tests,476real PostgreSQL18 tests,162browser/accessibility cases,
22small guard mutations and7worker/hydrated guard mutations with34baseline/removed-guard
case pairs. TypeScript, dependency boundaries, fresh/populated/repeat migrations,
schema drift and web/worker/Northstar images pass. Hosted browser tests use local Chromium;
these results are not proof of remote Solari execution.

Subsequent runtime checkpoint590df4e passes3548local unit tests/170files. Current
prompt/planner repairs pass103focused tests and full TypeScript; the final uncertainty
prose passes the affected88tests again. The continuation log records exact commands,
red/green evidence and incomplete or canceled hosted runs. Local runtime uses Node24.20.0
and pnpm11.25.0; real PostgreSQL and browser gates run on hosted CI.

## Additional acceptance findings and atomic repairs

- `e55c001` reproduces a real PostgreSQL/local-Chromium reattachment race: a competing
  work claim mistakes PROVISIONING for a missing workspace and falsely fails the Run.
  `d50e424` preserves the winning claim's session when an older attach returns late;
  `5944e6f` defers work and rediscovers interrupted/failed provisioning. The deterministic
  regression and recovery cases pass in the476-test PostgreSQL suite.
- `af3abd6` waits for the refreshed closed-wait page and exact title before the unchanged
  accessibility scan. `70497eb` writes scanned live reports to disk so CI can retain them;
  its real-filesystem regression fails against body-only attachments.
- `d142629` retains only closed model failure categories while charging real usage.
  `48381c7` corrects the malicious-worker test to require the exact invalid-selection
  suffix; all security-denial, no-Observation, no-Pass and frozen-scope assertions stay.
- `590df4e` specifies the strict JSON response shape. `d6e8597` aligns offered search
  tools with platform-bound arguments: the model selects an opaque tool ID, and the
  worker supplies the frozen lookup value. No population values are exposed merely to
  satisfy the model. `86e12c1` uses a complete empty-parameter example and distinguishes
  uncertainty about a safe next action from missing final evidence during investigation.
  Each format/argument mismatch has a failing regression before repair. Model-provided
  parameters, unsafe actions and actual uncertainty remain refused or durably escalated.

## Real provider evidence and deployment prerequisites

Both GitHub API secrets and the OpenAI Luna model configuration are now present.
The actual-worker live workflow uses `gpt-5.6-luna`, Solari `us-west`, recording disabled,
one canonical employee and the existing approved Northstar HTTPS service. It uses
worker-local disposable PostgreSQL, HTTP population and synthetic S3 fixtures through
production adapters; it does not claim production storage or deployed HR integration.
See the [live runbook](epic-4-solari-acceptance-runbook.md) for exact bounds/configuration.

Owner explicitly authorized updating only Northstar. Source70497eb passed CI before
Railway deployment **65c63c65-db86-407f-80e7-9b097caccd42**, which reports SUCCESS.
Public health and the real LoanCore sign-in form were verified. Its Actions deployment
job34219001411 later failed only during pnpm cache-save; that operational error does not
reverse the independently verified rollout. Web, worker and database were untouched.
The one-shot operations workflow was removed in `da6fbd2`; its final branch tree equals
70497eb and it never entered PR24. Existing staged Railway configuration was preserved.

Post-deployment live34220819917 proves real authentication/population and four
schema-mismatch refusals. Live34222183373 at590df4e completes two real model turns before
an insufficient-evidence wait. Live34222899942 atd6e8597 selects investigative actions
but also returns insufficient-evidence, so the worker correctly waits before acting.
All three confirm remote cleanup; none is an accepted audit or remote-isolation gate.
Rejected output and provider reasoning are not retained. Later diagnosis retains only
the accepted bounded user-facing uncertainty summary after credential and report scans. Live34223252568 at86e12c1 then completes model-directed navigation, search, record opening
and field reading before a genuine evaluation wait. Repair `0c118a8` supplies the model
with the snapshot corroboration already computed for the deterministic preview; registration
still independently verifies the original captured record. Its regression fails with null
corroboration before repair, then verifies the supplied values and verdicts equal the final
registered record. All103focused tests and full TypeScript pass.

[Live34223964866](https://github.com/raeltec-systems/intellifin-audit/actions/runs/34223964866)
at0c118a8 repeats the full investigative sequence and retains the accepted stop summary:
“The condition does not define which roles are privileged.” C2’s frozen condition says
roles that look privileged are exceptions but supplies no role policy. The actual roles field
is present and corroborated; independent review confirms no required C2 attribute is missing.
The worker correctly preserves a durable wait, with confirmed cleanup. It has not registered
a completed audit Observation/Result for this live case. Do not inject the fixture’s expected
answer, infer a privilege policy, or change this wait into a Pass. An approved clarification
of the procedure’s C2 criterion is required before completing this representative gate.

The independent remote-isolation gate **passes** at8eafbfbe: two concurrently open Solari
sessions, separate real authentication, cookies/local/session/cache state, an A operation
held pending while B completes an authenticated captured read, forged cross-Run
attach/perform/release refusal, intercepted out-of-scope requests and terminal closure.
Both provider releases are confirmed before expiry (A12:12:57.690Z; B12:12:58.342Z on
2026-09-08). Recording is off and this test makes no model calls. It proves managed
browser-state isolation and adapter request interception, not worker-memory isolation
or an independently configured provider firewall. The
[scanned artifact](https://github.com/raeltec-systems/intellifin-audit/actions/runs/34224743734/artifacts/10055228838)
retains original provider identities; the committed
[secret-free verification summary](epic-4-live-provider-verification.json) retains exact
candidate/Run/configuration IDs, accepted scope and cleanup timestamps.

A read-only Railway recheck confirms neither web nor worker has `EVIDENCE_S3_*`.
The worker also lacks `SOLARI_API_KEY`, `CREDENTIAL_TOKENS` and
`EXCEPTION_FINGERPRINT_KEY`; these are deployment blockers separate from Actions
configuration. Both model-provider keys exist on the worker but the Luna model override
is absent; current composition prefers Anthropic when both keys are present. Only
variable names were inspected. An existing approved private S3-compatible bucket and
its configuration must be supplied; do not provision paid storage or use the disposable
fixture as production evidence storage. Release also needs the production DATABASE_URL
and RAILWAY_TOKEN, PostgreSQL18, successful exact-candidate checks. GitHub currently reports main as unprotected;
no bypass or direct main push is used. No main merge or candidate web/worker rollout has occurred.

## Material contract conflicts and limits

- **Capitalized target status:** default C1 names lowercase values; canonical LoanCore
  displays `Disabled`/`Active`. The configured positive procedure explicitly freezes
  `found = false or account_status in [Disabled] else [Active]` through the existing
  compiler. Default mismatch still produces an unnamed-value refusal. Captured case
  and plain-text Roles are preserved; no normalization or frozen rule is silently changed.
- **D3 optional 24-hour binding:** the fixture map assigns D3 to4.4, but its expectation
  requires PeopleHub's termination instant, while LoanCore does not expose its stored
  disabled instant as a labeled field. PeopleHub calls the field `termination_effective_time`;
  the compiled variant reads `termination_time`, with no frozen alias contract. Both
  synthetic instants exist; a date-only export cannot establish them. Existing arithmetic
  tests do not prove this canonical binding journey. The higher-level addendum retains
  the variant when the target exposes disabled_time; this candidate does not claim D3
  browser acceptance or invent timestamps/mappings. This remains an explicit mapping/surface
  limitation requiring resolution before claiming the entire fixture map is delivered.
  Story4.4's default status-path task/AC list does not require this alternative binding;
  that default path is verified separately. Resolving D3 requires a compatibility-safe
  frozen field-mapping extension, not a silent alias in compiler1.
- Local contexts prove browser-state isolation, not process or worker-memory isolation.
  The passing remote test distinguishes managed sessions from an independently
  configured provider firewall. Email remains recorded as `unconfigured`.
- Desktop execution, user-facing live/replay and scheduling are later epic work. They
  are not delivered by the agent worker or by these test fixtures.

## Owner test steps after a verified deployment

These instructions describe the candidate, **not a verified deployment**.

1. After deployment has been verified, open the existing
   [web application](https://web-production-edded.up.railway.app) and sign in as a synthetic
   Auditor. Create a P1 procedure, choose the approved leavers
   source and explicitly select LoanCore with the read-only **audit** credential.
   Use August2026 for the canonical data and the exact status expression above.
2. Review/approve/activate through the existing role-separated procedure workflow,
   then initiate the Run. Never use an employee's credentials.
3. Inspect Timeline authentication/capture events and Evidence grounding. Open the
   stored snapshot at the recorded locator; compare original values, corroboration
   and linked PNG. For absence, inspect both actual queries and complete empty evidence.
4. Open a durable Escalation from Run Detail or the bell. Confirm one closed option;
   verify the timeline closure and resumed work. A second or stale answer must refuse.
5. For Pending Confirmation, inspect the machine proposal and evidence, then confirm
   or reject with a rationale/replacement. Verify final sealing and retained proposal history.
6. The complete golden source deliberately contains invalid/duplicate rows and must
   end Inconclusive. A success demonstration requires a separately declared valid source;
   an employee filter does not erase source-wide Gate failures.

Do not test a supposed live/replay, desktop or scheduled experience as if Epic4 delivered it.
