# Capture, grounding and absence, version 1

What an agent Work Item freezes from a page, how a value becomes grounded in it, what an
honest absence needs, and how a human later reads the bytes back (Epic 4, Stories 4.4–4.5,
FR-31, FR-41, AD-2, AD-12). Normative for every producer that captures from a browser.

Read with `structural-snapshot-v1.md` (the extractor and the corroboration rule),
`observation-registration-v1.md` (the one write path) and `evidence-package-v1.md` (the
reservation, the seal and the integrity sweep).

## Purpose

An adapter reads a collection over HTTP and freezes the response bytes. An agent reads a
PAGE, which has no such bytes — so the platform produces its own artifact, freezes it,
re-reads it, and only then may an Observation attribute claim a value. Every value a Run
concludes from must be traceable to a cell in an artifact that is registered, verified and
linked to the permitted action that produced it.

## Vocabulary

| Term | Meaning |
|---|---|
| `web_tree` | The versioned semantic projection of one page. `WEB_TREE_MEDIA_TYPE` = `application/vnd.intellifin.web-tree+json`, `WEB_TREE_SCHEMA_VERSION` = 1 |
| Node | `{group, role, label, value, target}`. `role` ∈ `datum`, `link`, `input`, `button`, `status`. `group` is an opaque producer key shared by nodes of one result row or page |
| Locator | `$.nodes[<index>].value` — `WEB_TREE_COLLECTION` and `WEB_TREE_VALUE_FIELD`. The node's array position is the stable index |
| Completion | `{complete, returned}`. `returned` is the page's DECLARED total, never inferred from the captured node count; generic capture omits `completion` when unknown |
| Capture binding | `run_evidence_capture`: one row per artifact, naming the `tool_action_id` and the `source_location` it came from |
| Absence proof | `ObservationAbsenceProof` = `{queryKeys, emptyResultEvidenceId, extractionComplete}` |

`WEB_TREE_LIMITS`: 4 MiB of bytes, 4096 nodes, `returned` up to 100000, with label, group
and target bounded by `OBSERVATION_LIMITS.text` and value by `OBSERVATION_LIMITS.value`.

## Invariants

1. **A capture freezes exactly one Structural Snapshot and at most one screenshot, both
   from one action.** `freezeAgentCapture` (`agent-capture.ts`) throws unless
   `structural.length === 1`, `screenshots.length <= 1` and every artifact's `location`
   equals the `sourceLocation` it was called with.
2. **A snapshot's media type and parseability are checked before anything is stored.** The
   structural artifact must carry `WEB_TREE_MEDIA_TYPE` and satisfy
   `readStructuralSnapshot`; a screenshot must be `image/png`. Neither is repaired.
3. **The Evidence id is derived from the Tool Action.** `reserveArtifact({runId, kind,
   scope: input.toolActionId, templateId})` — so a redelivered capture of the same action
   re-derives its own reservation and object key rather than minting a second object beside
   the first.
4. **Nothing is uploaded that discloses a credential.** `freezeArtifact`
   (`evidence-package.ts`) calls `guard.discloses(bytes)` FIRST and throws
   `PopulationAcquisitionError('credential')`; the object store is never reached.
5. **What was stored is read back and compared before it is registered.**
   `freezeArtifact` re-reads the object, recomputes SHA-256, and requires the digest and
   the length to match what was sent AND any digest or size a previous attempt registered.
   `freezeAgentCapture` then re-reads the registered snapshot again through
   `readRegisteredArtifact` and scans it a second time; a failure there is
   `Snapshot verification failed`.
6. **Only a typed transport failure may degrade a screenshot.** In `freezeAgentCapture`'s
   `catch`, a non-`screenshot` artifact, a disclosing one, or anything that is not
   `PopulationAcquisitionError` with `code === 'transport'` re-throws. A degraded screenshot
   KEEPS its reservation, so the missing required capture is recorded rather than hidden,
   and `input.budget()` is still called so an exhausted budget still terminates.
7. **An agent Observation requires both capture kinds.** `registerObservations` sets
   `requiredCaptureKinds: ['structural-snapshot','screenshot']` whenever
   `record.captureMethod === 'agent'`, and `registeredCaptureKinds` is computed from rows
   that are `REGISTERED`, linked to the Observation, on the same `registration_id`, and on
   the SAME `step_execution_id` AND `tool_action_id` as the primary snapshot. A gap is
   `required-evidence` / `required-capture-missing`.
