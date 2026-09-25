# Web/UX inventory against the 2026-09-24 course correction

Baseline: `main` at `c18ad36`. Produced by a read-only analysis agent on 2026-09-24; persisted by the correct-course session.

## Summary

1. The web app is ~46k lines of route/component code plus a ~5.2k-line design system, all built for a form-driven, section-by-section Procedure Builder and a tab-per-concern Run Detail — coherent, well-tested, but its whole IA is what the direction retires as primary experience.
2. A Run-scoped "conversation" already exists (`RunConversation.tsx` + `run-conversation.ts`, PR #51/Auditor Workspace v1.1) — but it is a fixed-vocabulary command console over five Run actions, not a general agent chat; no LLM ever generates a reply in it.
3. The only LLM-generated free text today is `WritingAssistant.tsx` (OpenAI Responses, `gpt-5.6-terra`), scoped to proposing prose for one Builder section — no planning, no tool use, no multi-turn reasoning over documents.
4. Evidence integrity, durable execution (pg-boss + worker), role gating, audit-event chain, approval workflow, Evidence Quality Gate and Replay are real backend architecture independent of the form UI — exactly the foundations the direction says to preserve.
5. Nothing touches Google/Microsoft/Gmail/Outlook/Drive/Calendar/Todoist/GitHub; Administration only knows "Population Source bindings" and "Target System registrations" with a bare credential-reference string. A connector/permissions settings surface needs building from scratch.
6. The Procedure Builder (`apps/web/src/procedures/*`, 104 files / 14,137 lines) is the largest single surface and the direction's most direct target: RETIRE as primary journey; its plan-preview/rule-wording/writing-assistant pieces are reusable, its wizard scaffolding is not.
7. Run Detail's five tabs + Live View + Replay + Evidence inspector + Exceptions (`runs/*`, 103 files / ~20.9k lines) are close to "artifacts the auditor can open, inspect, edit and approve" — REPLACE the shell, keep the semantics.
8. Administration (users, sources, systems) RETAINS as settings but must widen far beyond a bare credential-reference string into real connector scopes.
9. The design system (tokens, StatusBadge, Banner, ConfirmDialog, DataTable, confirmation weights, accessibility floor) largely survives a conversational rebuild; ~19 test files pin literal EXPERIENCE.md/DESIGN.md sentences that must be rewritten in lockstep with the contract.
10. EXPERIENCE.md's Information Architecture, Key Flows and "chat-first UI rejected" / "free text reaches the agent nowhere" lines are directly contradicted by the direction; its Roles/Gating, Accessibility, Evidence/Review state families, Confirmation weights and Formats are direction-neutral and should carry forward.

## Surface table

| Surface | Path | Size | Verdict | Why |
| --- | --- | --- | --- | --- |
| Sign-in | `app/sign-in` + `src/sign-in-*` | ~5 files, small | RETAIN | Auth is orthogonal to the experience model. |
| Overview | `app/page.tsx` + `src/overview/*` | 287 + 1,322 lines | REPLACE | Role-landing "needs attention" list is a reasonable shape for a conversation-first dashboard; content is Builder-shaped. Becomes an engagement/conversation entry point. |
| Procedures list | `app/procedures/page.tsx` + `src/procedures/list/*` | 234 + ~340 lines | RETIRE (nav) / REPLACE (data) | List view of form-authored Procedures goes; underlying records become one kind of artifact surfaced from conversation. |
| **Procedure Builder** (new + edit) | `app/procedures/new`, `app/procedures/[id]/builder`, `src/procedures/*` | 104 files / 14,137 lines | **RETIRE (primary journey)** | This is literally "the form-driven procedure builder as primary experience" the direction retires. Section-by-section (`BuilderSections`, `DraftBuilder`, `GuidedPreparation`, `TargetSelectionForm`, `ComplianceRuleForm`, `EvidenceScheduleForm`, `AuditInstructionsForm`) is a wizard, not conversation. |
| — reusable pieces inside it | `AgentSummary.tsx`, `ExecutablePlanPreview.tsx`, `plan-*.ts`, `condition-words.ts`, `WritingAssistant.tsx` | ~181+142+~600+810 lines | EXTEND → artifact view | Render/derive a read-only plan/rule/writing surface from frozen structured data; shape of a "plan artifact viewer" and a "writing assistant panel" once input comes from conversation instead of a form. |
| — pure wizard scaffolding | `BuilderStep.tsx`, `BuilderSections.tsx`, `GuidedPreparation.tsx`, `GuidedQuestions.tsx`, `TemplateContextForm.tsx`, `TargetSelectionForm.tsx`, `SourceChooser.tsx` | ~1,600 lines | RETIRE | Disclosure/step/section navigation has no place once the auditor states intent in one message. |
| Procedure Detail | `app/procedures/[id]/page.tsx` + `DetailTrail`, `VersionActions`, `VersionStatus`, `NewVersionButton` | 170 + ~600 lines | REPLACE | Version list/lifecycle badges become an artifact-history panel, not a dedicated page. |
| Version review | `app/procedures/[id]/versions/[versionId]` + `src/procedures/review/*`, `VersionDiff.tsx` | 139 + ~1,100 lines | RETAIN (approval flow) / REPLACE (UI) | Independent-approval and diff-by-section are exactly §C's "existing requirements for independent approval must remain enforced" and §G's "material changes… versioned and governed"; page becomes an artifact-approval panel, diff/decision-summary logic reusable. |
| Runs list | `app/runs/page.tsx` + `RunsTable.tsx`, `runs-list-words.ts` | 75 + ~450 lines | REPLACE | Becomes a filtered "executions" view attached to engagements/conversations rather than top-level nav. |
| Run Detail (5 tabs) | `app/runs/[id]/{page,exceptions,evidence,evidence/technical,review,timeline}` + `detail.tsx`, `Timeline.tsx`, `ResultSections.tsx`, `GateChecklist.tsx`, `ExceptionList.tsx`, `EvaluationReview.tsx` | ~1,700 route + ~5,000 src lines | REPLACE → artifact/evidence panel | This IS "plans, procedures, working papers, analyses, findings and reports as real, versioned working objects" (§A/F). Tab nav becomes a panel opened from a conversation citation. |
| Live View | `app/runs/[id]/live` + `LiveViewer.tsx`, `LiveGate.tsx`, `LiveBanner.tsx`, `useLiveTimeline.ts` | 354 + ~1,600 lines | REPLACE | "Watching the agent work" is the direction's core loop (§A); read-only stream/gate mechanics reusable, must live beside conversation not as a separate page. |
| Replay | `app/runs/[id]/replay` + `ReplayViewer.tsx`, `replay.ts` | 296 + ~700 lines | EXTEND → evidence view | "Inspectable outputs" (§A) maps directly onto frame-by-frame session record; retained as evidence/session artifact viewer. |
| Evidence inspector | `app/runs/[id]/evidence*` + `EvidenceCards.tsx`, `GroundingInspector`, `evidence-*-reader.ts` | ~780 route + ~1,000 src lines | RETAIN/EXTEND | §C/§F require preserved source snapshots, integrity, grounding — this IS that mechanism; becomes the "source snapshot" artifact panel. |
| Result / Gate / Exceptions | within Run Detail | ~1,000 lines | RETAIN/EXTEND | §F/§G want execution success, input completeness, assessment and review status kept distinct — already encoded exactly. |
| **Auditor Workspace v1.1 (conversation)** | `app/runs/[id]/workspace` + `RunWorkspaceShell.tsx`, `RunConversation.tsx`, `WorkspacePreview.tsx`, `RunControllerLease.tsx`, `RecordReview.tsx` | 126 route + ~3,500 src lines | EXTEND (foundation, not destination) | See below — closest existing thing to §A, but Run-scoped, fixed-command, non-generative. |
| Administration — Users | `app/administration/users` + `admin/UsersPanel.tsx`, `RoleControl.tsx` | 102 + ~500 lines | RETAIN | Role/permission model is the right primitive to extend for connector scopes (§C). |
| Administration — Population sources | `app/administration/sources*` + `BindingForm.tsx`, `bindings.ts` | 165 + ~700 lines | RETAIN, narrow scope | Today's only "connection" concept: a file/API binding + a bare credential-reference string. No OAuth, no per-action scopes. |
| Administration — Systems | `app/administration/registrations*` + `RegistrationForm.tsx`, `registrations.ts` | 186 + ~900 lines | RETAIN, narrow scope | Same gap: "Target System" registration is a URL + read-only permitted-actions list, not a connector-framework instance. |
| Notifications | `app/notifications` + `shell/NotificationBell.tsx`, `bell-items.ts` | 269 + ~250 lines | REPLACE | Becomes conversation-delivered notices; underlying open-wait/flag data model reusable. |
| Reviews (queues) | `app/review*` + `src/review/*` | 225 route + 674 src lines | RETAIN (semantics) / REPLACE (UI) | Independent-approval queue is a safeguard §C/§G preserve; becomes an approval panel over artifacts. |
| App shell / nav | `src/shell/*` | 1,056 lines | EXTEND | Sidebar/top-bar/breadcrumb mechanics carry over; nav items need renaming from Overview/Procedures/Runs/Reviews/Administration toward Conversation/Engagements, Artifacts, Settings. |
| Design system | `src/design/*` | 5,222 lines | RETAIN | Tokens, StatusBadge, Banner, ConfirmDialog, DataTable, confirmation weights, accessibility floor — reusable for conversation + artifact-panel layout. |
| Badges gallery | `app/badges` | 148 | RETAIN | Internal component showcase. |
| API: session/health/auth | `app/api/{session,health,auth}` | small | RETAIN | Infra. |
| API: Run control/events/frames/preview | `app/api/runs/[id]/{control,events,frames,preview,record-review-navigation}` | small | RETAIN/EXTEND | Server-signed, worker-verified control/evidence-read seams — exactly §D's "verifiable outcomes" and §C's "credentials outside model-visible content"; keep and generalize beyond Run scope. |
| Writing assistance (LLM) | `src/procedures/WritingAssistant.tsx`, `AuthoringChat.tsx`, `authoring-model.ts` | ~1,300 lines + backend | EXTEND | Only place an LLM generates free text today; narrow (one section, no tools, no memory) but structurally closest to a real engine: receipt/idempotency, streamed NDJSON, credential redaction, `finishReason === 'stop'` gating. |

## Auditor Workspace v1.1 conversation — what it is

`RunConversation.tsx` (client) + `run-conversation.ts` / `run-conversation-events.ts` (`packages/application`) + `conversation-content.ts` (AES-256-GCM at rest, `packages/infrastructure`), reached only from `apps/web/app/runs/[id]/workspace/page.tsx`.

**What it can do (closed set):** `interpretRunConversationMessage` is pure regex/string matching — no model call. Recognised: `pause now` (safety shortcut), `pause after this employee/record/inspection` (deferred-pause proposal bound to selected record), `resume`, `stop` / `stop now` / `stop the run`, `answer: <text>` (bound to an open wait), `flag` / `flag: <note>`, `note:` / `annotate:` (recorded only), `strategy:` (narrow proposal). A separate owner-approved **control-transfer** command lets an Audit Manager take over the live controller lease with a reason (`control-transfer-storage.ts`, `RunControllerLease.tsx`). Record selection ("current inspection") is server-read context the *auditor* sets via `RecordReview`, not something the model chooses.

**Storage/encryption:** every message body is AES-256-GCM sealed with a dedicated deployment key, AAD-bound to `[run, runId, messageId]`. Metadata (kind, source, sequence, links, command outcome) is immutable, unencrypted, appended to the same audit-event chain as every other Run fact.

**Any general free-text agent reply?** No. `RUN_CONVERSATION_MESSAGE_KINDS` is fixed (`auditor-message`, `platform-event`, `agent-explanation`, `decision-request`, `command-receipt`, `finding`, `evidence-reference`, `security-notice`, `annotation`). `agent-explanation` / `finding` rows are written by the worker from structured execution facts (narration templates, Escalation questions, evaluation results) — never sampled from a model given the auditor's raw text. Text not matching a command falls to `question` / `clarification` dispositions, which render only fixed clarification sentences — nothing generates a novel answer. This deliberately inverts EXPERIENCE.md's "free text reaches the agent nowhere" / "never conversed with, only closed choices" — but only as far as closed-command intake with server-side interpretation, not as far as an LLM conversational partner.

**Run-scoped only?** Yes, entirely — one route, one Run's message stream, one Run's controller lease. No engagement-, Procedure-, or cross-Run thread; nothing exists before a Run exists, and a Run requires an already-authored, already-approved Procedure Version (i.e. requires the Builder first).

**Honest verdict:** a genuine, well-engineered **control panel with a chat-shaped skin** — reliable idempotent command receipts, encrypted governed content, exact-command interception before any execution boundary, credential/secret redaction, controller-lease fencing. That plumbing (receipt-bound commands, encrypted storage, server-side interpretation before action, audit-chained history) is directly reusable under a real conversational engine. The conversational surface itself — intent recognition, question answering, planning, tool selection — does not exist here. Treat it as proof the safety/audit/idempotency pattern works, not as a partial implementation of the direction's agent.

## EXPERIENCE.md sections

**Contradicted by the direction:**

- Information Architecture table (Procedures/Builder/Procedure Detail/Version review as top-level sidebar-navigated surfaces).
- Key Flows 0–6 (every flow is "open Builder, fill section, submit" / "open Version review, read diff, approve" — exactly the "too much configuration before meaningful work" the direction names).
- Component Patterns: "Builder re-derivation", "Builder validation", "Compliance Rule editor", "Plan preview" as *editing* affordances (read-only-artifact framing survives; section-editing model does not).
- Interaction Primitives: *"Free text reaches the agent nowhere. Escalation notes and rationale fields are recorded only."* — directly reversed by §A.
- Inspiration & Anti-patterns: *"Rejected — chat-first agent UI: the agent is watched and answered through closed choices, never conversed with."* — the literal rule the direction overturns.
- Per-surface states keyed to Builder/Procedure Detail/Version review states — valid state machine, wrong surface.

**Still holds:**

- Roles and Action Gating table — matches §C's "permissions should distinguish reading from writing… routine vs. confirmation" exactly; extend, do not replace.
- Accessibility Floor — WCAG 2.1 AA, live regions, untrusted-content rules are shell concerns independent of IA.
- State Patterns → Evidence Quality Gate, Result outcome, Exception, Evaluation origin, Work Item families — encode §F/§G's required distinctions (source evidence vs. derived analysis vs. narrative; execution success vs. completeness vs. assessment vs. review status) almost verbatim.
- Component Patterns: Status badge, Conclusion triptych, Gate checklist, Grounding inspector, Provenance chain, Evaluation card/confirmation, Confirmation dialog weights, Untrusted-content rendering — reusable artifact-panel primitives.
- Voice and Tone / Formats — orthogonal to IA.
- UI cleanup section (2026-09-22) — "speak in audit tasks", Execution/Assessment/Evidence-checks framing, "say what is true, never an ordinary empty state" discipline all carry forward.

## Copy/UX tests that pin the old contract

`apps/web/src/design/copy.test.ts`, `status.test.ts`, `tokens.test.ts` (status/tokens likely survive largely unchanged; `copy.ts` Builder/Run-flow sentences will not); `apps/web/src/admin/administration-words.test.ts`; `apps/web/src/overview/{AttentionList,RecentRuns,RoleLanding}.test.ts`; `apps/web/src/procedures/list/procedures-list-words.test.ts`; `apps/web/src/review/review-words.test.ts`; `apps/web/src/runs/{EscalationPanel,PauseBanners,RunDetail,RunFlagControl,RunsTable,gate-rows,labels,live-status,live-view,runs-list-words,session-words}.test.ts`; `tests/unit/denial-strings.test.ts` (pins Roles/Gating denial sentences — likely survives, direction-neutral); browser specs reading EXPERIENCE.md: `tests/e2e/{agent-sign-in,flag-run,live-escalation,live-view,pause-resume,procedures,replay,run-surfaces,runs,shell,sources}.spec.ts` (`procedures.spec.ts` and `shell.spec.ts` most exposed to IA change; the Run-control specs mostly assert behaviour mapping onto surviving safeguards).

Net: ~19–20 files pin literal contract text. Expect a two-tier rewrite: (1) EXPERIENCE.md needs a new Information Architecture / Key Flows for conversation + artifacts while keeping Roles, Accessibility, Evidence/Review families and Formats; (2) the ~20 test files need literal strings re-derived from the new contract in the same commit, per this project's own convention ("a sentence retyped in a test is a sentence pinned against nothing").
