// Story 24.3b: Task-scoped exceptions and the effective summary. Every
// response is strictly parsed. An exception's status is derived by the server
// on every read and never stored; its occurrences are never changed; a
// person's closure is a separate record and never drops a failing count.
// There are no waivers, no percentages and no confidence score anywhere.
import { AccessError, readJsonBody, readSessionJson } from './auth.ts';
import type { Session } from './auth.ts';
import { parseSource } from './citation.ts';
import { cursor, identifier } from './conversation.ts';
import { parseSummary } from './coverage.ts';
import { parseScope } from './engagements.ts';
import type { Scope } from './engagements.ts';
import { array, boolean, digest, exact, invalid, nullable, oneOf, record, subject, text } from './assessment.ts';
import type { components } from './generated/api.ts';

export type ExceptionView = components['schemas']['ExceptionResponse'];
export type ExceptionDisposition = components['schemas']['ExceptionDispositionResponse'];
export type ExceptionCounts = components['schemas']['ExceptionCountsResponse'];
export type EffectiveSummary = components['schemas']['EffectiveSummaryResponse'];
export type ExceptionsList = components['schemas']['ExceptionsResponse'];
export type ExceptionDetail = components['schemas']['ExceptionDetailResponse'];
export type ExceptionDispositionCommand = components['schemas']['ExceptionDispositionCommandRequest'];

export const statuses = ['open', 'resolved_by_evidence', 'replaced_by_human_judgment', 'closed_by_disposition'] as const;
export const observed = ['not_met', 'not_observed'] as const;
export const sourceKinds = ['evaluation', 'revision', 'opportunity', 'disposition'] as const;
export const limitationCodes = ['population_incomplete', 'unresolved_subjects', 'pending_reconsideration', 'unreviewed_model_proposals', 'superseded_inputs_not_reevaluated', 'sample_only'] as const;
export const NOT_REMEDIATION = 'not observed in the latest revision; this is not evidence of remediation';
export const MAX_RATIONALE_BYTES = 2000;
export const MAX_REFERENCES = 8;

function exceptionId(value: unknown): string {
  if (typeof value !== 'string' || !/^exc-[A-Za-z0-9_-]{1,124}$/.test(value)) invalid();
  return value;
}
function summaryId(value: unknown): string {
  if (typeof value !== 'string' || !/^esummary-[A-Za-z0-9_-]{1,119}$/.test(value)) invalid();
  return value;
}
function personLabel(value: unknown): string {
  if (typeof value !== 'string' || !value || [...value].length > 200 || /[\u0000-\u001f\u007f-\u009f]/.test(value)) invalid();
  return value;
}
const n = (value: string) => BigInt(value);

export function parseExceptionDisposition(value: unknown): ExceptionDisposition {
  const v = record(value);
  const d: ExceptionDisposition = {
    id: identifier(v.id),
    exception_id: exceptionId(v.exception_id),
    actor_id: identifier(v.actor_id),
    actor_label: nullable(v.actor_label, personLabel),
    kind: oneOf(v.kind, ['closed', 'reopened'] as const),
    rationale: text(v.rationale, MAX_RATIONALE_BYTES),
    references: array(v.references, MAX_REFERENCES).map(parseSource),
    recorded_us: nullable(v.recorded_us, cursor),
  };
  // A closure cites at least one verified reference.
  if (d.kind === 'closed' && d.references.length === 0) invalid();
  return exact(v, d);
}

/** The status words the server derives; an open exception the latest
 * revision did not observe always says this is not evidence of remediation. */
export function parseException(value: unknown): ExceptionView {
  const v = record(value);
  const e: ExceptionView = {
    id: exceptionId(v.id),
    criterion_root: identifier(v.criterion_root),
    subject: subject(v.subject),
    status: oneOf(v.status, statuses),
    latest_observed: oneOf(v.latest_observed, observed),
    status_words: text(v.status_words, 300),
    occurrences: cursor(v.occurrences),
    first_source_kind: oneOf(v.first_source_kind, sourceKinds),
    first_source_id: text(v.first_source_id, 300),
    recorded_us: nullable(v.recorded_us, cursor),
    disposition: nullable(v.disposition, parseExceptionDisposition),
  };
  if (n(e.occurrences) < 1n
    || (e.status === 'open' && e.latest_observed === 'not_observed') !== e.status_words.includes(NOT_REMEDIATION)
    || (e.disposition !== null && e.disposition.exception_id !== e.id)
    // A closed exception's newest disposition is a closure.
    || (e.status === 'closed_by_disposition' && e.disposition?.kind !== 'closed')) invalid();
  return exact(v, e);
}

