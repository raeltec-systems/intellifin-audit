import { and, asc, count, eq, inArray, ne, or, sql } from 'drizzle-orm';

import { ESCALATION_OPTION_IDS } from '@intellifin/application';

import type { Database, Transaction } from '../db/client.js';
import { isUuidText } from '../db/identifier.js';
import {
  auditEvents,
  runDeferredPause,
  runEvidenceCapture,
  runStepExecution,
  runToolAction,
  runWait,
  runWorkItem,
} from '../db/schema.js';
import type { RunPauseWorkItem } from './pause-history.js';

/**
 * The decisions a Run recorded, as the Execution Timeline lists them (Story 10.10, legacy
 * 4.8 AC 4, 5.6 AC 3 and 5.4 AC 3): every Escalation a person answered, and every pause
 * request the Run never honoured.
 *
 * An answered Escalation is a `run_wait` row closed by an `answer`, beside the
 * `execution.escalation-raised` event that opened it and the `execution.escalation-answered`
 * event that closed it, each written in the transaction that changed the row. A pause
 * request that never took effect is a `lifecycle.pause-superseded` event (the terminal
 * transition found the request still outstanding) or a `lifecycle.deferred-pause-superseded`
 * event (a "pause after this inspection" request retired before it applied), the second
 * beside its own `run_deferred_pause` row.
 *
 * Every join below follows an identity those records carry: the wait id from the row to its
 * events, the Evidence ids the raise named to the Tool Action that captured them and on to
 * the Work Item that action belongs to, the command id from an event to its marker row.
 * Nothing is paired by time, and no event is rewritten: a record written before a key
 * existed is read for what it holds, and the surface says what it does not.
 */

/** How many answered Escalations the Timeline lists; the total beside the list is exact. */
export const ESCALATION_ANSWER_LIMIT = 100;

/** How many unhonoured pause requests the Timeline lists; the total beside it is exact. */
export const PAUSE_REQUEST_LIMIT = 100;

const RAISED_EVENT = 'execution.escalation-raised';
const ANSWERED_EVENT = 'execution.escalation-answered';
const PAUSE_SUPERSEDED_EVENT = 'lifecycle.pause-superseded';
const DEFERRED_PAUSE_SUPERSEDED_EVENT = 'lifecycle.deferred-pause-superseded';

type ReadHandle = Database | Transaction;

/** The platform's own option ids, which never name a candidate a person chose. */
const PLATFORM_OPTION_IDS: ReadonlySet<string> = new Set(Object.values(ESCALATION_OPTION_IDS));

/**
 * The answer an Escalation received, from its own wait row.
 *
 * `candidate` is a choose-candidate answer that picked one of the candidates the question
 * offered: its 1-based position among them, how many there were, and the candidate's label
 * as offered — which the Audit Agent wrote, so a surface renders it inert. `option` is one
 * of the platform's own answers, named by its id; its words are the platform's, never the
 * label the row stored. `unreadable` is a row whose answer is not among the options it
 * offered, which a surface says in words rather than guessing.
 */
export type RunEscalationAnswer =
  | { readonly kind: 'candidate'; readonly candidate: number; readonly candidates: number; readonly label: string }
  | { readonly kind: 'option'; readonly optionId: string }
  | { readonly kind: 'unreadable' };

/**
 * Where the Escalation was raised.
 *
 * `recorded` is the plan step its raise event named, with the Work Item it was raised for
 * when the raise's own supporting Evidence establishes one exactly: every Evidence id it
 * named was captured by a Tool Action of ONE Work Item of this Run (Step Execution first,
 * the Replay rule), and that Work Item is at the same plan step. Anything short of that is
 * `workItem: null`, which the surface says was not recorded. `not-recorded` is a raise
 * whose event named no step, or a wait with other than one raise event.
 */
export type RunEscalationRaise =
  | { readonly kind: 'recorded'; readonly planStepId: string; readonly workItem: RunPauseWorkItem | null }
  | { readonly kind: 'not-recorded' };

export interface RunEscalationAnswerEntry {
  readonly waitId: string;
  /** The stored kind; a surface names it through `escalationKindWord`. */
  readonly kind: string;
  /** Who answered, as a user id (a name is resolved by the surface). */
  readonly answeredBy: string;
  readonly answeredAt: string;
  readonly answer: RunEscalationAnswer;
  /**
   * The answer's own event says the Run was canceled by it: an Abort, whose command ends
   * the Run in the transaction that closes the wait. Read from that event, never from the
   * Run's present state, which a later transition could have written.
   */
  readonly canceledRun: boolean;
  readonly raise: RunEscalationRaise;
}

