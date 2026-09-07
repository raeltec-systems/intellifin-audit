import {
  isPermittedReadAction,
  type PermittedReadAction,
} from '../registrations/target-system.js';
import type { ProcedureTargetSnapshot } from '../procedures/target-draft.js';
import {
  parseFrozenLocation,
  withinFrozenOrigin,
  type FrozenLocation,
} from './frozen-location.js';

export { parseFrozenLocation, withinFrozenOrigin } from './frozen-location.js';
export type { FrozenLocation } from './frozen-location.js';

/**
 * The action gate and the sanitized action log (Story 4.2, FR-3, AD-4, AD-9).
 *
 * Every Tool Action an agent takes and every Adapter Action a deterministic adapter takes
 * passes through `authorizeToolAction` before it happens, and is recorded in ONE shape —
 * `SanitizedToolAction` — so a reader compares the two paths rather than translating
 * between them (AD-6 says so in as many words: "every lookup or extraction is an Adapter
 * Action on the Timeline with the same sanitized-action schema").
 *
 * **The gate reads the VERSION's frozen bytes and nothing else.** Not a current
 * registration, not a value derived from anything a page said, not an authored
 * instruction. `ProcedureTargetSnapshot.contract` is the six-key envelope AD-2 hashes, and
 * the three questions this module asks are answered from it:
 *
 *   1. is this action one the version permits (`permitted_actions`)?
 *   2. is this destination inside the version's `allowed_origins`?
 *   3. is every parameter value inside the Run's frozen scope?
 *
 * Pure: no I/O, no clock, no host types. `packages/domain` compiles with `lib: ["ES2024"]`
 * and no ambient types at all, so there is no `URL` here — which is why the origin rule is
 * written over strings and why `packages/infrastructure/src/runs/origin-policy.ts`
 * delegates to it rather than keeping a second copy.
 *
 * **This is NOT `scopeWideningWarnings`.** That function is FR-8's AUTHORING check and is
 * advisory by contract: it flags and never refuses, because an auditor must be able to
 * save prose a checker misreads. This one refuses. If they shared an implementation,
 * making one strict would silently make the other strict and a false positive would then
 * block a save. Two mechanisms, deliberately — and the seeded scope-widening instructions
 * meet this one at execution whatever the authoring flag said, because an instruction is
 * text and what reaches a Target System is an action.
 */

/* ------------------------------------------------------------ where an action may go --- */

/** How much of a destination is written into an immutable record. */
export const SANITIZED_DESTINATION_LIMIT = 500;

/** What a destination nothing can read is recorded as. Said in words, never as a blank. */
export const UNPARSEABLE_DESTINATION = '(unparseable destination)';

