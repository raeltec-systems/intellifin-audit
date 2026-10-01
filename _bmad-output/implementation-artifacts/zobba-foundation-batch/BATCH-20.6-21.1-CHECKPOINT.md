# Zobba checkpoint: membership administration and immutable evidence

**Original checkpoint, 1 October 2026 (Africa/Lusaka). Owner acceptance and subsequent repairs are recorded below.**

**Owner-review follow-up:** Story 20.6 and Story 21.1's Unicode compatibility
repair at `9a76c5c` are now accepted; see the [repair checkpoint](STORY-21.1-UNICODE-REPAIR.md) and [specification](../spec-21-1-preserve-evidence-unicode-values.md).
The [Admin-continuity safeguard](ADMIN-EXPIRY-OWNER-DECISION.md) was separately
approved and implemented in the [Admin continuity checkpoint](ADMIN-CONTINUITY-CHECKPOINT.md); see its [scoped specification](../spec-20-6-admin-continuity-safeguard.md).
The next batch, merge and deployment remain unauthorised. The verification counts
below describe the original checkpoint.

This is the authorised next batch after owner acceptance of Story 20.5. It keeps
the Rust backend, fresh schema, continuing engagement conversation and standing
Permissions as the build baseline.

| Story | Delivered result | Evidence |
| --- | --- | --- |
| **20.6** | Admin manages membership, roles, expiry and engagement assignment through ordinary Save, without acquiring audit authority. Private recipient-bound invitations and immutable receipts support exact retries and current-authority revocation. | [Implementation](../story-20-6-implementation-evidence.md), [independent review](REVIEW-20.6.md). Pushed checkpoint `e28a4ccb551cb8e37131b64b4cdb20bc479c270e`. |
| **21.1** | Immutable scoped original acquisition, independently verified storage identity, exact retry/recovery, attributed source assertions and safe inspection alongside the conversation. | [Implementation](../story-21-1-implementation-evidence.md), [specification](../spec-21-1-immutable-evidence.md), [independent review](REVIEW-21.1.md). Final checks passed. |

The [sprint queue](../sprint-status.yaml) is the only active status source.
Implementation-complete stories remain in review until owner acceptance; this
checkpoint does not mark either epic complete. Published schema prefixes remain
unchanged. No main merge, deployment or cloud spending occurred.

The 20.6 report also records the fully repaired local development migration
incident, its independent review, backup/rehearsal and preserved data/authority.
Story 21.1 uses guarded disposable databases and does not mutate development.

## Browser evidence and limits

The actual browser journeys cover scoped sign-in, two Tasks in one conversation,
accepted guidance, interruption/retry recovery, Pause/Stop and duplicate requests.
The added evidence journeys exercise real protocol upload/read-back, exact
acknowledgement recovery, current-audience withholding and narrow keyboard
inspection. Screenshots and final executed counts are linked from the story report.

The final combined checkpoint passes **172 Rust, 95 Chromium, 100 web, 54 fixture
and 47 Python tests**, plus process smoke, formatting, Clippy, builds and boundaries.
Three independent review layers and focused follow-up review closed all material
findings. Original failures and the browser's qualified tool-exit evidence remain
recorded in the reports; they are not erased from the verification history.

The executor is still bounded foundation activity. Model-driven audit work, live
connectors and a real managed computer are later dependencies. Local S3 protocol
proof is not live AWS IAM, versioning, retention or deployment qualification.

## Next dependency-ready work

Recommend **21.2 methodology → 21.3 trusted skills and 21.4 scoped working knowledge**.
The [next-batch handoff](NEXT-BATCH-AFTER-21.1.md) specifies dependencies and required
proofs. Admin keeps ordinary validated methodology Save without a new approval
ceremony. These inputs precede complete model-driven audit Task acceptance.

Keep **23.1 real-computer qualification early**. Its concrete
[environment proposal](QUALIFICATION-PROPOSAL.md) remains unapproved: isolated
nonproduction AWS `us-east-1`, two zones, seven days, **USD 300 ceiling**
(USD 214.13 estimated services); one Ubuntu 24.04/Chromium `m6i.large` computer for
at most 24 running hours. Name the account/operator, window and owned synthetic
target before provisioning. No inference, Windows or paid app seats are included.
This is the remaining external authorisation gate, not a blocker for local
methodology/skills/knowledge work.
