# Story 21.3 scoped UI repair closure

**Disposition: scoped UI repairs closed; no remaining finding in this review scope.** This is closure of P2, frontend P3/P4/P5/P7, P8/P9/P11 against the reviewed source and completed focused receipts. The full 123-case browser suite is **pending** and is a separate root-owned final gate. This report does not claim a single all-green 16-case run or overall story readiness.

The reviewer performed source/receipt inspection only: no tests, builds, services, database operations or application edits. The original [source review](repair-ui-source-review.md) remains unchanged, SHA-256 `283ddf7fb3ef6a9e71366954d9d23176180ba01864d9b5bdb9761981dc01febf`. This report is the sole new write for this closure stage.

## Retained-subtree finding closed

The earlier medium P2/P3 finding allowed the cached skill catalog/editor to reappear when the parent Settings check became ready despite not establishing current authority for the selected organisation.

`zobba/web/src/useSkillInspection.ts:12–26` now assigns an activation generation to owner/readiness changes during render and verifies only a successful result from that generation. This withdraws visibility before the new activation commits. Lines 35–46 fence new requests and both completion paths by request ownership, exact owner and generation. A canceled old completion cannot verify a later activation. Line 66 returns retained value separately from verification, preserving hidden same-owner DOM without treating it as current authority.

All private consumers use that verification: `SkillCatalog.tsx:41,68,109–130`, `TaskSkills.tsx:31,54,87–88`. The catalog, Task selection, assignment options, status history and impact list stay hidden until their own current read succeeds. Failure clears the server projection; confirmed authorization denial follows existing private-custody withdrawal. The changed source does not clear unrelated pending commands or prevent Task controls.

The completed new browser regression in `skills.spec.ts:989` passed in focused attempt 1 (5.1 seconds). Its source and receipt establish both paths:

- An older real 200 is held, the parent refresh cancels that read, and a new real 200 is held. Original editor/catalog DOM and open disclosure remain present but hidden. Releasing the old response does not reveal them. Fresh success restores exact editable values, disclosure state and focus with no POST.
- The same identity/session loses org-a Admin membership. The current organisation page succeeds without org-a; the methodology transport fails 503; the independent real catalog 403 is held. Retained content stays hidden, including submission/restriction controls. Releasing the 403 clears it, and restoring membership does not recover the discarded draft.

## Per-repair disposition

| Repair | Closure and practical limits |
|---|---|
| P2 | Closed. Memory-only exact actor/session/org/scope/Task custody, original draft text/basis, real App-child unmount recovery and retained-subtree reauthorization are covered by source plus focused browser cases. Replacement and confirmed Admin denial remove drafts/pending recovery; logout clearing is directly present in source. Recovery does not auto-submit. |
| P2 capacity and pending recovery | Closed. Prospective 16-audience/8 MiB admission preserves existing entries and uncertain commands. The real byte-pressure browser case passed (40.6s), proving refused editor transition retains the exact current editor and returns capacity after explicit cancellation. Pause/Stop remain enabled under this pressure; separate web tests cover their independent command/recovery capacity. Existing browser cases passed exact lost install/selection receipt recovery, including later recall. The pressure case checks enabled controls rather than submitting Pause/Stop itself. |
| P3 | Closed for the frontend. The actual 514-engagement case passed (9.6s): enclosing methodology 429 does not hide skills, independently paged choices permit installation, and restriction/reload remains usable. The extra activation finding above is also closed. SQL collation correction remains the separately owned review scope. |
| P4 | Closed for the frontend. Current status actor, server time, explanation and revision render after reload; 52 real events exercise bounded history pages. This passed in the combined P4/P5 case (14.6s). |
| P5 | Closed for the frontend. Current engagement-only impact reads, optional exact-version filtering and Task navigation preserve original selection references. The combined browser case passed cross-scope refusal and Admin-only count/configuration isolation. Pagination is bounded/validated in source and web tests; the browser impact fixture uses one matching selection per engagement, not a multi-page impact history. |
| P7 | Closed for the frontend. Parser reconstruction exposes only accepted/current, allowed kind and valid zero-based delegation depth; React renders these as text. Web tests passed all kinds/both authority flags, invalid-depth rejection and removal of extra subject/rule values. No dedicated real-bound browser rendering assertion exists, so this closure rests on source plus parser tests, not a claimed browser bound fixture. The inspected envelope diagnostic is 7,467,743 bytes under the skills-only 8 MiB bound. |
| P8/P9 | Closed. Install/status/selection use scalar-based, non-trimming validation and associated field errors; ASCII IDs remain bounded. Supplementary-scalar Task reason/remount case passed in attempt 1; corrected authoring case passed in attempt 2 (19.2s), including real typing/insertion, accepted retrieval, duplicate/date/count/resource-byte errors and exact invalid-input retention. |
| P11 | Closed. Corrected Edit-as-new-version case passed in attempt 2 (14.8s): rich assignment/applicability/provenance/needs/resources remain exact, stale draft/basis survives actual remount, explicit revision review precedes installation, successor identity/digest differ and original selections remain unchanged. |

