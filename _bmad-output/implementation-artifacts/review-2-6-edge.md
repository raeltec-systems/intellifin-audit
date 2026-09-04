# Story 2.6 — Edge-case review findings

Reviewer: context-free, same model capability, configured edge-case review prompt. Source: full tracked/untracked diff from 38c96ca. Findings await root triage.

1. DraftBuilder.tsx:95–99: a newly bound Population Source returns from JSONB with reordered keys. JSON.stringify section equality treats this as a different value, creating false conflicts after a successful save. Suggested guard: canonical structural equality.
2. derivation-queue.ts:46–51: exhausted retries before attempt persistence leave a current Draft pending indefinitely. Suggested guard: reconcile terminal failed jobs to audited failed preview state.
3. model-gateway.ts:15–17: copying valid large authored inputs exceeds the 16,000-output-token limit and truncates required JSON. Suggested alternative: bounded candidate without echoed inputs, bound to original data before validation. Root must reconcile any contract implications before selecting a remedy.
