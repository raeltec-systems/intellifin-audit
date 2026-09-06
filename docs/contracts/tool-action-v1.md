# Tool Action, version 1

Every action an agent takes against a registered Target System, and the gate it passes
first (Story 4.2, FR-3, AD-4, AD-9). Normative for every later story in Epic 4.

## The gate

`authorizeToolAction(scope, request)` in `packages/domain/src/runs/tool-action.ts`. Pure:
no I/O, no clock, no host types. It reads the **version's frozen bytes** and nothing else —
not a current registration, not an authored instruction, not a value derived from anything
a page said.

`scope.target` is the `ProcedureTargetSnapshot` the Version froze: the six-key envelope
AD-2 hashes, beside the digest the registration stored. `scope.scopeValues` is the set of
values the Run's frozen population supplies for the Template's declared search keys.

The three rules apply **in order**, and the first one to refuse is the only reason
reported. One action gives one reason, rather than a list a reader has to rank.

| # | Rule | Denial | What it names |
|---|---|---|---|
| 1 | The action is in the frozen `permitted_actions` | `action-not-permitted` | the action |
| 2a | The destination is an absolute `http(s)` location with no credentials, no fragment and no dot segment | `destination-refused` | the sanitized destination |
| 2b | The destination is inside a frozen `allowed_origins` entry | `origin-not-allowed` | the sanitized destination |
| 3 | Every parameter is well formed and its VALUE is in `scopeValues` | `parameter-out-of-scope` | the parameter's NAME |

The order is the design. "You may not do that at all" is a stronger and simpler statement
than "not there"; a parameter only means anything once the action and the place are
permitted.

- **A write action is not expressible.** `PermittedReadAction` is a union of eight literals
  and every member observes, so `disable`, `delete-record` and `POST` fail rule 1 whatever a
  registration says. The check is `includes` over the frozen array, never an object index:
  the action is request input and `PERMITTED['constructor']` would answer a function.
- **A desktop contract admits no destination.** Its application identity occupies the
  `allowed_origins` slot of the six-key envelope and is not a URL, so rule 2b denies
  everything — the truth about a browser action against a system with no origin.
- **An empty `scopeValues` denies every parameter.** Fail-closed: a stage that has not put
  the frozen population in front of the gate has not proved a value is inside it, and "no
  scope" must never read as "no rule". Story 4.2's sign-in carries no parameters; the first
  parameterised action is the story that searches (4.5), which supplies the population's
  own values rather than widening this.
- **Parameter values compare as exact opaque strings.** No trimming, no case folding, no
  numeric parsing — the identity-key rule of contract v1, one layer along.

### Where it lives, and why not in the adapter

**At the port's CALL SITE, in `packages/application`**, and never inside a provider
adapter. `performToolAction` in `execute-agent-steps.ts` is the only path from a stage to
`BrowserExecution.perform`, and it calls the gate first. A provider that enforced its own
allowlist would make the guarantee a property of that adapter, and the whole point of the
port is that the provider can be replaced.

The workspace's request interception (Story 4.1) is the **second** boundary, not the first:
every request a page makes is continued or aborted inside the browser against the same
frozen origins. `tests/integration/agent-execution.test.ts` calls the port DIRECTLY, with
the gate bypassed, and asserts the request still never reaches the server.

### It is NOT the authoring check

`scopeWideningWarnings` (FR-8) reads prose and **never refuses**, because an auditor must
be able to save prose a checker misreads. This one reads the frozen contract and **always**
does. Two mechanisms, deliberately: if they shared an implementation, making one strict
would silently make the other strict too, and a false positive would then block a save.

`tests/unit/scope-widening.test.ts` proves both halves against the same fixture, and builds
each execution action out of the value the ADVISORY check named — so the thing the Builder
flagged is provably the thing the gate refuses.

## The origin rule has one home

`withinFrozenOrigin(origin, candidate)` in the same module, over strings.
`packages/domain` and `packages/application` compile with `lib: ["ES2024"]` and no host
types at all — the compiler-enforced half of AD-11 — so there is no `URL` there, and
`packages/infrastructure/src/runs/origin-policy.ts` is now a `URL`-shaped door onto this
function rather than a second copy of the answer.

An allowed origin may carry a path prefix (`http://localhost:4300/loancore`), so the
comparison is authority AND path boundary: `/loancore-other` is outside `/loancore`.
Default ports are normalized, the scheme and host are lower-cased, and a dot segment is
**refused rather than resolved** — normalizing would be doing the browser's job with the
browser's rules, and the two only have to disagree once.

`sanitizeDestination` is the other half and is deliberately different: it STRIPS
`user:pass@`, the query and the fragment and caps the result at 500 characters, because a
destination that was denied FOR carrying credentials must still be recorded, and recorded
without them.

## The recorded shape

`run_tool_action`, one row per action, generation 28. **One table and one shape for both
surfaces**, so a reader compares them rather than translating — AD-6 says it in as many
words: "every lookup or extraction is an Adapter Action on the Timeline with the same
sanitized-action schema". `surface` (`agent` | `adapter`) is the only field that
distinguishes the two producers.

There is nowhere in it for a credential, a request body, a response body, a header or a
provider object.

