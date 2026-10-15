# Independent review of the explicit local development repair

The final incident-repair guards close both NULL fail-open paths identified during this review. I concur with the preservation and refusal mechanics for the exact reviewed candidate below. This is not concurrence to apply a different candidate without regeneration and rehearsal: the separate source review identified two legacy-assignment regressions in this candidate, recorded in `/tmp/zobba-review-20-6/edge-repair-review.md`.

## Guard disposition

- **Closed — nullable target comparison.** All four database/user/address/port checks use `IS DISTINCT FROM`. I inspected the actual socket and wrong-target refusal logs; both fail at the target guard. The replay test refuses the already-repaired ledger.
- **Closed — missing bootstrap marker.** The guard requires exactly one bootstrap row with the expected singleton, product and schema version. The missing-marker probe deletes within its own explicit transaction and raises `unexpected version` before repair DDL; PostgreSQL aborts that transaction, so the deletion cannot commit. The root reports the connection rollback and the final restored-copy rehearsal succeeds afterwards.
- **Closed — exact original ledger.** The generated guard checks all five original versions, descriptions, success flags, checksums and installation timestamps. I independently compared every generated literal tuple with the preserved `ledger.json`; all five match. The separate row-count guard rejects extras or omissions.

## Independently verified scope

- Original draft SHA384 `0006d307a6fb84b7a30f916fceca29ff4266dbf1c24d4ac9827bf358ee850743b0c554584c83f125a377018755216c84`; reviewed candidate SHA384 `b008b5cb3a24e74ea12733d257fc6fc655f88b4af72f20672486a5ca4e491a6bca54d4ea34f1ffdb8c5c3d7919ab271b`. Both were checked from raw bytes, along with the original and final catalogue hashes.
- The four replacement bodies (`membership_validate`, `membership_read`, `membership_fence`, `membership_write`), the new `membership_assignments` function, two indexes and two immediately validated expiry constraints are exact candidate definitions. No other old/new migration content differs outside the enumerated changes.
- One transaction obtains exclusive application-table locks before inspecting or altering them, with bounded statement and lock waits. Invalid existing expiry values cause rollback rather than data correction.
- The known unpublished draft installation must match exactly, its three new tables must be empty, and recipient-proof columns must be unused. All 32 application tables are fingerprinted before/after. Published ledger versions 1–4 are compared unchanged, as are existing function attributes including ownership and ACLs. Only the known version-5 checksum is updated, with an exact affected-row check.
- The new function revokes PUBLIC access and grants only the named runtime role. Backup table-of-contents metadata confirms the existing membership functions and bootstrap table are owned by `zobba_local_admin`, matching the new function owner.
- I inspected `rehearsal-reviewed-final-guards.txt` through its 32-table fingerprint result and COMMIT, plus `rehearsal-reviewed-final-ready.txt` showing `cli: schema_ready`. These are root-executed results. This reviewer made no database connection or mutation and exposed no application-row contents.

Reviewed artifact SHA256 values: generator `bede8d77546556da70021c2d9cde7e6e63471eaf7dd8e2c06d1cb54c90a084ee`; generated SQL `16be4607ca023382618d7cac50442d8025a87b2508c7a358464f352689ef4492`.

No remaining concrete preservation, ledger-scope or target-refusal gap was found in these exact artifacts. Source fixes that change the migration invalidate the candidate catalogue/checksum and require a regenerated, rerehearsed incident repair before adapting the explicit database target. This report covers this local incident only; it does not propose a general mechanism for rewriting published migration history.


## Final second-repair review — 2026-10-01

**Current result: no remaining concrete preservation, ledger-scope, target-refusal or candidate-source blocker in the exact artifacts below.** This section supersedes the first candidate’s unresolved source conditions above. The two edge findings have now been closed in `/tmp/zobba-review-20-6/final-edge-review.md`.

Independently checked raw-byte hashes:

- Original draft SHA384: `0006d307a6fb84b7a30f916fceca29ff4266dbf1c24d4ac9827bf358ee850743b0c554584c83f125a377018755216c84`.
- Final candidate migration SHA384: `efb1dbb6945736a5989c2cc529edec26754f29967de4f3e3c7b4c4432f6a85653eb175ce759218a3af486242ec8d39cf`.
- Final candidate migration and retained `candidate-reviewed5.sql` SHA256: `db8ad2267d28718f28bfa0ebc6ec482ed7b74a6d8ac12f5c3042d6238fea7762` (identical bytes).
- Final schema-v5 catalogue SHA256: `085e616227a2d63834e6e9bfc3dd7e4612f39cf3ca10a2d7692d42d7aeee9d0a`.
- Generator `prepare-reviewed-repair.py` SHA256: `bede8d77546556da70021c2d9cde7e6e63471eaf7dd8e2c06d1cb54c90a084ee`.
- Generated `rehearse-reviewed-repair.sql` SHA256: `08adeaaab542bfd7da295fd3f0f7b8b73a4e917651a8f067946ae797ec9373a1`.
- Copied final CLI `zobba-cli-second-reviewed` SHA256: `6991c7fbb0b3928e90449af87c3edbc3722769ef658e771a91057fac2d3256af`.

