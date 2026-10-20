// Story 24.3a: revision chains and a person's disposition of one exact
// revision. Every response is strictly parsed. A revision is never changed:
// a later one is appended with closed causes derived by trusted code, and a
// disposition is a separate record. The person's words and Zobba's text are
// attributed data. There is no confidence score anywhere.
import { AccessError, readJsonBody, readSessionJson } from './auth.ts';
import type { Session } from './auth.ts';
import { parseSource } from './citation.ts';
import { cursor, identifier } from './conversation.ts';
import { parseScope } from './engagements.ts';
import type { Scope } from './engagements.ts';
import { array, boolean, digest, evaluationReasons, exact, invalid, nullable, oneOf, parseFact, record, subject, text } from './assessment.ts';
import type { components } from './generated/api.ts';

export type Chain = components['schemas']['ChainResponse'];
export type Disposition = components['schemas']['DispositionResponse'];
export type HistoryEntry = components['schemas']['HistoryEntryResponse'];
export type ChainHistory = components['schemas']['ChainHistoryResponse'];
export type DispositionCommand = components['schemas']['DispositionCommandRequest'];

export const causes = ['inputs_changed', 'criterion_revised', 'basis_revised', 'prior_execution_failed', 'reconsideration_requested'] as const;
export const kinds = ['accepted', 'replaced', 'needs_reconsideration'] as const;
export const concerns = ['facts', 'rule', 'authority', 'scope'] as const;
export const verdicts = ['met', 'not_met', 'undetermined'] as const;
export const reviews = ['unreviewed', 'accepted', 'replaced', 'pending_reconsideration'] as const;
export const MAX_RATIONALE_BYTES = 2000;
export const MAX_REFERENCES = 8;

/** A revision ID: the 24.1 evaluation (revision 1) or a later revision. */
function revisionId(value: unknown): string {
  if (typeof value !== 'string' || !/^(eval|rev)-[A-Za-z0-9_-]{1,124}$/.test(value)) invalid();
  return value;
}
function chainId(value: unknown): string {
  if (typeof value !== 'string' || !/^eval-[A-Za-z0-9_-]{1,123}$/.test(value)) invalid();
  return value;
}
function revisionNumber(value: unknown): string {
  const n = cursor(value);
  if (BigInt(n) < 1n || BigInt(n) > 1_000_000n) invalid();
  return n;
}
function closedCauses(value: unknown): string[] {
  const list = array(value, 5).map(item => oneOf(item, causes));
  if (new Set(list).size !== list.length) invalid();
  // Causes are listed in their closed order.
  if (list.some((c, i) => i > 0 && causes.indexOf(c) < causes.indexOf(list[i - 1]!))) invalid();
  return list;
}

/** A person's public label: 1–200 Unicode scalars without controls (the
 * server's identity rule, counted in characters, never UTF-8 bytes). */
function personLabel(value: unknown): string {
  if (typeof value !== 'string' || !value || [...value].length > 200 || /[\u0000-\u001f\u007f-\u009f]/.test(value)) invalid();
  return value;
}

export function parseDisposition(value: unknown): Disposition {
  const v = record(value);
  const kind = oneOf(v.kind, kinds);
  const d: Disposition = {
    id: identifier(v.id),
    actor_id: identifier(v.actor_id),
    actor_label: nullable(v.actor_label, personLabel),
    chain_id: chainId(v.chain_id),
    revision: revisionNumber(v.revision),
    revision_id: revisionId(v.revision_id),
    kind,
    concern: nullable(v.concern, item => oneOf(item, concerns)),
    verdict: nullable(v.verdict, item => oneOf(item, verdicts)),
    rationale: text(v.rationale, MAX_RATIONALE_BYTES),
    references: array(v.references, MAX_REFERENCES).map(parseSource),
    recorded_us: nullable(v.recorded_us, cursor),
  };
  if ((kind === 'needs_reconsideration') !== (d.concern !== null)
    || (kind === 'replaced') !== (d.verdict !== null)
    || (d.revision === '1') !== (d.revision_id === d.chain_id)) invalid();
  return exact(v, d);
}

