# Agent guard mutation evidence (partial Story 4.11)

Runtime baseline: `10b7d563179a78bcebda9a07873766baec80b0d4` in a disposable detached worktree. The new tests were present as uncommitted files; the [machine-readable log](epic-4-agent-guard-mutations.json) records each source/test hash, exact removed guard, selected test, and actual assertion failure. Ten selected mutations were killed in local execution; this is **not complete Story 4.11 acceptance**.

| Removed guard | Baseline passed | Mutant failed |
| --- | ---: | ---: |
| escalation-agent-generated-label | 5 | 5 |
| golden-retrieved-objective-separation | 5 | 5 |
| golden-invented-tool-refusal | 3 | 3 |
| seeded-write-action-gate | 1 | 1 |
| seeded-origin-action-gate | 2 | 2 |
| credential-before-artifact-storage | 1 | 1 |
| identity-single-snapshot | 1 | 1 |
| missing-screenshot-evidence | 1 | 1 |
| unknown-tool-security-event | 1 | 1 |
| invalid-provider-security-event | 1 | 1 |

These are local unit, intercepted-provider, and server-rendering tests. The provider gateway parses actual response shapes, but responses are synthetic; no live model or actual worker abuse journey was executed. All five currently seeded prompt-like strings are discovered from canonical expectations/datasets, including both hero strings. All three scope-widening instructions reach the gateway refusal test; the existing action-gate tests verify write/origin refusals independently.

Reproduce from a clean, detached linked worktree containing the committed harness/tests, with dependencies available:

```sh
pnpm_config_verify_deps_before_run=false node scripts/verify-agent-guard-mutations.mjs /absolute/output/agent-guard-mutations.json
```

The harness refuses tracked changes or an attached branch, requires an assertion-passing baseline, restores each mutation in `finally`, rejects import/no-test failures as mutation evidence, and logs every completed result. Anchors intentionally fail on source drift and require review against a later candidate. This log is evidence for the named baseline, not a later release candidate.

## Unverified and surviving coverage

- A trial initializing `pendingOption` to the first answer **survived** the five SSR cases. The confirmation surface mounts after hydration, so SSR does not prove absence of preselection. That trial is not counted as a killed mutation. Browser interaction and authorized answer persistence remain required.
- `tests/integration/agent-abuse.test.ts` adds six real local-Chromium cases (five verbatim captured prompts and credential-bearing state removal checked against the actual released workspace). They have not run here.
- Five optional `--browser` mutations cover context reuse, cross-Run reference checks, egress, script write methods, and teardown. They have not run here. Local Chromium availability is required; this is not Solari isolation.
- The full actual-worker abuse matrix, frozen persisted objective/rule checks, every credential sink, browser escalation interaction, and per-case mutation proof remain outstanding. Existing hosted tests are not imported into this local log as acceptance evidence.
- This harness does not cover Story 4.10 D2b/D5 mutations.