The separate Story 21.2 methodology unsent-draft issue is not claimed fixed. Backend P1/P6/P10/P12, SQL authorization/collation, and wider execution gates are not independently approved by this frontend review.

## Actual execution receipts and source correspondence

1. `repair-1/browser-focused-1.log` and `.exit`: `playwright test --workers=1 --retries=0 tests/browser/skills.spec.ts`; **14 passed, 2 failed**, exit **1**, 8.0 minutes. Both failures were exact-label textarea lookup failures: Edit at the expected-output value assertion, and authoring at the same output control's fill. This failed attempt is preserved and is not relabeled green.
2. `repair-1/browser-focused-2.log` and `.exit`: the same browser runner, workers 1/retries 0, selecting the two failed cases by `--grep 'Edit as new skill version|authoring preserves supplementary scalars'`; **2 passed**, exit **0**, 46.2 seconds. Test timeouts and acceptance assertions are unchanged. The repair substitutes exact accessible textbox-name lookups for exact enclosing-label-text lookups, including resource textareas; it does not weaken validation.
3. Attempt 1 start/end manifests both match all **221 files** in `source-freeze-3.json`. Attempt 2 start/end both match all **221 files** in `source-freeze-4.json`. Freeze 3 to freeze 4 changes only `CLAUDE.md` and the browser selector repair; production UI is byte-identical. All ten currently reviewed files match freeze 4.
4. Inspected `preflight-static-2/web-check.log`/`.exit`: generated API check, TypeScript and **156 web tests passed**, **0 failed/canceled/skipped**, exit **0**. `web-build` confirms TypeScript/Vite build exit **0**. All eight static gate exit files are zero. These are supplied executed receipts, not commands run by this reviewer.

These complementary focused receipts cover all 16 skill browser cases on the same production implementation, with the two corrected test selectors independently rerun. **The full 123-case browser suite remains pending; overall publication/commit readiness is for root's final reconciliation.**

## Final reviewed SHA-256 hashes

Paths are relative to `/workspace/intellifin-audit`; all match `repair-1/source-freeze-4.json`.

| File | SHA-256 |
|---|---|
| `zobba/web/src/skills.ts` | `b71044858a695794661faa5c69dde5715a03224e2ecf945b89c97d50a69264c2` |
| `zobba/web/src/SkillCatalog.tsx` | `ae2f36b9d2cc49bc559e0a8518ffc8dcdc4ed484e1c959cc3ddc4f7578e31845` |
| `zobba/web/src/TaskSkills.tsx` | `d8f310ff68ac2901ef2fc9478af10a969c70d78068d65743a1a91f6878fe096a` |
| `zobba/web/src/SkillDetails.tsx` | `a237b39ffadca1f348aa323d943aafdf7cae7ddeac0e7de539ded9003982f3a1` |
| `zobba/web/src/useSkillInspection.ts` | `23026772b24f065ebe0c07a937ae578f6e1263569301c2b1d7db69b01cc8fc87` |
| `zobba/web/src/App.tsx` | `efce55e9071d57493f803ff01b0491c7ea6ecb982c0712f788cb854befe92b2d` |
| `zobba/web/src/MethodologyWorkspace.tsx` | `48ba5db2cb86803343926bef8af170506786ba946cb19fae6860fd02f8440128` |
| `zobba/web/src/ConversationWorkspace.tsx` | `6646050281c6b50fec42bc0692eee4f604ccacf21ecf27363034e8455f2cb9b8` |
| `zobba/web/tests/skills.test.mjs` | `05fe6090c213a3f29f675e2b8a4db4e9acd9112e002a51b04d9ea7b90f65cc6b` |
| `zobba/web/tests/browser/skills.spec.ts` | `29b3360a047804c60656ac75cd2fc65f09bf545b913a2193bb5adefc45baf317` |
