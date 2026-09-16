# Live auditor verification — 17 September 2026 CAT

## Verdict

A real live Run was started through the deployed auditor interface. The repaired Solari workspace persistence path succeeded for a 223-character provider identity. The audit did not reach record inspection. Watch and Replay displayed no workspace frames, so the product's central agent-viewing experience is NOT accepted.

## Exact verification

- Run: `01a0ac97-ecca-789f-bcc1-f9c59a236c0f`.
- Live URL: https://web-production-edded.up.railway.app/runs/01a0ac97-ecca-789f-bcc1-f9c59a236c0f
- Procedure: Auditor walkthrough — leaver access review — 16 Sep 2026; version 1.
- Period: 1–31 August 2026, inclusive.
- Initiator: Live Verification Auditor, a separately created temporary auditor.
- Predecessor: `01a0ac83-dbe9-7612-ab2c-e5635af1c123`.
- Initiated: 2026-09-16T23:40:32.842Z / 2026-09-17 01:40:32.842 CAT.
- Watch opened: 2026-09-16T23:40:34.383Z, while Running.
- Worker reported end: 2026-09-16T23:40:42.332Z, approximately 9.49 seconds after initiation.
- Verification workflow: https://github.com/raeltec-systems/intellifin-audit/actions/runs/35163257561
- Browser harness revision: `ff1611ee12f707960c8381cb1c0fcc6ecc04f771`.
- Repair reference revision: `1e7dd7f742dd8bcf288146ba15389d99e4a237a1`.
- Worker deployment inspected: `4d5dcb7f-9b2f-44c8-aa67-9e6b20b5d53b`; runtime logs confirm PostgreSQL 18, schema 50 and Solari mode.

The repair reference is the code baseline used to plan verification. The artifact's `sourceCommit` field is this reference, not an independent deployed-Git-SHA attestation. The live Run itself exercised and persisted the 223-character identity.

## Method — deployed UI, not a fabricated database Run

Headless Chromium ran on the repository's GitHub Actions runner because the chat's local browser runtime could not resolve the live host. It accessed the deployed Railway application, not localhost, a mock, or the disposable database used by the separate Solari integration workflow.

A read-only preflight checked the existing stopped Run and its frozen target contract. Only the known synthetic Northstar host was allowed. The harness created a unique auditor using `seed-identity.mts --create-only true`, signed in through the live login form, opened the predecessor, pressed Rerun, and confirmed Start the new Run. It followed Open the linked Run and verified the persisted initiator/predecessor against the created identity and selected Run.

The browser opened the displayed Watch destination while Running, then visited Result, Execution Timeline, Evidence and Replay. Database access was limited to identity setup/cleanup, preflight and corroborating reads. No Run was inserted or executed directly through SQL. The deployed worker performed the stages.

Three earlier workflow attempts stopped before creating any user or Run: tooling setup once and safety preflight twice. The harness initially read `allowedOrigins`; frozen registration envelopes use `allowed_origins`. Correcting that field did not broaden the target allowlist. Exactly one audit Run was started by this verification.

## Actual outcomes

| Check | Result |
|---|---|
| Live auditor sign-in | Passed |
| Rerun through UI confirmation | A new correctly attributed and linked Run was created |
| Solari workspace | One attempt; provider identity length 223; subsequently Released |
| Target access | LoanCore sign-in recorded as Acquired; workspace/access Gate check passed |
| Population | 27 retrieved; 19 included; 4 excluded; 4 indeterminate |
| Snapshot freshness | Passed; generated 2026-09-01 for the August period |
| Record inspection | 0 inspected; 19 uninspected |
| Evidence | One population artifact retained; no target-inspection frames |
| Gate | 17 of 20 checks passed; overall Not passed |
| Outcome | Inconclusive; sealed; No conclusion issued |
| Watch | Opened while Running; no loaded workspace image or frame response |
| Replay | Opened; No frames; nothing available to play |

The worker independently reported this exact Run as stage `work`, diagnostic `population-key-unresolved`. Result and Timeline displayed: “A population record has no usable lookup key, or two records share one.”

The Gate identifies the actual issues more specifically:

1. Duplicate primary key `E-000107`.
2. Inclusion reconciliation: four indeterminate rows; the result lists invalid `termination_effective_date` values for source rows 6, 25, 26 and 27.
3. Per-record coverage: all 19 included records remain uninspected.

The immediate work-stage blocker is unresolved population identity, with a duplicate explicitly confirmed. Indeterminate inclusion also fails the Gate. This is not the earlier stale-snapshot failure, nor a repeat of the 200-character workspace constraint. A count of 17 passed checks does not mean that 17 records were audited.

## Watch/Replay acceptance boundary

The current viewer renders registered screenshot artifacts; its live event channel prompts server re-reads. It is not a direct video feed of every operation inside Solari. See `apps/web/app/runs/[id]/live/page.tsx`, `apps/web/src/runs/LiveViewer.tsx` and `apps/web/src/runs/WatchControl.tsx` at the repair reference.

Watch showed that no workspace screen had been captured. Zero workspace frames loaded during observation. Replay explicitly stated that this Run captured no workspace frames. The initial Watch capture was still Connecting, so these screenshots also do not prove successful live-event connection, reconnection or automatic refresh.

This verifies the absence of viewable work for this Run, not a broken image endpoint. Inspection never began. Successful provisioning and sign-in plus empty viewer pages do not demonstrate the intended experience of watching navigation/record inspection and replaying evidence-linked work.

## Scope, credentials and cleanup

The three demo accounts were not used or changed. The temporary password was randomly generated, masked, and not retained in reports or screenshots. The temporary auditor's role was removed after capture; its actor/name remains for the Run history. Provider identifiers were omitted from text and masked in viewer screenshots. Pink masks are verification redactions, not application rendering defects.

No procedure, population fixture, target data, migration state or production configuration was changed by this verification. No audit decision was fabricated. The temporary push-triggered workflow and its harness are removed in this closeout to prevent accidental additional live Runs; their tested versions remain in Git history.

## Next acceptance test

Preserve this Run as a negative/data-quality case. Establish an explicitly approved, separately identified positive population with unique employee IDs and valid in-period dates, leaving the defective source intact for negative testing. Run that case through the same live auditor workflow and demonstrate visible inspection, registered frame delivery and evidence-linked Replay. Do not disable identity, inclusion, coverage or freshness checks to manufacture a passing result. Clarify whether observing startup and non-secret access/navigation is required; post-inspection screenshots are not equivalent to continuous workspace viewing.

**Status: live workspace persistence repair verified for this case; complete audit execution and core Watch/Replay experience not accepted.**

## Evidence receipt

Artifact `deployed-auditor-journey-35163257561`, ID `10473668290`, contains `report.json`, nine viewport screenshots and nine rendered-text captures. SHA-256: `e2646bfbff28048a70daeb7323029faeb37d70d072b4c3743eb686b98cf5ff2d`. GitHub artifact retention is 14 days; a conversation evidence-pack copy was also retained.

Key captures: `04-watch-opened.png`, `06-result.txt`, `07-timeline.txt`, `07-evidence.txt`, `08-replay.png`.
