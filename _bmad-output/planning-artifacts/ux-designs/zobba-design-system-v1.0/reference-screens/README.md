# Pair reference screens · active revision 3

Open [the interactive prototype](../source/zobba-working-environment.html). Select a scene or follow the work-card, sign-in, evidence, takeover/handback and scoped Task controls. All data/actions are simulated, with no credentials or external operations. The simulated computer is a layout fixture; production must show the real managed session.

The active [DESIGN](../../ux-Zobba-2026-09-25/DESIGN.md) and [EXPERIENCE](../../ux-Zobba-2026-09-25/EXPERIENCE.md) govern these references. Pair assets and token values are retained. Desktop PNGs are 1280×800; narrow PNGs are 390×844.

| Scene | Reference | What it establishes |
|---|---|---|
| RS24 | [Engagement conversation](24-engagement-conversation-1280x800.png) | Continuing conversation, several attributed Tasks, return digest, Needs you and stable work products. |
| RS25 | [Needs you](25-needs-you-1280x800.png) | Focused criterion question, contextual private access request, what waits and what continues. |
| RS26 | [Pinned work product](26-pinned-work-product-1280x800.png) | Selected paper remains while another Task produces work; citations, version, review status, Follow Zobba. |
| RS27 | [Private sign-in](27-private-sign-in-1280x800.png) | Origin, intended role, purpose and observation cover; prototype has no real credential fields. |
| RS28 | [Details submitted](28-details-submitted-1280x800.png) | Submission is a receipt, not successful authentication. |
| RS29 | [Verifying access](29-verifying-access-1280x800.png) | Automation waits for the intended account/application check. |
| RS30 | [Account verified](30-account-verified-computer-1280x800.png) | Account/environment, current controller, watch versus Take over. |
| RS31a | [Transfer pending](31a-transferring-control-1280x800.png) | Human input is not enabled before input fencing is confirmed. |
| RS31b | [Human controlling](31b-human-controlling-1280x800.png) | Named person, this-computer scope, reachable Hand back. |
| RS31c | [Handback verification](31c-handback-verification-1280x800.png) | Re-observe account/application/effects before agent use. |
| RS32a | [Pausing](32a-task-pausing-1280x800.png) | Named Task and helpers; other Tasks continue. |
| RS32b | [Paused](32b-task-paused-1280x800.png) | Confirmed quiet state and explicit Resume. |
| RS32c | [Stopping](32c-task-stopping-1280x800.png) | Admission ended; termination/reconciliation still pending. |
| RS32d | [Stopped](32d-task-stopped-1280x800.png) | Retained work, separate future Check schedule and new work cycle. |
| RS32e | [Reconnecting](32e-computer-reconnecting-1280x800.png) | No fake live frame or usable input; task remains available. |
| RS33 | [Narrow conversation](33-narrow-conversation-390x844.png) | Client scope, multiple Tasks, composer, Conversation/Workspace/Needs you. |
| RS34 | [Narrow workspace](34-narrow-workspace-390x844.png) | Readable paper, explicit Follow, review label and scoped controls. |

## Verification

[verification.json](verification.json) records local Chromium rendering, viewport overflow checks, JavaScript errors and representative interactions. Browser connector tools were unavailable, so verification used Puppeteer with system Chromium against a localhost static server. Screens were visually inspected after rendering. Computer ownership/control strips remain outside the scrollable desktop frame.

To reproduce, serve this Pair folder at `http://127.0.0.1:8768`, install `puppeteer-core` in a verification workspace, and run `PUPPETEER_MODULE=/absolute/path/to/puppeteer-core node source/verify-reference.cjs`. Override `CHROMIUM_PATH` or `ZOBBA_REFERENCE_URL` if needed. The verifier writes only these reference PNGs and verification.json. The test of each pending/confirmed state uses a clearly labelled simulation event; it does not establish production account verification, privacy, input fencing or operation reconciliation.

The following surfaces are intentionally **spine-only in this reference update**, without deferring their product requirements: home/search, full Data and Changes views, Permissions decisions, connection setup, Admin settings, exact-version review/issuance and recurring Check configuration. Their component/state/journey contracts are in EXPERIENCE.md. Earlier RS01–23 are [explicitly superseded history](../archive/pair-2026-09-25/reference-screens/README.md), not current fallback behavior.
