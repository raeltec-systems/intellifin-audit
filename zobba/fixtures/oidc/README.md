# Synthetic local OIDC provider

This independent HTTPS fixture runs pinned `oidc-provider` 9.12.2. It serves a
real password form and authorization-code flow, requires PKCE S256, and signs
ID tokens with RS256. The Rust application uses its ordinary OIDC verifier and
server sessions. This is local synthetic infrastructure, not a production login
mode, Cognito qualification, or customer identity deployment.

From `zobba/`, using the pinned Node/pnpm toolchain:

```sh
pnpm install --frozen-lockfile
pnpm fixture:setup
. fixtures/oidc/.local/env.sh
pnpm fixture:start
```

The setup shortcut expands to `pnpm --filter @zobba/oidc-fixture run setup`.
The explicit `run` is required because `pnpm setup` configures pnpm's shell
environment instead of executing this package's fixture script. For an isolated
fixture, set `ZOBBA_FIXTURE_DIR` to a new directory path before setup and source
`"$ZOBBA_FIXTURE_DIR/env.sh"`; an existing empty directory is refused as incomplete.

In this managed development machine, first run
`. /workspace/zobba-build-tools/activate.sh`. That path is a machine convenience,
not an application dependency. Run the API and Vite in separate shells with the
same generated environment loaded, after explicitly migrating and seeding the
synthetic application database. The fixture never migrates or seeds PostgreSQL.

The issuer is `https://127.0.0.1:9443`, the app is `https://localhost:5173`, and
the sole registered callback is `https://localhost:5173/api/auth/callback`.
Different hostnames prevent the app and IdP from sharing host-only cookies;
cookies do not isolate ports. The generated local CA is passed to Rust through
`ZOBBA_OIDC_CA_FILE`; TLS verification stays enabled. For manual browsers, trust
the generated CA in an isolated test profile. Certificate-ignore is only for
the explicitly local browser harness. Do not disable TLS checks in Node or Rust.

`setup.mjs` is executable and idempotent. It uses OpenSSL to create a short-lived
local CA and separate application/provider certificate keys, with SANs for both
local hostnames. It generates random signing keys, client/admin credentials,
cookie keys and a synthetic account password. All generated material is ignored
under `.local/`, with directory mode 0700 and file mode 0600; setup never prints
credential values. Repeat setup preserves existing credentials and verifies
certificate lifetime. Incomplete or expired material refuses; stop the local
processes, remove only the fixture's `.local/` directory and run setup again to
regenerate it. No shared/system trust store is modified.

The form has an **Account** selector, a **Password** field and a **Sign in** button.
Synthetic account names are `auditor-a`, `manager-a`, `auditor-b`, `admin-only`,
and `unassigned`. The password is the generated `account_password` field in
`.local/fixture.json`; browser tests read it directly without logging it.
Application roles and assignments are independently seeded and read from the
application database; the provider conveys no audit authority.

The form requires an exact issuer `Origin` and a one-use CSRF token. Its
`Referrer-Policy: same-origin` preserves that browser proof but strips referrers
on the cross-origin callback. CSP `form-action` permits only the provider and
the fixed application origin, including the real POST redirect chain. Applying
`no-referrer` or a self-only form policy breaks Chromium's real flow even when
an HTTP-only driver succeeds.

The server requires `ZOBBA_LOCAL_FIXTURES=1` and always binds IPv4 loopback.
`ZOBBA_FIXTURE_DIR` selects an isolated generated directory.
`ZOBBA_FIXTURE_PORT` and `ZOBBA_FIXTURE_APP_PORT` override the default 9443/5173
ports for owned test processes; set the application's issuer/origin/callback
environment to the same ports. Setup's generated environment uses the default
ports. Vite reads `ZOBBA_LOCAL_TLS_KEY` and `ZOBBA_LOCAL_TLS_CERT`. The provider's
in-memory state is deliberately disposable and disappears when stopped.

## Protocol test driver

`flow.mjs` follows the actual provider authorization redirects, signed cookies,
password form and consent grant, then stops at the registered application
callback. It returns the real `code`, `state`, and full `redirect_uri` as JSON;
it neither calls the app callback nor invents a code. Prefer stdin to avoid
putting the authorization URL in process arguments:

