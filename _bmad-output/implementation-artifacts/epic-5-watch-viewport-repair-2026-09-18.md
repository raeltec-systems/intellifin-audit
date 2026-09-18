# Epic 5 Watch viewport repair — 18 September 2026

## Why a second bounded repair is necessary

The MIME-delivery repair in PR #47 was merged and normally released as `816d6b521a53011fd956582b361fafa1c60654d7`. Deployed workflow `35333706645` then passed its automated assertions: normal UI preparation/independent approval, three of three canonical LoanCore records inspected with OpenAI, exact fixture results, human C2 confirmation and sealed CONTROL_FAILURE, decoded changing frames, all Replay frames after workspace release, historical evidence readback, unchanged defective-source regression, and temporary-access cleanup.

That is not a visual acceptance result. Manual review of its real 1440 × 1000 Watch captures found that the workspace image moved down as the Evidence rail grew. `04-watch-frame-03.png` shows the actual screen starting near the bottom of the viewport beneath a large empty stage. An image can be decoded (`complete` and `naturalWidth`) while its meaningful pixels are not visible to the auditor.

Source evidence: workflow artifact `10542034590`, ZIP SHA256 `83d2eda4a302fb45e94d3792fa0979e79b011f4a9bd30c8719a82ecc1a6aa342`; the archive and all 180 manifest entries were verified. Clean Run `01a0b404-76f0-7911-9f61-9ea810c1b026`. Overall acceptance issue #45 remains open.

## Cause and minimal repair

The shared session body is a two-column CSS grid. Default grid stretching makes the stage as tall as the activity/evidence rail. The stage is itself a flex container with vertically centered content. Therefore, increasing the rail height moves the image down even though neither its own size nor the Run has changed.

`SessionStage` now declares `alignSelf: 'start'`. This is a constant structural property owned by the shared Live View/Replay component, not a new visual token or dynamic user input. The stage keeps its own intrinsic size and existing minimum height instead of inheriting its sibling's growing height. Existing typography, colors, spacing, image sizing, responsive floor, controls, evidence route and secret boundaries are unchanged.

No source, observation, result, historical image, provider configuration or lifecycle is altered. This is an Epic 5 usability defect, not a new epic or a redesign.

## Regression and acceptance distinction

The added Playwright case in `live-view.spec.ts` uses the existing real application, protected frame route, worker signer, synthetic storage and disposable database. At desktop widths 1440 and 1280, it grows the rail to 2400 pixels and asserts that the stage stays top-aligned and the decoded image's offset does not change. It explicitly demonstrates that restoring the old stretch behavior displaces the frame, then reloads the real component and rechecks the fix. This geometry stressor exists only in the test fixture; it is not used to change a production page during acceptance.

The deployed follow-up must observe naturally growing real evidence with no DOM or CSS mutation and require physical viewport intersection before counting a Watch frame as seen. Replay selection must also be followed by a visible decoded frame. A fresh same-Run RUNNING sequence, the entire positive/negative acceptance, exact deployed revision, cleanup and visual review remain required. The earlier successful automated report is preserved as evidence of what it proved and what visual review still rejected.

## Verification boundary

Application fix and browser regression are committed separately on `fix/epic-5-watch-viewport`. Normal PR CI, review, merge, main CI and the normal release workflow are required before deployed acceptance. No success is claimed in advance. Browser plugin is absent; the existing Playwright workflow is the browser execution path.
