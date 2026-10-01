# Story 21.1 independent review

Three same-capability reviewers independently examined the complete tracked and
untracked implementation: blind implementation, edge cases and verification gaps.
All layers were launched before collection and triage. The root consolidated
duplicate claims and sent R01–R16 to the original implementation lead. Repairs
remain within the accepted canonical story and integration contract; the frozen
intent and review-loop counter did not change.

## Disposition

| ID | Boundary and required repair |
| --- | --- |
| R01 | Bind storage namespace to destination settings without collapsing endpoint forms the SDK addresses differently; test actual signed destinations. |
| R02 | Use explicit byte ordering in SQL cursors, ordering and indexes; prove mixed-case paging under a genuinely non-C database. |
| R03 | Use one validated bounded save/recover envelope large enough for every accepted escaped assertion. |
| R04–R05 | Validate complete UTF-8 source/filename and file size before persisting a draft or making a reservation; keep correction editable. |
| R06 | Separate durable 100-reservation quota from transient two-transfer capacity; explain how completion frees a place. |
| R07 | Retain separate cursors through refresh, provide bounded Previous/First navigation and retain controls on an empty later recovery page. |
| R08 | Preserve accepted registration independently of a failed list refresh, subject to current authority verification. |
| R09–R10 | Focus explicit inspection with a reliable return target; expose pending expected identity and source assertions before upload. |
| R11–R12 | Align safe attachment filenames while preserving bounded extensions; describe actual binary transfer in owned OpenAPI/generated types. |
| R13–R14 | Prove production router configuration and the complete authenticated 15/120-second middleware composition. |
| R15–R16 | Prove real PostgreSQL 100/101 quota behavior and actual rendered measured provenance values. |

All accepted findings are implementation or verification patches. Adding an
abandonment/deletion lifecycle is outside this direct-upload contract; R06 repairs
the misleading quota response without claiming that lifecycle. There is no
unrelated pre-existing deferral or intent/specification loopback.

The follow-up review caught an additional R07 boundary: another tab completing the
last pending item on a later page hid its navigation. The component now retains
that empty page and its controls. The browser regression performs the completion
through the real upload API, refreshes the existing cursor and returns to 50 earlier
reservations. Its focused run passed 1/1; it also passed in the complete 95-case
Chromium run. All three independent repair rechecks closed their source findings.

## Review trail

- Initial findings: [blind](story-21.1/reviews/blind-review.md),
  [edge cases](story-21.1/reviews/edge-review.md),
  [verification](story-21.1/reviews/verification-review.md).
- [Consolidated repair instructions](story-21.1/reviews/repair-findings.md).
- Repaired-source rechecks: [blind](story-21.1/reviews/blind-repair-recheck.md),
  [edge cases](story-21.1/reviews/edge-repair-recheck.md),
  [verification](story-21.1/reviews/verification-repair-recheck.md).
- [Worker-test follow-up](story-21.1/reviews/worker-test-repair-review.md).
- [Final independent execution/evidence recheck](story-21.1/reviews/final-execution-recheck.md).

After source review, the combined run exposed a pre-existing 100 ms child
observation race in a worker test. The one-file repair uses a 500 ms actual child
and a single one-second observation/completion bound, below the real two-second
authority timeout. It retains the authority-requested, Completed and exact-child
join assertions and adds a monotonic elapsed check. The isolated suite passed
12/12. Independent targeted review found no weakening of the intended proof and
verified the other 179 source files unchanged.

Historical reports retain their initial snapshot and open findings; later explicit
dispositions close each finding. Their pending execution notes are accurate at
their own review time. Final combined execution passed **172 Rust, 95 Chromium,
100 web, 54 fixture and 47 Python tests**, plus smoke, formatting, Clippy, builds
and boundaries. The [results](story-21.1/results.json) distinguish retrieved
exit statuses from the browser's persisted passing report after transport loss.

The [180-file checkpoint manifest](SOURCE-MANIFEST-21.1.json) incorporates the
reviewed worker-test delta. Root and lead independently compared all entries;
published schema prefixes 1–5 remain unchanged. No material review finding is
left open. The implementation report records the transient membership-test 503,
the diagnosed observation race, the disk/linking interruption and actual limits.
