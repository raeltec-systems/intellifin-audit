# Story 20.4 implementation evidence

Implementation baseline: `1c598ca55511c6e27d6cc3a2e2b836912c2a9adf`.
The pre-review product snapshot passed all gates at 21:49 UTC. A consolidated
BMAD repair batch then addressed twelve accepted findings within the frozen
contract. Independent acceptance then exposed a cross-tab storage race, repaired
with atomic IndexedDB transactions. Product source is frozen for final independent
acceptance; the executed gates and preserved failure evidence are recorded below. Final product
and browser-harness source confirmed frozen: 2026-09-30 23:00 UTC.
Contract: [20.4 specification](spec-20-4-engagement-conversation.md), including
its three frontmatter context files and accepted Story 20.3 lifecycle limits.
The implementation agent has not changed specification/status acceptance,
committed, pushed, deployed, or provisioned paid resources. Root owns acceptance.

## Delivered behavior

An assigned engagement opens one continuing Pair conversation. Explicit New Task
and Guide targets bind every accepted message to the authenticated author,
current engagement audience, exact composite scope, immutable command and
Task/work cycle. Opening, pinning or following another Task never retargets the
composer. Cards show objective, accountable human, scope, factual state and Open.
The inspection preserves the original objective separately from the plain working
brief. Received, Applied, pending cessation, confirmed cessation and unresolved
activity remain different facts. Resume retains the paused cycle; Continue creates
a new cycle after confirmed Stop. Guidance alone never restarts work.

The conversation is a read projection of the existing immutable commands and
events. No second message acceptance engine, migration or alternate Task authority
was introduced. A snapshot reads message rows, current Task state and watermark
in one PostgreSQL MVCC statement. Every projection rechecks the current audience,
including empty results. Removed roles do not erase retained authorship. Author
and accountable-human labels come from the retained identity, independent of the
current viewer or the most recent guide.

The owned API adds `GET /engagements/{engagement_id}/conversation`,
`/conversation/history` and `/conversation/events`, retaining explicit organisation
and client query parameters. History remains fixed to its requested watermark;
current Task pages are fresh reads. The existing command endpoints still own all
mutation. New browser requests include `X-Expected-Actor`, an additional refusal
fence checked against the server-derived session actor before admission; it grants
no authority. Current session, CSRF, scope and membership checks happen before
idempotency lookup. Guide/Pause/Stop admission and exact retries do not wait on
ordinary browser access reads.

The browser persists exact actor, scope, key and meaning before transmission.
One strict-durability IndexedDB transaction checks immutable meaning and bounded
quota, writes the record, and commits before handoff or transmission. The editable next draft is independent of uncertain requests.
Explicit retry uses original bytes and current authority; neither actor/scope
replacement nor an obsolete callback can expose or replay another binding's work.
Storage failure prevents transmission. Definite 409 refusals can be dismissed;
uncertain requests keep their recovery key. Successful revalidation retains draft,
selection, pin and focus. Failed reads withdraw server projections and clear
cached inspection; successful recovery removes only the transient read error.

The layout retains Pair assets, Hanken Grotesk, Linen navigation, Canvas
conversation, Paper work and Graphite Send. The composer and named Task controls
sit outside independently scrolling history/details. Narrow Conversation/Workspace
views preserve scope and targeting. Enter sends, Shift+Enter inserts a line,
Escape closes inspection and returns focus, and incoming work does not steal
focus. Follow Zobba follows the latest durable Task receipt only after explicit
selection. Routine cycle labels are short; full exact IDs remain in attribution
and payloads. The foundation notice and empty work-product shelf make clear that
no model, audit evaluation, work product or real computer capability is delivered.

## Bounds and recovery contract

- A snapshot/history/current-Task page contains at most 100 rows. Backward history
  is complete and explicitly pageable; the browser replaces bounded pages rather
  than accumulating the entire conversation.
- Feed pages contain at most 100 contiguous events. Decimal string cursors never
  pass through floating-point numbers. Missing/future cursors or a backlog above
  1,000 events require explicit resynchronisation. The client refreshes a
  consistent snapshot instead of reconstructing current state from a partial
  message page. Later Task pages refresh their current cycle and cessation.
