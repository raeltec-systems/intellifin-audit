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
