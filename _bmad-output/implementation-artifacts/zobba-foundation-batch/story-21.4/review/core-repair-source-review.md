# Story 21.4 core repair source review

Review date: 2 October 2026. Repository: `/workspace/intellifin-audit`; branch: `codex/zobba-foundation-batch`; HEAD and baseline: `d38e1daed736415ef13e7606345dac71bd1d9f01`.

**Source-review result: no remaining concrete defect found in P1–P5.** The subsequently requested P14/P15 regression-source review also supports the intended proof. Focused execution receipts supplied after source inspection are reconciled below; this is not independent test execution or final combined repair closure. No builds, tests, service operations, application edits, staging, commits, skills, secrets or raw fixture-environment reads were performed by this reviewer. The only authored file is this report.

The reviewer read AGENTS.md, the frozen Story 21.4 specification/context and root triage; traced the actual current repository implementation against the domain period model, application inspection contract, forced-RLS migration, exact Task actor and methodology owners, and the completed 21.2/21.3 producer contracts. Infrastructure knowledge source and regression hashes were checked again at the end and remained unchanged from their initial inspected hashes.

## P1–P5 source assessment

| Finding | Independent inspection result |
| --- | --- |
| P1 | `infrastructure/src/knowledge.rs:1281–1305` orders Task locks but now selects each accountable actor by the exact scope **and** Task ID. In a same-engagement pair, visiting the source Task cannot overwrite the destination consumer. All calls still use the existing `tasks.accountable_actor`; no operation acceptance or second Task owner was introduced. |
| P2 | `knowledge.rs:444–637` separates durable status from consumer applicability, walks the bounded exact-revision closure, and checks every known knowledge/Guide period against the Task period. Known supporting periods also constrain an explicitly dated root. Unknown original-byte periods remain unknown; acquisition assertions are not promoted to certified dates. `inspect` withholds period-inapplicable records before text matching; `exact` returns authorized historical text with ineligible standing and disabled actions. `verify` compares that fresh standing, so an old Current expectation conflicts, while an exact historical Invalidated observation can be verified without becoming a use grant. Ordinary verification still refuses applicability omissions even with `include_inactive`. Fresh assertions/corrections cannot relabel incompatible exact support, and fresh reuse assesses both Task contexts. |
| P3 | Fresh reuse now assesses the source Task consumer over the full support closure before the destination assessment (`knowledge.rs:1472–1491`). The viewer is checked independently in both assessments. Exact reuse replay uses the same two consumer identities and assessments (`:185–239`, `:1320–1358`). A denied protected projection is withheld while the accepted command facts survive; destination Task-scope loss remains a mandatory refusal outside the projection savepoint. The original receipt is not rewritten and no new reuse write occurs. |
| P4 | `scoped_view` restricts Correct and Reuse to the viewing engagement's actual origin (`knowledge.rs:389–399`). Foreign-origin destination context retains Exclude/Forget, and those routes create Task-specific invalidations rather than rewriting the origin (`:1421–1454`). Exact inspection and refreshed receipt views use the scoped capability calculation. |
| P5 | `view` identifies private preferences and disables their Task-bound Exclude/Forget/Reuse while retaining current owner Undo (`knowledge.rs:374–386`). Released typed preferences use their separate `publication_view`, which disables unsupported Task mutation routes. |

Period ineligibility and historical disclosure were inspected separately. The deliberate exact-history path is not a bypass: it still traverses current viewer/consumer/source authority, exposes non-current standing when a known period cannot support the Task, and advertises no current mutation/use capability. The exact verification API describes this mode as read-only historical inspection. Replays refresh the destination assessment as well as the source view, so a formerly compatible reuse cannot be returned as Current after either relevant Task period ceases to match. These conclusions are source reasoning; period-changing receipt replay has not been independently executed by this reviewer.

## Regression-source assessment

The reviewed regression source is wired into its enclosing integration tests. The infrastructure test file's new helpers are invoked at lines 322–323. The HTTP verification/application helper is invoked at `api/tests/knowledge_http.rs:604`.

