# Focused Story 21.2 methodology draft-custody repair

This is the expressly authorised batch follow-up carried alongside Story 21.4. It does not establish knowledge semantics or replace the batch's full regression gates.

The repair preserves exact unsent methodology edits (organisation, lineage, expected revision, original definition baseline, availability input, activation and text) and recall drafts (exact version, key, expected revision and reason) through an actual `/auth/session` outage that unmounts the authenticated App subtree. Custody is memory-only, bounded to 16 exact actor/session/organisation audiences and 8 MiB serialized content including uncertain commands. Admission refuses before replacing the accepted editor or transmitting; it never evicts uncertain receipts. A fresh generation-bound methodology current-Admin read is required before recovery. A successful organisation list or membership in another organisation cannot authorize a retained edit. Intentional cancellation invalidates request ownership before abort, preserving actual hidden inner DOM/open state/focus. Denial, replacement, logout, cancellation and success clear custody. Recovery never submits.

## Required browser evidence

- `negative.log`, `negative.exit`, `negative-verification.json`: the exact baseline component from `d38e1daed736415ef13e7606345dac71bd1d9f01` failed the intended restoration assertion at line 124: expected the exact unsent edit form to be visible after actual session outage/remount and a real successful scoped Admin read; no editor existed. One case, 20.5s, exit 1. This is the intended negative control.
- `substitution-plan.json`, `substitution-installed.json`, `substitution-restored.json`, `baseline-vs-repaired.diff`: exact old component installation and repaired-byte restoration. Baseline SHA-256 `c5b2b3f943cafc9c7b29f7f1c196e73df71c6458943c7a3e737ca777c84b304b`; repaired SHA-256 `0ba509698ea541e5288adf566cb34dcea78f27f415df8c6843f49372a4cdcde6`. The final source still matches those restored repair bytes.
- `repaired-retry-2.log`, `repaired-retry-2.exit`, `closure.json`: all four repaired cases passed, one worker, zero retries, 37.4s. Start/end manifests match exactly. The test file hash is `e1c89897d87dc687279164d47cab9d2347497166e7ea19c09278fe267c5d0657`.
- `methodology-custody.negative.spec.ts` matches the executed negative test hash. `negative-to-final-test.diff` proves that the later test correction changed only case 3's post-logout IdP setup; the selected negative case 1 is unchanged.

The four cases prove:

1. Actual session 503 unmount, fresh scoped authorization withheld until released, exact full unsent edit recovery, no automatic POST, explicit successful Save preserving lineage/scope/revision/activation/template text, exact recall-reason recovery, cancel and successful completion clearing.
2. Same actual marked inner details/textarea DOM survives intentional cancellation. A cancelled older successful read cannot authorize the next activation; MutationObserver sees no transient redisclosure. Open state and focused textarea return only after the new read succeeds.
3. Same-account session rotation, another identity, and completed logout discard private drafts. Successful subsequent login does not resurrect them.
4. Current Admin membership elsewhere cannot disclose an old organisation's retained draft while its real 403 is held. The same exact session is retained; confirmed refusal clears custody and later role restoration does not resurrect it. MutationObserver sees no disclosure leak.

Browser plugin was unavailable; repository Playwright exercised real local HTTPS/OIDC/API/PostgreSQL in Chromium at 1280×800. The default eight-second product read deadline and 90-second browser-case budget were not enlarged. Before/after screenshots were opened and inspected: baseline shows saved history with the edit missing; repaired screenshot shows the exact recovered editor. This does not qualify other browsers or native OS tab behavior. First-case page-error collection remained empty.

## Retained failed attempts

- `negative-harness-1`: zero tests selected because an anchored grep excluded Playwright's full test title. Runner grep corrected. Not negative-control proof.
- `negative-harness-2`: real editor setup reached a select whose enclosing label text included its options; exact label lookup timed out. Switched to the existing methodology suite's exact combobox accessible-name locator. Not negative-control proof.
- `repaired.log`: cases 1, 2, 4 passed; case 3 passed replacement clearing but the final explicit login expected an Account form while the synthetic IdP SSO cookie remained. The test now awaits actual logout completion and clears only the provider cookie through its existing helper. No production code or assertion was removed.
- `repaired-retry-1.log`: no case body executed; standard harness startup exceeded beforeAll 90s during a combined cold workspace/evidence-harness rebuild. Two backend files changed during that startup attempt. The late-spawned exact owned provider was terminated; `repaired-retry-1-cleanup.json` records no remaining live owned descendants. Lead separately prebuilt workspace and evidence harness (50.18s+53.53s) outside Playwright before the final passing run; deadlines remained unchanged.

Earlier targeted methodology unit invocation passed 21 tests (15 existing + 6 custody cases), covering exact text and clone isolation, recall basis, replacement/clearing and both audience/byte capacity without receipt eviction. TypeScript and diff checks passed. The lead's complete web check additionally ran 175 tests before the final browser-only fixture corrections; the final full batch checks remain separately owned.

The browser runtime closed normally after the final run and IdP 9444 was verified free. No commit, push, deployment or protected development service change occurred.
