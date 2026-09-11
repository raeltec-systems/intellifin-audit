import { POPULATION_DRAFT_MESSAGES } from '@intellifin/domain';

/**
 * Copy this application reproduces verbatim from the UX contract.
 *
 * It is collected in one module for one reason: `copy.test.ts` reads DESIGN.md and
 * EXPERIENCE.md off disk and checks every string here appears there character for
 * character. A sentence typed inline in a component is pinned against nothing, and the
 * repository already learned this once — `tests/unit/denial-strings.test.ts` does the
 * same job for the five refusal strings.
 *
 * A string here is a QUOTATION. Rewording one is a change to the contract, not to the code.
 */

/** DESIGN.md → Layout & Spacing. The PoC's standing disclaimer. */
export const ENVIRONMENT_RIBBON_SENTENCE =
  'Synthetic PoC environment — Population Sources and Target Systems are read-only synthetic systems. Results are not assurance conclusions.';

/**
 * EXPERIENCE.md → Per-surface states. Each entry is one EmptyState: the contract writes
 * it as a single string, and the component takes a headline and a sentence, so the split
 * point is recorded here and the test rejoins them before comparing.
 */
export const EMPTY_STATES = {
  overviewNoRuns: {
    headline: 'No Runs yet.',
    sentence:
      'No Procedure has run in this environment. An empty Overview does not mean a control passed.',
  },
  overviewNothingNeedsAttention: {
    headline: 'Nothing needs attention.',
    sentence:
      'No Result awaits confirmation or review, no Run is waiting on you, and none is Inconclusive or Run Failed. This does not imply that any control passed.',
  },
  reviewQueueEmpty: {
    headline: 'No Result awaits your decision.',
    /** Not from the contract: EXPERIENCE.md gives this surface a headline only. */
    sentence:
      'A submitted Result, its outcome, and its Evidence Quality Gate would be listed here. An empty queue does not mean a control passed.',
  },
  notificationsEmpty: {
    headline: 'No Run is waiting on you.',
    /** Not from the contract: EXPERIENCE.md gives this surface a headline only. */
    sentence:
      'A Run waiting for an answer, or one flagged to an Audit Manager, appears here with the time remaining.',
  },
} as const;

/**
 * The empty states whose FULL text is quoted from EXPERIENCE.md — headline and sentence
 * together. The other two quote only the headline, because the contract gives only a
 * headline; their sentences are ours and follow the EmptyState rule instead.
 */
export const FULLY_QUOTED_EMPTY_STATES = [
  'overviewNoRuns',
  'overviewNothingNeedsAttention',
] as const satisfies readonly (keyof typeof EMPTY_STATES)[];

/**
 * The registration-change warning, quoted from EXPERIENCE.md's "Registration change"
 * row (FR-14).
 *
 * It shipped first as a sentence typed inline in `RegistrationForm.tsx` — "This creates
 * … which an Audit Manager must approve" against the contract's "This change creates …
 * and requires approval" — and nothing noticed, because no Procedure exists in this
 * release, so the branch that renders it is unreachable and no test could read it. That
 * is the worst case for inline copy: wrong on arrival and wrong again the day it first
 * appears. `copy.test.ts` reads the row off disk.
 *
 * `{n}` is substituted, not interpolated into a retyped sentence, so the only thing
 * this file can get wrong is the number.
 */
export const REGISTRATION_CHANGE_WARNING_TEMPLATE =
  'This change creates a platform-authored draft for {n} Procedures and requires approval.';

export function registrationChangeWarning(count: number): string {
  return REGISTRATION_CHANGE_WARNING_TEMPLATE.replace('{n}', String(count));
}

/**
 * What a Procedure is told when its Population Source binding declares no expected
 * record count. Quoted from EXPERIENCE.md's Flow 1 failure line (FR-6).
 *
 * The Builder shows it in Epic 2, beside a disabled Submit. This surface shows it at
 * REGISTRATION time, which is where FR-6's "its absence is surfaced at authoring time"
 * can still be acted on: the administrator who chose `none` is the one who can go and
 * find the cover sheet. The sentence is the same one either way, so the person who reads
 * it in the Builder later recognizes it.
 */
