# Zobba patterns

End-to-end interactions composed from [components](COMPONENT-INVENTORY.md). For each pattern: what the auditor does, what the interface shows, and what the application records. The auditor never fills in provenance or execution metadata; the application records it.

| # | Pattern | Auditor does | Interface shows | Application records | Screens |
|---|---|---|---|---|---|
| P1 | Start work | Types intent on Home or in an engagement | Composer with engagement and permissions chips; the reply and activity follow | Task, engagement, permissions snapshot, sources used | 01, 02 |
| P2 | Continue work | Picks from Continue or Recent tasks | The task at its last state, with the panel restored if it was pinned | — | 01 |
| P3 | Watch Zobba work | Reads the activity; uses Inspect or Technical details | Current step with the working mark; presence chip; working data in the panel | Steps, sources read, timings | 02, 03, 04 |
| P4 | Guide active work | Types guidance while Zobba works | "Guidance queued for the next step", then "Applied your guidance · …" | Guidance message, the step where it was applied | 02, 03 |
| P5 | Stop | Presses Stop | "Stopped. Work so far is saved: …" | Stop time, completed steps | 02 |
| P6 | Ask about a conclusion | Selects a statement and asks | "Selected · …" tag; answer with citations | Question, selection anchor | 06 |
| P7 | Inspect evidence | Hovers or clicks a citation | Preview, then drawer; Back to claim | — (read only) | 05, 06 |
| P8 | Correct a conclusion and review changes | Selects and says what's wrong | Reply, "Draft 2 saved · View changes · Undo", typographic diff | New draft version, author = auditor instruction, diff | 07 |
| P9 | Answer a clarification | Picks a suggested reply or writes one | "Zobba needs your input", question, replies; the step resumes | Answer, decision point | 08 |
| P10 | Confirm an external action | Allows, edits or declines | One confirmation card with the material details and the drafts beside it | Decision, decider, material details hash, per-operation outcomes | 09, 16 |
| P11 | Review a working paper | Opens the artifact, inspects evidence, marks as reviewed | Artifact with its state chip; Mark as reviewed | Reviewer, time, version | 05, 10 |
| P12 | Promote to a scheduled check | Task menu › "Run this weekly" | Schedule form in conversation (frequency, time zone), confirmation in chrome | Schedule, method version, permissions snapshot | 12 |
| P13 | Review an unattended result | Opens it from the notification or the list | Actor line; assessment chip; readable conclusion; details; Mark as reviewed | Review | 13, 18 |
| P14 | Recover from missing or incomplete data | Requests the data (P10) or accepts the limitation | Limitation L-ref; suggested action | Limitation, carried into the artifact | 03, 13 |
| P15 | Reconnect a source | Reconnect from the notice, Connections or Scheduled | Reconnect flow; affected items listed | Connection event | 11, 12, 14 |
| P16 | Search across authorised work | Types a query and sets the scope | Results grouped by client · engagement; stale-index notice | — | 11 |
| P17 | Choose model and effort | Opens the model chip and picks a model and effort | Menu with the available models (unavailable ones explained) and an effort control | Model, provider and effort per step (How it ran) | 19, 22 |
| P18 | Review as audit manager | Opens Reviews, inspects the paper, asks Zobba, adds notes, returns or marks as reviewed | Reviews queue; paper with review notes and action bar | Reviewer, notes, decision, time, version | 20, 21 |
| P19 | Administer roles and models | Sets roles; enables models by region and engagement | Users and roles; Models and providers | Role changes and model policy (Audit log) | 22, 23 |

## Pattern details

### P4 Guide active work
1. The auditor sends guidance while a step runs.
2. The message appears as normal, with "○ Guidance queued for the next step" under it.
3. At the next step boundary, Zobba applies it and the activity shows "✓ Applied your guidance · measuring five working days from exit date".
4. If guidance conflicts with work already done, Zobba says so in the conversation and asks whether to redo it.

### P8 Correct a conclusion
1. The auditor selects a statement in the artifact (Iris outline) and types a correction.
2. Zobba replies in the first person, edits the draft and saves a new draft.
3. The panel switches to Changes only if the auditor chooses "View changes", or if the panel was already showing this artifact.
4. Undo restores the previous draft. Approved or issued artifacts create a new version for review (EXPERIENCE R5.4).

### P10 Confirm an external action
1. Zobba prepares drafts, opens them in the panel and posts one confirmation card.
2. **Allow and send** → per-operation outcomes in the conversation and in the Activity record. **Edit first** → the drafts become editable, and the card re-renders after changes. **Don't send** → "Nothing was sent."
3. A change to any material detail invalidates the decision (EXPERIENCE R7.4).

### P13 Review an unattended result
1. The notification reads "Zobba completed the weekly leaver check · inconclusive" and opens on the result.
2. The auditor reads the conclusion and expands Exceptions, Coverage, Evidence or How it ran.
3. The actions are "Mark as reviewed", "Discuss this result" (opens a task) and the suggested follow-up (for example "Ask Chipo for a complete weekly export", which goes through P10).
