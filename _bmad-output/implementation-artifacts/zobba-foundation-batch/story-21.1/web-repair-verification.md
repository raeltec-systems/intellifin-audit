# Story 21.1 root web repair verification

R03–R11/R16 were repaired in the owned evidence client/workspace/tests.
`auth.ts` now exports the unchanged bounded JSON body reader so the evidence
client can distinguish the allowlisted durable quota error from generic conflict
without duplicating or weakening body bounds. Ordinary authentication behavior is
unchanged. Error bodies used for this classification are capped at4096bytes.

- R03: symmetric40KiB recovery envelope covers the32KiB request plus bounded
  binding/ID. Save validates/canonicalizes before storage; recovery preserves every
  valid maximum escaped request. The browser proof loses an already-registered
  upload response, reloads, and retries the exact retained key without anotherPUT.
- R04/R05: source/filename validated before immutable draft storage or reservation;
  invalid input stays editable. Oversized files get the actual size correction.
  Initial sessionStorage refusal also keeps inputs editable and sends no request.
- R06:409 evidence_reservation_limit is distinct from409 conflict and429 transient
  transfer capacity. UI explains the100-incomplete limit and completing prior
  custody, without an ineffective retry-shortly message or a deletion claim.
- R07: registry and recovery maintain separate cursor history (at most64starts
  each), preserve the current page through routine same-session revalidation, and
  offer Previous/First. Successful registration still refreshes canonical first
  pages. The test retains the actual later-page IDs/filename across focus refresh.
- R08: accepted registration is published independently of list refresh. On list
  failure, exact authority is rechecked before restoring its receipt/provenance;
  unknown authority still hides private content. The UI distinguishes list outage
  from unknown acquisition, retains no unnecessary retry draft, and refreshes later.
- R09: explicit inspection focuses/scrolls its heading and remembers its registry
  opener. Back to evidence list restores that opener. Routine refresh does not
  request inspection focus. Real narrow/keyboard50-row navigation is asserted.
- R10: pending custody exposes read-only expected digest/size and attributed source
  fields before upload, with unverified and unknown labels. A browser case checks
  two same-name reservations with different expected identities/accounts/versions.
- R11: browser/API share120-character ASCII-safe names with bounded final-extension
  preservation and final dot trimming. Unit vectors include long, Unicode,
  supplementary-scalar, path/header and dot-only names.
- R16: the browser now asserts actual measured hash/size and verified storage
  version against the returned original, distinct from asserted source version.

## Executed checks

- `pnpm check`:100/100 Node tests, TypeScript and generated-contract agreement
  passed; `/tmp/zobba-21-1-web-repairs-check.log`.
- Focused first run: acquisition/provenance, narrow keyboard and routine same-session
  state3/3passed. Pagination then failed solely because a test compared innerText
  with textContent across sibling span/button. The assertion now compares the
  exact filename span; no application expectation was relaxed.
  `/tmp/zobba-21-1-browser-repair-root.log` retains the original failure.
- Focused repaired run: all7cases passed (six new repair cases and extended
  pagination/navigation), zero retries, in1.6min. Exact output:
  `/tmp/zobba-21-1-browser-repair-02.log`.
- Scoped/full working-tree `git diff --check` passed.

Browser commands ran from `zobba/web` after `activate-tests.sh`, with explicit
admin/migration `zobba_local_admin`, runtime `zobba_app`, database
`zobba_story_20_test` at127.0.0.1:55434, IdP9444, installed Chromium and isolated
fixture directory. Because unpublished migration6's indexes changed, root first
used the repository's complete smoke.test_urls guard plus exact name/role/endpoint
checks to reset only this disposable public schema. The harness then migrated
and seeded normally. Development and IdP9443 were not targeted. No fixture secret
files or row dumps are included.

Full combined gates and independent repaired-source rechecks remain separate
requirements, not implied by these focused passes.
