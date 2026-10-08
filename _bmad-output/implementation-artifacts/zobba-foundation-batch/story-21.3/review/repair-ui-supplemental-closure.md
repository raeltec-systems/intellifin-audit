# Story 21.3 supplemental UI and browser-harness closure

**Disposition: the four follow-up repairs, including the additionally observed affected-Task button overflow, are closed within this supplemental scope. No remaining source or test-adequacy finding was identified here. The final 123-case browser gate remains pending and root-owned.**

This review inspected actual source, diffs, source manifests, completed receipts, geometry and the focused narrow-layout screenshot. It ran no tests, builds, services or database operations and changed no application/test source. This report is the sole write for the supplemental stage. Earlier reports remain stage-specific and unchanged:

- `repair-ui-source-review.md`: `283ddf7fb3ef6a9e71366954d9d23176180ba01864d9b5bdb9761981dc01febf`
- `repair-ui-closure.md`: `e1eddfc1db7a41ece65bf0c4aa0f4b188d7d4b665482f7d043937f3a32290230`

## Source and behavior assessment

### Command failure survives independent Settings refresh

`zobba/web/src/MethodologyWorkspace.tsx:33–34` separates command/authoring `error` from `readError`. `fail` classifies the failure at lines 46–61; refresh success/failure updates only read error at lines 83–88. An uncertain command's 429 explanation therefore survives the successful refresh launched from mutation cleanup at line 147. Pending exact command custody and retry controls remain unchanged. Confirmed access denial clears private state and command error, while organisation changes clear both error channels. The SkillCatalog access-failure callback uses the read channel.

The unchanged substantive methodology scenario exercises first-attempt 429, an actual committed/lost reply, App-child unmount/recovery, an exact retry refused with 429, the retained unconfirmed explanation, disabled editor/new-author controls, and exact final receipt recovery. It passed in focused attempt 5 in **38.8 seconds**. Methodology production source and that test are byte-identical between that run and the final freeze; only CSS and CLAUDE.md differ from its complete run manifest.

### Scoped wrapping and honest narrow-width proof

`styles.css:564` gives only the skill catalog, Task skills and affected-selection views `min-width:0` and `overflow-wrap:anywhere`. `TaskSkills.tsx:85` adds the corresponding `skill-impacts` class. This fixes long receipt/provenance text without truncating stored values, clipping the document, or changing response data.

The installed-skill browser case retains real server operation/receipt assertions first (`skills.spec.ts:257–305`): exact replay bytes, one installed version, manifest/scope/actor/status, resource digests, inspected resource bytes, and no script execution. It then measures the actual 390px page. Only afterward does it append a clearly labeled **DOM-only** paragraph containing a valid-format 43-character opaque identifier; the paragraph is never submitted or substituted for a server receipt and is removed in `finally` (`skills.spec.ts:306–321`). Both actual and fixture document-width assertions remain `documentWidth <= viewport`.

The prior old-CSS fixture artifact measured document **630px** at viewport **390px**, with the fixture paragraph's `scrollWidth=573` and `clientWidth=278`. This is a layout stress observation, not a claim that the real operation returned that fixture value. Final focused attempt 6 measures both actual receipt and fixture documents at **390/390**. The focused screenshot shows wrapped digest/inert-resource text and readable controls.

The reviewer additionally identified a limitation in inherited text wrapping: global `button { white-space:nowrap }` could still prevent the long affected-Task control from fitting. Lead's real measurement established the defect in focused attempt 5, without changing the button's actual text: at viewport 390, its left edge was 12, right edge **609.875**, width **597.875**, text length 83. Document width alone passed because the overflowing control was inside its container. This is preserved as an actual failed regression, not just a speculative limitation.

The final scoped button rule (`styles.css:565`) sets `min-width:0; max-width:100%; white-space:normal` within the three skill views. The revised P4/P5 test retains the exact accessible name and complete real Task-ID label, asserts document width **and** button left/right/internal width, then clicks that same button and verifies the correct Task and exact historical selection (`skills.spec.ts:946–959`). In focused attempt 6 the real button measures left **52**, right **363**, width **311**, and `scrollWidth=clientWidth=309`, at viewport **390**. The whole case passed in **13.1 seconds**. No label substitution, truncation or weakened width condition is used.

### Account-binding counters preserve the bounded recovery contract

`account-binding.spec.ts:241–289` first settles the legitimate affected-skill projection, then classifies `/auth/session` requests by the **presence** of `X-Expected-Session`, without recording its value. App bootstrap/recovery requests are counted separately from current projection postchecks.

The original behavior assertions remain exact: two unbound session reads, two scoped reads and two mismatches exhaust automatic recovery; zero bound checks and zero mutation POSTs occur while exhausted; old protected DOM/draft is withdrawn; focus/pageshow/visibility events do not replenish the budget. Explicit recovery permits exactly the third unbound read. The test then actually waits for affected-selection rendering and observes exactly one bound postcheck, still with no POST and no recovered stale composer draft. No count is broadly relaxed. This targeted case passed in focused attempt 4 in **4.5 seconds**.

### R06 captures the same real refusal and drains interception

`evidence-repairs.spec.ts:135–160` intercepts only the first UI reservation POST. `route.fetch()` sends that request to the real server; the test asserts its real 409/no-Retry-After and reads its body while available, then delivers the unmodified response with `route.fulfill({ response })`. The browser-observed response must have the same submitted body, status and header behavior. The server error must equal `evidence_reservation_limit`, and the exact original request/key/identity/source must match retained recovery custody. Later requests continue normally.