8. **A capture binding must name a registered artifact and its own permitted action.**
   `validate_agent_capture_binding` (migration `0034_lethal_romulus.sql`) requires, in one
   Run: `run_evidence.kind IN ('structural-snapshot','screenshot')` and `state='REGISTERED'`,
   `run_tool_action.outcome='performed'` and `capture='PERMITTED'`, `a.target_system =
   e.registration_id`, and `a.destination = NEW.source_location`.
9. **Capture provenance is immutable and freezes with the seal.** The same trigger raises
   on any `UPDATE`; `agent_capture_frozen_after_seal` runs
   `run_evidence_frozen_after_seal` on insert, update and delete.
10. **Identity and every attribute of one Observation are grounded in the SAME snapshot.**
    `hasIdentityGroundingSplit` (`packages/domain/src/runs/observation.ts`) is true when any
    attribute's grounding names a different `evidenceId` from the identity's;
    `registerObservations` refuses the batch with `identity-grounding-split`, and
    `observationChecks` records the same reason on `required-evidence`.
11. **A grounded value is re-read from the frozen bytes; a model never supplies one.**
    `AgentFieldSelection` is `{attributeName, locator}`. `buildFoundAgentObservation`'s
    `ground(...)` resolves the locator with `parseSnapshotLocator` + `readSnapshotCell`,
    requires `node.role === 'datum'`, requires the node to be in the identity's own `group`,
    and requires `cell.label` to equal the label `attributeLabelFor` gives that attribute —
    the Template's declared label, or its VARIANT label (`variantAttributeLabels`, P-1's
    `disabled_time` → `Disabled time`) only when an Evidence Requirement names the attribute —
    which must also be present in the target's frozen `attribute_label_patterns`.
12. **The identity cell must carry the population's own key.** `identityCell.value === key`
    and `identityCell.label === expectedLabel('identity')`, the identity node must be a
    `datum`, and the set of `group`s holding a `datum` with that value must have size 1 —
    "one exact key in a data group, never first-wins across duplicate candidate rows".
    When the target froze a `secondary_key`, exactly one cell in that group must carry it
    and its value must equal the population's own.
13. **A declared field with no single grounded cell stays explicitly ungrounded.** The
    builder appends `{name, originalValue: null, normalizedValue: null, grounding: null,
    corroboration: null}` rather than omitting the attribute or inventing a value, so
    `required-evidence` / `attribute-ungrounded` can still see it.
14. **The compiler's field union is not a capture obligation.** A field is skipped only
    when the Template declares no label for it AND no
    `plan.inputs.evidenceRequirements` entry names it. A variant label counts as declared only
    when a requirement names its attribute, so a default P-1 version never captures
    `disabled_time` and never fails `required-evidence` for want of it (D3, 2026-09-08).
15. **An absence claim needs a page that says it is empty.** `buildAbsentAgentObservation`
    returns `null` unless the snapshot parses as `web_tree` and
    `document.completion?.returned === 0`. It is P-1 only.
16. **The searched values come from the PERFORMED action, not from the expectation.**
    `currentSearchQueryKeys` (`execute-agent-work-item.ts`) reads
    `search.parameters[0].value` — "This is the performed action's value, never a
    reconstruction from the expected employee key. A mistype must remain visible to the
    shared absence judge."
17. **A parameter is bound to its key through the PRE-SEARCH control snapshot.**
    `currentSearchQueryKeys` resolves `search.controlSnapshot ?? search.snapshot` and
    passes it to `searchLookupKey`, which accepts a control node only when `role === 'input'`, `node.target === parameter.name`, the node's
    value is empty or already equals the platform's exact parameter, and the label is the
    Template identity label or the target's frozen `secondary_key`. Exactly one such
    control must match, and exactly one key must result.
18. **Both declared keys must have been searched, each to a complete zero.**
    `planAgentTools` sets `absenceReady` only when the CURRENT snapshot is a complete zero
    and every lookup key is in `zeroByKey`; `searchKeysForEvidence` refuses evidence whose
    parameter matches more than one lookup, whose grounded control is not unique, or whose
    retained `lookupKey` disagrees.
19. **The shared absence judge decides, not the producer.** `judgeAbsence`
    (`observation.ts`) walks `ABSENCE_FAILURES`: a missing or malformed proof, an expected
    key not searched or searched with a different value, an `emptyResultEvidenceId` that is
    not LINKED, one that is not REGISTERED, and `extractionComplete === false`.