export const DECLARED_COUNT_MISSING_SENTENCE =
  POPULATION_DRAFT_MESSAGES.COUNT_MISSING;

/**
 * What the surface says about a manual-upload binding (FR-6, AD-23).
 *
 * EXPERIENCE.md's "Upload with scheduled frequency" row fixes this sentence as the
 * Builder's blocker. It shipped here as an INVENTED sentence, under a doc comment
 * claiming the contract was silent about the restriction — it is not, and a surface
 * that words a rule one way while the Builder words it another teaches an administrator
 * a sentence they will never see again.
 *
 * It is stated at registration time as well as at submission because the Builder that
 * enforces it does not exist until Epic 2, and somebody registering a manual upload for
 * a weekly Schedule should not first learn the rule from a blocked Submit.
 */
export const MANUAL_UPLOAD_SENTENCE =
  POPULATION_DRAFT_MESSAGES.MANUAL_UPLOAD;

/**
 * The four UX-DR7 cells of a Procedure card, stated in words when absent.
 *
 * The spec fixes these four sentences because a dash or an empty cell is something a
 * reader takes for "fine": a Procedure with no Active version yet, no Schedule yet, no
 * Run yet and no outcome yet must SAY so, exactly as Story 1.6's "Never probed" says
 * what a registration that has never been probed is. In this story every one of the
 * four is always absent — no version can leave DRAFT and no Run exists — so every card
 * renders all four sentences; they are data here so the day a cell can be filled, the
 * fill and the fallback live in the same place.
 */
export const PROCEDURE_CARD_ABSENT = {
  activeVersion: 'No active version',
  schedule: 'Not scheduled',
  nextRun: 'No Runs yet',
  lastOutcome: 'No outcome',
} as const;

/**
 * What the Builder says under a section it renders read-only.
 *
 * `[REVISED 2026-09-08]` It used to read "…is not editable yet. A later release makes
 * it editable", which was written when Stories 2.2–2.5 were still ahead. Every authored
 * section is editable now, so the sentence promised a release that had already happened
 * and — worse — sat under the Control section, whose NAME a person can change from this
 * very page. A sentence that says a thing cannot be done, beside the control that does
 * it, is worse than no sentence: it stops somebody looking.
 *
 * Two sections remain read-only, and each says the true thing about itself. It lives
 * here, not inline, because it is a contract sentence about what the Builder does — the
 * same class of sentence as the empty states.
 */
export const BUILDER_SECTION_TEMPLATE_ONLY_SENTENCE =
  'These sections are pre-filled from the Template. Edit the context for this procedure; the Template stays unchanged.';

/**
 * Keeps the procedure's name distinct from its editable control statement. Avoid
 * positional directions: the guided Builder groups the name with the context.
 */
export const BUILDER_CONTROL_NAME_EDITABLE_SENTENCE =
  'Use the Control name form to edit the name saved on this Draft. Editing a Draft never changes the Template it came from.';

/**
 * The responsive floor for the Builder (NFR-11, EXPERIENCE.md → Responsive breakpoints).
 *
 * Below 900px the Builder is reading mode and shows this sentence rather than degrading the
 * authoring flow. It is a contract sentence, quoted verbatim: `copy.test.ts` reads it off
 * EXPERIENCE.md.
 */
export const BUILDER_DESKTOP_ONLY_SENTENCE = 'Open on a desktop browser to author or approve.';
export const AUTHOR_CANNOT_APPROVE_SENTENCE = 'You cannot approve a version you authored.';

/**
 * What every corrective action says about the Run it was taken from.
 *
 * EXPERIENCE.md → Voice & Tone: `"This Run remains unchanged." after every corrective
 * action`, against `implying a rerun edits history`. A rerun creates a NEW Run and
 * touches nothing of its predecessor — not the row, not the Evidence, not the Result,
 * not the audit chain — and this is the sentence that says so.
 */
export const RUN_UNCHANGED_SENTENCE = 'This Run remains unchanged.';

/**
 * What a Canceled Run Detail states (EXPERIENCE.md → Per-surface states, Run Detail /
 * Canceled: `Canceled by {actor} at {elapsed}`).
 *
 * `CANCELED` is reserved for a person, so the surface names which one and when — read
 * from the durable cancellation marker, never guessed. Substituted rather than
 * interpolated into a retyped sentence, so the only things this file can get wrong are
 * the actor and the time.
 */