The interceptor is drained with `unrouteAll({ behavior:'wait' })` in `finally` before the existing real-reservation recovery/free-capacity/new-acquisition assertions. No synthetic success/refusal, repeat POST for body recovery, or swallowed route failure replaces the original operation. The targeted R06 case passed in focused attempt 4 in **13.4 seconds**.

### Bootstrap diagnostics preserve test failure semantics

`methodology.spec.ts:22–60` adds bounded diagnostics for initial sign-in failure. It records status/resource categories, approved module pathnames, document counts and error categories; it omits callback queries, headers, response bodies, console text, passwords and session values. Listeners are removed in `finally`. The existing heading expectation, its 12-second configured timeout, and subsequent title/origin/error-overlay assertions remain unchanged. Failure still throws its original cause; no retry or extra success route is added.

Focused attempt 4's blank-document bootstrap failure remains unexplained by this review. The later actual scenario passed; this is not a claim that a particular bootstrap root cause was proved or globally eliminated. The root-owned combined browser gate still has to complete.

## Inspected execution receipts

All paths below are under `/tmp/zobba-story-21-3/repair-1/`. Each browser command uses **one worker and zero retries**.

| Stage | Actual result | Scope and limitations |
|---|---|---|
| `browser-focused-4.log` / `.exit` | **6 passed, 1 failed**, exit **1**, 1.6m | Account counters, R06, real structured installation/receipt layout, >513 choices/restrictions, history/impact, and fresh activation passed. Methodology failed during initial sign-in before reaching its repair path. Preserve this failed stage. |
| `browser-focused-5.log` / `.exit` | **1 passed, 1 failed**, exit **1**, 58.9s | Methodology full scenario passed 38.8s. Actual affected-Task button geometry failed at right=609.875. Preserve this failed stage. |
| `browser-focused-6.log` / `.exit` | **2 passed**, exit **0**, 38.4s | Real structured installation and receipt/fixture layout passed 18.6s; real affected-selection navigation, button geometry and history passed 13.1s after scoped button wrapping. |
| `static-freeze-5/*.exit` | All **8 exit 0** | fmt, Clippy, Rust build, web check/build, Python, boundaries, fixture. These are supplied receipts, not reviewer-executed commands. |
| `web-check.log` / `.exit` | **156 passed; 0 failed/canceled/skipped**, exit **0** | Final generated API drift check, TypeScript and web tests. |
| `web-build.log` / `.exit` | exit **0** | Final TypeScript/Vite build. |

Geometry evidence:

- Prior failure: `browser-focused-3b-results/skills-structured-Admin-in-3c3ad-rozen-lost-receipt-recovery/skills-narrow-fixture-geometry.json` — 630/390.
- Actual button failure: `browser-focused-5-results/skills-repair-P4-P5-persis-432b4-rs-to-scoped-affected-Tasks/skills-narrow-impact-button-geometry.json`.
- Final receipt and fixture: `browser-focused-6-results/skills-structured-Admin-in-3c3ad-rozen-lost-receipt-recovery/skills-narrow-{actual,fixture}-geometry.json` — both 390/390.
- Final real button: `browser-focused-6-results/skills-repair-P4-P5-persis-432b4-rs-to-scoped-affected-Tasks/skills-narrow-impact-button-geometry.json` — right 363, internal width 309/309.

No single all-green seven-case rerun is claimed. The complementary focused receipts close these bounded repairs; **the final combined 123-case gate remains pending**.

## Final source reconciliation and hashes

`source-freeze-5.json` exists and records 221 files. Focused attempt 4 start/end match it exactly. Freeze 5→6 changes only CLAUDE.md, the scoped button CSS, methodology bootstrap diagnostics and the skill real-button geometry test, as recorded in `source-freeze-5-to-6.json`. Focused attempt 5 start/end differ from freeze 6 only in CLAUDE.md and the CSS repaired after its observed button failure.

`source-freeze-6.json` records 221 files at `2026-10-02T15:33:42.536945+00:00`. Both focused attempt 6 manifests and both `source-web-final-{start,end}.json` manifests match all 221 files. `source-freeze-final.json` has the identical file mapping. The following current hashes independently match that final freeze:

| Reviewed file | SHA-256 |
|---|---|
| `CLAUDE.md` | `12de043d92373fa5322e5a8df92d0ac189cd77823cd3756f2e7dd9cbb59c74d9` |
| `zobba/web/src/MethodologyWorkspace.tsx` | `c5b2b3f943cafc9c7b29f7f1c196e73df71c6458943c7a3e737ca777c84b304b` |
| `zobba/web/src/TaskSkills.tsx` | `e45cf3c14890627ddef9b350f4d2568a0a5afcd71c62185b34f725ebab9b4ca5` |
| `zobba/web/src/styles.css` | `f3d2d981e1ab69af7dae834d2fa6ea822d84ac9f223aef80c93e42ff7f7186c9` |
| `zobba/web/tests/browser/account-binding.spec.ts` | `e2ceef4812c225808c72dfd4aa6d4ceb0435a74cbf3e9e545869a9a0906b9fca` |
| `zobba/web/tests/browser/evidence-repairs.spec.ts` | `14876043d556f8307d8777c6cffb8f9a3a8ec12e6ee32ca6b3ef93bb1b50274e` |
| `zobba/web/tests/browser/methodology.spec.ts` | `bef4acbd79d45bbc092838e8d810b3945e1ae7e113eb794694039eac3c47fabc` |
| `zobba/web/tests/browser/skills.spec.ts` | `a30c282bfa71dee3e3a36ca9bfc8f90ade6229f5fcc4475c15b145a78b66ef57` |
