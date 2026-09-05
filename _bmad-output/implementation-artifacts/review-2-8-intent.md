# Story 2.8 — intent-alignment review

The reviewer read the exact captured frozen intent and full diff. This is a descriptive record; final routing is in the triage.

Defensible readings identified:

1. Application contract: ordinary SQL/command edits are protected; registration writes mint atomically; platform changes are explicitly published; schedules remain metadata because execution is excluded.
2. Operational changes: all effective platform configuration changes, including runtime deployment changes, automatically publish Drafts.
3. Literal privileged immutability: even a privileged schema operator cannot disable/remove protection or delete/recreate definitions.

The diff principally implements the first reading. The following distinctions were identified:

- Publication is explicit; runtime worker credentials/configuration remain environment-owned. The operational integration calls the file entry point and supplies a matching gateway, rather than changing a running deployment automatically.
- Prompt 1 and executable-plan-v1 are the only supported contracts. Operational proof changes a model and refuses unsupported prompt versions; fabricated tool-tuple comparison is not operational tool-change proof.
- SQL tests protect ordinary field/state updates, not privileged removal of the schema protection.
- Prior Schedule state/data is preserved; no running scheduler is exercised, consistently with the execution exclusion.
- Warning forms call registration-owned digest functions to classify proposed edits; authoritative minting consumes the owner's stored snapshot/digest.
- Warning and New version use actual browser interactions. Some changed-configuration states are command/database fixtures checked in the browser. The operational platform path reaches submission through functions, not a complete browser-only configuration-to-decision journey.
