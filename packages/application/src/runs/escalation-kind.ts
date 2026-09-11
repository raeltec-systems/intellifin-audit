/**
 * The closed wait vocabulary, in a leaf with NO imports (Story 4.7, widened by 5.4).
 *
 * Dependency-free on purpose: the wait commands and the notification contracts both read
 * it, and importing a command module from a notification contract creates an
 * identity/notification cycle.
 *
 * A wait is a Run stopped on something outside itself. Until Story 5.4 every such thing
 * was an Escalation, so one list said both. Pause is a wait and is NOT an Escalation — no
 * question is asked, no Audit Manager is notified, and nothing about it belongs in the
 * inbox — so the two lists are now separate and every reader says which one it means.
 * `isEscalationKind` returning false for `pause` is what makes `raiseEscalation` refuse to
 * open one by construction.
 */

/** The only Escalation kinds in the PoC. */
export const ESCALATION_KINDS = [
  'choose-candidate',
  'unnamed-value',
  'retry-or-skip',
] as const;
export type EscalationKind = (typeof ESCALATION_KINDS)[number];

/** Every kind `run_wait` may hold. Generation 45's CHECK spells the same list. */
export const WAIT_KINDS = [...ESCALATION_KINDS, 'pause'] as const;
export type WaitKind = (typeof WAIT_KINDS)[number];

export function isEscalationKind(value: unknown): value is EscalationKind {
  return typeof value === 'string' && (ESCALATION_KINDS as readonly string[]).includes(value);
}

export function isWaitKind(value: unknown): value is WaitKind {
  return typeof value === 'string' && (WAIT_KINDS as readonly string[]).includes(value);
}

/**
 * The Run state a wait of this kind HOLDS the Run in, and the state it is opened FROM.
 *
 * One function, called by the command, the repository's insert, its closure, its timeout
 * and its recovery read. A second spelling of "a pause means PAUSED" is a second answer to
 * the question the compare-and-set asks, and the two would agree until the day they did
 * not.
 *
 * Both kinds open from `RUNNING`, which is why one constant serves both.
 */
export const WAIT_OPENED_FROM_STATE = 'RUNNING' as const;

export function waitRunState(kind: WaitKind): 'PAUSED' | 'AWAITING_AUDITOR' {
  return kind === 'pause' ? 'PAUSED' : 'AWAITING_AUDITOR';
}

/** Every Run state a wait can hold a Run in. The recovery sweep reads exactly these. */
export const WAIT_HELD_STATES = ['AWAITING_AUDITOR', 'PAUSED'] as const;

/**
 * How long a wait of this kind runs before its durable wake ends the Run Inconclusive.
 *
 * Four hours for a person answering an Escalation, thirty minutes for a pause — the two
 * windows EXPERIENCE.md's Run lifecycle row states, and each is a deliberate product
 * choice rather than one timeout wearing two names.
 */
export const AWAITING_AUDITOR_TIMEOUT_MS = 4 * 60 * 60 * 1000;
export const PAUSED_TIMEOUT_MS = 30 * 60 * 1000;

export function waitTimeoutMs(kind: WaitKind): number {
  return kind === 'pause' ? PAUSED_TIMEOUT_MS : AWAITING_AUDITOR_TIMEOUT_MS;
}

/**
 * How a wait of this kind closes when a person acts on it.
 *
 * Derived from the kind and never taken from a caller, so no command can close a pause as
 * though it had been answered, or answer an Escalation as though it had been resumed.
 * Generation 45's `run_wait_closure` CHECK refuses the same pair one layer down.
 */
export function waitClosureKindFor(kind: WaitKind): 'answer' | 'resume' {
  return kind === 'pause' ? 'resume' : 'answer';
}

/** An option is data. Its id is the only part an agent may receive after an answer. */
export interface EscalationOption {
  readonly id: string;
  readonly label: string;
}

