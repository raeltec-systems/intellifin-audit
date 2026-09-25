# IntelliFin Audit — Reference Brief
## How the current AI-assisted audit workspace works, and what the product needs to reproduce it

*Prepared from a read-only inspection of one auditor's workspace and the session records available to the assistant. Sanitised for sharing: no client, employer, people, figures or proprietary methodology text. Paths are shown generically.*

**Evidence labels used throughout**

| Label | Meaning |
|---|---|
| **[O]** | Directly observed in an accessible file, configuration or session record |
| **[D]** | Described by the auditor in the assignment brief |
| **[I]** | Inferred from the available evidence |
| **[P]** | Proposed for IntelliFin |
| **[R]** | Reported by a scheduled task run about itself, partly from its own earlier notes. This is self-report, not independent evidence (used in §8.4 only) |

---

## 1. Executive summary

1. **The experience is not the model alone. It is the model plus five things around it** [O]: a standing instruction file describing the workspace and methodology; a small, persistent memory of the auditor's corrections; task-specific skills; the ability to read and write real audit files and run scripts against them; and permissioned tool execution with the auditor reviewing every material output.
2. **The most valuable behaviour is correction that sticks.** When the auditor corrects a method (for example, "requests go to an executive's office, not the executive"), the correction is written to a named memory file with its reason and how to apply it, and it is applied in later sessions without being restated [O]. This is the core of the "working partner" feeling.
3. **The assistant is useful because it reads the authoritative sources itself** — group instructions, control matrices, policies, specifications, evidence extracts, prior external-audit letters — and ties them to the task, rather than relying on the auditor to summarise them [O].
4. **Investigative assistance happens mostly when the assistant is asked to check its own work or read beyond the literal request.** Several of the most useful outputs were patterns the auditor had not asked for, such as a post-exit login in a directory extract or a prior external finding that reshaped risk focus [O]. Several of the most important errors were also caught there, some by the assistant's own self-review and some by the auditor or a reviewer [O].
5. **Almost nothing is enforced; nearly everything is instructed.** Evidence integrity, methodology rules, review gates and client separation are conventions the model is asked to follow. They are not controls the environment guarantees [O][I]. That is the single biggest gap between this workspace and a product that other firms can trust.
6. **Memory here mixes six different kinds of knowledge in one flat folder** — personal preference, departmental methodology, organisation facts, engagement state, temporary progress and lessons learned — with no ownership, scope, effective dates or approval [O]. It works for one auditor. It would fail in a multi-user, multi-client product.
7. **The bridge to continuous audit already exists in miniature.** One-off analyses (a population trace, a parameter comparison) are written as scripts with a stated method, population and limitations [O]. Promoting such an analysis into a versioned, approved, scheduled check is the natural product seam between the "assistant layer" and the "execution layer" [P].
8. **A recurring task has been running here for about three months, and it shows what continuous audit needs** (§8.4). A weekly status report is prepared by two scheduled tasks. It works, but it has shown every weakness a continuous check must design out. The written definition stopped being updated while the real method moved into memory [O][R]. All of its validations test internal consistency, and none tests against the system of record [R]. When an input goes stale, the report still looks current to its reader [R]. Each week's output is built by editing the previous week's output [R]. A generated log that is known to be unreliable was used once as a source [R]. It also shows the behaviours worth keeping: it never sends, it never fixes another team's figures, and it discloses what it carried forward.
9. **Recommended first version** [P]: a conversational workspace with engagement-scoped context; a governed memory service with provenance and approval; a methodology package the firm supplies; an artifact model (plan, procedure, working paper, evidence, finding, report) that the agent builds and the auditor signs; a sandboxed analysis runner that never writes to received evidence; and "promote to procedure" as the path into scheduled execution.

---

## 2. What could be inspected

