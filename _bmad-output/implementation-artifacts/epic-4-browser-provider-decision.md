---
title: 'Epic 4 browser provider decision'
type: 'decision'
created: '2026-09-06'
revised: '2026-09-08'
status: 'final'
---

# Epic 4 browser provider decision

> **Revised twice on 2026-09-06, and both errors are recorded here rather than deleted.**
>
> **First, after the owner said Solari is key.** An earlier version treated Solari and
> Playwright as alternatives and chose Playwright. That was wrong: I concluded the provider was
> unusable because it was absent from this repository, without checking whether it was
> obtainable. The packages are published and installable. **Solari is a managed remote browser
> that you drive WITH Playwright**, so the two were never competing choices.
>
> **Second, after the owner asked to separate configured mode from live validation.** This
> document claimed the epic was "verified against" Solari when nothing had been — there was no
> key at the time, and an intention was written as a result. It has since been validated live
> against a public target, and the boundary of that proof is stated rather than glossed: see
> "Live-provider validation, 2026-09-06".

## What Solari actually is

`@solarisdk/browser@0.1.3` and `@solarisdk/sandbox@0.1.3` are published, Apache-2.0, and were
installed and read to write this. Solari runs the browser; the client connects to it.

```ts
const session = await solari.sessions.create({ stealth: true });
const browser = await chromium.connect(session.wsEndpoint);   // Playwright wire protocol
// or
const browser = await chromium.connectOverCDP(session.cdpEndpoint);
```

So the driving API is Playwright's either way. What changes is only **where the browser runs**
and **what isolates it**.

## The decision

**One `BrowserExecution` implementation, written against the Playwright client API. Where the
browser lives is a composition-root choice, not a second implementation.**

- **Solari session** — the real provider. A managed browser per Run, isolated by the provider,
  with its own egress.
- **Local Chromium** — the same code path against `chromium.launch()`, for tests and for a
  developer with no key.

The port stays the contract, which is what the architecture's replaceability criterion asks
for. Neither mode is a different implementation of it, so there is no second code path to keep
honest.

## Why this matters for the isolation guarantee

Story 4.1's acceptance text says no state, credential or session ever crosses from one Run into
another. Those two modes do NOT satisfy it equally, and the difference must be stated wherever
the guarantee is claimed:

| | Local Chromium | Solari session |
|---|---|---|
| Browser state per Run — cookies, storage, cache, session | Isolated by browser context | Isolated, separate managed browser |
| Process isolation | **None.** One worker process | Provider-side, separate from the worker |
| Egress control | Inside the browser, by request interception | Provider-side egress, plus interception |
| Destroyed at Run end | Context closed | Session released |
| Kept alive under a lease while a wait is open | Context held open in-process | Session held, survives a worker restart |

**Local Chromium delivers the browser-state half and not the sandbox half.** Solari delivers
both. So the epic is BUILT for Solari, and the local mode is documented as the weaker guarantee
rather than presented as equivalent — `run_workspace.mode` records which one each Run had.

**Built for is not the same as validated against, and the two are separated below.** An earlier
version of this paragraph said the epic was "built for Solari and verified against it". Nothing
had been verified against Solari when that was written: there was no key, and the sentence
described an intention as though it were a result. What is now proven, and what is not, is in
"Live-provider validation" below.

## What was needed, and where each item landed

| Needed | State |
|---|---|
| `SOLARI_API_KEY` | **Supplied** by the owner on 2026-09-06 and held in gitignored `.env`, mode 600. Never committed, never echoed |
| Network reachability to `getsolari.com` from this container | **Reached**, through a test-only tunnel. The measurement and its boundary are below |
| A plan tier permitting the features used | **Confirmed** for what this platform uses. `sessions.create({})` was accepted with no `FeatureRequiresPlan` or `PlanLimitExceeded` refusal |

## Consequences elsewhere

- **The desktop Target System stops being permanently deferred.** `@solarisdk/sandbox` exposes
  `createDesktop()` with a computer-use action API, which is what LedgerDesk needs. It stays
  out of Epic 4's scope, but it is now blocked on a story rather than on a capability.
- **Epic 5's replay** may be able to use Solari's own session replay rather than only the
  frames this platform captures. Not decided here; named so Epic 5 decides it deliberately.
- **The proxy and stealth features are deliberately NOT used** against synthetic systems on
  loopback. A Run's egress is confined to the Procedure Version's frozen allowed origins, and
  an escalation ladder that swaps egress mid-session is the opposite of that guarantee. If a
  later epic wants them for a real Target System, that is a scope decision with an audit
  consequence, not a configuration flag.

