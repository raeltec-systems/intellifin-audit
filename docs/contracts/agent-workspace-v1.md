# Agent Workspace, version 1

The isolated workspace one Run gets when its frozen plan names an agent-driven Target
System (Story 4.1, AD-4, AD-16). Normative for every later story in Epic 4.

## What decides that a Run gets one

`workspaceRequirement(plan)` in `packages/domain/src/runs/execution.ts`, from bytes the
Version already froze and nothing else. There is no stored flag, because a flag could
disagree with the plan the Run is executing and the plan is what an auditor reads.

- The compiler emits a `create-workspace` Session Step, **first**, exactly when a selected
  Target System is `web` or `desktop`. No agent-driven Target means no step and no
  workspace: an adapter-only Run is unchanged by this contract.
- The **egress allowlist** is the frozen `allowed_origins` of the `web` Targets, in frozen
  order, deduplicated. A `desktop` registration's application identity occupies the
  `allowed_origins` slot of the six-key envelope and is **not** a URL, so it contributes
  nothing. A desktop-only plan therefore has an EMPTY allowlist, under which every
  destination is denied — which is the truth about a browser workspace with no web system
  to visit, and is fail-closed.
- A plan naming an agent-driven Target with no `create-workspace` step, or with an agent
  Target that has no `sign-in` step, is `unsupported-frozen-plan`. A plan version this
  build cannot read requires no workspace at all.

## The port

`BrowserExecution` in `packages/application/src/runs/execution-ports.ts`. Structural types
only: `packages/application` compiles with `lib: ["ES2024"]` and no host types, which is
the compiler-enforced half of AD-11, so no `Page`, `Browser`, `URL` or provider type
crosses it.

| Member | Contract |
|---|---|
| `mode` | `solari` or `local`. Recorded on every workspace row, because the two are not the same guarantee |
| `create({runId, policy, timeoutMs})` | One workspace, confined to `policy`. The policy is an INPUT, never a setting the implementation chooses |
| `attach(ref)` | The live workspace, or `null`. `null` is expected, not exceptional |
| `release(ref, timeoutMs)` | Release and revoke. Idempotent, by identity |

`attach` and `release` are AD-16 conformance requirements: a Run that resumes after a wait
must reattach to the workspace it left rather than sign in again, and a workspace nothing
releases outlives the Run that justified it.

## One implementation, two places to run it

**Solari and Playwright were never alternatives.** Solari is a managed remote browser and
you drive it WITH the Playwright client API: `sessions.create()` hands back a wire-protocol
endpoint and `chromium.connect()` connects to it. `PlaywrightBrowserExecution` is therefore
the only implementation, and where the browser runs is a composition-root choice.

It uses `sessions.create()` + `chromium.connect()` rather than `solari.launch()`, because
`launch()` returns a `BrowserSession` typed against the SDK's bundled `patchright-core` — a
different package from `playwright-core`, with separately declared types that do not assign
to each other. The two modes would then hold two `Browser` types, and the only ways out are
a second code path or an `as`. `Session` itself is four strings, so nothing typed against
the fork crosses the module.

### What each mode actually guarantees

|  | `local` | `solari` |
|---|---|---|
| Cookies, storage, cache, session, per Run | Isolated by browser context | Isolated, separate managed browser |
| Process isolation | **None. One worker process.** | Provider-side, separate from the worker |
| Egress control | Inside the browser, by request interception | Provider-side egress, plus interception |
| Destroyed at the Run's end | Context and browser closed | Session released |
| Survives a worker restart | No | The session does; the connection does not |

The acceptance text says no state, credential or session crosses from one Run into another.
That is **true of browser state and false of process memory** under `local`, and the weaker
sentence is the one written wherever the guarantee is claimed.

## Egress

Every request a workspace's pages make is intercepted and either continued or aborted in
the browser, so a denied destination is never put on the wire. The judgement is
`withinOrigin` — the same authority-plus-path-boundary rule the adapter path applies — from
`packages/infrastructure/src/runs/origin-policy.ts`, which is its one home.

- An allowed origin may carry a path prefix (`http://localhost:4300/loancore`), so
  `/loancore-other` is outside `/loancore` and `/loancore/accounts` is inside it.
- A fragment is stripped before the comparison: it never goes on the wire.
- Anything that is not `http:`/`https:`, anything carrying credentials in the URL, and
  anything unparseable is denied.
- WebSocket handshakes are routed separately (`routeWebSocket`), because they are not
  `route()` requests and would otherwise be an unpoliced path out.
- `serviceWorkers: 'block'`, because a service worker's own fetches are not seen by
  `context.route`.
- A frozen origin this build cannot parse REFUSES the whole workspace (`policy`), rather
  than being dropped: a silently narrower allowlist looks exactly like a Target System that
  was down.

**Nothing widens the list** — not an authored instruction, not a redirect a site chose, not
a provider feature. `proxy`, `stealth`, `captcha`, `webBotAuth` and profiles are all off and
named rather than defaulted; `proxy: "smart"` swaps egress in place when it detects a block
page, which is the opposite of confining a Run to its frozen origins.

**Under `local` the interception is the only boundary.** The browser process's own
out-of-band traffic is not policed here; that is one of the reasons Solari's provider-side
egress is the stronger guarantee.

A denial is `security.action-denied` with `cause: scope-violation` and diagnostic
`workspace-egress-denied`. The recorded destination is scheme, authority and path only —
never a query string, which is where a token or a signed URL lives, and the chain is
immutable. `denied()` keeps the exact total beside a bounded sample of at most 100, and the lifecycle
event carries it as `deniedTotal` — a running total for the workspace, never a count of the
denials in that one event.