export const RUN_CANCELED_BY_TEMPLATE = 'Canceled by {actor} at {elapsed}';

export function runCanceledBy(actor: string, at: string): string {
  return RUN_CANCELED_BY_TEMPLATE.replace('{actor}', actor).replace('{elapsed}', at);
}

/**
 * The stale-data banner (EXPERIENCE.md → Per-surface states, "Any / Stale data").
 *
 * Every read on Runs and Run Detail is a REQUEST-TIME read: nothing polls, nothing
 * streams and nothing auto-refreshes here (Epic 5 adds the live channel on Live View).
 * This banner is what tells the reader the page is a snapshot and how old it is, and the
 * word "Refresh." is the affordance that gets a newer one.
 *
 * The template is composed FROM the action word rather than repeating it, so the sentence
 * and the link label cannot drift apart.
 */
export const STALE_DATA_ACTION = 'Refresh.';
export const STALE_DATA_TEMPLATE = `Updated {time}. ${STALE_DATA_ACTION}`;

/** The sentence without its trailing action, which the surface renders as a link. */
export function updatedAtTitle(time: string): string {
  return STALE_DATA_TEMPLATE.replace('{time}', time).slice(0, -STALE_DATA_ACTION.length).trimEnd();
}

/**
 * The Evidence tab's empty state (EXPERIENCE.md → Run Detail / Queued).
 *
 * The contract gives the headline only, so the sentence is OURS and follows the
 * EmptyState rule: name what would appear and refuse to imply a passed control.
 */
export const NO_EVIDENCE_HEADLINE = 'No Evidence collected.';

/**
 * The Runs table's Change cell when the two Runs ran different Procedure Versions
 * (EXPERIENCE.md → Rail cards, "Change since previous Run").
 *
 * Two versions are two definitions of the control, so a finding that is present in one
 * and absent in the other may be a condition the newer version no longer states. Calling
 * that "resolved" would be a claim nobody checked.
 */
export const NOT_COMPARABLE_SENTENCE = 'Not comparable — versions differ';

/**
 * A scheduled Run that never started (EXPERIENCE.md → Runs / Missed scheduled start).
 *
 * TRANSCRIBED, NOT RENDERED. Epic 3 initiates every Run by hand: there is no Schedule
 * dispatcher, no missed-start record and nothing that could truthfully fill `{time}`.
 * It is quoted here now, with the two Submit sentences below, so the story that grows a
 * Schedule uses the contract's words rather than retyping them — the fourth-retyping
 * lesson from the denial strings. A surface that rendered it today would be inventing
 * the fact as well as the sentence.
 */
export const MISSED_SCHEDULED_START_TEMPLATE = 'Missed 06:00 UTC start; not run';

/**
 * Why Submit is unavailable (EXPERIENCE.md → Run Detail / Completed unsealed, Inconclusive).
 *
 * TRANSCRIBED, NOT RENDERED, for the same reason. Story 6.3 is what submits a Result;
 * a disabled control whose action does not exist is worse than a control that is not
 * there yet, so this story renders the Safe next action panel instead and leaves the
 * words here for the story that grows the control.
 */
export const SUBMIT_UNAVAILABLE = {
  unsealed: 'Submission is unavailable while the Result is unsealed.',
  inconclusive:
    'Submission is unavailable for an Inconclusive Run. No conclusion exists to review.',
} as const;

/**
 * The derived Gate header count (DESIGN.md → Evidence Quality Gate checklist).
 *
 * DESIGN.md fixes the FORM — `The header count is derived ("18 of 20 checks passed"),
 * never a fixed "9/9"` — so the template is built from its own example and `copy.test.ts`
 * requires that example to appear in the artifact.
 */
export const GATE_COUNT_TEMPLATE = '{passed} of {total} checks passed';

export function gateCount(passed: number, total: number): string {
  return GATE_COUNT_TEMPLATE.replace('{passed}', String(passed)).replace('{total}', String(total));
}

