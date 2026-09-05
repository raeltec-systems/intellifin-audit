# Story 2.6 — Verification-gap review

The changed ComplianceRuleForm.tsx unknown-response branch is not directly exercised. Existing Compliance Rule browser coverage proves successful authoring, unrelated rename refresh and keyboard interaction; committed-response-loss tests cover Period and Schedule instead. Shared state-machine tests do not execute the Compliance Rule editor catch branch.

Removing setUnknownOutcome(true) from that catch branch would permit retry after an ambiguous committed save while current tests still pass. Add a Compliance Rule commit-then-abort browser case proving the visible unknown-outcome notice, disabled repeat save, and persisted condition after reload.