- Reads use ordinary capacity: eight HTTP permits and the existing four database
  connections, with a three-second SQL statement timeout inside the existing
  six-second HTTP deadline. No transaction waits for a viewer. Controls retain
  their separate four permits and two database connections.
- Polling is finite, one poll at a time, normally every two seconds. Browser
  requests have eight-second deadlines and streamed JSON bodies have a 4 MiB cap.
- Recovery retains at most eight pending requests per actor/scope, including two
  reserved Pause/Stop slots, and 64 globally, including four reserved control
  slots. Current reads use a bounded actor/scope index. Legacy-preview detection
  scans at most 2,048 key names. No network request runs inside a transaction.
  Unavailable recovery storage or a failed commit refuses transmission explicitly.

## Executed verification

| Gate | Result |
|---|---|
| Restricted PostgreSQL projection suite | 3 passed, including the full conversation acceptance parent |
| Extended actual HTTP suite | 3 passed, including saturation, original lost-ACK receipt and actor-change refusal |
| Final locked Rust workspace suite | 81 passed, 0 failed; one helper entry explicitly exercised by its passing reliability parent |
| Formatter / locked workspace Clippy / locked build | Passed |
| Frozen pnpm / generated contracts / TypeScript / web unit tests / production build | Passed; 71 unit tests, 0 failed/skipped |
| Independent actual HTTPS OIDC fixture | 46 passed, 0 failed/skipped |
| Python script guards / inward boundaries | 47 passed; boundary check passed |
| Actual process smoke | Passed, including three bootstrap tests, repeated explicit migration, database-loss 503 and same-process recovery |
| New principal conversation browser journeys | 8 passed, including actual API/worker interruption and consumed-crash uncertainty |
| Final combined retained and new browser suite | 46 passed in 3.6 minutes; 0 failed/skipped/retried |
| Independent final repair acceptance | 71 web tests, 15 focused browser cases and one real abort-after-request-success proof passed; final source/fixture review accepted |
| Independent running visual inspection | Root inspected 1280×800, 390×844 and 320×844 and closed the composer/control visibility finding; 0 page errors |

The Rust suite used PostgreSQL 18 with database `zobba_patch20_3_test`, a
NOSUPERUSER/NOCREATEROLE/NOBYPASSRLS migration owner `zobba_patch20_3_owner`, and
separate nonowner runtime `zobba_patch20_3_app`. The browser/smoke suite used the
separate guarded `zobba_story_20_test` database and restricted `zobba_app` runtime.
Destructive suites were sequential within each database; the independent reviewer
database was untouched. Browser tests used the repository-owned Playwright and
installed `/usr/bin/chromium` because the Browser plugin was unavailable.

PostgreSQL proof covers two Task/message bindings, exact repeat/conflict,
fixed-watermark Applied facts, retained departed-author identity, foreign-scope
and current-reader denial, a snapshot while a real commit is held, 205 concurrent
admission/snapshot races, complete bounded message/event pages, actual missing
event gaps, replay overflow and pooled-scope isolation. HTTP proof additionally
holds all ordinary permits while a same-key Guide retry succeeds through reserved
capacity, and uses another valid session/CSRF with the old expected actor to prove
refusal before mutation.

Browser success is never mocked. Tests use actual OIDC callbacks, Rust HTTP,
PostgreSQL and optional real worker subprocesses. Fault interception delays/drops
real responses. Test-only SIGSTOP/SIGCONT makes received Pause/Stop observable
before joined cessation; SIGKILL after consumption verifies uncertainty through
replacement ownership without replay. Production gained no fault flags.