| Source | What it is | Status |
|---|---|---|
| `CLAUDE.md` (workspace root) | ~200-line standing instruction file: workspace purpose, lifecycle, folder conventions that vary by engagement, system context, deliverable formats, tone rules, work paper and finding formats, risk-sourcing discipline, where memory lives | [O] read in full (loaded every session) |
| `memory/MEMORY.md` + ~33 `memory/*.md` | Index plus individual memory files typed `feedback`, `user`, `project` and `reference`, with name/description frontmatter, a "Why" and a "How to apply" | [O] index and representative files read |
| `skills/<name>/SKILL.md` (~20) | Task skills: daily kickoff and close-out, control matrix builder, test plan generator, finding writer, work paper reviewer, report drafter, notification and engagement letter generators, follow-up tracker, and product-building skills | [O] descriptions read; two read in full |
| `scheduled-tasks/<name>` (4) | Unattended tasks: morning briefing, weekly report preparation and finalisation, weekly refresh of instructions and memory | [O] descriptions read |
| Settings (user and project) | Enabled plugins; project permission allow-list (18 rules, mostly specific script invocations); no hooks configured | [O] keys and rule shapes read, no values exposed |
| Workspace tree | Engagement folders per year, numbered by lifecycle stage; `Templates/` numbered to match; `References/`; `DailyLog/`; `_scripts/` and `temp_scripts/` (~250 generated scripts); ad-hoc analysis scripts at root | [O] structure only |
| Session records | The current long session, including its compacted summary, plus earlier transcripts in the project store | [O] current session used directly; earlier transcripts searched narrowly for one topic |
| IntelliFin repository | Cloned read-only earlier in the session to recall the product brief | [O] brief read; **code not assessed for this report** |

**Not inspected:** confidential evidence content beyond what was already handled in session, other projects, credentials and live business systems.

---

## 3. The audit lifecycle as this workspace evidences it

[O] `CLAUDE.md` defines four phases, and the engagement folders mirror them with numbered stage folders:

```
Planning     notification → opening meeting → preliminary survey → walkthroughs
             → budget → engagement letter → control matrix (RACM) → independence
Fieldwork    information requests ↔ evidence received → design testing (TOD)
             → operating-effectiveness testing (TOE) → working papers → draft findings
Reporting    report → root cause → closing meeting → QA → satisfaction survey
Follow-up    management action tracking; recurring findings reporting
```

**How the pieces connect** [O]:

- **The control matrix is the spine.** Information requests are derived from each control's evidence column and test steps. Working papers are one per control. Findings cite the control's wording plus the actual governing document.
- **Evidence arrives against information requests.** The request schedule is kept as "what is needed now", not as a history log.
- **Design and operating effectiveness are kept separate.** A control that exists but isn't followed fails TOE, not design.
- **Findings follow a fixed structure**: criteria, condition, cause, consequence, corrective action. Ratings map to remediation periods.
- **Review is human**: a manager or a group-level lead reviews working papers and reports.
- **Conventions vary by engagement.** The instruction file warns never to assume a path from one engagement applies to another. The assistant lists folders before acting.

---

## 4. Three reconstructed examples (from session records)

### Example A — Access-control testing on user listings (IT audit)

| Step | What happened |
|---|---|
| **Objective** | [O] Test an access control, covering leavers removed on exit, privileges matching roles and password parameters, against evidence arriving in pieces from IT. |
| **Context available** | [O] The control's exact wording and test steps from the control matrix; the HR leaver, joiner and mover lists; quarterly directory reviews (PDF); a current directory extract (CSV); an application user and role workbook with an embedded screenshot; memory rules (exact-match identity resolution; never characterise controls in requests; keep TOD and TOE separate). |
| **Tools / scripts** | [O] Python scripts written in the session scratchpad: exact-match tracing of leavers against reviews and extracts; cross-checking application accounts against the directory and HR; counting role assignments across a permission matrix; side-by-side parameter comparison. Received files were copied before reading and never written to. |
| **Output** | [O] A separate test workbook (trace, privileged roles, parameters, summary) and in-place updates to the control's working paper covering population, work done, results by procedure, limitations and candidate matters. |
| **Investigative assistance** | [O] The assistant noticed things it had not been asked to look for: one leaver's account showing a login three weeks after exit; the application appearing to authenticate outside the directory; and the user listing being a subset of the real population (accounts created in period only). |
| **Human correction** | [O] The auditor pointed out that a screenshot embedded in the workbook already evidenced the configuration, which the assistant had missed. Separately, the assistant's own self-review, run at the auditor's request, found that it had overstated three results: an inference written as fact; a current-state anomaly classed as an in-period exception; and system-wide role counts presented as if they were in-scope figures. It also found two coverage gaps: outsourced staff were missing from the HR population, and no removal dates existed to test timeliness. |
| **Preserved** | [O] Working paper wording, the limitations list and new evidence requests. An earlier correction ("fuzzy name matching produced false positives; use exact match") had already been kept from a previous session. |
| **Uncertain** | [O] Whether the post-exit login was a person or a device sync. This is recorded as pending, not as an exception. |