export function parseCounts(value: unknown): ExceptionCounts {
  const v = record(value);
  const c: ExceptionCounts = {
    total: cursor(v.total), open: cursor(v.open), resolved_by_evidence: cursor(v.resolved_by_evidence),
    replaced_by_human_judgment: cursor(v.replaced_by_human_judgment), closed_by_disposition: cursor(v.closed_by_disposition),
    subjects: cursor(v.subjects),
  };
  if (n(c.open) + n(c.resolved_by_evidence) + n(c.replaced_by_human_judgment) + n(c.closed_by_disposition) !== n(c.total)
    || n(c.subjects) > n(c.total)) invalid();
  return exact(v, c);
}

export function parseEffective(value: unknown): EffectiveSummary {
  const v = record(value);
  const e: EffectiveSummary = {
    id: summaryId(v.id),
    supersedes: nullable(v.supersedes, summaryId),
    aggregation: oneOf(v.aggregation, ['effective_partition_v1'] as const),
    exact: boolean(v.exact),
    summary: parseSummary(v.summary),
    criteria: array(v.criteria, 16).map(item => {
      const c = record(item);
      return exact(c, {
        criterion_id: identifier(c.criterion_id), human_replaced: cursor(c.human_replaced),
        pending_reconsideration: cursor(c.pending_reconsideration), undisposed: cursor(c.undisposed), superseded: cursor(c.superseded),
      });
    }),
    exceptions: parseCounts(v.exceptions),
    listed: array(v.listed, 50).map(item => {
      const l = record(item);
      return exact(l, {
        id: exceptionId(l.id), subject: subject(l.subject), criterion_root: identifier(l.criterion_root),
        status: oneOf(l.status, statuses), latest_observed: oneOf(l.latest_observed, observed),
      });
    }),
    effective_limitations: array(v.effective_limitations, 6).map(item => {
      const l = record(item);
      return exact(l, { code: oneOf(l.code, limitationCodes), count: nullable(l.count, cursor), text: text(l.text, 400) });
    }),
    recorded_us: nullable(v.recorded_us, cursor),
  };
  const codes = e.effective_limitations.map(l => l.code as (typeof limitationCodes)[number]);
  if (e.summary.id !== e.id || e.supersedes === e.id
    || e.criteria.length !== e.summary.criteria.length
    || e.criteria.some((c, i) => c.criterion_id !== e.summary.criteria[i]!.criterion_id)
    // Lists exactly the first 50 of the exact total.
    || BigInt(e.listed.length) !== (n(e.exceptions.total) < 50n ? n(e.exceptions.total) : 50n)
    // Exact only for a complete population or a sample.
    || e.exact !== (e.summary.sample_id !== null || e.summary.completeness === 'complete')
    || codes.some((c, i) => i > 0 && limitationCodes.indexOf(c) <= limitationCodes.indexOf(codes[i - 1]!))
    || (e.summary.sample_id !== null) !== codes.includes('sample_only')) invalid();
  digest(e.summary.summary_sha256);
  return exact(v, e);
}

export function parseExceptions(value: unknown): ExceptionsList {
  const v = record(value);
  const l: ExceptionsList = {
    exceptions: array(v.exceptions, 200).map(parseException),
    counts: parseCounts(v.counts),
    may_close: boolean(v.may_close),
    not_remediation: text(v.not_remediation, 300),
    effective_summaries: array(v.effective_summaries, 16).map(parseEffective),
    total_effective_summaries: cursor(v.total_effective_summaries),
  };
  if (l.not_remediation !== NOT_REMEDIATION
    || BigInt(l.exceptions.length) > n(l.counts.total)
    || BigInt(l.effective_summaries.length) > n(l.total_effective_summaries)
    || new Set(l.exceptions.map(e => e.id)).size !== l.exceptions.length) invalid();
  return exact(v, l);
}

export function parseDetail(value: unknown, exception: string): ExceptionDetail {
  const v = record(value);
  const d: ExceptionDetail = {
    exception: parseException(v.exception),
    occurrences: array(v.occurrences, 50).map(item => {
      const o = record(item);
      const parsed = {
        source_kind: oneOf(o.source_kind, sourceKinds), source_id: text(o.source_id, 300),
        population_id: nullable(o.population_id, identifier), member_ordinal: nullable(o.member_ordinal, cursor),
        criterion_id: identifier(o.criterion_id), basis_id: identifier(o.basis_id),
        origin: oneOf(o.origin, ['deterministic', 'model_proposal', 'human'] as const),
        evidence: array(o.evidence, 32).map(digest), source_us: cursor(o.source_us),
      };
      if ((parsed.source_kind === 'opportunity') !== (parsed.population_id !== null)
        || (parsed.population_id === null) !== (parsed.member_ordinal === null)
        || (parsed.source_kind === 'disposition') !== (parsed.origin === 'human')) invalid();
      return exact(o, parsed);
    }),
    dispositions: array(v.dispositions, 16).map(parseExceptionDisposition),
    next_cursor: nullable(v.next_cursor, cursor),
  };
  if (d.exception.id !== exception || d.dispositions.some(x => x.exception_id !== exception)) invalid();
  return exact(v, d);
}

