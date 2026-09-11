# v2 — the auditor builds a Procedure by talking to the agent

**Status:** `[SUPERSEDED 2026-09-11]` by
`_bmad-output/implementation-artifacts/guided-procedure-preparation.md`, which is the adopted
direction. After reviewing LivePlan the owner moved this into **v1**, as Epic 2 extension
stories, and settled the open question below: the auditor has TWO acts of assent and they are
different claims — section acceptance ("this part is right") and auditor approval ("the whole of
it is what I intend to delegate", which is the existing `SUBMITTED` state).

**This file is kept as the record of how the idea started** and of the junior-auditor framing it
produced, which the adopted direction builds on. Read it for the reasoning; read the adopted
direction for what is planned.

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

## What the agent is: a junior auditor, not a typist

The owner corrected a first reading of this note that described the agent as something that
*collects* field values. That is a form with a chat skin on it, and it is not what was asked
for.

> "the agent can reframe words as long as the intent isnt lost… if as an auditor i get a junior
> auditor to assit me, i will give them instructions, they will go and act in line with those
> instructions based on their understanding of my intent, which they confirmed with me before
> hand… we are building a digital assistant that can think and reason and understand intent,
> understand the methodology, understand why we are testing the way we are testing… it should
> even be able to catch clerical errors, missinterpretations, etc. — e.g. you said X, did you
> mean Y? You tell it for example that the source document is an excel sheet and column C is
> where the status of the employee is; if the status is actually on column B, it should be able
> to read and reason that actually its on column B, continuing now."

So the agent is expected to:

- take **intent**, not dictation, and put it in its own words;
- understand the **methodology** — why a control is tested this way, not only what fields a
  Template has;
- **confirm** its understanding before acting on it;
- **catch a slip** and say so — "you said X, did you mean Y?";
- **read the real source**, notice that it disagrees with what it was told, reason about it,
  carry on, and **report what it found**.

None of that is in tension with anything below. The line that matters is not how much the agent
thinks; it is **when its thinking stops being negotiable.**

## The line: reasoning before the freeze, never after it

```
agent reasons, reframes, questions, proposes corrections   ← all the intelligence lives here
                          ↓
        the auditor confirms: "yes, that is what I meant"
                          ↓
                  ═══ frozen ═══
                          ↓
        the compiler writes the plan; a Run executes exactly that
```

Above the line the agent may be as capable as it can be. Below it nothing moves — and the
reason is not distrust of the model. It is that **an auditor signs the work**. If the artifact
changed after they approved it, they attested to something they never decided. That is also why
the agent must ASK rather than silently repair: a junior auditor who quietly rewrites your scope
is not a good junior auditor.

The owner's own example, end to end:

- **Today.** The auditor declares column C. The Run reads column C, finds nothing, and reports
  every record uninspected. Honest, and useless.
- **v2.** The agent opens the sheet, sees `status` in column B, and says *"you said C — the file
  has status in column B. Use B?"* The auditor accepts. **B** becomes the declared column, the
  frozen plan names B, and the correction is on record with who proposed it and who accepted it.

**This posture already exists on the execution side.** Epic 4's agent reasons about what it
sees and, when it is not sure, raises a typed Escalation and waits for a person rather than
guessing; a proposal that contradicts the frozen policy is `UNEVALUATED`, never quietly
corrected. v2 extends the same stance to authoring.

## Constraints v2 inherits and must not weaken

- **The frozen artifact stays deterministic and compiler-produced.** The model may reason its
  way to *what the inputs should be*; once those are confirmed, `makePlan` composes the plan and
  `derive-plan.ts` refuses an attempt whose semantics differ. The check to keep: throw the
  conversation away, keep only the confirmed inputs, re-run the compiler, and the plan must come
  back byte for byte identical.
- **A correction is proposed and accepted, never applied silently.** Anything the agent inferred
  rather than heard is a question, not a decision.
- **Retrieved and typed text stays inert.** What the auditor says, and what the agent read out
  of a source file, are authored text like any other: `UntrustedText`, digest-and-length audit
  payloads, no free text reaching an executable field.
- **Every save is still an audited command against a row-version token.** A conversation that
  writes silently would lose the staleness guarantee the Builder has.
- **The auditor can still read what will execute**, in the platform's own words, before
  submitting. The conversation does not replace the plan preview.

## Three things v2 must work out

1. **Provenance per input.** A reviewer later asks "who decided column B?" The record must
   distinguish: the auditor said it, the agent proposed it and the auditor accepted, or the
   agent read it from the source and the auditor accepted. Today every authored field has one
   origin — a person typed it — and that is no longer true.
2. **What the approval attests to.** With reframing, the auditor is confirming *"this wording
   captures my intent"*, which is a larger claim than *"I typed this"*. That is the same open
   question as the two-acts-of-assent one above, and reframing makes it matter more, not less.
3. **Drift.** A confirmed reading of a source ("status is in column B") can go stale when the
   source changes. The agent should notice and re-ask rather than carry a stale confirmation
   forward — the binding digest already detects the change; what is missing is the re-ask.

## Where the pieces already are

- Authoring commands and state machine: `packages/domain/src/procedures/procedure-version.ts`,
  `packages/application/src/procedures/`
- Plan composition: `packages/domain/src/procedures/executable-plan.ts` (`makePlan`)
- Model-as-check: `packages/application/src/procedures/derive-plan.ts`
- Role gating: `packages/domain/src/identity/roles.ts`
- Run admission: `packages/application/src/runs/initiate-run.ts`
- The surfaces this would replace or wrap: `apps/web/src/procedures/BuilderSections.tsx`,
  `DraftBuilder.tsx`, `AgentSummary.tsx`, `ExecutablePlanPreview.tsx`
