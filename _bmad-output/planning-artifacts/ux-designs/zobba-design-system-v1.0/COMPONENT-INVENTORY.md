# Pair components · active

Visual specifications are in [DESIGN.md](../ux-Zobba-2026-09-25/DESIGN.md#components); behavioral specifications are in [EXPERIENCE.md](../ux-Zobba-2026-09-25/EXPERIENCE.md#component-patterns). The same names are used in both. This is the reference/prototype coverage map.

| Component | Reference | Behavior to verify |
|---|---|---|
| Navigation and header | RS24–34 | Engagement/Task attribution, scoped navigation. |
| Conversation and composer | RS24–34 | Input while tasks run; Received before Applied; no implicit cancel. |
| Task card | RS24 | Multiple linked objectives, owner/method/status, stable Task link. |
| Companion panel | RS24–25 | Active work, Needs you, Computers, work-product shelf, Permissions. |
| Question and receipt | RS25, RS28–29 | Exact current decision; submitted is not verified. |
| Workspace panel | RS26, RS30, RS34 | Pin/Expand/Close/Follow; no timed replacement. |
| Work product and evidence | RS26, RS34 | Version/Task/review labels, citations, return to claim, coverage. |
| Computer and control strip | RS30–32 | Watch/control distinction, task/helper scope, truthful pending states. |
| Private sign-in | RS27–29 | Role/origin/purpose, observation cover, no chat credentials. |
| Permissions decision | Spine-only | Actual bound effect; bounded standing rule; refusal/edit. |
| Changes and review | Spine-only, paper in RS26 | Exact versions, independent versus self-review, attributable issue. |
| Methodology, skills and Check editor | Spine-only | Admin Save; applicable version; reviewed recurring meaning. |
| Search and connections | Spine-only | Client scope, account/resource/authority distinction, incomplete states. |

The prototype uses native dialog focus containment and returns to the sign-in request. Narrow controls retain touch size. Full application accessibility, private-observation enforcement and real-computer behavior require implementation verification.
