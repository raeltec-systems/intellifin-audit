Both follow-ups from `repair-ports-review.md` are closed for the reviewed backend/contract scope. No remaining finding in this narrow recheck. The earlier stage report remains unchanged; its SHA-256 is `ba5b4e45f5dd7f5c720b2491cbc66a8a46d302a472018d7d8c8a493b1056eb6a`.

- **P3/P5 pagination/collation — closed.** `zobba/migrations/0009_skills.sql:95–101` now applies `COLLATE "C"` to both assignment cursor predicates, subquery ordering and aggregate ordering. Lines 135–139 apply the same collation to the impact `(task_id, revision)` cursor comparison and both ordering stages. Lines 51–54 give the matching impact and assignment indexes explicit C collation. The browser's ASCII comparisons in `zobba/web/src/skills.ts:159` and line 209 are unchanged and now agree with those queries. Scope, session, Admin/audit checks and 50-item page bounds remain in place.

  The successful locale proof is substantive: `repair-1/collation-probe.sql:25–39` first proves default database ordering differs from an independently written literal ASCII sequence, then compares complete paginated client and engagement responses against that sequence. Lines 41–55 compare all `(task_id, revision)` references for both restricted-all and exact-version impact reads, preserving response order and checking last-row cursors. The 192 references comprise 64 mixed punctuation/digit/uppercase/underscore/lowercase Task IDs with three revisions each, so the 50-row boundaries exercise within-Task cursors. `collation-probe.stdout` records the completed proof, `collation-probe.exit` is 0, and stderr is empty.

  I also read `collation-probe.py`: it requires an absent fixed `_test` database, creates it from template0 with libc `en_US.utf8`, checks database/owner/PostgreSQL18/locale, runs the real migrations and probe with `ON_ERROR_STOP`, rolls back the transaction, and drops only the database it created after rechecking ownership. `collation-guard.stdout` confirms the expected test database, non-superuser/non-bypass owner and locale. `collation-cleanup.exit` is 0; `collation-cleanup.json` records drop and verified absence. The two earlier failures are explicitly preserved and explained in `collation-attempt-disposition.md`; neither is represented as a pass.

  The completed real HTTP receipt is `repair-1/skills-api-2.log` with `skills-api-2.exit` equal to 0. It reports one HTTP matrix plus two disposable-database guards passing (3/3, 10.54 seconds), and all six DTO tests passing. Source `zobba/crates/api/tests/skills.rs:583–697` traverses 69 clients and 521 engagements, checks complete response order against literal expectations, and checks the deliberately mixed-ID page-boundary cursors. Lines 451–572 seed only fresh Task/binding fixtures, then create all 54 selections through actual HTTP calls, disable the version through HTTP, and assert 50+4 impact results with literal first cursor `mixed-impactA/1` and an exact complete `(Task, revision)` sequence. It also checks no execution side effects. This complements the separate non-C database proof rather than claiming the HTTP fixture itself uses en_US collation.

- **P7 maximal wire-envelope fixture — closed.** `zobba/web/tests/skills.test.mjs:194–195` now uses the longest serialized redacted bound, `{accepted:false, kind:"organisation", delegation_depth:null}`. The fixture still includes 128 candidates plus 128 selection inspections, 16 needs per inspection, full 2 MiB installation-command and 1 MiB selection-receipt storage budgets, all version wrappers/resource digests, maximum current status provenance and numeric-string margins. `repair-1/web-focused-5.exit` is 0; `web-focused-5.log` reports 25 passing tests and the executed fixture measures discovery at **7,467,743 bytes**, catalog at **3,685,956**, assignments at **144,773**, history at **419,101**, and impacts at **66,288**. Discovery retains **920,865 bytes** of headroom below the skills-only **8,388,608-byte** read bound. The actual body reader accepts the serialized envelopes and rejects a body one byte above its cap. The original review's storage-enforcement and actual cumulative-capacity evidence remains applicable.