export interface RunEscalationAnswerHistory {
  /** Every Escalation of this Run a person answered, counted exactly. */
  readonly total: number;
  /** The first `ESCALATION_ANSWER_LIMIT` of them, in the order they were raised. */
  readonly entries: readonly RunEscalationAnswerEntry[];
}

/** Why a pause request never took effect. */
export type RunPauseRequestOutcome =
  /** The Run reached a terminal state before any boundary honoured it. */
  | 'run-ended'
  /** A "pause after this inspection" request retired by a request to pause at once. */
  | 'replaced'
  /** A reason this build does not name. Never shown as one it does. */
  | 'unknown';

/** The inspection a "pause after this inspection" request was to follow. */
export interface RunPauseRequestInspection {
  readonly planStepId: string;
  readonly workItem: RunPauseWorkItem;
}

export interface RunPauseRequestEntry {
  /** The chain event that recorded the request as superseded. */
  readonly eventId: string;
  readonly mode: 'immediate' | 'after-inspection';
  /** Who asked, as a user id; `null` when the record does not hold one. */
  readonly requestedBy: string | null;
  /** When they asked; `null` when the record does not hold it. */
  readonly requestedAt: string | null;
  /** When the platform recorded that the request would never take effect. */
  readonly supersededAt: string;
  readonly outcome: RunPauseRequestOutcome;
  /**
   * For a request to pause after an inspection, the inspection it named, read by the Work
   * Item id its marker row holds; `null` when that does not resolve in this Run. Always
   * `null` for an immediate request, which names no inspection.
   */
  readonly inspection: RunPauseRequestInspection | null;
}

export interface RunPauseRequestHistory {
  /** Every pause request of this Run that never took effect, counted exactly. */
  readonly total: number;
  /** The first `PAUSE_REQUEST_LIMIT` of them, in the order the chain recorded them. */
  readonly entries: readonly RunPauseRequestEntry[];
}

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

/** An instant the chain stored as text, rendered canonically; `null` when it is not one. */
function instant(value: unknown): string | null {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T/u.test(value)) return null;
  const at = Date.parse(value);
  return Number.isFinite(at) ? new Date(at).toISOString() : null;
}

interface Option { readonly id: string; readonly label: string }

function options(value: unknown): readonly Option[] | null {
  if (!Array.isArray(value)) return null;
  const parsed: Option[] = [];
  for (const entry of value) {
    const id: unknown = record(entry)['id'];
    const label: unknown = record(entry)['label'];
    if (typeof id !== 'string' || typeof label !== 'string') return null;
    parsed.push({ id, label });
  }
  return parsed;
}

interface AnsweredWait {
  readonly waitId: string;
  readonly kind: string;
  readonly options: unknown;
  readonly closedAt: Date | null;
  readonly answerOptionId: string | null;
  readonly actor: string | null;
}

/** The answer a wait row holds. The id must be one the row offered; nothing is inferred. */
function answerOf(wait: AnsweredWait): RunEscalationAnswer {
  const offered = options(wait.options);
  const chosen = wait.answerOptionId;
  if (offered === null || chosen === null || !offered.some((option) => option.id === chosen)) return { kind: 'unreadable' };
  if (PLATFORM_OPTION_IDS.has(chosen)) return { kind: 'option', optionId: chosen };
  // Only a choose-candidate question offers candidates; any other kind answered with an
  // id that is not the platform's is a row this build cannot read.
  if (wait.kind !== 'choose-candidate') return { kind: 'unreadable' };
  const candidates = offered.filter((option) => !PLATFORM_OPTION_IDS.has(option.id));
  const position = candidates.findIndex((option) => option.id === chosen);
  return { kind: 'candidate', candidate: position + 1, candidates: candidates.length, label: candidates[position]!.label };
}

interface WaitEvent {
  readonly actorType: string;
  readonly actorId: string;
  readonly source: string;
  readonly outcome: string;
  readonly payload: Record<string, unknown>;
}