20. **Absence provenance is stored beside the Observation, digested, and immutable.**
    `run_observation_absence` (migration `0040_faulty_james_howlett.sql`) holds `proof`,
    `expected_query_keys` and a `digest` pinned to `^[0-9a-f]{64}$`.
    `observationAbsenceDigest` is SHA-256 over the canonical JSON of
    `{schemaVersion: 1, observationId, proof, expectedQueryKeys}`, written key by key. It is
    NOT part of the thirteen-key Observation wire digest.
21. **The absence guard refuses everything except an honest first write.**
    `run_observation_absence_guard` (function replaced by
    `0041_absence_guard_qualification.sql`) raises on `UPDATE`; refuses a `DELETE` while the
    Observation still exists; locks `audit_run FOR UPDATE`; requires a
    `run_observation` row with the same id, the same Run and `found='false'`; and refuses
    the insert when a `run_evidence_package` row already exists — a sealed Run cannot
    acquire retrospective absence provenance. Historical rows are deliberately not
    backfilled.
22. **A registered proof cannot be swapped on redelivery.** `registerObservations`
    recomputes `observationAbsenceDigest` over the STORED metadata and refuses when it
    disagrees, and recomputes it over the OFFERED item and refuses when that disagrees with
    the stored digest.
23. **A partial page can never become an absence.** In the work loop, a snapshot with
    `completion.complete === false` and `returned === 0` produces an absent Observation
    marked `UNINSPECTED` with diagnostic `extraction-incomplete`; with `returned > 0` no
    Observation is built at all and the Work Item is `UNINSPECTED` /
    `extraction-incomplete`. Neither is a finding a human may convert into proof.

## The read-grant inspector path

A person inspecting a grounding never receives an object-store URL and the web never holds
S3 credentials. The request and the capability are two transactions, in two processes.

1. `requestEvidenceReadGrant` (`evidence-read-grant.ts`) writes a `pending`
   `evidence_read_grant` row and enqueues `EVIDENCE_READ_GRANT_QUEUE`
   (`evidence-read-grants`). The row records `run_id`, `evidence_id`, `locator`, `actor_id`,
   `session_id`, `correlation_id`, `requested_at` and `expires_at`.
2. `issueEvidenceReadGrant` runs in the WORKER. It requires the grant to be `pending` and
   unexpired, re-reads the actor's role through `context.authorizationRoles.findRole`
   (`unauthorized`), requires a signer (`storage-unavailable`), re-reads the Evidence and
   requires it to belong to the same Run (`scope-mismatch`), be `REGISTERED`
   (`evidence-not-registered`), have a readable substrate (`unsupported-media-type`) and
   valid metadata (`invalid-evidence-metadata`), and requires the locator to parse or to be
   the reserved `ABSENCE_SNAPSHOT_LOCATOR` (`absence-result`).
3. `S3EvidenceReadSigner.signGet` presigns a `GetObjectCommand` through the official AWS
   SDK presigner — never a hand-rolled SigV4 — for between 1 and 300 seconds, and refuses
   an object key that is empty, over 1024 characters, absolute, or containing an empty,
   `.` or `..` segment.
4. `readSnapshotCellWithGrant` (`apps/web/src/runs/evidence-snapshot-reader.ts`) fetches
   with `redirect: 'error'`, verifies the SHA-256 of the downloaded bytes against
   `capability.digest` (`download-digest-mismatch`, reported through
   `reportIntegrityMismatch`), records the access BEFORE parsing "so an unreadable document
   still has an ID-only access audit", then parses and resolves the cell.
   `ABSENCE_SNAPSHOT_LOCATOR` renders the whole bounded document as inert JSON labelled
   `Captured empty-result page` — "a view of the captured empty-result page, not an
   invented matched-row cell or a second absence judge".

Enforced by the database (migration `0038_evidence_read_grant.sql`):
`evidence_read_grant_window` caps the whole request at 5 minutes;
`evidence_read_grant_completion` pins each status to exactly the columns it may carry;
`evidence_read_grant_binding_guard` requires a `REGISTERED` `structural-snapshot` in the
grant's own Run; `evidence_read_grant_immutable` refuses any change to the request identity
or scope, refuses to change a `denied`/`expired` row at all, and lets an `issued` row move
only to `denied` or `expired` — so a capability is revocable but a refusal is final.

## Failure classification