Post-review gate logs are `/tmp/zobba-20-4-review-workspace-final.log`,
`/tmp/zobba-20-4-review-web-final.log`, `/tmp/zobba-20-4-review-smoke.log` and
`/tmp/zobba-20-4-review-final-tsc.log`. Latest atomic-storage web checks and build
are `/tmp/zobba-20-4-idb-web-final.log` (71 passed). Pre-review logs remain
`/tmp/zobba-20-4-workspace-final.log`,
`/tmp/zobba-20-4-conversation-postgres.log`,
`/tmp/zobba-20-4-conversation-http.log`, `/tmp/zobba-20-4-smoke.log`,
`/tmp/zobba-20-4-web-postrepair.log` and
`/tmp/zobba-20-4-browser-combined-final.log`. The first combined attempt remains
recorded separately at `/tmp/zobba-20-4-browser-final.log`.
Final browser gate: `/tmp/zobba-20-4-idb-combined-final.log`; JSON results and
quiescent-worker metadata: `/tmp/zobba-20-4-idb-combined-final-results.json`.
The final 46 cases all passed with zero retries or skips. Both Pause and Stop
freeze attachments identify process 199902 / `zobba_browser_worker_45339_3`, stopped
state T, three exact worker connections, zero unsettled transactions, zero granted
locks and one live child. Final viewport captures
are under `/tmp/zobba-20-4-idb-combined-final/`;
root's independent actual development captures are under
`/workspace/zobba-build-tools/evidence/20.4/root-visible-demo/`.

## Matrix coverage

| Specification row | Executed proof |
|---|---|
| Attribution | PostgreSQL atomic command/message binding; HTTP exact receipts; actual browser creates two Tasks and sends Guide A while inspecting B, preserving target and retained author/accountable-human labels. |
| Lost acknowledgement | A real committed POST response is dropped, reload recovers original actor/scope/key/meaning, exact retry returns the original receipt, changed meaning receives 409 and history contains one message/card; two same-actor tabs preserve both uncertain requests. |
| Guidance | Browser/API assertions distinguish Received from Applied, restart actual API and worker, reload and inspect original objective separately from retained plain working brief. |
| Controls | Actual worker execution, test-only process suspension and resumption prove pending and observed Pause/Stop, same-cycle Resume and new-cycle Continue; consumed crash remains unresolved. Reserved controls and same-key retry succeed while ordinary reads/capacity are held. |
| Delivery | Restricted PostgreSQL snapshot/commit races, 205 concurrent admissions, bounded complete history/feed, gap/backlog resync and scoped pool reuse; client deferred-response ordering regression prevents installing an old later Task page behind a newer watermark. |
| Inspection | Real browser pin/follow, incoming messages, scope refresh, later Task pages, resize and identical next-draft race preserve explicit composer target, draft, selection and focus. |
| Authority | Current-reader checks including empty projections; actual revocation, actor/scope switch, logout and late callbacks withdraw protected state; original expected actor and current CSRF/session are checked before admission/idempotency. |
| Accessibility | Actual 1280/390/320 viewport capture and independent visual inspection; keyboard Enter/Shift+Enter, Escape/opener focus return, reachable controls, no horizontal overflow or incoming focus theft. |

## Consolidated BMAD repair batch

The root classified all twelve findings as implementation patches; no frozen
contract or owner-intent gap was identified. R1 preserves the successful storage
handoff across revalidation while suppressing obsolete transmission. R2 fences
both exact-inspection successes and failures. R3 retains exact durable receipt
evidence until an in-flight POST settles, with fresh authority refusal still
winning. R4 tracks notices by unresolved operation and clears only resolved
notices. R5 observes relevant actor/scope storage changes without replay or
reading another binding's payload.

R6 hides identity, names, roles, picker and engagement while checking access.
R7 retains hidden Task detail/control nodes and disclosure state through a
successful same-scope projection load, then restores exact focus; actual failure
withdraws them. R8 adds nullable `latest_activity` to the consistent scoped
snapshot so Follow includes current Received/Applied facts independently of the
displayed history page. R9 consumes one scroll for the exact persisted request
key. R10 checks a retained target against exact off-page inspection and refuses a
stale cycle visibly before transmission without clearing its draft.