/** The events of one type for these waits, by wait id. Other than one event maps to none. */
async function eventsByWait(db: ReadHandle, runId: string, eventType: string, waitIds: readonly string[]): Promise<Map<string, WaitEvent>> {
  if (waitIds.length === 0) return new Map();
  const rows = await db
    .select({
      actorType: auditEvents.actorType,
      actorId: auditEvents.actorId,
      source: auditEvents.source,
      outcome: auditEvents.outcome,
      payload: auditEvents.payload,
    })
    .from(auditEvents)
    .where(and(
      eq(auditEvents.aggregateId, runId),
      eq(auditEvents.eventType, eventType),
      inArray(sql<string>`${auditEvents.payload}->>'waitId'`, [...waitIds]),
    ));
  const byWait = new Map<string, WaitEvent[]>();
  for (const row of rows) {
    const payload = record(row.payload);
    const waitId = text(payload['waitId']);
    if (waitId === null) continue;
    byWait.set(waitId, [...(byWait.get(waitId) ?? []), { ...row, payload }]);
  }
  // A wait is raised once and answered once, each in one transaction. More than one event
  // is a record that does not establish the fact exactly, so it establishes none.
  return new Map([...byWait].flatMap(([waitId, events]) => events.length === 1 ? [[waitId, events[0]!] as const] : []));
}

/**
 * The Work Item each captured Evidence id belongs to, in this Run.
 *
 * The capture binding names the Tool Action; the action names its Step Execution; the
 * owner is the Step Execution's Work Item first and the action's second — the rule Replay
 * and the selected-inspection read already use, because `run_tool_action.work_item_id` is
 * nullable and a Step Execution may be the only row that names it. Every join is bound to
 * the Run, so an id another Run captured resolves to nothing here.
 */
async function captureOwners(db: ReadHandle, runId: string, evidenceIds: readonly string[]): Promise<Map<string, string | null>> {
  const wanted = [...new Set(evidenceIds.filter(isUuidText))];
  if (wanted.length === 0) return new Map();
  const rows = await db
    .select({
      evidenceId: runEvidenceCapture.evidenceId,
      stepOwner: runStepExecution.workItemId,
      actionOwner: runToolAction.workItemId,
    })
    .from(runEvidenceCapture)
    .innerJoin(runToolAction, and(
      eq(runToolAction.toolActionId, runEvidenceCapture.toolActionId),
      eq(runToolAction.runId, runEvidenceCapture.runId),
    ))
    .innerJoin(runStepExecution, and(
      eq(runStepExecution.stepExecutionId, runToolAction.stepExecutionId),
      eq(runStepExecution.runId, runToolAction.runId),
    ))
    .where(and(eq(runEvidenceCapture.runId, runId), inArray(runEvidenceCapture.evidenceId, wanted)));
  return new Map(rows.map((row) => [row.evidenceId, row.stepOwner ?? row.actionOwner] as const));
}

interface WorkItemRow { readonly workItemId: string; readonly stepId: string; readonly subjectKey: string | null }

/** Work Items of this Run by id. */
async function workItems(db: ReadHandle, runId: string, ids: Iterable<string>): Promise<Map<string, WorkItemRow>> {
  const wanted = [...new Set(ids)].filter(isUuidText);
  if (wanted.length === 0) return new Map();
  const rows = await db
    .select({ workItemId: runWorkItem.workItemId, stepId: runWorkItem.stepId, subjectKey: runWorkItem.subjectKey })
    .from(runWorkItem)
    .where(and(eq(runWorkItem.runId, runId), inArray(runWorkItem.workItemId, wanted)));
  return new Map(rows.map((row) => [row.workItemId, row] as const));
}

/**
 * Every Escalation of a Run a person answered, in the order they were raised: the exact
 * total and a bounded list.
 *
 * Four statements, none of which reads a timestamp to pair anything: the answered waits,
 * the raise and answer events that name them, the capture chain behind the Evidence the
 * raises named, and the Work Items that chain reaches.
 */
