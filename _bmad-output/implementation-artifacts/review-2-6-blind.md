# Story 2.6 — Blind review findings

Reviewer: context-free, same model capability. Source: full tracked/untracked diff from 38c96ca. Findings retained for root triage; their inclusion is not acceptance.

- Transient provider errors return a failed application outcome, so pg-boss completes rather than retries the job.
- Failed derivation has no explicit retry action; unchanged saves enqueue nothing.
- Exhausted infrastructure retries can leave planStatus pending indefinitely.
- A duplicate same-digest delivery can replace an existing successful plan with a model failure.
- The model must echo all authored inputs but output is capped at 16,000 tokens; valid maximum-size Drafts exceed it.
- MODEL_PROMPT_VERSION accepts arbitrary text but always selects one implementation prompt.
- Only the deployment's current model identity can be instantiated; older frozen Draft identities stop deriving after a configuration change.
- planAttempts grows unbounded in the version row and is rewritten/transferred in full.
- listProcedures selects and validates full plans/history for every version although only 200 summaries are displayed.
- Normative exact-normalized identity matching does not identify immutable normalization rules.
- Pending preview polls every 1.5 seconds indefinitely without prolonged-state feedback or backoff.
- Shared config requires the provider key in web although web only needs identity.
