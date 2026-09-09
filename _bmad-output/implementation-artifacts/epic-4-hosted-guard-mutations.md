# Hosted agent guard mutations

This evidence is hosted PostgreSQL18/local Chromium verification, not Solari acceptance.

Candidate head: `f4892c930e031071a77cc5945ffb2936e34cfe86`.
Checked merge: `ef9334efbdcbb374a23fdcc538403a7f4e0e3b4a`.
Both complete trees: `5b5ff428306262bddf2148fcbdf483ff8e35c6b1`.
[CI34199194303, PostgreSQL job101973919735](https://github.com/raeltec-systems/intellifin-audit/actions/runs/34199194303/job/101973919735) passed all22 mutations.

[Exact JSON evidence](epic-4-hosted-guard-mutations.json) preserves each removed guard, replacement, original source/test SHA256, selected test name, baseline result, and individual mutant assertion failures. Baseline cases pass; removing the named guard makes each selected case fail an assertion. The harness refuses setup failures, timeouts and surviving mutants as acceptance evidence.

| Guard mutation | Baseline passed | Mutant assertions failed | Test |
| --- | ---: | ---: | --- |
| escalation-agent-generated-label | 5 | 5 | `apps/web/src/runs/agent-escalation-golden.test.ts` |
| golden-retrieved-objective-separation | 5 | 5 | `tests/unit/agent-abuse-golden.test.ts` |
| golden-invented-tool-refusal | 3 | 3 | `tests/unit/agent-abuse-golden.test.ts` |
| seeded-write-action-gate | 1 | 1 | `tests/unit/scope-widening.test.ts` |
| seeded-origin-action-gate | 2 | 2 | `tests/unit/scope-widening.test.ts` |
| credential-before-artifact-storage | 1 | 1 | `packages/application/src/runs/agent-capture.test.ts` |
| identity-single-snapshot | 1 | 1 | `packages/application/src/runs/register-observations.test.ts` |
| missing-screenshot-evidence | 1 | 1 | `packages/application/src/runs/execute-agent-work-item.test.ts` |
| unknown-tool-security-event | 1 | 1 | `packages/application/src/runs/execute-agent-work-item.test.ts` |
| invalid-provider-security-event | 1 | 1 | `packages/application/src/runs/execute-agent-work-item.test.ts` |
| browser-context-separation | 1 | 1 | `tests/integration/agent-isolation.test.ts` |
| browser-cross-run-reference | 1 | 1 | `tests/integration/agent-isolation.test.ts` |
| browser-workspace-egress | 1 | 1 | `tests/integration/agent-isolation.test.ts` |
| browser-script-write-method | 1 | 1 | `tests/integration/agent-isolation.test.ts` |
| browser-ended-workspace-state | 1 | 1 | `tests/integration/agent-abuse.test.ts` |
| p4-d2b-prohibited-baseline | 1 | 1 | `packages/domain/src/procedures/plan-compiler.test.ts` |
| p4-d5-duplicate-baseline-first-wins | 1 | 1 | `packages/domain/src/procedures/plan-compiler.test.ts` |
| absence-first-declared-search-key-only | 1 | 1 | `packages/application/src/runs/agent-observation.test.ts` |
| agent-measured-token-accounting-removed | 1 | 1 | `packages/application/src/runs/execute-agent-model-turn.test.ts` |
| single-grounded-match-escalates | 1 | 1 | `packages/application/src/runs/agent-tool-planner.test.ts` |
| closed-wait-repeat-closure-guard | 1 | 1 | `tests/integration/run-waits.test.ts` |
| agent-review-threshold-strict | 1 | 1 | `packages/domain/src/runs/evaluation.test.ts` |

The separate [worker job101973919659](https://github.com/raeltec-systems/intellifin-audit/actions/runs/34199194303/job/101973919659) also passed all seven mutations (32 selected baseline passes and32 corresponding mutant assertion failures). [Exact worker JSON](epic-4-hosted-worker-mutations.json) retains its complete per-case evidence. Together these are29 guard mutations; neither report establishes live Solari acceptance. Historical ten-mutation results remain in `epic-4-agent-guard-mutations.md`; they are not relabelled as current verification.

## Hydrated UI and actual compiled worker

| Guard mutation | Baseline passed | Mutant assertions failed | Test |
| --- | ---: | ---: | --- |
| hydrated-no-preselected-answer | 5 | 5 | `tests/e2e/agent-escalation-abuse.spec.ts` |
| hydrated-closed-answer-selection | 5 | 5 | `tests/e2e/agent-escalation-abuse.spec.ts` |
| worker-malformed-proposal-security-event | 3 | 3 | `tests/e2e/agent-worker-abuse.spec.ts` |
| retrieved-worker-security-denial | 6 | 6 | `tests/e2e/agent-retrieved-abuse.spec.ts` |
| model-response-credential-containment | 1 | 1 | `tests/e2e/agent-credential-containment.spec.ts` |
| terminal-worker-workspace-closure | 6 | 6 | `tests/e2e/agent-retrieved-abuse.spec.ts` |
| stored-frozen-objective-scope-rule | 6 | 6 | `tests/e2e/agent-retrieved-abuse.spec.ts` |

These tests used the f4892c9 source/test hashes retained in JSON. Subsequent test-only completion-barrier changes at9a6987f require their own hosted run; earlier evidence is not silently reassigned to changed tests.
