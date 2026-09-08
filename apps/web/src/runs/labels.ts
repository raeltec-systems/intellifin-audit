import {
  GATE_CHECKS,
  IMPLEMENTED_SNAPSHOT_SUBSTRATES,
  isActiveRunState,
  snapshotSubstrateForMediaType,
  type EvaluationOrigin,
  type EvaluationValue,
  type RunState,
  type SnapshotSubstrate,
  type SystemOutcome,
} from '@intellifin/domain';

import { CAPTURE_TIME_SOURCE } from '../design/copy';
import type { StatusState } from '../design/status';

/**
 * The words this surface writes, as data.
 *
 * Every lookup here is keyed by a value read out of a database row, so every lookup uses
 * `Object.hasOwn` and every one of them has a written-in-words fallback. `StatusBadge`
 * THROWS on a state outside its family — which on a server-rendered page is a 500 for the
 * whole Run — so a value the vocabulary does not hold must never reach it. That is the
 * `workItemState` pattern Story 3.2 established, collected here so five tabs share one
 * answer instead of five.
 */

/* ------------------------------------------------------------------ formats --- */

/**
 * One instant, ISO 8601 in UTC with `Z` (EXPERIENCE.md → Voice and Tone → Formats).
 *
 * Story 3.10 rendered `2026-09-06 09:00:00 UTC`, which is not ISO 8601; this story
 * renders timestamps on five surfaces, so the contract's own format is adopted here and
 * the two places that used the older spelling now come through this function.
 */
export function utcStamp(value: string | Date): string {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toISOString();
}

/** `2026-08-25 → 2026-08-31` (EXPERIENCE.md → Formats → Periods). */
export function periodText(period: { readonly from: string; readonly to: string }): string {
  return `${period.from} → ${period.to}`;
}