The final schema catalog is 1,529 lines and 195,343 bytes; its SHA-256 matches `schema-handoff.json` and `catalog-proof.json`. The raw-catalog proof records three preserved carriage returns and rollback. A read-only `git diff` against baseline `643ed095314d42f576106effd287703824003c73` for all published migrations/catalogs 1–8 produced no output. The catalog contains both new assignment indexes and the two C-collated impact indexes at lines 977, 981, 1068 and 1069.

The original review's P4 provenance/history, exact-session/current-authority fences and P7 redacted backend transport conclusions remain applicable: application, API implementation, infrastructure implementation, their previously inspected unit/DTO tests, OpenAPI, generated TypeScript and client parser hashes are unchanged. Frontend lifecycle behavior and whole-story/full-gate completion are outside this narrow closure.

I inspected source and existing receipts only. I did not run tests, builds, database commands or services. Creating this new report was the sole write; the prior report and application/test source were left unchanged.

Reviewed source SHA-256 values:

```text
0729dc983091c43354fc5aea38a4c9c740ed6b50b091099119687a062ecf416a  zobba/migrations/0009_skills.sql
6285a6d96fa4633be14d8b24a7c41a5358d745adc0ba4ce9be3e95b30bac733c  zobba/crates/infrastructure/src/schema-v9.catalog
c3ec09409f1a2ffc8a844b1565fd68430a7a5426ffbf13f86c482ceddeef7143  zobba/crates/api/tests/skills.rs
05fe6090c213a3f29f675e2b8a4db4e9acd9112e002a51b04d9ea7b90f65cc6b  zobba/web/tests/skills.test.mjs
a17dfc2598318d61561ed7a092f54d083c64b41184c97fc3d4d6f07058042e64  zobba/crates/infrastructure/src/lib.rs
4c4f39aecbd039c7ee2bd67c5be770c5070513b1a501c984101ac7a6d7add570  zobba/crates/infrastructure/tests/bootstrap.rs
1990191ffa44ca49733205cbe6ba2ebb7c63e9e4b9d956ca54393b56750d9d20  zobba/crates/application/src/skills.rs
4d78cf95db8db4feae8be629e776ab36436cf01371f8996dc80b90589debe9ae  zobba/crates/infrastructure/src/skills.rs
220063838f3c8ab6926bba38487834c5abb6c74cfe2b59c21ffb43d87ccb4c3e  zobba/crates/infrastructure/src/skills/tests.rs
698fcf623f11e589fc80db45475df26a7137dd4b342b64ce44286c842d0e62b8  zobba/crates/api/src/skills.rs
56776cabbc9e2f26fab45e21a0ceb288ccf6a7142208325a88c59d86ad57e54b  zobba/crates/api/tests/skills_contract.rs
ff4d0a988cfc19bdbe8823ced7e12f62d87a7cc7aa49b779cdbe8e83a375c933  zobba/openapi.json
faf101415ecdc22ee597b90401227548d20ea8c59b81c09d90b6cf224ae01e49  zobba/web/src/generated/api.ts
b71044858a695794661faa5c69dde5715a03224e2ecf945b89c97d50a69264c2  zobba/web/src/skills.ts
```

Evidence SHA-256 values:

```text
071fdaea19d3133634d6a6fcc17ed4f45e85064873a131190922fa16a51a630e  repair-1/collation-probe.sql
684f85bf049ae2d90de979fa5614eeb4eebbc6e965516720433e23558249ccd2  repair-1/collation-source.sql
2f4e85732b137d3f3c70ae13c2339b44c3436f5dc3e0c4f0d765a7533ba9cd96  repair-1/collation-proof.json
75c144793e08c0382b75a2f56c870dda3251ab566f7262f86c1f437c18c8cae6  repair-1/web-focused-5.log
293f4a9947346285aef93921c5e259cb3f17237e0951fa1222f1135bc64a9d59  repair-1/skills-api-2.log
14398d3ef6e6fa2de3008c4d9c65df8ce0a7281fde884cf06ae36ac64d61f286  repair-1/catalog-proof.json
```
