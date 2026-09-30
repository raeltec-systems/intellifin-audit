# Pair shell regression

From `zobba/`, run the explicit database smoke setup first, then:

```sh
pnpm --filter @zobba/web exec playwright install --with-deps chromium
pnpm test:browser
```

The check requires `ZOBBA_TEST_RUNTIME_DATABASE_URL` pointing to a migrated,
dedicated PostgreSQL database whose name ends in `_test`. It builds the owned
Rust API and starts its own API, Vite server and PostgreSQL TCP proxy on temporary
loopback ports. It neither migrates nor changes database contents. The runtime
child receives only its proxy runtime URL; inherited Zobba migration, admin and
test database bindings are removed.

The browser loads the real Vite shell through its API proxy, sees **Ready**, loses
only its own database sockets, verifies HTTP 503 and visible **Unavailable**, then
restores the sockets and uses keyboard **Check again** to recover **Ready**. It
also checks focus, desktop and narrow layouts, asset loading and browser errors.
Removing the unavailable-label branch must fail the rendered-status assertion.

If Chromium is already installed locally, select it without downloading another:

```sh
ZOBBA_BROWSER_EXECUTABLE=/usr/bin/chromium pnpm test:browser
```

Outside CI, the nondestructive browser check may use the exact configured
loopback development runtime URL while separate database tests are running:

```sh
ZOBBA_TEST_RUNTIME_DATABASE_URL="$ZOBBA_RUNTIME_DATABASE_URL" \
  ZOBBA_BROWSER_EXECUTABLE=/usr/bin/chromium pnpm test:browser
```

This override applies only to the browser command. Do not pass it to database
tests or smoke setup. CI always uses the dedicated test database after smoke.

Screenshots and failure evidence go to the system temporary directory under
`zobba-browser-results`, or `ZOBBA_BROWSER_OUTPUT_DIR` when set. CI uploads that
directory as the `zobba-browser-regression` artifact.
