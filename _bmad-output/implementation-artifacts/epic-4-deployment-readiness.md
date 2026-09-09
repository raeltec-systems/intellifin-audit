---
title: 'Epic 4 deployment readiness'
type: 'release-readiness'
created: '2026-09-09'
status: 'draft'
candidate: 'codex/epic-4-agent-runs @ 6237c4c (PR 24)'
main: '12ec596 (schema generation 14, the deployed build)'
---

# Epic 4 deployment readiness

This is the one consolidated list of what the owner has to supply or decide before
the Epic 4 candidate is merged and released, and what is verified independently of it.
Names only: no secret value appears here, and none may be pasted into chat. Secrets go
through Railway's variable editor (sealed where offered) and GitHub Actions secrets.

## 1. What a release does, in order

Production runs main's build (`12ec596`) at schema generation 14: the web health route
reports `schema: 14`. The candidate is at generation 41, so the release migrates the
production database across 27 generations before any new image starts.

1. PR 24 merges into `main` (merge commit, history preserved, no force-push).
2. CI runs on `main`; on success `release.yml` starts (`workflow_run`, or a manual
   `workflow_dispatch`).
3. Job `migrate`: refuses when the `DATABASE_URL` secret is missing, verifies the target
   is PostgreSQL 18, then `pnpm db:migrate` applies generations 15 to 41. Nothing else
   ever migrates; every image refuses to start against a schema outside its own range
   (`41..41` for this build), so a failed migration ships nothing.
4. Job `deploy`, one service at a time: `web`, `worker`, `northstar`, each through
   `railway up --service <name> --ci` in the `production` environment. The Railway
   services carry no watch-path filters and GitHub auto-deploy is off, so this workflow
   is the only deployer.
5. A Railway `SUCCESS` must be confirmed independently of the CLI (section 5).

Migrations are expand-only and backward compatible with the previous image, so the old
web keeps serving during the minutes between the migration and its replacement.

## 2. Owner inputs, consolidated

Variable names were read from Railway (names only; values are never returned to this
session). Required-versus-optional rules come from `packages/infrastructure/src/config.ts`
and `apps/worker/src/startup.ts` at the candidate.

### Worker service (`worker`, production)

| Variable | State today | What it is for |
|---|---|---|
| `DATABASE_URL`, `NODE_ENV`, `SERVICE_NAME` | present | unchanged |
| `ANTHROPIC_API_KEY`, `OPENAI_API_KEY` | present | Agent model gateway. When both are set Anthropic is primary and OpenAI the fallback; set only the one you mean to pay for, or accept that order. |
| `AGENT_ANTHROPIC_MODEL`, `AGENT_OPENAI_MODEL` | absent | Optional model id overrides; without them the build's defaults apply. The live acceptance ran on OpenAI `gpt-5.6-luna`; set the override deliberately rather than inheriting a default. |
| `EVIDENCE_S3_ENDPOINT`, `EVIDENCE_S3_REGION`, `EVIDENCE_S3_BUCKET`, `EVIDENCE_S3_ACCESS_KEY_ID`, `EVIDENCE_S3_SECRET_ACCESS_KEY` | absent | A PRIVATE S3-compatible bucket for Evidence. All five together or none; `EVIDENCE_S3_FORCE_PATH_STYLE=true` only for path-style stores. Without them the worker starts, logs `Population execution disabled`, and ends every Run `RUN_FAILED` with a closed diagnostic: no Run can produce Evidence. |
| `CREDENTIAL_TOKENS` | absent | JSON manifest from credential reference to token. For the synthetic LoanCore it must map `cred://synthetic/loancore-readonly` to the invented token declared as `credential_token` in `fixtures/northstar/datasets/systems.json` (it authenticates nothing outside this repository). Without it adapter and agent extraction are disabled by name. Duplicate keys after trimming refuse the whole manifest. |
| `EXCEPTION_FINGERPRINT_KEY` | absent | First issuance of the HMAC key that signs Exception fingerprints. Generate a fresh random value; there is no existing key to rotate, and a key must never be rotated silently later. Without it adapter and agent execution are disabled by name. |
| `EXCEPTION_FINGERPRINT_KEY_ID` | absent | The label retained beside every fingerprint; `.railway/railway.ts` declares `k1`. Not a secret. |
| `SOLARI_API_KEY` | absent | The managed-browser key. The key pasted into chat earlier must be treated as exposed and rotated before use. Without it the worker runs a local Chromium: browser state is isolated per Run but the worker process is not, and `run_workspace.mode` records which guarantee each Run had. |
| `SOLARI_RECORDING` | absent | `false` (declared). Recording is metered and cannot be enabled for an existing session; Epic 5 decides when it turns on. |
| `SOLARI_REGION`, `SOLARI_BASE_URL` | absent | Optional provider routing; leave unset unless the provider account requires one. |
| `MODEL_PROVIDER`, `MODEL_ID`, `MODEL_API_KEY`, `MODEL_MAX_OUTPUT_TOKENS` | absent | Plan-derivation model (Epic 2). Optional; if `MODEL_PROVIDER` is set, `MODEL_ID` and (on the worker) `MODEL_API_KEY` become required. The published platform configuration, not these variables, is what new versions freeze. |
| `SCHEMA_RANGE_MIN`, `SCHEMA_RANGE_MAX` | present, stale | Unused since the supported range became a build constant. Remove to avoid a reader trusting them. |