/**
 * What an untrusted block says about itself (DESIGN.md → Untrusted source content).
 *
 * DESIGN.md requires retrieved free text to be "displayed in a warning-bordered block as
 * `<pre>` plain text, labeled with the field it came from and the statement that source
 * content cannot change the Run objective, tool scope, or evaluation."
 *
 * The sentence is built from the artifact's own clause rather than retyped, so the only
 * thing this file can get wrong is the capital letter and the full stop.
 */
export const UNTRUSTED_CONTENT_CLAUSE =
  'source content cannot change the Run objective, tool scope, or evaluation';
export const UNTRUSTED_CONTENT_SENTENCE = `S${UNTRUSTED_CONTENT_CLAUSE.slice(1)}.`;

/**
 * The Runs surface's own empty state.
 *
 * OURS, not quoted: EXPERIENCE.md gives the Runs surface no verbatim empty-state
 * sentence, and pinning a sentence against a file that does not contain it is a test
 * that cannot pass. It obeys the EmptyState rule — name what would appear and refuse to
 * imply a passed control — and it is the sentence the placeholder page already carried.
 */
export const RUNS_EMPTY_STATE = {
  headline: 'No Runs yet.',
  sentence:
    'A Run, its lifecycle state, and its sealed Result would be listed here. An empty list does not mean a control passed.',
} as const;

/**
 * The Evidence tab's sentence, and the Review tab's.
 *
 * Both OURS. The Evidence headline above is the contract's; this names what would appear.
 * The Review tab has NO data behind it in this epic and says so rather than rendering an
 * empty list a reader takes for "fine": Epic 3 creates no Auditor Review at all, and
 * Story 6.3 is what submits one.
 */
export const RUN_TAB_EMPTY = {
  evidence: {
    headline: NO_EVIDENCE_HEADLINE,
    sentence:
      'The population snapshot, each Reference Source, and each Target System extraction would be listed here with its integrity digest. No Evidence does not mean a control passed.',
  },
  exceptions: {
    headline: 'No Exception was raised.',
    sentence:
      'A record that failed a condition of this control would be listed here with the conditions it failed. An empty list does not mean a control passed; read the Evidence Quality Gate before concluding anything from it.',
  },
  review: {
    headline: 'No Auditor Review has started.',
    sentence:
      'The submission, the reviewer, and the decision would be listed here. A Result is submitted for review in a later release, so no Run in this environment has one; an absent review does not mean a control passed.',
  },
  timeline: {
    headline: 'Nothing has executed yet.',
    sentence:
      'Session Steps, Work Items, and Step Executions would be listed here as the Run performs them. An empty Timeline does not mean a control passed.',
  },
} as const;

/**
 * The two panels DESIGN.md names for a Run that concluded nothing an auditor can act on.
 *
 * The HEADINGS are DESIGN.md's own component names. The BODY of the Safe next action
 * panel is not written by us at all: it is addendum §E.1's "Permitted human action" cell
 * for the row that decided this Result, which `OUTCOME_ROWS[].humanAction` transcribes
 * and `tests/unit/outcome-rules.test.ts` pins against the addendum on disk.
 */
export const SAFE_NEXT_ACTION_HEADING = 'Safe next action';
export const EXECUTION_FAILURE_HEADING = 'Execution failure';

/** What the third triptych cell says when no Result has been published yet. */
export const NO_RESULT_STATEMENT = 'No Result has been published for this Run.';

/**
 * What an Evidence item says when nothing recorded when it was captured.
 *
 * FR-31 requires a capture time in UTC on every Evidence item. Generation 32 gives both
 * Evidence tables the column, so every artifact frozen from that generation onwards
 * carries a measured instant — but a row an earlier build wrote and could not be
 * attributed to a Step Execution has none, and there is no honest way to invent one. It
 * says so, rather than showing a dash that reads as "fine".
 */
export const CAPTURE_TIME_UNRECORDED = 'Capture time was not recorded.';

/**
 * How the recorded capture time came to be, said beside it.
 *
 * `registration` is measured — the clock inside the transaction that registered the
 * artifact. `step-execution` is RECOVERED: generation 32 backfilled it from the Step
 * Execution that uploaded, verified and registered the bytes, which is a real instant for
 * that artifact but not one anybody measured as a capture. A reader comparing two Evidence
 * items has to be able to tell those apart, and only the row can say which it is.
 */
