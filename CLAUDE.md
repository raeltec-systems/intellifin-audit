# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

# Working rules

Repository guidelines, layout, and project policy live in `AGENTS.md`. Read that too.

## This is a living document

This file is the one shared place for decisions that affect how anyone — agent or developer — works with this codebase. When we hit a gotcha and agree on a workflow, record it here (see "Codebase decisions and gotchas" at the bottom) so a later agent does not re-decide it differently. Keep entries short: the decision, the reason, one line each. Update this file in the same commit as the work that produced the decision.

## Done means done

Not half done. Not done except for the part you decided to skip. And not a report about how it will be done.

Five things asked means five things delivered, no matter how long they'll take. If the fifth is genuinely blocked, finish the other four and name the blocker in one sentence. The specific blocker. Not "this needs more investigation."

## Act. Don't ask

Reversible and cheap? Do it, then tell me. Research, data pulls, analysis, drafts, refactors inside the scope I gave you, testing an API. A question costs me more than a re-run costs you.

Ask first only for: anything reaching an audience, anything we cannot undo, anything expensive.

Something is broken? Fix it. Reporting an issue you could have fixed turns your work into my to-do list.

## A question is a question

When I ask a question, answer it. Do not implement it.

"Should we use X?" is not "migrate everything to X." "What would it take to add Y?" is not "add Y."

When in doubt, assume it's a question. Answer first. Act when I say go.

## Speed and model routing

When running as a frontier-tier model (Fable, Opus, or their successors): optimize for wall-clock speed. Finish tasks quickly.

Route work to the cheapest model family that does it well. Never burn top-tier intelligence on routine work. The tiers, from cheapest to most capable — use whichever models from each tier are available:

- **Small/fast tier** (Haiku family): trivial mechanical work — file lookups, simple renames, formatting.
- **Mid tier** (Sonnet family): routine work — search, bulk edits, boilerplate, verification, running test suites.
- **Frontier tier** (Opus, Fable/Mythos family): hard reasoning that can run independently — architecture calls, tricky debugging, concurrency and correctness work. The top model (Fable) is costly; reserve it for work that actually needs it.

- Parallelize aggressively. Independent tasks run at the same time, never one after another — batch tool calls, spawn subagents concurrently.
- Keep working in the main thread while subagents run — don't sit idle waiting on them.
- Don't over-deliberate. Enough info to act = act. No long option surveys for decisions with an obvious default.
- Speed never trades away quality: same rigor, same verification, same "done means done". If parallelizing risks a worse result, slow down.
- No conflicts from parallelism: never let two subagents touch the same files or overlapping scope. Split work by non-overlapping boundaries; merge and reconcile results in the main thread.

## Short responses

It's been a long day and my brain is fried, talk to me like I'm 5.

Small words, short sentences, short paragraphs. If you have to use a big word, explain it right after. Only return what's actually necessary.

Just tell me what you did, did it work, what do I do now.

If I have to decide something: 2 options max, the context I need to pick fast, and which one you'd go with.

Keep paths and commands exact.

Always use ASD-STE100 Simplified Technical English when you talk to me.

# About this repository

## What it is

**IntelliFin Audit** is an audit-execution platform: an auditor defines an Audit Procedure once and delegates its repeated execution to an autonomous Audit Agent, whose work stays observable, replayable, evidence-backed, and subject to human review.

**There is no application code yet.** This repository is a BMAD v6.11 planning workspace. The product is being specified before it is built. Do not look for `package.json`, `apps/`, or `packages/` — they do not exist. `AGENTS.md` holds the verified agent block; refresh it with `/bmad-project-context`.

## Layout

```
_bmad/                  BMAD install: config, manifests, shared Python scripts (installer-managed, read-only)
_bmad-output/           Everything the planning workflow produces (the real work product)
  planning-artifacts/
    briefs/             Product brief
    prds/               PRD + addendum + reviews + .memlog.md
    ux-designs/         UX handoff
    architecture/       Architecture spine + reviews
.claude/skills/         49 BMAD skills as rendered for Claude Code
.agents/skills/         Byte-identical copy of the same skills (IDE-neutral path)
.github/agents/         Thin GitHub Copilot stubs that forward into .agents/skills/
```

