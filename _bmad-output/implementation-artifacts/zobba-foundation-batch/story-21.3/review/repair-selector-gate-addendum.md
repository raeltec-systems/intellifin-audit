# Story 21.3 selector App-session gate addendum — freeze 9

Independent narrow review by `story_21_3_repair_ui_review`, 2026-10-02. No remaining finding in this two-line test change. The existing selector account-replacement case passed on matching freeze-9 source. The final combined 123-case browser gate remains separately owned by root and pending.

The only freeze-8-to-9 change is a comment and an early bound-request passthrough in `zobba/web/tests/browser/skills.spec.ts:553–555`. The session route now continues requests carrying `x-expected-session` before fetching or holding a response. A projection postcheck therefore cannot set `authorityHeld` or consume the gate intended for the explicit App `Refresh access` operation. The delayed real actor-A App session response remains asserted as `200` with actor-A identity before its hold.

I inspected the surrounding case at lines 523–599 and independently reversed the two added lines in memory. The resulting file hash exactly matches freeze 8, proving all other assertions, operations, cleanup and the existing 180-second timeout are unchanged. Both unsent and uncertain selector iterations still hold actual Task-skill and App session replies, require the old workspace and reason hidden, observe any visible old identity/reason/inspection/retry disclosure, release after real manager account replacement, require the selector and retry removed, forbid additional selection POSTs, verify exact previously committed selection receipt where applicable, and permit a fresh manager-authored selection reason. Gate release, observer disconnection and route draining remain intact. This was a bounded harness correction; no failure of this case before the guard was observed or is claimed here.

I compared all 221 entries in `repair-1/source-freeze-9.json` with current source and the focused-10 start/end maps: all match. Freeze 9 differs from freeze 8 only in this skills test; from freeze 6 it differs only in the already reviewed account-binding test and this skills test. Product, backend and generated source remain unchanged from freeze 6. The freeze-8 account-binding closure is preserved without edits.

| Artifact | SHA-256 |
| --- | --- |
| Current `zobba/web/tests/browser/skills.spec.ts` | `694b1257098a323b1424409b52977564852fa61589397b2d914965d5de698004` |
| Prior freeze-8 skills test, independently reconstructed | `a30c282bfa71dee3e3a36ca9bfc8f90ade6229f5fcc4475c15b145a78b66ef57` |
| `repair-1/source-freeze-9.json` | `d081d547692a7064325d57793ca7243fe8194157ac157fbb54ff9ca4b1a4af71` |
| `repair-1/selector-app-gate.diff` | `e3e0c10f8777b617ced20749b1931fe34915bfeea1522817f4fe97304e244b5b` |
| Preserved `review/repair-account-binding-harness-closure.md` | `b49bb272277bff9fdd2b66686a87df1c8cbec88e8698431ff60c7a95ef5b0d5c` |

I read `/tmp/zobba-story-21-3/repair-1/browser-focused-10.log` and `.exit`: one selected case passed, exit 0, one worker, zero retries. The selector case took 41.7 seconds; total was 49.6 seconds. The command selected the existing `late Task skill and session reads` case in `tests/browser/skills.spec.ts`. Both `source-browser-focused-10-start.json` and `source-browser-focused-10-end.json` exactly match freeze 9. `web-typecheck-final-9.exit` is 0 and its log is empty. These receipts establish the focused test and supplied TypeScript check; they do not establish a full skills-file or combined-suite rerun.

Review and hash checks were read-only; only this addendum was written. I ran no tests, builds, database operations or services, and changed no application/test source. Earlier stage-specific reports and their limitations remain in force.