- **P1/P3:** `infrastructure/tests/knowledge.rs::reuse_qualifies_both_exact_task_consumers` (`:1963–2225`) creates Tasks through their real owners with different accountable actors, reverses the actual pair to prove both byte-order branches, revokes only the destination actor's independent supporting engagement, and proves the source remains Current. Fresh refusal leaves zero command events; restored authority permits admission; revoked support withholds the exact replay projection; actual destination-scope loss refuses replay; recovery returns the same receipt with one event. Its separate source-consumer case keeps the manager as viewer/destination consumer while only the source Task's auditor loses supporting-source access, covering fresh admission and replay.
- **P2:** `dependency_periods_cannot_be_laundered` (`:2228–2561`) creates known, incompatible, unknown and compatible Task periods through Task admission; constructs a real three-record exact dependency chain with unknown-period intermediate/root records; proves compatible inspection/reuse/verification, incompatible and unknown consumer withholding, historical exact Invalidated standing, rejection of stale Current verification, exact historical verification, withholding for both inactive-query settings, assertion/reuse/correction refusal, unchanged revision after refusal, and preserved unknown source dates. These cases distinguish current use from retained history. The helper does not separately advance an already admitted reuse's Task period and replay that reuse; the implemented replay branch was reviewed directly rather than treating that scenario as executed coverage.
- **P4/P5:** `api/tests/knowledge_http.rs:565–568`, `http_foreign_origin_controls` (`:668–749`), and preference checks (`:962–983`) assert response capabilities through real HTTP reads. The foreign route tests also attempt forbidden correction/republication, exercise both actual destination Exclude and Forget, and read the unchanged Current origin afterward. Private preference checks verify `can_forget=false` and `can_undo=true`.

P14/P15 live in **`crates/api/tests/knowledge_http.rs`**, not the infrastructure file. `http_verification_basis_and_applied_guide` (`:751–949`) supplies the required independent proof structure:

1. It creates a Task and unchanged assertion over real HTTP, records an exact Current view, and verifies the fresh initial pair.
2. An actual Pause through the Task control HTTP owner changes the execution epoch while the test explicitly requires the methodology binding to remain unchanged. The next verification request uses the current binding and only substitutes the old epoch; it requires real `409 knowledge_conflict`. A fresh pair succeeds, and exact record data/standing still equal the original view.
3. It admits a real Guide with new context through Task control HTTP, then inspects and requires Received standing while the old method binding remains current.
4. It invokes the actual `TaskRepository::coordinate` owner with the persisted Task route. The owner rederives the actor/route, applies retained commands, emits applied events, and applies pending methodology; the test requires Idle for the paused Task and a changed method binding. No direct projection/event/binding insertion supplies this transition.
5. The next real verification request uses the **current execution epoch** from the applied page and substitutes only the old binding; it requires `409 knowledge_conflict`. The fresh pair returns `{"verified":true}`, and the original assertion view remains byte-for-byte equivalent as JSON.
6. Exact Guide inspection requires Applied standing and unchanged record ID/revision, actor, scope, text, certainty, period, dependencies and original command/Task/cycle IDs. Exact Guide retry returns the original admission receipt, and the real owner's event stream must contain exactly one matching applied event.

The test therefore independently exercises the two expected-basis guards and both Guide standings through real owners. It is stronger than the prior revocation-only verification test. The initial review made no execution claim; the subsequently supplied focused receipts are reconciled next.

## Focused execution receipt reconciliation

Root subsequently supplied the lead's focused receipts, and this reviewer read their full output and exit files. The source and both regression-file hashes still match the inspected manifest.

| Executed test owner | Receipt | Result | Reconciliation |
| --- | --- | --- | --- |
| `postgres_knowledge_producers_retrieval_authority_and_mutation_contracts` in `crates/infrastructure/tests/knowledge.rs` | `/tmp/zobba-story-21-4/repair-infrastructure.log` and `.exit` | Exit 0; binary reports 3 passed, 0 failed, 0 ignored, 0 filtered; 154.13 seconds | One substantive aggregate contract test invokes the reviewed P1–P3 repair helpers, along with its existing scenarios. The other two reported tests are destructive-database guard tests from shared support. |
| `knowledge_http_producers_mutations_exact_recovery_and_authority_contract` in `crates/api/tests/knowledge_http.rs` | `/tmp/zobba-story-21-4/repair-http.log` and `.exit` | Exit 0; binary reports 3 passed, 0 failed, 0 ignored, 0 filtered; 4.61 seconds | One substantive aggregate real-socket HTTP contract test invokes reviewed P4/P5 capability checks and the P14/P15 independent basis/application helper. The other two are the same named shared-support guard tests in this binary. |

The substantive test entry points require configured database/fixture connections and do not contain an absent-environment early-success path. The logged owners match the reviewed callers. Assertions, scenario helpers and SQL checks are **not separate tests**: the two focused binaries report six passing tests total, comprising two substantive aggregate tests and four guard-test executions. Compilation times shown separately in the logs are not included in the durations above.

