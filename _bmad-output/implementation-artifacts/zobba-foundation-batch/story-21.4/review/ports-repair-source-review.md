# Story 21.4 — P12/P13 repair source review

Review scope: public inspection query contract (P12), public excerpt capture and missing automatic-capture recovery (P13), including the object-I/O boundary. Baseline and current HEAD at inspection: `d38e1daed736415ef13e7606345dac71bd1d9f01`; branch `codex/zobba-foundation-batch`. The story changes are unstaged/untracked over that baseline. Reviewed on 2026-10-02.

**Source verdict: no concrete remaining P12/P13 implementation defect found in the inspected snapshot. P13 execution closure remains pending.** This is a read-only source review, not a test execution claim. I did not build, run tests, access services, read credential files/raw traces, edit application files, stage, or commit. P14/P15 and broader store/UI repairs belong to the other reviewers.

I read root `AGENTS.md`, the frozen Story 21.4 specification/context, `/tmp/zobba-story-21-4/review/root-triage.md`, and the relevant source/test bodies listed below. The conclusions apply only to the recorded file hashes; later changes need reconciliation.

## P12 — inspection query contract

- `crates/api/src/knowledge.rs:562–634` implements a real `ScopeQuery` parser with optional `after`/`text`, a false default for `include_inactive`, unknown-field rejection, scope validation, and application-query validation. The GET declaration now includes all three optional parameters.
- Cursor bounds match `valid_scope_id`: 1–128 ASCII alphanumeric/underscore/hyphen characters. Search bounds match `application/src/knowledge.rs:487–493`: at most 200 Unicode scalar values, with C0/C1 controls refused. `infrastructure/src/knowledge.rs:1102–1158` performs C-ordered ID selection, authority/applicability checks, then untrimmed Unicode-lowercase substring matching. The declared 50-item/1,024-candidate limits and separate exact lookup accurately describe this implementation.
- `crates/api/src/lib.rs:413–435` supplies the explicit false OpenAPI default for the optional boolean. The checked-in `openapi.json:4178–4208` and generated browser operation `web/src/generated/api.ts:4516–4527` contain the repaired parameter contract.
- `crates/api/tests/knowledge_contract.rs:107–201` asserts the exact parameter set, optionality, schemas/default/descriptions, scalar counting, control rejection and cursor bounds. `crates/api/src/knowledge.rs:913–953` exercises Axum's actual URI parser for omitted/default, explicit true/false, exact whitespace/Unicode retention, malformed booleans, duplicate/unknown parameters and invalid text/cursor.

The lead reports generation plus five contract cases and one query-parser case passing. I inspected the tests and outputs in the source tree; I did not independently execute or inspect an executed-log artifact for those reported results.

## P13 — public source capture and recovery

### Production source path

- Both public POST handlers (`crates/api/src/knowledge.rs:800–905`) obtain the session-bound evidence and knowledge repositories and invoke `application::evidence::read_original`. They do not accept supplied excerpt prose. The excerpt handler derives its text with `capture_range`; recovery derives both the bounded excerpt and distinct source assertions with `capture_evidence`.
- `application/src/evidence.rs:209–230` inspects the registered original, checks its namespace, fetches its pinned storage version, validates maximum bytes and both declared/recomputed content identity, and reauthorizes after I/O. The metadata inspection commits before the object read (`infrastructure/src/evidence/mod.rs:265–287`), so this path does not retain a database transaction across the object GET.
- The subsequent knowledge write starts a new session/organisation/scope-authorized transaction. `verify_original` checks the registered version, digest, size, actor, exact acquisition request/timestamps and correction state (`infrastructure/src/knowledge.rs:817–836`). The final boundary rechecks accumulated source authority/session and scope before commit (`:106–178`). Excerpt replay refreshes the protected projection rather than restoring cached eligibility; recovery reopens eligible capture even when a command receipt already exists (`:1864–1976`).
- `capture_range` validates the whole original's inert UTF-8 eligibility, byte bounds and maximum excerpt length, then decodes only the exact selected byte slice; an interior UTF-8 boundary fails. Automatic capture chooses a valid UTF-8 prefix without stripping BOM or normalizing CRLF (`application/src/evidence.rs:233–303`). Four application unit-test bodies explicitly cover exact BOM/CRLF/emoji bytes, prefix boundaries, unsupported originals and invalid selected boundaries (`:306–376`).
- `excerpt_record` derives identity from registered original/version/range and preserves original actor/time/source identity. `capture_registered` deduplicates records and capture status. Evidence registration now revisits capture on an already registered original before returning its exact original receipt (`infrastructure/src/evidence/mod.rs:340–380`). No source overwrite path was added.

