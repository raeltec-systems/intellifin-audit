# Manager control transfer: implementation review

Status: implementation ready for independent review; focused PostgreSQL verification
has passing evidence. Browser and worker verification are pending. Baseline: `a45345593e883e825c8c4437fee2d7e266ee6eed`.

An administrator can explicitly grant or revoke Run control-transfer permission for an
Audit Manager. Managers receive no grant automatically. Demoting or removing a manager's
role revokes the grant in the same transaction, and later promotion does not restore it.
Revision checks prevent a stale administration page from overwriting a newer decision.

An eligible manager can review the current controller, enter a governed reason and confirm
taking control. The review freezes the observed controller epoch. Confirmation changes only
the controller lease, advances its epoch once, records an immutable receipt and updates
viewers through the existing timeline. It does not resume the Run, answer an open question
or remove accepted Pause/Stop requests. The deferred inspection Pause remains a safety latch.

The reason is stored separately as encrypted governed content. Audit history carries a
reference and identities, never the reason text. Removed or unreadable reason content blocks
first confirmation; it does not erase proof of an already committed transfer. Lost-response
recovery retains the exact request or confirmation identity. Reloading a proposal does not
silently confirm it, and an old receipt does not establish current ownership.

Migration 0060 adds explicit grants, governed transfer reviews and their receipts. Storage
guards bind the exceptional live-controller change to its exact proposal and event, preserve
the existing renewal rules, and reject grant identity rewrites or demotion with a live grant.
Run and stable identity locks serialize transfer against role/grant revocation.

## Verification

- Passed: 247 focused backend unit tests across role policy, administration, transfer,
  conversation narration, strict audit envelopes and the administrator override guard.
- Passed: 75 focused web unit tests and the web typecheck reported by the UI implementer.
- Passed: domain/application/infrastructure typechecks before final test additions.
- Pending parent execution: grant/lease/transfer PostgreSQL tests, real SQL forgery and
  revocation races, authenticated two-viewer browser journey, and the existing real Chromium
  worker journey with manager transfer during intermediate/final deferred-Pause inspections.
- Pending: independent review and final complete type/boundary/unit checks. A root test
  compiler attempt ended with SIGTERM without diagnostics and is not counted as passing.

No merge, deployment or real-data admission is included. D3 authority was already approved;
no further routine permission is required to finish verification and review fixes.


## Parent verification before review

Migration 0060 and isolated package build passed in a fresh PostgreSQL 18 database.
All 55 focused database cases have passing evidence: 13 lease cases (including actual
120-second expiry), 18 administration, five deferred-Pause and 19 transfer cases.
The initial combined run passed 54/55; a negative event test compared Drizzle's outer
query error instead of its PostgreSQL cause. After preserving the exact SQLSTATE/message
assertion on that cause, all 19 transfer cases passed. The original invocation was not green.
The suite proves grant and administrator revocation races, two competing managers,
Pause/Stop/question preservation, exact recovery, compound renewal/release and rollback.

The four actual Chromium worker deferred-Pause cases passed, including intermediate and
final inspections with an actual granted manager transfer during execution. The accepted
latch remained unchanged and the real worker settled it at its named boundary.


## Independent review corrections in progress

All three independent review layers completed. Accepted patches retain removed-content
tombstones and permit only removal updates; bind browser recovery to its authenticated
account; separate historical receipt lookup from first confirmation; retain a dismissible
recovery affordance after terminal state; report stale rationale context and reset repeated
validation refusals; clear settled timeout copy; keep long reasons and focus reachable;
expose operational unavailability before review; return actual administrative grant state;
and preserve indexed UUID fact lookup. Additional browser proof must distinguish historical
receipts from current ownership and assert observer-visible transfer narration.

The first two-viewer browser invocation timed out at 180 seconds during cold route
compilation (workspace compilation alone took 86 seconds). All three authentication setup
cases passed. Its cleanup error masked the interrupted assertion; cleanup will preserve
that original failure on the revised run. No transfer browser pass is claimed yet.