/** `3m 41s` (EXPERIENCE.md → Formats → Durations). Hours lead when there are any. */
export function durationText(milliseconds: number): string {
  if (!Number.isFinite(milliseconds) || milliseconds < 0) return '0s';
  const total = Math.floor(milliseconds / 1000);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  if (hours > 0) return `${hours}h ${minutes}m ${seconds}s`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

/** Thousands separators (EXPERIENCE.md → Formats → Counts). */
export function countText(value: number): string {
  return Number.isFinite(value) ? value.toLocaleString('en-US') : String(value);
}

/**
 * How long a Run has been running, or how long it took.
 *
 * A terminal Run measures to its sealed Result; an active one measures to the instant the
 * page was read, which the `Updated {time}. Refresh.` banner names. There is no polling
 * here, so a number that keeps moving would be a number that is wrong the moment it is
 * printed unless the reader is told when it was taken — and the banner is that telling.
 */
export function elapsedText(initiatedAt: string, endedAt: string | null, readAt: Date): string {
  const start = new Date(initiatedAt).getTime();
  const end = endedAt === null ? readAt.getTime() : new Date(endedAt).getTime();
  if (Number.isNaN(start) || Number.isNaN(end)) return '0s';
  return durationText(end - start);
}

/* ------------------------------------------------------------- vocabularies --- */

const RUN_LIFECYCLE_WORDS: Readonly<Record<string, StatusState<'run-lifecycle'>>> = {
  QUEUED: 'Queued',
  RUNNING: 'Running',
  PAUSED: 'Paused',
  AWAITING_AUDITOR: 'Awaiting Auditor',
  COMPLETED: 'Completed',
  INCONCLUSIVE: 'Inconclusive',
  RUN_FAILED: 'Run Failed',
  CANCELED: 'Canceled',
};

/** The lifecycle word, or `null` for a state the vocabulary does not hold. */
export function runLifecycleWord(state: string): StatusState<'run-lifecycle'> | null {
  return Object.hasOwn(RUN_LIFECYCLE_WORDS, state) ? RUN_LIFECYCLE_WORDS[state]! : null;
}

const OUTCOME_WORDS: Readonly<Record<string, StatusState<'result-outcome'>>> = {
  PASS: 'Pass',
  CONTROL_FAILURE: 'Control Failure',
  PENDING_CONFIRMATION: 'Pending Confirmation',
  // §E.1's three "(Run state)" outcomes all publish the same thing to a reader: this Run
  // issued no conclusion. The lifecycle cell beside it says WHICH of the three happened,
  // which is exactly why the triptych has three cells.
  INCONCLUSIVE: 'No conclusion issued',
  RUN_FAILED: 'No conclusion issued',
  CANCELED: 'No conclusion issued',
};

/**
 * The Result outcome word.
 *
 * `null` — no Result row at all — is `No conclusion issued`, and that is a FACT rather
 * than a placeholder: nothing has been published, so no conclusion has been issued. It is
 * the opposite of Story 2.1's "Active version: Draft" defect, where a cell stated
 * something that was not true.
 */
export function resultOutcomeWord(outcome: SystemOutcome | null): StatusState<'result-outcome'> | null {
  if (outcome === null) return 'No conclusion issued';
  return Object.hasOwn(OUTCOME_WORDS, outcome) ? OUTCOME_WORDS[outcome]! : null;
}

/**
 * The Evidence Quality Gate word for a Run, from its stored §H rows.
 *
 * No rows is `Not evaluated`: an unrun Gate is not a passed Gate, which is the same
 * fail-closed reading `OutcomeFacts.gatePassed` takes. A partial set of rows is
 * `Incomplete` — Story 3.8 writes all twenty in one transaction, so it should be
 * unreachable, and a badge that could not say it would leave the reader with `Passed`
 * over a checklist that never finished.
 */
export function gateWord(checks: number, failed: number): StatusState<'evidence-quality-gate'> {
  if (checks === 0) return 'Not evaluated';
  if (checks < GATE_CHECKS.length) return 'Incomplete';
  return failed === 0 ? 'Passed' : 'Not passed';
}

const WORK_ITEM_WORDS: Readonly<Record<string, StatusState<'work-item'>>> = {
  PENDING: 'Pending',
  IN_PROGRESS: 'In progress',
  AWAITING: 'Awaiting',
  OBSERVED: 'Observed',
  UNINSPECTED: 'Uninspected',
  AMBIGUOUS: 'Ambiguous',
  FAILED: 'Failed',
};

export function workItemWord(state: string): StatusState<'work-item'> | null {
  return Object.hasOwn(WORK_ITEM_WORDS, state) ? WORK_ITEM_WORDS[state]! : null;
}

const EVALUATION_ORIGIN_WORDS: Readonly<Record<string, StatusState<'evaluation-origin'>>> = {
  RULE: 'Rule-Classified',
  HUMAN: 'Human-classified',
};

/**
 * The evaluation-origin word. `AGENT_JUDGED` needs the confirmation state, because
 * DESIGN.md gives pending and confirmed two different treatments — the pending one is the
 * "needs a human" solid blue, and reading them as one would lose the whole distinction.
 */
export function evaluationOriginWord(
  origin: EvaluationOrigin,
  confirmation: string | null,
): StatusState<'evaluation-origin'> | null {
  if (origin === 'AGENT_JUDGED') {
    return confirmation === 'confirmed' ? 'Agent-Judged (confirmed)' : confirmation === 'pending' ? 'Agent-Judged (pending)' : null;
  }
  return Object.hasOwn(EVALUATION_ORIGIN_WORDS, origin) ? EVALUATION_ORIGIN_WORDS[origin]! : null;
}

const EVALUATION_VALUE_WORDS: Readonly<Record<string, StatusState<'evaluation-value'>>> = {
  COMPLIANT: 'Compliant',
  EXCEPTION: 'Exception',
  UNEVALUATED: 'Unevaluated',
};

export function evaluationValueWord(value: EvaluationValue): StatusState<'evaluation-value'> | null {
  return Object.hasOwn(EVALUATION_VALUE_WORDS, value) ? EVALUATION_VALUE_WORDS[value]! : null;
}

/** A Session Step has no badge family in DESIGN.md, so it is written in words. */
const SESSION_STEP_WORDS: Readonly<Record<string, string>> = {
  PENDING: 'Pending',
  IN_PROGRESS: 'In progress',
  ACQUIRED: 'Acquired',
  FAILED: 'Failed',
};

const STEP_EXECUTION_WORDS: Readonly<Record<string, string>> = {
  RUNNING: 'Running',
  SUCCEEDED: 'Succeeded',
  FAILED: 'Failed',
};

const EVIDENCE_STATE_WORDS: Readonly<Record<string, string>> = {
  RESERVED: 'Reserved',
  REGISTERED: 'Registered',
  ABANDONED: 'Abandoned',
};

const OBSERVATION_COVERAGE_WORDS: Readonly<Record<string, string>> = {
  COVERED: 'Covered',
  UNINSPECTED: 'Uninspected',
  AMBIGUOUS: 'Ambiguous',
};

const OBSERVATION_FOUND_WORDS: Readonly<Record<string, string>> = {
  true: 'Found',
  false: 'Not found',
  ambiguous: 'Ambiguous',
};

const CAPTURE_METHOD_WORDS: Readonly<Record<string, string>> = {
  adapter: 'Adapter',
  agent: 'Audit Agent',
};

const MATCH_ORIGIN_WORDS: Readonly<Record<string, string>> = {
  platform: 'Platform',
  'human-matched': 'Human-matched',
};

const PLAN_ACTION_WORDS: Readonly<Record<string, string>> = {
  'create-workspace': 'Create the Agent Workspace',
  'acquire-population': 'Acquire the population',
  'sign-in': 'Sign in to the Target System',
  'extract-adapter': 'Extract through the Adapter',
  'inspect-record': 'Inspect the record',
  'capture-observation': 'Capture the Observation',
  'evaluate-conditions': 'Evaluate the conditions',
};

/**
 * Where the Agent Workspace ran, in words (Story 4.1).
 *
 * The two are NOT the same guarantee, so the surface says which one this Run had rather
 * than printing a mode nobody can interpret: `solari` is a separate managed browser with
 * provider-side egress, `local` isolates browser state per Run and does not isolate the
 * worker process at all.
 */
/**
 * What became of one Tool Action, in words (Story 4.2's rows, Story 4.3's read).
 *
 * `denied` is the GATE refusing before anything left; `failed` is a transport failure;
 * `performed` reached the system, whatever the system then said. A 401 is `performed` with
 * a status of 401, because the action HAPPENED and the system said no — a different fact
 * from a gate refusal, and the difference is the one Epic 3 paid for losing.
 */
const TOOL_ACTION_OUTCOME_WORDS: Readonly<Record<string, string>> = {
  performed: 'Performed',
  denied: 'Denied',
  failed: 'Failed',
};

/**
 * Whether the platform captured anything from an action, in words (Story 4.3).
 *
 * Said out loud on every row. A missing Structural Snapshot with no explanation reads to a
 * reader as "nothing happened here", which is the same defect class as a dash that reads
 * as "fine" and an empty Gate checklist that reads as a passed control.
 */
const TOOL_ACTION_CAPTURE_WORDS: Readonly<Record<string, string>> = {
  PERMITTED: 'Capture permitted',
  SUPPRESSED: 'Capture suppressed',
};

/** Why capture was suppressed. One reason exists, and it is stated rather than implied. */
const CAPTURE_SUPPRESSION_WORDS: Readonly<Record<string, string>> = {
  'credential-entry': 'a credential was presented on this request',
};

const WORKSPACE_MODE_WORDS: Readonly<Record<string, string>> = {
  solari: 'Managed remote browser',
  local: 'Local browser, shared process',
};

/**
 * A closed table lookup that falls back to the stored value ITSELF.
 *
 * Never to a guess and never to an empty cell: a value this build does not recognise is
 * shown as it was stored, which is a true statement about the row, and it is what let
 * Story 3.2's `labelOf` render a state nobody had transcribed yet without lying about it.
 */
export function wordFor(table: Readonly<Record<string, string>>, value: string): string {
  return Object.hasOwn(table, value) ? table[value]! : value;
}

export const sessionStepWord = (state: string): string => wordFor(SESSION_STEP_WORDS, state);
export const stepExecutionWord = (state: string): string => wordFor(STEP_EXECUTION_WORDS, state);
export const evidenceStateWord = (state: string): string => wordFor(EVIDENCE_STATE_WORDS, state);
export const coverageWord = (state: string): string => wordFor(OBSERVATION_COVERAGE_WORDS, state);
export const foundWord = (found: string): string => wordFor(OBSERVATION_FOUND_WORDS, found);
export const captureMethodWord = (method: string): string => wordFor(CAPTURE_METHOD_WORDS, method);
export const toolActionOutcomeWord = (outcome: string): string =>
  wordFor(TOOL_ACTION_OUTCOME_WORDS, outcome);

/**
 * The capture sentence for one Tool Action.
 *
 * A suppressed capture always says WHY, in the same breath: "Capture suppressed" alone is a
 * gap with a label on it, and the reason is what tells an auditor that the absence of an
 * artifact here is a decision rather than a failure.
 */
export function captureSentence(capture: string, suppression: string | null): string {
  const word = wordFor(TOOL_ACTION_CAPTURE_WORDS, capture);
  return suppression === null ? word : `${word} — ${wordFor(CAPTURE_SUPPRESSION_WORDS, suppression)}`;
}
export const matchOriginWord = (origin: string): string => wordFor(MATCH_ORIGIN_WORDS, origin);
export const planActionWord = (action: string): string => wordFor(PLAN_ACTION_WORDS, action);
export const workspaceModeWord = (mode: string): string => wordFor(WORKSPACE_MODE_WORDS, mode);

/**
 * The Evidence item KIND, as DESIGN.md's Evidence item card names them.
 *
 * "a kind badge (Structural Snapshot · Screenshot · Source excerpt · Recording segment ·
 * Adapter extract)". Epic 3 stores three kinds; the other two arrive with agent execution.
 * This is deliberately NOT a `status.ts` family: that module is pinned against DESIGN.md's
 * nine-row table by a test that reads it off disk, and adding a row the table does not
 * have would break the claim that the module IS the table.
 */
const EVIDENCE_KIND_WORDS: Readonly<Record<string, string>> = {
  population: 'Source excerpt',
  'reference-source': 'Source excerpt',
  'adapter-extraction': 'Adapter extract',
  'structural-snapshot': 'Structural Snapshot',
  screenshot: 'Screenshot',
  'recording-segment': 'Recording segment',
};

export const evidenceKindWord = (kind: string): string => wordFor(EVIDENCE_KIND_WORDS, kind);

/**
 * How an Evidence item was captured, READ from the row (generation 32).
 *
 * It used to be derived from the artifact's KIND — true of every kind Epic 3 writes, and
 * a guess with good manners the moment two processes can produce one kind: the agent path
 * captures a Structural Snapshot and so can the adapter path. FR-31 requires the field on
 * every Evidence item, so the process that captured the artifact records it and this only
 * puts it in words.
 *
 * `null` for a row that recorded none, which the card says rather than showing a dash.
 */
export function evidenceCaptureMethod(method: string | null): string | null {
  return method === null ? null : captureMethodWord(method);
}

/** How the recorded capture time came to be, from the row's own provenance value. */
export function captureTimeSourceSentence(source: string | null): string | null {
  return source !== null && Object.hasOwn(CAPTURE_TIME_SOURCE, source)
    ? CAPTURE_TIME_SOURCE[source as keyof typeof CAPTURE_TIME_SOURCE]
    : null;
}

/**
 * Which stored artifacts the grounding inspector can open.
 *
 * Story 4.4's extractor implements `web_tree`, `sheet` and `json` and refuses
 * `desktop_tree` BY NAME, and it decides the substrate from the media type recorded
 * beside the digest. The DOMAIN's own `snapshotSubstrateForMediaType` answers that
 * question; a second media-type test here would be a second answer, and the two would
 * agree on `text/csv` and diverge on the first charset parameter nobody tried.
 */
export function inspectableSubstrate(mediaType: string | null): SnapshotSubstrate | null {
  const substrate = snapshotSubstrateForMediaType(mediaType);
  return substrate !== null && (IMPLEMENTED_SNAPSHOT_SUBSTRATES as readonly string[]).includes(substrate)
    ? substrate
    : null;
}

const CORROBORATION_WORDS: Readonly<Record<string, string>> = {
  matched: 'Matched',
  contradictory: 'Contradictory',
  'model-read': 'Model-read',
};

/**
 * The grounding corroboration badge's word (DESIGN.md → Grounding inspector:
 * "a corroboration badge (matched · contradictory · model-read)").
 *
 * Also not a `status.ts` family, for the same reason as the kind badge. `null` — the
 * attribute was never judged — is its own word rather than a missing badge: "nothing
 * read it" and "it read differently" are different statements and an auditor acts
 * differently on each.
 */
export function corroborationWord(value: string | null): string {
  return value === null ? 'Not judged' : wordFor(CORROBORATION_WORDS, value);
}

/** The rollup stored on the Observation row itself. */
const OBSERVATION_CORROBORATION_WORDS: Readonly<Record<string, string>> = {
  MATCHED: 'Matched',
  CONTRADICTORY: 'Contradictory',
  UNJUDGED: 'Not judged',
};

export const observationCorroborationWord = (value: string): string =>
  wordFor(OBSERVATION_CORROBORATION_WORDS, value);

/** Whether a Run is still in flight, from the domain's own list. */
export const runIsActive = (state: RunState): boolean => isActiveRunState(state);