## SDK lifecycle and options, read from the cookbook

The owner supplied <https://github.com/solari-sdk/solari-cookbook/>. What follows was read from
it and from the installed packages, and each item changes something an implementer would
otherwise get wrong.

### `solari.close()` is required in Node, and `browser.close()` is not enough

```ts
const solari = new Solari({ apiKey: process.env.SOLARI_API_KEY! });
const browser = await solari.launch();
try {
  const page = await browser.newPage();
  await page.goto('https://example.com');
} finally {
  await browser.close();   // ends the session and releases the slot
  await solari.close();    // releases the client's loopback proxy server
}
```

The client keeps a loopback proxy server open for its connection-retry path, and that handle
keeps the Node event loop alive. A worker that closes only the browser **never exits**. This is
the same defect class this repository has already recorded three times — `fetch` resolves on
headers and an unread body holds the socket (Story 1.8), and `controller.abort()` missing from a
deadline's `dispose` (PR 23) — so it is a `finally`, not a happy-path call.

`browser.close()` also **releases the Solari session**. Leaving the browser open holds the
session slot until the plan deadline, so an abandoned Run costs capacity until it times out.

### `expiresAt` is a hard deadline, and `timeoutMs` is not what I first wrote

**Corrected after reading the installed `.d.ts` rather than the prose.** `timeoutMs` sits on
`SolariOptions` — the CLIENT constructor, beside `maxAttempts` and `backoffMs` — and bounds the
SDK's own HTTP calls to the gateway. It says nothing about the browser.

What actually ends a session is `Session.expiresAt`: *"Plan-tier deadline (ISO 8601 UTC); session
auto-releases at this point."* A hard deadline, set by the plan tier. So a Run **must not assume
its workspace outlives `expiresAt`**: it is stored on the workspace row beside the session id and
checked at every reattach, because an expired session is GONE rather than unhealthy and has to
fail cleanly and distinguishably from a provider outage.

**The frozen Run limits stay the authority for ending a RUN** — `exhaustedRunLimit(usage,
plan.limits)` on elapsed time and Step Executions, enforced independently, exactly as on the
adapter path. `expiresAt` is a fact about the workspace that the Run respects and records; it is
never the mechanism that decides a Run's outcome.

### `recording: true` must be passed at session creation

`recording?: boolean` on `CreateSessionOptions`, "Off by default", with no way to turn it on
later. `sessions.getReplayUrl(id)` is available **~1–3 seconds after `releaseAndWait`** (not the
~30 s I first wrote), and `downloadReplay(id)` returns NDJSON bytes. **This is an Epic 5
constraint that has to be honoured in Epic 4**, because the decision is taken at
`sessions.create()`, which is Story 4.1's code. Story 4.1 therefore threads the flag through the
workspace options even though nothing reads a replay yet.

### Releasing: `release` is fire-and-forget, `releaseAndWait` confirms

`sessions.release(id)` returns `void`. A Run's terminal transition uses `releaseAndWait`, because
a fire-and-forget release leaves the workspace row saying released while the provider may not
have. `BrowserSession.close()` is documented *"Close the browser and release the session.
Idempotent."* — it does both, and is safe to call twice.

### `SolariErrorCode` is five codes and they are not one class

```ts
"FeatureRequiresPlan" | "ConcurrencyLimitExceeded" | "PlanLimitExceeded"
  | "BrowserUnhealthy" | "InvalidSessionId"
```

widened with `| string`, so an unknown code is treated as non-retryable.

| Code | Meaning | Response |
|---|---|---|
| `ConcurrencyLimitExceeded` | Every slot busy right now | Retryable with backoff |
| `BrowserUnhealthy` | Transient provider fault | Retryable, with a FRESH session rather than a reattach |
| `PlanLimitExceeded` | The plan's ceiling | **Refusal.** Fail with a recorded operational reason |
| `FeatureRequiresPlan` | The tier does not permit it | **Refusal.** Retrying spends the budget against a wall |
| `InvalidSessionId` | The stored workspace identity is gone | Reattach fails cleanly. This is what distinguishes an expired session from a provider fault |

`launch()` also takes `retries`, `probe` and `probeTimeoutMs` — a post-connect health probe that
catches a dead browser at launch rather than at first use.

### The SDK's Playwright is `patchright-core`, not `playwright-core`

