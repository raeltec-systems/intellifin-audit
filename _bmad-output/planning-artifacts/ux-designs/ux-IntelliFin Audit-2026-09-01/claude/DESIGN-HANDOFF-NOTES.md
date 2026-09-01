# IntelliFin Audit — Design Handoff Notes

> **Revision 2 (2026-09-01).** After stakeholder direction, the product proposition was extended:
> auditors author procedures (hybrid plain-language → compiled step plan → self-activation, with
> scheduling), and the agent session is a hero experience — watched live in a read-only sandbox or
> replayed later. This supersedes the PRD's "authoring deferred / agent activity subordinate"
> stance for screens P-5, New procedure, and Agent session; the four preconfigured procedures and
> all evidence/review guarantees are unchanged.

Prototype: `mockups/IntelliFin Audit.dc.html` (single runnable file, working navigation and state
switching). Visual contract: `DESIGN.md`. Sources: `uploads/brief.md`, `uploads/prd (1).md`,
`uploads/addendum.md`. Design system: IntelliFin Design System (bound, "Ledger Signal").

## 1. Design assumptions

Every item below is a design decision not settled by the sources.

1. **Product placement.** IntelliFin Audit is treated as an audit surface of the IntelliFin
   Business Suite and inherits its shell, tokens and components rather than establishing a separate
   identity.
2. **Currency.** Transaction amounts stay in USD as specified in the addendum, so the parent
   system's ZMW/`K` formatting rule does not apply to LedgerFlow and ApproveNow values. Formatting
   otherwise follows the parent system (tabular numerals, right alignment, decimals shown).
3. **Monospace.** The parent system defines no monospace token. A system monospace stack is used for
   identifiers, values, digests, timestamps and trace data; a self-hosted face should replace it.
4. **Viewport.** Primary target 1280–1600px, usable at 1024px, narrow-screen reading mode described
   in DESIGN.md but not mocked. No separate mobile product.
5. **Chief Audit Executive.** No separate executive dashboard. The CAE role is a read-only consumer
   of Overview and detail views; all mutating actions are disabled with a stated reason.
6. **Role switcher.** The top-bar "Signed in as" control is a prototype affordance for demonstrating
   role gating. In the built product, role comes from the session.
7. **Overview "Preview state" control.** A prototype affordance for demonstrating empty states
   (no Runs, nothing needing attention, no matching filters). Not a product feature.
8. **Administration visibility.** The Administration nav item is shown only to the PoC
   Administrator. Other roles do not see a disabled entry, because the item is not state-dependent.
9. **Run identifiers.** `RUN-nnnn`, Exceptions `EX-<run>-nn`, Evidence Packages `EP-nnnn`, Procedure
   Versions `Pn vX.Y.Z`. The sources do not specify identifier formats.
10. **Overview time window.** "Last 30 days" is a display default, not a configurable filter.
11. **Prototype mutability.** Actions open real confirmation dialogs but do not mutate state; the
    confirmation returns an information banner saying so. Run progress does not tick.
12. **Evidence reliability summary.** The Overview counts of gate outcomes across recent Runs are a
    design addition intended to answer "can I trust the evidence"; they are counts, not a metric or
    a chart.
13. **Agent session (revision 2).** The session viewer shows realistic mock screens; frame cadence
    (~3s) is a demo affordance. Live mode is watch-only + cancel by product decision. Session
    recording is preserved in the Evidence Package (artifact `session SBX-2437-01`).
14. **Authoring (revision 2).** New procedures self-activate by the authoring Auditor and freeze an
    immutable Procedure Version; "Edit" affordances in the compiled plan are shown but not
    functional in the prototype. Scheduling is a per-procedure field (P-5 runs weekly); the four
    preconfigured procedures remain manual.

## 2. Component inventory

Inherited from the design system bundle (`IntelliFinDesignSystem_92c78d`):
Sidebar · Button · StatusBadge · Banner · EnvironmentRibbon · EmptyState · Tabs · Icon (Lucide
subset, self-hosted at `mockups/assets/lucide-icons.js`).

Audit-specific patterns composed from tokens (documented in DESIGN.md → Components):

