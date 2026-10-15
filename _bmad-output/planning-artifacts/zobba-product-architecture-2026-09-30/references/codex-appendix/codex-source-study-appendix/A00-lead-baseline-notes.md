# Lead notes — baseline facts gathered directly (2026-09-29)

## Revisions
- intellifin-audit (Zobba): HEAD d9c72c80976dda5308353f9ce22e8e32fd1a11a9 = origin/main (2026-09-29 18:54 +0200, "Merge PR #64: Story 10.10"). Working tree clean. Study branch: claude/compassionate-thompson-en0rl9 (local, created from main).
- openai/codex: 8ffd91e42aa001b7e897bea812b02f89264f9fa0 (2026-09-29 18:53 UTC, "Enable multi-agent V2 and Ultra reasoning on Amazon Bedrock (#49345)"); shallow clone, depth 1, in scratchpad/codex. Newest release tags on remote: rust-v0.158.0, rust-v0.159.0, rust-v0.159.1 (tag membership of 8ffd91e not established from a shallow clone). Workspace version "0.0.0" (release versions are set at tag time). Toolchain pin: rust 1.95.0. Cargo.lock: 1,472 packages. codex-rs: ~1.97M lines of Rust across 100+ crates; core 434k lines (311k in tests dirs); tui 432k; app-server 188k (137k tests).
- Licence: Apache-2.0 at root, NOTICE names Ratatui-derived code (MIT); all 127 workspace crates use `license.workspace = true` (Apache-2.0); vendored `codex-rs/vendor/bubblewrap` is LGPL-2.0+ (its COPYING); third_party/ holds powershell, v8, voice, wezterm, wine assets — each needs its own licence check before any reuse.

## Zobba planning baseline (read directly)
- direction-2026-09-24.md: "Do not assume a full rewrite or a language migration. Equally, do not assume the existing architecture can support this merely by changing its screens. Assess that from the code."
- sprint-change-proposal-2026-09-24.md: approved by owner 2026-09-25; Proposals 1,2,3a,3b,3c,3d,4,4b,5,6,7 all approved; Epics 10–19 created; "Explicit implementation authorisation: Not given" at that date. Tenancy at storage layer: "no — the first and mandatory change (Epic 11)". Sandbox backend and profile: open selection (D-3b-2 criteria; candidates gVisor, Firecracker, managed sandbox).
- ARCHITECTURE-SPINE.md revision 5 (status final, updated 2026-09-25), AD-24..AD-34 adopted. Stack table: Node 24.20.0, TS 7.0.2, Next 16.3.4, PostgreSQL 18.6, pg-boss 12.29, Vercel AI SDK 7.0.89, Playwright 1.62.1. AD-31: AI SDK as transport only (maxSteps 1, no tool execute handlers).
- CONTRACT-REGISTER.md: 54 rows — 23 NEW, 8 EXTENDED, 20 HOLDS, 2 SUPERSEDED, 1 RETIRED; docs/contracts has 25 v1 files; NEW contracts are specified in the register/spine until their establishing story writes the file.
- proposal-7: dispositions retained/generalised/superseded/retired per component (see file); D-7-1 dispatch rule (§1a).
- sprint-status.yaml (last_updated 09-27-2026): epics 1–3 done; 4–5 in-progress (compiler-1 review closure); 10 in-progress (10.1, 10.2, 10.6, 10.8, 10.9, 10.10 done; 10.7 review on a folded YAML line; 10.3, 10.4, 10.5, 10.11 backlog); 11–17, 19 backlog; 18 in-progress (18.2 done).
- Epic map: 11 Tenancy/scope/delegation; 12 Engagement, Agent Task and agent loop; 13 Permissions/connectors/connections; 14 Sources/evidence/working material; 15 Artifacts/claims/review; 16 Memory/retrieval/skills/packs; 17 Controlled execution + document processing; 18 Experience; 19 Promotion and recurring checks; 9 standing assurance; 10 disposition and rename.

## Current TypeScript code size at HEAD (non-test lines)
domain 10,843 · application 23,814 · infrastructure 25,910 · worker 716 · web/src 33,391 · web/app 7,486 · northstar 2,385 · scripts 566. Tests: colocated ~56k + tests/unit 5.7k, tests/integration 29.2k, tests/e2e 25.8k. 62 migrations, 66 Drizzle tables. Largest loop modules: execute-agent-work-item.ts 1,931; execution-ports.ts 1,599; execute-adapter-steps.ts 1,383; execute-agent-steps.ts 1,307.

## Current CI wall-clock (run 36182016079 on main 429e08c, 2026-09-25, all 7 jobs green)
- Typecheck 26 s; boundaries 3 s; unit tests 95 s (job total 2m27s)
- Migrations + integration tests: integration step 6m41s; agent guard mutations 1m40s (job 9m33s)
- Playwright e2e + accessibility: focused journey 3m53s; full suite 33m04s (job 38m27s) — the critical path
- Agent abuse mutations job 16m37s; preview/worker lifecycle job 3m46s; images job 1m18s; P0 design checks 57s
- Whole run: 19:49:29 → 20:28:00 = 38.5 min, dominated by browser suites, not by TypeScript compile.
- Later main pushes (PR #60–#64 merges) show `cancelled` CI runs on main because successive merges superseded each other; each PR's own CI was reported green in its merge message.

## Machine used for this study
4 vCPU, 15 GB RAM, ~30 GB free disk; cargo 1.94.1 preinstalled, rustup installed 1.95.0 for the controlled test run; Node 22.22.2 (repo pins 24.20.0; no repo tests run in this study).

## Registry snapshots
- crates-io-snapshot.txt and npm-snapshot.txt in scratchpad (captured 2026-09-29T19:30Z / 19:31Z).