The state suite now contains 51 lifecycle tests, including deferred storage
admission, old inspection failures, echo-before-lost-reply ordering, operation
notice resolution and bounded relevant storage events. Nine parser tests cover
the strict activity contract; PostgreSQL proves a later Applied event for an
older command omitted from the latest 100 messages. Actual browser journeys
hold access and projection reads, preserve control nodes/disclosures/focus,
follow activity while paging history, retain deliberate history scroll and
refuse stale off-page targets. The initial new browser proof needed two test
synchronisation repairs: await a held route's completion before unroute, and
await history-page replacement before capturing its first command ID. Neither
repair changes product assertions.

R11/R12 now hold a real IndexedDB write transaction while competing browser tabs
request admission. No pending reservation commits or transmits before release;
after release, only the one available ordinary slot is admitted, preserving two
Pause/Stop places. Repeated Enter creates one key/POST/durable command. The R1
case revalidates the same scope while admission is blocked: the original unchanged
draft clears after commit, an independently edited draft survives, no obsolete
POST occurs, and explicit recovery retains the key. Two further actual browser
cases prove the 60 ordinary/four reserved global bound and successful handoff when
post-commit notification throws. All five passed in
`/tmp/zobba-20-4-idb-locks-fixed.log`. Independent execution passed the same five
plus seven race and three review cases (15/15), in
`/tmp/zobba-independent-20.4/browser-idb-repair.log`.

The native Web Lock version initially passed three normal tests, but an independent
run passed only 12 of 13: the quota test admitted both competing requests. Diagnostic
`/tmp/zobba-20-4-lock-diagnostic-results.json` showed two renderer-local writes at
1790807390271 and 1790807390272, each observing 5→6. The first removal occurred at
1790807398643 and observed 7→6. Admission therefore exceeded the bound before
reconciliation; this was a real storage-authority defect, not a test timing issue.
The repair uses one authoritative IndexedDB store with binding/count indexes and
atomic quota/meaning checks. Status-only updates cannot resurrect reconciled rows.
Commit failure preserves the draft and suppresses POST. Signal delivery is best
effort; a committed handoff cannot become a failure when notification throws.
Controller disposal closes channels and the database, allowing existing transactions
to finish. Temporary access revalidation preserves saved uncertainty.

The earlier local-storage format was an unshipped preview. Its bytes are retained;
its own-binding records cause a typed refusal without import, replay or deletion.
Other bindings' payloads are not inspected. This compatibility limit is documented
in the developer README, without adding a migration flow to ordinary Pair use.

The replacement quota negative control bypasses only the atomic admission limit
in the test-served module. It failed the intended assertion with two accepted
commands where one was available, in `/tmp/zobba-20-4-idb-negative-quota.log`.
The duplicate-submission negative control removed only the synchronous draft fence
and failed with two persisted keys instead of one, in
`/tmp/zobba-20-4-idb-negative-submitting.log`. The old no-Web-Lock mutant
remains historical evidence, not an acceptance criterion for IndexedDB. Product
source is never mutated by these controls and successful API responses are real.

The first IndexedDB targeted run passed 16 of 20. Three failures were confined to
the new holder helper: a live transaction is inactive outside its request callback.
The helper now queues observation inside that callback, preserving the real held
transaction and all assertions. The fourth failure was a real Stop503 caused by
the process-suspension fixture: PostgreSQL backend190739 at 22:48:01.034 UTC timed
out while locking an engagement tuple in TaskRepository::lock. This evidence is
in `/workspace/zobba-build-tools/postgres.log`; it is separate from the storage
race. The fixture now tags the exact owned worker connections, waits for its stopped
process state, and requires idle connections, no transaction or granted lock, and
a live inert child before retaining the suspension. A nonquiescent sample is
thawed and retried within five seconds. Metadata is attached to the unchanged
202, pending and observed assertions. The initial child lookup encountered this
container’s missing `/proc/<pid>/task/<tid>/children`; the final lookup binds
candidates by actual PPID and exact executable/argument instead. The corrected
control journey passed in `/tmp/zobba-20-4-idb-worker-fixed.log`. This fixture
repair changes no production worker, admission deadline or control assertion.

