# IntelliFin Audit — LoanCore final acceptance

**Decision: ACCEPTED for the scoped LoanCore execution, evidence-delivery, Watch and Replay close-out.**

18 September 2026 · Repository: `raeltec-systems/intellifin-audit` · Acceptance issue: #45

The two application repairs are merged and released. The final deployed journey, independent database readback, fresh-login verification and visual QA are complete. This accepts the tested synthetic LoanCore procedure, not every platform feature or all remaining usability polish. Issues #49 and #50 remain separate, nonblocking follow-ups.

## 1. Released revision and verification chain

Application revision: `44fb5966dd085f53625d5f9ac77a466a9c18805f`.

PR #47 restored verified evidence MIME delivery without rewriting historical evidence or weakening authorization, size or digest checks. PR #48 top-aligned the shared Watch/Replay stage so a growing Evidence column cannot push the workspace image below the viewport. Both followed normal PR checks and merge/release handling.

| Verification | Workflow | Result |
|---|---:|---|
| PR #48 checks | 35335573874 | All five jobs passed |
| Main-branch checks | 35337577678 | All five jobs passed |
| Normal production release | 35339527945 | Migrations and all three service deployments passed |
| Final deployed acceptance | 35340181283, attempt 1 | 36/36 required assertions passed |
| Independent read-only database verification | 35340470537, attempt 1 | 7/7 assertions passed |
| Strict fresh-login and Replay selection verification | 35342862535, attempt 1 | 7/7 assertions passed |

The final application was exercised at `https://web-production-edded.up.railway.app`. Railway reported SUCCESS for web deployment `155833e3-ded4-4b88-a5a3-3dd4d8794554`, worker deployment `a685f9f2-c7cf-4251-b0e7-9e899557ed58`, and Northstar deployment `8fa0fd14-4fdd-452f-9e29-11a106b89c8a`. Worker startup verified PostgreSQL 18, schema 50 and Solari mode with provider recording disabled.

The primary observer first required the exact normal release to succeed. It verified that application files matched the released revision and that its assembled harness matched SHA256 `12ea9f4c3eafe009d3a7f712a746d5c92db14bd90b2536b4db82d820776a91c5`. This continuation changed validation scripts and close-out records only; it did not change application code, source fixtures, provider choice or production configuration.

## 2. Actual workflow and findings

The browser journey created and configured the Procedure, checked saved sections, submitted it, refused self-approval, approved it through a different Audit Manager identity, activated it and initiated a real Run. It then observed actual model/worker/Solari execution, opened evidence, exercised Replay, submitted the required auditor confirmations and tested the unchanged defective source.

Positive Run: `01a0b44d-b1d2-7596-87e3-7d6dba84e091`.

The clean source contained three records: all were included and inspected, with no excluded or indeterminate records. Captured identity, username, status and roles matched the independent fixture oracle and supporting evidence.

| Record | Username | Observed status | Role | C1: disabled account | C2: frozen privilege policy |
|---|---|---|---|---|---|
| E-000102 | b.tembo | Disabled | LOAN_VIEWER | Compliant | Compliant |
| E-000103 | c.zulu | Active | LOAN_OFFICER | Exception | Compliant |
| E-000105 | e.kabwe | Disabled | COLLECTIONS_AGENT | Compliant | Compliant |

The Evidence Quality Gate passed **20/20 checks**. The Result initially remained unsealed, awaiting confirmation of three Agent-Judged evaluations. Three decisions were submitted through the auditor UI and independently read back from the immutable review ledger. The final Result was **sealed CONTROL_FAILURE, version 2**. That is the expected audit finding: E-000103 retained an active account. It is not an application failure.

The original machine proposals remain unchanged, including their original pending confirmation fields. Effective confirmation comes from the retained review decisions. The independent read-only verification checked that overlay, all six effective evaluations, the three decisions and the different author/approver identities. No original proposal or historical decision was rewritten.

## 3. Watch and Replay: visible pixels, not just successful requests

The deployed Watch session delivered **15 frames representing eight distinct screens**. Fourteen captures were taken while the same Run was RUNNING both before and after the screenshot. All fourteen had **100% of the workspace image inside the 1440 × 1000 viewport**, an unobscured centre and no Watch scrolling. The final ended-state frame was not counted as live execution. All three record identities appeared in the Watch experience.

Visual QA inspected all 15 Watch captures, all 15 fresh Replay captures, all 15 historical Replay captures and nine additional journey captures. It also inspected the eight unique underlying target images and the five final fresh-login screenshots. The account screens visibly corroborate the three records above. The previous stage-displacement defect is resolved; no blank page or framework error overlay appeared in the reviewed captures.

Fresh Replay delivered **15/15 verified frames after workspace release**, covering all three records. Playback advanced, selection changed the displayed frame and retained bytes matched their registered digests. Historical Replay also delivered **15/15 frames**, with historical evidence metadata preserved. Structural snapshots and evidence links were exercised.