### New actual-public-route proof in source

`web/tests/browser/knowledge-sources.spec.ts:80–113` acquires a BOM/CRLF/emoji original through the UI/public evidence endpoints, selects a **nonzero byte range** beginning at the emoji, holds the real fixture's pinned object GET for 13.25 seconds, and requires the original UI command to finish successfully. It compares exact selected text, registered ID/version/digest/range/size/partial flag; retries the exact POST and compares the complete receipt; rejects a new request starting inside the emoji; requires one record with the captured ID; and downloads unchanged original bytes. This exercises the P10 timeout repair as well as P13's successful excerpt path. The hold is in the actual object fixture, not a fabricated successful capture response.

`web/tests/upgrade/knowledge.spec.ts:24–79` is the separate historical-producer proof. It:

1. Uses the schema9 API to reserve/upload an original with BOM, CRLF, emoji and two asserted metadata fields, then compares the accepted receipt and initial downloaded bytes.
2. Stops the old API, applies the current migration, and starts the current API against the same database and same object fixture.
3. Requires capture revision zero and `legacy_not_captured`, with no knowledge items in a new current Task.
4. Executes the recovery action through the current UI, then requires one exact observation and the two distinct source assertions with exact registered identity, storage version, digest and original byte range.
5. Restarts the API again, compares the complete exact-key recovery receipt, exercises a different recovery key and the original upload retry, and requires unchanged record identities/content, capture status, original acquisition receipt, downloaded bytes and one stored object.

`web/tests/browser/auth-runtime.ts:270–309,384–393` selects independently supplied schema9 binaries, checks actual ready schema versions 9/10, runs the current migration between API instances, and preserves the live object fixture across the transition. The schema reset occurs only before the baseline acquisition. The upgrade method does not seed or delete knowledge rows to create its omission. `web/playwright.knowledge-upgrade.config.ts` selects this isolated test directory; README lines 179–198 require exact baseline binaries and a separate invocation because the runtime owns the same disposable fixtures.

The API fixture executable composes the production authenticated router, evidence repository and S3 adapter (`crates/api/tests/evidence_fixture.rs:43–60`). The local S3 fixture enforces conditional creation and requires a version ID on GET (`web/tests/browser/evidence-s3.ts:164–204`). This is an in-process local object-protocol fixture, not external provider qualification.

A final hash reconciliation caught a concurrent narrow harness repair: `evidence_fixture.rs` now selects `build_browser_fixture_store`, whose transport deadline is 20 seconds, matching the production adapter's request ceiling. The shared short protocol-test builder retains its existing three-second deadline (`infrastructure/tests/support/s3_protocol.rs:160–180`; production constant at `infrastructure/src/evidence/s3.rs:22`). I inspected this repair and updated the final hashes below. Without it, the proposed 13.25-second successful held-GET proof would instead hit the fixture transport deadline. The narrow repair is necessary and does not change a production timeout or weaken protocol fault tests. It still requires execution.

## Coverage limits and outstanding closure

1. **Required execution evidence still outstanding:** passing final browser execution of the excerpt case and the isolated schema9 upgrade/recovery invocation on source matching this review (or a reconciled later manifest). Source presence, a visible/enabled button, or earlier passing API contract tests cannot close P13. Preserve failed attempts and inspect the final structured result/secret-free attachments and exit status.
2. **Baseline artifact provenance still outstanding:** the test accepts baseline executable paths from its environment and verifies schema version 9, but source inspection alone cannot prove those binaries were built from the exact baseline commit. The final evidence must tie the supplied CLI/API binaries to `d38e1daed736415ef13e7606345dac71bd1d9f01`, with the artifact hashes/build provenance and current-source manifest.
3. The new public excerpt test proves delayed successful I/O, not revocation during held I/O. Existing `infrastructure/tests/knowledge.rs:3732–3829` separately covers actual held application-object read → assignment revocation → denied disclosure, and read bytes → revoked authority → denied `record_excerpt`; it also checks a queued exact-session invalidation. These source tests support the boundary analysis but must not be described as public-route revocation races for both excerpt and recovery.
4. The older `crates/api/tests/knowledge_http.rs:605–615` excerpt check only proves mutation fences and an invalid range. It must not be counted as successful source capture. The new browser case supplies that missing route coverage once executed.
5. The upgrade omission is genuine legacy missing capture, not a capacity exhaustion scenario. The proof does not establish external storage qualification, a permanently available source during replay, or capture under every capacity condition; those claims are outside this P13 closure.

