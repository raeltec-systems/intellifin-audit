# Replay asset set v1

**Status:** normative. Story 5.2 (FR-30, AD-5, AD-9, AD-17, addendum §F).

Replay must work with the Workspace Provider **unreachable**. This document names every
asset a terminal Run is replayed from, says where each one lives, and states the rules that
keep the set honest. Story 5.8 renders it; nothing here depends on that.

## The rule that shapes everything else

**A live frame is a Replay asset the moment it is registered** (AD-17). There is exactly
one capture path, and Live View and Replay read the same rows. A second path would give the
two surfaces two answers about one session, and the second answer would be the one nobody
checked.

So Story 5.2 adds **no capture mechanism**. What it adds is the `role` that says what an
artifact is FOR, the event that says when the set is not whole, and the copy of the
provider's own recording so that nothing about a terminal Run depends on the provider.

## What an asset is

| Replay asset | Table | Columns |
|---|---|---|
| Frame | `run_evidence` | `evidence_id`, `run_id`, `kind`, `object_key`, `media_type`, `digest`, `size`, `state`, `role`, `captured_at`, `capture_method` |
| Frame binding | `run_evidence_capture` | `evidence_id`, `run_id`, `tool_action_id`, `source_location` |
| Sanitized action | `run_tool_action` | `tool_action_id`, `run_id`, `step_execution_id`, `work_item_id`, `surface`, `target_system`, `action`, `method`, `destination`, `parameters`, `outcome`, `denial`, `status`, `redirected`, `downloads`, `started_at`, `completed_at`, `capture`, `capture_suppression` |
| Session Step | `run_session_step` | `run_id`, `step_id`, `ordinal`, `registration_id`, `display_name`, `action`, `state`, `attempts`, `diagnostic`, `evidence_id` |
| Step Execution | `run_step_execution` | `step_execution_id`, `run_id`, `plan_step_id`, `work_item_id`, `action`, `state`, `attempt`, `started_at` |
| Escalation | `run_wait` | `wait_id`, `run_id`, `kind`, `options`, `deadline`, `closed_at`, `closure_kind`, `answer_option_id`, `actor` |
| Observation delta | `audit_events` | `aggregate_id`, `sequence`, `event_type`, `occurred_at`, `outcome`, `payload` |
| Session recording | `run_replay_recording` | `run_id`, `workspace_id`, `object_key`, `media_type`, `digest`, `size`, `state`, `copied_at`, `diagnostic` |

`tests/unit/replay-asset-set.test.ts` reads this table off disk and requires every column
named here to exist on the schema. A contract asserted against a copy of itself proves only
that it equals itself, and a renamed column that silently breaks Replay is exactly the
defect this catches.

Two fields are deliberately NOT in a table of their own:

- **An Escalation's question** is the matching model turn's bounded uncertainty rationale,
  and `run_wait` never stores it (`waits.ts`: "The question itself is never persisted
  here"). It is agent-generated text, so it reaches a surface through `UntrustedText` and
  never as the platform's prose. Replay reads it where Run Detail already does.
- **A Session Step's outcome** is its `state` plus its `diagnostic`. A separate outcome
  column would be a second answer to one question.

## Roles: what an artifact is FOR

`EVIDENCE_ARTIFACT_ROLES` is `evidence` and `replay`.

- `evidence` — what a Run **concluded from**. Its absence can make a package INCOMPLETE.
- `replay` — what a Run is **watched by**. Its absence degrades a Replay and can never make
  a package INCOMPLETE.

The distinction is a role and not a kind, because the same kind sits on both sides. The
screenshot an Observation is grounded in is Evidence; the session recording is not. A
naming convention would be one anybody could satisfy by typing.

**A screenshot bound to a Tool Action keeps `role = 'evidence'`, and is still a frame.**
That is deliberate and is the one judgement call in this contract. The artifact serves both
purposes: `required-evidence` reads it per Observation, and Live View and Replay render it.
Demoting it to `replay` for the sake of the label would take it out of the seal's reach and
out of `required-evidence`'s, weakening an audit to tidy a name. The role says what an
artifact is FOR when the two purposes differ; where they coincide, the stronger one wins.

One rule, stated three times, in the order this codebase always uses:

1. `reserveArtifact` forces `required: false` on a `replay` reservation — a producer cannot
   ask for the contradiction.
2. `sealPackageDecision` filters `required && role === 'evidence'` — a wrongly set flag, or
   a row an older build wrote, cannot make a package INCOMPLETE.
3. `run_evidence_replay_never_required` refuses to hold such a row at all.

## When the set is not whole: `failure.frame-missing`

A Tool Action owes Replay a frame when all three are true, and the predicate is three
stored facts and one absence:

- its `outcome` is `performed` — a denied or failed action never reached a page, so no
  frame was ever owed;
- its `capture` is `PERMITTED`;
- no `screenshot` artifact is `REGISTERED` against its `run_evidence_capture` binding.

**A credential-entry action is excluded by that predicate**, not by a rule the reader
remembers to apply. Its `capture` is `SUPPRESSED` (generation 29), which the platform
derived from its own request before the port was reached. Suppression and absence are
different statements — one says the platform refused to capture while a credential was on
the wire, the other says a capture that was meant to happen did not — and reporting the
first as the second would raise a finding against the guarantee that produced it.

`completeRun` appends **one** `failure.frame-missing` event per Run, carrying the exact
total and a bounded sample of at most `MISSING_FRAME_SAMPLE_LIMIT` actions. One event per
missing frame would put an unbounded number of rows into an immutable chain for exactly the
Run whose capture was misconfigured. The payload carries identities, counts and completion
times only: a destination is already on the `run_tool_action` row it names, and repeating it
here would put a second copy into a chain that can never be edited.

**The seal is never blocked**, and that is a property of WHERE the read sits rather than a
rule this code remembers: `readMissingFrames` runs after `sealPackage` has already returned
its decision. The count is also published on the Result (`publication.evidence.framesMissing`),
because "flagged on Replay and export" needs a fact the Result document carries — an export
reader holds the document and not the chain. It is never folded into `missingRequired`.

An older Result document has no `framesMissing` key at all. That is "this build did not
record it" and not "none were missing", and a surface says which rather than rendering a
zero — the same rule the `artifacts` key follows.

## The session recording

`SOLARI_RECORDING` must be **on at session creation** or the provider has no recording, for
ever: there is no way to enable one later (`agent-workspace-v1.md`). It is off by default,
matching the provider, because recording is metered and turning one on is a cost decision a
build must not take for a deployment.

When it is on, the terminal release copies the recording into platform storage:

1. `releaseWorkspace` releases the provider session with `releaseAndWait`.
2. The recording becomes available ~1–3 s later (`@solarisdk/browser@0.1.3`).
3. `downloadRecording` fetches it as NDJSON bytes, bounded by `RECORDING_COPY_TIMEOUT_MS`.
4. It is scanned, uploaded, and verified by size and digest through **`freezeArtifact`** —
   the same implementation every Evidence artifact uses, so "stored and verified" means one
   thing in this product and not two.
5. It is written to `run_replay_recording` and a `lifecycle.replay-recording-copied` event
   says what Replay will have.

After that, **Replay never depends on the provider**. The copy is best-effort by design: a
provider that cannot serve the recording must not stop a Run from releasing its workspace
or from concluding, so a failure is recorded and the release proceeds.

### Why it is not a `run_evidence` row

The copy happens at the terminal release, which is **after** `completeRun` has already
sealed the Evidence package. Generation 21 freezes a sealed Run's Evidence, so an Evidence
row written here would either be refused outright or would sit outside the seal that names
what this Run froze — and the second is worse than the first, because the Result would
publish an artifact list that did not include it, stating something untrue about itself.

The recording is not something the Run concluded from. `run_evidence.role` says what an
artifact INSIDE the package is for; `run_replay_recording` is where the replay-role
artifact that arrives after the seal lives. It cascades from `audit_run`, like
`run_workspace`, because it records no audit outcome.

### The credential wall applies here hardest of all

A session recording is a transcript of a browser, and a sign-in **types** a credential into
a form field. It is therefore the artifact most likely of all to carry one, and the copy
takes a `CredentialResolver` as a REQUIRED dependency for exactly that reason: passing
`NO_CREDENTIALS` here would be a scan for nothing dressed as a scan.

The guard is built from the credential references the **frozen plan** names. A plan that
names references of which NOT ONE resolves is refused (`recording-unscannable`) rather than
treated as clean — fail closed, because an unscanned recording is precisely what the wall
exists to stop. A plan that names none has nothing to disclose and is copied normally.

A disclosure is a REFUSAL and never a redaction (`recording-credential-disclosed`), and
nothing is stored: the scan runs before the upload, so "nothing is stored" is literally
true rather than nearly true.

### Why there is no recording, in words

`REPLAY_RECORDING_DIAGNOSTICS` is closed, and never a provider error message — a message is
where an endpoint, a session id or a signed URL rides into durable storage.

| Diagnostic | What happened |
|---|---|
| `recording-not-enabled` | The deployment records nothing: the local mode, or `SOLARI_RECORDING` off. The ordinary case. |
| `recording-unavailable` | The provider has one and would not serve it, or could not be reached. |
| `recording-integrity-failed` | Bytes came back and did not verify against what was uploaded. |
| `recording-credential-disclosed` | The recording carries a credential this Run presented. Nothing stored. |
| `recording-unscannable` | No credential could be resolved, so there was nothing to scan for. |

The first is a fact about the deployment and the rest are things an operator would act on;
folding them together would make "this Run has no recording" look like an outage.

Two things this build does NOT do, named rather than left to be discovered:

- **Provider retention is not set to minimum.** `@solarisdk/browser@0.1.3` exposes
  `create`, `release`, `releaseAndWait`, `getReplayUrl` and `downloadReplay`, and no
  retention control at all. The resolved decision of 2026-09-01 asks for it; the SDK this
  build ships cannot express it. It is an owner action against the provider account, not a
  line of code, until the SDK offers one.
- **A Run made before recording was switched on has no recording, permanently**, and no
  later story can recover one.