| Pattern | Where used |
| --- | --- |
| Conclusion triptych (lifecycle · gate · outcome + statement) | Run Detail → Result |
| Evidence Quality Gate checklist (9 checks, diagnostic + rule) | Run Detail → Result and Evidence |
| Execution-failure panel (Source, retries, error class) | Run Detail (Run Failed) |
| Safe next action panel | Run Detail (Inconclusive, Run Failed, Canceled) |
| Population reconciliation table | Run Detail → Result |
| Exception list row (id, state, title, criterion) | Run Detail → Result and Exceptions |
| Evidence item card (9 metadata fields + preservation note) | Run Detail → Evidence |
| Provenance chain (6 numbered steps) | Exception Detail |
| Values-compared table (original and normalized) | Exception Detail |
| Employee-level grouping with account-level outcomes | Exception Detail (P-1) |
| Untrusted-source-content block | Exception Detail (EX-2431-01) |
| Disposition and review history list | Exception Detail, Run Detail → Review |
| Reviewer "Before deciding" panel | Run Detail → Review |
| Staged execution trace row (stage, status, duration, sanitised call) | Run Detail → Execution trace |
| Agent session viewer (sandbox chrome, mock-screen frames, scrubber, narration rail) | Agent session (live + replay) |
| Authoring wizard (intent textarea, compiled-plan editor rows, activation consequences) | New procedure |
| Session entry card | Run Detail rail (Runs with a recorded session) |
| Action bar + "Unavailable actions" explanation panel | Run Detail, Exception Detail |
| Confirmation dialog (with optional required rationale) | All mutating actions |
| Filter bar (procedure select, status chips, search) | Runs |
| Control coverage rail item | Overview |

## 3. Screen and route inventory

Navigation state is held in the prototype; each destination is reachable by clicking.

| Screen | How to reach |
| --- | --- |
| Overview | Sidebar → Overview |
| Procedures | Sidebar → Procedures |
| Procedure Detail (P-1…P-4) | Procedures → procedure name |
| Runs | Sidebar → Runs |
| Run Detail — Result / Evidence / Exceptions / Review / Execution trace | Runs → Run identifier, then tabs |
| Evidence Quality Gate + Evidence Package | Run Detail → Evidence |
| Exception Detail | Run Detail → Exceptions → Open provenance |
| Review queue | Sidebar → Review |
| Review Detail | Review → Review record (Run Detail → Review tab) |
| Execution Trace | Run Detail → Execution trace |
| Administration | Signed in as → PoC Administrator, then sidebar → Administration |
| New procedure (3-step wizard) | Procedures → New procedure |
| Agent session — live | New procedure → Activate and run now — watch live |
| Agent session — replay | Run Detail (RUN-2437) → Replay session |

### Run Detail variants (all six required states)

| Run | Variant |
| --- | --- |
| RUN-2437 | Completed · Control Failure · 1 Exception · Draft — user-authored P-5, with recorded agent session (live + replay) |
| RUN-2418 | Completed · Pass · gate passed · Draft (not yet reviewed) |
| RUN-2431 | Completed · Control Failure · 3 Exceptions · Submitted |
| RUN-2427 | Inconclusive — AccessGate population short by 4 records, duplicate RoleMatrix policy entry |
| RUN-2433 | Run Failed — ProdConsole unreachable after 3 bounded retries |
| RUN-2402 | Completed · Control Failure · Approved, awaiting deliberate finalization |
| RUN-2388 | Completed · Control Failure · Finalized, immutable, with a recorded reviewer disagreement |

Additional lifecycle coverage: RUN-2435 (Running), RUN-2436 (Queued, no Evidence), RUN-2415
(Canceled with preserved partial Evidence).

## 4. States demonstrated

- **Run lifecycle:** Queued, Running, Completed, Inconclusive, Run Failed, Canceled.
- **Evidence Quality Gate:** passed (9/9), not passed (3 failures with diagnostics), incomplete
  (blocked checks after a Source could not be acquired), not evaluated (Queued, Canceled).
- **Gate checks:** all nine checks with per-check pass, fail, and not-evaluated detail.
- **System Outcome:** Pass, Control Failure, no conclusion issued.
- **Auditor Review:** Draft, Submitted, Approved, Rejected (in RUN-2388 history), Finalized,
  reviewer disagreement recorded.
