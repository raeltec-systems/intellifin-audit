import { and, asc, count, desc, eq, inArray, sql } from 'drizzle-orm';

import type { PendingResume } from '@intellifin/application';

import type { Database, Transaction } from '../db/client.js';
import { isUuidText } from '../db/identifier.js';
import { auditEvents, runStepExecution, runWait, runWorkItem } from '../db/schema.js';

/**
 * Where each pause held a Run, and which attempt each resume started (Story 10.6, legacy
 * 5.4).
 *
 * A pause is a `run_wait` row of kind `pause` and a `lifecycle.run-paused` event written in
 * the same transaction; its resume closes that row. Since this story the pause event says
 * where the Run was held (`planStepId`, and `heldWorkItemId` in the Work Item stage) and,
 * when an attempt was in flight, which one it superseded (`stepExecutionId`, `attempt`).
 * The attempt a resume restarts names the resume on its own start event (`resumedWaitId`),
 * written by the worker that starts it. Every join below follows one of those identities:
 * the wait id from the row to the event, the Step Execution id from the event to its row.
 * Nothing is paired by time, and no historical event is rewritten — an event written
 * before these keys existed is read for what it holds, and the surface says what it lacks.
 */

/** How many pauses the Timeline lists; the total beside the list is exact. */
export const PAUSE_HISTORY_LIMIT = 100;

const PAUSED_EVENT = 'lifecycle.run-paused';

type ReadHandle = Database | Transaction;

/** One Work Item a pause names, with the record it inspects (`null` for a P-4 page). */
export interface RunPauseWorkItem {
  readonly workItemId: string;
  readonly subjectKey: string | null;
}

/** One Step Execution attempt a pause superseded or a resume started. */
export interface RunPauseAttempt {
  readonly stepExecutionId: string;
  readonly planStepId: string;
  readonly attempt: number;
  readonly workItem: RunPauseWorkItem | null;
}

/**
 * Where a pause held the Run.
 *
 * `recorded` is read from the pause's own event, or — for a pause an older build honoured
 * mid-attempt — from the Step Execution that event named, which holds the plan step and
 * the attempt exactly. `not-recorded` is every other older pause: its event names no step,
 * and the surface says so rather than guessing one from the time.
 */
export type RunPauseHold =
  | {
      readonly kind: 'recorded';
      readonly planStepId: string;
      /** The Work Item the Run is held at, in the Work Item stage. */
      readonly workItem: RunPauseWorkItem | null;
      /** The attempt the pause superseded; `null` when no Step Execution was in flight. */
      readonly superseded: RunPauseAttempt | null;
      /** A pause after an inspection: the Work Item whose inspection had settled. */
      readonly settled: RunPauseWorkItem | null;
    }
  | { readonly kind: 'not-recorded' };

/** The attempt a resume restarted. */
export type RunResumeRestart =
  | { readonly kind: 'started'; readonly attempt: RunPauseAttempt }
  /** The linkage applies to this pause and no attempt names its resume. */
  | { readonly kind: 'none' }
  /** The pause recorded no held step, so no attempt could have been linked to its resume. */
  | { readonly kind: 'not-recorded' };

/** How a pause ended, from its own wait row. */
export type RunPauseClosure =
  | { readonly kind: 'open' }
  | {
      readonly kind: 'resumed';
      readonly resumedBy: string | null;
      readonly resumedAt: string;
      readonly restart: RunResumeRestart;
    }
  | { readonly kind: 'timed-out'; readonly at: string }
  | { readonly kind: 'withdrawn'; readonly at: string }
  /** A closure this build does not name. Never shown as one it does. */
  | { readonly kind: 'unknown' };

export interface RunPauseEntry {
  readonly waitId: string;
  readonly pausedAt: string;
  readonly pausedBy: string | null;
  readonly deadline: string;
  readonly mode: 'immediate' | 'after-inspection';
  readonly hold: RunPauseHold;
  readonly closure: RunPauseClosure;
}