/**
 * The only lifecycle states a wait can record.
 *
 * `resume` joined `answer` and `timeout` with Story 5.4. It is a separate closure and not
 * an `answer` whose option happens to be `resume`, because generation 45's CHECK can then
 * hold the pairing as a database fact: a pause closes by resume or timeout and never by an
 * answer, and an Escalation the other way round.
 *
 * `withdrawn` joined them with generation 47, from the PR 29 review. A Run that reaches a
 * terminal state while a wait is OPEN — today only a cancellation, which
 * `RUN_CANCEL_TRANSITIONS` gives to the command for both `PAUSED` and `AWAITING_AUDITOR` —
 * left that wait `closed_at` NULL for ever: a row asserting that a question is open about a
 * Run that is over, and one that then sat in `recoverableWaits`' BOUNDED page permanently,
 * so enough of them starve the sweep that finds waits whose wake was lost.
 *
 * It is its own kind rather than a `timeout`, which would say a deadline passed, or an
 * `answer`, which would say somebody decided. Nobody did either: the question was
 * WITHDRAWN because the Run it was about ended.
 */
export const WAIT_CLOSURE_KINDS = ['answer', 'resume', 'timeout', 'withdrawn'] as const;
export type WaitClosureKind = (typeof WAIT_CLOSURE_KINDS)[number];

/**
 * The actor on a withdrawn wait, pinned by generation 47's CHECK exactly as `wait-wake` is
 * pinned on a timeout.
 *
 * The SYSTEM, never the person who cancelled the Run — the same reading
 * `lifecycle.cancellation-superseded` takes. They asked for the Run to stop; withdrawing
 * the question is what the platform did in consequence, and naming them as its actor would
 * say they answered a question they never saw.
 */
export const WAIT_WITHDRAWN_ACTOR = 'run-terminal';

/** Fixed answer ids. Candidate choices use the candidate's opaque id. */
export const ESCALATION_OPTION_IDS = {
  markAmbiguous: 'mark-ambiguous',
  markUnevaluated: 'mark-unevaluated',
  continue: 'continue',
  abort: 'abort',
  retry: 'retry',
  skip: 'skip',
  /** A pause's only option. Reserved here so a candidate can never be spelled like it. */
  resume: 'resume',
} as const;

export type EscalationOptionId =
  | (typeof ESCALATION_OPTION_IDS)[keyof typeof ESCALATION_OPTION_IDS]
  | (string & {});

/**
 * The one option a pause wait carries (Story 5.4).
 *
 * A wait's options are the closed answer set its closure is checked against, so a pause
 * needs one even though its surface renders a Resume button rather than a choice: the
 * database CHECK requires a non-empty array and the closure refuses an option the row does
 * not carry.
 */
export const PAUSE_OPTIONS: readonly EscalationOption[] = [
  { id: ESCALATION_OPTION_IDS.resume, label: 'Resume' },
];

/**
 * One durable wait, exactly as it is stored (Story 4.7, widened by 5.4).
 *
 * It lives in this leaf rather than beside the wait commands because the execution
 * contexts have to name it to open a pause, and `waits.ts` already imports those contexts
 * — a type in the leaf is the only spelling that is not a cycle.
 */
export interface RunWait {
  readonly waitId: string;
  readonly runId: string;
  readonly kind: WaitKind;
  readonly options: readonly EscalationOption[];
  /** When the wait opened. Generation 45's column; the Paused banner reads it. */
  readonly openedAt: string;
  /**
   * Who caused it to open, or `null` when the platform did.
   *
   * A pause always names the auditor who asked for it — that is the "Paused by {actor}"
   * the banner states — and an Escalation never does, because the platform raised it.
   * Generation 45 pins that pairing with a CHECK rather than leaving it a convention.
   */
  readonly openedBy: string | null;
  readonly deadline: string;
  readonly closedAt: string | null;
  readonly closureKind: WaitClosureKind | null;
  readonly answerOptionId: string | null;
  readonly actor: string | null;
}

/**
 * A wait that is an Escalation, as a TYPE (Story 5.4).
 *
 * The Escalation panel, the inbox and the answer command all work on one of these, so a
 * pause cannot reach them by accident — it does not compile. `isEscalationWait` is the one
 * narrowing, used wherever a `RunWait` read from a row has to become one.
 */
export interface EscalationWait extends RunWait {
  readonly kind: EscalationKind;
}

export function isEscalationWait(wait: RunWait): wait is EscalationWait {
  return isEscalationKind(wait.kind);
}
