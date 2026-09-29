---
title: 'Epic 10 owner items: Replay gap marks and words, Escalation links, one record rule, bounded Timeline lists'
type: 'fix'
created: '2026-09-29'
status: 'in-progress'
review_loop_iteration: 0
implementation_authorised: true
implementation_authorisation: 'Owner, 2026-09-29: "B, and approve Fable''s words for 2 and 8" (all eight items as one follow-up story after the Epic 10 merge); "yes to both" (start it now)'
baseline_revision: 'd9c72c8'
source: '_bmad-output/implementation-artifacts/epic-10-follow-up-owner-items.md'
---

# Story 10.12: Epic 10 owner items

The eight findings the Stories 10.6, 10.9 and 10.10 reviews left for the owner, done as ONE
story, as the owner chose on 2026-09-29. The record with Fable's plan for each item is
`epic-10-follow-up-owner-items.md`. Story 10.11 (Replay continuation past the bound) stays
separate: no new route or continuation page is built here.

## Owner-approved words (2026-09-29, verbatim, do not reword)

- Item 2, one-record Replay: heading `Gaps in this record's playback`; banner
  `Playback of this record is incomplete: N frames are missing.` (one frame:
  `Playback of this record is incomplete: 1 frame is missing.`); suffix after a gap on another
  page ` · on another page of this record's frames`.
- Item 8, third sentence of the "Pauses and resumes" intro:
  `A pause request the Run never honoured is listed here too, with why it did not take effect.`

No other new sentence. Items 3 and 4 reuse sentences and links that already exist.

## Acceptance Criteria

1. **Gap marks follow the page shown (item 1).** On the one-record Replay and on the whole-Run
   Replay, every gap inside the window of frames on screen is marked, whatever page is open.
   The gap list and its exact counts are unchanged. Proven by an integration test with more
   than 100 gaps where a gap past the first 100 is on the open page.
2. **One-record gap words (item 2).** The one-record Replay uses the approved heading, banner
   (singular and plural) and off-page suffix, from the words module, pinned by unit tests.
   A gap position on that view says where it is in this record's frames, not across the session.
3. **Escalation plus record link (item 3).** A Replay link that names an Escalation and a
   record or cursor opens the record and shows the existing sentence "The Escalation this link
   names is not available in this Replay view."
4. **Escalation past the frames read (item 4).** The note for an Escalation whose frame is not
   among the frames shown also shows the existing "Open inspection Replay" link to the record
   page that holds its frame, when that page is known.
5. **One rule for an Escalation's record (item 5).** When the raise cites Evidence that
   resolves to a captured frame, Replay lands on that frame (the screen the Timeline's record
   is established from); otherwise it keeps the time rule (last frame at or before the raise).
   The rule is written in `docs/contracts/replay-v1.md`. Proven by a test where the two rules
   pick different frames.
6. **"First" says a true order (item 6).** Pause requests are ordered and cut by
   `coalesce(requested_at, occurred_at)`, so "Showing the first N of M pause requests." names the
   order they are shown in. No new words.
7. **The bound of 100 is a stated contract (item 7).** The 100 answers / 100 pause requests
   bound, with its exact caption, is written in `docs/contracts/durable-escalation-v1.md`.
   Next/Previous paging is not built here.
8. **Pauses and resumes intro (item 8).** Its third sentence is the approved one, from
   `decision-words.ts`, pinned by a test.

Every changed surface keeps WCAG 2.1 AA. No migration, no event type, no historical event
rewritten.