export interface RunPauseHistory {
  /** Every pause this Run has had, counted exactly. */
  readonly total: number;
  /** The first `PAUSE_HISTORY_LIMIT` of them, in the order they happened. */
  readonly entries: readonly RunPauseEntry[];
}

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function positive(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : null;
}

/** The pause events for these waits, by wait id. A wait with other than one event maps to none. */
async function pauseEvents(db: ReadHandle, runId: string, waitIds: readonly string[]): Promise<Map<string, Record<string, unknown>>> {
  if (waitIds.length === 0) return new Map();
  const rows = await db
    .select({ payload: auditEvents.payload })
    .from(auditEvents)
    .where(and(
      eq(auditEvents.aggregateId, runId),
      eq(auditEvents.eventType, PAUSED_EVENT),
      inArray(sql<string>`${auditEvents.payload}->>'waitId'`, [...waitIds]),
    ));
  const byWait = new Map<string, Record<string, unknown>[]>();
  for (const row of rows) {
    const payload = record(row.payload);
    const waitId = text(payload['waitId']);
    if (waitId === null) continue;
    byWait.set(waitId, [...(byWait.get(waitId) ?? []), payload]);
  }
  // One pause opens one wait, in one transaction. More than one event for a wait is a
  // record that does not establish the hold exactly, so it establishes none.
  return new Map([...byWait].flatMap(([waitId, payloads]) => payloads.length === 1 ? [[waitId, payloads[0]!] as const] : []));
}

/**
 * The resume this Run's stages have still to link (the `RunPauseContext.readPendingResume`
 * port, shared by every execution repository).
 *
 * The candidate is the Run's LATEST pause: `run_wait_one_open` keeps a Run's waits one at a
 * time, so a later pause is always a later wait, and an earlier resume that started nothing
 * before the Run was paused again has no attempt left to start. It is pending only while
 * it was closed by a resume, its own event recorded where it held the Run, and no event
 * already names it — a stage reads it once per invocation, so the scans below are paid at
 * most once each time a stage takes the Run.
 */
export async function readPendingResume(db: ReadHandle, runId: string): Promise<PendingResume | null> {
  if (!isUuidText(runId)) return null;
  const [latest] = await db
    .select({ waitId: runWait.waitId, closureKind: runWait.closureKind })
    .from(runWait)
    .where(and(eq(runWait.runId, runId), eq(runWait.kind, 'pause')))
    .orderBy(desc(runWait.openedAt), desc(runWait.waitId))
    .limit(1);
  if (latest === undefined || latest.closureKind !== 'resume') return null;
  const payload = (await pauseEvents(db, runId, [latest.waitId])).get(latest.waitId);
  const planStepId = text(payload?.['planStepId']);
  if (payload === undefined || planStepId === null) return null;
  const held = payload['heldWorkItemId'];
  if (held !== undefined && text(held) === null) return null;
  const [linked] = await db
    .select({ sequence: auditEvents.sequence })
    .from(auditEvents)
    .where(and(eq(auditEvents.aggregateId, runId), sql`${auditEvents.payload}->>'resumedWaitId' = ${latest.waitId}`))
    .limit(1);
  if (linked !== undefined) return null;
  return { waitId: latest.waitId, planStepId, workItemId: text(held) };
}

interface WaitRow {
  readonly waitId: string;
  readonly openedAt: Date;
  readonly openedBy: string | null;
  readonly deadline: Date;
  readonly closedAt: Date | null;
  readonly closureKind: string | null;
  readonly actor: string | null;
}

