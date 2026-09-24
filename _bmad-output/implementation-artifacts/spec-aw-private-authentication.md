---
title: 'AW P6: privately assist the declared read-only Northstar authentication flow'
type: feature
created: '2026-09-20'
status: draft
review_loop_iteration: 0
context:
  - '{project-root}/AGENTS.md'
  - '{project-root}/docs/workstreams/auditor-workspace/spec-v1.1.md'
---

<frozen-after-approval reason="user authorized completion of the PR 51 workstream">

## Intent

**Problem:** Stored credentials cannot handle the requested private human assistance. A supported flow needs exclusive input, suppression of all ordinary capture, verified identity/rights and controlled return to the agent.

**Approach:** Declare and freeze one supported synthetic Northstar LoanCore sign-in flow. Use the preview slice's worker-owned coordinator and private broker for an actor-and-session-bound input lease. Relay the credential transiently to the exact approved form, verify the result, then explicitly hand back and re-inspect through normal execution.

## Boundaries & Constraints

**Always:** Require existing Run execution eligibility plus current controller ownership for acquiring this discretionary assistance lease. Bind actor, web session, Run, frozen flow, workspace/runtime/privacy epoch and expiry. Drain agent actions before private input. Suppress screenshots, DOM capture, preview, recording and sensitive logs before accepting a credential. Verify destination, expected identity and read-only rights before public handback. Preserve normal evidence and safety semantics.

**Ask First:** D2 before real data. D3 is unrelated and grants no authentication authority. Provider capability must be proven before enabling its assistance control.

**Never:** Persist a credential, cookie, OTP, keystroke, secret hash or private screenshot in DB/jobs/audit/logs; retry unknown credential submission; permit arbitrary clicks/navigation/DOM evaluation; import a personal browser session; bypass anti-automation; or merge/deploy.

## I/O & Edge-Case Matrix

| Scenario | Input / State | Expected behavior | Error handling |
|---|---|---|---|
| Supported declaration | Newly approved LoanCore flow | Frozen exact path, destinations, identity and rights verifier | Old undeclared plans cannot acquire assistance |
| Request assistance | Eligible holder at supported blocked sign-in | Recorded request; drain/fence; private epoch; exclusive short lease | No input while fencing |
| Concurrent viewer | Another actor/session or stale epoch | No input or private pixels | Bounded refusal |
| Private submission | Exact frozen form and current owner | Transient credential relay once | No echo, storage or replay |
| Successful sign-in | Declared identity and read-only proof | Ready for explicit handback | Human action is not an inspection |
| Wrong identity/rights | Sign-in succeeds under an unsafe account | Keep execution blocked/private | No public recapture |
| Return | Verified flow and explicit current-owner return | Close input, clear buffers, new public epoch, normal fresh capture/attempt | Recheck all fences |
| Expiry / loss | Disconnect, role/session revocation, workspace or worker loss | Close input; remain blocked | No automatic lease reattachment |
| Unknown outcome | Lost submission response or unexpected redirect | Mark uncertain and block | Never resend credential automatically |
| Safety race | Stop/pause arrives during assistance | Close input and honor existing safe boundary | Never discard accepted safety latch |

</frozen-after-approval>

## Code Map

- Target registration contracts, digest/approval readers and authoring UI: introduce a closed optional authentication-flow descriptor for newly approved versions. Initial flow is synthetic LoanCore `/loancore/sign-in`, expected account `audit.readonly`, and a specific reliable read-only verifier. Freeze permitted identity destinations and flow identity with the plan. Preserve historical digests and do not infer a flow from old registration prose.
- `packages/infrastructure/src/runs/authentication-proof.ts`, `browser-execution.ts`: reuse supported Northstar identity recognition and verify rights from the declared target contract plus the actual supported target's read-only proof. Reject missing/contradictory proof. The coordinator may fill only the declared credential control and submit the exact auth form. A visible fixed account label alone is not proof of arbitrary production account rights.
- Application execution/session-step ports and worker boundaries: assistance can occur at initial sign-in, before agent work exists. Extend the existing wait contract where needed, preserving one open wait and existing deadlines. Fence both session-step and agent tool dispatch; a human lease cannot coexist with new agent browser actions. Browser I/O stays outside locks.
- Metadata handoff repository and next migration: immutable request identity, actor/session, frozen flow digest, expected workspace/runtime/privacy identities, state, lease/deadline and exact transition receipts. States distinguish requested/fencing/private/submitted/verified/returned/expired/uncertain. Never store input bodies. Fresh role, controller and session checks apply to each operation; expiry cannot renew an old epoch.
- Preview coordinator/private broker and authenticated web routes: suppress capture before sensitive input, drain pending capture buffers, validate the lease at admission and immediately before dispatch, cap body size and disable body/access logging. Relay bytes in memory over authenticated private transport, clear references on completion, and never place inputs in pg-boss or retry storage. Return bounded non-secret status only.
- Workspace private-assistance UI: explicit privacy notice, frozen destination/account, one protected credential field, submit, cancel and handback. No ordinary conversation field is reused. Clear fields on submission/close; omit private input from screenshots, errors, analytics and test artifacts. Other viewers see an explicit gap and owner status only.
- Worker startup/shutdown/recovery: invalidate stale runtime/input leases and remain blocked when process-local Page ownership is lost. Reconcile uncertain submission without secret replay. After validated handback, restart/re-capture the affected work under the existing attempt semantics; attribute authentication to the human, never to an agent observation.