const SANITIZABLE_LOCATION = /^([A-Za-z][A-Za-z0-9+.-]*):(\/\/([^/?#]*))?([^?#]*)/;

/**
 * A destination as it may be written into an immutable record: scheme, authority, path.
 *
 * Never a query string — that is where a session token, a signed URL or a record
 * identifier lives — never a fragment, and never the `user:pass@` a URL can carry. This
 * SANITIZES where `parseFrozenLocation` REFUSES, and the difference is deliberate: a
 * destination that was denied because it carried credentials must still be recorded, and
 * recorded without them.
 */
export function sanitizeDestination(raw: unknown): string {
  if (typeof raw !== 'string') return UNPARSEABLE_DESTINATION;
  const match = SANITIZABLE_LOCATION.exec(raw.trim());
  if (match === null) return UNPARSEABLE_DESTINATION;
  const scheme = match[1]!.toLowerCase();
  const authority =
    match[3] === undefined ? '' : `//${match[3].replace(/^.*@/, '').toLowerCase()}`;
  return `${scheme}:${authority}${match[4] ?? ''}`.slice(0, SANITIZED_DESTINATION_LIMIT);
}

/* ---------------------------------------------------------------- the request and gate --- */

/** Bounds applied to a Tool Action before anything else looks at it. */
export const TOOL_ACTION_LIMITS = {
  /** How many parameters one action may carry. */
  parameters: 16,
  /** How long one parameter's name may be. */
  name: 200,
  /** How long one parameter's value may be. */
  value: 512,
} as const;

/**
 * One parameter an action carries.
 *
 * The NAME is what a denial reports (FR-3: "the security event names the parameter"); the
 * VALUE is judged against the Run's frozen scope. Both are recorded in the action log,
 * because addendum §B.1 derives an absence proof's query string FROM the sanitized Tool
 * Action log — "never agent-reported" — so a log that dropped the value would make an
 * honest absence unprovable. A credential is never a parameter: it is presented as a
 * request header the port sets and nothing here can see.
 */
export interface ToolActionParameter {
  readonly name: string;
  readonly value: string;
}

/** One action a producer proposes. Every field is untrusted until the gate answers. */
export interface ToolActionRequest {
  /** Checked against the version's frozen `permitted_actions`; never assumed to be one. */
  readonly action: string;
  /** The absolute destination the action would reach. */
  readonly destination: string;
  readonly parameters: readonly ToolActionParameter[];
}

/**
 * What the gate is allowed to consult, and the whole of it.
 *
 * `target` is the VERSION's frozen snapshot. `scopeValues` is the set of values this Run's
 * frozen population supplies for the Template's declared search keys — FR-3's own example
 * of an out-of-scope parameter is "a search outside the declared population", and the
 * population is frozen by the version exactly as the contract is. An EMPTY set therefore
 * denies every parameterised action, which is the correct reading of a stage that has no
 * population in hand: fail-closed, and never "no scope means no rule".
 */
export interface ToolActionScope {
  readonly target: ProcedureTargetSnapshot;
  readonly scopeValues: ReadonlySet<string>;
}

/**
 * Why an action was denied, as a closed vocabulary.
 *
 * Each row is a different thing for a reader to do about it, and each maps onto an §E.1
 * stop cause: a forbidden action and a parameter outside the population are
 * `action-denied`; a destination outside the frozen origins is `scope-violation`. A
 * denial is never reported as a transport failure — Epic 3 paid for that once, retrying
 * three times against a system that would go on refusing.
 */
export const TOOL_ACTION_DENIALS = [
  /** The action is not one the version's frozen `permitted_actions` names. */
  'action-not-permitted',
  /** The destination is not an absolute http(s) location this platform may act on. */
  'destination-refused',
  /** The destination is outside every frozen allowed origin. */
  'origin-not-allowed',
  /** A parameter is malformed, unbounded, or carries a value outside the frozen scope. */
  'parameter-out-of-scope',
] as const;
export type ToolActionDenial = (typeof TOOL_ACTION_DENIALS)[number];

export function isToolActionDenial(value: unknown): value is ToolActionDenial {
  return typeof value === 'string' && (TOOL_ACTION_DENIALS as readonly string[]).includes(value);
}

export type ToolActionDecision =
  | { readonly allowed: true; readonly action: PermittedReadAction; readonly destination: string }
  | {
      readonly allowed: false;
      readonly denial: ToolActionDenial;
      /**
       * What the denial names: the action, the sanitized destination, or the parameter's
       * NAME. Never a parameter's value and never a credential — this reaches the
       * immutable chain, and nothing that enters it can be taken out again.
       */
      readonly offending: string;
    };

/**
 * Decide whether one Tool Action may happen, from the frozen version snapshot alone.
 *
 * The order is the design. The ACTION is checked first because "you may not do that at
 * all" is a stronger and simpler statement than "not there"; the DESTINATION second; the
 * PARAMETERS last, because a parameter only means anything once the action and the place
 * are permitted. A denial stops at the first rule it meets, so one action produces one
 * reason rather than a list a reader has to rank.
 */
export function authorizeToolAction(
  scope: ToolActionScope,
  request: ToolActionRequest,
): ToolActionDecision {
  const contract = scope.target.contract;
  const action = request.action;
  // `includes` over the frozen array, not an object index: the action is request input and
  // `PERMITTED[action]` would answer `Object.prototype.constructor` for `'constructor'`.
  if (
    !isPermittedReadAction(action) ||
    !(contract.permitted_actions as readonly string[]).includes(action)
  ) {
    return {
      allowed: false,
      denial: 'action-not-permitted',
      offending: typeof action === 'string' ? action.slice(0, TOOL_ACTION_LIMITS.name) : '',
    };
  }

  const destination = parseFrozenLocation(request.destination);
  if (destination === null) {
    return {
      allowed: false,
      denial: 'destination-refused',
      offending: sanitizeDestination(request.destination),
    };
  }
  // A `desktop` registration's application identity occupies the `allowed_origins` slot of
  // the six-key envelope and is not a URL, so a desktop contract admits no destination at
  // all — which is the truth about a browser action against a system that has no origin.
  const permitted =
    contract.kind !== 'desktop' &&
    contract.allowed_origins.some((origin) => withinFrozenOrigin(origin, request.destination));
  if (!permitted) {
    return {
      allowed: false,
      denial: 'origin-not-allowed',
      offending: sanitizeDestination(request.destination),
    };
  }

  const parameters = request.parameters;
  if (!Array.isArray(parameters) || parameters.length > TOOL_ACTION_LIMITS.parameters) {
    return { allowed: false, denial: 'parameter-out-of-scope', offending: '' };
  }
  for (const parameter of parameters) {
    const name =
      typeof parameter?.name === 'string' ? parameter.name.slice(0, TOOL_ACTION_LIMITS.name) : '';
    if (
      name === '' ||
      // Untrimmed, or longer than the bound. A name that is not exactly what it says is two
      // spellings of one parameter in a record that can never be corrected.
      name !== parameter.name ||
      name.trim() !== name ||
      typeof parameter.value !== 'string' ||
      parameter.value.length > TOOL_ACTION_LIMITS.value ||
      // The population the VERSION froze is the scope. A value it does not supply is a
      // search outside the declared population (FR-3), whatever put it there — an
      // authored instruction a checker misread, a page that suggested it, or a model that
      // invented it. The comparison is an exact opaque string, the same rule identity keys
      // follow: no trimming, no case folding, no numeric parsing.
      !scope.scopeValues.has(parameter.value)
    ) {
      return { allowed: false, denial: 'parameter-out-of-scope', offending: name };
    }
  }

  return { allowed: true, action, destination: request.destination };
}

/* ------------------------------------------------------------------- the recorded shape --- */

/**
 * Which producer took the action.
 *
 * ONE table and one shape for both, so the Timeline reads as one sequence: the agent's
 * Tool Actions and a deterministic adapter's Adapter Actions differ in `surface` and in
 * nothing else. Story 4.2 writes the `agent` rows; the adapter path's own rows are named
 * here so that the shape does not have to be invented twice.
 */
export const TOOL_ACTION_SURFACES = ['agent', 'adapter'] as const;
export type ToolActionSurface = (typeof TOOL_ACTION_SURFACES)[number];

/** What became of an action. A denial is never `failed`, and a failure is never a denial. */
export const TOOL_ACTION_OUTCOMES = ['performed', 'denied', 'failed'] as const;
export type ToolActionOutcome = (typeof TOOL_ACTION_OUTCOMES)[number];

/**
 * Whether the platform captured anything from this action (Story 4.3).
 *
 * `SUPPRESSED` is a recorded FACT and never a gap. A missing Structural Snapshot with no
 * explanation reads to an auditor as "nothing happened here", which is the same defect
 * class as a dash that reads as "fine", an empty Gate checklist that reads as a passed
 * control, and the sign-out that did nothing and looked like success. The action itself is
 * on the Timeline either way — only its content is withheld.
 */
export const TOOL_ACTION_CAPTURES = ['PERMITTED', 'SUPPRESSED'] as const;
export type ToolActionCapture = (typeof TOOL_ACTION_CAPTURES)[number];

/**
 * Why capture was suppressed, as a closed vocabulary.
 *
 * Exactly one reason exists, and it is the one this story owns: the action presented a
 * credential, so a Structural Snapshot, a screenshot or a frame taken while it was on the
 * wire could put a working credential into immutable Evidence. "Entry" is credential USE
 * and not typing — LoanCore authenticates a GET with an `Authorization` header and has no
 * form — so the suppression follows the CREDENTIAL rather than a keystroke.
 */
export const CAPTURE_SUPPRESSIONS = ['credential-entry'] as const;
export type CaptureSuppression = (typeof CAPTURE_SUPPRESSIONS)[number];

/**
 * What capture state an action has, from the PLATFORM's own knowledge of its request.
 *
 * Derived here rather than reported by a provider: whether a credential is being presented
 * is something the caller decided before the port was reached, and a fact the provider
 * reported would be a fact the provider could get wrong.
 */
export function captureStateFor(presentsCredential: boolean): {
  readonly capture: ToolActionCapture;
  readonly suppression: CaptureSuppression | null;
} {
  return presentsCredential
    ? { capture: 'SUPPRESSED', suppression: 'credential-entry' }
    : { capture: 'PERMITTED', suppression: null };
}

/**
 * Every method a read-only execution may put on the wire, and the vocabulary the
 * `run_tool_action_method` CHECK pins.
 *
 * `GET` and `HEAD` are the reads. `POST` is here for exactly one operation — submitting a
 * Target System's own sign-in form — which mutates no audited business data and which the
 * system itself declares non-mutating. It is a CLOSED set and not a permission: the gate
 * decides what an action may do, and this decides only what can be truthfully recorded, so
 * a method outside it is a request this build did not make and a row nothing may write.
 */
export const TOOL_ACTION_METHODS = ['GET', 'HEAD', 'POST'] as const;
export type ToolActionMethod = (typeof TOOL_ACTION_METHODS)[number];

export function isToolActionMethod(method: unknown): method is ToolActionMethod {
  return typeof method === 'string' && (TOOL_ACTION_METHODS as readonly string[]).includes(method);
}

/**
 * One action, as it is recorded — the SAME shape for both surfaces.
 *
 * There is nowhere here for a credential, a request body, a response body, a header or a
 * provider object. `destination` is scheme, authority and path; the parameters are the
 * platform's own, so a §B.1 absence proof can be derived from this log rather than from
 * anything the agent reported about itself.
 */
export interface SanitizedToolAction {
  readonly toolActionId: string;
  readonly runId: string;
  /** The Step Execution this action happened inside. Every action has one. */
  readonly stepExecutionId: string;
  /** The Work Item, when the action belongs to one. `null` for a Session Step. */
  readonly workItemId: string | null;
  readonly surface: ToolActionSurface;
  /** The frozen registration id of the Target System the action addressed. */
  readonly targetSystem: string;
  /** The requested action, verbatim — including one the gate refused. */
  readonly action: string;
  /**
   * The request method the platform put on the wire.
   *
   * Read-only execution means one of {@link TOOL_ACTION_METHODS}. `POST` is in that set
   * because a sign-in submits the Target System's own form, and that operation creates a
   * SESSION and no audited business data — which is what FR-3 constrains
   * (`epic-4-loancore-authentication-decision.md`). Recording only the `GET` a sign-in
   * starts with would put the old method-as-a-proxy-for-mutation equivalence back one
   * layer down, in the log a reader checks the guarantee against.
   */
  readonly method: string;
  readonly destination: string;
  readonly parameters: readonly ToolActionParameter[];
  readonly outcome: ToolActionOutcome;
  readonly denial: ToolActionDenial | null;
  /** What a denial named, or `null`. Never a parameter's value. */
  readonly offending: string | null;
  /** The response status, when the action reached a system and one came back. */
  readonly status: number | null;
  /** Whether the system redirected the action somewhere else. */
  readonly redirected: boolean;
  /** How many downloads the destination offered. Offered, never executed. */
  readonly downloads: number;
  readonly startedAt: string;
  readonly completedAt: string | null;
  /** A closed diagnostic from the producing stage. Never an error message, never a URL. */
  readonly diagnostic: string | null;
  /**
   * Whether the platform captured anything from this action (Story 4.3).
   *
   * Recorded on every row, so a reader never has to infer from an absent artifact whether
   * capture was suppressed or simply produced nothing.
   */
  readonly capture: ToolActionCapture;
  /** Why capture was suppressed, or `null` when it was not. */
  readonly captureSuppression: CaptureSuppression | null;
}

/**
 * The §E.1 stop cause a denial maps onto, so a gate refusal ends the Run the way the
 * addendum says rather than the way each call site remembers.
 *
 * `action-denied` and `scope-violation` are both TERMINAL and both carry a security event;
 * `runStopFor` in `limits.ts` owns that mapping and this only says which of the two a
 * denial is.
 */
export function stopCauseForDenial(denial: ToolActionDenial): 'action-denied' | 'scope-violation' {
  return denial === 'origin-not-allowed' || denial === 'destination-refused'
    ? 'scope-violation'
    : 'action-denied';
}
