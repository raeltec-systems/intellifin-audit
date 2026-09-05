# Story 2.7 — edge-case review

Retained findings summary from the complete baseline diff:

- A submittable saved Draft with unsaved local edits submits older values and discards the visible edits on navigation.
- An existing predecessor that fails repository validation is treated as absent, silently producing first-version review semantics.
- A recipient with more than 100 delivered notifications cannot reach the older items.

These duplicate blind-review findings 1, 4 and 7 and are consolidated in the triage.