/** The current head of a chain and its review state, derived by the server. */
export function parseChain(value: unknown): Chain {
  const v = record(value);
  const c: Chain = {
    chain_id: chainId(v.chain_id),
    head_id: revisionId(v.head_id),
    revision: revisionNumber(v.revision),
    basis_id: identifier(v.basis_id),
    criterion_id: identifier(v.criterion_id),
    applicability: oneOf(v.applicability, ['applicable', 'not_applicable', 'unknown'] as const),
    execution: oneOf(v.execution, ['completed', 'failed'] as const),
    verdict: nullable(v.verdict, item => oneOf(item, verdicts)),
    reason: nullable(v.reason, item => oneOf(item, evaluationReasons)),
    origin: oneOf(v.origin, ['deterministic', 'model_proposal'] as const),
    causes: closedCauses(v.causes),
    effective_verdict: nullable(v.effective_verdict, item => oneOf(item, verdicts)),
    effective_origin: oneOf(v.effective_origin, ['deterministic', 'model_proposal', 'human'] as const),
    review: oneOf(v.review, reviews),
    earlier_accepted: boolean(v.earlier_accepted),
    disposition: nullable(v.disposition, parseDisposition),
  };
  const first = c.revision === '1';
  const d = c.disposition;
  if (first !== (c.head_id === c.chain_id) || first !== (c.causes.length === 0)
    || (d !== null && (d.revision_id !== c.head_id || d.chain_id !== c.chain_id))
    // The review state is the head's newest disposition, and only `replaced`
    // gives a human verdict (never over a rule verdict).
    || (d === null) !== (c.review === 'unreviewed')
    || (d !== null && c.review !== ({ accepted: 'accepted', replaced: 'replaced', needs_reconsideration: 'pending_reconsideration' } as const)[d.kind])
    || (c.review === 'replaced') !== (c.effective_origin === 'human')
    || (c.review === 'replaced' && (c.origin !== 'model_proposal' || c.effective_verdict !== d?.verdict))
    // `earlier_accepted` says an earlier revision was accepted, whatever this
    // revision's own review state is.
    || (c.review !== 'replaced' && (c.effective_origin !== c.origin || c.effective_verdict !== c.verdict))) invalid();
  return exact(v, c);
}

function parseEntry(value: unknown, chain: string): HistoryEntry {
  const v = record(value);
  const changes = record(v.changes);
  const e: HistoryEntry = {
    revision: revisionNumber(v.revision),
    id: revisionId(v.id),
    invocation_id: identifier(v.invocation_id),
    predecessor_id: nullable(v.predecessor_id, revisionId),
    basis_id: identifier(v.basis_id),
    criterion_id: identifier(v.criterion_id),
    applicability: oneOf(v.applicability, ['applicable', 'not_applicable', 'unknown'] as const),
    execution: oneOf(v.execution, ['completed', 'failed'] as const),
    verdict: nullable(v.verdict, item => oneOf(item, verdicts)),
    reason: nullable(v.reason, item => oneOf(item, evaluationReasons)),
    origin: oneOf(v.origin, ['deterministic', 'model_proposal'] as const),
    inputs: array(v.inputs, 32).map(item => {
      const i = record(item);
      return exact(i, { fact_id: identifier(i.fact_id), digest: digest(i.digest) });
    }),
    output_digest: digest(v.output_digest),
    judgment: nullable(v.judgment, item => {
      const j = record(item);
      return exact(j, {
        supporting: array(j.supporting, 8).map(identifier), contrary: array(j.contrary, 8).map(identifier),
        rationale: text(j.rationale, 2000), uncertainty: j.uncertainty === '' ? '' : text(j.uncertainty, 2000),
      });
    }),
    causes: closedCauses(v.causes),
    changes: exact(changes, {
      added: array(changes.added, 32).map(identifier),
      removed: array(changes.removed, 32).map(identifier),
      replaced: array(changes.replaced, 32).map(item => {
        const r = record(item);
        return exact(r, { from: identifier(r.from), to: identifier(r.to) });
      }),
    }),
    dispositions: array(v.dispositions, 16).map(parseDisposition),
    recorded_us: nullable(v.recorded_us, cursor),
  };
  const first = e.revision === '1';
  const changed = e.changes.added.length + e.changes.removed.length + e.changes.replaced.length;
  if (first !== (e.predecessor_id === null) || first !== (e.id === chain) || first !== (e.causes.length === 0)
    || (first && changed > 0)
    || (e.origin === 'model_proposal') !== (e.judgment !== null)
    || e.dispositions.some(d => d.revision_id !== e.id || d.revision !== e.revision)) invalid();
  return exact(v, e);
}

/** One page of a chain's history, in revision order. */
export function parseHistory(value: unknown, chain: string): ChainHistory {
  const v = record(value);
  const h: ChainHistory = {
    chain_id: chainId(v.chain_id),
    subject: subject(v.subject),
    total: revisionNumber(v.total),
    head_id: revisionId(v.head_id),
    entries: array(v.entries, 50).map(item => parseEntry(item, chain)),
    facts: array(v.facts, 1600).map(parseFact),
    next_cursor: nullable(v.next_cursor, revisionNumber),
  };
  const numbers = h.entries.map(e => BigInt(e.revision));
  if (h.chain_id !== chain || numbers.some((n, i) => i > 0 && n !== numbers[i - 1]! + 1n)
    || numbers.some(n => n > BigInt(h.total))
    || (h.next_cursor !== null && (h.entries.length === 0 || BigInt(h.next_cursor) !== numbers.at(-1)))
    || (h.next_cursor === null && h.entries.length > 0 && numbers.at(-1) !== BigInt(h.total))) invalid();
  return exact(v, h);
}

