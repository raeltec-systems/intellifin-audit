# Epic 4 live Solari acceptance gate

This is an executable gate, not a live acceptance result. Run only on the exact clean
candidate in the dedicated hosted CI job. The test starts `apps/worker/dist/main.js`:
its production configuration selects the real Solari browser adapter and real model SDK.
No model interception, action script, remote target deployment, tunnel, or recording is used.

The existing approved synthetic target is
`https://northstar-production-b312.up.railway.app`. The worker acquires a separately
declared, worker-local HTTP source containing exactly canonical employee `E-000102`,
applies the frozen P-1 inclusion rule, signs into the remote LoanCore target using the
catalog's synthetic **audit** credential, and lets the model select approved browser actions.
The Python fixture generator reads the original row unchanged, independently computes
its one-row count/digest and publishes its signed cover sheet. Original generation time
is retained. This is an approved synthetic case projection, not acceptance of a deployed
HR integration. The full golden export deliberately includes missing dates and duplicate
keys: an employee inclusion filter cannot erase those source-level Gate failures, so it
cannot validly demonstrate this case's pending-confirmation outcome. The full source and
its protections are unchanged. The expected disabled account produces deterministic C1 Compliant and
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
alone is remote; population acquisition and evidence upload happen in the worker, so Solari needs no access to local
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
Secret scanning includes the synthetic application's derived session-cookie token and uses boolean assertions so a failure cannot print the secret operand. PNG byte scanning is not visual/OCR verification; credential-entry capture suppression is proved by its separate browser regressions. Forced or unconfirmed worker shutdown fails the live gate even when remote cleanup was already confirmed.

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

## Paired remote isolation gate

The dedicated configuration also selects `solari-workspace-isolation.spec.ts`. This
second case makes no model requests. It creates two separate frozen procedure/Run
records through the same application writers and `initiateRun`, provisions through
`provisionWorkspace` using the actual worker's `agentWorkspace(loadConfig(...))`
composition, acquires the actual published HR source through the HTTP/S3 adapters,
and authenticates through `executeAgentSteps`. There are exactly two explicit
provisioning attempts, one per Run; provider capacity refusal fails the gate.

Both managed sessions remain alive together. While A is authenticated, B must still
show the genuine login form and no inherited cookies. Synthetic non-secret local,
session and Cache Storage sentinels prove state isolation. They are browser test
state, not audited business records or fabricated authentication. Northstar issues
one deterministic synthetic cookie value, so comparing the two authenticated cookie
values for inequality would be an invalid test. B's clean state **before** its own
real login supplies that proof.

An operation in A stays pending while B completes a captured authenticated read.
Cross-Run attachment, execution and release references must be refused. Deliberate
requests below the application action gate exercise the production remote browser
interceptor against the sibling ProdConsole path and a non-routable synthetic
web-application origin. The production release stage must persist those denial
samples as security events. No private service is exposed or contacted.

The cancellation command and the next production workspace stage perform each
terminal transition. `releaseWorkspace` confirms cleanup before provider expiry.
A's page/context must then be closed and unable to reveal cookies, while B can still
read its own session/state; B must subsequently close too. The attached
`solari-workspace-isolation.json` retains both Run/provider IDs, overlap, denials and
cleanup results. The workflow allows thirty minutes for the two bounded cases plus
build/migration and uploads both JSON artifacts. It stops after the first failed case so an unconfirmed audit cleanup cannot be followed by two additional remote allocations.

This proves two managed remote browser sessions and their adapter boundary. It does
not prove shared worker-memory isolation, independently configured provider firewall
rules, or connectivity to a deployed private web service. The existing real local
web-boundary tests and dependency-boundary gate remain separate evidence.

| Planted breach / guard | Paired remote assertion | Mutation evidence boundary |
| --- | --- | --- |
| Reuse a workspace/browser context | B starts without A's authentication/local/session/cache state | Existing local context-reuse mutation; remote repetition not executed |
| Remove Run binding from attachment/action | Forged A workspace ID under B is refused | Existing local cross-Run guard mutation; remote repetition not executed |
| Remove complete identity check from release | Forged release cannot close A or contact its provider session | Mocked SDK regression failed before repair; remote repetition not executed |
| Remove request-scope interception | Below-gate sibling/web-origin requests fail and become durable security events | Existing local egress mutation; remote repetition not executed |
| Remove terminal browser/session cleanup | A is closed and cannot reveal cookies while B remains usable; both provider releases acknowledged | Existing local terminal-closure mutation; remote repetition not executed |

These mappings are not claims of live mutation execution. The paired test and its
remote mutations remain unverified until their exact candidate is executed with
provider access. A supplied key does not by itself establish this gate: the hosted
runner must receive the encrypted secret, the first case's model secret/model ID,
and a Solari plan with two available concurrent sessions. A refused entitlement or
unavailable credential transport is a precise blocker, never authority to substitute
local Chromium or change the plan.

## Explicit canonical LoanCore rule configuration

The representative procedure freezes C1 authored through the existing compiler:
`found = false or account_status in [Disabled] else [Active]`.
C2 and its confirmation threshold remain the P1 definitions. The JSON report retains
this exact authored C1. This is an explicitly configured target-specific procedure,
not a claim that the untouched lowercase default recognizes capitalized statuses.

Material conflict: the default C1 names `disabled`/`active`, while canonical LoanCore
renders `Disabled`/`Active`. Shared §B/corroboration rules do not authorize case-folding.
Tests retain the default mismatch as `rule does not name value Disabled`; no answer
may map it into a known value. The owner can use the explicit expression above when
configuring this target. Original and normalized captured strings remain identical.
LoanCore renders Roles as plain text, so `LOAN_VIEWER` is retained as text; the
independent real-list capture tests still require exact JSON list preservation.