| Column | Contract |
|---|---|
| `destination` | scheme, authority and path only. Never a query string, which is where a token or a signed URL lives |
| `parameters` | the PLATFORM's own name/value pairs, so §B.1 can derive an absence proof's query string from this log rather than from anything the agent reported about itself |
| `outcome` | `performed`, `denied` or `failed`. A denial ALWAYS names its rule and a performed action never carries one — `run_tool_action_denied` is one CHECK because either half alone permits a row that reads as the other |
| `method` | `GET` or `HEAD`, at the database. A read-only execution takes no other, and the system it reads refuses every other at its own level |
| `status` | the response status when one came back. A 401 is `performed` with `status: 401`: the action HAPPENED and the system said no, which is a different fact from a gate refusal |
| `redirected`, `downloads` | what the workspace observed. A download is offered and never executed (`acceptDownloads: false`) |

**A denied SUB-RESOURCE does not fail the Tool Action.** A page referencing a font, a
beacon or an image off-origin is ordinary; the request is aborted in the browser and
recorded as a security event, and failing the action for it would report `scope` for
something the platform never attempted. What is checked after a successful navigation is
where the MAIN document ended, against the workspace's own allowlist — so a same-origin
redirect is legitimate and a cross-origin one is not. On the FAILURE path the workspace's
denial COUNT is what distinguishes "the allowlist aborted this" from "the network broke",
because Chromium reports both as an aborted navigation.

Ordering is `(started_at, tool_action_id)`; the id is a UUIDv7, so the tiebreak is
deterministic rather than arbitrary. `saveToolAction` is `ON CONFLICT DO NOTHING`:
rewriting the record of what a Run did to a Target System is not something this table
should be able to do.

**Story 4.2 writes the `agent` rows only.** The adapter path's own Adapter Actions are a
later story; the SHAPE is here so it does not have to be invented twice.

## What a denial costs the Run

`stopCauseForDenial` maps the vocabulary onto §E.1: `action-not-permitted` and
`parameter-out-of-scope` are `action-denied`; `origin-not-allowed` and
`destination-refused` are `scope-violation`. Both are TERMINAL for the Run and both carry a
`security.action-denied` event, appended once from `stopRun` rather than remembered at each
call site.

**A denial is never reported as a transport failure.** Epic 3 paid for that: a 403 landing
in `!response.ok` was retried three times against a system that would go on refusing, and
the only durable record that the platform had been told no was a transport count. A 401 or
403 from a Target System is `denied`; a redirect out of the frozen origins is `scope`; both
are terminal on the FIRST attempt, because the same frozen bytes make the same decision
every time.

## The sign-in Session Step

`executeAgentSteps` in `packages/application/src/runs/execute-agent-steps.ts`, one
`sign-in` Session Step per agent-driven Target in frozen order, after population
acquisition and before any Work Item — the order the compiler froze.

- The destination is the frozen origin itself (`allowed_origins[0]`, a normalized set, so
  "the first" is deterministic for one frozen contract — and SORTED, so a registration with
  several origins signs in at the one that sorts first). **No path is guessed.**
- The credential reference comes from the frozen plan's `credentialReferences`, is resolved
  through `CredentialResolver`, and is compared against the reference the resolver echoes.
  It is presented by the INTERCEPTION, to requests inside the destination's own frozen
  origin only, and dropped the moment the action finishes. `setExtraHTTPHeaders` was
  rejected: the workspace's allowlist is the UNION of every web Target's origins, so once a
  plan names two web systems it would send the first one's credential to the second.
- The step is proved by the SESSION BEING ESTABLISHED — a 401 before, a 200 after, and a
  cookie the workspace now holds — never by "a form submitted", which LoanCore does not
  have. See `epic-4-loancore-authentication-decision.md`.
- Budget: `sessionStepAttemptBudget(plan.limits)`, one cycle, because §E maps a Run-level
  Session Step's failure to `RUN_FAILED` and the owner's automatic second cycle exists to
  let a Run CONTINUE past a failed unit. Exhaustion is `RUN_FAILED` with a sealed Result.
- An unresolvable credential and a desktop Target are TERMINAL on the first attempt.
- A retry is NEVER propagated to the queue: a redelivery re-verifies the population
  Evidence and spends one of that stage's four durable attempts, so the agent phase keeps
  its own checkpoint (`run_agent_execution`) and its own recovery sweep.

## Retrieved content cannot become an instruction

There is no channel. The gate reads the frozen snapshot; the destination is the frozen
origin; the actions are the frozen list; the parameters are checked against the frozen
population. Nothing in this contract reads a response body, and `BrowserActionResult`
carries a status, a sanitized location, two booleans and a count — there is no field a page
could put text into.

## What is NOT in this contract

Capture, Structural Snapshots, Observations, absence proofs and Escalations are Stories 4.4
to 4.7. The `web_tree` snapshot substrate is still unimplemented BY NAME (Story 3.6), and
the adapter stage still refuses a plan naming an agent-driven Target by name — so an agent
Run today signs in, is recorded, and then ends `RUN_FAILED` with the sign-in durable.
**Story 4.4 is what takes over.**