A stronger permanent storage-failure case aborts the real IndexedDB transaction
after the add request succeeds. It proves zero durable rows, zero POST/messages
and retained draft, distinguishing request success from commit. The independent
scratch version and permanent case both passed. Final TypeScript and inward
boundary checks passed after browser test imports were made static and explicit:
`/tmp/zobba-20-4-idb-fixture-tsc.log` and
`/tmp/zobba-20-4-idb-boundaries.log`.

## Verification repairs and honest limits

The first aggregate Rust run exposed an existing concurrent seed deadlock:
catalog deparsing holds relation locks while another seed temporarily changes
RLS within its transaction. The seed now acquires a fixed transaction advisory
lock before its first catalog read, after validating local configuration. Exact
schema validation still precedes metadata reads; the no-regrant and all-or-nothing
RLS rules are unchanged. The actual concurrent seed/no-regrant suite then passed
four tests, followed by the entire 81-test Rust suite. All published migrations
and v1/v2/v3 catalog bytes remain unchanged.

Independent review found a same-scope ordering race: concurrent snapshot and later
Task-page reads could install an earlier page underneath a newer accepted
watermark. The refresh now awaits and fences the snapshot before issuing the
page read, then publishes the complete result together. A deferred client
regression covers the interleaving and a subsequent empty feed. The independent
reviewer accepted the fix using a separate reproducer and a negative control:
the original parallel implementation fails the same ordering assertion.

Initial browser verification found a missing default Playwright download; the
existing owned Chromium executable was selected without installing dependencies.
The first complete-browser attempt also exposed test assumptions invalidated by
the new UI: session polling can remove Refresh access before an expiry test clicks
it, and control labels now use concise cycle labels. Tests use a focus-triggered
access read and updated visible labels while retaining the original withdrawal,
focus, cookie and exact-cycle assertions. Initial principal-journey failures in
Escape expectation and route-gate cleanup were fixed without weakening behavior.
The first combined browser run finished 33 passed / 5 failed: four failures were
the expiry trigger or concise cycle selectors above; one actual-worker Stop
assertion saw the prior state instead of Stopping. That isolated failure's cause
was not established. The test now checks the actual Stop POST returns 202 and the
server reports stopped/pending before asserting the UI; the targeted journey and
three repeats passed, followed by the complete 38-scenario suite. These facts do
not establish a production Stop defect.

There is no model understanding, audit completion, external effect reconciliation,
real computer, paid service or deployment qualification in this slice. Consumed
activity lost after abrupt process interruption remains unresolved. Cross-tab
storage is recovery data, never a browser provider/session token. The unshipped
local-storage preview compatibility limit is preserved and documented above. A future
production identity/deployment qualification remains outside 20.4.

## Reproducible demonstration

Use the existing activation and local fixture environment; do not reset developer
authority or run destructive tests on the development database. Follow
[`zobba/README.md`](../../zobba/README.md) for explicit migrations and local
synthetic sign-in, and the
[browser README](../../zobba/web/tests/browser/README.md) for guarded automated
reproduction. The existing setup needed no new environment configuration fields.

1. Sign in as an assigned synthetic auditor and open FY2026 audit.
2. Send New Task “Review leaver access”, then “Investigate shared accounts”.
3. Explicitly select Guide for the first Task, open/pin the second, and send a
   contractual-date direction. Observe the first Task's Received binding while
   the second remains inspected.
4. Start the documented bounded inert worker. Observe the direction become
   Applied to the plain working brief, then reload/restart the owned API/worker:
   both cards, attributed messages and the original objective remain durable.
5. Use the guarded browser process journey for pending/confirmed Pause/Stop,
   same-cycle Resume, new-cycle Continue and consumed-crash uncertainty. It uses
   actual process cutoffs instead of offering simulated production controls.
6. Type a new draft, inspect/pin another Task, refresh access and resize to 390/320.
   The draft/target and focus survive, while Escape returns to the opener.
7. Inspect the empty work-product shelf and foundation notice. No visual state
   claims that an audit objective has completed.
