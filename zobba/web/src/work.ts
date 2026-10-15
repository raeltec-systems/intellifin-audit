// Story 22.2 Task work projection, untargeted direction and targeting questions.
// Every response is strictly parsed; none carries model text.
import { readJson, readSessionJson } from './auth.ts';
import type { Session } from './auth.ts';
import { parseScope } from './engagements.ts';
import type { Scope } from './engagements.ts';
import { commandContent, cursor, identifier } from './conversation.ts';
import type { Receipt } from './conversation.ts';
import type { components } from './generated/api.ts';
import { parseAssessment } from './assessment.ts';

export type TaskWork = components['schemas']['TaskWorkResponse'];
export type TaskStep = components['schemas']['TaskStepResponse'];
export type BriefRevision = components['schemas']['BriefRevisionResponse'];
export type Compaction = components['schemas']['CompactionResponse'];
export type RoutingQuestion = components['schemas']['RoutingQuestionResponse'];
export type Investigation = components['schemas']['InvestigationResponse'];
export type SkillUse = components['schemas']['SkillUseResponse'];
export type MethodNote = components['schemas']['MethodNoteResponse'];
export type InvestigationRecord = components['schemas']['InvestigationRecordResponse'];
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
    reason: nullable(v.reason, value => oneOf(value, ['context_budget'] as const)),
    estimated_input_tokens: nullable(v.estimated_input_tokens, cursor),
    actual_input_tokens: nullable(v.actual_input_tokens, cursor),
  };
}

const omissionCategories = ['steps_compacted', 'digests_omitted', 'knowledge_budget', 'knowledge_unusable', 'stale_sources', 'stale_content', 'skills_budget'] as const;

/** A compaction record lists platform facts only; it carries no model or source text. */
export function parseCompaction(value: unknown): Compaction {
  const v = record(value);
  const first = count(v.first_ordinal, 4095);
  const last = count(v.last_ordinal, 4095);
  if (first > last || typeof v.digest_sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(v.digest_sha256)) invalid();
  return {
    sequence: count(v.sequence, 255),
    first_ordinal: first,
    last_ordinal: last,
    digest_sha256: v.digest_sha256,
    sources: array(v.sources, 512).map(source => {
      const s = record(source);
      return { id: identifier(s.id), revision: cursor(s.revision), status: oneOf(s.status, ['current', 'withdrawn', 'corrected', 'invalidated'] as const) };
    }),
    omissions: array(v.omissions, omissionCategories.length).map(omission => {
      const o = record(omission);
      return { category: oneOf(o.category, omissionCategories), count: count(o.count, 4294967295) };
    }),
    estimated_tokens: cursor(v.estimated_tokens),
    created_at: cursor(v.created_at),
  };
}

const digest = (value: unknown): string => {
  if (typeof value !== 'string' || !/^[0-9a-f]{64}$/.test(value)) invalid();
  return value;
};
const useReasons = ['not_listed', 'tool_unavailable', 'forbidden', 'disabled', 'recalled', 'inapplicable', 'methodology_blocked', 'task_blocked', 'not_loaded', 'resource_missing', 'not_a_script', 'input_not_registered', 'invalid_program', 'program_failed', 'program_limit'] as const;
const gapReasons = ['evidence_unavailable', 'action_not_permitted', 'tool_unavailable', 'criteria_missing', 'skill_unavailable'] as const;
function noteText(value: unknown): string {
  if (typeof value !== 'string' || /^[\u0009-\u000d\u0020\u0085\u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000]*$/.test(value) || new TextEncoder().encode(value).length > 1000 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/.test(value)) invalid();
  return value;
}
function shortText(value: unknown): string {
  // The server bounds these at 200 Unicode scalars (code points), not UTF-16 units.
  if (typeof value !== 'string' || value.length === 0 || [...value].length > 200 || /[\u0000-\u001f\u007f-\u009f]/.test(value)) invalid();
  return value;
}

/** One recorded skill use: identities, digest and closed reason; never content. */
export function parseSkillUse(value: unknown): SkillUse {
  const v = record(value);
  const kind = oneOf(v.kind, ['load', 'resource', 'script'] as const);
  const outcome = oneOf(v.outcome, ['loaded', 'fetched', 'completed', 'failed', 'unavailable'] as const);
  const reason = nullable(v.reason, value => oneOf(value, useReasons));
  const use: SkillUse = {
    invocation_id: identifier(v.invocation_id),
    kind,
    ordinal: count(v.ordinal, 7),
    version_id: identifier(v.version_id),
    resource_id: nullable(v.resource_id, identifier),
    skill_id: nullable(v.skill_id, identifier),
    skill_version: nullable(v.skill_version, identifier),
    name: nullable(v.name, shortText),
    digest: nullable(v.digest, digest),
    outcome,
    reason,
    job_id: nullable(v.job_id, identifier),
    methodology_binding_id: identifier(v.methodology_binding_id),
    execution_epoch: cursor(v.execution_epoch),
  };
  if ((kind === 'load') !== (use.resource_id === null)
    || (['failed', 'unavailable'].includes(outcome)) !== (reason !== null)
    || (outcome !== 'unavailable' && (use.digest === null || use.name === null || use.skill_version === null))) invalid();
  return use;
}

