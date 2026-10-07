// Story 22.2 Task work projection, untargeted direction and targeting questions.
// Every response is strictly parsed; none carries model text.
import { readJson, readSessionJson } from './auth.ts';
import type { Session } from './auth.ts';
import { parseScope } from './engagements.ts';
import type { Scope } from './engagements.ts';
import { commandContent, cursor, identifier } from './conversation.ts';
import type { Receipt } from './conversation.ts';
import type { components } from './generated/api.ts';

export type TaskWork = components['schemas']['TaskWorkResponse'];
export type TaskStep = components['schemas']['TaskStepResponse'];
export type BriefRevision = components['schemas']['BriefRevisionResponse'];
export type RoutingQuestion = components['schemas']['RoutingQuestionResponse'];
export type RoutedGuide = components['schemas']['RoutedGuideResponse'];
export type Direction =
  | { outcome: 'routed'; receipt: Receipt; question: null }
  | { outcome: 'asked'; receipt: null; question: RoutingQuestion };

function invalid(): never { throw new Error('Invalid work response'); }
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid();
  return value as Record<string, unknown>;
}
function nullable<T>(value: unknown, parse: (value: unknown) => T): T | null {
  return value === null ? null : parse(value);
}
function label(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > 200 || /[\u0000-\u001f\u007f-\u009f]/.test(value)) invalid();
  return value;
}
const nextAction = /^(model_turn|await_guidance|reconcile|tool:[A-Za-z0-9_.:-]{1,128})$/;
function action(value: unknown): string {
  if (typeof value !== 'string' || !nextAction.test(value)) invalid();
  return value;
}
function oneOf<T extends string>(value: unknown, allowed: readonly T[]): T {
  if (typeof value !== 'string' || !allowed.includes(value as T)) invalid();
  return value as T;
}
function array(value: unknown, max: number): unknown[] {
  if (!Array.isArray(value) || value.length > max) invalid();
  return value;
}

function count(value: unknown, max: number): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0 || value > max) invalid();
  return value;
}

export function parseStep(value: unknown): TaskStep {
  const v = record(value);
  if (typeof v.ordinal !== 'number' || !Number.isInteger(v.ordinal) || v.ordinal < 0 || v.ordinal > 4095) invalid();
  const kind = oneOf(v.kind, ['model_turn', 'tool_step'] as const);
  const knowledgeOmitted = count(v.knowledge_omitted, 4096);
  if (kind === 'tool_step' && knowledgeOmitted !== 0) invalid();
  return {
    ordinal: v.ordinal,
    kind,
    status: oneOf(v.status, ['proposed', 'responded', 'superseded', 'failed', 'completed', 'refused', 'reconciliation_required'] as const),
    intent_revision: cursor(v.intent_revision),
    execution_epoch: cursor(v.execution_epoch),
    invocation_id: nullable(v.invocation_id, identifier),
    operation_id: nullable(v.operation_id, identifier),
    next_action: nullable(v.next_action, action),
    current_work: label(v.current_work),
    knowledge_omitted: knowledgeOmitted,
  };
}

export function parseBrief(value: unknown): BriefRevision {
  const v = record(value);
  if (v.applied_boundary !== null && (typeof v.applied_boundary !== 'number' || !Number.isInteger(v.applied_boundary) || v.applied_boundary < 0)) invalid();
  return {
    command_id: identifier(v.command_id),
    cycle_id: identifier(v.cycle_id),
    content: commandContent(v.content),
    received_cursor: cursor(v.received_cursor),
    applied_boundary: v.applied_boundary as number | null,
    applied_cursor: nullable(v.applied_cursor, cursor),
    superseded_by: nullable(v.superseded_by, identifier),
  };
}

export function parseWork(value: unknown, taskId: string): TaskWork {
  const v = record(value);
  if (typeof v.model_available !== 'boolean') invalid();
  const work: TaskWork = {
    task_id: identifier(v.task_id),
    cycle_id: identifier(v.cycle_id),
    model_available: v.model_available,
    methodology_binding_id: nullable(v.methodology_binding_id, identifier),
    methodology_status: nullable(v.methodology_status, label),
    current_work: nullable(v.current_work, label),
    next_action: nullable(v.next_action, action),
    next_action_invocation_id: nullable(v.next_action_invocation_id, identifier),
    attention: nullable(v.attention, value => oneOf(value, ['awaiting_guidance', 'reconciliation_required', 'step_failed', 'cycle_bounded'] as const)),
    steps: array(v.steps, 50).map(parseStep),
    briefs: array(v.briefs, 50).map(parseBrief),
    total_steps: count(v.total_steps, 4096),
  };
  if (work.task_id !== taskId || work.total_steps < work.steps.length) invalid();
  return work;
}