async function entriesFor(db: ReadHandle, runId: string, waits: readonly WaitRow[]): Promise<readonly RunPauseEntry[]> {
  if (waits.length === 0) return [];
  const waitIds = waits.map((wait) => wait.waitId);
  const events = await pauseEvents(db, runId, waitIds);

  // The attempt each resume started, named by the attempt's own start event.
  const linkRows = await db
    .select({
      waitId: sql<string | null>`${auditEvents.payload}->>'resumedWaitId'`,
      stepExecutionId: sql<string | null>`${auditEvents.payload}->>'stepExecutionId'`,
    })
    .from(auditEvents)
    .where(and(
      eq(auditEvents.aggregateId, runId),
      inArray(sql<string>`${auditEvents.payload}->>'resumedWaitId'`, waitIds),
    ));
  const links = new Map<string, string[]>();
  for (const row of linkRows) {
    if (row.waitId === null || row.stepExecutionId === null) continue;
    links.set(row.waitId, [...(links.get(row.waitId) ?? []), row.stepExecutionId]);
  }

  // Every Step Execution and Work Item any of these records names, read by id.
  const stepExecutionIds = new Set<string>();
  for (const payload of events.values()) {
    const id = text(payload['stepExecutionId']);
    if (id !== null) stepExecutionIds.add(id);
  }
  for (const ids of links.values()) for (const id of ids) stepExecutionIds.add(id);
  const steps = new Map<string, { planStepId: string; attempt: number; workItemId: string | null }>();
  const stepIds = [...stepExecutionIds].filter(isUuidText);
  if (stepIds.length > 0) {
    const rows = await db
      .select({
        stepExecutionId: runStepExecution.stepExecutionId,
        planStepId: runStepExecution.planStepId,
        attempt: runStepExecution.attempt,
        workItemId: runStepExecution.workItemId,
      })
      .from(runStepExecution)
      .where(and(eq(runStepExecution.runId, runId), inArray(runStepExecution.stepExecutionId, stepIds)));
    for (const row of rows) steps.set(row.stepExecutionId, row);
  }
  const workItemIds = new Set<string>();
  for (const payload of events.values()) {
    for (const key of ['heldWorkItemId', 'workItemId'] as const) {
      const id = text(payload[key]);
      if (id !== null) workItemIds.add(id);
    }
  }
  for (const step of steps.values()) if (step.workItemId !== null) workItemIds.add(step.workItemId);
  const subjects = new Map<string, string | null>();
  const itemIds = [...workItemIds].filter(isUuidText);
  if (itemIds.length > 0) {
    const rows = await db
      .select({ workItemId: runWorkItem.workItemId, subjectKey: runWorkItem.subjectKey })
      .from(runWorkItem)
      .where(and(eq(runWorkItem.runId, runId), inArray(runWorkItem.workItemId, itemIds)));
    for (const row of rows) subjects.set(row.workItemId, row.subjectKey);
  }
  const workItem = (id: string | null): RunPauseWorkItem | null =>
    id === null || !subjects.has(id) ? null : { workItemId: id, subjectKey: subjects.get(id) ?? null };
  const attemptFor = (stepExecutionId: string): RunPauseAttempt | null => {
    const step = steps.get(stepExecutionId);
    return step === undefined
      ? null
      : { stepExecutionId, planStepId: step.planStepId, attempt: step.attempt, workItem: workItem(step.workItemId) };
  };

  return waits.map((wait): RunPauseEntry => {
    const payload = events.get(wait.waitId);
    const mode = payload?.['pauseMode'] === 'after-inspection' ? 'after-inspection' : 'immediate';
    const planStepId = text(payload?.['planStepId']);
    const supersededId = text(payload?.['stepExecutionId']);
    let hold: RunPauseHold = { kind: 'not-recorded' };
    if (payload !== undefined && planStepId !== null) {
      // This build's pause: the hold is the event's own. The superseded attempt is read by
      // the id the event names, and its number is the event's, which cannot change.
      const attempt = positive(payload['attempt']);
      const row = supersededId === null ? null : attemptFor(supersededId);
      const superseded = supersededId === null || attempt === null
        ? null
        : { stepExecutionId: supersededId, planStepId, attempt, workItem: row?.workItem ?? workItem(text(payload['heldWorkItemId'])) };
      hold = {
        kind: 'recorded',
        planStepId,
        workItem: workItem(text(payload['heldWorkItemId'])),
        superseded,
        settled: mode === 'after-inspection' ? workItem(text(payload['workItemId'])) : null,
      };
    } else if (payload !== undefined && supersededId !== null) {
      // An older pause honoured mid-attempt named only the Step Execution it superseded;
      // that row holds the plan step and the attempt exactly.
      const row = attemptFor(supersededId);
      if (row !== null) hold = { kind: 'recorded', planStepId: row.planStepId, workItem: row.workItem, superseded: row, settled: null };
    }

    let closure: RunPauseClosure;
    if (wait.closedAt === null) closure = { kind: 'open' };
    else if (wait.closureKind === 'resume') {
      const linked = links.get(wait.waitId) ?? [];
      // The linkage is written only for a pause whose event recorded where it held the
      // Run, so an older pause's resume has no link to find — and the surface says so.
      const restart: RunResumeRestart = planStepId === null
        ? { kind: 'not-recorded' }
        : linked.length === 0
          ? { kind: 'none' }
          : linked.length === 1 && attemptFor(linked[0]!) !== null
            ? { kind: 'started', attempt: attemptFor(linked[0]!)! }
            : { kind: 'not-recorded' };
      closure = { kind: 'resumed', resumedBy: wait.actor, resumedAt: wait.closedAt.toISOString(), restart };
    } else if (wait.closureKind === 'timeout') closure = { kind: 'timed-out', at: wait.closedAt.toISOString() };
    else if (wait.closureKind === 'withdrawn') closure = { kind: 'withdrawn', at: wait.closedAt.toISOString() };
    else closure = { kind: 'unknown' };

    return {
      waitId: wait.waitId,
      pausedAt: wait.openedAt.toISOString(),
      pausedBy: wait.openedBy,
      deadline: wait.deadline.toISOString(),
      mode,
      hold,
      closure,
    };
  });
}

