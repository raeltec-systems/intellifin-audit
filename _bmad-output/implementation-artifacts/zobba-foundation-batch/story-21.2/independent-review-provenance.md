# Story21.2 independent review provenance

All reviewers received the same complete tracked/untracked diff from baseline `38d76b019db1e5cb637f8c66e6cde3947c3415b2`: `/tmp/zobba-story-21-2/review-complete.patch`, 884,884 bytes, SHA-256 `5e41c7562329e1b85be0b586f357172f3fe73fa7d7b6566eef71ded95bf55c85`. Source artifacts and verification evidence were available for read-only inspection. No reviewer edited code, operated services or invoked another workflow. All three top-level agents launched before findings were collected; root awaited all final reports before consolidated triage.

| Layer | Independent agent | Reported findings | Root disposition |
| --- | --- | --- | --- |
| Blind hunter | `/root/story21_2_review_blind` | Twelve findings: activation acknowledgement time, historical template lookup, Continue cohort, neutral contributors, Undo lineage, historical Edit, revoked organisation recovery, immutable scope/date controls, optional clear semantics, untouched label, organisation pagination, template-content schema | P01–P12 in `review-triage.md` |
| Edge-case hunter | `/root/story21_2_review_edges` | Activation acknowledgement time, Continue cohort, late inert consumption cutoff | First two duplicate P01/P03; third P13 |
| Verification gap | `/root/story21_2_review_verification` | Explicit initial Create context equals defaults in its fixture; active-task Save form/HTTP path unexercised | P14/P15 |

The blind reviewer independently delegated disjoint backend and browser readers; its backend reader checked domain provenance separately. The verification reviewer inspected actual test assertions and final run receipts, distinguishing producer-only tests from consumer paths. It gave concrete mutation examples that the original suite would miss: dropping explicit Create context before binding, and retaining new-only activation in the form handler.

Root inspected the implicated domain, SQL, infrastructure, API and browser paths. Each retained finding is a bounded patch under already established story intent. Repair requirements and root-assigned consequence severities are in `review-triage.md`. The consolidated P01–P15 repair request was delivered once to the retained implementation owner; no requirement was waived because the original combined checks passed.

This records the initial independent review, not closure or story acceptance. Repaired source, new regressions and fresh combined verification must be reviewed and recorded separately before the checkpoint is committed.