function guide(value: unknown): RoutedGuide {
  const v = record(value);
  return { task_id: identifier(v.task_id), cycle_id: identifier(v.cycle_id), command_id: identifier(v.command_id), event_cursor: cursor(v.event_cursor) };
}

export function parseQuestion(value: unknown): RoutingQuestion {
  const v = record(value);
  const candidates = array(v.candidates, 100).map(candidate => {
    const c = record(candidate);
    return { task_id: identifier(c.task_id), cycle_id: identifier(c.cycle_id), objective: commandContent(c.objective) };
  });
  if (candidates.length < 2) invalid();
  return {
    id: identifier(v.id), key: identifier(v.key), content: commandContent(v.content), candidates,
    answer: v.answer === null ? null : array(v.answer, 100).map(guide),
  };
}

function receipt(value: unknown): Receipt {
  const v = record(value);
  if (v.status !== 'received') invalid();
  return { command_id: identifier(v.command_id), task_id: identifier(v.task_id), cycle_id: identifier(v.cycle_id), event_cursor: cursor(v.event_cursor), status: 'received' };
}

export function parseDirection(value: unknown): Direction {
  const v = record(value);
  if (v.outcome === 'routed' && v.question === null) return { outcome: 'routed', receipt: receipt(v.receipt), question: null };
  if (v.outcome === 'asked' && v.receipt === null) return { outcome: 'asked', receipt: null, question: parseQuestion(v.question) };
  invalid();
}

function route(scope: Scope, suffix: string): string {
  parseScope(scope);
  return `/engagements/${encodeURIComponent(scope.engagement_id)}/${suffix}?${new URLSearchParams({ organisation_id: scope.organisation_id, client_id: scope.client_id })}`;
}
function post(session: Session, body: unknown): RequestInit {
  return { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': session.csrf_token, 'X-Expected-Actor': session.identity.id }, body: JSON.stringify(body) };
}

export async function readTaskWork(scope: Scope, taskId: string, session: Session | null, signal: AbortSignal): Promise<TaskWork> {
  return parseWork(await readSessionJson(route(scope, `tasks/${identifier(taskId)}/work`), session, signal), taskId);
}
export async function postDirection(scope: Scope, session: Session, key: string, content: string, signal: AbortSignal): Promise<Direction> {
  return parseDirection(await readJson(route(scope, 'task-directions'), signal, post(session, { key: identifier(key), content: commandContent(content) })));
}
export type QuestionPage = { questions: RoutingQuestion[]; has_more: boolean };
export function parseQuestionPage(value: unknown): QuestionPage {
  const v = record(value);
  if (typeof v.has_more !== 'boolean') invalid();
  return { questions: array(v.questions, 20).map(parseQuestion), has_more: v.has_more };
}
export async function readQuestions(scope: Scope, session: Session | null, signal: AbortSignal): Promise<QuestionPage> {
  return parseQuestionPage(await readSessionJson(route(scope, 'task-questions'), session, signal));
}
/** The answer must name exactly the chosen Tasks: one routed Guide per selection. */
export function verifyAnswer(answered: RoutingQuestion, questionId: string, selected: string[]): RoutingQuestion {
  const chosen = [...new Set(selected)].sort();
  const routed = (answered.answer ?? []).map(guide => guide.task_id).sort();
  if (answered.id !== questionId || !answered.answer || routed.length !== chosen.length || routed.some((id, i) => id !== chosen[i])) invalid();
  return answered;
}
export async function answerQuestion(scope: Scope, session: Session, questionId: string, selected: string[], signal: AbortSignal): Promise<RoutingQuestion> {
  const answered = parseQuestion(await readJson(route(scope, `task-questions/${identifier(questionId)}/answer`), signal, post(session, { selected: selected.map(identifier) })));
  return verifyAnswer(answered, questionId, selected);
}

export function nextActionLabel(value: string | null): string {
  if (value === null) return 'None recorded';
  if (value === 'model_turn') return 'Another model turn under the applied brief';
  if (value === 'await_guidance') return 'Waiting for your guidance';
  if (value === 'reconcile') return 'Reconcile a possibly dispatched effect';
  return `Admit catalogue tool ${value.slice(5)}`;
}
export function attentionLabel(value: TaskWork['attention']): string | null {
  return value === null ? null : {
    awaiting_guidance: 'Needs your guidance — the objective is not complete',
    reconciliation_required: 'Needs reconciliation — an effect may have happened',
    step_failed: 'A model turn did not complete — guide or retry the Task',
    cycle_bounded: 'This work cycle reached its turn limit',
  }[value];
}