export const CAPTURE_TIME_SOURCE = {
  registration: 'Measured when the artifact was registered.',
  'step-execution': 'Recovered from the Step Execution that froze the bytes.',
} as const;

/**
 * What a Step Execution says when its surface records no Tool Actions in this build.
 *
 * OURS. `run_tool_action` is ONE table and one shape for both surfaces (AD-6), and Story
 * 4.2 wrote the `agent` rows; the ADAPTER path writes none yet. So an adapter Step
 * Execution renders with nothing beneath it — and an empty fourth level reads as "no
 * actions were taken", which is false: the adapter resolved a credential, fetched a
 * collection and froze the response.
 *
 * This project has already chosen a sentence over an empty space three times for exactly
 * this reason: `Never probed` on the connectivity column, `Not evaluated` on an unrun Gate,
 * and `Capture time was not recorded.` above. A dash or an empty cell is something a reader
 * takes for "fine".
 *
 * An AGENT Step Execution with no Tool Actions is a genuine absence and says nothing,
 * because one that took no action really did take none.
 */
export const ADAPTER_ACTIONS_UNRECORDED =
  'This build does not record adapter actions here yet; the extraction is on the Evidence tab.';

/**
 * The Runs table's Change cell, when the two Runs are comparable.
 *
 * OURS. EXPERIENCE.md fixes only the incomparable sentence above; the compact form of
 * "Change since previous Run" needs words, and these are them. "No change" is said
 * rather than left blank, because an empty Change cell is the classic thing a reader
 * takes for "fine" when it might equally mean "nothing was compared".
 */
export const RUN_CHANGE = {
  unchanged: 'No change',
  template: '{added} new, {resolved} resolved',
} as const;

export function runChangeSummary(added: number, resolved: number): string {
  return added === 0 && resolved === 0
    ? RUN_CHANGE.unchanged
    : RUN_CHANGE.template.replace('{added}', String(added)).replace('{resolved}', String(resolved));
}

/**
 * Why the Evidence Quality Gate has no rows for a Run.
 *
 * OURS. A Run that never reached the Gate has no §H rows at all — a Run canceled while
 * queued is exactly that — and an empty checklist rendered as though the Gate had run and
 * found nothing is the "empty list reads as a passed control" defect in its purest form.
 * Every sentence here says the same thing in the state's own terms: nothing was evaluated,
 * and that is not the same as a check that passed.
 */
export const GATE_NOT_EVALUATED = {
  active:
    'The Evidence Quality Gate runs when execution finishes. No check has been evaluated yet, which is not the same as a check that passed.',
  canceled:
    'The Run was canceled before the Evidence Quality Gate ran. No check was evaluated, which is not the same as a check that passed.',
  stopped:
    'The Run stopped before the Evidence Quality Gate ran. No check was evaluated, which is not the same as a check that passed.',
} as const;

/**
 * A value the Population Source binding designates sensitive (FR-41).
 *
 * EXPERIENCE.md → Exception Detail / Masked field: "Value shown as `••••` with 'Masked by
 * the Population Source binding'; unmasked in Exception Detail for Auditor and Audit
 * Manager only." The Exception Detail surface is a later epic; the list row here masks.
 */
export const MASKED_VALUE = '••••';
export const MASKED_BY_BINDING = 'Masked by the Population Source binding';

/**
 * What the Result tab says when the stored publication is not a shape this build reads.
 *
 * OURS. `run_result.publication` is `jsonb` whose CHECK says only that it is an object,
 * so a row written by an older build, a fixture or a psql session can hold a document
 * whose members do not exist here. The outcome, the seal and the Result version are typed
 * COLUMNS and are still true; only the document is unreadable, and saying so is the
 * difference between a Result an auditor can partly trust and a framework 500.
 */
export const UNREADABLE_PUBLICATION = 'The published Result document could not be read.';

