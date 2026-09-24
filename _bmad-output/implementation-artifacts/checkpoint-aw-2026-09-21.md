# PR 51 — user-requested pause checkpoint

The user requested a commit/push checkpoint because usage was nearly exhausted.
This saves unfinished work; it is not slice completion, merge approval, or deployment.

## Saved state

Main branch: `feat/auditor-workspace-v1-1`, PR 51. P2 near-live preview is integrated,
including migration 61, coordinator, broker/proxy, viewer and separate-worker tests.
Six future slice specifications are drafts only. Do not start another slice before
the agreed P2 acceptance and review are complete.

Separate unvalidated drafts are saved on `feat/pr51-frozen-strategies` (188f56b),
`feat/pr51-conversation-flags` (12d4bee), and `feat/pr51-authentication-proof`
(114691b). Their migrations 62/63 are drafts, not applied or integrated.

## Actual verification and remaining failure

- Before the latest matcher change, both separate-worker scenarios passed together
  (1.9 minutes), including real SIGKILL/restart.
- A subsequent combined run passed all ten adapter/browser cases, including the
  measured two-viewer benchmark and private/revocation/decode fences. The first
  worker scenario failed intermittent second-viewer presentation; the second was skipped.
- The matcher now accepts a newer capture in the same public runtime/privacy epoch,
  without extending the displayed sample's original age. Its three unit cases passed.
- With that change, the full saved-sign-in/two-viewer/reconnect/role-independent
  session revocation/Pause/Resume/Stop worker scenario passed (1.3 minutes).
- The next process-loss case failed **before SIGKILL**: a single preview read returned
  no image after the UI had displayed one. Investigate the transient read and establish
  a currently deliverable sample before killing the worker. Do not claim current
  process-loss acceptance or a green combined suite.
- Earlier current-schema focused PostgreSQL checks passed 22/22. A newly added
  unexpired workspace-replacement test is not yet executed.
- Full units previously had 4,946 passes and three failures; those failures were
  corrected and all 44 affected cases passed. The complete suite is not rerun.
- Full PostgreSQL verification was interrupted by a Codespace restart. No full-suite
  pass is claimed. Independent three-layer final review and new CI are pending.
- Checkpoint verification: complete package/root TypeScript checks and dependency
  boundaries (718 modules) passed; `git diff --check` passed.
- The first checkpoint CI preview job failed before its adapter cases because the
  job database name ended in `_e2e`, while the fixture safety guard accepts only
  explicit `test`/`ci` database names. The job now consistently uses
  `intellifin_preview_ci`; this correction requires a new CI run.

The baseline pushed candidate d74ff29 had five CI jobs passing and the full browser
job failing four cases. Targeted fixes are saved but their regression run is pending.
All seven global proof gates remain open. D3 is approved; D2 remains required before
real-data handling. P6 private human authentication is not delivered by this slice.

## Manual browser check

The current development server is on port **3103**, using the isolated synthetic
`intellifin_preview_v2_ci` database. For manual testing it has been restarted with
`BETTER_AUTH_URL=https://<CODESPACE_NAME>-3103.app.github.dev`; open port 3103 from
the Codespaces Ports panel. The development origin allowlist includes this exact
Codespace host. Keep the forwarded port private. Automated localhost tests require
restarting with the original `.env.pr51-preview-v2.local` origin afterward.

Synthetic account names are `auditor@example.test` and `administrator@example.test`.
Their password is in the ignored, owner-only `.playwright/pr51/manual-login.txt`.
It is deliberately absent from this commit. Open that file locally to sign in.

You can inspect the shell, Procedures list, create/edit a draft procedure, its
validation and executable-plan preview, Runs and Review navigation, and the
administrator registration/source surfaces. A fresh database can have empty lists.
These are manual smoke checks, not proof that unfinished workspace work is complete.

The automated fixture cleans up its Runs and stops its worker. Therefore a persistent
near-live demo is **not** left running: Pause/Resume/Stop, answers and Replay require
a suitable active or retained synthetic Run; near-live additionally requires its
worker-owned Page. An unavailable preview without that worker is expected.

## Resume here

A bounded client audit also identified a remaining display race: the prior frame's
expiry timer calls `clear()` while a replacement decodes, revoking both displayed
and pending object URLs. That can reject decoding and show unavailable; hiding can
similarly have its status overwritten by the catch branch. Resolve and regression-test
the displayed-frame expiry versus candidate lifetime without weakening privacy clearing.
This audit is not the required final three-layer review.

1. Read this checkpoint, `report-aw-near-live-preview.md` and the P2 spec.
2. Source `.env.pr51-preview-v2.local` (ignored). Keep schema-61 v2 databases; older
   preview databases have the earlier unpublished schema and are incompatible.
3. Finish the process-loss fixture and run both preview suites together, zero retries.
   Run the four baseline browser regressions, including empty-list cleanup.
4. Run current typechecks, boundaries, drift, focused/new PostgreSQL cases, full units
   and full integration sequentially. Avoid heavy TypeScript alongside browser tests.
5. Complete independent review, fix findings, update the report and check fresh CI.
   Only then declare P2 complete. Nothing is merged or deployed.

Latest ignored logs: `preview-v2-progress-worker.log`, `preview-v2-complete-browser.log`,
`preview-v2-progress-unit.log`, `preview-checkpoint-types.log`, under `.playwright/pr51/logs/`.
Do not commit raw browser logs, environment files, cookies or image data.