**Lesson for the product:** the analysis was right to be flexible, but correctness came from **explicit limitations, self-review and auditor correction**, not from the first pass.

### Example B — Localising a group control matrix and building information requests

| Step | What happened |
|---|---|
| **Objective** | [O] Adapt a parent-group control matrix for a specialist area to the local entity and issue requests within a group deadline. |
| **Context available** | [O] The group matrix, group training material, group policy, local policy, local regulator guidance (scanned, so rendered to images and read visually), a board risk summary, and later revised group instructions with a new request template. |
| **Output** | [O] A localised matrix (applicable controls kept, text edited in place), a request list, a preliminary survey and emails. |
| **Human corrections (in sequence)** | [O] (1) The first localisation added explanatory columns. The auditor explained the house convention: same layout and voice, only what applies, and edits never explained inside the document. (2) Requests had been written before the matrix was final and leaned on other documents; rebuilt strictly from the matrix. (3) A request had been assigned to an executive by name; the auditor's rule is to use the executive's office. (4) The assistant had removed a group-prescribed pricing method on an inference about local routing. The auditor challenged it, the sources were checked, and the method was restored. (5) The auditor's manager caught one control excluded without the group approval the revised instructions required. (6) Two columns the assistant had removed as "extra" turned out to be the group's own layout; they were restored. (7) The auditor asked for the group's request template to be used exactly, with no added columns. |
| **Preserved** | [O] New memory rules: requests are derived from the control matrix, one artefact per line; executives are addressed via their office; group-prescribed methods are kept unless confirmed inapplicable; the local layout convention. |
| **Investigative assistance** | [O] The board risk summary's wording ("percentage-based") suggested which of two group charging models applied. This was raised as an inference to confirm, not asserted. Prior external-audit letters surfaced a recurring finding directly relevant to the area. |

**Lesson for the product:** **methodology authority has an order** (regulator > group instruction > local policy > the auditor's preference > the assistant's inference). Most errors in this example were the assistant ranking an inference or a convenience above a higher authority.

### Example C — Specification research during a system post-implementation review

| Step | What happened |
|---|---|
| **Objective** | [O] Answer a narrow question: did the system specifications intend a maker-checker on a business activation? |
| **Tools** | [O] A keyword search first. When the auditor asked for a full read, the specifications (about 27,000 lines across three documents) were split across six parallel read-only sub-agents with an identical, neutral brief. Their key quotes were then re-verified against the source text before reporting. |
| **Output** | [O] A precise answer with quotes: maker-checker was specified for price overrides; approval was specified for certain other request types; none was specified for a standard activation. It also flagged that a referenced specification document had never been received. |
| **Human decision** | [O] The auditor used the answer to reword a working paper and a walkthrough record, and to adjust what was requested from the auditee. |

**Lesson for the product:** **retrieval quality is a controllable setting.** "Keyword search" and "full read with verification" gave different confidence, and the auditor wanted to choose between them.

---

## 5. Capability map