### Web service (`web`, production)

| Variable | State today | Note |
|---|---|---|
| `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`, `DATABASE_URL`, `NODE_ENV`, `PORT`, `SERVICE_NAME` | present | unchanged |
| `CREDENTIAL_CAPABILITIES` | present, value unread | Must declare `cred://synthetic/loancore-readonly` as `read-only` (and any other reference to be registered), or the registration is refused with `Audit credentials must be read-only.` Verify the value in the Railway editor. |
| `CREDENTIAL_TOKENS`, `EXCEPTION_FINGERPRINT_KEY`, `SOLARI_API_KEY` | absent, keep absent | A production web container refuses to start when any of the three is set: they are the worker's alone. |
| `SCHEMA_RANGE_MIN`, `SCHEMA_RANGE_MAX` | present, stale | Remove, as on the worker. |

### GitHub Actions secrets

`DATABASE_URL` for the `migrate` job (in place since the Epic 2 release), and, for the
selected live acceptance workflow only, the Solari key and the provider keys. The live
workflow is read-only and runs only on an explicit label or dispatch with an exact SHA.

### Configuration performed through the application after the release

- Seed the synthetic systems into the production database once, through the audited
  commands: `scripts/seed-northstar.mts` against the hosted Northstar
  (`https://northstar-production-b312.up.railway.app`, which answers `/health` today).
  Re-running leaves existing rows alone and reports, never repoints, a differing origin.
- Give the LoanCore registration the `Disabled time` label pattern (Story 4.12) through
  the administration surface. That is a digest change, so it mints platform-authored
  Drafts for every Active Procedure that references LoanCore, exactly as Story 2.8 ripples.
- Author the C2 role-privilege policy and, where wanted, the 24-hour window mapping on a
  P-1 version through the Builder, submit and approve it. Nothing is written into an
  existing frozen version.
- Publish a platform model configuration for plan derivation only if model-assisted
  derivation is wanted: `node scripts/apply-platform-configuration.mts <configuration.json>`.

## 3. Verification status

| Check | Status | Where |
|---|---|---|
| Standard CI on the exact candidate | running on `6237c4c`; the two mutation gates were red on `db3c6d3` and `ad238db` for a stale anchor, repaired in `6237c4c` | PR 24 checks |
| Fresh install to 41 and upgrade 32 → 41 with schema parity | passed | `epic-4-independent-verification.md` |
| Populated upgrade 14 → 41 (production's generation) | in progress: a generation-14 database populated through main's own commands, upgraded by the candidate's migrator, then parity and a behaviour subset | `epic-4-engineering-continuation.md` (result recorded when done) |
| Evidence preservation across the sealed-Run backfill (31 → 32) and the absence guard (40 → 41) | passed in CI on every candidate | `tests/integration/sealed-evidence-upgrade.test.ts`, `absence-guard-upgrade.test.ts` |
| Worker restart, redelivery and lease recovery | passed in CI integration | `tests/integration/*` recovery cases |
| Live representative audit under the C2 policy, the undefined-privilege negative case, and remote isolation | to run on the candidate after standard CI is green | `solari-acceptance.yml` |
| Story 4.12 journey on the compiled worker | passed locally; hosted result on the candidate pending | `tests/e2e/disablement-window-journey.spec.ts` |

## 4. Merge plan (owner decision 3, option B)

- PR 23's head `665c5a3` is an ancestor of the candidate with zero commits missing, so
  merging PR 24 delivers everything PR 23 carried plus the Epic 4 repairs. Merge PR 24
  alone; then close PR 23 as superseded with a comment naming the containing commit.
- Merge with a merge commit. No rebase, squash or force-push, and no temporary
  transport workflow: none remains on the branch.
- `main` is reported unprotected by GitHub. Enabling a required-status-check rule on
  `main` before the merge is recommended and is the owner's setting to change.
- Merge only when: CI is green on the exact head, the live results are recorded on
  PR 24, the populated-upgrade proof is recorded, and the worker inputs above are in
  place or their absence is accepted for a first rollout (every Run then fails closed
  until they are set; nothing is lost, nothing is fabricated).

## 5. After the merge

1. Watch the release run: the `migrate` job must log the applied generations and end
   at 41; each deploy job must end `SUCCESS`.
2. Confirm on Railway, independently of the CLI, that each of `web`, `worker` and
   `northstar` has a `SUCCESS` deployment of the merge commit.
3. `GET /api/health` on the web domain must report `schema: 41`.
4. Worker logs must show `Startup checks passed`, the heartbeat, and the three
   capability lines (`Population execution`, credential manifest, workspace mode) saying
   what was configured, in words.
5. Run one representative P-1 audit against the hosted Northstar from the application,
   inspect Run Detail (Result, Evidence with the grounding inspector, Exceptions,
   Timeline), and confirm the Agent-Judged review path with an authorized identity.