`@solarisdk/browser` depends on `patchright-core@1.62.2`, and `BrowserSession.raw`, `contexts()`,
`newContext()` and `newPage()` are typed against ITS `Browser`, `BrowserContext` and `Page`.
Those are separately declared types from `playwright-core`'s. The port in
`packages/application` has no host types at all (AD-11) and so must be structural regardless;
the infrastructure adapter is where the two meet, and the meeting is deliberate rather than
papered over with a cast.

### Profiles are opt-in and explicit

Cookies and `localStorage` persist server-side only when a profile is named AND
`solari.profiles.save()` is called. Without one, every session starts clean — **which is what
per-Run isolation wants**, so this platform names no profile and never calls save. Stated here so
a later story adding "resume where the agent left off" knows it is choosing to weaken isolation.

### `proxy` and `captcha` both require `stealth: true`, and all three stay off

Confirmed against the SDK. `proxy: "smart"` runs an escalation ladder and swaps egress in place
when it detects a block — the opposite of confining a Run to the Procedure Version's frozen
allowed origins. Off, deliberately, and named in the Story 4.1 spec rather than left to a
default.

### Session identity and errors

`browser.id` is the session id and is the value to record on the workspace row and in the
Timeline event — it is what makes a Solari-side session correlatable with a Run. `SolariError`
carries a `code`; `FeatureRequiresPlan` is a refusal, not an outage, so it must fail the Run
rather than consume its retry budget — the `credential-unresolved` rule from Story 3.3.

### Key format and region

`SOLARI_API_KEY` looks like `slr_live_…`, from console.getsolari.com. `region` defaults to
`us-west`; `baseUrl` replaces it for a staging or self-hosted gateway. Neither is hard-coded —
both are configuration read in a composition root, per AD-11.

## Two different questions, and only one of them needs a probe

The owner's review asked to "distinguish configured Solari mode from live-provider validation".
They are separate questions and this document previously answered only the first while sounding
like it had answered both.

| Question | Answered by | What it can and cannot say |
|---|---|---|
| Which mode is this deployment CONFIGURED for? | The worker's own boot line | Faithful, because it is the real composition root every Run inherits. Says nothing about whether the provider works |
| Does the configured provider ACTUALLY work? | `packages/infrastructure/scripts/probe-solari.mjs` | Creation, reachability, capture and release, measured. Says nothing about which mode a deployment is set to |

### The configured mode

Still the worker, and still deliberately not a script:

```
{"message":"Agent Workspace mode selected","mode":"solari","reason":"SOLARI_API_KEY is configured"}
```

`agentWorkspace(config)` in `apps/worker/src/startup.ts` emits it, and it is the same decision
`run_workspace.mode` then records on every Run. **But a worker with a key logs `mode: solari`
whether or not the gateway ever accepts that key**, so this line is not evidence the provider
works. The earlier "there is deliberately no `scripts/check-solari.mts`" reasoning was sound for
the mode question and was wrongly applied to the provider question.

The key never appears in that line or anywhere else: `WorkspaceRef` has no field for a key, a
token or an endpoint, so no checkpoint, payload, log field or error message has anywhere to pick
one up from.

### The live provider

`packages/infrastructure/scripts/probe-solari.mjs` — diagnostic only, on no shipped path,
imported by nothing. It exercises the four things the review named and nothing else, under the
options the platform actually ships (stealth, proxy and captcha off, no profile), because a
probe run under different options would prove a configuration no Run ever uses.

```bash
cd packages/infrastructure && node scripts/probe-solari.mjs
```

It exits non-zero when any step fails, the release included — a harness that prints FAIL and
exits 0 turns a failing check into an all-clear, which this repository has been bitten by once.

## Live-provider validation, 2026-09-06

Run against `api.getsolari.com` with the owner's `slr_live_…` key. Verbatim output, secret-free:

```
  ok  remote session created     id ip-10-0-10-40:7be139a8-…:1788724063527.5c1SE5gpjConFIQwPpx31w, 827 ms
  ok  plan deadline              expiresAt 2026-09-06T20:47:43.527Z
  ok  wire protocol connected    151.0.7922.34
  ok  public target reachable    example.com -> 200 "Example Domain"
  ok  screenshot captured        17202 bytes png
  ok  DOM read captured          "Example Domain\n\nThis domain is for use i"
  ??  synthetic on loopback      page.goto: net::ERR_CONNECTION_REFUSED at http://localhost:4300/loancore
  ok  session released           releaseAndWait confirmed
  ok  client closed
```