export async function readEscalationAnswers(
  db: ReadHandle,
  runId: string,
  limit = ESCALATION_ANSWER_LIMIT,
): Promise<RunEscalationAnswerHistory> {
  if (!isUuidText(runId)) return { total: 0, entries: [] };
  const bound = Math.max(0, Math.min(Math.trunc(limit), ESCALATION_ANSWER_LIMIT));
  // An Escalation is any wait that is not a pause; `closure_kind = 'answer'` is closed by
  // a person, and generation 45 refuses that closure on a pause.
  const where = and(eq(runWait.runId, runId), ne(runWait.kind, 'pause'), eq(runWait.closureKind, 'answer'));
  const [counted] = await db.select({ total: count() }).from(runWait).where(where);
  const total = Number(counted?.total ?? 0);
  if (total === 0 || bound === 0) return { total, entries: [] };
  const waits = await db
    .select({
      waitId: runWait.waitId,
      kind: runWait.kind,
      options: runWait.options,
      closedAt: runWait.closedAt,
      answerOptionId: runWait.answerOptionId,
      actor: runWait.actor,
    })
    .from(runWait)
    .where(where)
    .orderBy(asc(runWait.openedAt), asc(runWait.waitId))
    .limit(bound);
  const waitIds = waits.map((wait) => wait.waitId);

  // One after the other: a caller may pass a transaction, and one connection runs one
  // statement at a time anyway.
  const raised = await eventsByWait(db, runId, RAISED_EVENT, waitIds);
  const answered = await eventsByWait(db, runId, ANSWERED_EVENT, waitIds);

  // The raise the platform wrote, and nothing dressed as one: the writer is fixed.
  const raise = new Map<string, { readonly planStepId: string | null; readonly evidenceIds: readonly string[] | null }>();
  for (const [waitId, event] of raised) {
    if (event.actorType !== 'system' || event.actorId !== 'escalation-platform' || event.source !== 'platform' || event.outcome !== 'success') continue;
    const ids = event.payload['supportingEvidenceIds'];
    raise.set(waitId, {
      planStepId: text(event.payload['stepId']),
      evidenceIds: Array.isArray(ids) && ids.length > 0 && ids.every((id) => typeof id === 'string') ? ids as string[] : null,
    });
  }

  const owners = await captureOwners(db, runId, [...raise.values()].flatMap((entry) => entry.evidenceIds ?? []));
  const items = await workItems(db, runId, [...owners.values()].flatMap((owner) => owner === null ? [] : [owner]));

  const raiseOf = (waitId: string): RunEscalationRaise => {
    const entry = raise.get(waitId);
    if (entry === undefined || entry.planStepId === null) return { kind: 'not-recorded' };
    let workItem: RunPauseWorkItem | null = null;
    if (entry.evidenceIds !== null) {
      // EVERY Evidence id the raise named must resolve, and all to one Work Item: an id
      // that resolves to nothing, or to a second Work Item, is a record that does not
      // establish which one the question was about.
      const resolved = entry.evidenceIds.map((id) => owners.get(id));
      const distinct = new Set(resolved);
      const only = distinct.size === 1 ? [...distinct][0] : undefined;
      const item = typeof only === 'string' ? items.get(only) : undefined;
      if (item !== undefined && item.stepId === entry.planStepId) workItem = { workItemId: item.workItemId, subjectKey: item.subjectKey };
    }
    return { kind: 'recorded', planStepId: entry.planStepId, workItem };
  };

  const entries = waits.flatMap((wait): RunEscalationAnswerEntry[] => {
    // Generation 45's closure CHECK makes both non-null for an answer; a row without them
    // is not an answered Escalation this read can state.
    if (wait.closedAt === null || wait.actor === null) return [];
    const event = answered.get(wait.waitId);
    const canceledRun = event !== undefined &&
      event.actorType === 'human' && event.actorId === wait.actor &&
      wait.answerOptionId === ESCALATION_OPTION_IDS.abort &&
      event.payload['answerOptionId'] === ESCALATION_OPTION_IDS.abort &&
      event.payload['state'] === 'CANCELED';
    return [{
      waitId: wait.waitId,
      kind: wait.kind,
      answeredBy: wait.actor,
      answeredAt: wait.closedAt.toISOString(),
      answer: answerOf(wait),
      canceledRun,
      raise: raiseOf(wait.waitId),
    }];
  });
  return { total, entries };
}

/**
 * The two superseded-request events, each with the writer it has: the result sealer for a
 * request the terminal transition found outstanding, the deferred-pause coordinator for a
 * "pause after this inspection" request (from the web command that replaced it, or from
 * the worker that finalized or cancelled the Run). The receipt projections accept exactly
 * these; so does this read.
 */