The final supplementary check signed in as a fresh temporary auditor and reopened the existing results. It required the exact selected evidence IDs for all three account screens, awaited image decoding and paint, and captured the resulting screen. The sealed Result survived reload, all three confirmed review cards remained visible, the transient queued message disappeared, and the negative Result remained inconclusive. No new audit Run was started by these reload probes.

This is **action-linked screen capture and replay, not continuous live video**. In this sample, frame delivery spanned 118 seconds, with an eight-second median gap and a fourteen-second maximum gap. Those observations are not a latency guarantee.

## 4. Defective-source regression, safety and cleanup

Negative Run: `01a0b452-3b49-71c8-846d-8aac3cc45884`.

The original source remained unchanged and declared 27 records. Processing reported 19 included, four excluded and four indeterminate records, with unresolved population identity and a duplicate key. The Run ended honestly **INCONCLUSIVE**, with a sealed inconclusive Result, failed evidence gate, **zero observations and zero evaluations**. The UI explained why no conclusion could be issued. The negative Procedure's saved scope correctly referred to 27 records.

Both audit workspaces were released. Primary HTML, timeline/API and capture-containment checks passed; credential-entry capture remained suppressed. The inspected target images did not expose passwords or raw provider workspace handles. These are scoped checks of the exercised surfaces, not a blanket security certification.

All **six temporary identities** used in this continuation have zero roles and zero sessions: three primary journey identities and one for each of three supplementary probes. Cleanup was verified independently. Historical users, Procedures, Runs and review decisions remain as audit history; access was revoked rather than deleting that history.

The final fresh-login probe recorded **zero browser console errors, zero console warnings and zero page exceptions** on the exercised sign-in, Result and Replay routes. Worker logs were not warning-free: the unsupported temperature warning is tracked in #50.

## 5. Evidence integrity and test corrections

The downloaded ZIP digests, CRCs, file sizes and manifest hashes were verified. The final evidence consists of three unmodified workflow archives:

| Purpose | Artifact ID | Manifest entries | ZIP SHA256 |
|---|---:|---:|---|
| Deployed acceptance | 10544927223 | 181 | `1995ec3e84afe5eb8a7ae5a55a4e00dd72fa29c92a16260e0f42212b68bee99c` |
| Persisted readback | 10544947088 | 2 | `3710b1244a0afdfd5ef277c19608afa1541ac341c8deb72971a1a63312ff0751` |
| Strict fresh-login readback | 10545820704 | 13 | `a2618fd0ff527dae06c9224f5824b0c8e6336a5129ef890a30e4214827b226e7` |

The primary raw `report.json` deliberately retains `accepted: false` and `visualReviewRequired: true`; it records automated results, not visual sign-off. Its SHA256 remains `c84a74ab31f3c20e6f9efe56ee3a829e9e62b4c8f38c4b68ee889f6c057e8855`. This report and the separate `loancore-final-signoff.json` record the completed visual review without altering the original evidence. The detailed sign-off JSON has SHA256 `17dc8b7e3d5d95bbf5b721212a8066268b8d105e952fd861955b3071647863ad`.

Two supplementary observer limitations were corrected and retained as history. Run 35341913450 counted a vocabulary-legend badge as a fourth confirmation; the correction scoped the assertion to the three review cards. Run 35342340236 passed its automated checks but its first Replay screenshot did not prove the requested selection, because the click preceded React hydration. The final observer requires the exact evidence ID and decoded, painted image; run 35342862535 passed that stronger check. These corrections changed the observer, not the application or stored outcomes. The primary acceptance already checked all 15 Replay frames explicitly.

GitHub lists these artifacts as expiring on **2 October 2026**. A local evidence package contains the three final archives, the two supplementary historical archives, the report, detailed sign-off, selected native screenshots and a checksum verifier.

## 6. Remaining boundaries and handover

This was desktop Chromium validation at 1440 × 1000, with the prior PR regression also exercising widths 1440 and 1280. It is not mobile, cross-browser, concurrency, production-data or whole-platform certification. The tested scope was the synthetic August 2026 LoanCore procedure and its defective-source regression; no 24-hour revocation rule is asserted.

The auditor and manager roles were exercised through scripted, separate test sessions. Visual review was AI-assisted inspection in this conversation. Neither should be represented as an independent human product-owner signature or a real-client assurance conclusion.

**#49 remains open:** replace technical Run, workspace, observation and reviewer identifiers with readable labels while preserving internal provenance. **#50 remains open:** stop supplying unsupported temperature parameters to the selected reasoning model without suppressing warnings globally or changing the owner's provider choice. Neither prevented this scoped acceptance; neither is claimed fixed.

Validation work was saved in atomic commits on `validation/loancore-watch-closeout-20260918`: `1b9ee961` for the release-gated journey, `c099e90d` for independent persisted checks, and `44010979` for the final strict fresh-login observer, with the intermediate corrections retained. The completion records follow on that branch. The already released application remains `44fb5966`; documenting acceptance is not another application deployment.
