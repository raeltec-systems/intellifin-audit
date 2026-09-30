# Story 20.2 review record

30 September 2026. Review baseline: `9c272c960342313055f053b917841a3cbc3c90f6`.
The complete tracked/untracked diff was captured without staging: 432,657 bytes,
9,940 lines, SHA-256
`5ab896d640d9197c7b13db7c60873eba315b9489109de342af170eadbff95c58`.

**Status: accepted; all 18 repair findings closed.**

## Independent acceptance before final review

The second agent independently reproduced the restricted-migrator/nonowner
runtime database contracts, actual HTTPS OIDC protocol matrix on its own provider,
identity/session tests and web contract tests. It then ran all 14 browser scenarios
with no retries in 51.5 seconds on its own disposable database and inspected the
desktop, narrow, Admin-empty and connection-loss renders. Its resources remained
separate from the development app and implementer's test database. Local acceptance
passed; hosted CI and live Cognito remain unqualified.

Root separately exercised the running HTTPS development app: real external
synthetic sign-in, keyboard engagement selection, exact scope, reload, 320px layout
and logout. There were no page errors or horizontal overflow. Stable captures are
under `/workspace/zobba-build-tools/evidence/20.2/`, with root's direct run under
`root-manual/`; independent evidence is `/tmp/zobba-independent-20.2-browser/`.

Early review found that disabled internal FK triggers escaped catalog validation.
The repair verifies the trigger contract and ordinary enabled state before reading
metadata. Independent actual migration and worker-startup checks now reject
disabled, replica-only and always-enabled modes without changing schema, grants,
ledger or marker. Restoring ordinary enforcement produces SQLSTATE23503 for the
invalid relationship. This finding is closed.

Other early repairs bounded failed provider initialization including queued waits,
preserved established sessions on unrelated callbacks, used composite engagement
keys, restored focus after committed views, provided native-navigation error
recovery and sanitized the actual Vite proxy logger. Their retained regressions
passed before the full review snapshot.

## Fresh BMAD layers and triage

Blind, edge-case and verification-gap reviewers received the complete snapshot in
fresh contexts. One initial edge-review turn stopped with a service content-filter
error; its authorized read-only source review completed on retry. No layer was
skipped. All results were collected before repair instructions were sent.

Root reconciled findings independently, combining only the same claim and repair.
The following are concrete patches within the existing secure sign-in, current
scope, bounded failure and usable recovery contract. None requires a product
intent change, architecture reconsideration or a user decision.

| Finding | Consequence / severity | Required repair |
| --- | --- | --- |
| Automatic read refresh can cancel pending logout | Requested sign-out is lost and protected work returns; high | Preserve logout intent and its controller independently of focus/timer/visibility refresh; overlap regression |
| Failed logout's retry performs an access read | Recovery does not retry the action the person chose; high | Retain and retry sign-out without reopening work; handle lost response and fresh CSRF safely |
| Already expired session is reported as logout failure | Incorrect failure and recovery; medium | Treat authenticated endpoint 401 as signed out; retain 403/503 distinctions |
| Focused control disappears during revalidation | Keyboard position is lost; medium | Fall back to the committed heading when the old control is absent; expiry/revocation cases |
| Seed rerun recreates removed fixture authority | Explicit removal is silently reversed; medium | Distinguish first provisioning from rerun and preserve deleted/disabled assignments and membership |
| Same-key-ID material replacement never refreshes | Valid sign-in fails indefinitely; high | Bounded, coalesced refresh/retry on relevant signature mismatch, preserving all verification checks |
| Verification-key cache never expires | Published key changes can remain unseen for process lifetime; medium | Bounded cache lifetime, current-key refresh and retirement proof; no claim of a demonstrated remote auth bypass |
| Public abandoned login attempts have no capacity bound | Five-minute retention still allows unbounded outstanding rows; high | Atomic bounded admission, fixed recoverable capacity response and repeated/concurrent abandonment checks |
| Expiry cleanup scans/deletes the whole backlog | Request latency and lock work grow with backlog; medium | Expiry indexes and bounded cleanup at a fixed cutoff; substantial backlog/concurrency proof |
| Stored scope/label bounds differ from consumers | Assigned work can be listed but never opened, or poison the list; medium | Consistent database/API/web/OpenAPI constraints and boundary fixtures |
| The 101st assignment blocks all engagement access | Valid authority appears as dependency failure; high | Bounded pagination with usable navigation, complete scoped results and working explicit-scope access |
| OpenAPI omits callback and authentication inputs | Owned generated contract does not describe usable requests; medium | Document callback query, cookie authentication, CSRF/Origin requirements and relevant errors |
| Prior-session revocation lacks a real callback regression | Dropping the callback's previous-token argument goes undetected; high | Two actual sign-ins; replay first valid cookie must be401 while replacement remains usable |
| Oversize fixtures are invalid for unrelated reasons | Removing streaming byte limits still passes; high | Otherwise-valid padded token/discovery/JWKS responses, both declared/chunked length, plus bounded valid controls |
| Expired-token fixture also violates issued-at age | Expiry verification can regress undetected; high | Recently expired token with all other checks valid; retain distinct old-issued-at case |
| Unrelated callback clears another valid login binding | An unrelated navigation breaks an in-flight sign-in; medium | Clear only the matched/consumed browser-bound attempt; preserve unrelated current binding |
| Malformed fixture target escapes request error handling | Local IdP process terminates; medium | Fixed refusal inside request error boundary and retained local request regression |
| Teardown SQL failure bypasses process cleanup | Owned fixture servers leak into later runs; medium | Always close owned resources in finally; exercise failed restoration cleanup |