/**
 * The Paused Run's own copy (Story 5.4, EXPERIENCE.md "Run Detail — Paused").
 *
 * `banner` is that row's sentence character for character, with the two instants the row
 * names as `{actor}`, `{time}` and `{ends}`; `copy.test.ts` reads it off disk and pins the
 * template. The disabled Pause reason lives in `ESCALATION_PANEL_COPY.pauseUnavailable`,
 * which is EXPERIENCE.md's Awaiting-Auditor row and was already pinned there.
 */
export const PAUSE_COPY = {
  banner: 'Paused by {actor} at {time}. Resumes on your action; ends Inconclusive at {ends}.',
  requested: 'Pause requested.',
  requestedBody:
    'The Run pauses at its next Tool Action, before any further Target System work. Evidence already collected is preserved.',
  resumed: 'Run resumed.',
  resumedBody: 'The agent restarts the current Step from its first Tool Action. Nothing already recorded is removed.',
  confirmTitle: 'Pause this Run?',
  confirmConsequence:
    'This holds the Run for {procedure} at its next Tool Action. It resumes only when you say so, and ends Inconclusive if it is still paused after 30 minutes. The pause is recorded against your name.',
  unknown: 'The pause could not be confirmed. Reload the Run to see whether it was paused.',
  resumeUnknown: 'The resume could not be confirmed. Reload the Run to see whether it restarted.',
} as const;

/**
 * Flagging a Run to the Audit Managers (Story 5.5, FR-27, FR-28).
 *
 * There is no confirmation title here, and that is the contract rather than an omission:
 * EXPERIENCE.md's confirmation table enumerates the actions that open a dialog and
 * flagging is not among them. The control is a plain form with an optional note.
 *
 * `raised` never says the Run changed, because it did not: a flag has no execution effect,
 * and a message implying otherwise would be a control reporting an outcome it did not
 * produce.
 */
export const FLAG_COPY = {
  heading: 'Ask an Audit Manager to look',
  explanation:
    'This tells every Audit Manager to look at this Run. It does not pause, stop or change the Run in any way.',
  noteLabel: 'Note for the Audit Managers (optional)',
  noteHelp: 'Up to 500 characters. It is stored with the Run and is not sent to the agent.',
  submit: 'Flag to Audit Manager',
  raised: 'Audit Managers notified.',
  raisedBody: 'The Run carries on exactly as it was. Your note is recorded against your name.',
  unknown: 'The flag could not be confirmed. Reload the Run to see whether it was recorded.',
  none: 'This Run has not been flagged.',
  by: 'Flagged by {actor} at {time}.',
} as const;

/**
 * The Run Detail Escalation panel's contract copy.
 *
 * The first three strings are quoted from EXPERIENCE.md's Awaiting Auditor and
 * Escalation rows. The remaining strings state a bounded absence in the current wait
 * schema: a wait carries its kind and answer options, but no model question, Step or
 * supporting Evidence. Rendering that absence in words keeps the panel from inventing
 * provenance while the schema remains deliberately small.
 */
export const ESCALATION_PANEL_COPY = {
  answerNoteLabel: 'Recorded, not sent to the agent',
  pauseUnavailable: 'A Run waiting on an answer cannot be paused.',
  timeoutTemplate: 'This Escalation timed out at {time}; the Run is Inconclusive.',
  /**
   * EXPERIENCE.md's Accessibility rules: `Escalation panels are reachable by a skip link
   * ("Go to open Escalation") when present.` It read `Skip to open Escalation` from Story
   * 4.8 until Story 5.6 pinned it — a sentence typed inline in a component is pinned
   * against nothing.
   */
  skipLink: 'Go to open Escalation',
  unknown: 'The Escalation answer could not be confirmed. Reload the Run to see whether it was recorded.',
  noAgentQuestion: 'No agent-generated question was recorded for this Escalation.',
  noStep: 'Step was not recorded for this Escalation.',
  noSupportingEvidence: 'Supporting Evidence was not recorded for this Escalation.',
  unavailable: 'The open Escalation could not be read. Reload this Run before answering.',
  questions: {
    'choose-candidate': 'Choose one of the grounded candidates, or mark the record ambiguous.',
    'unnamed-value': 'Choose how the platform should handle this unnamed value.',
    'retry-or-skip': 'Choose whether the platform should retry this Work Item or skip it.',
  },
  /**
   * What the one polite live region says, and the ONLY things it says (Story 5.6).
   *
   * EXPERIENCE.md's Accessibility rules: `aria-live="polite"` announces Run state changes,
   * new Escalations, and countdown milestones (10 minutes, 1 minute)`. A clock in a live
   * region announces itself every second, which is the opposite of a milestone — so the
   * visible countdown is a `role="timer"` with no live region, and this ladder is what a
   * screen reader hears. It only ever moves forward, so each rung is announced once.
   *
   * These four are platform vocabulary rather than contract quotations: EXPERIENCE.md fixes
   * WHICH milestones are announced and does not write the sentences.
   */
  milestones: {
    open: 'An Escalation is open on this Run. It is waiting for your answer.',
    'ten-minutes': '10 minutes remain to answer this Escalation.',
    'one-minute': '1 minute remains to answer this Escalation.',
    expired: 'The Escalation deadline has been reached.',
  },
} as const;

