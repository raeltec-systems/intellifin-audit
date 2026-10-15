# Common brief for every Codex study sub-agent (read fully before starting)

You are one of several parallel reviewers producing evidence for an engineering report.
The report compares the open-source OpenAI Codex agent harness with an audit-agent
product called Zobba (repository: intellifin-audit). You study ONE area of Codex and
write ONE findings file. You do not write the final report.

## Pinned revisions (cite these; never cite "main")
- Codex checkout (read-only reference): <codex-checkout>
  - commit 8ffd91e42aa001b7e897bea812b02f89264f9fa0 (2026-09-29, "Enable multi-agent V2 and Ultra reasoning on Amazon Bedrock (#49345)")
  - Rust workspace is under codex-rs/ (about 1.97 million lines of Rust, 100+ crates).
  - Licence: Apache-2.0 at root; check NOTICE and any crate-level LICENSE you cite.
- Do NOT modify anything in that checkout. Do NOT run cargo build / cargo test (the lead runs one controlled build later). Do NOT touch <repo>.

## Citation format (mandatory)
Every claim about Codex code must carry a reference of the form
`codex-rs/<crate>/src/<file>.rs:L<start>-L<end>` (path relative to the codex repo root), and
you must have actually read those lines (use grep -n / sed -n; quote 1-6 key lines when useful).
Label EVERY finding with exactly one evidence class:
- [OBSERVED] — read in source code.
- [TEST] — a test exists that exercises it; name the test function and file:line and say what
  failure it would detect. Do not say a test passes; say it exists and what it asserts.
- [INFERENCE] — your reasoning from the code, not stated in code or docs.
- [DOC] — stated in repository docs (docs/*.md, README, comments) but not verified in code by you.
Never report an unexecuted test as passing. If you cannot find something, say "not found" and
what you searched (grep patterns).

## What to produce per material finding (the report needs all seven)
1. The problem Codex solves.
2. The responsible code: types/functions, control flow and STATE OWNERSHIP (who owns which
   struct, which task, which lock, which channel).
3. Supporting tests and the failures they actually detect.
4. Assumptions, limitations and defaults (config defaults, hard-coded limits, feature flags).
5. What is generally useful vs specific to a local coding-agent / single-user environment.
6. How an audit harness (multi-tenant server, durable operations, attributable human
   decisions, protected evidence, revocable permissions) would differ — brief.
7. A recommendation label: ADOPT PATTERN / ADAPT IDENTIFIED CODE / IMPLEMENT INDEPENDENTLY /
   DO NOT ADOPT — with one-sentence reason.

## Also record
- Feature flags / hosted-service dependencies you meet (anything needing OpenAI backend,
  ChatGPT auth, cloud tasks, plugins registry, etc.) — mark as "requires hosted service".
- Hard numbers you find (limits, timeouts, buffer sizes, retry counts) with references.
- Reuse candidates: exact crate/module, its dependency list (from its Cargo.toml), licence,
  whether it is coherent enough to lift, and what would need modifying.
- Coverage limits: what you did not read.

## Output
Write Markdown to the findings path given in your task. Aim for 1,500-4,000 words of dense,
referenced findings; tables are welcome. Start with a 10-line summary. Do not pad.
End with a "Coverage and limits" section and a "Reuse candidates" section.
Return only a 10-line summary in your final message; the file is the deliverable.
