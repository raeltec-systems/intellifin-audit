# Guided preparation — owner experience correction

Status: implementation in progress, 2026-09-11. This refines the adopted
`guided-procedure-preparation.md` direction following the owner's deployed-UI review.

## Baseline and review relationship

Branch: `codex/epic-2-section-assistant`, based on fetched `origin/main`
`4a96139173d48755e0954ee623f398bd02d88657` (PR #30 merged). The original
Stories 2.15, 2.9 and 2.10 are already deployed. This is a separate correction PR
targeting `main`. The abandoned broad section-edit prototype is preserved in a
named local stash; its proposed model access to structured fields is not adopted.

## Accepted experience

1. Choose a Template representing an existing synthetic institution control. Its
   risk, control and objective populate the new procedure. Review these once;
   adapting the procedure never changes the Template or earlier versions.
2. The platform explains what information is needed at each preparation step.
   The auditor selects the period, population source, target systems and required
   evidence using the existing structured controls. No model chooses connections.
3. In the main preparation area, the assistant asks for the intended test approach
   using the selected control and saved choices. The auditor can answer in rough
   language; the assistant proposes ordered, reviewable test instructions.
4. A correction can explicitly keep, remove, add or change parts of that proposal.
   The next request includes the actual proposal being revised, the correction and
   bounded prior revision context. It must not merely paraphrase the initial notes.
   Show the assistant's explanation and the proposed replacement before saving.
5. Acceptance saves through the existing authorised, concurrency-checked command.
   Marking reviewed is a separate acknowledgement. Review the compiler-produced
   executable plan before submission for independent manager approval/activation.

## Acceptance criteria

- ACCA's supplied `IT General Controls.pdf`, pages 3–4, informs labelled synthetic
  access/segregation/configuration Template context. It is educational guidance,
  not an institution's approved policy. Missing criterion references remain null.
- No new Template IDs or unimplemented change-management, backup or document
  ingestion capability is advertised as executable. Existing template/compiler
  contracts and all-record population defaults remain authoritative.
- Context, selection guidance and an obvious central assistant are available when
  navigating the outline. Section-local notes survive navigation and late replies.
- Revision requests preserve the full edited proposal, explicit feedback and
  bounded context, validated against the same actor, procedure, section and saved
  revision. Foreign, stale, expired or submitted-draft proposals cannot be reused.
- The assistant can develop instructions within the selected runtime's capabilities.
  Requests for design tests requiring unavailable evidence/actions, or changes to
  structured criteria/population/frequency, elicit specific guidance/clarification.
  Prose cannot secretly add execution steps or replace the compiler.
- Generation/revision does not save or mark reviewed. Reject/edit/accept, duplicate
  requests, uncertain outcomes, concurrent edits and human authorship keep existing
  backend safeguards. Manual authoring remains usable during provider failure.
- Mechanical tests cover revision provenance and full-length proposals; browser
  tests cover selection → assistance → keep/drop/add correction → edited acceptance
  → review, and existing manager/activation/refused-run paths remain green.
- Live-provider quality is reported separately from deterministic transport fixtures.

## Scope and continuation

The PoC uses build-defined Templates; administrator Template upload/CRUD is not
delivered by these seeds. The PDF is development input, not a new upload feature.
Broader dependency analysis, manager section comments and reference-document
management remain subsequent work. Full policy-design assessment is not inferred
from an operating-effectiveness test or from polished wording.

Correction checkpoints and verification are recorded below. No new production Run
or deployment has been made for this correction.

## Checkpoints

- Seed context: local commit `251f69b687455aa7f4b0142b4273e49200ae140b`, pushed
  `e9f5518ba5caeec5f38b3a342426587ecae64687`; identical tree
  `745a65ce2ac65c1b3604bf1d38b475143da2232d`. Thirty focused local tests pass.
  PR #31 targets main. Hosted CI 34641421152 passed types/unit/boundaries,
  container checks and the integration test step; its owner walkthrough correctly
  exposed an obsolete P-2 empty-control expectation, corrected with this work.
- Revision backend: 43 synthetic command tests and six installed-SDK transport tests;
  infrastructure typecheck passes. These establish mechanical behavior, not live
  wording quality. Local PostgreSQL execution is blocked because the environment
  cannot change to an unprivileged service user; real PostgreSQL 18 runs in CI.

- Revision checkpoint: local `41ef622bdeace035413eabdcbbafcbdd6f218143`, pushed
  `8cb6150c0d9ac01dd403c37a7bfee9da9797a171`; identical tree
  `7b5dee9464cdd2be56d3b833f75e8814d7aae05c`. Hosted CI 34642037236 passed types,
  unit tests, browser/accessibility and container gates. Its PostgreSQL test exposed shared test-user rate
  exhaustion in the new revision case; the case now uses a separate synthetic auditor.
  No rate limit or test assertion was relaxed.
- Central UI: pinned Node 24.20.0 / pnpm 11.25.0 root typecheck, boundaries and
  4,113 unit tests pass locally. The final focused authoring/UI/adapter check passes
  72 tests after the protected-configuration preflight correction. Browser validation
  follows the pushed UI checkpoint. No claim of live-provider semantic quality is made.

## Subsequent stories

- 2.11: broader improvement proposals, their basis and added evidence, with explicit
  wording-versus-meaning review and narrowing checks.
- 2.12: cross-section dependency flagging when a material change affects other sections.
- 2.13: consolidated manager review, section comments and approval/change-request flow.
- 2.14: reference documents used to design a procedure, distinct from execution evidence.

## Configuration and verification boundary

Set `AUTHORING_OPENAI_API_KEY` on the web service through secure environment settings.
The provider remains OpenAI, model `gpt-5.6-terra`; plan derivation and Run models are
unchanged. The existing Railway key reference is configured, but this correction has
not yet called the live provider. CI uses its isolated synthetic transport key only.
The production browser endpoint is unavailable to this session under its browser
security policy; no alternative access route was used to bypass that restriction.