function route(scope: Scope, path: string, query?: Record<string, string>): string {
  parseScope(scope);
  const params = new URLSearchParams({ organisation_id: scope.organisation_id, client_id: scope.client_id, ...query });
  return `/engagements/${encodeURIComponent(scope.engagement_id)}/${path}?${params}`;
}

export async function readExceptions(scope: Scope, taskId: string, session: Session | null, signal: AbortSignal): Promise<ExceptionsList> {
  return parseExceptions(await readSessionJson(route(scope, `tasks/${identifier(taskId)}/assessment/exceptions`), session, signal));
}
export async function readException(scope: Scope, taskId: string, exception: string, after: string | null, session: Session | null, signal: AbortSignal): Promise<ExceptionDetail> {
  const path = route(scope, `tasks/${identifier(taskId)}/assessment/exceptions/${exceptionId(exception)}`, after ? { cursor: cursor(after) } : undefined);
  return parseDetail(await readSessionJson(path, session, signal), exception);
}

export type ExceptionDispositionResult =
  | { ok: true; disposition: ExceptionDisposition }
  | { ok: false; status: number; error: string; index: number | null };

const errors = ['exception_disposition_invalid', 'exception_already_closed', 'exception_not_closed', 'reference_unverified', 'exception_not_found', 'access_denied', 'exception_close_forbidden', 'exception_disposition_conflict', 'exception_disposition_capacity', 'exception_disposition_unavailable'] as const;

/** Close or reopen one exception, bound to this session. A refusal returns
 * its closed code; nothing is retried automatically. */
export async function saveExceptionDisposition(scope: Scope, taskId: string, exception: string, command: ExceptionDispositionCommand, session: Session, signal: AbortSignal): Promise<ExceptionDispositionResult> {
  const path = route(scope, `tasks/${identifier(taskId)}/assessment/exceptions/${exceptionId(exception)}/dispositions`);
  const response = await fetch(`/api${path}`, {
    method: 'POST', signal, cache: 'no-store', credentials: 'same-origin',
    headers: {
      Accept: 'application/json', 'Content-Type': 'application/json',
      'X-CSRF-Token': session.csrf_token, 'X-Expected-Actor': session.identity.id, 'X-Expected-Session': session.csrf_token,
    },
    body: JSON.stringify(command),
  });
  if (response.ok) {
    const disposition = parseExceptionDisposition(await readJsonBody(response, 64 * 1024));
    if (disposition.exception_id !== exception || disposition.actor_id !== session.identity.id) invalid();
    return { ok: true, disposition };
  }
  if (![400, 403, 404, 409, 503].includes(response.status)) {
    await response.body?.cancel().catch(() => {});
    throw new AccessError(response.status);
  }
  let body: Record<string, unknown> = {};
  try { body = record(await readJsonBody(response, 4096)); } catch { /* the status alone is definite */ }
  const error = typeof body.error === 'string' && (errors as readonly string[]).includes(body.error) ? body.error : (response.status === 403 ? 'access_denied' : 'exception_disposition_unavailable');
  const index = error === 'reference_unverified' && typeof body.index === 'number' && Number.isInteger(body.index) && body.index >= 0 && body.index < MAX_REFERENCES ? body.index : null;
  return { ok: false, status: response.status, error, index };
}

// ------------------------------------------------------------------ words

export const statusLabel: Record<string, string> = {
  open: 'Open',
  resolved_by_evidence: 'Resolved by evidence',
  replaced_by_human_judgment: 'Replaced by human judgment',
  closed_by_disposition: 'Closed by disposition',
};
export const sourceLabel: Record<string, string> = {
  evaluation: 'an evaluation', revision: 'a revision', opportunity: 'a population opportunity', disposition: "a person's verdict",
};
export const errorLabel: Record<string, string> = {
  exception_disposition_invalid: 'The disposition is not complete: a closure needs your reasons and at least one evidence reference. Nothing was saved.',
  exception_already_closed: 'This exception is already closed. Nothing was saved.',
  exception_not_closed: 'Only a closed exception can be reopened. Nothing was saved.',
  reference_unverified: 'A reference is not an exact quote at its location of a source you can open. Nothing was saved.',
  exception_not_found: 'That exception is not part of this Task. Nothing was saved.',
  access_denied: 'You may not dispose of this exception now. Nothing was saved.',
  exception_close_forbidden: "Only an Audit manager or the Task's accountable person may close or reopen an exception. Nothing was saved.",
  exception_disposition_conflict: 'That request was already used for a different disposition. Nothing was saved.',
  exception_disposition_capacity: 'This exception holds the most dispositions it may hold. Nothing was saved.',
  exception_disposition_unavailable: 'The disposition could not be saved now. Nothing was saved; try again.',
};
export const rationaleBytes = (value: string) => new TextEncoder().encode(value).length;
