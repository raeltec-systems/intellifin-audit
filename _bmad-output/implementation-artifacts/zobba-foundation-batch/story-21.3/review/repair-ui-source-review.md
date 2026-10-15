# Story 21.3 repaired UI source review

Review scope: P2, frontend P3/P4/P5/P7, P8/P9/P11 in the ten released files below. Read-only review except this report; no tests, builds, services, database operations, staging, commits or pushes performed. AGENTS.md, frozen story, root-triage.md and repair-1/integration-contract.md were read. Other reviewers' conclusions were not review inputs. SQL locale ordering and the commissioned envelope correction are outside this finding set.

## Finding — medium — retained Settings content becomes visible before selected-organisation reauthorization

**P2/P3 remain open for this lifecycle path.** Actual App-unmount recovery is safe, but a retained Settings subtree can expose its cached skill catalog/editor after access was withdrawn, before its independent fresh catalog authorization returns.

Source chain (paths relative to repository):

- `zobba/web/src/MethodologyWorkspace.tsx:61` hides the subtree during explicit refresh. Lines 65–78 accept a successful current Admin-organisation page alongside any non-auth methodology read failure and set `ready=true`. Lines 80–81 only update selected metadata when found; absence of the selected organisation leaves its cached metadata and selection intact. Line 216 supplies this visibility as the SkillCatalog's `accessReady`.
- `zobba/web/src/SkillCatalog.tsx:39` obtains the inspection; lines 40–41 compute visibility from `accessReady && snapshot !== null`, including a cached snapshot.
- `zobba/web/src/useSkillInspection.ts:36` cancels when access becomes unready without clearing retained state. The later activation starts a new read in an effect; line 53 still returns the prior same-owner state. The successful fresh read at line 29 is therefore not required before the cached editor/catalog becomes visible again.

Deterministic browser reproduction to add and execute:

1. Sign in as the existing Admin-only fixture, open org-a Settings, fill an unsent skill editor, and mark its original DOM.
2. Deactivate that actor's org-a Admin membership while preserving the other existing Admin and the exact browser identity/session.
3. Make the selected methodology GET fail with a transport 503. Let the membership organisation page run against current authority; it succeeds without org-a. For the new independent skill catalog GET, fetch and assert the real 403 but hold delivery behind a gate.
4. Click **Refresh methodology access**. While that catalog 403 is held (before the eight-second deadline), the old editor/catalog becomes visible again and its controls can enable. Releasing the 403 then clears it.

Expected: retain hidden DOM/draft if useful, but keep it hidden until a fresh authorization for that selected skill organisation succeeds. A successful page of other/current Admin organisations is insufficient. This is a visibility/verification gap, not an objection to hidden DOM retention. The existing new-catalog P3 browser case does not exercise this retained-subtree transition.

This finding is established by source control flow; the reviewer did not execute the reproduction. Root commissioned implementation and real-browser negative/positive proof after receiving it.

## Other source conclusions and execution limits

