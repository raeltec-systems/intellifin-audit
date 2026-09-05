# Population acquisition contract, schema 1

This is the normative contract for the `acquire-population` Session Step. It applies to
the frozen Population Source contract in the executable plan and the independently
published declaration that accompanies the acquired snapshot. A worker consumes the
stored plan and this contract; it never derives a new plan, reads expectations, or treats
a response's self-reported row count as the independent declaration.

## Snapshot identity and declaration

The acquisition keeps two identities:

1. `rawDigest` is SHA-256, lower-case hexadecimal, over the exact bytes fetched from the
   source. For a JSON API this includes the response's exact UTF-8 bytes, including its
   envelope and metadata. For a file it is the exact served file bytes. These bytes are
   preserved as immutable Evidence before parsed rows are registered.
2. `declaration.sha256` is the independently produced declaration digest. For an API it
   is a digest of the deterministic rows projection below. For a CSV file it is the
   cover sheet's digest of the exact file bytes. The two digests are intentionally
   separate and must never be substituted for each other.

The normalized v1 declaration has this shape. Unsupported versions or missing required
metadata fail reconciliation safely.

```json
{
  "schema_version": 1,
  "representation": "population-rows-v1",
  "source": "accessgate-accounts",
  "generation": "2026-09-01.1",
  "generated_at": "2026-09-01T00:00:00Z",
  "effective_period": { "from": "2026-08-01", "to": "2026-08-31" },
  "schema": ["account_id", "employee_id", "username", "status", "roles", "disabled_time"],
  "count": 12,
  "sha256": "<64 lower-case hex characters>",
  "complete": true
}
```

`source` is the stable source identifier, not a mutable display name. `generation` is an
opaque source version and is never parsed as a timestamp. `generated_at` is an explicit
UTC instant and is never inferred from `generation`. `schema` is ordered and must match
the frozen `declared_schema` exactly. `count` is generated independently of the Audit
Runner. Northstar keeps a legacy `declared_count` alias in its synthetic count endpoint
for existing fixture pages; v1 consumers use `count`.

An API collection response repeats `source`, `generation`, `generated_at`,
`effective_period`, `schema_version`, `representation`, `schema`, and `complete`. Its
row array is keyed by the endpoint contract (`accounts`, `transactions`, `employees`,
or `approvals`). `returned` is a transport diagnostic only; it is never an expected
count. `complete` must be true and no continuation, next-page, or unconsumed-page
marker may be present. A declaration and the response metadata must agree exactly.

The v1 API envelope is closed: allowed keys are `synthetic`, `title`, `schema_version`,
`representation`, `source`, `generation`, `generated_at`, `effective_period`, `schema`,
`complete`, `returned`, `declared_count_endpoint`, `count`, `sha256`, and the four
collection names above (exactly one collection is required). Unknown top-level keys,
including nested pagination containers or null continuation markers, fail completeness.
Response version, representation and ordered schema have their own `response-contract`
check. Extending this envelope requires an explicit contract change.

The source effective period must contain the Run period:

```text
declaration.effective_period.from <= run.period.from
and declaration.effective_period.to >= run.period.to
```

The declaration is fresh when its UTC `generated_at` is no earlier than the inclusive
Run period end and no later than Run initiation. An invalid or future/unknown timestamp
is a failed freshness check. The complete extraction, source, generation, ordered
schema, effective period, and declaration digest checks are recorded separately.

## API rows digest: `population-rows-v1`

The producer forms the digest input from the rows that the frozen API location binds.
It applies no trimming, case folding, date conversion, decimal conversion, field
renaming, deduplication, or expectation-driven filtering. AccessGate's bound
`?status=Active` location therefore hashes only its Active rows; an unfiltered response
is a different extraction and fails reconciliation against that declaration.

Northstar orders every collection by its declared primary key using ascending string
comparison. Sorting is stable: duplicate keys retain their source order. The producer
uses that same order. The digest input is exactly this JSON value:

```json
{"schema_version":1,"rows":[<ordered original row objects>]}
```

The bytes are canonical UTF-8 JSON: object keys are sorted by UTF-16 code units at every
object level, arrays retain order, strings retain their original values, numbers are
finite JSON numbers, booleans and null retain their JSON values, and there is no
insignificant whitespace. The SHA-256 is over those bytes and is rendered as lower-case
hex. `schema_version` is the JSON number `1`; it is part of the hashed projection. The
metadata envelope, `returned` value, count endpoint response, and raw response bytes are
outside this projection. A change to this representation requires
`representation: "population-rows-v2"` and a reviewed contract version.

## File declaration normalization

The existing Northstar CSV cover sheets remain signed fixtures. Their file bytes and
`content_digest.value` stay unchanged, including the deliberate truncated cover. A file
adapter maps the legacy names to v1 without changing the bytes:

| Cover field | v1 field |
| --- | --- |
| `source` | `source` |
| `generation` | `generation` |
| `generated_at` | `generated_at` |
| `effective_period` | `effective_period` |
| `declared_schema` | `schema` |
| `row_count` | `count` |
| `content_digest.value` | `sha256` |
| `complete` | `complete` |

