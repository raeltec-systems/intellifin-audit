# Handoff · Zobba design system v1.0

Date: 25 Sep 2026. From: design. To: the BMAD agent and the product-planning and implementation teams.

This package is the authoritative **design input**. It is not application code, and it does not edit the approved BMAD/course-correction documents. Reconcile it into them using §4.

## 1. Index

| Document | Contents |
|---|---|
| [BRAND.md](BRAND.md) | Identity, Pair, logo system, colour rules, typography, Raeltec, voice |
| [DESIGN-SYSTEM.md](DESIGN-SYSTEM.md) | Layout, surfaces, icons, motion, navigation, status, tables, forms, search, connections, states, responsive, accessibility |
| [EXPERIENCE-RULES.md](EXPERIENCE-RULES.md) | Numbered interaction rules (R1–R12) |
| [COMPONENT-INVENTORY.md](COMPONENT-INVENTORY.md) | Components by group |
| [PATTERNS.md](PATTERNS.md) | End-to-end patterns P1–P16 |
| [DESIGN-TOKENS.md](DESIGN-TOKENS.md) · [tokens/zobba-tokens.json](tokens/zobba-tokens.json) | Canonical tokens and calculated contrast (generated together) |
| [reference-screens/](reference-screens/README.md) | 18 reference screens (PNG) and the scenario |
| [ASSET-MANIFEST.md](ASSET-MANIFEST.md) · [assets/](assets/) | Logo, symbol, icon and favicon files |
| [OPEN-QUESTIONS.md](OPEN-QUESTIONS.md) | Q1–Q12 |
| `source/` | Editable design sources |

## 2. Decisions preserved

Name **Zobba** · descriptor "The audit agent" · "by Raeltec" · Pair concept · title-case wordmark with stepped bb · Graphite, Linen and Iris `#4C3FB8` · Hanken Grotesk and IBM Plex Mono · Permissions · conversation-led harness with a contextual workspace · chrome is Zobba, the artifact is the methodology's · first-person conversation and "Zobba is…" chrome · harness navigation (Library removed from the first level, Skills under Settings › Methodology and skills).

## 3. Completed in this pass

| Item | Rationale |
|---|---|
| Outlined wordmark and lockup SVGs; stepped b keeps 50% of the ascender (was about 35%); weight 600 (was 650 variable) | Readable as bb at 16px; UI maximum weight is 600; static outlines for implementation |
| Optical channel variants (`-small`, `-micro`) exported as separate files | The forms must not merge at small sizes |
| `color.border.input` `#8F8A7F`; placeholder `#716D64` | Earlier values failed 3:1 non-text and 4.5:1 text respectively |
| Six separate status dimensions with a vocabulary | Prevents result, execution and review from being collapsed |
| Workspace replacement rule (R2.2) | The panel must not replace what the auditor is inspecting |
| Guidance queued → applied acknowledgement | Distinguishes guidance from Stop |
| Per-operation outcomes, including unknown-after-dispatch and partial | Honest reporting of external actions |
| UI motion table, layout modes, responsive breakpoints, forms, tables, search, connections, empty and degraded states | Previously unspecified |
| Scenario corrected: auditor firm = Lumina Assurance, client = Northstar Bank plc; draft email no longer says the invitation "has been sent" | Internal consistency |

### Added after the first handoff (25 Sep)
- **Role-based screens** for the audit manager (Reviews queue, reviewing a paper) and administrator (Models and providers, Users and roles). See DESIGN-SYSTEM §5a, EXPERIENCE R8a, PATTERNS P18–P19, and reference screens 20–23.
- **Model and reasoning-effort choice in the composer**, within admin policy and recorded in How it ran. See DESIGN-SYSTEM §5b, COMPONENT-INVENTORY › Composer, PATTERNS P17, and screens 19 and 22.
- Every composer in the reference screens now shows the model chip.

## 4. Reconciliation notes