| Repair | Source assessment | Evidence/limit |
|---|---|---|
| P2 | Actual transient session-check failure unmount retains exact unsent install/edit/status/selection text and original basis in module memory. Fresh remount begins with no server snapshot. Exact actor/session/org/scope/Task keys isolate custody; replacement, explicit denial, logout, cancel and success clear it. | `skills.ts:192,225–258`, `App.tsx:114–160,208–219`, component recovery initializers. Browser source has actual 503/unmount marker checks; execution pending. Retained-subtree exception above prevents full closure. |
| P2 capacity/recovery | Prospective 16-audience/8 MiB admission rejects before changing existing custody. Rejected status/edit/selection transitions retain the current editor; uncertain commands remain recoverable. Skill pending state is separate from Task Pause/Stop. | `skills.ts:230–249`; `SkillCatalog.tsx:22–26,44–61`; `TaskSkills.tsx:19,33–48`; `ConversationWorkspace.tsx:347–349`. Unit source covers admission refusal and retained pending command; browser source covers real byte pressure/editor transition and enabled controls. No execution claimed. |
| P3 | Catalog does not include assignment choices; client and per-client engagement pages are separate reads with 50-row parsing. The enclosing Settings tolerates non-auth methodology capacity failure. | `skills.ts:154–160,194–198`; `SkillCatalog.tsx:97–120`; `MethodologyWorkspace.tsx:65–78`. Browser source inserts 514 engagements, observes the real methodology 429, pages assignment choices, installs, disables/recalls and reloads. Execution pending; lifecycle exception above remains. |
| P4 | Each version exposes current status actor/server time/revision/explanation; separate bounded newest-first history retains event attribution after reload. | `skills.ts:146–166,199–202`; `SkillDetails.tsx:10–11`; `SkillCatalog.tsx:123–132`. Browser source uses 52 real events and two UI pages after reload. Execution pending. |
| P5 | Affected selections are read only from the explicit current engagement and optional exact version, with cursor validation and original references. Navigation opens the exact Task. Admin catalog UI remains count-only. | `skills.ts:203–216`; `TaskSkills.tsx:76–94`; `ConversationWorkspace.tsx:171–197,298`. Browser source tests two scopes, Admin-only refusals, scoped API/UI references and exact Task navigation. Execution pending; SQL cursor correction is independently owned. |
| P7 | Client reconstructs only accepted/current flag, allowed bound kind and valid zero-based delegation depth; extra subjects/rule values are discarded. UI renders those fields as React text. | `skills.ts:168–173`; `SkillDetails.tsx:22–26`; unit source iterates all kinds/both authority flags and rejects invalid depth. No dedicated real-bound browser rendering assertion is present; frontend source/unit adequacy only, execution pending. Envelope source includes the latest conservative shape; this reviewer did not execute its measurement. |
| P8/P9 | Scalar-bounded skill prose no longer uses HTML UTF-16 maxlength. Shared validation retains text and associates errors with fields in install, status and selection forms. IDs retain ASCII restrictions. Duplicate IDs, dates, outputs/needs/resources, byte totals and manifest size have actionable limits. | `skills.ts:39–43,89–145`; `SkillCatalog.tsx:27–28,63–64,73–91`; `TaskSkills.tsx:59–62`. Rust structure/byte rules were checked for parity. Browser source inserts/typographically enters supplementary characters and verifies accepted retrieval, and tests field associations/invalid preservation for all three forms. Execution pending. |
| P11 | Edit clones the entire immutable installation command, creates a fresh key, requires a new manifest version and initially disables the successor. Stale expected revision remains until explicit review. | `SkillCatalog.tsx:44,76`. Browser source verifies rich scope/applicability/provenance/needs/resources, actual unmount/stale preservation, a distinct immutable successor and unchanged original selections. Execution pending. |

The 15 browser cases were reviewed as source, not reported as passed. Root's announced type checks/25 skill unit tests/full 156 preflight were not independently executed by this reviewer. Final execution assessment is deferred until root supplies repaired source and exact receipts. The separate Story 21.2 methodology unsent-draft issue is neither reviewed nor claimed fixed.

## Reviewed SHA-256 hashes

All ten hashes were captured before source reading and rechecked unchanged at the end of this source review.

| Repository path | SHA-256 |
|---|---|
| `zobba/web/src/skills.ts` | `b71044858a695794661faa5c69dde5715a03224e2ecf945b89c97d50a69264c2` |
| `zobba/web/src/SkillCatalog.tsx` | `e9eec784125a973b4e9d35c50716cfd8087a86d3b6674c76e89abceae9986472` |
| `zobba/web/src/TaskSkills.tsx` | `325296c9689266a70b0d259392dd5d8be2f972d5c51e085237a298d31957f3f4` |
| `zobba/web/src/SkillDetails.tsx` | `a237b39ffadca1f348aa323d943aafdf7cae7ddeac0e7de539ded9003982f3a1` |
| `zobba/web/src/useSkillInspection.ts` | `949409f2809b4aec1170e760570498730d9758001e13e9241fa33ead31999d28` |
| `zobba/web/src/App.tsx` | `efce55e9071d57493f803ff01b0491c7ea6ecb982c0712f788cb854befe92b2d` |
| `zobba/web/src/MethodologyWorkspace.tsx` | `48ba5db2cb86803343926bef8af170506786ba946cb19fae6860fd02f8440128` |
| `zobba/web/src/ConversationWorkspace.tsx` | `6646050281c6b50fec42bc0692eee4f604ccacf21ecf27363034e8455f2cb9b8` |
| `zobba/web/tests/skills.test.mjs` | `05fe6090c213a3f29f675e2b8a4db4e9acd9112e002a51b04d9ea7b90f65cc6b` |
| `zobba/web/tests/browser/skills.spec.ts` | `b766ff852e806ad38dd06d08681171f8d7d06948b76815c9057cc7cdfcd4b019` |
