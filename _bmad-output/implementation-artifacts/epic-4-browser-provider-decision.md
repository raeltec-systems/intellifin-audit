---
title: 'Epic 4 browser provider decision'
type: 'decision'
created: '2026-09-06'
status: 'final'
decided_by: 'implementing agent, with the owner asleep and the escalation cut off'
---

# Epic 4 browser provider decision

The owner asked that a blocking decision go to Fable. That consultation was dispatched and
was killed by the session rate limit before it read anything. It is re-runnable, but the
evidence below is already conclusive, so the decision is taken here and recorded for the
owner to overturn if they disagree.

## The facts, verified

- The architecture names Solari as the browser and sandbox provider, behind an
  application-owned `BrowserExecution` port (AD-4, amended to add `DesktopExecution`).
- `@solarisdk/browser` and `@solarisdk/sandbox` are **not installed anywhere in this
  repository** — no package.json entry, no import, no code. Checked.
- There is no account, credential or verified API surface for them in this environment.
- The architecture memlog records the technology gate REMOVING the sandbox SDK as unused
  and then re-adding it "to the seed pending web verification". That verification never
  happened here.
- Playwright and Chromium are installed, configured and already carrying the whole browser
  test suite.
- The Epic 4 web Target System (LoanCore) is served over loopback by `apps/northstar`.

## Decision

**Implement the `BrowserExecution` port and back it with Playwright for the proof of
concept. Name Solari as a deferred alternative implementation of the same port.**

The architecture's own stated success criterion is that "Railway, pg-boss, Better Auth,
Drizzle, Solari, model provider, or Next.js can be replaced without redefining what an Audit
Run means". The port is the contract; the implementation is not. Blocking the epic on an SDK
that is absent, uncredentialed and unverified would be choosing a name over the guarantee.

## What is honestly delivered, and what is NOT

This is the part that must not be blurred.

**Genuinely delivered by a Playwright implementation:**
- Per-Run isolation of browser state. A fresh `BrowserContext` per Run has its own cookies,
  storage, cache and session, is bound to that Run, and is destroyed at Run end. Nothing
  browser-side crosses between Runs.
- Allowlist enforcement at the browser. `context.route('**/*')` intercepts EVERY request the
  page makes, so a destination outside the Version's frozen allowed origins is refused
  before it leaves, and the refusal is a real event this platform can record.
- A control tree for the Structural Snapshot. The accessibility tree gives labelled nodes
  with addressable locators, which is what AD-18 needs for a grounded attribute.
- Read-only action enforcement, downloads, redirects, timeout accounting and sanitized
  action logging — all observable through the same interception point.

**NOT delivered, and to be recorded as a named limit rather than claimed:**
- **Process and network isolation.** A browser context is not a sandbox. The worker process
  is shared across Runs, and egress control is enforced INSIDE the browser rather than at the
  operating system or network layer. A defect in the worker itself is not contained by it.
  Epic 4's story text says "no state, credential, or session ever crosses from one Run into
  another"; that is true of browser state and is NOT true of process memory. The story spec
  must say so in those words.
- **A desktop surface.** `DesktopExecution` and the LedgerDesk Target System stay deferred,
  as they already are from Story 1.8.
- **Any claim that this is the production provider.** It is the PoC implementation of a port
  whose whole purpose is that the provider can change.

## Consequence for the epic

Epic 4 is deliverable and validatable against the synthetic LoanCore. The workspace-isolation
acceptance criterion is delivered in its browser-state sense and explicitly short of its
sandbox sense, and that gap is named in the story spec, in CLAUDE.md and in the epic report
rather than papered over. A guarantee that is really a naming convention is not a guarantee,
and neither is an isolation claim a browser context cannot support.

If the owner wants the sandbox sense, that needs Solari or an equivalent runner, credentials,
and a network policy — none of which exist in this environment.