| The review asked for | Proven by |
|---|---|
| Actual remote creation | A session id and an `expiresAt` returned by the gateway in 827 ms |
| Target reachability | `example.com` answered **200** to a navigation made BY the remote browser |
| Capture | A **17,202-byte PNG** and a DOM read, the two mechanisms Story 4.4 builds on |
| Release | `releaseAndWait` confirmed, then `solari.close()` and a clean process exit |

Chromium **151.0.7922.34** is the provider's build, not this container's — which is itself the
evidence that the browser ran remotely.

### The boundary: what this does NOT prove

**A remote browser cannot reach the synthetic Northstar systems while they are on this
machine's loopback.** Measured, not assumed: `net::ERR_CONNECTION_REFUSED at
http://localhost:4300/loancore`. That is a fact about where the fixture is served, not a defect
in either the provider or the platform.

> **`[CLOSED 2026-09-08]`** Codex deployed Northstar `70497eb` to the existing Railway
> `northstar` service with the owner's authorization (deployment `65c63c65`, SUCCESS), and
> `https://northstar-production-b312.up.railway.app` serves `/health` and the real LoanCore
> sign-in form. The live workflow runs 34220819917 through 34223964866 then drove a real
> worker on Solari against it: sign-in, navigate, search, open the record, read three
> attributes, capture a screenshot, and a correct durable wait on the C2 policy question.
> The remote isolation gate (34224743734) passed. The boundary below is therefore historical
> for the hosted target; it still holds for anything served only on a developer's loopback.

What follows, stated plainly:

- **The golden P-1 and P-4 journeys in CI still run on local Chromium**, because the standard
  PR gate must not spend provider capacity or need a key; the hosted synthetic systems are
  used only by the explicitly selected live workflow.
- **Local execution is NOT evidence that the Solari path works**, and is never cited as such.
  The two guarantees differ, `run_workspace.mode` records which one a Run had, and this
  document's isolation table is the statement of the difference.
- **Live validation covers the provider path against a PUBLIC target only.** Creation,
  reachability, capture and release are proven; a full Procedure Version executing end to end
  through a Solari workspace is not, and is not claimed.
- **`recording` was off for this probe**, matching the shipped default. The replay path is an
  Epic 5 concern and the flag it needs is threaded through Story 4.1 already.

### Reaching the gateway from this container

Worth recording because it cost a wrong ask. This environment intercepts egress, and its
allowlist governs **only** traffic through its CONNECT proxy — measured three ways:

| From the SDK's own socket | Result |
|---|---|
| Raw socket, plain GET | `HTTP/1.1 403 Forbidden`, `x-deny-reason: host_not_allowed` |
| Raw socket, WebSocket upgrade | `HTTP/1.1 403 Forbidden`, `x-deny-reason: host_not_allowed` |
| Through the CONNECT proxy | **HTTP 401** — reached the gateway, refused for lack of a key |

The TLS peer certificate reads `issuer: "Anthropic"`, `subject: "*.getsolari.com"`, which is the
interception proxy terminating the handshake. The Solari SDK dials its wire-protocol socket
directly and has no proxy support, so **no allowlist entry could ever have helped it** — I had
asked the owner to allow the WebSocket host, which was the wrong ask, and the measurement is
what replaced it.

`packages/infrastructure/scripts/proxy-tunnel-preload.mjs` is the test-only bridge: a local TCP
forwarder that opens a CONNECT tunnel per connection, with `tls.connect` patched to redirect the
TCP endpoint only while `servername` stays the true host — so the handshake still terminates at
`api.getsolari.com` and is still validated against its certificate.

```bash
cd packages/infrastructure
TUNNEL_HOSTS=api.getsolari.com node --import ./scripts/proxy-tunnel-preload.mjs scripts/probe-solari.mjs
```

**It is not product code and is on no shipped path.** The worker composes the SDK directly and
Railway has no interception proxy, so nothing in a deployment loads it — the same boundary as
the test-only Anthropic HTTP preload the Story 2.7 browser proof already uses. An earlier version
wrapped `tls.connect` and returned a synthetic socket, which broke `fetch`, because undici drives
`tls.connect` itself; a redirect rather than a wrapper is why the caller still gets a real
`TLSSocket`.

## If the key is refused rather than absent

The mapped `SolariError` code says which, and the table above says which are retried: an
entitlement refusal is terminal and an outage is retried. An unrecognised code is terminal,
because calling an unknown reason transient would spend the whole retry budget against a wall.
