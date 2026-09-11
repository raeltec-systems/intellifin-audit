# v2 — the auditor builds a Procedure by talking to the agent

**Status:** owner direction, recorded 2026-09-11. NOT built, NOT scheduled, NOT in Epic 5.
**Supersedes nothing.** v1's Builder ships as it is and is what the owner tests first.

## What the owner asked for

> "after i test this mechanical way… in v2, we will have the agent actually help you build
> the procedure. So instead of scrolling through all that long, the auditor has a
> conversation with agent. The agent asks them in conversation style… and the auditor
> supplies what they need one question at a time. And at the end the agent gives the full
> plan which the auditor approves. Once the auditor approves it's still not activated —
> they have just approved that the agent has framed what they want correctly. The auditor
> still has to submit this finalized procedure for manager approval. Only after the manager
> approves does the procedure become active and usable, and no run should run on an
> unapproved procedure."

## The four rules, and which are already true

| # | Rule | Today |
|---|---|---|
| 1 | The auditor answers one question at a time, in conversation, instead of filling nine forms | **NEW.** v1 is a nine-step Builder of native `<details>` forms. |
| 2 | The agent then presents the whole plan, and the auditor confirms it was framed correctly | **NEW as a distinct act.** See "The one real design question" below. |
| 3 | That confirmation activates nothing — the version still goes to an Audit Manager | **Already the state machine.** `PROCEDURE_VERSION_TRANSITIONS` is `DRAFT → SUBMITTED → APPROVED → ACTIVE` with no shortcut, `procedure.version.approve` is an Audit Manager's alone, and it is denied to the version's own author. |
| 4 | No Run may execute against an unapproved Procedure | **Already enforced.** `createRun` (`packages/application/src/runs/initiate-run.ts:68`) refuses unless the period's owning version is `ACTIVE` *and* carries a frozen review; a `DRAFT`, `SUBMITTED`, `REJECTED` or approved-but-not-yet-activated version is refused with `no-owner`. Both the manual Initiate Run path and a rerun share that one function. |

So v2 changes **how a Draft is authored**, and changes nothing about who may approve it,
what activation means, or what a Run is permitted to execute. That is the cheap version of
this feature and the one to hold on to.

## The one real design question v2 must answer deliberately

Today the auditor has exactly **one** act of assent: pressing **Submit for approval**. The
owner's description has **two** — "yes, you framed it right", and then "submit this for
manager approval".

Two readings, and they are not equivalent:

- **The confirmation is the Submit.** Simplest, no schema change: the conversation produces
  a Draft, the plan preview is what the auditor reads, and Submit is "you framed it right
  AND send it on". Costs nothing and loses the distinction the owner drew.
- **The confirmation is its own recorded act**, before Submit — the auditor accepting that
  the agent's transcription of their intent is faithful. That is a different claim from
  "this is ready for a manager", and an auditor who accepted a framing and then kept editing
  should have that acceptance invalidated. It needs its own marker on the version, its own
  audit event, and a rule for what edits clear it.

**Do not decide this inside a story about a chat UI.** It is a product decision about what
an auditor is attesting to, and it changes the immutable chain.

## Constraints v2 inherits and must not weaken

- **The model may not author executable meaning.** Today `makePlan` composes the plan from
  the auditor's own frozen inputs and a configured model can only AGREE — `derive-plan.ts`
  stores the compiler's bytes and refuses an attempt whose semantics differ. A conversational
  builder makes the model the thing that *collects* the inputs; it must still not be the
  thing that *writes* the plan. The seam to keep is: conversation → validated authoring
  inputs → the same compiler → the same frozen bytes.
- **Retrieved and typed text stays inert.** Whatever the auditor says in the conversation is
  authored text like any other, and everything downstream already treats such text as
  untrusted (`UntrustedText`, the digest-and-length audit payloads).
- **Every save is still an audited command against a row-version token.** A conversation that
  writes silently would lose the staleness guarantee the Builder has.
- **A conversation is not a substitute for the plan preview.** The auditor must still be able
  to read what will execute, in the platform's own words, before submitting.

## Where the pieces already are

- Authoring commands and state machine: `packages/domain/src/procedures/procedure-version.ts`,
  `packages/application/src/procedures/`
- Plan composition: `packages/domain/src/procedures/executable-plan.ts` (`makePlan`)
- Model-as-check: `packages/application/src/procedures/derive-plan.ts`
- Role gating: `packages/domain/src/identity/roles.ts`
- Run admission: `packages/application/src/runs/initiate-run.ts`
- The surfaces this would replace or wrap: `apps/web/src/procedures/BuilderSections.tsx`,
  `DraftBuilder.tsx`, `AgentSummary.tsx`, `ExecutablePlanPreview.tsx`