- **Exceptions:** Open, Under review, Confirmed, Not an Exception with rationale; boundary case
  (USD 100,000.00 exactly); unmatched record; grouped employee with three accounts and mixed
  account-level outcomes; untrusted prompt-like source content rendered inert.
- **Empty states:** no Runs yet, nothing needs attention, no matching filters, no prior Run for
  comparison, no Evidence collected, no review events, no Exceptions (with copy that differs
  depending on whether the gate passed).
- **Role gating:** Auditor, Audit Manager, PoC Administrator, Chief Audit Executive — each with
  disabled actions and stated reasons.
- **Denied transitions with explanation:** submission blocked for Inconclusive / Run Failed /
  Canceled; finalization denied from Submitted; mutation denied after finalization.

## 5. Accessibility decisions

- Contrast targets WCAG 2.1 AA using the parent system's tested token pairs. Gold is never used for
  text below 18.5px and never for status.
- No status is conveyed by colour alone: every badge carries an icon and a text label, and every
  gate check repeats its status as a word.
- Focus is visible everywhere (2px teal ring, 2px offset) and never suppressed.
- Tables use real `<th scope>` headers; the first cell of every Run row is a focusable link, so no
  action requires hovering a row. Actions in list rows are persistent links, not hover reveals.
- Explanations are never tooltip-only: disabled action reasons are also rendered as text.
- The confirmation dialog uses `role="dialog"`, `aria-modal`, and a title that names the
  consequence. Rejection and disagreement expose a labelled rationale field.
- Filter chips are `aria-pressed` toggle buttons; the preview-state control is a labelled group.
- Long identifiers wrap with `overflow-wrap: anywhere` rather than truncating evidence values.
- Untrusted source content is rendered as inert preformatted text, never as markup.

## 6. Source requirements not represented, and why

- **FR-1 authentication, FR-24 Audit Trail viewer, NFR-1/NFR-3 security and integrity mechanics.**
  Sign-in and a dedicated Audit Trail browser are out of the requested surface list; audit events
  surface contextually in review history, disposition history and the execution trace.
- **FR-26 Workpaper Bundle contents.** The export action and the bundle's declared contents are
  shown in the confirmation dialog; the exported artifact itself is not designed (PRD open question
  4 — export formats are undecided).
- **FR-27 reproduction workflow.** Represented as the reviewer's "Before deciding" path and the
  bundle export, not as a separate reproduction tool.
- **FR-31 setup and reuse instrumentation.** Measurement is a programme activity, not a product
  surface; no screen was invented for it.
- **NFR-5/6/8/12 performance, recovery and retention.** No UI implication in the PoC.
- **Scheduling, procedure authoring, alerts, trend analysis.** Explicit non-goals; deliberately
  absent, and Procedure Detail states that authoring is out of scope.
- **P-2 and P-4 exception detail.** No procedure produced Exceptions for segregation-of-duties or
  configuration deviation in the synthetic dataset used here (their Runs are Inconclusive, Run
  Failed, Running and Queued, which is where those procedures' required states are demonstrated).
  Exception Detail is procedure-agnostic and would render them identically.

## 7. Unresolved UX questions

1. **Rerun conflict.** FR-6 prevents overlapping active Runs for the same Procedure Version and
   period. The explanation copy exists, but should a blocked rerun offer "open the active Run" or
   "queue after it completes"?
2. **Exception prioritisation.** Exceptions are currently ordered by identifier with a severity
   note. Should the list rank by amount, elapsed breach, or record count — and is that ranking part
   of the Procedure contract or a view preference?
3. **Workpaper Bundle export.** Format and delivery (download, archive, link) are undecided
   (PRD open question 4). The dialog names contents only.
4. **Disagreement placement.** Reviewer disagreement can be recorded against a System Outcome or a
   single Exception. The prototype records it at Result level from the Review tab; Exception-level
   disagreement needs its own entry point.
5. **Masking policy.** FR-19 requires sensitive fields masked in list views. The specific field set
   is not defined in the sources; no field is currently masked in the synthetic data.
6. **Notification of state change.** Runs update without a page reload, but nothing tells an auditor
   that a Run they initiated finished while they were elsewhere. Is an inbox, a nav count, or
   nothing the right answer for the PoC?
7. **Canceled reruns.** Should cancelling automatically offer a linked rerun, or must the auditor
   initiate it explicitly from the Procedure?
