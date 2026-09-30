# Existing implementation and new-build boundary

The repository currently contains the TypeScript/Next.js/Node implementation and its historical evidence/replay work. The owner accepted the clean Rust/fresh-schema direction and authorized active-document consolidation and implementation planning. No Rust runtime or schema has been implemented by this planning change.

- Preserve existing working code and historical tests until a replacement story explicitly dispositions them. A historical test is useful evidence of behavior; passing it does not validate the new implementation.
- Create the new backend and schema as a coherent ownership boundary. Do not make old procedure/run tables the new Task store or introduce a second Node authority for the new domain.
- Reuse Pair assets/tokens and useful React components, parsers, evidence handling and recovery lessons selectively. Verify code, license and behavior at the target seam before adoption.
- Retire the old Builder/compiler, queue and worker paths through explicit stories and cutover checks. Do not delete customer data, signed records or source history as a side effect of creating the fresh schema.
- The accepted design §9 and the active architecture contract register govern keep/adapt/rebuild/remove. Existing `docs/contracts/` apply to the historical runtime unless individually adopted; similarly named old and new concepts are not automatically compatible.
- `epics.md` defines new stories beginning at Epic 20. Earlier identifiers and completed work remain historical. The active sprint-status file tracks the new build; the old file is byte-preserved in its archive.
- Active UX is `ux-Zobba-2026-09-25`. Old IntelliFin UX still documents historical runtime/test wording and is not the new UI contract. Updated Pair prototypes demonstrate design interactions using fixtures, not real access or execution.
- Run `bmad-build` with an explicit new story ID and the active baseline. Use its story planning and checks to create reviewable code. No background invocation, deployment or production mutation follows merely from marking a story ready.
