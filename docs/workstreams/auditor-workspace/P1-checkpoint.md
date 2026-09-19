# Auditor Workspace — P1 record review checkpoint

Status: implementation in progress; not accepted for release. P2–P6 and the full
co-working experience remain outstanding. No merge or deployment is authorized.

## Delivered implementation

- A source-row projection joins exact frozen target/work-item relationships to recorded
  observations, checks, evidence and effective human review decisions. Duplicate source
  identities remain separate unresolved rows. Unknown historical relationships do not
  become zero exceptions or inspected coverage.
- Separate measures cover source rows, included/excluded/indeterminate rows, fully
  inspected subjects, required/inspected target units, exception records, pending
  assessments and evidence problems. Filters preserve the original denominator.
- Review pages contain 25 or 50 rows. Ten-minute immutable snapshots bind signed cursors
  to the actor, Run, role, normalized query and page size. Execution progress marks newer
  data available without invalidating the current page. Every read checks current access.
- Selected-record facts use a new short consistent database read, carry their own time,
  and show when they differ from the list. Evidence bytes use existing protected reads;
  no provider or object-store capabilities are exposed by this projection.
- Snapshot storage is capped at two versions per actor/Run and 10,000 source rows or
  source/target projection units. A worker sweep removes expired copies. This bounds the
  presentation cache; it does not remove original audit or evidence history.
- The ordinary Evidence route is being converted to a record queue and focused inspector.
  Existing artifact diagnostics remain reachable from technical details. Assessment
  confirmation continues to use the existing independently authorized review commands.

## Verification receipts

| Candidate | Verification | Result |
|---|---|---|
| `196f423` | P0 normal CI, six jobs; selected live two-workspace isolation | Passed; see P0 checkpoint for exact evidence and limits |
| `94bd2bd` | Pinned CI typechecks, dependency boundaries and unit suite | Passed |
| `94bd2bd` | Container builds, unavailable-database startup refusal and worker browser launch | Passed |
| `94bd2bd` | PostgreSQL 18 migration and generated-schema drift check | Passed |
| `94bd2bd` | Record-review integration fixture | Failed before tests: work item referenced evidence inserted later |
| `94bd2bd` | Exact schema inventory | Failed: expected table list omitted the two new review-cache tables |
| Working changes | Package/web/worker/root-test typechecks; eight schema/evidence unit tests | Passed locally; local runtime differs from the repository pin |

The fixture and inventory failures are being corrected without weakening constraints.
The first CI run did not execute the new projection assertions and produced no query-plan
artifact. It therefore does not resolve G6. PostgreSQL integration, actual browser
interaction, persisted reload/revocation behavior, and retained UI evidence must pass on
the final P1 candidate before acceptance.

The composed UI candidate `2f1b044` exposed three further implementation defects in
normal CI: the filter form violated the POST-first guard, Next.js refused a re-exported
route configuration, and raw SQL expiry parameters used JavaScript Date objects rather
than encoded timestamps. These are corrected in the next candidate. Of the new SQL
tests, only production `EXPLAIN ANALYZE` passed on that candidate; 15 paging/selection
tests failed and are not accepted. All 47 pre-existing integration files passed.
The actual plan is retained in run `35445808397`, artifact `10584764673`, SHA256
`f59f39203302535d29c95932567ae9c4b5fb56e23f751786e2cdf6934356e720`.

## Remaining proof and decisions

G6 remains open pending real SQL plans, paging/concurrency/count results and browser
verification. G1 still needs actual target legibility and the five-auditor moderated
study. G2 strategy capabilities, G3 preview/private input, G4 data-governance approval,
G5 runtime races/recovery and G7 measured capacity remain open at their specified stages.

Development continues against the full target release. Action-linked captures are not
near-live preview, and record review alone is not conversational co-working. D2 sensitive
data policy and D3 proposed control-transfer authority remain explicit decisions before
their respective production boundaries; neither blocks synthetic P1 development.