## The durable checkpoint

`run_workspace`, one row per Run (generation 27). It carries the provider session
identifier, the mode, the provider deadline, the frozen step id, the attempt count and the
lease. There is nowhere in it for an API key, a session token or a wire-protocol endpoint.

- `workspace_id` is `browser.id` under Solari. Opaque and **not a capability** — releasing a
  Solari session still needs the deployment's API key — so it may be stored and named in a
  Timeline event, which is what makes a provider-side session correlatable with a Run.
- `expires_at` is the provider's **hard** deadline, at which a Solari session
  auto-releases; nothing a Run does resets it. `null` for a local browser, which has no
  plan-tier deadline. A resumed claim past it treats the identity as GONE
  (`workspace-expired`), which is a different fact from a provider outage.
- The frozen Run limits stay the authority for ending the RUN. The provider deadline is a
  fact about the workspace that the Run must respect and record, never the mechanism that
  ends it.

## Lifecycle

`provisionWorkspace` and `releaseWorkspace` in
`packages/application/src/runs/provision-workspace.ts`. The claim / lease /
revision-recheck / save + event + notifyTimeline discipline is `acquirePopulation`'s.
Provider I/O happens strictly BETWEEN transactions: a browser is created or released over a
network, and a transaction held across that is a connection pinned to somebody else's
latency.

1. **Claim.** Read the Run and the frozen plan under the `audit_run` row lock. No
   requirement means no row is written at all. A cancellation is honoured here.
2. **Provider I/O.** Reattach by the stored identity if there is one; otherwise create.
   A reattach that is impossible RELEASES the stale identity before making a replacement,
   so "never a second workspace" holds across the failure too. **A release that FAILS
   makes no replacement at all**: `release` already resolves `InvalidSessionId` and a 404
   as success, so a throw means the session may still be running, and creating a
   replacement would overwrite `workspace_id` — the only durable record of it — leaving
   nothing able to name it. The attempt ends on `workspace-release-failed` with the
   identity untouched, and the next claim retries. An EXPIRED identity is the one
   exception: the provider auto-released it at its own deadline, so there is nothing to
   leak and the replacement is correct whatever the release answered.
3. **Commit.** The workspace row, the `create-workspace` Step Execution, the
   `lifecycle.agent-workspace` event and any drained denials, in one transaction. A lost
   claim writes nothing and releases the workspace this attempt made.

Release happens when the Run has ENDED, and never while it can still act — a workspace is
bound to its Run for the Run's lifetime. The worker releases in a `finally` after its
stages; the reaper is the backstop for a worker that died before reaching it.

### Failure

| Code | Diagnostic | Retried? |
|---|---|---|
| `unavailable` | `workspace-unavailable` | Yes |
| `capacity` (`ConcurrencyLimitExceeded`) | `workspace-capacity` | Yes |
| `entitlement` (`FeatureRequiresPlan`, `PlanLimitExceeded`, 401/402/403) | `workspace-entitlement` | No |
| `refused` (a provider code this build does not recognise) | `workspace-refused` | No |
| `policy` (an unreadable frozen allowlist) | `workspace-policy` | No |
| a failed release of the STALE identity | `workspace-release-failed` | Yes |

The release failure is not a provision code and is deliberately not spelled as one: nothing
was created, so "will creating refuse identically again?" — which is what `TERMINAL_CODES`
answers — has no bearing on it. It is retried because a retry costs one reattach and one
release against a session that may still be alive.

`SolariErrorCode` is widened with `| string`, so an unrecognised code is TERMINAL: calling
it transient would retry it four times on the strength of not knowing what it is.

The budget is `sessionStepAttemptBudget(plan.limits)` — four attempts for compiler 1, one
cycle, because §E maps a Run-level Session Step's failure to `RUN_FAILED` rather than to a
coverage gap. It counts PROVISIONING attempts and not deliveries: a claim that finds the row
already `OPEN` is reattaching, carries the count forward unchanged and is exempt from the
limit. `acquirePopulation` asks for a redelivery on any transient transport failure and has
four attempts of its own, so counting those would fail a Run whose workspace had been
healthy every time. Exhaustion is `runStopFor('session-step-failed')`, which is `RUN_FAILED` with
no security event, and `completeRun` seals the Result in the same transition.

## The reaper

`startWorkspaceReaper`, the third sweep of an existing shape: its own read, a bounded page
per tick (10), one Run at a time, a rotating cursor that resets on a short page, and a stop
that lets the active release finish and starts none of the rest.

It selects `PROVISIONING`, `OPEN`, `RETRY` and `FAILED` rows that NAME a workspace and whose
Run is terminal. "Whose Run is absent" is unreachable by construction:
`run_workspace.run_id` is a real foreign key, so there is no dangling row to find.

`FAILED` is in that list because it is where a row ends when the attempt budget is spent,
and every path that keeps the identity through a failure — `workspace-release-failed` above
all — ends there with a `workspace_id` still set. Omitting it would make the one row the
reaper most has to find the one row it could never select.

**The one leak this contract cannot close**: a provider session created and this process
dying before the identity is committed. Nothing on this side can release a session it
cannot name, and the SDK offers no listing. It is bounded by the provider's own grace timer
and is written down rather than claimed away.

## What is NOT in this contract

Sign-in, credentials, navigation, capture, Observations and Escalations are Stories 4.2 to
4.7. `classifyPlanTargets` still refuses an agent-driven Target BY NAME at the execution
stage, and the population stage still refuses a plan whose first Session Step is not
`acquire-population`. So an agent Run today provisions its workspace, meets that refusal,
ends `RUN_FAILED` and has its workspace released. **Story 4.2 is what takes over.**