The file representation is `csv-raw-v1`. A missing `generated_at` or `complete` is a
declaration failure; generation identifiers must not be converted into guessed dates.
The cover signature is checked independently of the file digest. A cover may declare a
full count and digest over a file that is short; preserve that Evidence and record the
count and digest failures rather than repairing the cover or replacing the file.
The supported signature convention is Northstar's published `synthetic-hmac-sha256`
key and key identifier; it detects fixture inconsistency, not a malicious producer.
It is not production authentication. Missing/unknown signatures and digest algorithms
other than `sha256` are refused, including a correctly signed unsupported algorithm.
The synthetic AccessGate CSV writes its `roles` array as RFC 4180 quoted JSON text; the
CSV parser preserves that cell as the source string. It is a file representation detail,
not permission to reinterpret or expand roles during population acquisition.

## Parsing and row preservation

The v1 parser accepts only UTF-8 `text/csv` (with an optional `charset=utf-8`) and
`application/json` (with an optional `charset=utf-8`). UTF-8 decoding is strict: a BOM,
NUL, invalid sequence, or unsupported media type fails the parse check. Redirects are
refused before consuming a body; an over-limit stream aborts acquisition rather than
retaining an unbounded response. CSV uses RFC 4180 quoting, comma separators, and LF or CRLF record endings.
The Northstar fixture's first comment line carries the synthetic marker and its second
line is the header; the header order must equal the frozen schema. Duplicate, blank, or
unexpected headers and rows with the wrong field count fail. JSON must contain one
supported collection key and an array of objects; malformed JSON, multiple collection
keys, scalar rows, and continuation markers fail. Bytes are retained even when parsing
fails.

The HTTP adapter requests identity transfer encoding. If Fetch decodes gzip, deflate
or Brotli, Evidence contains those decoded representation bytes, not compressed wire
bytes; compressed Content-Length is therefore not compared with decoded length.
Decoded primary data is limited to 16 MiB and independent declarations to 1 MiB.
Unsupported/missing media types still preserve a successfully fetched bounded body and
fail parsing. An unavailable or malformed declaration yields Inconclusive with that
body preserved; it does not refetch the primary source. Primary transport failures use
the frozen initial attempt plus three retries. A declaration with invalid JSON string
content (NUL or an unpaired surrogate) is retained as an escaped JSON string in the
acquisition envelope while the normalized declaration becomes null and fails checks.

Rows keep their source order, exact strings, original JSON values, and one-based ordinal.
Duplicate primary keys remain separate rows. The parser neither reads nor imports
`fixtures/northstar/expectations/`.

## Inclusion and reconciliation

The worker reconciles declaration count, declaration digest, source/generation/schema,
effective period, freshness, complete extraction, and parser status before it can mark
the population ready. Every parsed row is evaluated against every frozen inclusion
predicate. If any required value is missing or invalid, the row is `indeterminate` with
an explicit diagnostic even when another predicate is false. Otherwise a false
predicate produces `excluded` with its named reason; a row satisfying all predicates is
`included`.

The invariant is:

```text
rows_in = included + excluded + indeterminate
```

`indeterminate > 0`, a failed declaration check, a count or digest mismatch, incomplete
pagination, a schema mismatch, or a failed parse prevents `POPULATION_READY` and maps
to the safe Inconclusive outcome. A complete zero included population is allowed only by
the frozen `zeroRecordPass` flag after every other check passes.

## Evidence, checkpoint, and restart

External HTTP or object I/O occurs outside the database transaction. Before uploading,
the worker reserves a stable Evidence key derived from the Run and source snapshot. It
uses a conditional write, reconciles an existing object instead of overwriting it, and
verifies stored size and `rawDigest` before registration. The raw response and the
declaration are retained together; a newly fetched declaration is never paired with old
bytes.

The transactional commit registers the verified raw Evidence identity, parsed rows and
checks, the Session Step state, the `POPULATION_READY` checkpoint when all checks pass,
and its Timeline event. A checkpoint records the frozen plan/source identity, Run period,
raw digest, size, attempt number, and revisioned claim. A restart resumes or rechecks
that claim under the frozen retry and time limits. A stale claim cannot commit effects;
repeated jobs cannot create duplicate rows or Evidence. A damaged existing object is a
terminal integrity failure. Secrets, credentials, raw source bodies, and object URLs do
not enter queue errors or logs.

The overall execution deadline starts with the first population claim, persists through
restart, bounds external I/O and is rechecked before the completion transaction commits.
Each Timeline check records its own success/failure independently of the Run's outcome.
Recovery isolates individual Run failures and, during shutdown, waits only for its active
bounded handler instead of starting the remaining selected batch.

Redelivery of a population-ready job verifies both registered raw and acquisition-envelope
digests before acknowledging it. Integrity failure terminates the Run without overwriting
objects or duplicating rows. This is a resume check, not continuous object-store monitoring;
terminal Runs are not reopened. Later stages must verify Evidence when consuming it.
A transport failure during this recheck consumes a durable attempt and enters recoverable
RETRY state. A leased retry verifies the registered objects without inserting rows again;
the same total attempt and execution limits apply. A healthy duplicate acknowledgment
does not consume another attempt or emit duplicate completion events.
