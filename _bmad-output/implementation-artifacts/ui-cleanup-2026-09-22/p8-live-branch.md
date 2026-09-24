# The UI cleanup on production's branch, and UX-22..UX-26

Date: 2026-09-23. Branch: `feat/auditor-workspace-v1-1` (PR #51). Railway's `web` and
`worker` services build from this branch, so this is the branch production runs.

The owner chose this route ("1, go ahead"): bring the UI cleanup (PR #52, built on `main`)
into this branch, apply UX-22..UX-26 on the surfaces only this branch has, and deploy.

## What changed

**The UI cleanup is merged in.** `655a0c4` merges PR #52; `81d9653` brings its last two
test fixes (`1411df8`: the streamed Runs table and the "Run canceled." race). The merge
conflicted in 20 files. `b6de043` and `f76137c` settle the merged Run surfaces and the specs
both branches rewrote.

**UX-22..UX-26, on this branch's record review and workspace:**

| Finding | What the reader sees now | Commit |
| --- | --- | --- |
| UX-22 | The record queue lists Exceptions first, then records waiting on a person, each in source order. Source and coverage figures are under one closed disclosure; a failed check stays outside it. | `ed12dfd` |
| UX-23 | Only the queue scrolls on its own. The workspace has one compact header (title, lifecycle badge, one caption line). | `ed12dfd`, `857b08b` |
| UX-24 | Plain words: "Latest saved screen" (evidence) is told apart from the live preview (a few seconds behind, not evidence). Readable times in the chat. A digest "matched when the file was saved". | `ed12dfd`, `857b08b` |
| UX-25 | One record label everywhere: the key, then the person's name. A field the frozen binding marks sensitive is masked and cannot be searched. | `ed12dfd`, `857b08b` |
| UX-26 | Each row and each captured target says its evidence checks in words. | `ed12dfd` |

**Defects found on the way, all fixed:**

- **The worker could crash on a failed sign-in click** (`4fb3757`). The sign-in armed a
  response wait before the click and observed it only after; a click that failed left the
  wait unobserved, and its later rejection stopped the worker process. This is product
  code, and `main` has the same line.
- **Replay threw the reader back to the first frame** whenever any Run ended anywhere
  (`fcad036`). The viewer's key carried the read time; the shell re-reads every page when a
  Run ends. The key is now the Run and the request.
- **Live View and the workspace named a step the Run had finished long ago** (`857b08b`).
  They took the newest row of a page that holds the oldest fifty steps.
- **Specs that could not pass on this branch** (`857b08b`, `96c7f51`, `ad4e19f`,
  `bf06297`): five asserted "Action-linked captures", which the page stopped saying before
  this work; Resume needs Run control here; a page with control renews every 30 seconds,
  and the renewal receipts must leave in the same transaction as their Run; one spec still
  waited for two sentences UX-49 made transitional; clicks on Acquire and Resume landed
  while a control re-read had them disabled (by design) and were not retried; and three
  tests left a held network route running into the next test. `tests/e2e/run-control.ts`
  holds the one way the specs now acquire, resume and compare a Run's events.
- **After the deployment, two more races in the preview worker spec** (`20d35d2`,
  `e42f2e8`). The sweep above did not reach `workspace-preview-worker.spec.ts`, which only
  the preview job runs: its Acquire loop and its single Resume click now use
  `run-control.ts`. It also let its held model turn go at the same moment it clicked "Stop
  Run" (and "Pause Run"). The worker could then answer the turn, act and start another held
  turn before the command was saved, so the Stop never reached a boundary and the Run
  stayed running. Two cold local runs failed this way. The spec now waits for the Run's
  saved pause or cancellation marker first. Test-only: no product code changed.
- **CI on `d0b4c15` then failed twice, each time on a different test, and neither was a
  product defect.** The first attempt failed 7 frame tests: `next dev` never answered the
  frame image route (`/api/runs/<id>/frames/<id>`), from its first request to the end of
  the run. Every other route answered, and the evidence inspector's reads through the same
  worker-signed grant passed at the same time. The one re-run served that route 39 times.
  The re-run failed `run-controller-lease.spec.ts:368` instead, with "Route is already
  handled!". That came from the test's own cleanup: Playwright's
  `unrouteAll({ behavior: 'wait' })` removes the page's interceptor as soon as the first
  held request answers, and a second held request that was still being fetched lost its
  route. `tests/e2e/held-routes.ts` now lets every held request answer before the routes
  go, and the six tests in that spec that hold requests use it (`d915654`). Test-only.
- **CI on `fdf499e` then failed 1 of 284, and again the product was right.**
  `run-controller-lease.spec.ts:606` checked "the dialog is gone, or it offers the retry"
  in two reads: the count, then the text. The page recorded the resume once, then closed
  the dialog between the two reads. The text read then waited for a dialog that never came
  back, and the check timed out with its earlier answer. The spec now reads both facts in
  one read. Test-only.
- **CI on `d1a3f30` then passed the browser suite, and the abuse mutation job failed once
  before any of its tests ran.** Its case `model-response-credential-containment` waited 180
  seconds for the web server and stopped, and the job log said nothing more: the harness kept
  only Playwright's JSON report, which holds no web server lines. The one re-run passed, so
  all 7 jobs were green. `5ceb420` makes the harness keep the web server's own lines when a
  run fails before its tests: a bounded tail, secret values replaced by their names, repeated
  health polls folded. If it happens again, the log says why. Test-only.

The deployed commit before this work, `ec673a0`, was itself red in CI (6 browser and 2
preview failures). Those are among the fixes above.

## Verification

CI on `bf06297` (run 35842373291): all 7 jobs passed.

| Job | Result |
| --- | --- |
| Typecheck, boundaries, unit tests | 5,380 of 5,380 unit tests (292 files) |
| Migrations and integration tests (PostgreSQL 18) | 780 of 780 (57 files); migrations match the schema; agent guard mutations proven |
| Accessibility and shell (Playwright, WCAG 2.1 AA) | 17 of 17 focused; full suite 284 passed, 12 skipped, 0 failed |
| Protected preview and compiled-worker lifecycle | 12 of 12: the 12 the full suite skips |
| Agent abuse mutations (hydrated UI and worker) | passed |
| Container images build and refuse to start unmigrated | passed |
| Auditor Workspace P0 design browser checks | passed |

The 12 skipped browser tests are the protected live-preview proofs
(`workspace-preview.spec.ts`, 10, and `workspace-preview-worker.spec.ts`, 2). They need an
isolated preview broker and database, so they skip unless `WORKSPACE_PREVIEW_PROOF=1`, and
the preview job runs all 12. The two Solari specs are not in the count: they use a paid live
provider and run only in their own workflow.

Locally, against this worktree's own PostgreSQL 18 database, before each push:

- Root typecheck clean. 29 mutation anchors checked, none drifted.
- Browser specs in parts (the full suite ran in CI): every spec that acquires control,
  73 of 73; the tail of the suite (shell through writing assistant), 58 passed and 12
  skipped as above; throwaway copies of the two event-list journeys that wait 35 seconds
  after acquiring control, so a lease renewal really happens, 37 of 37 with the specs around
  them. No rows were left behind by any run.
- Mutation proofs: the Replay key (unit and browser), the record queue order, masking and
  names (three PostgreSQL cases, four SSR cases), the current step read (integration).
- For `e42f2e8`: both preview specs from a cold cache, 12 of 12. A throwaway copy that
  holds every command request for two seconds passes with the new wait and fails at the
  Stop without it ("Received: RUNNING"), the same failure the cold runs showed.
- For `d915654`: `run-controller-lease.spec.ts` from a cold cache, 16 of 16, no rows left
  behind. A throwaway script with two held requests, one still being fetched when both
  are released, failed 5 of 5 with the old cleanup ("Route is already handled!") and 0 of
  5 with the new one. The five specs the first attempt failed (frame tests) passed 22 of
  22 locally from a cold cache.
- For the `fdf499e` failure: a throwaway spec that closes the dialog between the two reads
  failed 5 of 5 with CI's message ("Received: false" after "exceeded while waiting on the
  predicate"), and 0 of 5 with one read. Then `run-controller-lease.spec.ts` from a cold
  cache, 16 of 16, and the fixed test 5 more times, 5 of 5. No rows left behind.
- For `5ceb420`, in a clean detached copy with its own database: two failures forced before
  any test ran. Without `BETTER_AUTH_SECRET`, the kept lines say "Refusing to start" and name
  the key. With the database unreachable, they say "Startup checks deferred" with
  `ECONNREFUSED`, and three minutes of health polls fold into three lines. No secret value
  and no worktree path in either. Then the full harness from a cold cache: 7 of 7 cases,
  every baseline green and every mutant caught, and nothing kept for a green run. Each
  Playwright run printed 10 to 45 KB. (That run was on `4345b42`, which differs from
  `5ceb420` only in three comments.) The unit test has 9 cases; 13 mutations of the tail
  rules each fail it.

## Deployment

`bf06297` was deployed to Railway production on 2026-09-23, both services by name
(a push to this branch deploys nothing). No migration: the database stays at schema
generation 61, and nothing in `ec673a0..bf06297` changes a migration, a Dockerfile or the
Railway configuration.

| Service | Deployment | Result |
| --- | --- | --- |
| web | `e48fd38d` | SUCCESS at 10:15:24 UTC. "Startup checks passed" (PostgreSQL 18, schema 61, supported 61..61). The `ec673a0` deployment was removed at 10:15:27. |
| worker | `cf7873d1` | SUCCESS at 10:19:10 UTC. "Startup checks passed" (schema 61), Agent Workspace mode `solari` with recording `false`, heartbeat loop started. The `ec673a0` deployment was removed at 10:19:12. |

From 10:15 to 10:19 the web ran `bf06297` and the worker still ran `ec673a0`. That is safe
here because the schema did not change.

Checked after the switch: `/api/health` answers `{"status":"ok","schema":61}`, `/sign-in`
answers 200, and `/runs` without a session redirects to `/sign-in`. Neither service logged
an error after it started. Production accounts were not used, so no screen was checked
signed in.

Rollback, if needed: deploy `ec673a0` to both services. The schema is the same, so those
images start.

## Not done here

- PR #52 (the UI cleanup on `main`) is still open. Merging it changes nothing in production
  by itself, because production runs this branch.
- `main` still has the worker sign-in defect above. It is fixed there when this branch
  merges into `main`.
