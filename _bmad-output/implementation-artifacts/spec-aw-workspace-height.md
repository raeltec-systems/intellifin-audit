---
title: 'AW hardening: keep the first answer visible in the desktop workspace'
status: done
type: fix
baseline_commit: 4e2791d95abd1134ad7e7cb9a7cd57a4e7661fa0
review_loop_iteration: 0
---

## Intent

Fix CI35532244865's real1280×800 regression: controller visibility adds wrapping in the toolbar and the decision's first option is clipped. Preserve usable conversation history and composer while presenting the question and first answer without initial scrolling. This is a reviewable layout correction within the authorized workspace scope.

## Scope and ownership

Work in /workspaces/intellifin-audit main worktree, branch feat/auditor-workspace-v1-1. Own only apps/web/src/runs/RunWorkspaceShell.css and closely related escalation-panel CSS if needed, tests/e2e/run-workspace.spec.ts geometry assertions, and this specification. Parent coordinates all PostgreSQL/browser tests. Do not modify conversation answer TSX, schema, unrelated specs or shared reports. Do not commit or push.

## Evidence

CI log: .playwright/pr51/logs/renewal-ci-browser.log. Screenshot: .playwright/pr51/renewal-ci-browser-artifact/test-results/run-workspace-Run-Workspac-56a54--surface-usable-at-1280×800-chromium/workspace-bounds-choice-1280x800.png. Inspect it.248/249fullbrowsercasespassed. Failed assertion at tests/e2e/run-workspace.spec.ts109 proves the first Select candidate1button was outside the decision clipping rectangle before clicking/scrolling. The current answer draft work adds a question context line, which must also fit. Avoid designing only for the old composer height.

## Behavior and constraints

Given1280×800 or1440×900 desktop with awaiting-auditor state and wrapped controller text, opening the workspace shows the first permitted answer and Send message entirely inside their panels and viewport. History retains readable space and its independent scroll; all remaining options are reachable. No hidden instructions/permissions/ownership labels merely to satisfy the assertion. Preserve narrow desktop/read-only layout and existing Focus workspace, divider and fit/native controls. Do not weaken viewport assertions, raise timeout or auto-scroll the initial option. Prefer coherent compact decision composition/spacing and sizing over arbitrary negative margins. Keep question/answer language readable and semantic reading order intact.

## Verification

Parent runs zero-retry tests/e2e/run-workspace.spec.ts and answer browser regression after the change. Agent may inspect source and run light syntax/diff checks; no shared database or browser processes. Signal when CSS is stable for parent testing. Record actual evidence only after parent returns results. Independent review will follow.

## Implementation and verification state

- Desktop composition puts the message field beside its character count and Send action,
  using the existing small spacing token. Inspection and question context remain full-width,
  visible, and in their original semantic order.
- The decision card and untrusted source blocks use the small padding token. The existing
  120px history floor and decision's independent scrolling remain intact.
- Geometry assertions additionally check the entire question, the first answer's horizontal
  bounds, and Send inside both its composer and conversation pane. The 1280×800 case also
  repeats the checks after starting a draft, when the context labels change.
- Inspected the specified CI screenshot; `git diff --check` passes. Browser verification
  is pending the parent-coordinated zero-retry workspace and conversational answer runs.

## Final verification — 20 September 2026

- All 703 existing and answer-related PostgreSQL cases passed in the complete suite.
  The separate, uncommitted Replay fixture had one tie-order expectation failure; its
  three tests are excluded from this slice's count. The 87 conversation cases are included.
- Full units passed 4,785 cases and exposed one undefined class in the separate Replay
  slice. After correction, all 57 affected UI/stylesheet cases passed. The original full
  invocation was not green; all its cases have passing evidence across these runs.
- Build, complete package/root TypeScript, dependency boundaries and schema drift passed.
  Boundaries reported only the unintegrated, uncommitted preview coordinator as an orphan.
- Five authenticated answer protocol journeys and all four workspace journeys passed,
  with zero retries. The workspace rerun waits for the existing hydrated history control
  before manipulating scroll; geometry and accessibility assertions remain unchanged.
  Maximum source lengths (2,000-character question, 512-character subject, 500-character
  choice) pass at both supported desktop sizes, including expanded source disclosure.
- The actual compiled-worker candidate journey passed separately with zero retries. It
  verifies the exact answer event, wait and receipt, and only the selected candidate's
  resulting Observation. One synthetic Northstar search response supplies ambiguity.

Three independent reviews and parent reconciliation are complete. Review corrections cover
source provenance, governed-content availability, exact retries, legacy fingerprints,
stale confirmation withdrawal, bounded source presentation and storage transition guards.
No real provider, real-data policy, complete P3 or overall proof-gate closure is claimed.
This slice still needs its pushed candidate's own CI; nothing was merged or deployed.


## Native POST follow-up from candidate CI

CI 35537277008 passed typecheck/boundaries but its unit job passed 4,785/4,786: the
form-method safety check rejected the flag form's omitted method. The correction keeps
`method="POST"` on the native form and attaches the React action to its submit button,
through an optional typed `Button.formAction` prop. The safety check is unchanged.
All 221 form/flag unit cases passed. Two zero-retry browser journeys passed: actual
JavaScript-disabled submission proves POST with no query and the note in the body,
and the workspace journey proves successful conversation submission with no console errors.
Web and root TypeScript checks passed. The rest of this candidate's CI remains
independent evidence. No merge/deployment or overall proof-gate closure is claimed.

## Suggested Review Order

- Review the exercised behavior and its boundary assertions.
  [RunWorkspaceShell.css:203](../../apps/web/src/runs/RunWorkspaceShell.css#L203)
