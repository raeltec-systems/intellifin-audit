# Handoff validation

**30 September 2026 — planning, budget and reference-prototype checks.** This record accompanies the accepted revision-3 course correction. It does not claim application implementation or customer qualification.

| Area | Checked result |
|---|---|
| Contract coherence and preservation | CAP17–30 each has intent and success; all nine SPEC companions resolve. Independent review confirmed alignment with the accepted detailed source and architecture. Canonical Test workflows terminology corrected. Memlog records both validation verdicts. |
| Architecture | Installed BMAD spine linter: zero findings. Independent coherence, technology and adversarial reviews completed; stale-intent dispatch and zero-edit preparation lineage findings incorporated. |
| Backlog | `python validate_plan.py`: 9 epics, 55 unique stories, 143 acyclic dependency edges and coverage for 80 FR/NFR/CAP/UX identifiers. First batch is dependency-closed. First-Task gate now explicitly includes qualification infrastructure and actual helper execution. |
| Sprint tracking | Installed BMAD deterministic generation/validation uses the single standard sprint-status path. All new work starts backlog; historical completion is not inherited. See READINESS.md and the archived old queue. |
| Pair reference | Seventeen rendered desktop/narrow states; representative sign-in, takeover/handback, Pause/Stop, received/applied guidance, pinned output and narrow navigation checks. No observed page errors or horizontal overflow. Computer ownership controls remain visible; intermediate widths and Escape focus return checked. |
| Visual inspection | Engagement conversation, pinned work product, private sign-in, human control, reconnect and narrow surfaces inspected. A clipped control strip was repaired and re-rendered before packaging. |
| Operating budget | `python verify_budget.py`: 2,279 independent arithmetic/rate/link checks pass across all nine workload scenarios, support base, shared allocation, model quantities and Windows delta. Independent review corrected always-billed nonproduction networking; accepted speech input is explicitly priced. |
| Repository integrity | Managed AGENTS context unchanged. Earlier contract/backlog/status content and stable identifiers preserved in labelled archives. Application source and application tests are unchanged. Whitespace and active local-document links checked. |
| Download package | Deterministic ZIP contains repository-relative artifacts plus START-HERE.md/HTML. CRC and every packaged byte are checked during creation; root MANIFEST.sha256 records file hashes. Nested older ZIPs and installed dependencies are excluded. |

The Pair verification script is `../ux-designs/zobba-design-system-v1.0/source/verify-reference.cjs`; its prerequisites and local-server invocation are documented with the reference screens. System Chromium and Puppeteer were used because no connected Browser tool was available. Fixtures are clearly labelled and collect no credentials.

The budget calculator and verifier are in `../zobba-operating-budget-2026-09-30/`. They validate the declared estimate, not an AWS billing account, actual model quality or achieved capacity. The declared region, workload and commercial limits remain visible.

Whitespace validation accepts standard CSV CRLF endings. Five inherited whitespace findings remain only in the exact archived legacy epics/UX and the supplied font licence; their original bytes are deliberately preserved. Newly authored active text has no whitespace findings.

No Rust runtime, live managed-computer service, production migration or deployment was built by this planning change. No legacy application test suite is claimed to have run. Those checks belong to the explicit implementation stories and their gates. Customer application/service promises, processing/retention terms and pricing remain commercial commitments to settle before launch.
