# Story 3.2 — Population acquisition

**Implemented and locally verified. Work pauses after this story; Story 3.3 has not started.**

[Visual HTML report](story-3-2-handover.html) · [PR #23 and live CI checks](https://github.com/raeltec-systems/intellifin-audit/pull/23)

## What changed for you

Starting a Run for a supported, approved adapter-only Procedure now starts the population worker. It reads the source frozen at approval, preserves the downloaded bytes, checks the independent declaration, and records which rows belong in the requested Run period.

The Run page shows acquired, included, excluded and indeterminate counts, individual check results, Evidence identity and digest, and paginated reasons. A truncated extraction or an unknown required value produces an explicit Inconclusive outcome. A complete population remains **Running, with Target checks pending**; this stage does not invent a final audit conclusion.

Worker restarts preserve the same Evidence identity and original bytes. Expired attempts cannot overwrite a newer attempt's result. Repeated storage failures have a durable retry limit, and changed registered Evidence is refused without overwriting it.

## What passed

| Verification | Actual result |
| --- | --- |
| Full unit suite | **2,099 tests passed**, 89 files |
| Full PostgreSQL 18 suite | **252 tests passed**, 16 files; 23 population cases |
| Population browser suite | **Five journeys passed**, plus three setup checks |
| Accessibility | Zero violations in the population journeys with axe scans |
| Types and dependencies | All packages and root tests passed; 336 modules checked |
| Database and fixtures | Schema generation 18; no drift; generated fixtures reproduced byte-for-byte |
| Builds | Packages, worker, Northstar and production web build passed |
| Review | Four initial independent review perspectives, followed by focused repair reviews; no deferred findings |

Browser verification used the actual worker process, Northstar HTTP sources, PostgreSQL and the real AWS S3 client against isolated HTTP storage. One journey killed the worker after its envelope upload, expired only that dead worker's lease, and restarted it. The test confirmed unchanged bytes, unchanged Evidence identity and the persisted second attempt. Database tests separately proved no source refetch during recovery, stale success/failure rejection, rollback, tamper detection, durable verification retries and 82 reasons across pages. The maximum 16 MiB snapshot was also exercised.

Earlier approval/editor journeys passed across a full and focused rerun. Their notification assertion now matches the Procedure being tested. Earlier interrupted or failed attempts are retained in the [technical verification record](spec-3-2-acquire-the-population-source-deterministically.md), not counted as successful full runs. Remote CI results are available on the PR; local checks do not substitute for container or production verification.

## Decisions and limits

- Use the approved source and the Run's requested dates without rewriting the frozen plan.
- Preserve exact strings, duplicate rows and decimal values. Invalid inclusion values remain indeterminate and cannot silently become exclusions or a Pass.
- Check the independent declaration and the API response metadata. Refuse unknown pagination shapes. Northstar's published cover signature detects fixture inconsistency; it is not production authentication.
- Keep acquired bounded bytes even if media or declarations are malformed. Fetch-decoded bytes are distinct from compressed wire bytes. Primary data is limited to 16 MiB and declaration HTTP bodies to 1 MiB.
- Record expected digests before upload and verify stored bytes before registration. A redelivered ready job rechecks Evidence; this is not continuous tamper monitoring.

These decisions and reusable gotchas are recorded in `CLAUDE.md`.

## What needs you

Review this report and the draft PR, then tell me when to continue. **No new product decision is needed for Story 3.2.**

No production deployment or merge was performed. Before a later release, the worker needs a private S3-compatible bucket and its endpoint, region, bucket name and credentials configured. Local tests do not prove production bucket policy or connectivity.

Authenticated source access, Target extraction, Observations, complete Evidence/Result sealing, cancellation and the full Run dashboard remain Stories 3.3–3.11. The epic is not complete.
