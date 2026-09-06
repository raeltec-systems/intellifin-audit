---
title: 'Epic 4 browser provider decision'
type: 'decision'
created: '2026-09-06'
revised: '2026-09-06'
status: 'final'
---

# Epic 4 browser provider decision

> **Revised the same day, after the owner said Solari is key.** An earlier version of this
> document treated Solari and Playwright as alternatives and chose Playwright. That was wrong,
> and the error is recorded here rather than deleted: I concluded the provider was unusable
> because it was absent from this repository, without checking whether it was obtainable. The
> packages are published and installable. **Solari is a managed remote browser that you drive
> WITH Playwright**, so the two were never competing choices.

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
both. So the epic is built for Solari and verified against it; the local mode exists for tests
and is documented as the weaker guarantee rather than presented as equivalent.

## What is needed, and what is not yet here

- **`SOLARI_API_KEY`.** Not present. `.env` currently holds an Anthropic key and an OpenAI key
  only. Until it arrives, the Solari path is written and unit-tested against the SDK's own
  types but cannot be exercised end to end.
- **Network reachability** to `getsolari.com` from this environment, through the agent proxy.
  Untested until there is a key to test with.
- A plan tier that permits the features used. `SolariError` carries a `FeatureRequiresPlan`
  code, so a refusal is distinguishable from an outage and must be surfaced as such rather than
  retried.

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
