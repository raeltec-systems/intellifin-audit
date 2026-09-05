# Adapter extraction and Reference Source contract, schema 1

This is the normative contract for the execution stage that runs after
[population acquisition v1](population-acquisition-v1.md): the acquisition of every
Reference Source as a Session Step, and one adapter Work Item per adapter-acquired Target
System. It interprets the plan `packages/domain/src/procedures/executable-plan.ts` already
froze. A worker consumes the stored plan and this contract; it never derives a new plan,
never consults a current registration, and never reads
`fixtures/northstar/expectations/` (AD-12).

## Classification: which frozen step is which

The plan carries one `extract-adapter` Session Step per non-agent-driven Target System, in
authored order, and `inputs.targets[].contract.kind` beside it. That is the whole input:

| Frozen `contract.kind` | What it is | Work Items |
| --- | --- | --- |
| `versioned-file` | a **Reference Source** — consulted by the evaluator, not observed | none |
| `api` | an **adapter-acquired Target System** | exactly one |
| `web`, `desktop` | agent-driven; a later epic | the stage refuses the plan |

Reference Sources are acquired **before any Work Item**, in authored order. Work Items then
run **sequentially**, also in authored order. A Work Item that has run cannot be run again
by a resume; a Work Item that failed does not stop the ones after it.

No action kind is added or renamed and `semantics()` does not move, so every ACTIVE version
stays executable and its canonical plan bytes are unchanged. This is interpreter semantics
over bytes that are already frozen.

An agent-driven Target System is refused rather than skipped. Skipping one would leave a
Run concluding about a Target System nothing read. In practice such a plan never reaches
this stage: its first Session Step is `create-workspace`, which population acquisition
already refuses.

## Extraction location

The frozen `allowed_origins` decide, and nothing else. The first origin of the frozen
six-key contract is the location. Two shapes are supported, both already in use:

1. The origin **is** the artifact or the collection —
   `http://host/files/role-matrix.csv`, `http://host/accessgate/accounts`.
2. The origin answers the **read-only service index**, whose closed shape is exactly
   `{service, synthetic, access: "read-only", endpoints[]}`. The adapter then follows
   **one** entry, and only to a location inside the same frozen origin, matched on a path
   boundary (`/accessgate-other` is outside `/accessgate`). A second index is refused, as
   is an entry that leaves the origin. This is what lets a registration written for the
   Story 1.8 probe be extracted from without a path being guessed.

Requests are `GET` with `redirect: 'error'`, bounded by the frozen `stepTimeoutSeconds`,
the claim's lease and the Run deadline, and capped at 16 MiB of decoded bytes. A
link-local, unspecified or credential-bearing origin is refused before a request is made,
because the response would be frozen into Evidence and the chain is immutable.

## Credentials

An adapter-acquired Target System's credential is resolved **just in time**, for one
request, through `CredentialResolver`. `CredentialProvider.describe` — which proves a
reference read-only at registration time — is a different port and is not widened.

`ResolvedCredential` has no field holding the value: the token lives in the resolver's
closure and `authorize(headers)` is the only way out of it. It therefore cannot appear in
a checkpoint, an audit payload, a Timeline event, a queue job, a log field, an Evidence
artifact or an error message, because there is nowhere in any of those for it to be put.

The resolver **echoes the reference it was asked about** and the caller compares it. A
service that batched, cached by a normalized key or resolved an alias could otherwise
prove a different credential.

The retrieval is audited **by reference and never by value**: the audit chain refuses a
`credentialRef` payload key outright (`FORBIDDEN_PAYLOAD_KEYS`), so the event names the
Target System whose frozen `credentialReferences` entry was used, and the reference itself
stays in the plan the event's Run already points at.

`CREDENTIAL_TOKENS` is the manifest, and it is the worker's alone. Two keys that trim to
one reference refuse the whole manifest — an ambiguous declaration has declared nothing —
and an empty manifest disables extraction with a named log line rather than failing every
Work Item with a diagnostic that reads like a Target System problem.

## Evidence

Every acquired artifact is frozen with the Story 3.2 sequence, over the exact served bytes:

1. **reserve** a stable key derived from the Run and the frozen step id
   (`reference/<run-id>/<step-id>`, `extraction/<run-id>/<step-id>`) and write the Evidence
   row `RESERVED`, in the same transaction as the unit's state and its audit event;
2. **upload** conditionally — an object already there is reconciled, never overwritten;
3. **verify** the stored bytes by reading them back and comparing length and SHA-256;
4. **register** the digest, size and media type, `REGISTERED`, in one guarded transaction
   with the unit's state, its Step Execution, its Observations and its Timeline event.

