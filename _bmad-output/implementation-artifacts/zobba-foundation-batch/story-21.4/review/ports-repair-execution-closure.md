# Story 21.4 — P12/P13 execution-evidence closure

**P12 and P13 are closed for the reviewed source and executed evidence.** No remaining scoped defect or missing public-source proof was found. The full 145-case combined browser invocation is separate and remains pending; this report does not close the whole story or replace that gate.

Reviewed on 2026-10-02 against baseline `d38e1daed736415ef13e7606345dac71bd1d9f01`, branch `codex/zobba-foundation-batch`. This report supplements `ports-repair-source-review.md` and its independent baseline-provenance closure. The earlier source report's pending public-execution gate is satisfied by the evidence below.

This was an independent review of actual source, executed logs/exit receipts, allowlisted proof attachments, and file/binary hashes. I did not run tests/builds/binaries, touch services, change app files, or access credentials, raw private JSON reporters or traces. All evidence paths below are under `/tmp/zobba-story-21-4/` unless explicitly stated otherwise.

## Executed evidence

| Gate | Reviewed result | Meaning for this scope |
| --- | --- | --- |
| `repair-api-contract.log` / `.exit` | 5 passed, 0 failed, exit 0 | Includes exact inspection parameter schemas, defaults, bounds and Unicode query tests. |
| `repair-api-query.log` / `.exit` | 1 passed, 0 failed, exit 0 | Actual Axum URI parser default/malformed-input regression passed. |
| `repair-rust-full.log` / `.exit` | 305 passed, 0 failed, 3 explicitly ignored helper entries, exit 0 | Includes the same contract/parser cases, automatic evidence byte-preservation tests, selected-range boundary rejection, real knowledge HTTP contracts and PostgreSQL knowledge producer/authority tests. |
| `repair-knowledge-focused-2.log` / `.exit` | 18 passed, one worker, zero retries, exit 0; 2.1 minutes overall | The successful public excerpt case at `knowledge-sources.spec.ts:80` ran and passed in 19.3 seconds, alongside the knowledge suite. |
| `repair-legacy-upgrade-1.log` / `.exit` | 1 passed, one worker, zero retries, exit 0; 10.7 seconds overall | The actual schema9 acquisition → migration/API restart → current UI recovery → restart/replay case ran and passed; case time was 5.4 seconds. |

I independently summed the Rust log's 44 test-result summaries: 305 passes, no failures, three ignored helper entries. Those entries are named process helpers (`production_constructor_child`, `gateway_worker_helper`, `reliability_worker_helper`), described by the log as invoked separately by parent tests; they are not counted as direct passes. None is the P12 parser/contract or P13 source-capture case.

## P12 contract closure

The executed five-case contract log includes `knowledge_inspection_declares_exact_query_parameters_and_bounds`, `knowledge_query_bounds_count_unicode_scalars_and_keep_exact_inputs`, and the generated session/mutation contract check. The one-case parser log names `inspection_query_uses_optional_defaults_and_refuses_malformed_inputs`. The full Rust log also records these cases passing.

The inspected API declaration, OpenAPI default modifier, generated OpenAPI/TypeScript, application bounds and real parser behavior remain as reviewed in the source report. They expose optional `after`, `text`, and `include_inactive`, with the implemented ASCII cursor bounds, 200-Unicode-scalar search limit/control rejection, exact untrimmed lowercase substring semantics and false inactive-history default. No backend/public-contract delta occurred between the source review, focused execution and current manifest.

## P13 successful public excerpt closure

I re-read `zobba/web/tests/browser/knowledge-sources.spec.ts:80–113` and matched its assertions to the passing named test and allowlisted `repair-public-source-io-proof.json`.

- The original is acquired through the actual UI/public evidence route into the real local S3-protocol fixture. It contains a leading BOM, CRLF and emoji; its immutable bytes are 43 bytes long.
- The test holds an actual pinned fixture object GET for 13,250 ms before release and requires the original UI command to complete. The proof attachment records **13,492 ms** elapsed, with **byte start 11 and exclusive byte end 39**, selecting exactly `😀 exact selected source\r\n`.
- The passing case compares the returned observation's text, registered evidence identity, storage version, SHA-256 digest, original size, exact selected range and partial flag. It retries the exact public POST and compares the complete receipt, requires one record with the captured ID, and refuses a distinct request beginning at byte 12 inside the emoji with HTTP 400.
- It checks unchanged object count and downloads the original bytes unchanged. The attachment records exact retry and original preservation as true.