| Capability | What it does here | Inputs → outputs | Evidence it exists | Used successfully? | Instructed or enforced? |
|---|---|---|---|---|---|
| **Model reasoning** | Interprets requests, methodology and evidence; drafts; spots patterns | Text, tables, images → judgments, drafts | All examples [O] | Yes, with corrections | n/a |
| **Agent orchestration** | Multi-step plans; tool calls; parallel sub-agents; background tasks; notifications on completion | Task → sequence of tool calls | Example C sub-agents; background long-running searches [O] | Yes | Orchestration is enforced by the harness; planning is the model's |
| **File access and search** | List, read, search and write workspace files; read scanned PDFs by rendering pages to images | Paths and patterns → content | Throughout [O] | Yes | Read-before-edit is **enforced** by the edit tool [O]. "Never write to received evidence" is **instructed only** [O] |
| **Script execution and deterministic analysis** | Python over Excel, CSV, ODS, DOCX, PDF: traces, reconciliations, profiling, document builds | Evidence files → workbooks and documents | Scratchpad scripts; ~250 generated scripts in the workspace [O] | Yes | Runs under the permission mode; a few script invocations are pre-allowed [O] |
| **Skills (procedural guidance)** | Loaded instructions for recurring tasks | Trigger phrase → procedure | ~20 skills [O] | Daily kickoff used repeatedly [O] | Instructed. Skills cite the firm manual but nothing checks compliance |
| **Templates and artifacts** | Fill house templates (letters, surveys, walkthroughs, working papers, matrices, request lists); build decks | Template + content → Office file | Examples A and B [O] | Yes | Format fidelity is instructed. Style preservation is fragile (e.g. an image-preservation check was needed) [O] |
| **Persistent memory** | Named files loaded via an index at session start; updated on correction | Correction → file + index line | `memory/` [O] | Yes: rules applied in later sessions [O] | The index is **loaded** automatically; **use** of memory is instructed |
| **Engagement state** | Per-engagement status files; instruction file table of active engagements | Work → status notes | `project_*.md`, `CLAUDE.md` [O] | Partly: some status files are very large, and "memory wins over the instruction file" is stated to settle conflicts [O] | Instructed |
| **Scheduling** | Unattended weekday briefing, weekly report prep, weekly memory refresh | Schedule → task run | `scheduled-tasks/` [O] | Mixed: an external flow's close-out summaries were found to **fabricate completed work** and are now flagged as unreliable in memory [O] | The schedule is enforced by the platform; output quality is not |
| **Permissions and review** | Permission prompts and a mode that gates tool calls; project allow-list; the human reviews every deliverable | Tool call → allow or deny | Settings [O]; tool calls blocked when the safety classifier was unavailable [O] | Yes | **Tool-level** permission is enforced. **Audit review and sign-off are not**: they happen outside the tool, by people |
| **External connectors** | Mail and calendar dumps via an automation flow; no connector to the task planner or the audit-management system | — | Memory reference file [O] | Partial | — |

**Key distinction:** a capability being available (e.g. scheduling) is not the same as it producing trustworthy output unattended (e.g. the fabricated close-outs). IntelliFin must measure the second [O][P].

---

## 6. Memory: what it should mean in IntelliFin

### 6.1 What exists today [O]

One folder of flat markdown files for one user, with frontmatter (`name`, `description`, `type`), plus prose sections for "Why" and "How to apply", wiki-style links between files, and an index file loaded every session. Some files carry an origin session ID and a modified timestamp.

### 6.2 Where categories are mixed [O][I]

| Stored as | Actually contains | Risk in a multi-user product |
|---|---|---|
| `feedback_*` | Personal style (tone, file formats) **and** departmental methodology (TOD vs TOE, finding structure, risk sourcing) | One user's preference silently becomes "methodology" for everyone, or methodology is edited by whoever corrected the assistant last |
| `project_*` | Engagement facts, people, decisions, open questions **and** reusable lessons | Client facts leak into other engagements; lessons stay trapped in one project file |
| `engagement_team_and_systems` | Organisation-wide directory knowledge **and** engagement-specific contacts | No access scoping; stale roles persist |
| The instruction file | Methodology, conventions **and** a dated snapshot of engagement status | Two sources of truth, reconciled by a rule saying which one wins |
| `reference_*` | Tool reliability facts | Good pattern, but has no expiry |

One status file has grown to about 230 KB [O], which means context retrieval degrades silently.

### 6.3 Proposed separation [P]

