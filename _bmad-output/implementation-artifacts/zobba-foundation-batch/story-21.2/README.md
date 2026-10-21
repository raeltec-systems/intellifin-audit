# Story 21.2 verification package

**Final checked candidate: 107 Chromium cases passed with zero retries.** The publication destination is `_bmad-output/implementation-artifacts/zobba-foundation-batch/story-21.2/`.

The human checkpoint report explains delivered behavior and limits. [The producer contract](integration-contract.md) identifies exact bindings, activation/current-use fences and fields for the next stories. It is the unchanged backend contract from the verified repair-1 source; the later changes concern browser inspection and test lifecycle.

## Verification stages

| Stage | Meaning | Evidence |
| --- | --- | --- |
| Initial review | Three independent BMAD layers found 15 bounded repairs. These reports concern the earlier candidate. | [Triage](review-triage.md), [review provenance](independent-review-provenance.md) |
| Repair 1 | Backend 225, browser 106, web 131, fixture 56 and Python 47 passed; all 12 gates passed. Earlier failed attempts are historical. | [Final gates](repair-1/final-gates.json), [matrix](repair-1/matrix-execution.md), [closure matrix](repair-1/repair-closure-matrix.md), [attempt notes](repair-1/verification-notes.md) |
| P16 repair | Subsequent source review found inner-disclosure loss despite the green 106. Old-source negative control fails; fixed four-case file passes. | [Negative control](repair-2/browser-negative.log), [focused proof](repair-2/P16-verification.json), [blind closure](repair-2/blind-P16-closure.md), [verification closure](repair-2/verification-P16-closure.md) |
| Final browser harness | Expanded first run was 105/107. Final focused seven pass with stronger fault-delivery proof and drained evidence handlers. Final full 107 passed, with zero retries. | [Diagnostic limits](repair-2/harness-failure-diagnostic.md), [focused seven](repair-2/browser-harness-focused.log), [final source freeze](repair-2/source-browser-final-start.json), [completed gates](repair-2/final-gates.json) |

`repair-1/root-final-browser-freeze-audit.json` is an intermediate freeze audit captured while its browser run was still running; `repair-1/final-gates.json` records that stage's later completed result. Likewise, independent review notes state which receipts existed when written and retain dated follow-up dispositions. Earlier green receipts never substitute for fresh gates after a source change.

The nine retained backend/schema/API/fixture gates apply only because their inputs remain byte-identical. [The retained-gate map](repair-2/retained-gates.json) and [final source delta](repair-2/source-final-delta.json) distinguish them from fresh browser/web execution. Published migrations and catalogues 1–7 remain unchanged.

## Proof limits and reproduction

Chromium uses the real local HTTPS/OIDC/API/PostgreSQL/object fixture. Headless hidden/visible transitions are deliberate application-lifecycle simulations, not native OS tab qualification. The earlier no-fault-delivery phase has no established causal explanation; the final diagnostics prove only the actual requests and withdrawal observed in their executions. Real computer, model, skill invocation and audit evaluation are outside this checkpoint.

[Run recipes](repair-1/run-recipes.md) record the executed environment. Absolute `/tmp` paths describe this verification workspace; they are not a promise that private fixtures exist in another checkout. Use `zobba/README.md` for canonical setup. Only explicitly selected, inspected screenshots are published; raw traces, private fixture configuration and failure outputs containing synthetic session headers remain local.

`publication-manifest.json` hashes every published artifact. Review-report links may be rewritten for repository navigation; original source hashes are retained in the manifest when this changes presentation.