| Situation | Where | Result |
|---|---|---|
| Wrong artifact count, wrong media type, unparseable snapshot | `freezeAgentCapture` | `Error` → `failureDiagnostic` → `capture-contract-failed`, bounded Work Item retry |
| Bytes disclose a credential | `freezeArtifact` | `PopulationAcquisitionError('credential')` → `capture-contract-failed`; nothing is stored |
| Stored bytes disagree with what was sent or registered | `freezeArtifact` | `PopulationAcquisitionError('integrity')` → `capture-integrity-failed` → `stopRun`, `RUN_FAILED` |
| Screenshot transport failure | `freezeAgentCapture` | Reservation kept, capture continues, `required-evidence` fails, conclusions stay UNEVALUATED |
| Identity or attribute cannot be grounded uniquely | `buildFoundAgentObservation` | `null` → registration is not attempted; the loop treats it as no found selection |
| Grounding split across artifacts | `registerObservations` | `identity-grounding-split` refusal — the whole batch, Work Item and Step Execution roll back |
| Absence proof missing, mismatched, unlinked, unregistered or incomplete | `judgeAbsence` | The `honest-absence` check fails and coverage is not `COVERED` |
| Absence written after sealing, or altered | `run_observation_absence_guard` | `23514` |

## What is deliberately NOT guaranteed

- **`desktop_tree` is refused by name.** `IMPLEMENTED_SNAPSHOT_SUBSTRATES` is now
  `['web_tree','sheet','json']` — `web_tree` IS re-read, and `readSnapshotCell` resolves a
  `$.nodes[<i>].value` locator against it, so `structural-snapshot-v1.md`'s note that
  `web_tree` is unimplemented is superseded by this build. `snapshotSubstrateForMediaType`
  returns `null` for `desktop_tree`, and an unrecognised media type is `null` too, which
  makes the corroboration unavailable rather than matched.
- **A screenshot is never read.** It is registered, digested and required; nothing in this
  build extracts a value from a PNG, and no locator addresses one.
- **`completion` is the page's own declaration.** The platform does not count rows to
  contradict it; a Target System that declares a false `complete` is believed, and that is
  why absence additionally requires both declared keys and a linked, registered empty
  result.
- **An absence proof is not backfilled.** An Observation registered by an earlier build has
  no `run_observation_absence` row, and the trigger forbids adding one.
- **The inspector proves the bytes, not the page.** A digest match says the artifact is what
  was registered; it says nothing about whether the page was what the Target System would
  serve now.

## Where it is enforced

| Behaviour | Location |
|---|---|
| One capture, both kinds, verify-after-store | `packages/application/src/runs/agent-capture.ts` — `freezeAgentCapture` |
| Store, re-read, digest and size comparison | `packages/application/src/runs/evidence-package.ts` — `freezeArtifact`, `readRegisteredArtifact`, `verifyRegisteredArtifact`, `reserveArtifact`, `registerEvidence` |
| The substrate, locator grammar and cell read | `packages/domain/src/runs/web-tree.ts`, `packages/domain/src/runs/structural-snapshot.ts` — `readStructuralSnapshot`, `parseSnapshotLocator`, `readSnapshotCell`, `snapshotSubstrateForMediaType` |
| Grounding, identity uniqueness, ungrounded fields | `packages/application/src/runs/agent-observation.ts` — `buildFoundAgentObservation`, `buildAbsentAgentObservation` |
| Same-snapshot grounding rule | `packages/domain/src/runs/observation.ts` — `hasIdentityGroundingSplit`; `packages/application/src/runs/register-observations.ts` |
| Required capture kinds | `register-observations.ts` (`requiredCaptureKinds`/`registeredCaptureKinds`) and `observation.ts` — `observationChecks` |
| Absence judge and proof shape | `packages/domain/src/runs/observation.ts` — `judgeAbsence`, `isObservationAbsenceProof`, `ABSENCE_FAILURES` |
| Absence digest and redelivery comparison | `register-observations.ts` — `observationAbsenceDigest` |
| Searched values and control provenance | `packages/application/src/runs/execute-agent-work-item.ts` — `currentSearchQueryKeys`, `searchLookupKey`; `agent-tool-planner.ts` — `searchKeysForEvidence`, `completeZero` |
| Evidence kinds | `packages/infrastructure/drizzle/0033_ancient_karen_page.sql` — `run_evidence_kind` |
| Capture binding, immutability, seal freeze | `0034_lethal_romulus.sql` — `run_evidence_capture`, `validate_agent_capture_binding`, `agent_capture_frozen_after_seal` |
| Absence storage and its guard | `0040_faulty_james_howlett.sql`, `0041_absence_guard_qualification.sql` |
| Read grants | `0038_evidence_read_grant.sql`; `packages/application/src/runs/evidence-read-grant.ts`; `packages/infrastructure/src/evidence/s3-evidence-read-signer.ts`; `apps/web/src/runs/evidence-snapshot-reader.ts` — `readSnapshotCellWithGrant` |
