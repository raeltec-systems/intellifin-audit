// Story 24.3b: Task-scoped exceptions and the effective summary. Every
// response is strictly parsed. An exception's status is derived by the server
// on every read and never stored; its occurrences are never changed; a
// person's closure is a separate record and never drops a failing count.
// There are no waivers, no percentages and no confidence score anywhere.
import { AccessError, readJsonBody, readSessionJson } from './auth.ts';
import type { Session } from './auth.ts';
import { parseSource } from './citation.ts';
import { cursor, identifier } from './conversation.ts';
import { conclusions, parseSummary } from './coverage.ts';
export { conclusionLabel } from './coverage.ts';
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
export type ExceptionDispositions = components['schemas']['ExceptionDispositionsResponse'];

export const statuses = ['open', 'resolved_by_evidence', 'replaced_by_human_judgment', 'closed_by_disposition'] as const;
export const observed = ['not_met', 'not_observed', 'proposed_met', 'person_undetermined'] as const;
export const sourceKinds = ['evaluation', 'revision', 'opportunity', 'disposition'] as const;
export const limitationCodes = ['population_incomplete', 'unresolved_subjects', 'pending_reconsideration', 'unreviewed_model_proposals', 'superseded_inputs_not_reevaluated', 'open_exceptions', 'sample_only'] as const;
export const NOT_REMEDIATION = 'not observed in the latest revision; this is not evidence of remediation';
/** Owner decisions 2026-10-21: an unreviewed model proposal of "met" never
 * resolves an exception, and a person's "undetermined" is not remediation. */
export const PROPOSED_MET = 'a model proposal suggests this is met; awaiting human review';
export const PERSON_UNDETERMINED = 'a person marked this undetermined; this is not evidence of remediation';
/** Exceptions one list page holds (its counts are over all of them). */
export const EXCEPTION_PAGE = 50;
/** Dispositions one read lists; an exception holds any number of them. */
export const DISPOSITION_PAGE = 50;

/** The exact sentence the server derives for a status and what the latest
 * observation shows (the same rule as the Rust domain). */
export function statusWords(status: (typeof statuses)[number], latest: (typeof observed)[number]): string {
  switch (status) {
    case 'open':
      return latest === 'not_met' ? 'Open: a current observation does not meet the criterion.'
        : latest === 'proposed_met' ? `Open: ${PROPOSED_MET}.`
          : latest === 'person_undetermined' ? `Open: ${PERSON_UNDETERMINED}.`
            : `Open: ${NOT_REMEDIATION}.`;
    case 'resolved_by_evidence': return 'Resolved by evidence: a later evaluation of new evidence meets the criterion.';
    case 'replaced_by_human_judgment': return "Replaced by human judgment: a person's verdict that the criterion is met replaces the failing judgment.";
    case 'closed_by_disposition': return 'Closed by a disposition with evidence; a later failing observation on new evidence reopens it.';
  }
}
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
    dispositions: cursor(v.dispositions),
    first_source_kind: oneOf(v.first_source_kind, sourceKinds),
    first_source_id: text(v.first_source_id, 300),
    recorded_us: nullable(v.recorded_us, cursor),
    disposition: nullable(v.disposition, parseExceptionDisposition),
  };
  if (n(e.occurrences) < 1n
    || e.status_words !== statusWords(e.status as (typeof statuses)[number], e.latest_observed as (typeof observed)[number])
    // Resolved or replaced means nothing current fails or awaits review.
    || ((e.status === 'resolved_by_evidence' || e.status === 'replaced_by_human_judgment') && e.latest_observed !== 'not_observed')
    // A newest disposition exists exactly when one was saved.
    || (e.disposition === null) !== (n(e.dispositions) === 0n)
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
    conclusion: oneOf(v.conclusion, conclusions),
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
    effective_limitations: array(v.effective_limitations, 7).map(item => {
      const l = record(item);
      return exact(l, { code: oneOf(l.code, limitationCodes), count: nullable(l.count, cursor), text: text(l.text, 400) });
    }),
    recorded_us: nullable(v.recorded_us, cursor),
  };
  const codes = e.effective_limitations.map(l => l.code as (typeof limitationCodes)[number]);
  // An open exception caps "no exception found" at inconclusive; the
  // conclusion otherwise is the coverage summary's.
  const expected = e.summary.conclusion === 'no_exception_found' && n(e.exceptions.open) > 0n ? 'inconclusive' : e.summary.conclusion;
  if (e.summary.id !== e.id || e.supersedes === e.id || e.conclusion !== expected
    || (n(e.exceptions.open) > 0n) !== codes.includes('open_exceptions')
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
    exceptions: array(v.exceptions, EXCEPTION_PAGE).map(parseException),
    counts: parseCounts(v.counts),
    next_cursor: nullable(v.next_cursor, exceptionId),
    may_close: boolean(v.may_close),
    not_remediation: text(v.not_remediation, 300),
    effective_summaries: array(v.effective_summaries, 16).map(parseEffective),
    total_effective_summaries: cursor(v.total_effective_summaries),
  };
  if (l.not_remediation !== NOT_REMEDIATION
    || BigInt(l.exceptions.length) > n(l.counts.total)
    || BigInt(l.effective_summaries.length) > n(l.total_effective_summaries)
    || new Set(l.exceptions.map(e => e.id)).size !== l.exceptions.length
    // A next page follows only a full page, from its last exception.
    || (l.next_cursor !== null && (l.exceptions.length !== EXCEPTION_PAGE || l.next_cursor !== l.exceptions[l.exceptions.length - 1]!.id))) invalid();
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
        evidence: array(o.evidence, 32).map(digest), source_us: cursor(o.source_us), seq: cursor(o.seq),
      };
      if ((parsed.source_kind === 'opportunity') !== (parsed.population_id !== null)
        || (parsed.population_id === null) !== (parsed.member_ordinal === null)
        || (parsed.source_kind === 'disposition') !== (parsed.origin === 'human')) invalid();
      return exact(o, parsed);
    }),
    dispositions: array(v.dispositions, DISPOSITION_PAGE).map(parseExceptionDisposition),
    next_cursor: nullable(v.next_cursor, cursor),
    dispositions_next_cursor: nullable(v.dispositions_next_cursor, cursor),
  };
  if (d.exception.id !== exception || !pagedDispositions(d.dispositions, d.exception.dispositions, d.dispositions_next_cursor, exception)
    // Occurrences in their order; a next page continues after the last.
    || d.occurrences.some((o, i) => i > 0 && n(o.seq) <= n(d.occurrences[i - 1]!.seq))
    || (d.next_cursor !== null && (d.occurrences.length !== 50 || d.next_cursor !== d.occurrences[d.occurrences.length - 1]!.seq))) invalid();
  return exact(v, d);
}