/**
 * The Live View responsive floor (UX-DR25, UX-DR36; EXPERIENCE.md → Responsive
 * breakpoints, the "Live View | Below 1024px" row).
 *
 * Below 1024px the session viewer renders read-only and states this sentence rather
 * than degrading supervision into a control somebody can half-reach. The Builder's own
 * floor is `BUILDER_DESKTOP_ONLY_SENTENCE` at 900px and says something different — that
 * one is about AUTHORING — so the two are separate constants rather than one shared
 * sentence with a substituted verb. `copy.test.ts` reads both off EXPERIENCE.md.
 */
export const LIVE_VIEW_DESKTOP_ONLY_SENTENCE = 'Open on a desktop browser to supervise this Run.';

/**
 * Replay's own vocabulary (Story 5.8, FR-30, UX-DR26).
 *
 * Platform sentences, not contract quotations: EXPERIENCE.md's Replay row fixes what the
 * surface DOES — chrome REPLAY, paused at the first frame, a jump list of Work Items,
 * Exceptions and Escalations, and no provider — and does not write the words.
 *
 * `desktopOnly` is the exception and is the SAME sentence Live View shows, deliberately:
 * UX-DR25's responsive floor is about supervising a session, and Replay is that session
 * seen afterwards. A second sentence for the same rule is a second thing to keep in step.
 */
export const REPLAY_COPY = {
  play: 'Play',
  pause: 'Pause',
  viewerLabel: 'Session replay. Arrow keys step one frame; Space plays and pauses.',
  scrubberLabel: 'Step scrubber',
  keys: 'Arrow keys step one frame. Space plays and pauses. Home and End jump to the first and last frame.',
  noFrames: 'This Run captured no workspace frames, so there is nothing to replay. Its Session Steps, Evidence and Timeline are on Run Detail.',
  noAction: 'No Tool Action was recorded for this frame.',
  noJumpTargets: 'This Run recorded no Work Items, Exceptions or Escalations to jump to.',
  noFrameForTarget: 'no frame was captured here',
  observationsThrough: '{count} Observations had been registered when this frame was captured.',
  bounded: 'Showing the first {shown} of {total} frames.',
  notTerminal: 'This Run has not finished, so it has no Replay yet. Watch it in Live View.',
  desktopOnly: LIVE_VIEW_DESKTOP_ONLY_SENTENCE,
} as const;


/**
 * Why the Watch control is unavailable on a Queued Run (EXPERIENCE.md → Per-surface
 * states, the "Run Detail | Queued" row).
 *
 * A Queued Run has no workspace, no Step Execution and no frame, so there is nothing to
 * supervise; the control says so rather than opening a viewer with nothing in it.
 */
export const LIVE_VIEW_QUEUED_SENTENCE = 'Live View opens when the Run starts.';

/**
 * What the session viewer's chrome strip states about the workspace it is showing
 * (DESIGN.md → Session viewer).
 *
 * It is a claim about the Agent Workspace contract: every Tool Action is a permitted
 * READ gated against the frozen registration, and the credential a Run resolves is
 * isolated to that Run's workspace. The interpunct and its spaces are part of the
 * contract's own spelling, which is why this is read off DESIGN.md rather than retyped.
 */
export const SESSION_ISOLATION_NOTE = 'read-only · isolated credentials';