const WAIT_COLUMNS = {
  waitId: runWait.waitId,
  openedAt: runWait.openedAt,
  openedBy: runWait.openedBy,
  deadline: runWait.deadline,
  closedAt: runWait.closedAt,
  closureKind: runWait.closureKind,
  actor: runWait.actor,
};

/** Every pause of a Run, in the order they happened: the exact total and a bounded list. */
export async function readPauseHistory(db: ReadHandle, runId: string, limit = PAUSE_HISTORY_LIMIT): Promise<RunPauseHistory> {
  if (!isUuidText(runId)) return { total: 0, entries: [] };
  const bound = Math.max(0, Math.min(Math.trunc(limit), PAUSE_HISTORY_LIMIT));
  const where = and(eq(runWait.runId, runId), eq(runWait.kind, 'pause'));
  const [counted] = await db.select({ total: count() }).from(runWait).where(where);
  const total = Number(counted?.total ?? 0);
  if (total === 0 || bound === 0) return { total, entries: [] };
  const waits = await db.select(WAIT_COLUMNS).from(runWait).where(where).orderBy(asc(runWait.openedAt), asc(runWait.waitId)).limit(bound);
  return { total, entries: await entriesFor(db, runId, waits) };
}

/** One pause of a Run, by its wait — what the Paused banner reads for the open one. */
export async function readPauseEntry(db: ReadHandle, runId: string, waitId: string): Promise<RunPauseEntry | null> {
  if (!isUuidText(runId) || !isUuidText(waitId)) return null;
  const waits = await db.select(WAIT_COLUMNS).from(runWait)
    .where(and(eq(runWait.runId, runId), eq(runWait.kind, 'pause'), eq(runWait.waitId, waitId)));
  const [entry] = await entriesFor(db, runId, waits);
  return entry ?? null;
}