/** A gap, question or Zobba statement; there is no "complete" kind. */
export function parseMethodNote(value: unknown): MethodNote {
  const v = record(value);
  const kind = oneOf(v.kind, ['gap', 'question', 'statement'] as const);
  const note: MethodNote = {
    invocation_id: identifier(v.invocation_id),
    ordinal: count(v.ordinal, 63),
    source: oneOf(v.source, ['agent', 'platform'] as const),
    requirement_id: nullable(v.requirement_id, identifier),
    kind,
    text: noteText(v.text),
    reason: nullable(v.reason, value => oneOf(value, gapReasons)),
    segments: array(v.segments, 8).map(segment => count(segment, 63)),
    methodology_binding_id: identifier(v.methodology_binding_id),
    execution_epoch: cursor(v.execution_epoch),
    open: v.open === true ? true : v.open === false ? false : invalid(),
  };
  if ((kind === 'gap') !== (note.reason !== null) || (kind !== 'statement' && note.segments.length > 0) || (note.open && kind !== 'question')) invalid();
  return note;
}

function parseRecord(value: unknown): InvestigationRecord {
  const v = record(value);
  return {
    invocation_id: identifier(v.invocation_id),
    methodology_binding_id: identifier(v.methodology_binding_id),
    execution_epoch: cursor(v.execution_epoch),
    method_status: shortText(v.method_status),
    method_version_ids: array(v.method_version_ids, 64).map(identifier),
    skills: array(v.skills, 64).map(skill => {
      const s = record(skill);
      return { version_id: identifier(s.version_id), skill_id: identifier(s.skill_id), skill_version: identifier(s.skill_version), digest: digest(s.digest) };
    }),
    provider: shortText(v.provider),
    model: shortText(v.model),
    profile_id: identifier(v.profile_id),
    profile_revision: cursor(v.profile_revision),
    catalogue_id: identifier(v.catalogue_id),
    catalogue_revision: cursor(v.catalogue_revision),
    tools: array(v.tools, 64).map(shortText),
    gaps: count(v.gaps, 64),
    questions: count(v.questions, 64),
    statements: count(v.statements, 64),
    omitted_notes: count(v.omitted_notes, 2 ** 31),
    omitted_items: count(v.omitted_items, 2 ** 31),
    discarded_requests: count(v.discarded_requests, 2 ** 31),
  };
}

/** The method basis, skills used, gaps, questions and Zobba statements. */
export function parseInvestigation(value: unknown): Investigation {
  const v = record(value);
  const investigation: Investigation = {
    methodology_binding_id: identifier(v.methodology_binding_id),
    method_status: oneOf(v.method_status, ['resolved', 'neutral', 'incomplete', 'ambiguous', 'recalled'] as const),
    method_version_ids: array(v.method_version_ids, 64).map(identifier),
    skills: array(v.skills, 512).map(parseSkillUse),
    total_skills: cursor(v.total_skills),
    notes: array(v.notes, 1024).map(parseMethodNote),
    total_notes: cursor(v.total_notes),
    record: nullable(v.record, parseRecord),
    open_questions: count(v.open_questions, 2 ** 31),
  };
  // Totals cover the whole cycle; the lists are its newest entries.
  if (BigInt(investigation.total_skills) < BigInt(investigation.skills.length)
    || BigInt(investigation.total_notes) < BigInt(investigation.notes.length)) invalid();
  return investigation;
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
    attention: nullable(v.attention, value => oneOf(value, ['awaiting_guidance', 'reconciliation_required', 'step_failed', 'cycle_bounded', 'method_question'] as const)),
    steps: array(v.steps, 50).map(parseStep),
    briefs: array(v.briefs, 50).map(parseBrief),
    total_steps: count(v.total_steps, 4096),
    compactions: array(v.compactions, 20).map(parseCompaction),
    total_compactions: count(v.total_compactions, 256),
    investigation: nullable(v.investigation, parseInvestigation),
    investigation_unavailable: v.investigation_unavailable === true ? true : v.investigation_unavailable === false ? false : invalid(),
    assessment: nullable(v.assessment, parseAssessment),
    assessment_unavailable: v.assessment_unavailable === true ? true : v.assessment_unavailable === false ? false : invalid(),
  };
  if (work.investigation_unavailable && work.investigation !== null) invalid();
  if (work.assessment_unavailable && work.assessment !== null) invalid();
  if (work.task_id !== taskId || work.total_steps < work.steps.length || work.total_compactions < work.compactions.length) invalid();
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

export function gapReasonLabel(reason: string): string {
  return ({
    evidence_unavailable: 'evidence unavailable',
    action_not_permitted: 'action not permitted',
    tool_unavailable: 'tool unavailable',
    criteria_missing: 'criteria missing',
    skill_unavailable: 'skill unavailable',
  } as Record<string, string>)[reason] ?? reason;
}
export function useReasonLabel(reason: string): string {
  return reason.replaceAll('_', ' ');
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
    method_question: 'Zobba asked a question about the method — answer it with new guidance',
  }[value];
}

export function omissionLabel(category: string): string {
  return ({
    steps_compacted: 'Steps represented only by a fact digest',
    digests_omitted: 'Digests left out by the budget',
    knowledge_budget: 'Knowledge records left out by the budget',
    knowledge_unusable: 'Knowledge records not usable or beyond the limit',
    stale_sources: 'Stale knowledge revisions',
    stale_content: 'Earlier content replaced by a stale marker',
    skills_budget: 'Method parts or skill content left out by the budget',
  } as Record<string, string>)[category] ?? category;
}
