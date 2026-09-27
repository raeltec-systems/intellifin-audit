# Wording sheet 2, version 2 — Stories 10.6 and 10.10 (2026-09-27)

This sheet has everything that still waits for your OK. It replaces sheet 2, version 1.
Sheet 1 (approved on 2026-09-26, "approve all") is not repeated here.

`{…}` is a value the page fills in. My recommendation for every row: **approve**.

---

## Part A — 10.6: pauses and resumes (Execution Timeline and Paused banner)

A1 to A5 are unchanged from version 1. A6 to A10 are sentences the code already shows, but no
sheet listed them (found in the 2026-09-27 review). A11 is new and is not built yet.

| # | Where it shows | Sentence | Why |
|---|---|---|---|
| A1 | "Pauses and resumes", intro | Each pause says where it held the Run, and each resume says which attempt it started. When a pause interrupted an attempt, that attempt is marked superseded and the resume restarts the step as a new attempt. | A pause held between two steps interrupts nothing. |
| A2 | A resume after a pause held **between** steps | It started {step} (attempt {n}). | "Restarted" is false there: that step had not begun. |
| A3 | Paused banner, pause during an attempt | The Run is held at {step}, during attempt {n}. That attempt was superseded. | "Attempt {n}" read as the new attempt. |
| A4 | Paused banner, last line (one of three) | a) Evidence already collected is preserved. Resume restarts that step from its first Tool Action as a new attempt.<br>b) Evidence already collected is preserved. Resume starts that step from its first Tool Action.<br>c) (the record does not say) Evidence already collected is preserved. The agent restarts the current Step from its first Tool Action. | The old line said "restarts" even when nothing had started. |
| A5 | A step the plan cannot name | plan step “{id}” | So the sentence never has a hole in it. |
| A6 | A pause whose record names no person | Paused at {time}. | Sheet 1 has only "Paused by {name} at {time}." |
| A7 | A resume whose record names no person | Resumed at {time}. | Sheet 1 has only "Resumed by {name} at {time}." |
| A8 | Timeline, a pause "after this inspection" when the record is not recorded | Held after an inspection finished, before {step}. | Sheet 1 has only the form with the record. |
| A9 | Paused banner, a pause "after this inspection" | The Run is held after the inspection of {record} finished, before {step}. | Sheet 1 has no banner form for this pause. |
| A10 | Same banner, when the record is not recorded | The Run is held after an inspection finished, before {step}. | Same. |
| A11 | **New.** After "It restarted {step} as a new attempt (attempt {n})." | A pause does not use up an attempt, so the new attempt is also attempt {n}. | Today the Timeline says "during attempt 1. That attempt was superseded." and then "…as a new attempt (attempt 1)." Both are true (a pause gives the attempt back), but they read like a mistake. |

---

## Part B — 10.6: two decisions

**D1. Optional fields on existing audit events** (unchanged from version 1). There is no new
event type and no migration. The fields: `humanMatchDecisions`, `planStepId`,
`heldWorkItemId`, `stepExecutionId`, `attempt`, `resumedWaitId`. Old events stay as they are.
The pause and resume sentences above depend on them. **I recommend: yes.**

**D2. Replay gaps when Replay opens for one record.** Today, "Gaps in this playback" shows only
on the Replay of the whole Run. When a person opens Replay for one record (from the record
review), a missing frame of that record is not mentioned, so that view can look complete.
- a) Keep the gap list on the whole-Run Replay only.
- b) Also show the record's own gaps on the one-record Replay, with the same approved words.
  No new sentence is needed.

**I recommend: b.** It closes the old defect fully.

---

## Part C — 10.10: rare cases on the Timeline and in Replay (unchanged from version 1)

| # | When it shows | Sentence |
|---|---|---|
| B1 | The Work Item was not recorded | The Work Item this Escalation was raised for was not recorded. |
| B2 | The answer cannot be read | The answer this Escalation received could not be read. |
| B3 | A long list | Showing the first {shown} of {total} Escalation answers. |
| B4 | A "pause after this inspection" request that an immediate pause replaced | A request to pause the Run at once replaced it before it took effect. |
| B5 | Why a pause request did not take effect cannot be read | Why this pause request did not take effect could not be read. |
| B6 | A "pause after this inspection" request | It asked to pause after {step}. |
| B7 | The inspection is not recorded | The inspection it asked to pause after was not recorded. |
| B8 | No time recorded | Requested by {name}. When it was requested was not recorded. |
| B9 | No name recorded | Requested at {time}. Who requested it was not recorded. |
| B10 | Neither recorded | Who requested this pause, and when, was not recorded. |
| B11 | A long list | Showing the first {shown} of {total} pause requests. |
| B12 | Replay, opened from "Open in Replay" | Opened at the Escalation “{kind}”. |
| B13 | Replay, when the Escalation has no frame | Opened for the Escalation “{kind}”: {why there is no frame}. |
| B14 | Replay, when the linked Escalation is not in this view | The Escalation this link names is not available in this Replay view. |
| B15 | Replay, after B13 or B14 (only when a target with a frame exists) | Choose a recorded target below. |

B4 matters most: the approved "The Run ended before the pause took effect…" is false in that
case, because the Run did not end.

---

## What I need from you

1. **"Approve all"** (A1–A11, B1–B15, D1 yes, D2 b) — my recommendation, or
2. The row numbers you want changed, with the new words.

After your answer I build A11 (and D2 if you choose b), remove the "PROPOSED" marks, and finish
Stories 10.6 and 10.10.