function pauseRequestEvents(runId: string) {
  return and(
    eq(auditEvents.aggregateId, runId),
    or(
      and(
        eq(auditEvents.eventType, PAUSE_SUPERSEDED_EVENT),
        eq(auditEvents.source, 'worker'),
        eq(auditEvents.outcome, 'failure'),
        eq(auditEvents.actorType, 'system'),
        eq(auditEvents.actorId, 'result-sealer'),
      ),
      and(
        eq(auditEvents.eventType, DEFERRED_PAUSE_SUPERSEDED_EVENT),
        inArray(auditEvents.source, ['web', 'worker']),
        eq(auditEvents.outcome, 'failure'),
        eq(auditEvents.actorType, 'system'),
        eq(auditEvents.actorId, 'deferred-pause-coordinator'),
      ),
    ),
  );
}

/**
 * Every pause request of a Run that never took effect, in the order the chain recorded
 * them: the exact total and a bounded list.
 *
 * A request to pause at once is recorded only when a terminal transition finds it still
 * outstanding, so its record says the Run ended first. A request to pause after an
 * inspection is recorded with the reason the coordinator stored, and its request time and
 * the inspection it named are read from its own marker row, by the command id the event
 * names.
 */
export async function readPauseRequests(
  db: ReadHandle,
  runId: string,
  limit = PAUSE_REQUEST_LIMIT,
): Promise<RunPauseRequestHistory> {
  if (!isUuidText(runId)) return { total: 0, entries: [] };
  const bound = Math.max(0, Math.min(Math.trunc(limit), PAUSE_REQUEST_LIMIT));
  const where = pauseRequestEvents(runId);
  const [counted] = await db.select({ total: count() }).from(auditEvents).where(where);
  const total = Number(counted?.total ?? 0);
  if (total === 0 || bound === 0) return { total, entries: [] };
  const events = await db
    .select({
      eventId: auditEvents.eventId,
      eventType: auditEvents.eventType,
      occurredAt: auditEvents.occurredAt,
      payload: auditEvents.payload,
    })
    .from(auditEvents)
    .where(where)
    .orderBy(asc(auditEvents.sequence))
    .limit(bound);

  const commandIds = events
    .filter((event) => event.eventType === DEFERRED_PAUSE_SUPERSEDED_EVENT)
    .flatMap((event) => {
      const id = text(record(event.payload)['commandId']);
      return id !== null && isUuidText(id) ? [id] : [];
    });
  const markers = commandIds.length === 0 ? [] : await db
    .select({
      commandId: runDeferredPause.commandId,
      requestedAt: runDeferredPause.requestedAt,
      workItemId: runDeferredPause.workItemId,
    })
    .from(runDeferredPause)
    .where(and(eq(runDeferredPause.runId, runId), inArray(runDeferredPause.commandId, [...new Set(commandIds)])));
  const markerById = new Map(markers.map((marker) => [marker.commandId, marker] as const));
  const items = await workItems(db, runId, markers.map((marker) => marker.workItemId));

  const entries = events.map((event): RunPauseRequestEntry => {
    const payload = record(event.payload);
    const requestedBy = text(payload['requestedBy']);
    const supersededAt = event.occurredAt.toISOString();
    if (event.eventType === PAUSE_SUPERSEDED_EVENT) {
      return {
        eventId: event.eventId,
        mode: 'immediate',
        requestedBy,
        requestedAt: instant(payload['requestedAt']),
        supersededAt,
        outcome: 'run-ended',
        inspection: null,
      };
    }
    const commandId = text(payload['commandId']);
    const marker = commandId === null ? undefined : markerById.get(commandId);
    const item = marker === undefined ? undefined : items.get(marker.workItemId);
    const reason = payload['reason'];
    return {
      eventId: event.eventId,
      mode: 'after-inspection',
      requestedBy,
      requestedAt: marker === undefined ? null : marker.requestedAt.toISOString(),
      supersededAt,
      // A cancellation and a finalized Run both mean the Run ended before the pause took
      // effect; a request to pause at once replaced it without the Run ending.
      outcome: reason === 'cancellation' || reason === 'run-finalized'
        ? 'run-ended'
        : reason === 'immediate-pause' ? 'replaced' : 'unknown',
      inspection: item === undefined ? null : { planStepId: item.stepId, workItem: { workItemId: item.workItemId, subjectKey: item.subjectKey } },
    };
  });
  return { total, entries };
}