The browser fixture uses the previously reviewed 20-second transport ceiling, allowing the actual 13.25-second held read; short protocol fault tests retain their three-second builder. The client uses the scoped 120-second excerpt/recovery deadline. The passing source test exercises the repaired slow-I/O path without merely fabricating a successful capture response.

This closes the missing successful public excerpt proof and supplies executed evidence for the overlapping P10 timeout repair. It does not turn this successful delayed-I/O case into a public-route revocation race. Post-I/O authorization remains supported by the reviewed production boundaries and the executed PostgreSQL/application test, as explicitly distinguished in the source report.

## P13 legacy omitted-capture recovery closure

I re-read `zobba/web/tests/upgrade/knowledge.spec.ts:24–79` and reconciled its assertions with the passing isolated test, `repair-legacy-public-capture-proof.json`, and `schema9-proof-invocation.json`.

The case actually accepts a public acquisition under schema9, verifies its original receipt/download, stops that API, runs the current migration and starts the current API against the same database and object fixture. It then requires capture revision `0`, the `legacy_not_captured` omission and an empty new-Task knowledge page before invoking recovery through the current UI. No knowledge rows are seeded or deleted to manufacture this omission.

The source fixture is **53 bytes** with BOM, CRLF and emoji. I independently recomputed its digest from the source literal; it matches the attachment: **`154a31daf6dcabfb853161ea40d4cf4d9e5464f9072a536ad9aaacc79dcf6504`**, pinned storage version **`v1`**. The successful test requires **three captured records**: the exact full observation and distinct `source.system` / `source.source_version` assertions. It compares the observation's version, digest, original size and complete byte range and requires capture omissions to clear.

After another API restart, the passing case requires exact-key recovery to return the complete original recovery receipt, a second key to create no duplicate capture, the original upload retry to return the unchanged original acquisition receipt, unchanged captured record identities/content and source status, unchanged downloaded bytes, and one object. Every corresponding proof-attachment boolean is true. Thus recovery revisits an already accepted original beyond its acquisition receipt and remains durable across restart.

### Baseline executable linkage

The existing independent provenance review established all 220 extracted baseline source files and the 5,683,200-byte archive as identical to Git commit `d38e1daed736415ef13e7606345dac71bd1d9f01`. The archive SHA-256 is `bf9a5ff1e9132d30a7a1ea3d89c75a2b1498ee5dc6869ac1763dcb7ca05d98c5`; both baseline builds finished successfully and their pinned files matched the actual build outputs.

For this closure I rehashed both pinned binaries. Their sizes/hashes still match `schema9-browser-artifacts.json` and the invocation metadata:

| Executable | Bytes | SHA-256 |
| --- | ---: | --- |
| `schema9-evidence-api` | 151,556,192 | `792408ae5b38c696803b3b07bdc78a1ab00f601b2ab638ba390f6d059c8c0099` |
| `schema9-public-cli` | 110,120,920 | `ef24b7e8f91bc41b2dba2bb254481af2b0e5610329dbc8572facf4f3bc95b902` |

`schema9-proof-invocation.json` links those exact hashes and baseline/source manifests to the isolated config, one-worker/zero-retry command, executed log/exit receipt, before/after manifests and safe public proof attachment. The baseline source/artifact manifest hashes remain identical to the independently reviewed provenance versions. No binary was executed by this reviewer.

## Current-source reconciliation

All five manifests below identify the same baseline and contain **245 files**:

- Focused knowledge before/after: `2026-10-02T20:27:33.666380+00:00` → `2026-10-02T20:29:45.339633+00:00`; **no file-set or hash change during execution**.
- Legacy upgrade before/after: `2026-10-02T20:38:41.756294+00:00` → `2026-10-02T20:38:55.556267+00:00`; **no file-set or hash change during execution**.
- Current final manifest: `source-repair-h2-async-final.json`, observed `2026-10-02T20:36:53.512976+00:00`; **all 245 entries independently match the current checkout** and exactly match both upgrade manifests.

