# Epic 4 live Solari acceptance gate

This is an executable gate, not a live acceptance result. Run only on the exact clean
candidate in the dedicated hosted CI job. The test starts `apps/worker/dist/main.js`:
its production configuration selects the real Solari browser adapter and real model SDK.
No model interception, action script, remote target deployment, tunnel, or recording is used.

The existing approved synthetic target is
`https://northstar-production-b312.up.railway.app`. The worker acquires its published
HR export, applies the frozen P-1 inclusion rule plus employee `E-000102`, signs in
using the catalog's synthetic **audit** credential, and lets the model select approved
browser actions. The expected disabled account produces deterministic C1 Compliant and
an evidence-grounded C2 proposal awaiting human confirmation. The harness never supplies
an Observation, marks missing evidence Pass, or impersonates a reviewer to seal C2.

Required job configuration:

| Name | Required value/source |
| --- | --- |
| `INTELLIFIN_LIVE_SOLARI` | `1`; dedicated live job only |
| `SOLARI_API_KEY` | GitHub Actions encrypted secret; never a workflow input or command argument |
| `SOLARI_RECORDING` | `false` |
| `SOLARI_REGION` | Optional approved region, default SDK `us-west` |
| `ANTHROPIC_API_KEY` **or** `OPENAI_API_KEY` | Exactly one real provider secret |
| `AGENT_ANTHROPIC_MODEL` **or** `AGENT_OPENAI_MODEL` | Exact corresponding approved live model ID |
| `SOLARI_ACCEPTANCE_CANDIDATE_SHA` | Exact 40-character checked-out commit SHA |
| `DATABASE_URL` | Disposable PostgreSQL 18 on local/CI host, database name containing `test`, `ci`, or `e2e` |

Build the repository, run its actual release migrator against that empty PostgreSQL
service, and invoke the dedicated live Playwright project with this spec. No web UI
or seeded login is required: the harness creates a self-consistent frozen procedure
fixture through the procedure writer and initiates the Run through the real role-checked
application command and pg-boss dispatch. The normal browser suite must exclude this
file; an absent key in the explicitly selected live job fails rather than skips.

S3 is a disposable worker-local HTTP fixture, accessed through the production AWS
adapter. It is not represented as deployed durable storage acceptance. The browser
alone is remote; evidence is uploaded by the worker, so Solari needs no access to local
services. Database, storage and fingerprint values are synthetic and isolated.

The audit is bounded to one employee, 1,024 output tokens per model call, at most twelve
observed model turns and a seven-minute execution deadline. The harness cancels through
the existing application command if its bound is exceeded. It then allows ninety seconds
for the worker's existing cleanup. The compiled procedure's immutable limits are retained;
the harness's smaller time/call budget is a test cancellation policy.

The attached `solari-audit-acceptance.json` records candidate, procedure/version/Run IDs,
registration/source/plan digests, model identities, evidence digests, truthful Result and
provider workspace ID/expiry/release. A release counts only when the persisted provider
mode is Solari, release completed before expiry and there is no expiry diagnosis. The
worker's actual adapter uses `releaseAndWait`; provider unavailability must leave cleanup
unconfirmed. Raw logs, cookies, credentials, model bodies and replay URLs are not uploaded.
Secret scanning uses boolean assertions so a failure cannot print the secret operand.

Keep the disposable database until job completion; no protected evidence is deleted to
make cleanup assertions pass. If cleanup is unconfirmed, retain the workspace ID in the
report and reconcile it with the provider. Do not call an expired session a confirmed
release. A failed or missing live artifact blocks merge; local browser success cannot
substitute for this gate.

An alternative existing Railway HTTPS origin is permitted only when
`SOLARI_ACCEPTANCE_TARGET` and `SOLARI_ACCEPTANCE_APPROVED_TARGET` explicitly agree.
Neither setting authorizes a new deployment or tunnel. Gateway URL and Node preload
overrides are refused so a live result cannot silently become a fixture result.

## Selecting the hosted gate

Set repository Actions secrets `SOLARI_API_KEY` and one real model key. Set the corresponding
repository Actions variable `AGENT_ANTHROPIC_MODEL` or `AGENT_OPENAI_MODEL` to its exact approved
model ID. Anthropic is the default; select OpenAI with variable
`SOLARI_ACCEPTANCE_MODEL_PROVIDER=openai`. These are CI settings, not Railway deployment
changes. The connected GitHub tools in this session cannot create encrypted Actions secrets.

On the same-repository candidate PR, add label `solari-live-acceptance` after the candidate
and settings are ready. The label event runs the exact PR head once; later pushes do not
reuse its acceptance or automatically consume provider capacity. Remove and re-add the label
only when another explicitly selected candidate needs verification. The workflow also exposes
manual dispatch for an exact candidate SHA once available in the default-branch Actions UI.

The command is `pnpm exec playwright test --config=playwright.solari.config.ts`. Normal
`pnpm test:e2e` excludes this file. The live configuration starts no web server, local
Northstar, authentication setup or recording. The only uploaded file is the secret-scanned
JSON attachment. Missing configuration is a failed selected gate; it is never a passed skip.
