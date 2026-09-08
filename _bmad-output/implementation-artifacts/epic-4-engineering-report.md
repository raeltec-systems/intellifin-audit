# Epic 4 engineering verification report

**Work in final verification; not accepted, merged or deployed.**

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
| 4.1 | Persisted isolated workspace identity, recovery, bounded retry/expiry and cleanup | Local/state and provider-adapter regressions pass; live managed-session gate blocked |
| 4.2 | Read-only scoped browser actions, request interception and exact real form destination | PostgreSQL/local Chromium authentication, denial and script-write tests pass |
| 4.3 | Just-in-time worker-only credential resolution, capture suppression, request/response/artifact scans | Credential regressions pass; actual-worker malicious response passed at5fd2ac0; actual-worker response-scanner mutation passes at f4892c9 |
| 4.4 | Captured web_tree + PNG, same-snapshot identity, shared transactional registration/corroboration/evaluation, protected stored-evidence inspector | Unit/PG and canonical worker → inspector journeys pass at f4892c9. Optional D3 binding limitation below |
| 4.5 | Actual searched values, both identity keys, complete registered empty capture, immutable proof/digest and whole-document inspector | PG, key-removal mutation and canonical worker journey pass at f4892c9 |
| 4.6 | Genuine model gateway and approved tool selection, measured usage/reservations, inherited deadlines, all limit causes through shared Gate, inert retrieved content | Provider conformance, PG limit/sealing/replay and token-removal mutation pass; live model execution blocked |
| 4.7 | Typed durable waits, closed options, one transactional wake, leased work checkpoints and restart/resume | PG real queue/restart/held-transaction tests and unique-match mutation pass |
| 4.8 | Fresh-authorized answers, revision/closure guards, timeout, real cancellation, initiator/manager notifications and exact shell count | PG command races, browser notification/answer/timeout journeys and both hydrated-answer mutations pass at f4892c9. Email truthfully unconfigured |
| 4.9 | Original machine proposal + immutable human decision overlay, durable worker review command, shared Exception signing and one-time sealing | PG confirm/reject/Unevaluated/races, threshold mutation and canonical compiled-worker confirm/reject journeys pass at f4892c9 |
| 4.10 | One page Work Item, one Observation per distinct baseline key, real shared reconciliation/evaluation and exact failing Gate set | Canonical PG, both guard mutations and the corrected compiled-worker browser proof pass at82adb83. Persisted selections resolve against approved snapshot locators and actual stored bytes; all golden Gate/Observation/evaluation/declaration checks remain |
| 4.11 | Dynamic golden attacks, hydrated closed answers, real worker SDK denial, catalog-discovered credential sink scans, overlapping browser-state isolation, workspace egress and terminal closure | All29 guard mutations pass at82adb83, including seven actual-worker/hydrated mutations with34 baseline/removed-guard case pairs. Later deterministic recovery fixes require final CI; remote isolation remains blocked |

Principal feature checkpoints: grounded capture/registration `6a1e1e0`, `60bf745`,
`f3ba33e`, `d96b7fe`, `bfdbaa6`; model gateway/composition/loop `31317cc`, `64df031`,
`e1e7c3a`, `2ab4f09`; durable waits/answers `ae3037f`, `b04e153`; review/sealing
`0a4ccb9`, `db37d01`, `8403cfe`; P4 `2fe58e6`, `9576065`; inspector `ca08dfd`;
actual-worker abuse/credential tests `9d7edb3`, `6c9b717`, `5fd2ac0`.
All runtime Observations, evaluations, evidence and Results use the original shared engine.

## Latest candidate gate