/** Listed dispositions: unique, of this exception, at most its exact count,
 * and a next page follows only a full page. */
function pagedDispositions(list: ExceptionDisposition[], total: string, next: string | null, exception: string): boolean {
  return list.every(x => x.exception_id === exception) && new Set(list.map(x => x.id)).size === list.length
    && n(total) >= BigInt(list.length) && (next === null || list.length === DISPOSITION_PAGE);
}

/** One page of one exception's dispositions in their order. */
export function parseDispositionPage(value: unknown, exception: string): ExceptionDispositions {
  const v = record(value);
  const p: ExceptionDispositions = {
    exception_id: exceptionId(v.exception_id),
    total: cursor(v.total),
    dispositions: array(v.dispositions, DISPOSITION_PAGE).map(parseExceptionDisposition),
    next_cursor: nullable(v.next_cursor, cursor),
  };
  if (p.exception_id !== exception || !pagedDispositions(p.dispositions, p.total, p.next_cursor, exception)) invalid();
  return exact(v, p);
}

function route(scope: Scope, path: string, query?: Record<string, string>): string {
  parseScope(scope);
  const params = new URLSearchParams({ organisation_id: scope.organisation_id, client_id: scope.client_id, ...query });
  return `/engagements/${encodeURIComponent(scope.engagement_id)}/${path}?${params}`;
}

/** One page of the Task's exceptions; `after` is the previous page's
 * `next_cursor`. The counts are always over every exception. */
export async function readExceptions(scope: Scope, taskId: string, after: string | null, session: Session | null, signal: AbortSignal): Promise<ExceptionsList> {
  const path = route(scope, `tasks/${identifier(taskId)}/assessment/exceptions`, after ? { cursor: exceptionId(after) } : undefined);
  return parseExceptions(await readSessionJson(path, session, signal));
}
export async function readException(scope: Scope, taskId: string, exception: string, after: string | null, session: Session | null, signal: AbortSignal): Promise<ExceptionDetail> {
  const path = route(scope, `tasks/${identifier(taskId)}/assessment/exceptions/${exceptionId(exception)}`, after ? { cursor: cursor(after) } : undefined);
  return parseDetail(await readSessionJson(path, session, signal), exception);
}

/** The next page of one exception's dispositions after the place `after`
 * (the previous page's `next_cursor`). */
export async function readExceptionDispositions(scope: Scope, taskId: string, exception: string, after: string, session: Session | null, signal: AbortSignal): Promise<ExceptionDispositions> {
  const path = route(scope, `tasks/${identifier(taskId)}/assessment/exceptions/${exceptionId(exception)}/dispositions`, { cursor: cursor(after) });
  return parseDispositionPage(await readSessionJson(path, session, signal), exception);
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
  exception_disposition_capacity: 'Too many dispositions are being saved now. Nothing was saved; try again.',
  exception_disposition_unavailable: 'The disposition could not be saved now. Nothing was saved; try again.',
};
export const rationaleBytes = (value: string) => new TextEncoder().encode(value).length;
