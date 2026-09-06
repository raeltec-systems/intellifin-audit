# Epic 4 Context: The Audit Agent works a web Target System under supervision rules

<!-- Written from the epics document, the architecture spine and the addendum. Epic 3's
     context file is the shape this follows. -->

## Goal

The Audit Agent signs in to a synthetic web Target System inside an isolated Agent
Workspace, inspects each population record, and registers grounded Observations through the
SAME registration contract Epic 3 built. Where it cannot proceed safely the platform raises a
typed Escalation that an auditor answers from Run Detail, and an auditor confirms or rejects
Agent-Judged evaluations so the Result can seal. Proven on the hero Template restricted to
the web system, and on the Production Configuration Deviation Template.

## Stories

- Story 4.1: Provision an isolated Agent Workspace per Run
- Story 4.2: Sign in to LoanCore and enforce read-only, allowlisted actions
- Story 4.3: Supply credentials just in time and suppress capture during entry
- Story 4.4: Locate a record, capture Evidence, and register a grounded Observation
- Story 4.5: Prove absence for an employee with no account
- Story 4.6: Bound agent execution and render retrieved content inert
- Story 4.7: Raise typed Escalations as durable waits
- Story 4.8: Answer an Escalation from Run Detail and notify Audit Managers
- Story 4.9: Confirm or reject Agent-Judged evaluations to seal the Result
- Story 4.10: Prove the agent path on ProdConsole with one Observation per parameter
- Story 4.11: Prove abuse resistance and workspace isolation with negative tests

## What Epic 3 already built that this epic MUST reuse

This epic adds a second producer to machinery that exists. It does not get its own copy of
any of it.

- **`registerObservations` is the one write path to `run_observation`.** An agent read goes
  through it exactly as an adapter extraction does — the digest, the coverage rule, the
  per-Observation checks and the registration event are not optional and there is no second
  door. `AdapterExecutionContext` extends `ObservationRegistrationContext`; the agent's
  context must extend it too rather than owning a `saveObservations`.
- **The Observation wire schema, its digest and its derived id.** Thirteen keys, RFC 8785
  canonical, `observationIdFor(workItemId, populationRecordKey)`. A `web_tree` capture fills
  the same record an `api` extraction fills.
- **Evidence reservation, freezing and sealing.** `evidenceIdFor` names an artifact; the
  scope carries the ATTEMPT for anything frozen before it is parsed. `SealPackage` runs on
  every terminal transition. A screenshot and a `web_tree` snapshot are artifacts under this
  contract, not a new one.
- **The Run-level Evidence Quality Gate.** All twenty addendum §H rows already run when the
  last Work Item completes. This epic makes rows that were previously unreachable reachable
  — workspace access above all — and must not add a parallel gate.
- **The limit-exhaustion mapping.** `CANCELED` is still never produced by a timeout. The
  token limit, which was always 0 in Epic 3 because nothing called a model, is filled here.
- **Corroboration against the stored Structural Snapshot.** `web_tree` is currently refused
  BY NAME (`corroboration-unsupported`) in `structural-snapshot.ts`. This epic implements it
  there, in the one extractor, and must not add a second.
- **Deterministic evaluation.** Origin `RULE`, no rationale. Agent-Judged evaluations are a
  DIFFERENT origin with a confidence and a rationale, and they do not replace it.

## The browser provider decision (2026-09-06)

The architecture names Solari behind an application-owned `BrowserExecution` port. **Solari
is not installed in this repository, has no credentials here and has no verified interface.**
Playwright and Chromium are installed and already carry the whole browser suite, and the web
Target System is served over loopback by `apps/northstar`.

**Decision: implement the `BrowserExecution` port and back it with Playwright for the proof
of concept. Solari stays named as a deferred alternative implementation of the same port.**
The architecture's own success criterion is that the provider can be replaced without
redefining what an Audit Run means, so the port is the contract.

**What that honestly delivers**: per-Run isolation of browser state (a fresh context with its
own cookies, storage, cache and session, destroyed at Run end); allowlist enforcement on
every request the page makes, with a real denial event; a labelled control tree with
addressable locators for the Structural Snapshot; and read-only action enforcement,
redirects, downloads, timeout accounting and sanitized action logging through the same
interception point.

**What it does NOT deliver, and must be written as a limit rather than claimed**: process and
network isolation. A browser context is not a sandbox. The worker process is shared across
Runs and egress is policed inside the browser, not at the operating system. Story 4.1's
"no state, credential, or session ever crosses from one Run into another" is TRUE of browser
state and FALSE of process memory, and the story spec must say so in those words. The desktop
surface (`DesktopExecution`, LedgerDesk) stays deferred as it has since Story 1.8.

## Requirements & Constraints

Egress from a workspace reaches only the Procedure Version's frozen allowed origins; every
other destination is denied and logged as a security event. Workspace creation failure is a
Session Step exhaustion, which is `RUN_FAILED`. A workspace with an open wait is kept alive
under a lease to the wait's deadline rather than torn down, and every terminal transition
plus a periodic sweep reaps orphans.

A credential is supplied just in time, audited without its value, and capture is SUPPRESSED
for the Tool Action that types it. No credential-shaped value may survive into a snapshot,
screenshot, frame, log line or export, and a seeded negative test must prove it.

Retrieved page content is stored as untrusted and rendered inert wherever it is shown. It can
never change the objective, the permissions, the tool scope or the Compliance Rule for the
rest of the Run.

An Escalation is a DURABLE WAIT with a typed record, a closed answer set and a deadline, not
an in-memory pause. The agent receives only the chosen option identifier. An unanswered wait
past its deadline moves the Run to `INCONCLUSIVE` with Evidence preserved. An *abort* answer
ends the Run `CANCELED` with the reason recorded — the one path in the product that produces
`CANCELED` besides an explicit cancel.

An Agent-Judged evaluation carries origin `AGENT_JUDGED`, confirmation `pending`, a
confidence and a rationale. Below the version's threshold it is stored `UNEVALUATED` and
needs no confirmation. A Result with pending evaluations shows Pending Confirmation and
cannot be submitted. Sealing computes the outcome exactly once, after the last pending
evaluation resolves.

## Technical Decisions

`BrowserExecution` is an application-owned port; the Playwright implementation lives in
infrastructure, outside the barrel the web imports, with a dependency-cruiser rule that fails
the build on any import from `apps/web` — the shape the probe, the acquisition adapter, the
evidence store and the credential resolver already use. The model gateway reuses the Epic 2
provider adapters and their frozen identity; model output has no authority to change
executable meaning, which is already the rule.

Every state change, its Timeline event and its notification commit in one transaction, as
everywhere else. Wait records are locked rows with an expected revision, the discipline the
version-decision commands use.

## Cross-Story Dependencies

4.1 gates everything. 4.2 needs 4.1 and 4.3's credential path. 4.4 needs the `web_tree`
extractor in `structural-snapshot.ts`. 4.5 reuses the honest-absence rule, whose three legs
Epic 3 already enforces. 4.7 and 4.8 are the wait record and its surface, and 4.8 extends
the Epic 2 notification machinery. 4.9 needs Story 3.9's sealing. 4.10 and 4.11 are the
proofs and must come last.

## Named limits carried into this epic

- Process and network isolation, per the provider decision above.
- The desktop Target System and `DesktopExecution`.
- Live View, pause and resume, and replay are Epic 5 and are NOT in scope here even though
  the Escalation panel appears on both surfaces.