Candidate **82adb8338cfd3c6efb82b664ba4848729e8818ec** passes all five jobs in [CI34205126512](https://github.com/raeltec-systems/intellifin-audit/actions/runs/34205126512): 3537 unit tests, 472 PostgreSQL tests, 162 browser/accessibility cases, static/image gates and all29 guard mutations. Its tested merge0ef533e2a22a400f7a960c7a152de72ac3ffe7de shares the complete tree78be9099481a62825a00c22230597b1f2264246b with the head. The worker matrix includes34 baseline/removed-guard pairs, with three independent credential lifecycles and no assertion retries.

Earlier04f2a3e reached RUN_FAILED instead of the required credential-containment wait ([exact failure](epic-4-credential-baseline-failure.json)). Passing repetitions did not explain it. A deterministic real PostgreSQL/local-Chromium regression at **e55c001** then reproduced a concrete reattachment race: competing work treated durable PROVISIONING as a missing workspace and falsely failed the Run. A separate controlled-clock regression showed that an old attach could close the winning lease's same session. The original intermittent run lacked durable diagnostics, so attribution of that exact run remains an inference.

The cleanup repair **d50e424** is pushed. The pending-work/recovery repair preserves missing-workspace failures and makes interrupted attachment discoverable before and after extraction. Local3539unit tests and full TypeScript pass; the final repaired candidate still requires hosted gates and live Solari acceptance. No protection or expected audit outcome is weakened.

## Verification evidence

Verified runtime baseline: **`f4892c930e031071a77cc5945ffb2936e34cfe86`**, tree
`5b5ff428306262bddf2148fcbdf483ff8e35c6b1`.
Its [CI34199194303](https://github.com/raeltec-systems/intellifin-audit/actions/runs/34199194303)
completed with four passing jobs and one browser failure; no full-candidate acceptance is claimed.

- Local full unit suite on this SHA: **3537 tests /169 files pass**, Node24.20.0,
  pnpm11.25.0, `pnpm test`. Full `pnpm typecheck` and `pnpm boundaries` pass
  (510 modules, no dependency violations).
- This candidate passes hosted static, PostgreSQL18 (472 tests/39 files), fresh and
  populated migrations through41, repeat migration, drift and all image checks.
  CI tested merge SHA `ef9334efbdcbb374a23fdcc538403a7f4e0e3b4a`, whose complete tree
  equals the head tree above. All22 smaller mutations pass, with exact guard removals,
  source/test digests and per-case assertion failures retained in
  [hosted mutation evidence](epic-4-hosted-guard-mutations.json).
- Browser/accessibility: **161 passed, 1 failed**. The remaining ProdConsole assertion
  incorrectly expects immutable snapshot reads in the browser-request ledger; all
  preceding exact golden Gate/Observation/evaluation/declaration assertions pass.
  A sound test must match durable model selections to approved locators and stored bytes.
  The separate seven-worker/hydrated mutation job passes all32 selected baseline/removed-guard case pairs. Its [exact evidence](epic-4-hosted-worker-mutations.json) is retained.
- Candidate2d1eec4:472 real PostgreSQL18 tests/39files, fresh migration, sealed31 and
  populated40 upgrades through41, repeat migration, drift, all22 smaller mutations,
  static checks and container build/startup checks passed in CI34196546462.
  GitHub tested merge SHA67a4b1d6ef0fd9280bb441a0b102ed6a469e655f; its complete tree
  equaled that PR head. Later candidate5fd2ac0 also passed PG/static/images.
- Earlier browser failures are retained in the continuation log. They produced actual
  repairs; a canceled run or a passing subset is not full browser acceptance.
- Hosted browser tests use **local Chromium**. Synthetic provider HTTP is explicitly
  intercepted in negative/expected-journey tests; the compiled worker, SDK, queue,
  PostgreSQL, Northstar, browser, S3 adapter, evidence and review commands are real.
- Test commands are the repository's `pnpm typecheck`, `pnpm boundaries`, `pnpm test`,
  `pnpm test:integration`, `pnpm db:migrate`, drift via `pnpm db:generate`,
  `pnpm test:e2e`, package/worker/Northstar builds and web/container builds in CI.
  Each PostgreSQL/browser job installs its own Chromium binary.
- The old ten-mutation report is historical evidence, not the final matrix. Current per-case JSON shows baseline success and meaningful guard-removal assertion
  failure; setup errors, timeouts, canceled cases and surviving mutants do not count.

Test-only follow-up commits: **881dc35338c4a5ae26dc3df9e71b852115a75d77** proves
P4 model-selected reads against the actual stored snapshot;
**9a6987fe165520d2bc71673e1e736457f66db2de** awaits independent committed completion
before security assertions and retains the full execution/cleanup budgets. Focused
TypeScript,18P4 unit tests and unchanged browser-case discovery pass. Their exact
hosted verification is required after publication; no production source changed.

## Live-provider and deployment blockers

The explicitly selected [live run34194649240](https://github.com/raeltec-systems/intellifin-audit/actions/runs/34194649240)
failed before allocating a workspace: **Actions `SOLARI_API_KEY` was empty**.
Model-provider secrets and model-ID variables were also empty. The supplied key is
outside Git with private permissions; a1468-file tracked/candidate scan found zero occurrences.
This session's GitHub connector cannot create encrypted Actions secrets. Nothing
about that failed run establishes live authentication, evidence, isolation or cleanup.

Configure encrypted Actions `SOLARI_API_KEY` and exactly one `ANTHROPIC_API_KEY` or
`OPENAI_API_KEY`, plus its corresponding model-ID variable. Then explicitly select the
exact final candidate using PR label `solari-live-acceptance`. The
[runbook](epic-4-solari-acceptance-runbook.md) records all settings and bounds.
The live gate uses the actual worker adapter and real model against the existing
approved Northstar HTTPS service; its source and S3 fixture are explicitly worker-local.
No tunnel, new target deployment, provider plan change or recording is authorized by the test.

Railway service presence was inspected; final candidate deployment prerequisites and
target version compatibility remain unverified. In particular, the existing worker's
visible variable names did not establish Solari, evidence-store or credential/fingerprint
configuration. Release requires production DATABASE_URL/RAILWAY_TOKEN and migrates before
serial deployment. Main may auto-deploy immediately. No branch protection is bypassed,
no non-disposable database is dropped, and no merge or deployment has occurred.

Read-only Railway inspection on2026-09-08 confirms the existing web domain is
`web-production-edded.up.railway.app`; latest web/worker/Northstar deployments still date
fromSeptember5. Their platform status is SUCCESS, which is not candidate health evidence.
Worker service `84394c42-5018-4cb4-9a7a-707b2ca1fe4a` uses `apps/worker/Dockerfile` and
`node dist/main.js`; its direct variable list still omits the agent evidence/credential
and Solari settings above. No deployment settings or variable values were changed.

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
  Even the proposed remote test distinguishes managed sessions from an independently
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