1. **Terminology.** **IntelliFin Audit → Zobba** everywhere in product copy and specifications. **Mandate → Permissions** everywhere. Access keeps its audit meaning only.
2. **Earlier boards** (`Audit Agent Desktop v2`, the three-direction `Zobba Identity`) used the earlier accents and names. Where they conflict with this package, this package wins for visual rules. Interaction rules were preserved, not changed.
3. **Scenario identities** changed. Earlier screens showed the auditor at a "northstar-audit.com" address auditing Northstar, which was contradictory. Update any story fixtures to Lumina Assurance / Northstar Bank plc.
4. **Navigation.** If existing rules list Library or Skills at the first level, replace them with DESIGN-SYSTEM §5.
5. **Serif.** Earlier boards used a serif for the Home greeting. The approved identity has no serif. The greeting is Hanken 38/46 600.
6. **"Completed" vs result.** Any existing rule that treats a completed scheduled run as a pass must be split per DESIGN-SYSTEM §6.

## 5. Rule → component → token → screen map

| Rule | Components | Key tokens | Screens |
|---|---|---|---|
| R1 Conversation primary | Composer, Auditor message, Zobba response, Activity | `type.body`, `radius.composer`, `border.input` | 01, 02, 03 |
| R1.4 Guidance vs Stop | Composer, Activity | `text.placeholder` | 02, 03 |
| R1.5 Clarification | Question, Suggested replies, Presence (waiting) | mark waiting | 08 |
| R2 Workspace | Workspace panel, Browser view, Working data | `layout.panel-*` | 03, 04 |
| R3 Artifacts | Artifact page, Provenance footer, State chip | `surface.artifact-*`, `shadow.page` | 05, 07 |
| R4 Evidence | Citation, Preview, Evidence drawer | `accent.wash`, `selection.*`, `shadow.drawer` | 05, 06 |
| R5 Changes | Diff, System event | `diff.*` | 07 |
| R6 Permissions | Summary, Detail, Activity record | — | 09, 10, 16 |
| R7 Confirmation | Confirmation card | `action.primary.*` | 09 |
| R9 Scheduled | Status chips, Presence | `status.*` | 12, 13, 18 |
| R10 Search | Search results, Inline notice | `status.warning.*` | 11 |
| R11 Honest state | Inline notice, Limitation, Empty state | `status.inconclusive.*` | 03, 11, 12, 14 |

## 6. Acceptance checks for implementation stories

Each story touching the UI should carry the relevant checks.

**Identity and colour**
- [ ] The logo, symbol and icons come from `assets/` SVGs. There is no live-text wordmark.
- [ ] Iris appears only in its permitted uses (BRAND §3). No result, count or approval button uses Iris.
- [ ] Every status shows a word and a glyph. Status dimensions are never merged into one chip.
- [ ] The diff uses strikethrough and underline, with no red or green.

**Conversation and activity**
- [ ] Zobba replies are first person and unboxed. Chrome uses "Zobba …".
- [ ] Exactly one animated mark appears per region, beside text. Reduced motion stops it.
- [ ] There are no fabricated percentages or step counts.
- [ ] Guidance shows queued and then applied states. Stop is a separate control and is always reachable.

**Workspace, artifacts and evidence**
- [ ] The panel never replaces pinned or recently used content (R2.2).
- [ ] Artifacts render in the firm template. Prepared by and Reviewed by name people. The provenance footer does not imply review.
- [ ] Citation → drawer → Back to claim works by mouse and keyboard, and focus returns to the citation.

**Decisions and permissions**
- [ ] One confirmation surface lists every material detail. Any change invalidates the decision.
- [ ] Outcomes are reported per operation, including unknown and partial.
- [ ] The Permissions view shows the seven sections and the Activity record, with no tokens or scopes.

**Honesty**
- [ ] An unavailable source is never shown as empty. A partial read is never shown as complete. An uncertain action is never shown as definitely failed or definitely done.

**Accessibility**
- [ ] Contrast meets DESIGN-TOKENS §3 for every pair used.
- [ ] Focus is visible (2px Iris) and the keyboard order is logical.
- [ ] Touch targets are 44px.
- [ ] The DESIGN-SYSTEM §14 "must be verified" list has passed.

## 7. Outstanding

See [OPEN-QUESTIONS.md](OPEN-QUESTIONS.md). The most important are Q1 (Kobba comparison), Q2 (type-designer drawing), Q3 (provenance default), Q4 (dark mode in the first release) and Q11 (trademark clearance).

**A rendered mockup is not proof** that an integration, security control or execution behaviour works. Permissions enforcement, confirmation invalidation, per-operation outcome reporting and evidence capture must be verified in the implemented system.
