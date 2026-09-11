# Guided procedure preparation — implementation and review

Stories 2.15, 2.9 and 2.10 extend the existing Builder through Template context, guided
preparation and explicit acceptance of writing suggestions. The compiler still produces
the executable plan. Independent manager approval and activation still authorise execution.

Review PR: [#30](https://github.com/raeltec-systems/intellifin-audit/pull/30), a draft targeting
`codex/epic-5-controls`. The actual baseline is `2ab2995e154885e006985cf49fb43f83ec32d878`;
parent PR #29 was open and unmerged when the feature was created. No parent branch, main or release was changed; no pull request was merged or deployed.
The original checkout was clean.

The parent subsequently advanced to `3ab917a5a2f2ad7a3b6395c41256114ddda16fc3` with only
an Epic 5 review document. It is incorporated into this feature branch; application code and
instructions did not change. PR #29 is still open, and its review findings remain separate
parent work. The feature includes that latest parent for an unambiguous final CI tree.

Fully verified UI checkpoint: `abe27cab8ff323a2d15a090022b721153e6f283f`.
Final code correction: `18b1eac961c77dde7a932d3b90f32eec2c3eaeb9`, tree
`029b7a0542b2b748d9667b4109a39748c74b5257`. The PR summary pins the exact final head
(including this report) and its hosted CI run. Results are updated there without changing
the tested commit. The table below records checkpoint evidence and the live-provider limit.

## Delivered stories

| Story | Delivered behavior | Acceptance evidence |
| --- | --- | --- |
| 2.15 — Structured Template context | Risk, control, objective and criterion reference flow from build-defined Templates into editable, persisted version content, submission, manager comparison and frozen approved inputs. Synthetic risk defaults are labelled; missing references remain unset. | Addendum §C transcription and Template tests; draft/lifecycle tests; manager comparison; populated historical-upgrade tests. Adaptation never changes another procedure or a Template; old nine-section payloads stay unchanged. |
| 2.9 — Guided preparation | Seven outline entries, selected editor and collapsible contextual help; stacked small-screen layout. Manual saves retain explicit saved/unsaved/error states. Review acknowledgements identify the human, saved revision and content basis. Relevant edits invalidate them. | Preparation dependency/revision tests; real guided keyboard and responsive/axe browser journey; dirty-state and save-conflict tests; migration48 upgrade and immutability checks. |
| 2.10 — Help Me Write | Objective, Scope note and per-system Audit instructions support notes, Improve wording, visible comparison, Edit, Ask for changes, Use this draft and Keep my wording. Mark reviewed remains separate. OpenAI has its own bounded port and dedicated configuration. | Command, installed-SDK transport, Server Action and PostgreSQL tests; three browser failure/staleness/retry scenarios; complete owner walkthrough. Live model quality remains unverified without a credential. |

## Safeguards and decisions

- Generation writes a bounded request receipt, never procedure content, section review,
  approval or a second execution plan. Proposals remain separate until accepted by a human.
- Acceptance runs the existing authorised, concurrency-checked draft writer inside the
  receipt transaction. It records the human, including an identical-wording acceptance;
  changing roles cannot let that author independently approve the version.
- Suggestions bind actor, version, section, saved authoring revision, context, section basis,
  lifecycle-decision history and ten-minute expiry. Another edit, an edit followed by a
  reversal, submission/rejection or version-state change cannot revive old authority.
  Plan-worker status changes and section-review metadata alone do not stale authored text.
- Duplicate acceptance returns one outcome without another content write or plan job.
  Lost-response retries reuse their exact request receipt. A late completed receipt can be
  ready but stale after submission; acceptance is refused before and after completion.
  If a human rejects a pending request, its late proposal stays discarded; known token usage
  is still recorded without changing the rejection, procedure, review or plan.
- Review acknowledgements are optional preparation progress. Submission still represents
  the auditor's approval of the whole assignment and keeps all existing required-field,
  plan-readiness and governance checks. Explicit unresolved clarification blocks submission.
  No historical approved version gains a new six-click prerequisite.
- Dependency handling is conservative and explicit: context affects scope/evidence/steps/
  assessment; scope, criteria, evidence and instructions invalidate dependent groups;
  frequency review depends on schedule and source kind. Unrelated safe reviews remain.
  Full dependency analysis belongs to later stories.
- Native editing controls stay disabled until hydration installs their handlers. Saved
  content and native outline links remain readable; enabling the same subtree preserves
  component state and keyboard focus. All editors stay mounted when sections are hidden.
- The model receives no tools, credentials from structured contracts, source contents or
  connector locations. Recognised credential material and known references in supplied prose
  are refused before provider I/O, without silently changing saved wording. Text remains
  untrusted input; these bounded checks do not constitute a general secret detector.
- Migration48 adds nullable preparation state without backfill. Migration49 adds bounded
  authoring receipts. Historical missing risk/reference/authorship remains missing. The
  existing database protection continues to make approved definitions immutable.

## Verification

The toolchain is the repository's Node 24.20.0 and pnpm 11.25.0 with the frozen lockfile.

| Environment | Actual result |
| --- | --- |
| Local authoring checkpoint | 4,087 unit tests passed; typecheck, 590-module dependency boundaries, build and no-drift schema generation passed. |
| Local focused corrections | The navigation/wrapping tree passed 105 focused tests, pinned typecheck and 590-module boundaries. The final late-usage correction passed all 38 authoring command cases and pinned typecheck. Earlier Guided/Evidence hydration checks passed 24 tests. |
| Hosted `abe27cab…`: types, units and boundaries | Passed: 4,098 tests across 203 files; no violations across 590 modules. |
| Hosted `abe27cab…`: PostgreSQL 18 and migrations | Passed: 549 integration tests across 46 files, populated historical upgrades, schema generation without drift, and all 22 selected guard mutations detected. |
| Hosted `abe27cab…`: containers | Passed: all three images build; startup, authorisation and browser smoke checks pass. No image was published. |
| Hosted `abe27cab…`: browser and accessibility | Passed: all 195 browser/accessibility cases, with zero failures or skips. The separate focused guided/owner/writing step passed all 8 cases, including setup. The complete suite exercises the actual hero review navigation and a saved mobile Target System change after reload. |
| Hosted `abe27cab…`: hydrated UI/worker abuse | Passed: all 7 guard mutations detected by real assertion failures. |
| Live OpenAI | Blocked: no AUTHORING_OPENAI_API_KEY configured. The verification script reported blocked and made zero live calls. Synthetic transport responses are not live-provider evidence. |

Hosted evidence: [CI run 34601457170](https://github.com/raeltec-systems/intellifin-audit/actions/runs/34601457170).
The separately committed native-timeout correction closes an existing page-cleanup race
found by the previous PostgreSQL run: Playwright can throw its native TimeoutError just
before the outer deadline. Either timeout now discards the page. The original integration
deadline and cleanup assertions are unchanged; execution policy and model settings are
unchanged. The new unit deterministically forces the native timeout before the outer one.

The browser gate uses the real web service, Server Actions, installed AI SDK, PostgreSQL,
and an explicitly test-only synthetic OpenAI HTTP preload. It does not spend paid browser
Runs. The owner journey's final execution uses the existing approved synthetic fixtures.

Mechanical cases cover unapplied/rejected proposals, edited acceptance, stale responses,
duplicate acceptance, another editor, provider failure, unknown outcomes, terminal version
states, author identity, plan/review invalidation and execution refusal before activation.
Semantic-risk examples cover all records versus sampling, negation, changed numbers,
one-off versus recurring work, an undefined criterion and embedded instructions to bypass
review. Those examples prove review/acceptance mechanics, not semantic equivalence.

## Short walkthrough and actual UI captures

1. Create from a Template and inspect the labelled risk, control, objective and missing
   criterion reference. Edit only the procedure's own context.
2. Choose Help Me Write or Improve wording for a supported section. Enter rough notes.
   Compare current content with the proposed replacement; edit it or ask for changes.
3. Choose Use this draft to save, then separately mark the saved section reviewed.
   Jump between sections; unsaved edits stay in place.
4. Review the complete assignment and executable preview, then submit for manager review.
5. The manager requests changes using the existing review capability. Revise and resubmit,
   obtain independent approval, then activate. Backend Run attempts are refused at every
   unauthorised stage.

The following captures come from the actual Chromium-rendered implementation on
`abe27cab8ff323a2d15a090022b721153e6f283f`, using labelled synthetic fixtures.
They are unedited PNGs; their hashes, dimensions and originating job are retained in
[the capture manifest](guided-authoring-screenshots/manifest.json).
All six captures were inspected, including the corrected help-button wrapping and context
copy. The subsequent correction only retains known usage for rejected requests; it does not
change these UI surfaces. The final CI browser artifact also retains fresh captures.

| Capture | What to inspect |
| --- | --- |
| [Objective proposal](guided-authoring-screenshots/owner-objective-proposal-before-acceptance.png) | Current saved content and unapplied proposed replacement in the contextual assistant. |
| [Auditor's complete review](guided-authoring-screenshots/owner-auditor-full-procedure-review.png) | Prepared assignment, section acknowledgements and actual compiled preview before submission. |
| [Manager's revised review](guided-authoring-screenshots/owner-manager-revised-procedure-review.png) | Revised context and existing independent manager review after a change request. |
| [Stale suggestion](guided-authoring-screenshots/writing-stale-suggestion.png) | A pending response cannot replace newer manual edits. |
| [Clarification](guided-authoring-screenshots/writing-clarification.png) | An undefined criterion produces a question and no applicable replacement. |
| [Mobile preparation](guided-authoring-screenshots/guided-preparation-mobile.png) | The same outline and editors stack on a small screen. |

## OpenAI setup and remaining review points

Set `AUTHORING_OPENAI_API_KEY` as a server-side secret on the web service, using an OpenAI
project with access to `gpt-5.6-terra`. Restart the service. Do not use a NEXT_PUBLIC variable.
Plan-check and Run model settings remain independent. With no key, manual preparation works.
See [configuration and live review instructions](guided-authoring-openai.md).

Calls use the installed AI SDK Responses provider: structured output, store:false, low
reasoning, no reasoning summary, no temperature, no tools, a 30-second timeout and no automatic
retry. Limits are 8,000 note characters, 2,000 feedback characters, 64KB context, 6,144 output
tokens and 4,000 objective/10,000 other prose characters; six new requests per minute and
thirty per hour per human. Bounded receipts retain current/proposed wording and usage until
their owning version is deleted; acceptance expiry does not implement retention deletion.

The reviewing agent should inspect this exact pushed checkpoint, confirm the hosted gates,
then securely configure the key and run the six-case synthetic live-provider review before
claiming wording quality or provider access. Reject any proposed change of population,
threshold, timing, system, frequency, evidence requirement or approval rule that the auditor
did not request. A deterministic compiler cannot establish prose semantic equivalence.

Stories 2.11–2.14 remain subsequent work: no full dependency tooling, reference-document
ingestion, new manager section comments, broader conversational authoring, scheduler or
general-purpose automation designer. Approval of a procedure remains separate from review
of a Run's findings. Return this PR for independent review; do not merge or deploy it here.

See [continuation and checkpoint history](guided-authoring-continuation.md) for the exact
baseline, atomic commits and distinctions between local, hosted and live-provider evidence.

Focused review entry points: [Template contract tests](../../tests/unit/procedure-templates.test.ts),
[authoring command cases](../../tests/unit/procedure-authoring.test.ts),
[real database authoring cases](../../tests/integration/procedure-authoring.test.ts),
[populated upgrade](../../tests/integration/guided-authoring-upgrade.test.ts), and
[owner walkthrough](../../tests/e2e/owner-walkthrough.spec.ts).