No additional blocking source repair is requested. Await the executed evidence and hash reconciliation before final closure.

## Inspected SHA-256 snapshot

Paths are repository-relative unless absolute. Some shared files were inspected only for the scoped portions described above.

```text
517d76b51301a60498b8eb19d79bdeb1915ba807e3d7ce79006970f65da16173  AGENTS.md
01361676b3fe9a9fe99073a95b20438e02494415a8c83aad56ad7d2f29ff8d86  _bmad-output/implementation-artifacts/spec-21-4-remember-scoped-working-knowledge-with-its-basis.md
0a69af8fa6b67774a9b693671792205d1d21765d58bfd3ebc03ba7f3a68aaac9  _bmad-output/implementation-artifacts/story-21-4-knowledge-context.md
fee243915aecf37278ec4e959a314a86d35736eb92c23e050df43d8d0b78d8bc  /tmp/zobba-story-21-4/review/root-triage.md
9e19b5f6bac184590074232c3b87bad27cb4fe9a63a10cbec1e2b1850e56de34  zobba/crates/api/src/knowledge.rs
e4054b087681d57183f0626a7422138394961d5ca80cb0ebaab2a0aa2a760e56  zobba/crates/api/src/lib.rs
33a4e19c65c944cd6280c1c538372b25201260f18fcc6bafd9e9c6b2651675cc  zobba/crates/api/tests/knowledge_contract.rs
4c766c712b99551293ea308e252e94c9bc1753ff0b2b3adef43d256870bbb0e3  zobba/crates/api/tests/knowledge_http.rs
29439e870b9022eeb73cb19ac2d47f5a2ac4c876ed778742fbe5ab0c750331d9  zobba/crates/api/tests/evidence_fixture.rs
c77b793928ea32f70eb589730236a092774ba58c24f41100ac5c9bbc51b1f119  zobba/crates/application/src/evidence.rs
9e00dcb7f4414c137b687f098a18e2876018817d98d135195fb55cd8fe3736c5  zobba/crates/application/src/knowledge.rs
a3906375bf0d42f8e6b2734b81f46546cdd438536ce94fea87ba89a2a8ab31de  zobba/crates/infrastructure/src/knowledge.rs
62a0373951737544c8b41c73c55da7f23b2145f2aa8c54207b1d9097ea01d796  zobba/crates/infrastructure/src/evidence/mod.rs
a72c46d6cb4644272ad948ba0fdcb09252e877dbdea14ac8a03316005a4ab590  zobba/crates/infrastructure/src/evidence/s3.rs
fdd351b616b9846974a45da49eace78ec00e57104388a416c46c9f50573b919a  zobba/crates/infrastructure/tests/knowledge.rs
8f1d12138ae2894d1f626f92ebf99813c6b3b63c1c10ad3f4d54ba47cdaca6bd  zobba/crates/infrastructure/tests/support/s3_protocol.rs
8a482f33f911a2534bb72353b96d27817ea5bc3b3696b80c2325e1b895c315b5  zobba/web/tests/browser/knowledge-sources.spec.ts
57e8cb31c114958ade33d69f9243333146f4447bc0295dd08bb7bf6da0bfceef  zobba/web/tests/browser/auth-runtime.ts
fe6389cd6882c95e6a575b637d69d680ce81b43db86399e8a89e3b6af16bb1be  zobba/web/tests/browser/evidence-s3.ts
9eb2c38b573e6e79ba452eb9f26dee260c2999c8aad3b29c8338ab9292d99857  zobba/web/tests/upgrade/knowledge.spec.ts
3b433b910299bbe8db54514d8250d146652ffb0b3a085a8813b83515f3ab9a2b  zobba/web/playwright.knowledge-upgrade.config.ts
b2d54fd6637fc49a0e03b3a922ad8ed2ee1fd6a17926e3695b6789f0c4c5d230  zobba/web/playwright.config.ts
90d4c4e09b6a012c7c9ff9e9eb7713813200786e3053009546fd7b05aa16026b  zobba/web/src/EvidenceKnowledge.tsx
09db5ca7b5718ed23058532ce290e9f850204530ed84ff88defb12ddcb5cda85  zobba/web/src/useKnowledgeCommands.ts
b1f8bc408312866e3ed5c1b797f9d433c005d898c4013aa0a554b481bca14c22  zobba/web/src/knowledge.ts
92545d313d22d23c8b694ab5f1e9096f0798873cefd308f1bcab9ee425fccb6e  zobba/web/src/generated/api.ts
e36652114641a3e82cd7d844999e4d24d3cd2cdb79db74422b68603be146f9d4  zobba/openapi.json
```

