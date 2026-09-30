# Zobba

Zobba is a continuing audit working environment: an engagement conversation coordinates Tasks, real managed computers and evidence-supported work products.

**The accepted build baseline is design revision 3.** This repository is undergoing a brownfield course correction to an owned Rust backend and fresh schema. The existing TypeScript application remains historical implementation and a source of reusable work; the planning handoff does not claim the new runtime is built.

The new [Zobba workspace](zobba/README.md) supplies the Rust API, worker and explicit
PostgreSQL 18 migrations through Story 20.3, plus the Pair React/Vite shell.
It includes scoped OIDC sign-in, durable Task commands and a bounded inert worker.
Run its commands from `zobba/`; root pnpm commands continue to target the historical
application. Health proves service/schema readiness. Conversation UI, model/tool
execution, audit conclusions and real computers remain later capabilities.

- [Active product, architecture and experience contracts](_bmad-output/planning-artifacts/ACTIVE-BASELINE.md)
- [Build sequence and implementation handoff](_bmad-output/planning-artifacts/zobba-build-plan-2026-09-30/README.md)
- [First implementation batch](_bmad-output/planning-artifacts/zobba-build-plan-2026-09-30/FIRST-BATCH.md)
- [Operating budget and reproducible calculations](_bmad-output/planning-artifacts/zobba-operating-budget-2026-09-30/OPERATING-BUDGET.md)
- [Pair screens and interactive reference](_bmad-output/planning-artifacts/ux-designs/zobba-design-system-v1.0/README.md)
- [Download the build handoff ZIP](_bmad-output/planning-artifacts/zobba-build-plan-2026-09-30/Zobba-Build-Handoff.zip)

For new implementation, use an explicit Epic 20–28 story with `bmad-build` and the active SPEC's companions. The standard sprint-status file is the sole active queue. Prior contracts, backlog and completion records are preserved as history, with stable identifiers.

See [AGENTS.md](AGENTS.md) and [CLAUDE.md](CLAUDE.md) for repository working rules and existing runtime commands.