These receipts support focused backend repair verification, including the real old-epoch/current-binding, current-epoch/old-binding and Received/Applied cases. They do not establish final combined gates, browser rendering, a complete frozen source manifest, or the additional period-changing receipt replay scenario noted above.

```text
3eded18c2e6e0c444d0a076fe762603cafaef44af9167344bcf3d709b9af7ac9  /tmp/zobba-story-21-4/repair-infrastructure.log
9a271f2a916b0b6ee6cecb2426f0b3206ef074578be55d9bc94f6f3fe3ab86aa  /tmp/zobba-story-21-4/repair-infrastructure.exit
e4a99e549fc7e045d01588684873c26ae676e6c0b1d575dc7b19f044d53e69eb  /tmp/zobba-story-21-4/repair-http.log
9a271f2a916b0b6ee6cecb2426f0b3206ef074578be55d9bc94f6f3fe3ab86aa  /tmp/zobba-story-21-4/repair-http.exit
```

## Inspected SHA-256 manifest

Paths are repository-relative except the final triage path. Some owner files were inspected in relevant sections rather than exhaustively; the hashes identify the exact files from which those sections were read.

```text
517d76b51301a60498b8eb19d79bdeb1915ba807e3d7ce79006970f65da16173  AGENTS.md
01361676b3fe9a9fe99073a95b20438e02494415a8c83aad56ad7d2f29ff8d86  _bmad-output/implementation-artifacts/spec-21-4-remember-scoped-working-knowledge-with-its-basis.md
0a69af8fa6b67774a9b693671792205d1d21765d58bfd3ebc03ba7f3a68aaac9  _bmad-output/implementation-artifacts/story-21-4-knowledge-context.md
8da34d38c00f6c4df581a0ccb3bcbabd35e102ee446be8e619afeda5a256336c  _bmad-output/implementation-artifacts/zobba-foundation-batch/story-21.2/integration-contract.md
3c322576ec4cecf4d2c0531386130b4550a056e7490ac1ba5a9ec729d608f783  _bmad-output/implementation-artifacts/zobba-foundation-batch/story-21.3/integration-contract.md
22eccc53230e94ec52a975220008767eb9a3c60718b50fcd082b68e2f1b2c720  zobba/crates/domain/src/knowledge.rs
0246345401e8c02fcdcee4f3ce37ae10d6968d5a5b4bcc1db8e32a8f940dbc9f  zobba/crates/domain/src/task.rs
c1853eea4fa80dd94782f89f8d3d03e1654bbfa224b41c97af7c791d7a23356c  zobba/crates/domain/src/identity.rs
9e00dcb7f4414c137b687f098a18e2876018817d98d135195fb55cd8fe3736c5  zobba/crates/application/src/knowledge.rs
a3906375bf0d42f8e6b2734b81f46546cdd438536ce94fea87ba89a2a8ab31de  zobba/crates/infrastructure/src/knowledge.rs
f7e997a6f3329d99c8e65919ad2ef616596a707a5f5b94a162800fd82dd29428  zobba/crates/infrastructure/src/scope.rs
09a320a97c1156f54046b726f5eb18a36edb391ce3d67a57d86da735c4f4ceee  zobba/crates/infrastructure/src/methodology.rs
6f81cc6f23b50141bbf80e00bceb35336dc237b08b944e63da9943e801f18219  zobba/crates/infrastructure/src/task.rs
243ba8519afadf46867aab40e98b8e7fa8cc3b66da25d2508f3fae400a8f3707  zobba/migrations/0010_knowledge.sql
9e19b5f6bac184590074232c3b87bad27cb4fe9a63a10cbec1e2b1850e56de34  zobba/crates/api/src/knowledge.rs
fdd351b616b9846974a45da49eace78ec00e57104388a416c46c9f50573b919a  zobba/crates/infrastructure/tests/knowledge.rs
4c766c712b99551293ea308e252e94c9bc1753ff0b2b3adef43d256870bbb0e3  zobba/crates/api/tests/knowledge_http.rs
fee243915aecf37278ec4e959a314a86d35736eb92c23e050df43d8d0b78d8bc  /tmp/zobba-story-21-4/review/root-triage.md
```

Final repair closure is pending the implementation lead's frozen-source executed evidence and root reconciliation. Frontend action rendering and the other triage findings are outside this review's source scope.
