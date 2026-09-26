# Stories 10.6–10.10 — screenshot review, 2026-09-26

This pass inspected real Chromium screenshots from the existing synthetic PostgreSQL 18 browser journeys. Captures use 1280×800; Timeline and Replay also use 1024×800. Only the canonical `claude/10-*` branches were used. Story 10.7 was already complete and has no new UI change in this continuation.

## Result

The inspected states have readable spacing and heading hierarchy, no horizontal page overflow, and no blocking framework overlay. The retained-decision Replay link has a visible keyboard focus ring and opens the correct stored frame. Full ISO instants remain in the decision/request `<time datetime>` and `title` attributes.

One visual defect was found and fixed: Chromium split a record key such as `E-000102` after its hyphen in Replay's narrow narration rail. The fix uses the existing `keySegments` function and `ls-nowrap` class for the frame's exact subject key. Text, image alt text, source data and colours are unchanged. Post-fix 1024-pixel screenshots were inspected.

This is a screenshot review of the coverage below, not approval of proposed wording or a claim that every rare database-failure state was exercised. The stories remain WIP where owner decisions or other acceptance items are open.

## Coverage

| Story | States inspected |
|---|---|
| 10.6 | Human-matched Result, Exceptions and record inspector; linked and unlinked decisions; adapter Evidence/digest and expanded technical details; pause confirmation and requested banner; pause before a step and during an attempt; held and resumed Timeline history; long unknown-plan-step fallback; missing and deliberately suppressed Replay captures. |
| 10.8 | Lost connection on Live View, Run Detail and Auditor Workspace; closed and open flag controls; reconnected controls; Run and non-Run route boundaries, with query-preserving reload. The header control row, flag opener and button/link presentation were checked. |
| 10.9 | Exact whole-session counts and bounded-history notice; selected-record state without a misleading partial denominator; late Escalation continuation rows; inspection page 501–520; keyboard focus around the Replay viewer. |
| 10.10 | Answered candidate and Abort entries, actor/time rendering, untrusted candidate content, focused Replay link; Replay opened at each answer; unavailable Escalation target without a fabricated frame; pause requested but never honoured before the Run ended. |

The pink Replay image is the browser fixture's deliberately minimal stored PNG; it is not a screenshot-load failure. An early 10.9 scrolled image was blank and was rejected as evidence. A fresh capture showed the bounded notice and list correctly at both widths.

## Findings kept open

- The Live View session strip still says **LIVE** when its connection is lost. The nearby warning and disabled controls correctly say the connection is lost. This existing discrepancy was already called out in the handover; this review confirms it remains.
- The Workspace's “Replay” and “Approved procedure” links remain closely spaced, as previously recorded.
- When a Timeline contains only an unhonoured pause request, its section introduction still describes pauses and resumes. The entry itself correctly says the Run ended before the pause took effect. This remains the previously recorded wording question.
- The unavailable Escalation Replay view repeats the absence explanation in several places. It displays no selected frame; the repetition remains a presentation observation.
- Read-failure-only adapter/pause variants and all rare sheet-2B combinations were not newly browser-captured in this pass. Existing unit coverage is not presented as screenshot evidence. Do not infer the handover's exhaustive all-state acceptance from this report alone.
- Sheet-2 wording, optional event fields, and the previously recorded bounded-history/inspection-scope decisions still require the same owner decisions as before.

## Evidence and verification

| Story | Tested head | Capture run / artifact | Browser tests | PNGs retained |
|---|---|---|---:|---:|
| 10.6 | `4846dcf2` | [run 36249693811](https://github.com/raeltec-systems/intellifin-audit/actions/runs/36249693811) · [screenshots](https://github.com/raeltec-systems/intellifin-audit/actions/runs/36249693811/artifacts/10908762759) | 27 passed | 35 |
| 10.8 | `e9c58dbb` | [run 36249110555](https://github.com/raeltec-systems/intellifin-audit/actions/runs/36249110555) · [screenshots](https://github.com/raeltec-systems/intellifin-audit/actions/runs/36249110555/artifacts/10908328922) | 16 passed | 8 |
| 10.9 | `dec4f12c` | [run 36249828385](https://github.com/raeltec-systems/intellifin-audit/actions/runs/36249828385) · [screenshots](https://github.com/raeltec-systems/intellifin-audit/actions/runs/36249828385/artifacts/10907909598) | 28 passed | 47 |
| 10.10 | `8760976e` | [run 36249860278](https://github.com/raeltec-systems/intellifin-audit/actions/runs/36249860278) · [screenshots](https://github.com/raeltec-systems/intellifin-audit/actions/runs/36249860278/artifacts/10908434061) | 30 passed | 61 |

Each linked run retains `story-10-visual-evidence`: named PNGs and JSON page facts (viewport, headings, title, focus, exact timestamps, document width). Retention is 14 days. Screenshots were opened and inspected, not inferred from a green test run.

The capture helper is opt-in through `STORY_VISUAL_CAPTURE=1`; it restores the test's viewport and scroll position. Existing test assertions, retries and CI gates were not weakened. The dedicated workflow runs the actual existing browser journeys with disposable synthetic accounts and database.

Local validation used Node 24.20.0 / pnpm 11.25.0: root typecheck passed for the capture additions; the combined post-fix source passed typecheck; Replay component tests passed (26 on 10.6, 37 on 10.9, 37 on 10.10). No main merge or deployment occurred. The transport-failure tests intentionally produce aborted request/route-boundary errors; these are not described as a clean-console run. Browser plugin was unavailable, so the repository's Playwright/Chromium workflow supplied the screenshots.