I independently extracted the old and new function definitions. The generated replacement definitions exactly match the candidate’s four changed functions (`membership_validate`, `membership_read`, `membership_fence`, `membership_write`). The new `membership_assignments` definition is exact. Outside functions, the migration difference is still exactly the two approved indexes, two validated expiry constraints and new helper revocation entry; all other non-comment/non-blank DDL matches the original draft. The generator itself is unchanged from the previously reviewed guard corrections.

I separately compared every generated ledger literal with the preserved `ledger.json`: all five original versions, descriptions, success requirements, checksums and installation timestamps match. The guard also requires exactly five ledger rows, the sole exact bootstrap marker, the original draft catalogue, empty new membership tables and unused invitation-proof fields. The NULL-safe exact database/user/address/port guard precedes locks and repair work. One transaction locks all application tables, performs only the reviewed DDL and known unpublished checksum replacement, and verifies all 32 application tables, the published ledger prefix and existing function metadata/owners/ACLs before commit. The new function’s ownership, SECURITY DEFINER and runtime-only EXECUTE grant are explicitly verified.

Root-executed evidence inspected:

- `rehearsal-second-repair.txt`: all repair statements succeeded, all 32 application table fingerprints were checked, and COMMIT completed.
- `rehearsal-second-ready.txt`: copied current CLI reports `cli: schema_ready` for the exact restored clone.
- `second-guard-socket.txt` and `second-guard-wrong-target.txt`: wrong recovery target refused.
- `second-guard-replay.txt`: the already-repaired ledger refused.
- `second-guard-missing-marker.txt`: missing bootstrap marker refused inside the explicit probe transaction.

**Adaptation boundary:** after the full frozen-source checks pass and a fresh development backup is retained, I concur with adapting this exact generated script solely by changing the exact target literal `zobba_development_recovery_20_6_exact_test` to `zobba_story_20` and its descriptive comment. Confirm the adaptation diff contains only those changes. Keep every old-ledger, old-catalogue, unused-draft, target identity/address/port and preservation guard intact. A guard refusal requires investigation; do not weaken it. Any candidate migration/catalogue change invalidates this concurrence and requires regeneration and rehearsal. This is an explicit repair of one accidentally installed unpublished draft, not authority for a general checksum-rewrite feature or alteration of published migrations.

No database connection or mutation was made by this reviewer. All 158 frozen source files matched before and after review. The actual development database was untouched at this review point.


## Final R1 recovery recheck — 2026-10-01

**Result: no remaining concrete recovery blocker for this regenerated R1 candidate.** This section supersedes the second-repair candidate hashes above. The prior pagination and browser source is unchanged. Review of the R1 behavioral fix and the complete combined gates remains with the lead and its other independent reviewers.

Exact hashes independently checked from bytes:

- R1 source manifest: `fd4774a7735e7ab0473d5d99418883009b23903b47ff75e3042a82543f766744` (159 files, all matching before and after this review).
- R1 full diff SHA256: `33a2368b2df219c17a66963495368549d166f5949fd2ba77e135040f6493bfef`.
- Candidate migration SHA384: `f37f620b90745b6e2e86f886df697ffe1be074a70372a77194109a12713a9f341cfd2ab1abcadd71ed271e221bee3ba3`.
- Candidate migration and retained `candidate-reviewed5.sql` SHA256: `72c4f45e71c99609550b838cb714979623827d7daf86d528789137cbf2dd9dde` (identical bytes).
- Candidate catalogue SHA256: `b23577d5beda191b0d2cae44dd742d9655ed75d732218f1d4ccdaf3cd0c48fc8`.
- Unchanged generator SHA256: `bede8d77546556da70021c2d9cde7e6e63471eaf7dd8e2c06d1cb54c90a084ee`.
- Regenerated `rehearse-reviewed-repair.sql` SHA256: `53534c877b93f9b5ac2a088b5c89a10f2eaee11986f83ec44e5e1d6615a661fb`.
- Copied CLI `zobba-cli-r1-reviewed` SHA256: `3b5385ba3de93f675f92662d749644ba8612fde87d1767768542adac0bc89266`.

I repeated the independent definition and DDL checks against the preserved incident SQL. All four replacement functions and the one new function exactly match the current candidate. Outside functions, only the same two indexes, two validated expiry constraints and new helper revocation entry differ; the remaining DDL is unchanged. All five generated original-ledger tuples match the retained ledger. The generator and its complete target, original-catalogue, empty-draft, application-row, published-prefix and function-authority guards are unchanged. The generated SQL embeds the exact R1 migration checksum and catalogue hash and has exactly one clone target guard.

I inspected root-executed `rehearsal-r1-repair.txt` through its 32-table preservation result and COMMIT; `rehearsal-r1-ready.txt` reports `cli: schema_ready`. The four `r1-guard-{socket,wrong-target,replay,missing-marker}.txt` files show the expected target, ledger and bootstrap refusals. These are inspected execution records, not database commands rerun by this reviewer.

**Final adaptation concurrence:** once the combined checks and independent behavioral review pass, and a fresh development backup is retained, the exact reviewed R1 script can be adapted solely by replacing `zobba_development_recovery_20_6_exact_test` with `zobba_story_20` in its exact target guard and updating the descriptive comment. Verify that this is the entire adaptation diff. Keep every other guard and preservation check intact; refusal means investigate, not relax a guard. Any subsequent source, generator or catalogue change requires rechecking the candidate and rehearsal. The actual development database was untouched at this review point. This reviewer made no database connection, database mutation or repository source edit.