## Independent baseline provenance closure — 2026-10-02

**Baseline source/build provenance is now closed. Public browser/upgrade execution remains open.** This section supersedes outstanding-closure item 2 above. It does not establish a successful runtime upgrade or recovery.

I independently read the supplied manifests/build records and used read-only Git/file hashing; I did not execute either binary, build anything, access services, or read credential files.

- `git ls-tree -r` at `d38e1daed736415ef13e7606345dac71bd1d9f01` contains exactly **220 files under `zobba/`**. The baseline archive's regular-file set and `schema9-source-proof.json` file set match that complete set exactly. For every file, the archive bytes, recorded size/hash, and extracted file under `/tmp/zobba-story-21-4/schema9-browser-source/` agree. There were no missing, extra-manifest, size, content-hash, or extracted-source mismatches.
- I independently regenerated `git archive d38e1daed736415ef13e7606345dac71bd1d9f01 zobba` into memory. Its **5,683,200 bytes** and SHA-256 **`bf9a5ff1e9132d30a7a1ea3d89c75a2b1498ee5dc6869ac1763dcb7ca05d98c5`** match `schema9-source-proof.json`.
- `schema9-browser-build.log` records the `evidence_fixture` compiler artifact from the verified extracted baseline source, with `fresh: false`, and ends with `build-finished` / `success: true`. Its exit sidecar is `0`. The pinned API file is byte-identical by size and SHA-256 to the exact compiler-reported executable `schema9-browser-source/zobba/target/debug/deps/evidence_fixture-039cdd22944f1762`.
- `schema9-cli-build.log` records compilation of `zobba-cli` from the same verified extracted source tree and successful completion; its exit sidecar is `0`. The pinned CLI is byte-identical by size and SHA-256 to `schema9-browser-source/zobba/target/debug/zobba-cli`.
- Both pinned binary hashes/sizes match `schema9-browser-artifacts.json` and its baseline field. No binary was run by this reviewer.
- I independently hashed all **245 files** in `source-repair-final-start.json`; every entry matches the current checkout. Its base is the same pinned commit, and every reviewed application/test file included in that final manifest retains the hash recorded in the source-review snapshot above. Thus this final source manifest introduces no unreviewed delta in the P12/P13 snapshot.

Verified pinned executables:

| Artifact | Bytes | SHA-256 |
| --- | ---: | --- |
| `/tmp/zobba-story-21-4/schema9-evidence-api` | 151,556,192 | `792408ae5b38c696803b3b07bdc78a1ab00f601b2ab638ba390f6d059c8c0099` |
| `/tmp/zobba-story-21-4/schema9-public-cli` | 110,120,920 | `ef24b7e8f91bc41b2dba2bb254481af2b0e5610329dbc8572facf4f3bc95b902` |

Provenance evidence SHA-256 (all under `/tmp/zobba-story-21-4/`):

```text
31ea27c8ccd51eab290c3972cbeebdead281da1624d5eb279c168eb90ad18c1b  schema9-source-proof.json
3b55a01af0ca2c480399a250bcf68fd0cfc4386cd036f6a9905572a1e1fc1bf7  schema9-browser-artifacts.json
1868d5d5b973324a13ab511a050d3279189e96e3bc9a444c97d1c2421fd9a04e  schema9-browser-build.log
9a271f2a916b0b6ee6cecb2426f0b3206ef074578be55d9bc94f6f3fe3ab86aa  schema9-browser-build.exit
b22e3e17e4f5bc13fe7f8e209f9b4365776cc07e21de25acd572090bdc45da7e  schema9-cli-build.log
9a271f2a916b0b6ee6cecb2426f0b3206ef074578be55d9bc94f6f3fe3ab86aa  schema9-cli-build.exit
4d5abc4b6d5a536c530e8bbe5b67e8cfae19b2aedb6267604b9ab635d8b428a2  source-repair-final-start.json
```

Still required for P13: successful excerpt-browser and isolated baseline→migration/restart→public-recovery execution, with receipts/results tied to these pinned binaries and the final current-source manifest (or an independently reconciled successor). No execution result is inferred from provenance closure.