The only manifest-entry change between the focused knowledge run and current/upgrade source is `zobba/web/tests/browser/auth.spec.ts` (`a8f0c28b2c2117eefb1921303afeb158b833af7a73a1e0460d2916c5483f2c9c` → `3fae064f9271148a12bdbb5884f6366204b7b495e964ec5835bd5228257c3b21`). There is no change to public ports, backend owners, source-case tests or the shared `auth-runtime.ts` in that comparison. The separate current full suite owns validation of that authentication-test repair.

The earlier source-review manifest → focused source comparison includes five files: `InspectionPreference.tsx`, `KnowledgeSupport.tsx`, `knowledge.ts`, `knowledge.spec.ts` and `knowledge.test.mjs`. The broader preference/support cases are outside this reviewer’s P12/P13 authority. I re-read the current `knowledge.ts` parsing, source-status, source-request and timeout paths relevant here; no scoped defect was found, and that exact current source was present throughout both passing focused invocations. Its current SHA-256 is `144c44f13c174b2373a2048e99af7c03553d353a6540c3b6678447124faac317`.

The actual P13 test hashes remain the source-reviewed hashes: `knowledge-sources.spec.ts` is `8a482f33f911a2534bb72353b96d27817ea5bc3b3696b80c2325e1b895c315b5`; `tests/upgrade/knowledge.spec.ts` is `9eb2c38b573e6e79ba452eb9f26dee260c2999c8aad3b29c8338ab9292d99857`. The API/public-contract and evidence-owner hashes also remain unchanged from the source review.

## Evidence hashes

These name only reviewed, explicitly allowed evidence. The identical zero-exit sidecars have SHA-256 `9a271f2a916b0b6ee6cecb2426f0b3206ef074578be55d9bc94f6f3fe3ab86aa`.

```text
31ea27c8ccd51eab290c3972cbeebdead281da1624d5eb279c168eb90ad18c1b  schema9-source-proof.json
3b55a01af0ca2c480399a250bcf68fd0cfc4386cd036f6a9905572a1e1fc1bf7  schema9-browser-artifacts.json
c25f064747df68a9538a29de2b6cd1293d0428b37d9dd55912b9a01f6333f963  schema9-proof-invocation.json
272186f194b921af7b32b9b5c2fc22ed6da30ff876c069f0f360b1e01ad4b75a  repair-legacy-public-capture-proof.json
bd1c35bb800d5d8517b0daa7244b3f01372f8ee1c9f7d365d0404e72c45115fb  repair-public-source-io-proof.json
ba916668e375b476d8e28b56f89f004a7aced5551de1fdc222069ae560c5aedd  repair-knowledge-focused-2.log
30f5a52d4929f50606a4c0ed975f5333077d079a4414e63d3be20f8f35074efb  repair-knowledge-focused-2-source-before.json
12035f27c45c096df0dae7ca97a65529945c1c2c765fd6261cbfd36b786f57c2  repair-knowledge-focused-2-source-after.json
1d70559e48d3a01c2b8b92975e6f3b7f5a1b389b1edc5a72b3e44c0f6152e5ee  repair-legacy-upgrade-1.log
077d75d1ee3b23ba60f418d4c4a60c0cc396ba6dc5d227bfa2332bfd4a349ee2  repair-legacy-upgrade-1-source-before.json
eb3422b97a4f3cfbe0440222cfad719f78978080a7182acab1975502f1b2e853  repair-legacy-upgrade-1-source-after.json
ec1c99fc01dbd5878600396dab577ae78fb00796c7b75b40cc7ec97597aa5e23  source-repair-h2-async-final.json
b0b272f5b00cd0c0162c6eb9becaebdc66365255d10a1576e44d1eb50f2d9e7d  repair-api-contract.log
40365b1c81829cb1108bf766997467d4c45032683baf4e4c7a2405b83d9d544d  repair-api-query.log
a47a70818cf1e8c3ecda268bad8be744d8cda076cbbae637b0bdb8deb9c5baa8  repair-rust-full.log
```

The local object fixture and legacy omission are the proved cases. This closure does not claim external provider qualification, omitted-capture recovery under every capacity condition, model consumption of knowledge, or a passing final combined browser suite. Prior failed attempts remain historical evidence; this report identifies the precise successful invocations and reviewed source that close P12/P13.
