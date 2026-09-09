---
title: 'Epic 5 story status by verification level'
type: 'status'
created: '2026-09-09'
branch: 'codex/epic-5-live-replay, from codex/epic-4-agent-runs @ 9da4df6'
---

# Epic 5 story status by verification level

The same five levels as `epic-4-story-status.md`: Implemented (code and tests on the
branch), Locally verified (real PostgreSQL 18, the real commands, a real browser on a
developer host), Remotely verified (hosted CI on the exact commit), Owner-reviewed,
Deployed.

| Story | Implemented | Locally verified | Remotely verified | Owner-reviewed | Deployed |
|---|---|---|---|---|---|
| 5.1 Stream the Execution Timeline live over SSE | yes | yes: 24 unit, 6 integration with the real commands, 3 browser journeys with axe (`spec-5-1-…`, Verification status) | CI `34318755939` green in all five jobs on `3a426a4` (PR 25) | no | no |
| 5.2 Capture the platform-owned Replay asset set | yes | yes: 3,764 unit (7 on `copyRecording`), 9 integration on generation 44 with the real repository and its four CHECKs, both migration paths compared column/constraint/trigger (526/751/40), 3 mutations killed | pending on PR 25 | no | no |
| 5.3 Watch a Running Run in Live View | yes | yes: 42 unit, 5 integration on generation 42, 9 browser journeys with axe and the real worker signing grants, 2 mutations killed (`spec-5-3-…`, Verification status) | pending on PR 25 | no | no |
| 5.4 Pause and resume a Running Run | no | no | no | no | no |
| 5.5 Cancel and flag from Live View | no | no | no | no | no |
| 5.6 Answer an Escalation without leaving Live View | no | no | no | no | no |
| 5.7 Live View when the stream drops or the Run ends | no | no | no | no | no |
| 5.8 Replay any terminal Run | no | no | no | no | no |

**Story 5.2's live leg is unproven and cannot be proven here.** The recording copy runs
against a synthetic provider in every test: this environment holds no Solari key, and
`SOLARI_RECORDING` cannot be turned on for a session that already exists. And
`@solarisdk/browser@0.1.3` has no retention control at all, so "provider retention is set
to minimum" is an owner action against the provider account rather than a line of code.
Both are recorded in `docs/contracts/replay-asset-set-v1.md`.

Order of implementation and why: `epic-5-context.md`. The order was revised after 5.3:
5.7 moves to after 5.4 and 5.5, because its central criterion disables controls that do not
exist until those stories build them. Two of its three criteria are already met by 5.1 and
5.3; the third lands with the controls it governs.
