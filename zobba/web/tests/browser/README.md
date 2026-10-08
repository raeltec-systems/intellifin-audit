# Pair browser regressions

From `zobba/`, use the pinned toolchain, prepare the fixture and explicitly run
the disposable database smoke setup, then:

```sh
pnpm fixture:setup
pnpm --filter @zobba/web exec playwright install --with-deps chromium
python3 scripts/smoke.py
pnpm test:browser
```

Set all three deliberate test bindings: `ZOBBA_TEST_MIGRATION_DATABASE_URL`,
`ZOBBA_TEST_RUNTIME_DATABASE_URL`, and `ZOBBA_TEST_ADMIN_DATABASE_URL`. They must
refer to the same migrated, loopback PostgreSQL database named `*_test`.
Authentication tests use explicit CLI `migrate` and `seed-local` commands and change only
synthetic test authority/session records through the test-admin binding. Do not
run database suites or smoke reset concurrently with this browser command.

The authentication suite starts its own HTTPS `oidc-provider` fixture on
`127.0.0.1:9444`, HTTPS Vite on a free `localhost` port, the owned Rust API and a
PostgreSQL TCP proxy. Port 9444 must be free. A single provider runs for the whole
suite, giving repeatable issuer/subject identities. The dedicated database must
not contain the same seeded identities from a different issuer; rerun smoke to
prepare a clean database if needed. The suite never kills another server and only the explicit migration CLI changes schema. Runtime children receive no migration/admin/test
database credentials. Generated CA/client/password material stays ignored under
`fixtures/oidc/.local/`; no credential is printed or attached as browser evidence.

The browser follows the real external login page, enters the synthetic account
and generated password, and completes the ordinary code+PKCE callback. Rust TLS
verification remains enabled with the generated fixture CA. Playwright's
`ignoreHTTPSErrors` is scoped to this explicitly local HTTPS fixture suite only.
The Browser plugin is unavailable; these checks use owned Playwright/Chromium.

Verified flows include assigned scope and guessed/mismatched scope refusal;
Admin-only/unassigned empty states; combined audit/administration roles; secure
host-only session cookies and no browser provider-token storage; CSRF/Origin
refusal, invalid callback preserving an existing session, POST logout and session
replay refusal; current role demotion, membership expiry and session expiry;
protected-view clearing during database loss and recovery; desktop/narrow
layouts, asset loading, keyboard selection and focus through revalidation; actual
callback state/browser-binding/fixation/replay boundaries; and bounded concurrent
sign-in during a cold provider discovery failure with recovery.

The sign-out regressions hold a real POST while focus, timer, visibility and
page-restoration refreshes occur; interrupt database access; lose a successful
response; refresh changed CSRF on retry; and expire the session before sign-out.
No automatic read or navigation can cancel the pending action or reopen protected
content. Missing controls return keyboard focus to the committed heading.
Two actual successful sign-ins prove that the old valid session is revoked while
its replacement remains usable. A separate fixation case retains the invalid
cookie boundary; an unrelated callback must preserve the in-flight login binding.

Pagination provisions 121 actual assigned scopes, including duplicate local
client/engagement identifiers across organisations. It visits all three pages,
opens work beyond the first page through its explicit URL, rereads previous pages
after a label change, and rechecks a revoked assignment. Page navigation retains
only cursors; protected results are fetched afresh. The parser suite also checks
50-row response bounds, composite cursors, ASCII URL-safe IDs and Unicode labels.

The retained health regression starts its own ordinary HTTP API/Vite pair and
visits `/status`. It observes **Ready**, breaks only its own database sockets,
asserts real HTTP 503 and **Unavailable**, then restores the sockets and uses
keyboard **Check again** to recover **Ready** without losing focus. Neither the
PostgreSQL service nor any developer server is stopped.

The database harness resolves bracketed IPv6 hosts as real socket addresses and
uses an explicit URL port first, then `PGPORT`, then PostgreSQL's default 5432.
Migration, runtime proxy and test-admin connections share that effective port;
removing inherited PostgreSQL variables from child environments preserves it.
Invalid effective ports refuse with a fixed diagnostic. From `zobba/`, the
focused socket regressions exercise IPv4/IPv6, port precedence, disconnect and
recovery without a PostgreSQL schema reset:

```sh
pnpm --filter @zobba/web exec node --test tests/database-endpoint.test.mjs
```

The normal browser suite also routes all three guarded test roles through an
owned relay on an ephemeral port, using portless URLs plus `PGPORT`. It checks the
original database bindings before rewriting them. Migration and test-admin SQL
must refuse while that relay is disconnected and recover after it resumes; actual
HTTPS sign-in proves the authenticated path. The relay runs independently
of the test's synchronous CLI calls and never changes the PostgreSQL service.

`account-binding.spec.ts` holds a completed real session response while another
tab signs in to the same engagement as a different account. It verifies the new
identity, absence of the old private draft and zero command replay. The same
boundary verifies retained draft/editor/focus after same-account rotation,
obsolete-session refusal across every protected GET, delayed401 cookie safety,
and bounded recovery when the session keeps changing.

If Chromium is already installed, select it without another download:

```sh
ZOBBA_BROWSER_EXECUTABLE=/usr/bin/chromium pnpm test:browser
```

Only the nondestructive health regression can use the exact configured loopback
development runtime outside CI, through its existing URL equality guard:

