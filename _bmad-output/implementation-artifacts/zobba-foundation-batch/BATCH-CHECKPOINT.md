# Zobba foundation batch: Stories 20.1–20.4

**Accepted: Stories 20.1–20.4.** Built in dependency order through the installed
BMAD workflow, independently reviewed, and demonstrated in the actual browser.
This checkpoint closes the four-story batch; Epic 20 remains in progress.

The latest repaired foundation is recorded in the
[owner-review checkpoint](OWNER-REPAIR-CHECKPOINT.md), including the accepted
bootstrap fixes, account-switch repair, setup correction and current combined
verification. The original batch results below remain historical evidence.

The new `zobba/` application now has its own Rust API/control and worker processes,
fresh PostgreSQL schema, scoped server sessions, durable Task commands and a
working engagement conversation. Legacy Node code remains reference material;
it is not a runtime dependency of the new application.

## What the running browser demonstrates

[Open the actual browser demonstration](demo/README.md), including desktop and
320/390px captures. An assigned synthetic auditor signs in, opens an engagement,
coordinates two Tasks in one conversation, and guides Task A while inspecting
Task B. The original objective and accepted plain working brief remain distinct.
The executable integration journeys additionally exercise API/worker interruption,
lost committed acknowledgements, original-key recovery, changed-meaning refusal,
and pending versus factually observed Pause/Stop. Resume preserves a cycle;
Continue creates another. Consumed activity with an unknown outcome is not replayed.

These are functioning identity, durability and interface boundaries. The executor
is deliberately bounded and inert. No model reasoning, real desktop, external
operation, audit conclusion or completed work product is claimed. Standing
Permissions are the next dependency, not a delivered capability of this batch.

## Checkpoints and evidence

| Story | Accepted commit | Review and implementation evidence |
|---|---|---|
|20.1 Reproducible independent workspace|`9c272c960342313055f053b917841a3cbc3c90f6`|[Review](REVIEW-20.1.md), [implementation](STORY-20.1-IMPLEMENTATION.md)|
|20.2 Scoped sign-in|`f6cf6bade4ceff910184b03f4e50601db39cd24a`|[Review](REVIEW-20.2.md), [implementation](STORY-20.2-IMPLEMENTATION.md)|
|20.3 Durable commands/recovery|`1c598ca55511c6e27d6cc3a2e2b836912c2a9adf`|[Review](REVIEW-20.3.md), [implementation](../story-20-3-implementation-evidence.md)|
|20.4 Attributed engagement conversation|`ac47de0204219aafdf85b364be71ec83cd3f8321`|[Specification](../spec-20-4-engagement-conversation.md), [implementation](../story-20-4-implementation-evidence.md), [review](REVIEW-20.4.md)|

All checkpoints belong to `codex/zobba-foundation-batch`; none is pushed to main.
The standard [sprint queue](../sprint-status.yaml) remains the sole status source.
Epic 20 stays in progress until its remaining stories finish. The local executed
checks are not evidence of a hosted CI run or production deployment.

## Final verification and limits

| Executed gate | Result |
|---|---|
| Rust workspace with restricted PostgreSQL | 81 passed; one helper discovery entry is explicitly exercised by its passing reliability parent |
| Web contracts, TypeScript and unit tests | 71 passed; production build passed |
| HTTPS OIDC fixture | 46 passed |
| Python guards and inward dependency boundaries | 47 passed; boundaries passed |
| Full actual browser suite | 46 passed in 3.6 minutes; zero failed, skipped, flaky or retried cases |
| Independent final review | 71 client tests, 15 browser cases and one additional real transaction-abort proof passed; no remaining material findings |
| Formatting, locked Clippy/build and process smoke | Passed |

All eight story matrix rows have executed evidence in the
[implementation report](../story-20-4-implementation-evidence.md).
[Independent review](REVIEW-20.4.md) records findings, repairs and negative
controls. The [84-file source manifest](SOURCE-MANIFEST-20.4.json) preserves the
reviewed bytes' identities; root verified every file before acceptance.

The browser demonstration uses synthetic identity and data on local services; it
is not a hosted production deployment. The executor is inert, the work-product
shelf is empty, and a consumed activity interrupted before its outcome is known
can require reconciliation. Model execution, evidence/audit mechanisms, standing
Permissions and a real managed computer are later dependencies. Browser recovery
is bounded and transactional; unshipped preview records from the rejected
localStorage implementation are preserved and fail closed, without silent replay
or migration. These limits are visible or documented; no broader capability is
claimed.

## Next dependency-ready batch

Start **20.5 — standing Permissions for exact recorded operations**. Its 20.3
prerequisite is complete. Bind current purpose/account/resource/action authority
to operation identity, attempts, one-use claims and observed outcomes. Prove
Stop/revocation races and a lost external acknowledgement against an owned fault
endpoint; do not promise remote exactly-once execution.

After 20.5 passes, proceed with **20.6 membership administration**, **21.1 immutable
scoped evidence**, and **23.1 early real-computer/sign-in qualification**. Those
branches can progress independently. Keep 23.1 early; full 20.7 deployment is not its
prerequisite. 20.7 qualification infrastructure also becomes dependency-ready and
can share approved infrastructure without duplicating spend.

The firm-method chain remains 20.6→21.2 methodology→21.3 skills. Working knowledge
21.4 requires 20.4+21.1+21.2. Those dependencies remain ahead of complete agent/audit
Task acceptance; they are not deferred product polish. No next-batch story has
been implemented or marked done as part of this four-story authorization.

## Specific cloud decision before paid qualification

Recommend the [bounded qualification proposal](QUALIFICATION-PROPOSAL.md): an
isolated owner-designated nonproduction AWS account, **us-east-1**, two zones,
**seven days maximum**, with one Ubuntu 24.04 **m6i.large** desktop capped at
**24 running hours**. Qualify Chromium/VNC/guacd through the Rust gateway and
Guacamole with two authorized viewers and an owned synthetic Cognito
password/TOTP sign-in profile. This does not qualify arbitrary SSO, passkeys or
customer applications.

Service estimate **$214.13**; requested total spend ceiling **$300**, including
teardown, capped retention and taxes. Model/transcription spend is zero. The
proposal itemizes infrastructure, reserves remaining resource-hours, starts
shutdown at $225 accrued-plus-committed estimates and requires verified expiry and
residual-resource checks. Billing alerts are not a guaranteed hard cap.

**Not approved; no paid resources provisioned.** Before apply, the owner must
approve this environment/region/ceiling and identify the account, operator and UTC
start/end. Local 20.5 work does not require that cloud decision.