## Tasks & Acceptance

- [ ] Freeze the supported flow and expose its explicit approval meaning.
- [ ] Add exclusive metadata lease, privacy fencing and existing-wait integration.
- [ ] Relay transient private input through the exact supported flow with no retained secrets.
- [ ] Verify identity/rights and implement explicit controlled handback with fresh capture.
- [ ] Implement expiry, revocation, disconnect, worker loss and unknown-outcome blocking.
- [ ] Execute privacy/race/SQL negatives and a real-worker two-viewer authentication journey.
- [ ] Record supported capabilities and outstanding Solari/D2 proof in P6/report.

**Acceptance:** Given the declared synthetic flow, one eligible auditor can privately authenticate and explicitly return the same workspace after verified identity and rights. No ordinary viewer, capture, job, event or log receives the credential or private pixels. Every uncertain or expired boundary closes input and prevents unverified agent continuation.

## Design Notes

Implement after protected preview so both paths share one coordinator. Reuse existing Run authority rather than inventing an unapproved manager permission. Initial synthetic capability is narrower than generic browser takeover and remains visibly unavailable for unsupported registrations/providers. Test the stored-credential path too: its capture suppression must not bypass the same privacy invariant. Real Solari containment/recording and production read-only proof remain explicit G3 evidence, not inferred from fixture success.

## Verification

Typecheck/boundaries, coordinator/auth-flow units, fresh PostgreSQL lease/fence/receipt tests, real compiled worker and two authorized browser contexts, secret scans of retained DB/events/logs/artifacts, privacy decode races and kill/recovery proof. Publish exact synthetic results and keep external/provider/data-policy gates honest.


## Concrete boundary audit and implementation order

Initial authentication happens in `execute-agent-steps.ts` before Work Items exist. A
missing stored credential currently fails that phase and the worker manifest preflight.
Exempt only an explicitly frozen supported authentication flow, then yield the existing
Run through a dedicated non-escalation authentication wait. Ordinary question answers
and generic Resume must never close that wait or bypass unresolved authentication.

P2 private mode alone does not confer exclusive human ownership: stored-credential
execution can reuse its process-local private token and automatically return it. Add a
purpose/owner distinction and refuse ordinary adapter dispatch while a human lease owns
the Page, across both session-step and work-item claims/recovery. Track browser I/O to
completion before accepting human input. Existing accepted safety requests remain first.
An immediate Pause during authentication must close private input, retain unresolved
authentication, and use the ordinary Pause boundary without allowing Resume to bypass it.

Freeze a closed `northstar-loancore-v1` descriptor with exact approved origin and sign-in
path, account `audit.readonly`, and verifier `northstar-read-only-v1`. The implementation
owns selectors, POST, landing path and rights endpoint; no runtime browser scripting or
caller-selected destination is permitted. Historical registrations and plans retain an
absent descriptor and their original digest. Registration and Procedure review explicitly
disclose the newly frozen capability.

Add an authenticated non-mutating Northstar proof endpoint reporting the exact account
and enforced read-only policy. Verify it in the same browser context, with exact origin,
no redirects, bounded closed response, the account marker and no sensitive input fields.
Generate the claim from the synthetic server's actual session and global method policy,
and test those bindings. A target-provided account label alone is insufficient; never
probe rights by attempting a business write. This is a supported synthetic contract only.

Use a metadata-only durable adjunct after migration 63. A 120-second input lease has
no renewal and is capped by the original Run/authentication wait deadline. Recheck actor,
web-session expiry, execution role, current controller epoch and complete runtime/privacy
identity at every admission and immediately before dispatch. Never enter browser I/O
inside database locks. Submission is one-shot; an unknown result permits only non-secret
status or verification recovery. Explicit handback closes input, verifies identity/rights
and coordinates durable and process-local transitions through a fail-closed intermediate
state. Neither a partial commit nor a restart may reopen agent dispatch or public capture.

Implement in this order: frozen declaration and synthetic rights proof; metadata/wait and
worker blockers; purpose-owned coordinator and transient broker; explicit verified return;
protected UI; expiry/revocation/Stop/Pause/crash proof. Disable test tracing, video and
screenshots around private entry. Zero owned byte buffers and promptly release string
references without claiming JavaScript guarantees physical string zeroization. D2 and
external provider proof remain boundaries for real-data/provider enablement.
