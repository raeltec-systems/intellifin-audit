# Independent addendum — conversation-history synchronization

Reviewed read-only at 2026-10-02 10:18 UTC. The landed test-only repair is appropriate and strengthens the existing pagination evidence. The focused repaired test passed once with zero retries. This report does not claim that the newly started full 106-case rerun passed.

## Source and scope

I read `history-test-repair.patch`, the actual current test and `source-browser-repair-delta.json`, then independently compared the manifests rather than relying on the delta's booleans. Both `source-start.json` and `source-browser-final-start.json` contain 201 files. Their only differing entry is `zobba/web/tests/browser/conversation.spec.ts`; every current file matches the latter manifest. The saved `conversation-spec-before-history.ts` also matches that test's original frozen hash. Product code and Rust source/tests are unchanged.

The patch has 19 added lines and one replaced line (adding `TestInfo` to the test callback). Its SHA-256 is `2e23a1139379af8e28cad4cf164a64fc7d1af1419f165136094d0ff6cf95fde9`.

## What the repair observes

The old synchronization could succeed on a previously displayed 100-message snapshot while Latest was still refreshing. The repaired test at `zobba/web/tests/browser/conversation.spec.ts:285` now:

- Still requires all 105 real Guide POSTs to return 202.
- Reads the canonical scoped conversation and checks the complete ordered 100-key page: `page-guide-5` through `page-guide-104`.
- After clicking Latest, waits for the rendered final entry's exact `data-command-id` to equal that canonical final receipt and its content to be `Retained guide 104`. The 100-message assertion remains.
- Registers a history-request observer before clicking Earlier, then asserts the actual request's `through` and `before` values equal the canonical snapshot's watermark and before cursor.
- Keeps the six-message assertion and original Create assertion, and additionally requires the exact ordered earlier contents: the Create objective followed by Guides 0–4.

The existing second-actor assertions remain: the manager sees a bounded 100-message snapshot, a manager Guide succeeds, the Task's accountable actor remains `actor-a`, and the latest message is attributed to `actor-manager`. The foreign-scope 403/non-disclosure assertions and post-revocation empty conversation remain unchanged. The change introduces no response mocking, repeated mutation, fixed sleep, retry allowance, lower expected count or skipped assertion.

The waits now establish the specific projection whose history cursor is being tested. If the final accepted Guides never become visible, the exact receipt wait fails; if the wrong snapshot's cursor is used, the cursor assertion fails; if rows are dropped/reordered, the key/content or 100/6 assertions fail.

## Executed evidence and diagnostic limitation

`browser-history.log` records the focused command selecting this one test with `--workers=1 --retries=0`, its pass at 19.3 seconds, and `1 passed (26.0s)`. `browser-history.exit` is `0`. The real focused results file at `/tmp/zobba-story-21-2/repair-1/browser-history-results/.last-run.json` says `passed` with no failed tests. Because the exact cursor comparison is awaited and asserted before the remaining test body, this successful execution includes that comparison.

**The focused run's diagnostic attachment bytes are not available on disk.** I searched the configured results directory, the full repair evidence directory and usual repository test/report directories. The focused case directory `/tmp/zobba-story-21-2/repair-1/browser-history-results/conversation-bounded-burst-5d2b1-e-exact-attributed-audience/` is empty; the only file in that focused results tree is `.last-run.json`. The test uses an inline `info.attach` body, and the list reporter has not materialized it as a standalone JSON file. I therefore cannot truthfully report the actual focused attachment's cursor/receipt values or link to an attachment that does not exist.

The separately prepared `cursor-reporter.cjs` copies that named inline attachment to `/tmp/zobba-story-21-2/repair-1/conversation-history-cursors-full.json` when the full rerun reaches this case. That file did not exist at this review's last check. Its eventual bytes can supplement this addendum; neither its future existence nor the unfinished full-suite result is assumed here. No test, service or database was operated during this review, and no repository file was edited.
