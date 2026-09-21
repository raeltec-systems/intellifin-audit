# Northstar authentication proof — bounded P6 prerequisite

Status: implemented in isolation; ready for parent integration review. This endpoint does
not complete private authentication.

Baseline: `00de6c32b0c5d3be00599f9ceb2d03855ba691a8`.
Branch: `feat/pr51-authentication-proof`.

## Contract

`GET /loancore/authentication-proof` returns HTTP 200 only after Northstar's existing
credential-derived session cookie validates. The exact JSON body has five fields:

```json
{
  "schemaVersion": 1,
  "system": "northstar-loancore",
  "account": "audit.readonly",
  "rights": "read-only",
  "policy": "northstar-read-only-v1"
}
```

The account is the sole identity authenticated by the existing synthetic credential.
The policy version belongs to Northstar's global fail-closed method enforcement; the
proof does not infer rights from a page label or caller-supplied account/rights values.
Responses are JSON and `no-store`, contain no credential/session value, set no cookie,
and never redirect. No telemetry or credential persistence is introduced.

Authenticated HEAD retains the existing Northstar read convention. Missing, invalid,
obsolete-credential-derived, wrong-name, and bearer-only sessions receive 401. All
other methods receive the global 405 before authentication, with `Allow: GET, HEAD`.
Undeclared path variants receive no proof. The existing sign-in POST remains the only
explicitly non-mutating POST; target account mutation stays refused.

## Implementation and acceptance map

| File | Responsibility and acceptance evidence |
| --- | --- |
| `apps/northstar/src/authentication.ts` | Names the single authenticated synthetic account; preserves existing session validation. |
| `apps/northstar/src/read-only.ts` | Owns the version of the enforced global read-only policy. |
| `apps/northstar/src/loancore.ts` | Returns only the closed proof after session validation; independently refuses unauthenticated direct handler calls. |
| `apps/northstar/src/routes.ts` | Anchored protected route with explicit GET/HEAD declaration through real middleware. |
| `apps/northstar/src/authentication-proof.test.ts` | Actual sign-in and request pipeline, closed response, no secret reflection, invalid authorities, caller-supplied rights refusal, method/path refusal, unchanged account response and fixture data after attempted mutations. |

Verification uses the production `handleRequest` routing/session/policy pipeline without
mocks or a listening service. The focused command is:

```sh
pnpm exec vitest run apps/northstar/src/authentication-proof.test.ts apps/northstar/src/authentication.test.ts apps/northstar/src/read-only.test.ts apps/northstar/src/routes.test.ts apps/northstar/src/server.test.ts
pnpm --filter @intellifin/northstar typecheck
```

Result: 398 tests passed in five files (16 dedicated proof cases); Northstar typecheck
passed. No DB, browser, external provider, or full workspace verification was run in
this bounded slice. Parent owns integration and wider verification.

## Remaining P6 work and explicit limitation

Northstar currently has no temporal session expiry. The obsolete-credential-derived
token test proves rejection of a token for a different credential, not time-based expiry.
This change deliberately preserves the synthetic fixture's session contract.

The later private-authentication implementation must independently prove application
session expiry, the short human input lease, runtime loss, and fresh identity/rights
revalidation before handback. It must validate this closed response at the frozen target
origin/path without following redirects, while keeping private inputs out of persistence
and observation. Worker waits, private input transport, coordinator exclusion, ownership,
Pause/Stop handling, and handback are not implemented by this prerequisite. Real-data
admission remains governed by D2; no external-provider authority is granted here.