| Layer | Owner | Scope | Changes by | Example (synthetic) |
|---|---|---|---|---|
| **User preferences** | Individual | That user | The user, directly | "Deliverables as .docx"; "time zone UTC+2" |
| **Methodology package** | Firm or department | Tenant-wide, versioned | Methodology owner, with approval | "Findings use Criteria / Condition / Cause / Consequence / Action" |
| **Organisation knowledge** | Firm, per client | That client only | Engagement team, with review | "Client's ERP authenticates outside the directory" (with source and date) |
| **Engagement context** | Engagement lead | That engagement | Team members; decisions logged | "Scope excludes control X — approval ref, date" |
| **Execution state** | System | That run or conversation | Automatic, disposable | "Step 3 of 5 done; file Y parsed" |
| **Confirmed lessons** | Methodology owner | Promoted from engagements | Proposal → review → publish | "Exact-match identity resolution; fuzzy match rejected after false positives" |

### 6.4 Lifecycle of a memory item [P]

`captured (from conversation) → proposed (with source, scope and reason) → confirmed or approved (by the right owner) → retrieved (with citation) → superseded or retired (never silently deleted)`

Required attributes: **source** (who said it, where it came from, in which session), **scope** (user / firm / client / engagement), **owner**, **effective-from and effective-to dates**, **version**, **status** (proposed / active / superseded / rejected) and **evidence link** where it is a fact.

### 6.5 Safeguards against the named failure modes [P]

