---
status: done (Story 10.12, PR #67, merged into main at 9c17d19 on 2026-09-30)
created: 2026-09-29
source: Stories 10.6, 10.9 and 10.10 review findings, reviewed by Fable against the code
owner_decision: 2026-09-29 — Option B. Merge Epic 10 first (10.7 → 10.6 → 10.8 → 10.9 → 10.10), then do all eight items below as ONE follow-up story.
---

# Epic 10 follow-up: eight owner items

None of these blocks a story. Each needed a rule or words from the owner. Fable checked all
eight against the code and found all eight real. This file is the backlog record; it is not
a story spec yet. Do not start it before the Epic 10 merge.

`[CLOSED 2026-09-30]` All eight items were done as Story 10.12
(`10-12-epic-10-owner-items-replay-gaps-escalation-links-and-bounded.md`), merged in PR #67.

## Approved wording (owner, 2026-09-29, verbatim)

**Item 2 — the one-record Replay's gap words**

- Heading: `Gaps in this record's playback`
- Banner: `Playback of this record is incomplete: N frames are missing.`
- Banner, one frame: `Playback of this record is incomplete: 1 frame is missing.`
- Suffix after a gap on another page: ` · on another page of this record's frames`

**Item 8 — third sentence of the "Pauses and resumes" intro**

- `A pause request the Run never honoured is listed here too, with why it did not take effect.`

These are owner-approved. Put them in the words modules (`replay.ts` / `ReplayViewer.tsx`
words, `decision-words.ts`), pin them in tests, and do not reword them.

## The eight items and Fable's plan

### Replay (Stories 10.6 and 10.9)

1. **The gap list has a limit of 100.** For one record, Replay reads only the first 100 gaps,
   whatever page is open, so a later page can show a real gap with no mark. Counts stay
   correct. The whole-Run Replay has the same limit; fix both together.
   *Plan:* read gap markers by the page window shown; keep the list and the exact counts.
   Changes a database read and needs an integration test.
2. **Gap words on the one-record Replay.** "After frame N" counts across the whole session;
   the view does not say when a gap is on another page; the banner does not say "this
   record". *Plan:* the approved wording above.

### Replay links (Story 10.10)

3. **A link that names an Escalation and a record** (`?escalation=` with `?workItem=` or a
   cursor). Replay opens the record and says nothing about the Escalation. Only a hand-made
   link does this. *Plan:* show the already-approved sentence "The Escalation this link names
   is not available in this Replay view." No new words.
4. **An Escalation past the frames Replay reads.** Replay says the frame is not shown but
   does not link to the record page that holds it (the "Jump to" list reaches it only when the
   Escalation is among the first 500 read). *Plan:* also show the existing "Open inspection
   Replay" link. No new words.
5. **Two rules for which record an Escalation is about.** The Timeline and Replay can pick
   different records. *Plan:* when an Escalation cites evidence, Replay opens on that screen;
   otherwise it keeps the time rule. Write the rule in `docs/contracts/replay-v1.md`.

### Timeline (Story 10.10)

6. **"Showing the first N of M pause requests."** "First" does not say in which order.
   *Plan:* order and cut by the same key, `coalesce(requested_at, occurred_at)`, so "first" is
   true. No new words.
7. **Only the first 100 answers and 100 pause requests show.** *Plan:* keep the bound of 100
   with its exact caption and write it in `docs/contracts/durable-escalation-v1.md`; add
   Next/Previous paging later ("Next Escalation answers").
8. **The "Pauses and resumes" intro does not mention pause requests the Run never honoured.**
   *Plan:* the approved sentence above.

## Size

Small, no new words beyond the above: 3, 4, 6, 8, 2. Larger (a database read and a large
test each): 1, 5, 7.
