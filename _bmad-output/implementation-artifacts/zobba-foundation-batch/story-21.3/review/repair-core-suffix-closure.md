No findings. P6 and the reviewed unpublished schema suffix are reclosed after the cursor-collation follow-up.

Scope: independent source and evidence review of the final restriction/selection indexes, schema-v9 catalogue identity, and published prefix preservation. This supplements the earlier P1/P6/P10/P12 review; it does not replace that stage or claim P3/P5 product-flow closure. No application, build, test, service, or database execution was performed. The only written file is this report.

- P6 remains satisfied at `/workspace/intellifin-audit/zobba/migrations/0009_skills.sql:51`: `task_skill_selections_version` retains the leading `(organisation_id,version_id)` pair used by the restriction count predicate at line 184. The added `COLLATE "C"` applies to the later `task_id` cursor key and does not remove the restriction lookup prefix. `schema-v9.catalog:1069` records the valid/ready index with the same definition.
- Cursor indexes match the SQL comparison and ordering expressions. Migration lines 51–54 define the two selection indexes plus `skills_client_choices` and `skills_engagement_choices`. Assignment cursor predicates, inner ordering, and aggregate ordering all use `COLLATE "C"` at lines 95–101; impact tuple comparison and both ordering levels use it at lines 135–139. Catalogue lines 977, 981, 1068 and 1069 inventory those four indexes.
- Independently read and byte-compared all 16 published files against `git show 643ed095314d42f576106effd287703824003c73:<path>`. Every migration 0001–0008 and every `crates/infrastructure/src/schema-v1.catalog` through `schema-v8.catalog` matches the baseline exactly. Every independently calculated SHA-256 also matches the corresponding entry in `/tmp/zobba-story-21-3/repair-1/prefix-proof.json`. No published prefix byte changed.
- Independently compared current `schema-v9.catalog` with `/tmp/zobba-story-21-3/repair-1/schema-v9.raw`: exact byte equality. Calculated 1,529 newline-delimited rows, 195,343 bytes, three carriage returns, SHA-256 `6285a6d96fa4633be14d8b24a7c41a5358d745adc0ba4ce9be3e95b30bac733c`. All values match `catalog-proof.json:2` onward. No text-mode normalization was used for these comparisons.
- Independently calculated all four current source hashes listed in `schema-handoff.json`; every hash matches. `collation-proof.json:22` also binds the recorded probe to the current migration hash.
- Reviewed `collation-probe.sql` alongside its recorded receipt. Lines 25–39 compare paginated assignment results to an independent literal ASCII sequence and require native ordering to differ; lines 41–56 compare both impact traversal modes to independent task/revision pairs, with a cursor boundary inside a task's three selections. `collation-proof.json` records en_US.utf8/libc, 64 clients, 64 engagements, 192 impact references in each traversal, page limit 50, and probe exit 0. `collation-cleanup.json` records that the disposable database created for this run was dropped and its absence verified. These are inspected execution receipts, not executions repeated by this reviewer.

Final reconciled SHA-256 values (paths relative to `/workspace/intellifin-audit/zobba`):

| Path | SHA-256 |
| --- | --- |
| `migrations/0009_skills.sql` | `0729dc983091c43354fc5aea38a4c9c740ed6b50b091099119687a062ecf416a` |
| `crates/infrastructure/src/schema-v9.catalog` | `6285a6d96fa4633be14d8b24a7c41a5358d745adc0ba4ce9be3e95b30bac733c` |
| `crates/infrastructure/src/lib.rs` | `a17dfc2598318d61561ed7a092f54d083c64b41184c97fc3d4d6f07058042e64` |
| `crates/infrastructure/tests/bootstrap.rs` | `4c4f39aecbd039c7ee2bd67c5be770c5070513b1a501c984101ac7a6d7add570` |

The last two files were reconciled with the schema handoff by hash; their full implementation was not re-reviewed in this narrow suffix pass. Index inventory establishes the appropriate index definitions, not a planner-use or performance benchmark. Catalogue generation and cleanup outcomes rely on their recorded evidence; no fresh database observation was made. Full gates remain pending outside this review, and no final-gate completion is claimed. P1/P10/P12 were not reopened by this narrow schema review.
