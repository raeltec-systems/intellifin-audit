---
title: 'AW P3: actual worker consumption of a conversational answer'
type: verification
status: done
context:
  - '{project-root}/AGENTS.md'
  - '{project-root}/_bmad-output/implementation-artifacts/spec-aw-conversation-answers.md'
---

## Bounded ownership

Implement only a new `tests/e2e/conversation-answer-worker.spec.ts` and any dedicated new
fixture under `tests/fixtures/` that it requires. The question-answer implementation agent
owns application, infrastructure, existing integration tests and the other new answer UI
suite. Do not edit those files, migrations, shared fixtures or shared reports. Coordinate
interface questions with `/root/question_answers`; report any production defect to root.
Do not commit, push, run database/browser suites or change verification environments.

## Required proof

Create an authenticated browser journey that answers a genuine P1 choose-candidate
question through the conversation and explicit confirmation. Run the actual compiled
worker process with the existing local Chromium/Northstar and synthetic provider approach.
Prove that the worker consumes the selected snapshot-bound option and follows only its
candidate, with an exact retained answer event/closed wait/interaction receipt and the
expected observation or next checkpoint. Read the resulting database/evidence identities;
a success banner or seeded final observation is insufficient.

Prefer having the real worker produce its question and evidence. If a restart fixture is
needed, use a valid snapshot-backed pending-wait checkpoint that the actual worker consumes,
and state exactly which portion was seeded. Never use the P4 deferred-pause fixture, which
has no candidate checkpoint. Preserve frozen plan/scope, normal queue recovery and existing
worker deadlines. No real provider keys or real audit data are available/required.

## Starting points

- `tests/e2e/agent-worker-abuse.spec.ts` and `agent-evaluation-journey.spec.ts`: compiled
  process lifecycle, synthetic evidence store, allowed browser/target environment and cleanup.
- `tests/fixtures/agent-abuse-worker-preload.mjs`: actual SDK request interception patterns.
- `packages/application/src/runs/agent-human-decision.ts` and its tests: exact candidate,
  snapshot, checkpoint, option and evidence identity checks.
- The new `run-conversation-question` reader and answer command in the current worktree:
  source identities required for an executable question anchor.

Use a fresh synthetic Procedure/Run owned by the test, restore roles before closing browser
contexts, terminate the worker in cleanup and keep test output free of credential material.
Do not use arbitrary sleeps as proof of consumption; poll durable state or explicit barriers.

## Verification handoff

Use pinned Node24.20.0/pnpm11.25.0. Root has Northstar on4300 and disposable databases
`intellifin_answers_ci` / `intellifin_answers_test`; `.env.pr51-answers.local` holds ignored
synthetic configuration and must never be printed. Web is intentionally stopped pending
the candidate build/migration. Root will build, migrate, sign in and run this journey with
zero Playwright retries. Run only lightweight syntax/type checks that do not build shared
packages or race another agent. Report exact test command, files and any incomplete proof.

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

## Suggested Review Order

- Review the exercised behavior and its boundary assertions.
  [conversation-answer-worker.spec.ts:319](../../tests/e2e/conversation-answer-worker.spec.ts#L319)
