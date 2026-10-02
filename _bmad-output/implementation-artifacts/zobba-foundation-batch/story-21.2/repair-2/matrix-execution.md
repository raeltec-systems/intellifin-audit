# Final Story 21.2 matrix execution with P16

The complete repaired Rust run passed225 tests/doc tests across38sections (`../repair-1/rust-tests.txt`, exit0, summarized in `../repair-1/rust-summary.txt`). `../repair-1/source-rust-finished.json` exactly matches the201-file freeze. The P01–P15 source/assertion mapping is `repair-closure-matrix.md`; the original comprehensive source assertion audit remains `/tmp/zobba-21-2-matrix-audit.md`.

| Frozen row | Actual repaired full Rust execution |
| --- | --- |
| Save | `../repair-1/rust-tests.txt:95` methodology HTTP passes, section result99; PostgreSQL methodology contract311/result315 verifies immutable version/assignment/diff/source/impact, invalid/stale no-write behavior, competing Saves and both Save/Create serialization orders. |
| Retry / Undo | Application exact Undo/retry meaning127/result132; PostgreSQL311/315 asserts immutable replay/conflict/Undo; HTTP95/99 proves wire replay. |
| Resolve | Domain149–172/result189 includes mandatory/optional inheritance, exact field/template provenance, missing context, ambiguity, neutrality and separate historical template sources. PostgreSQL311/315 and HTTP95/99 inspect persisted exact basis. |
| Timing | Historical business/availability application123/result132; domain165/169/result189; PostgreSQL311/315 executes captured cutoff acknowledgement, recall-only cutoff, earliest/due durable wake and future Task/Continue cohorts. |
| New Task | PostgreSQL311/315 and HTTP95/99 prove atomic binding, explicit Create context differing from defaults, exact command/receipt correlation, neutral fallback and retained Missing/Outside candidate pool. |
| Existing Task | Operation contract342/result346 invokes owned methodology execution helpers for retained new-only basis, explicit active changes, scheduled restart/quiescence, Guide context and Pause/Stop. PostgreSQL311/315 includes stopped-then-Continue future enrollment and post-cutoff/new-only exclusions. |
| In flight / recall | Operation342/346 preserves consumed inert/external exact epoch/binding association through controls/rebinding/recall; Task360/result364 executes confirmed deferred consumption barrier, newly due final gate and complete rollback of claim/receipt/event state. PostgreSQL311/315 proves historical template-source recall without importing ancestor criteria. OperationHTTP104/result108 exposes exact original binding for operations and cursor-paginated attempts. |
| Authority | PostgreSQL311/315 and HTTP95/99 cover forced RLS, owner mediation, foreign scopes, Admin versus audit access and confirmed-lock exact-session/revocation fences. Restricted-owner bootstrap227/result231 passes populated7→8 and final catalogue in268.97seconds; published prefix audit confirms14/14 unchanged. |

Three helper entrypoints are deliberately invoked as guarded subprocesses by passing parents: `api/tests/evidence_http/composition.rs:85` is spawned at26–28; `worker/tests/gateway_process.rs:223` is spawned at284–286; `worker/tests/reliability_process.rs:289` is spawned at354–356. The full log records their parent contracts and successful section results at47–52,397–402 and425–446. Their top-level ignored lines do not represent skipped product scenarios.


Backend evidence above is retained, not rerun: source-final-delta.json proves unchanged Rust, schema, API contract and backend-test bytes. P16 is limited to the inspected UI lifecycle and its actual browser test.

Final Chromium execution, serial with zero retries:

- `browser-full.log:56` — ✓   49 tests/browser/conversation-review.spec.ts:242:1 › inner methodology disclosure survives cancelled reads and tab-away but withdraws on current failure (14.4s)
- `browser-full.log:112` — ✓  101 tests/browser/methodology-review.spec.ts:95:1 › explicit Create overrides firm defaults and a real active-task Save applies at the owned worker boundary (6.8s)
- `browser-full.log:113` — ✓  102 tests/browser/methodology-review.spec.ts:160:1 › Undo and conflict recovery keep independent overlapping lineages separate and historical Edit opens the current head (3.6s)
- `browser-full.log:114` — ✓  103 tests/browser/methodology-review.spec.ts:195:1 › field controls distinguish clear from inherit while mandatory inherited text and references remain in force (5.6s)
- `browser-full.log:115` — ✓  104 tests/browser/methodology-review.spec.ts:247:1 › later organisation pages and verified names survive quiet refresh, and revoked selection returns to the authorised chooser (17.7s)
- `browser-full.log:116` — ✓  105 tests/browser/methodology.spec.ts:61:1 › Guide supplies missing Task context with exact attribution and stages a binding without replacing the original (4.2s)
- `browser-full.log:117` — ✓  106 tests/browser/methodology.spec.ts:124:1 › Admin Save, frozen lost-receipt retry, Undo, exact Task templates, new-only notice, recall and draft withdrawal (39.0s)
- `browser-full.log:118` — ✓  107 tests/browser/methodology.spec.ts:309:1 › a real saved incomplete methodology retains more than 100 limitations in Task inspection (4.0s)
- `browser-full.log:120` — 107 passed (11.8m)