```text
node fixtures/oidc/flow.mjs --stdin
stdin: {"authorization_url":"<server-created authorization URL>","account":"auditor-a"}
```

The driver trusts only the generated fixture CA, limits response size/hops, and
refuses off-issuer redirects except the exact local callback. Treat its output
as transient test credentials and never store it in CI artifacts or logs.

## Authenticated negative controls

All `/__admin/` routes require `Authorization: Bearer <admin_secret>` from
`.local/fixture.json`. This secret is for local fixture controls only; the
application has no fixture-admin endpoint and never accepts this credential.

| Request | Effect |
| --- | --- |
| `POST /__admin/scenario` with `{"scenario":"..."}` | Select response behavior for subsequent requests. |
| `POST /__admin/reset` | Restore normal behavior, initial JWKS and zero counters. |
| `GET /__admin/status` | Read scenario plus token, JWKS, discovery and untrusted-key request counts. |

Run protocol scenario tests sequentially against a dedicated fixture process.
Claim/signature mutations happen to ID tokens produced after the actual
provider has verified the code, client credentials and PKCE. Supported modes:

- `normal`, `bad_issuer`, `bad_audience`, `multi_audience`, `missing_azp`,
  `bad_azp`, `bad_nonce`, `no_nonce`, `bad_at_hash`.
- `bad_signature`, `bad_algorithm` (RS512), `no_signature` (`none`),
  `unknown_key`, `untrusted_jku`, `untrusted_x5u`.
- `expired`: a recently expired token (`iat` 61 seconds ago, `exp` one second
  ago, 60-second lifetime), isolating expiry from the issued-at-age check.
  `future_iat`, `old_iat`, and `bad_expiry` (two-hour token lifetime) remain
  separate cases.
- `key_rotation`: use a second signing key and publish it only after issuing
  the token, exercising an initially unknown key and trusted JWKS refresh.
- `same_kid_rotation`: sign with the second key under the original key ID, then
  publish only that replacement material. Repeated exchanges use the same
  replacement key and ID.
- `retired_key`: immediately publish only the second key, but issue otherwise
  valid tokens signed by the retired original key. `retired_key_unavailable`
  has the same signing behavior while `/jwks` returns a fixed 503 response,
  exercising failure to refresh an expired key cache.
- `oversized_token`, `oversized_jwks`, `oversized_discovery`: add a 1 MiB
  `padding` field to an otherwise valid protocol response and declare its
  Content-Length. Token responses require the real client/code/PKCE exchange.
- `oversized_chunked_token`, `oversized_chunked_jwks`,
  `oversized_chunked_discovery`: stream the same valid padded response without
  Content-Length.
- `padded_token`, `padded_jwks`, `padded_discovery` and their
  `padded_chunked_*` equivalents: valid controls below the relying party's
  byte limits, with 32 KiB token padding and 128 KiB discovery/JWKS padding.
- `slow_token`, `slow_jwks`, `slow_discovery`: delay response 6.5 seconds.
- `redirect_token`, `redirect_jwks`, `redirect_discovery`: return a redirect to
  a counted untrusted fixture endpoint, exposing clients that follow redirects.
- `untrusted_token_endpoint`, `untrusted_authorization_endpoint`,
  `untrusted_jwks_uri`, `bad_discovery_issuer`: discovery advertises an
  `https://untrusted.invalid` location that the application must refuse before
  making a request to it.

Token-supplied key URLs point to counted fixture paths; a correct relying party
does not request them. Reset between scenarios, especially key rotation. Controls
return fixed diagnostics; request bodies, passwords, authorization URLs, codes
and tokens are never logged.

Run `pnpm fixture:test` to verify repeatable secure generation, TLS trust, real
password/code/PKCE flow, invalid code reuse, required S256, claim/signature
mutations, rotation/retirement, valid padded response framing and a malformed
HTTPS request followed by successful health/discovery requests. The Rust
protocol and browser suites separately prove
that application boundaries reject the negative cases and establish sessions
only after the real login succeeds.