Each planning-artifact folder is named `<type>-IntelliFin Audit-<date>/` — **the name contains a space**. Quote every path.

## The planning chain and its state

```
brief → PRD (+addendum) → UX handoff → architecture spine → epics/stories → sprint → build
```

Each stage carries a `.memlog.md` (append-only decision log) and, when reviewed, `review-*.md` / `recheck-*.md` files. Check a document's frontmatter `status` (`draft` or `final`) and `revision` before trusting it. A downstream artifact derived from an earlier revision is stale until re-derived; the PRD's §0 says which ones.

The PRD is the source of truth for product decisions. `prd.md` holds requirements (FR-n, NFR-n, SM-n); `addendum.md` holds normative detail (state models, Evidence Quality Gate rules, Template contracts, golden-dataset seeds, FR migration map). Read both.

## Commands

BMAD scripts run with `uv` and need Python 3.11+. Run them from the repository root.

```bash
# Resolve a skill's customization (what a skill reads on activation)
uv run _bmad/scripts/resolve_customization.py --skill .claude/skills/bmad-prd --key workflow

# Resolve the central config layers
uv run _bmad/scripts/resolve_config.py

# Append to a workspace memlog (never edit .memlog.md by hand)
uv run _bmad/scripts/memlog.py append --workspace "<artifact folder>" --type <decision|change|override|assumption|event> --text "<one line, reason included>"

# Run one skill's Python tests (tests declare their own deps via PEP 723 headers)
uv run --with pytest --with ruamel.yaml pytest .claude/skills/bmad-sprint-planning/scripts/tests/test_sprint_plan.py

# Run a single test
uv run --with pytest --with ruamel.yaml pytest ".claude/skills/bmad-review/scripts/tests/test_word_metrics.py::test_name"

# All skill tests
uv run --with pytest --with ruamel.yaml pytest .claude/skills/*/scripts/tests
```

There is no build, lint, or app test suite yet. When the monorepo is bootstrapped (per the architecture spine: pnpm workspaces, `apps/web`, `apps/worker`, `packages/{domain,application,infrastructure}`), add its commands here.

## Working with BMAD skills

- Invoke skills by name (`/bmad-prd`, `/bmad-architecture`, `/bmad-review`, ...). Deprecated names (`bmad-create-prd`, `bmad-editorial-review`, ...) forward to the current skill.
- Skills spawn subagents for reviews and reconciliation. Each reviewer writes its full report to a file in the artifact folder and returns only a summary; the main thread never holds full review text.
- Every product decision made during a skill run is logged to the artifact's `.memlog.md` via the script above, in the same turn it is made.
- `_bmad/config.toml`, `_bmad/config.user.toml`, and `_bmad/_config/*` are installer-managed. Do not edit; override in `_bmad/custom/config.toml` instead.

## Codebase decisions and gotchas

- **Bash `cd` persists between calls.** Use absolute paths or `...`; a relative path after an earlier `cd` will miss.
- **Planning-artifact folders have a space in the name.** Always quote paths under `_bmad-output/`.
- **Memlog writes go through `memlog.py` only.** Hand edits break the append-only guarantee the resume logic depends on.
- **Reviews are files, not chat.** Reviewer subagents write `review-<slug>.md` / `recheck-<slug>.md` next to the artifact and return a summary; the parent reads the file only when drilling into a finding.
- **Revising an upstream artifact invalidates downstream ones.** After a PRD revision, the architecture spine and UX handoff must be re-derived; say so in the PRD §0 and in the PR.
- **`.claude/skills` and `.agents/skills` are copies, not symlinks.** A change to a skill must be made in both, or re-rendered by the installer.
