# Conversational preparation actions

Owner-authorised extension, 2026-09-13. Baseline `origin/main` at
`7d0417566e740d989105bc3ef49493a35e0c3db3` (PR #33 merged). Working branch:
`codex/epic-2-conversational-actions`. This changes the earlier dialogue rule that
every reply is only prose: an explicit human command may invoke a bounded action.

## Acceptance contract

- “Record that”, “save this draft” and equivalent explicit commands accept the exact
  currently displayed objective, scope or instruction proposal through the existing
  authorised, revision-checked authoring acceptance command. No additional click is
  required. A question, partial response, stale suggestion, negative/conditional
  instruction or bare “yes” is never acceptance. Corrections still generate an
  unapplied proposal.
- “Select <name>” resolves only a registered population source or target system in
  the current evidence question. “Yes, select that” requires one identified option.
  Duplicate names and multiple options require clarification. No registration is
  invented. Existing filters and target selections are preserved; adding a system
  retains the existing explicit scope-expansion confirmation and cancellation path.
- “I’ve reviewed this; continue” uses the same section-review command as the button,
  against saved content. Missing fields, pending/unconfirmed saves and unsaved or
  conflicting edits prevent review. It does not accept an outstanding proposal.
- “Take me to evidence” and other named-section navigation requests open that section
  without saving, reviewing, losing edits or moving a response to a different section.
- The thread records the human command, pending action, and acknowledged result.
  Selection/save success is stated only after the existing command returns success.
  Duplicate sends cannot execute concurrently. Unknown save outcomes retain the
  existing reload/reconciliation guard. No automatic retry of a mutation.
- Only messages submitted by the human enter the command resolver. Provider output,
  supplied documents, notes in saved context and streamed text are never commands.
  Explicit short commands use deterministic routing, without another provider call;
  free-form drafting and keep/drop/change feedback retain the existing AI operation.

## Boundaries and verification

No new lifecycle, model, client SDK, schema or execution tool. Human attribution,
independent approval, activation, plan derivation and authoritative Run gates stay
on their existing backend paths. Control selection is already established by the
Template used to create this procedure; a chat action cannot replace its Template.
New controls, ingestion, general automation and Stories 2.11–2.14 remain separate.

Test exact command intent/negation/ambiguity, acknowledged versus failed/unknown
actions, real saved source/target/prose changes, cancellation of scope expansion,
review invalidation and navigation, stale and duplicate acceptance, and retained
manual authoring. Run pinned typecheck/boundaries/unit and hosted PostgreSQL,
migration, full browser/accessibility and execution-safety gates. Retain actual UI
captures. Report synthetic tests separately from live-provider evidence. Exact
tested/pushed commits and CI/release results belong in the continuation below and PR.

## Continuation

The first implementation checkpoint connects chat to the existing writers and guide.
Source choice preserves the saved filters; target choice preserves existing systems
and completes or cancels the existing scope-expansion dialog. Clear commands need no
model call or additional API key. Other phrasing remains a writing request or receives
clarification; this is bounded command support, not an unrestricted automation agent.

Pinned Node 24.20.0 / pnpm 11.25.0 typecheck passes. All 87 focused command, choice
lifetime, writing-state and guide tests pass. Boundaries pass (599 modules). An earlier
full local serial run passed 4,220 tests and failed the clean-workspace boundary check
because it observed a deliberately planted boundary-test file. The file was cleaned;
the standalone boundary gate and that exact assertion both pass on recheck. No gate,
timeout or expected invariant was relaxed. The final full hosted run remains required.

Local PostgreSQL/browser execution is blocked: `runuser -u nobody -- id` returns
`cannot set groups: Operation not permitted`, while PostgreSQL refuses root. Use the
existing hosted PostgreSQL 18/migration/browser jobs, not production data or a different
database engine. Browser tests now exercise ambiguous assent, exact chat acceptance,
duplicate acceptance, source discussion/selection, target cancellation/selection,
section review/navigation, stale refusal and a lost acknowledged chat save. Actual
chat-action screenshots are retained by the existing synthetic CI reporter.

Independent review found action/drafting collisions, delayed composer clearing and
stale choice/review shortcuts. These were corrected: non-catalogue selection prose
stays with writing; action results clear only their exact submitted text; leaving or
changing a question clears its discussed choice; explicit reviews always call the
authoritative command. Duplicate target names are distinguished in the step picker.
Review recheck and hosted validation are pending. PR records exact pushed/tested SHAs.

The initial pushed checkpoint `fdcc784b7b1579b786fcbd4394e4f3d6b777c8df`
passed hosted typecheck, boundaries, all 4,230 unit tests, container smoke and the
focused guided/owner browser journey. A follow-up review found that action replies
needed a proposal/target identity as well as a section identity. They now stay with
their original proposal in the conversation history and cannot appear below a newer
draft or another system's steps. A fresh refinement retains the saved content and
review but does not repeat the old save acknowledgement. Final hosted validation
must run against this correction as well.

The independent recheck also caught free-form audit prose beginning with “record” or
“save” being intercepted. Only the complete explicit command phrases and short
ambiguous assent now leave the writing path. Examples such as “Record why a value
could not be read” and “Save evidence from every record” remain unapplied drafting
requests. Target confirmation and acknowledged results use the same kind/identifier
labels as catalogue choices, including case-insensitive duplicate names; the browser
journey seeds such a duplicate and checks the exact confirmed registration. A model
clarification alone does not claim that an unsaved replacement exists or change the
existing manual section-review requirements.