```sh
ZOBBA_TEST_RUNTIME_DATABASE_URL="$ZOBBA_RUNTIME_DATABASE_URL" \
  ZOBBA_BROWSER_EXECUTABLE=/usr/bin/chromium \
  pnpm --filter @zobba/web test:browser tests/browser/health.spec.ts
```

Screenshots and failure evidence are written outside the checkout, under the
system temporary directory `zobba-browser-results`, or `ZOBBA_BROWSER_OUTPUT_DIR`.
CI uploads those screenshots as `zobba-browser-regression`. The harness closes
only its own processes after testing. Its final authority reset leaves the
synthetic seeded records available for inspection.
The reset runs inside `try/finally`: SQL restoration failure still closes Vite,
the API, the IdP and the database proxy. The final browser regression deliberately
fails SQL restoration and confirms that all four owned listeners are closed.

## Continuing engagement conversation

`conversation.spec.ts` and `conversation-races.spec.ts` use the same actual
OIDC/API/PostgreSQL boundary. Every accepted message originates in the real command
endpoint; interception only delays or loses a real response. The harness owns an
optional real worker process. Test-only SIGSTOP/SIGCONT holds its coordinator so
the browser can distinguish received Pause/Stop from subsequently observed
cessation. SIGKILL after actual consumption exercises unresolved recovery; the
replacement worker must not replay it. These signals never target developer
processes, and no production fault flags were added.

The conversation journeys cover two Tasks, guidance to A while inspecting B,
applied guidance retained across API/worker interruption, lost committed ACK plus
reload and exact-key retry, changed-meaning 409, explicit Resume/Continue, bounded
100-message and 100-Task paging, two-tab recovery, actor/scope replacement,
revocation, reserved control admission during held ordinary reads, stale callback
withdrawal, unavailable storage, conflict dismissal and editable next drafts.
Keyboard checks exercise Enter/Shift+Enter, pin/Follow, Escape/focus return and
same-scope access refresh. Viewport screenshots at 1280, 390 and 320 pixels check
that Send and named Task controls remain reachable without horizontal page
overflow. The work-product shelf and foundation limitations remain explicit.

To reproduce the first demonstration alone, after the preparation above:

```sh
ZOBBA_BROWSER_EXECUTABLE=/usr/bin/chromium \
  pnpm --filter @zobba/web exec playwright test conversation.spec.ts
```

Keep the full suite as the final gate; its existing 23 identity/health scenarios
remain active. The browser files reuse one disposable database sequentially
and preserve fixture membership after each scenario. Conversation cases truncate
only their guarded synthetic Task aggregates before each case. They do not reset
the schema, reseed customer data, or change the developer database.

The consolidated 20.4 review regressions additionally hold current authority and
projection reads to prove that the entire protected surface hides while Task
controls/disclosures retain their nodes and restore focus on successful recovery.
They verify Follow against current activity while reading history, one-time exact
send scrolling and stale-cycle refusal for independently inspected off-page Tasks.
The storage regressions hold a real IndexedDB write transaction while competing
tabs request admission near quota. They prove no persistence or POST before commit,
six ordinary plus two reserved controls per binding, global reserved capacity,
repeated Enter producing one key, and revalidation preserving the original handoff.
The holder observes records inside a request callback, where the transaction is
active. Additional cases abort an actual write and throw during post-commit
notification. Negative controls bypass the quota check or the synchronous duplicate
submission guard only in test-local served JavaScript; each must fail its normal
assertion. No successful API response is fabricated. The old Web Lock mutant is
historical evidence only: IndexedDB now provides atomicity.

The unshipped local-storage preview is intentionally not imported or replayed. Its
own-binding records cause a typed refusal and remain untouched. The disposable
browser contexts start with clean recovery storage; never remove uncertain records
from a real user's browser to make a fixture pass.

Final Story 20.4 verification: all 46 retained/new browser cases passed with zero
failures, skips or retries. The independent repair run passed 15 focused cases plus
an additional real abort-after-request-success proof; the web check passed 71
unit tests. Quiescent Pause/Stop metadata is retained by the final JSON reporter,
with viewport captures and exact log paths in the implementation evidence report.

Story 21.4 additionally retains an isolated historical acquisition proof in
`tests/upgrade/knowledge.spec.ts`. Build the CLI and `evidence_fixture` API test
executable from the exact Story 21.3 commit
`d38e1daed736415ef13e7606345dac71bd1d9f01` in a separate checkout/target directory,
then set `ZOBBA_TEST_SCHEMA9_CLI` and `ZOBBA_TEST_SCHEMA9_API` to those executables.
Warm the current CLI, worker and evidence harness before browser startup, as for
the ordinary suite. With the same guarded disposable database configuration, run:

```sh
pnpm --filter @zobba/web exec playwright test --config playwright.knowledge-upgrade.config.ts --workers=1 --retries=0
```

This invocation owns and resets the disposable schema. It acquires an original
through the actual schema9 public API and real object fixture, stops that API,
applies current migrations and starts the current API against the same original.
It requires the honest legacy capture omission, recovers through the current UI,
restarts again, and compares exact retries, capture identities, original receipt
and downloaded bytes. No knowledge rows are seeded or deleted to imitate a
missing capture. Run it separately from the ordinary browser suite; both own the
same fixture database and identity listener.