An adapter extraction is frozen BEFORE it is parsed. A response that is not a declared
collection is still what the Target System answered, and an Inconclusive Run keeps its
partial Evidence; only a reservation nothing was ever written to is abandoned.

A resumed Run re-verifies every artifact it already registered, and an attempt that
resumes inherits the digest a previous one registered, so newly fetched bytes are
compared against what was already frozen rather than quietly accepted. Stored bytes that
no longer match their registered digest are a terminal integrity failure; the bytes are
never replaced.

The Reference Source is frozen as the bytes actually served, with no re-serialization. For
Northstar's RoleMatrix that matters: the CSV carries a leading `entry` ordinal so two
conflicting policy entries for one role stay distinguishable. A flattened `role,permission`
file would union `AMBIGUOUS_DUAL` into a permission set containing a prohibited pair, which
inverts the golden case that must be Unevaluated into an Exception. A boundary an artifact
never had cannot be recovered downstream.

## Observations

One Observation per **distinct included population record key** per adapter Work Item, in
the §B.1 wire schema (`packages/domain/src/runs/observation.ts`). A repeated key produces
one Observation and is counted as `duplicate-record-keys:N` on the Work Item — the row is
unique on `(work_item_id, population_record_key)`, so a second insert would be dropped and
the reported count would disagree with the stored one. The duplicate remains an Evidence
Quality Gate event. The join is the Template's frozen lookup
column — compiler 1's `PLAN_LOOKUP_COLUMNS`, read from that table and not copied — compared
as an **exact opaque string**: no trimming, case folding, numeric parsing or alias
inference.

| Matches in the extraction | `found` | `identity` | Attributes |
| --- | --- | --- | --- |
| exactly one | `true` | the lookup column, grounded | every declared field the row provides, grounded |
| none | `false` | none | none |
| more than one | `ambiguous` | none | none |

`captureMethod` is `adapter` and `matchOrigin` is `platform`. `grounding` is
`{evidence_id, locator, label, extracted_text}`, where the locator is a path into the frozen
extraction (`$.<collection>[<index>].<field>`) that Story 3.6 re-reads from the stored
bytes. `corroboration` is `null` until the Evidence Quality Gate sets it.

Only a `time` value is normalized, to UTC, with the original retained beside it. Every other
`normalizedValue` is the original: compiler 1 authorizes no lossy or equivalence-expanding
transformation.

A record whose lookup value is missing or not a string produces **no** Observation and is
counted in the Work Item's diagnostic. Inventing a key would fabricate coverage; the
coverage check then sees fewer Observations than included records, which is the safe
direction.

How those Observations are WRITTEN — the batch as one transaction, the digest over each
wire record, the `found = false` completeness rules, the coverage state and the
per-Observation Gate checks — is
[observation registration v1](observation-registration-v1.md), which this stage calls
rather than writing rows itself. One relevant consequence lands here: an extraction is
provably COMPLETE only when its response declares itself `complete`, reports a row count
equal to the rows it carries, and holds no envelope key outside the closed set. An
extraction that is not provably complete cannot prove an absence, so every `found = false`
it produced is `UNINSPECTED`.

What this contract does **not** decide: corroboration against a Structural Snapshot (3.6),
condition evaluation and Exceptions (3.7), the Run-level Gate (3.8) or Result sealing
(3.9).

## Limits, failure and resume

The frozen `retriesPerStep`, `stepTimeoutSeconds` and `runTimeoutSeconds` bound everything.
The Run deadline starts with the **first population claim** and persists through restart;
this stage inherits it rather than starting a second clock.

- A **Session Step** — a Reference Source acquisition — that fails after its bounded
  retries is `RUN_FAILED` (addendum §E).
- A **Work Item** gets its bounded cycle and then, per the owner's 2026-09-05 decision, one
  automatic additional cycle. The second exhaustion marks it `FAILED` with a diagnostic; the
  Run stays `RUNNING`, the remaining Work Items still execute, and incomplete coverage
  becomes `INCONCLUSIVE` at the Run-level Gate. There is no human retry-or-skip Escalation
  on this path.
- Exhausting the Run time limit is `INCONCLUSIVE` with partial Evidence preserved.
- An unresolvable credential fails its Work Item immediately: retrying a reference nobody
  declared eight times against a live system proves nothing.

Diagnostics are a closed vocabulary of constants. An error message, a URL, a response body
or a credential never becomes one.

Claims are revisioned and leased. Every commit is guarded by the claim's revision, so a
worker whose lease expired writes nothing. Observations are keyed uniquely by
`(work_item_id, population_record_key)`, so a redelivered job cannot create a second one.
