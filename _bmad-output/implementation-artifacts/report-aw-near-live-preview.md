# Near-live workspace preview — synthetic capability review

**Paused at the user's request to preserve usage.** See
[the saved checkpoint](checkpoint-aw-2026-09-21.md) for the latest result, exact
remaining failure, manual browser access and resume instructions. This is unfinished
work, not a completed slice. Complete types and boundaries passed at checkpoint.

Status (21 September 2026): integrated locally after manager transfer and its CI cleanup correction. Ten authenticated browser cases have passing evidence. Independent review and final combined checks remain pending. Nothing is merged or deployed.

Latest acceptance: both separate-worker scenarios passed together (1.9 minutes),
including saved-authentication privacy, two independent viewers, Pause/Resume/Stop
and actual SIGKILL/restart. The next combined invocation passed all ten adapter
browser cases but failed initial presentation in the second worker viewer; its
serial process-loss case was skipped. This intermittent presentation failure remains
under investigation and prevents slice closure. Request diagnostics show fresh
authorized responses. A new matcher regression checks that a newer capture within
the same public epoch does not invalidate a still-fresh decoded sample or extend
its age. All three matcher/presentation unit cases pass; browser validation is running.

An authorized auditor can view ephemeral samples of the same Page used by the agent. Two viewers share one bounded sampler; viewing creates no additional Page and does not resize the agent's viewport. Registered Evidence and Replay remain separate. The interface names private, stale and unavailable intervals and checks current authority after actual image decoding.

The initial capability is explicitly synthetic-local: web and one configured worker share the same loopback network namespace, with signed internal requests and current session/role/Run/runtime/privacy checks. It is unavailable for production, remote routing, unsupported providers or targets outside the loopback allowlist. No provider endpoint or recording is exposed. Limits are 16 preview sessions, eight viewers per session, 32 active broker requests and a 512 KiB frame bound. These are enforced limits, not measured capacity claims.

## Behavior and privacy

The workspace owns one privacy/action coordinator and latest-frame buffer. Ordinary actions have priority; concurrent work cannot build an unbounded capture queue. Entering a private interval synchronously advances its epoch and clears buffered pixels, persists the new metadata, and drains actual browser I/O before credential input. A timeout fences and disposes the Page rather than claiming pending I/O stopped. Stored sign-in suppresses both preview and registered captures; safe verified handback advances the epoch again.

Migration 61 stores operational identities, timestamps, privacy state and expiry only. Frame bytes and credential values are not stored in database rows, jobs or Evidence. Delivery is reauthorized in the broker, proxy and client. Runtime expiry cannot resurrect the same workspace revision.

## Measured result

The test ran for 15 seconds with changing public synthetic content, two independently authenticated sessions, the compiled production browser adapter/broker, actual PostgreSQL metadata and the real application proxy. It did not run a separate agent-worker subprocess or production provider/model.

| Configuration | Viewer 1 displayed FPS | Viewer 2 displayed FPS | Viewer 1 p95 capture-to-display | Viewer 2 p95 capture-to-display |
| --- | ---: | ---: | ---: | ---: |
| Initial cadence — failed | 0.511 | 0.546 | 1,962 ms | 1,492 ms |
| Corrected cadence — passed | 1.468 | 1.628 | 609 ms | 655 ms |

The initial one-second sampler hit its one-second admission throttle after variable database work, dropping whole ticks; median observed capture spacing was 1,991 ms. The sampler now targets 600 ms with a hard 500 ms minimum capture interval, leaving scheduling margin. Client polls start at most twice per second and remain sequential. Captures still share one slot and yield to actions. Median measured capture spacing became 601 ms, p95 605 ms. The normative requirements remain at least one unique displayed frame per second and p95 below two seconds.

[Initial measurement](aw-preview-benchmark-initial.json) and [corrected measurement](aw-preview-benchmark-cadence.json) retain actual sequence identities, digests and capture/receipt/display times. They contain no preview pixels. No extra Page, viewport mutation, recording or Evidence artifact was produced by preview.

## Verification

- Package build, complete package/root typechecks and dependency boundaries passed at integration.
- Initial focused units: 126/126 across seven files. After cadence correction: 35/35 affected coordinator/polling/presentation cases, including both interval limits.
- Fresh migration 61 applied to two isolated PostgreSQL 18 databases. All 21 preview/schema integration cases passed.
- Authenticated setup passed 3/3.
- Ten actual Chromium preview cases passed across three zero-retry invocations: measured two-viewer viewing; preview and registered screenshot drain before stored sign-in; delayed decode crossing private, role, session, runtime and runtime-expiry changes; actual terminal cancellation/result sealing; adapter release. Runtime-loss proof injects metadata expiry; it is not a process-kill acceptance test.

Original failures remain recorded: the cold first viewing invocation produced no visible frame before its deadline; a warmed run measured the insufficient initial cadence. A private-drain test then timed out because the fixture addressed authentication from a sibling account path instead of the frozen target base. The fixture now uses the supported base scope, and named waits report premature sign-in settlement. Both real stored-sign-in drain paths passed after that correction. Fixture cleanup acquires the Run lock before its children.

## Remaining boundaries

Independent review and final complete checks are still required before committing this slice. P6 exclusive human input and its authenticated handback are separate work; the shared coordinator is infrastructure for that flow. This synthetic benchmark does not close G3 supported-provider/private-input acceptance or G7 measured system capacity. All seven overall proof gates remain open; D2 is still required before real-data admission.

## Slice completion work — 21 September 2026

The user approved finishing this slice end to end before moving to other features. The remaining acceptance is a composed journey using a separately spawned compiled worker, two authenticated viewers, application Pause/Resume/Stop, actual saved-authentication suppression/handback, access or connection loss, and actual worker process death. Existing adapter-level cases and simulated runtime expiry do not replace that proof. Exclusive human authentication remains P6.

The preceding pushed candidate `d74ff294975a6921ad54eaddb37402dc3f5ada4c` completed CI run 35571949261: types/boundaries/units, PostgreSQL migrations/integration, container checks, agent abuse mutations and P0 passed. The full browser job failed with 256 passing and four failing cases (Pause/Resume, empty Procedures list, renewal heartbeat Resume dialog, and workspace role revocation). Those failures are under investigation; this candidate is not a green baseline.

Additional local verification during slice completion: the complete unit invocation ran 4,949 cases (4,946 passed, three failed). The failures were an invalid accessible name on a generic preview div, the old constructor-source assertion, and an old cadence expectation. The preview now uses a named section; all 44 affected cases passed after correction. Package build, complete package/root typechecks, boundaries (718 modules), migration 61 on fresh databases, no schema drift, and all 21 preview/schema integration cases passed. The full integration invocation was interrupted by a Codespace restart and supplies no passing-suite evidence.

The composed worker proof first exposed test setup issues: worker-scoped Playwright options belonged at file scope; a second context inherited saved authentication and needed explicitly empty storage; the real workspace revision advances during provisioning and must be compared to the actual durable owner rather than a literal one. A cold development proxy missed private-state presentation before its request deadline; the harness now compiles that proxy with an authenticated missing-Run read before holding real credential I/O. No execution state is fabricated by that warm-up, and no cold-start performance claim is made. Final composed results remain pending.