All rows route to **patch**. Repairs, executed post-patch checks and final
independent acceptance will be recorded below before this story is marked done.

## Consolidated repair result

The original implementer completed one consolidated repair batch. Logout intent
and its controller now survive automatic reads and uncertain responses; retry
performs sign-out with current CSRF, and an expired session completes sign-out.
Focus falls back to the committed heading when the prior control disappears.
Actual browser regressions cover the overlap, lost response, real 403 refusal,
expiry, second successful sign-in and unrelated in-flight callback cases.

Signing keys refresh on unknown-key or relevant signature failure, including
same-key-ID replacement, with coalescing and a five-minute cache lifetime. Expired
cache failures refuse sign-in. Oversize fixtures now contain otherwise-valid
responses in both declared-length and chunked forms; the expiry fixture isolates
expiry from issued-at age. All six byte-limit cases and the recent-expiry case
failed when their corresponding checks were temporarily removed. The implementer
restored source byte for byte and reran all twelve provider cases successfully.

Login admission uses a fixed 1,000-outstanding-attempt capacity in a serialized,
explicit READ COMMITTED transaction. Eight concurrent callers starting at 999
attempts admit exactly one, including connections defaulting to repeatable read.
Indexed cleanup removes at most 128 expired rows per operation; 10,000-row backlog
tests inspect the actual expiry-index/TID plan. One-time fixture provisioning
retains deleted or disabled authority on rerun. Scope identifiers and labels now
have matching database, Rust, HTTP and browser bounds.

The chooser uses 50-row composite-scope cursor pages, rechecks authority on each
page and opens an explicit authorized scope independently of the current page.
Tests cover 122 assignments, repeated local identifiers across organisations,
back navigation and revocation. Owned OpenAPI includes pagination, callback
inputs, cookie authentication, CSRF/Origin and relevant failures. Malformed
fixture URLs receive a fixed refusal, and teardown closes owned processes even
when restoration SQL fails.

Post-repair implementation checks passed: 42 Rust tests, 46 fixture tests,
9 web contract tests, 47 Python guard tests, and all 23 browser scenarios with
zero retries/skips. Formatting, workspace Clippy, locked build, frozen install,
generated contracts, boundaries and web build also passed. Stable repaired
browser captures are in
`/workspace/zobba-build-tools/evidence/20.2/repair-verified/`.

The second agent independently reproduced all 13 repaired database checks under
its restricted migrator/nonowner runtime, 11 infrastructure units, 12 actual HTTPS
provider cases, 46 fixture tests, 9 web contract tests and all 23 browser scenarios
with no retries/skips. It also checked actual JSON/native HTML capacity refusals
at 1,000 attempts, no new cookie or insertion, and inspected desktop, unavailable
and 320px later-page scope renders. It found no material issue. Its isolated
resources were closed; evidence is
`/tmp/zobba-independent-20.2-browser-postpatch/`. The verifier hash matches the
implementer's restored source; independent review did not repeat source mutation.

Root separately exercised the rebuilt development app with two real sign-ins,
old-session replay401/current-session200, keyboard scope selection, reload and
320px layout. A held logout survived focus/visibility refresh and completed
without reopening client work. There were no page errors or horizontal overflow.
Root visually inspected its captures in
`/workspace/zobba-build-tools/evidence/20.2/root-post-review/`.

Root accepts Story20.2 against its specified local boundary. All matrix rows and
post-repair gates, including process smoke, pass. Story status can advance to done
and the checkpoint can be pushed under the owner's batch authorization. Hosted
CI, live Cognito and customer SSO remain unqualified; no deployment is claimed.