function route(scope: Scope, path: string, query?: Record<string, string>): string {
  parseScope(scope);
  const params = new URLSearchParams({ organisation_id: scope.organisation_id, client_id: scope.client_id, ...query });
  return `/engagements/${encodeURIComponent(scope.engagement_id)}/${path}?${params}`;
}

export async function readHistory(scope: Scope, taskId: string, chain: string, after: string | null, session: Session | null, signal: AbortSignal): Promise<ChainHistory> {
  const path = route(scope, `tasks/${identifier(taskId)}/assessment/chains/${chainId(chain)}/history`, after ? { cursor: revisionNumber(after) } : undefined);
  return parseHistory(await readSessionJson(path, session, signal), chain);
}

export type DispositionResult =
  | { ok: true; disposition: Disposition }
  | { ok: false; status: number; error: string; head_id: string | null; index: number | null };

const errors = ['disposition_invalid', 'not_replaceable', 'verdict_not_decidable', 'reference_unverified', 'revision_superseded', 'revision_not_found', 'access_denied', 'disposition_conflict', 'disposition_capacity', 'disposition_unavailable'] as const;

/** Save one disposition of one exact revision, bound to this session. A
 * refusal returns its closed code; nothing is retried automatically. */
export async function saveDisposition(scope: Scope, taskId: string, revision: string, command: DispositionCommand, session: Session, signal: AbortSignal): Promise<DispositionResult> {
  const path = route(scope, `tasks/${identifier(taskId)}/assessment/revisions/${revisionId(revision)}/dispositions`);
  const response = await fetch(`/api${path}`, {
    method: 'POST', signal, cache: 'no-store', credentials: 'same-origin',
    headers: {
      Accept: 'application/json', 'Content-Type': 'application/json',
      'X-CSRF-Token': session.csrf_token, 'X-Expected-Actor': session.identity.id, 'X-Expected-Session': session.csrf_token,
    },
    body: JSON.stringify(command),
  });
  if (response.ok) {
    const disposition = parseDisposition(await readJsonBody(response, 64 * 1024));
    if (disposition.revision_id !== revision || disposition.actor_id !== session.identity.id) invalid();
    return { ok: true, disposition };
  }
  if (![400, 403, 404, 409, 503].includes(response.status)) {
    await response.body?.cancel().catch(() => {});
    throw new AccessError(response.status);
  }
  let body: Record<string, unknown> = {};
  try { body = record(await readJsonBody(response, 4096)); } catch { /* the status alone is definite */ }
  const error = typeof body.error === 'string' && (errors as readonly string[]).includes(body.error) ? body.error : (response.status === 403 ? 'access_denied' : 'disposition_unavailable');
  const head = error === 'revision_superseded' && typeof body.head_id === 'string' ? revisionId(body.head_id) : null;
  const index = error === 'reference_unverified' && typeof body.index === 'number' && Number.isInteger(body.index) && body.index >= 0 && body.index < MAX_REFERENCES ? body.index : null;
  return { ok: false, status: response.status, error, head_id: head, index };
}

// ------------------------------------------------------------------ words

export const causeLabel: Record<string, string> = {
  inputs_changed: 'the facts it reads changed',
  criterion_revised: 'the criterion was revised',
  basis_revised: 'the basis was revised',
  prior_execution_failed: 'the earlier evaluation failed',
  reconsideration_requested: 'a person asked for reconsideration',
};
export const kindLabel: Record<string, string> = {
  accepted: 'Accepted', replaced: 'Replaced with a person\'s verdict', needs_reconsideration: 'Asked Zobba to reconsider',
};
export const concernLabel: Record<string, string> = {
  facts: 'the facts', rule: 'the rule', authority: 'the authority', scope: 'the scope',
};
export const reviewLabel: Record<string, string> = {
  unreviewed: 'Not reviewed yet', accepted: 'Accepted by a person', replaced: 'Replaced by a person', pending_reconsideration: 'Waiting for Zobba to reconsider',
};
export const errorLabel: Record<string, string> = {
  disposition_invalid: 'The disposition is not complete. Nothing was saved.',
  not_replaceable: 'A rule verdict cannot be replaced. Correct the facts or the criterion instead. Nothing was saved.',
  verdict_not_decidable: 'Met or not met can be given only for an evaluation that applies, completed and reads a verified authority. Nothing was saved.',
  reference_unverified: 'A reference is not an exact quote at its location of a source you can open. Nothing was saved.',
  revision_superseded: 'A newer revision was recorded. Nothing was saved; review the newest revision.',
  revision_not_found: 'That revision is not part of this Task. Nothing was saved.',
  access_denied: 'You may not review this evaluation now. Nothing was saved.',
  disposition_conflict: 'That request was already used for a different disposition. Nothing was saved.',
  disposition_capacity: 'This revision holds the most dispositions it may hold. Nothing was saved.',
  disposition_unavailable: 'The disposition could not be saved now. Nothing was saved; try again.',
};
export const rationaleBytes = (value: string) => new TextEncoder().encode(value).length;