| Failure | Safeguard |
|---|---|
| One-off instruction becomes a permanent rule | The agent proposes retention and says so explicitly ("keep this as a rule for future engagements?"); nothing becomes durable without a yes; rules show their origin |
| Unverified hypothesis becomes fact | Separate item types (**fact** needs an evidence link; **hypothesis** carries a verification task and expiry); the agent must label inferences in outputs (this workspace's reports already use "to be confirmed") |
| Old policy treated as current | Effective dates and supersession on organisation knowledge; the retriever returns only the active version for the period being audited, and flags when the audit period and policy date disagree |
| One client's data in another's work | Hard tenancy: organisation and engagement memory are partitioned at the storage and retrieval layer, not by instruction; cross-client lessons go only via promoted, anonymised methodology items |
| Preference overrides methodology | Precedence is enforced by the resolver (regulation > methodology package > engagement decision > user preference); conflicts are surfaced, not resolved silently |
| Memory mistaken for evidence, permission or approval | Memory can **point to** evidence and approvals but never **stand in** for them; working papers cite evidence IDs, not memory items; approvals live in an approval record with an identity and timestamp |

This is **persistent context management**. It retrieves and applies stored knowledge at run time. It is not retraining the model.

---

## 7. An industry-neutral methodology model [P]

| Concept | Reusable (product) | Supplied (firm / organisation / engagement) |
|---|---|---|
| Engagement phases | A phase model with configurable stages and gates | Stage names, order, required artifacts per stage |
| Risk and control matrix | Data model: risk ↔ control ↔ test steps ↔ evidence ↔ owner; localisation (inherit, edit, exclude with approval) | Column layout, rating scales, parent-group matrices |
| Testing approaches | Design vs operating-effectiveness separation; sampling rules engine; population-based analytics | Minimum sample sizes, thresholds, materiality basis |
| Criteria sources | A criteria register with an authority order and verbatim quotation with location | The documents themselves and the authority order |
| Information requests | Derive from control evidence; one artefact per line; classify; track status | Request templates, classification scheme, routing rules |
| Working papers | Structured fields with evidence links and limitations | Field set, wording conventions, export target (e.g. an audit-management system) |
| Findings | 5-C structure; root-cause technique; rating → remediation period | Rating definitions, report templates, tone |
| Review gates | Approval workflow with identities and timestamps | Who approves what, and when |
| Reporting | Assemble from findings and conclusions, with reconciliation checks | Report template and branding |

**Where each belongs**

- **Skills** (reusable procedures): "derive requests from a matrix", "trace population A to B with exact matching", "write a finding in the house structure".
- **Methodology package** (approved, versioned, per firm): phases, templates, rating scales, authority order, sampling minimums.
- **Reference knowledge** (retrieval): regulations, policies, specifications, prior reports — cited, dated, never treated as instructions.
- **Application enforcement** (code, not prompts): evidence immutability, tenancy, approval gates, read-only source access, run status truthfulness.

**Different disciplines on one foundation:** an internal-audit team, an external-audit firm and an IT-controls specialist each load a different methodology package and skill set, but share the same artifact model, evidence store, memory governance and execution engine.

---

## 8. From supervised investigation to continuous audit [P]

### 8.1 Two modes, one lineage

| | Investigation (conversation) | Recurring check (execution) |
|---|---|---|
| Goal | Understand, explore, find patterns | Re-perform an approved test the same way |
| Flexibility | High: new joins, new questions | Low: fixed definition, versioned |
| Output | Draft working paper, candidate findings | Run result, exceptions, evidence package |
| Authority | Auditor steering | Approved procedure plus reviewer |

**Promotion** turns a successful investigation into a **procedure definition**, reviewed and approved before it can be scheduled.

### 8.2 Minimum durable definition of a recurring check

- **Objective and control reference**
- **Authorised sources**: system, extract or report identity, read-only credentials reference, owner
- **Population and period rules**, including how completeness is proven (record counts, control totals, source-to-output reconciliation)
- **Identity and matching rules** (e.g. exact match on defined keys; fuzzy matching prohibited or bounded)
- **Criteria and method**: rules, tolerances, thresholds, and which steps are deterministic or model-assisted
- **Evidence requirements**: what is captured, hashed and retained, and for how long
- **Schedule and trigger**
- **Outcomes vocabulary**: Pass / Exception / Inconclusive / Failed-to-run, with clear definitions
- **Review responsibility and escalation conditions**
- **Version and approval record**

### 8.3 Handling run conditions

| Condition | Required behaviour |
|---|---|
| Missing or incomplete data | Mark **Inconclusive** with the reason; never Pass |
| Schema, policy or methodology change | Detect drift (columns, value domains, policy version); stop and request re-approval |
| Expired access | **Failed-to-run**; notify the owner; no silent skip |
| Interrupted run or retry | Idempotent steps; resume from checkpoint; one logical run ID |
| Duplicate execution or alerts | De-duplicate by run ID and exception fingerprint; carry open exceptions forward rather than re-raising them |
| Unexpected adjacent pattern | Record as a **signal** outside the approved objective; do not expand scope; route to the auditor to decide on investigation |

**Hard rules:** read-only access to audited systems; received evidence immutable (hash on ingest); a failed or incomplete run can never render as "control passed"; new sources, wider scope or changed criteria require explicit approval by someone other than the requester where independence requires it.

**Infrastructure memory does not provide:** a scheduler; durable job execution with checkpoints; credential vault and rotation; run ledger and monitoring; alerting; an evidence store with retention and legal hold; and an approval service.

### 8.4 Worked example: a weekly reporting task that is already running

**Setting.** A weekly status report on open audit findings has been produced by two scheduled tasks for about three months. It is a slide deck with a covering email, and the tasks run on a Thursday draft and a Friday finalise. The evidence behind this section:
- the two task definitions, read directly [O]
- the memory note the runs append to each week [O]
- the most recent run's answers to a structured set of questions about its own mechanics [R]

The run history itself was not visible from the inspecting session: the scheduler listing returned no tasks there [O].

**How it works**

| Element | What it is in practice |
|---|---|
| **Definition** | About four steps: find last week's deck; refresh the figures; save a draft named like last week's; brief the auditor. It names one banned source (a demo tracker) and says never send [O] |
| **Real method** | About eleven further behaviours, none of them in the definition [R]. They came from three places: corrections by the auditor and the report's recipient stored in memory (a dating rule, a movement format, a summary element); lessons stored after failed runs (a file-integrity check; writing the email off the deck); and the run's own judgement (backups, looking ahead to the next period) |
| **Inputs** | The memory note; a folder listing to find the latest deck (confirmed by the date inside the deck, not the filename); last week's working note; raw mail and calendar dumps; generated daily logs; one targeted email body; the deck's own content [R] |
| **Not read** | The system of record for findings; the committee report that holds opening balances; the other team's shared copy of the deck [R] |
| **Validation** | Totals agree across tiles, tables and detail pages; movement ties (opening + raised − closed − part-closed = open); due and overdue counts agree across slides; no stale dates anywhere; saved-file integrity; backup taken; covering email written from the deck [R] |
| **Outputs** | Deck, covering email, a handover email to the second team, and a working note that records carry-forwards and open questions [O][R] |
| **Human gates** | Sending; withdrawn vs closed; merging the other team's version; when a new report enters scope; open vs overdue when dates are ambiguous [R] |

**Lessons for IntelliFin** [P unless marked]

1. **The written definition drifts away from how the task really works.** Every improvement since the second month has lived in memory, not in the definition [R]. If memory were lost, the run would revert to wrong dating, wrong format and a wrong mailbox [R, inferred by the run]. → *The check definition must be the single authority. Improvements proposed by a run become versioned amendments that need approval; they must not be free-form notes.*
2. **Consistency checks do not prove the report is true.** Every check tests that the output agrees with itself; none reconciles to the system of record or to closure evidence [R]. → *Label each assertion as either internal consistency or source reconciliation, and require at least one source reconciliation before a result can count as "verified".*
3. **Stale data looks current to the reader.** The second team's input was missing for four consecutive weeks, and their figures were carried forward [R]. Moving the dates forward made those figures look current. Only the side notes disclosed it, and one covering email said "nothing closed" when that was known for one stream only [R]. → *Put a freshness status on every input (Current / Carried forward (n) / Missing), show a per-stream "data as at" label on the output itself, and generate summary text from the checked data so its qualifiers carry through.*
4. **Building from last week's output carries errors forward.** Each run edits the prior deck. A stale date line survived three weeks, and a finding removed by hand left a total unchanged [O][R]. → *Rebuild each run from sources; use the prior output only to compute movement and detect unexplained changes.*
5. **Generated summaries were once used as sources.** One run relied on a generated daily log to learn that another team had updated the deck. Memory records that those logs have invented completed work before [O][R]. → *Tag each source's provenance: system of record, raw input, or generated. Generated content can prompt a question but never count as evidence.*
6. **Sources fail silently.** Mail dumps were empty for three days [O]. The mailbox the run needed was not reachable [O]. A folder named in the definition had been stale since month one, and the auditor was never told [R]. → *Add completeness gates per source (size, row count, expected date range), report the result in the run status, and never read "no data" as "no change".*
7. **Memory is unreviewed self-report.** The note is append-only, long and full of superseded entries, so a mistaken observation can become a rule [O][R]. → *The memory lifecycle in §6.4 applies to check knowledge as well.*
8. **The run cannot tell whether its output was used.** It cannot tell whether last week's report was sent. One week's report went out before the second team's input arrived, which made the sent email wrong [R]. → *A run ledger that records: generated → reviewed → issued (by whom, when) → superseded.*
9. **Behaviours worth keeping.** Never send. Never change another owner's figures; route discrepancies to that owner. Flag gaps rather than reconstruct missing data. Count consecutive missed inputs. Back up before editing. Check file integrity. Keep a working note beside every output [O][R]. → *These become default behaviours of the execution layer, not prompt text.*

**Stop conditions this example suggests** [P]

- An input stale for two or more cycles, or any failed assertion: the output is marked **Not ready**, not issued as a quiet draft.
- An empty or unreachable source: that stream is **Inconclusive**, and the report says so on its face.
- A figure that differs from the prior run with no recorded movement: an **Exception** routed to the owner of that figure.

---

## 9. Minimal product foundation [P]

### 9.1 First version (essential)

1. **Conversational workspace** scoped to an engagement: chat plus a side panel of live artifacts (plan, request list, working papers, evidence, findings).
2. **Context discovery**: the agent reads the engagement's authorised material first and states what it found, what it assumed and what it still needs.
3. **Governed memory service** with the six layers, provenance, scope, status and approval.
4. **Methodology package loader** (templates, phases, rating scales, authority order).
5. **Evidence store**: ingest with hash, never modified, derived files linked to their source.
6. **Analysis runner**: sandboxed scripts over evidence copies, with outputs linked to inputs.
7. **Artifact builder** for house templates (documents and spreadsheets), preserving formatting.
8. **Review and approval records** on artifacts.
9. **"Promote to procedure"**: turns an analysis into a draft procedure definition for approval.

### 9.2 Later extensions

Scheduled execution engine; connectors to source systems and audit-management platforms; multi-reviewer workflows; cross-engagement lesson promotion; drift monitoring; portfolio dashboards.

### 9.3 Demonstration (synthetic)

**Synthetic setting:** a fictional company's HR leaver list, a directory extract, an application user list, and a control "access removed within 1 working day of exit".

| Step | What happens | Observable proof |
|---|---|---|
| 1. Request | "Test leaver access for Q1–Q2." | Request logged against the engagement |
| 2. Context discovery | The agent finds the control wording, period, sources and a methodology rule (exact matching) and states one assumption | Discovery note with citations to files and methodology items |
| 3. Plan | Procedures, populations and matching keys proposed | Plan artifact; the auditor edits one step; the edit is versioned |
| 4. Analysis | Trace runs over hashed copies | Output workbook linked to input hashes; counts reconcile to source totals |
| 5. Unexpected pattern | One account logged in after the exit date, and the application list turns out to be a partial population | Signals shown separately from exceptions, each with its evidence row |
| 6. Auditor decision | Treat the login as "pending confirmation"; request removal dates | Decision record with identity and time; request list updated |
| 7. Draft | Working paper with results per procedure and limitations | Every statement links to evidence or is labelled as an inference |
| 8. Revision | The auditor corrects an overstated result; the agent proposes retaining a new rule | Diff visible; memory proposal awaiting approval |
| 9. Promote | The analysis becomes a monthly procedure, approved by a reviewer | Procedure v1 with approver ≠ requester; first scheduled run shows Pass / Exception / Inconclusive truthfully, including one deliberately broken input producing **Inconclusive** |

---

## 10. Evidence limitations

- Only one auditor's workspace was inspected; practices at other firms were not observed.
- Earlier sessions were available as transcripts, but only the current session was used in depth. The examples come from it and from memory files that cite earlier sessions.
- For the recurring task (§8.4), individual run threads were not visible from the inspecting session. Its mechanics come from the task definitions and memory [O], plus one run's account of itself [R]. That account was partly reconstructed from its own earlier notes and has not been independently verified.
- Skills were read at the description level (two in full); their effectiveness was not measured.
- The IntelliFin codebase was **not** assessed for this report.

## 11. Decisions still needed

1. Tenancy model: firm → client → engagement partitioning, and where cross-client lessons may flow.
2. Who may approve methodology changes, and memory promotion to firm level.
3. The model-provider boundary (including customer-tenant hosting) and what data may be sent to it.
4. Evidence retention, legal hold and export formats.
5. Which audit-management systems to export to first.
6. The rule for when an agent may run analysis without per-run approval.
7. How independence is enforced when the requester and approver of a procedure could be the same person.

## 12. Questions to verify against the IntelliFin repository

1. Does the existing procedure contract express population completeness, matching rules and the outcome vocabulary (Pass / Exception / Inconclusive / Failed) described in section 8.2?
2. Is evidence stored immutably with hashes, and are derived artifacts linked to source hashes?
3. How are agent-judged results confirmed or rejected, and is the confirmer's identity recorded separately from the requester's?
4. Is there tenancy and engagement scoping at the storage layer today?
5. Can a run be resumed idempotently, and are duplicate runs detectable?
6. Is there a model-provider abstraction suitable for customer-hosted deployment?
7. Where would a conversational layer attach: to the run and replay model, or as a separate service?
8. Does the current audit trail cover human edits to artifacts as well as agent actions?
9. Can a run record a freshness status per input (current / carried forward / missing), and does it appear on the output a reader sees?
10. Does the run model distinguish assertions that test internal consistency from those that reconcile to a source of record?
11. Is source provenance (system of record / raw input / generated) captured, and are generated inputs barred from counting as evidence?
12. Does the run ledger track issue state (generated → reviewed → issued → superseded), or only execution state?

---

*End of brief.*
