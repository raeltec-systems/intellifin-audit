# Guided procedure preparation — first implementation slice

Status: implementation contract, 2026-09-11. Owner-authorised extension of Epic 2.
Baseline: `2ab2995e154885e006985cf49fb43f83ec32d878`, branch
`codex/epic-2-guided-authoring`, stacked on `codex/epic-5-controls` (open PR #29).

## Story 2.15 — Structured Template context

Extend addendum §C before transcribing risk and criterion reference into the build-defined
Templates. Risks are explicitly synthetic examples; an unspecified reference stays null.
Keep the existing nine stored section identifiers and order. Append Risk and Criterion
reference for new drafts; accept the exact historical nine-section payload unchanged.
An explicit context edit may add missing sections to a Draft with null values, never with
current Template defaults. Control, objective, risk and reference are editable through an
authorised, row-locked and revision-checked command. Changes record the human author and
invalidate/requeue compilation. The saved section array already flows into frozen plan
inputs. Diff the additional sections when present; historical review documents retain
their original shape and remain valid.

Acceptance: independent contract transcription checks; creation and editing persist all
four context fields; another procedure and the Template remain unchanged; submission and
manager comparison show adaptations; legacy inputs and stored reviews remain valid without
invented values; approved inputs are immutable; fresh versions do not inherit approval.

## Story 2.9 — Guided preparation and section review

Map the existing fields into seven navigable groups: context, scope and period, evidence,
audit steps, assessment criteria, frequency and handling, review and submission. Reuse the
current editors, common save/conflict guard, design tokens and compiled preview. On wide
screens show outline, selected work and collapsible help; stack on small screens. Keep
keyboard navigation, labels and visible saved/unsaved/error states.

Persist section acknowledgements separately from authored inputs and lifecycle approval.
Each identifies the saved content/context revision and human reviewer. No generation or
save implies review. Relevant changes invalidate acknowledgements; retain unrelated ones
only where the selected dependency rule can establish safety. The first slice may conservatively
invalidate dependent groups, documenting the rule. An unresolved material clarification
prevents review. Existing readiness and server submission validation remain authoritative.
Historical approved versions need no new acknowledgement to remain approved.

Acceptance: review acts against saved content, rejects stale/unsaved state, survives reload,
and becomes stale after relevant edits. Preparation statuses are independent of approval.
Submission cannot evade existing required fields or plan readiness. Verify responsive and
keyboard use with real rendered screenshots and axe.

## Story 2.10 — Help Me Write

Support only Objective, scope note and the existing per-system Audit Instructions.
Use a separate bounded application port and OpenAI's installed AI SDK provider with
`gpt-5.6-terra`; plan-check and Run model configuration are independent. Server-side calls
receive bounded, explicitly untrusted selected context and rough notes, with no tools.
Validate bounded structured output; show current and proposed text plus clarification
questions. Provide Help Me Write, Improve wording, Use this draft, Edit, Ask for changes,
Keep my wording, and the separate Mark reviewed and continue action.

A suggestion is never an automatic edit. Its identity binds version, section, requesting
human and generation context. Acceptance calls the current authorised draft-update command,
checks concurrency again and records the human. Pending/stale/duplicate/failed requests,
another editor, section switching and submission during generation must never overwrite
newer work or make approved content editable. Manual editing works without a provider.
Bound request frequency, retries, output and timeout; retain only necessary identity,
usage and audit metadata. No credentials or raw provider errors in client output or logs.

Acceptance: exercise accept/reject/edit, duplicate and stale acceptance, provider failure,
author identity and independent approval, plus denied execution before activation. Synthetic
semantic-risk cases cover sampling, negation, numbers, frequency, undefined criteria and
instructions in context that attempt to bypass review. Mechanical tests do not prove prose
equivalence. Live wording quality is a separate, honestly reported gate requiring credentials.

## Scope and verification

Stories 2.11–2.14 remain subsequent work: broad improvement proposals, full dependency tooling,
section comments, document ingestion and reference-document management are excluded. No new
lifecycle state, scheduler, hidden execution plan, automatic merge or deployment.

Use the exact repository pins and verification commands. Run unit, typecheck, boundaries,
real PostgreSQL integration, populated compatibility/upgrade, browser and accessibility
checks. Extend the owner walkthrough through assistance, a manager change request and
independent approval/activation. Record tested commits, screenshots and live-provider status
in the continuation log and final report. Commit and push verified story checkpoints.
