# Story 21.2 independent review triage

2 October 2026. Reviewed complete tracked/untracked diff from baseline `38d76b019db1e5cb637f8c66e6cde3947c3415b2`; artifact SHA-256 `5e41c7562329e1b85be0b586f357172f3fe73fa7d7b6566eef71ded95bf55c85`. All three context-free review layers launched before findings were collected. Root read relevant source and reconciled findings only after all three completed.

All retained findings below are `patch`: bounded defects in the current implementation or its verification, fixable under existing canonical intent and routine engineering authorization. They require neither a changed product rule nor a new authority policy. Frozen Save/Undo, inheritance, timing, active-work and authority requirements already determine the required behavior. No speculative alternative design is being introduced. No findings are deferred. Duplicate activation and Continue findings have been combined because both claim and required action match.

| ID | Severity | Finding and required repair |
| --- | --- | --- |
| P01 | high | Binding application samples a later time than resolution and acknowledges unincluded activations. Use one captured resolution cutoff for eligibility and acknowledgement, including recall-only paths; leave later events pending. Prove a cutoff crossed between calls cannot disappear. |
| P02 | high | Save accepts exact template references from historical definitions that resolution then excludes. Ensure every accepted reference remains retrievable within its authorized scope, including successor reuse; preserve immutable content, source attribution and recall/current-use restrictions. Add real persistence regression. |
| P03 | high | A Task stopped at scheduled Save and continued before cutoff misses the cohort. Enroll Continue in applicable future active assignments through the same owned bounded mechanism used by new Task admission. Preserve new-only isolation and post-cutoff semantics. |
| P04 | high | Any adopted empty override clears neutrality of inherited starter requirements. Derive neutral standing from actual contributing field/template provenance; unrelated/default-only adopted configuration cannot relabel starter criteria. Test empty and partial overrides and retain honest UI labels. |
| P05 | high | Undo and revision recovery choose a different package by matching scope/dates. Follow exact successor lineage; overlapping independently saved packages must remain untouched. Test both Undo and conflict recovery. |
| P06 | medium | Historical Edit creates an inevitable conflict with no recovery. Offer editing the current lineage head explicitly or restrict historical Edit; preserve Undo of the selected historical content. |
| P07 | medium | 403/404 withdraw private data but trap the inaccessible organisation selection. Restore the authorised organisation chooser without reload, retaining exact-session fencing and draft withdrawal. |
| P08 | medium | Successor editor permits scope/date mutations rejected by its server contract. Explain and lock immutable assignment/applicability for successor edits; a separately authored configuration remains available. No implicit reassignment policy. |
| P09 | medium | Optional inherited fields cannot be cleared through UI. Expose inherit/value/clear distinctly for text and reference fields; preserve mandatory inheritance and exact null/empty semantics. |
| P10 | medium | Untouched optional label starts as invalid empty string. Initialise to null; exercise Save without touching it. |
| P11 | medium | Quiet refresh resets organisation pagination and loses selected verified names. Preserve page/cursor and selected metadata while revalidating authority; test refresh/focus on a later page. |
| P12 | medium | OpenAPI describes preserved template prose as trimmed control-free text. Give it the actual bounded multiline schema and assert supported LF/CR/tab/indentation/FEFF values; regenerate contract. |
| P13 | high | Inert claim consumption has only an early scheduled-current-use check. Recheck after staged/deferred work immediately before commit, consistently with existing operation cutoff practice; prove crossing the cutoff rolls back consumption and receipt capability. |
| P14 | medium | Initial explicit Create context is tested with values equal to defaults. Real browser/API Create must use differing area/period and assert persisted initial binding plus exact command context/version IDs. |
| P15 | medium | Active-task Save is tested only below form/HTTP conversion. Exercise actual settings selection and Save with an existing Task; assert saved mode, pending change and eventual safe-boundary binding. |

Verification: re-run the story's complete verification after repairs; record new source manifests/counts and failed attempts. Preserve all existing receipt/retry, schema-prefix, session/authority, Unicode and Admin-continuity regressions. Repair pass is not a claim of acceptance until execution and independent closure evidence is available.

## Additional lifecycle finding after repaired full verification

P16 — **medium; patch.** The final source review found that `TaskMethodology.tsx` aborts a pending read during same-session authority revalidation without invalidating its request identity. Its catch therefore clears the inner basis; the visibility-hidden handler also explicitly clears it. Open/focused inner methodology disclosures are removed and recreated, losing their state and defeating App's retained-element focus restoration. This is a bounded deviation from the existing mounted-node/focus retention contract (`README.md:632`), not a new product or authority rule.

Repair intentional same-owner cancellation/hidden-state retention while preserving current-owner/session fencing, hidden protected content and withdrawal on actual failed reads/timeouts. A real-browser negative control must distinguish the inner disclosure from the outer section, then prove retained DOM identity/open state/focus through held revalidation and tab-away/return; real failure still withdraws it. Review the patch independently and run affected web gates and the full Chromium suite on frozen repaired bytes. Backend/fixture checks may be retained only with explicit unchanged-source proof.

The completed repair-1 candidate remains recorded as 225 Rust / 106 Chromium / 131 web / 56 fixture / 47 Python plus all twelve gates passing. That green suite did not cover this inner-node gap and is not acceptance of P16. Preserve it unchanged; P16 evidence belongs in `repair-2/`. The earlier P01–P15 closures remain valid for unchanged paths.
