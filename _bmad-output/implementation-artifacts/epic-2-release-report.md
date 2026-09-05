# Epic 2 production release — 5 September 2026

**PR #21 is merged into main and deployed successfully.** The deployed merge commit is `12ec596dc3d23907a80a7d395c343a54c4375d5a`. This record supersedes the pending merge/deployment status in the earlier Epic 2 delivery report.

## Verified outcome

| Check | Result |
| --- | --- |
| [PR #21](https://github.com/raeltec-systems/intellifin-audit/pull/21) | Merged after CI passed on final head `a20cf3f` |
| [PR CI run 58](https://github.com/raeltec-systems/intellifin-audit/actions/runs/33963504786) | Passed all four jobs |
| [Main CI](https://github.com/raeltec-systems/intellifin-audit/actions/runs/33963806792) | Passed on merge commit `12ec596` |
| [Production release](https://github.com/raeltec-systems/intellifin-audit/actions/runs/33964058604) | Successful after recovery, attempt 2 |
| Database | Production migration from schema 7 to 14 passed through release.yml |
| Web | Railway SUCCESS; `/api/health` returned `{"status":"ok","schema":14}`; sign-in page returned HTTP 200 |
| Worker | Railway SUCCESS; startup logs confirm PostgreSQL 18 and schema 14; heartbeat loop started |
| Northstar | Railway SUCCESS; `/health` returned `{"status":"ok","service":"northstar"}` |

Live app: [IntelliFin Audit](https://web-production-edded.up.railway.app).

Final Railway deployment IDs:

- Web: `235fe3ff-6efe-40a4-a172-a7ee2c92ecf9`
- Worker: `675ab7d2-b0b1-47ae-9810-8945f463c730`
- Northstar: `51f66db5-2008-4802-a280-3132f034a010`

## Problems found and resolved

1. **CI fixture:** The version-decision test leaked stored capture provenance into the exact-key form input. Commit `a20cf3f` uses the same authored-input projection as the real editor. All 214 integration tests passed locally and the full CI passed before merge. No application validation was relaxed.
2. **Early worker deployment:** A worker deployment for the merge commit started before the release migration and correctly refused schema 7. Its trigger was not established; Railway's read-only inspection showed GitHub auto-deploy disabled. After migration, an explicit redeploy restored the worker on schema 14. The startup guard stayed intact.
3. **Skipped release build:** The release worker upload was marked SKIPPED with the build message "no changes detected in watch paths, build will skip." CLI 5.47.2 kept waiting. The production web and worker watch-path filters were cleared so release-managed uploads are not suppressed. The waiting release attempt was cancelled and only its unfinished jobs rerun; successful migration and web jobs were retained. The restarted worker job and Northstar job both passed.

No secrets or provider settings were changed. The watch-path change is recorded in `CLAUDE.md` and was applied only to this project's production web and worker services. The final worker deploy through release.yml succeeded with that configuration.

## What needs the owner

Nothing is needed to complete this deployment. Live provider/model-quality acceptance remains separate from these startup and health checks. Older Drafts without capture provenance may still need the one-time evidence correction described in the [capture fix report](epic-2-capture-fix-report.md).

This record verifies release completion and service health, not a new production-data audit run. No synthetic authoring or audit data was written to production during the health checks.
