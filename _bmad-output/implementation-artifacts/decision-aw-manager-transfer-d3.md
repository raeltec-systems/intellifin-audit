# D3 decision surface: manager control transfer

Status: approved by the user in this continuation on 20 September 2026. The user selected “Approve the proposed dedicated manager permission (recommended).” Implemented and locally verified on PR #51; the pushed candidate still requires fresh CI. No production permission is enabled and nothing is merged or deployed. See [implementation review](report-aw-manager-transfer.md). This records the authority decision required by Auditor Workspace specification §10.2 and §19.1.

## Proposed behavior

An Audit Manager with an explicitly granted `run.control-transfer` permission may take an active Run's controller lease for themselves. Being an administrator alone does not grant this permission. The manager sees the current holder and must provide a reason and confirm the transfer. The request binds the observed controller epoch; a change before confirmation requires a fresh review.

One canonical Run transaction rechecks current role and permission, records the named reason through governed content, changes the holder and increments the epoch, and appends the durable transfer receipt. A client request key permits exact retry without a second transfer. Events and notifications contain safe identities and the receipt reference, not the reason text. Both viewers receive updated ownership; stale discretionary proposals and queued directions are refused under their original epoch.

Transfer never clears an accepted Pause or Stop, answers an open question, changes the approved procedure, resumes execution or grants result-review/approval rights. Existing eligible safety and exact-question-answer authority remains unchanged. Expired or released control continues to use ordinary acquisition. The current holder can still voluntarily release.

## Decision options

1. **Approve this dedicated manager permission (recommended).** Enables an accountable recovery path when the current controller is unavailable; requires a separately administered permission and a retained reason.
2. **Keep release/expiry only.** Adds no manager takeover authority; an unavailable holder may delay discretionary steering until their lease expires.

## Proof required after approval

Test manager without permission, administrator without permission, role/grant revocation, competing transfers, old-epoch confirmation, response loss, same-key conflict, transfer transaction rollback, both viewers, safety-latch preservation and stale queued-direction refusal. Governance of the reason follows D2; synthetic development must not imply approval to retain real sensitive content.

Approval of this authority does not authorize merge, deployment or real-data admission.
