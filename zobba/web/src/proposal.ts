// Story 22.6 AC4: an Admin methodology document becomes an editable proposal.
// Every kept field cites an exact document location that trusted code found.
// A proposal has no effect: only the ordinary validated Save makes it current.
import { readJson, readSessionJson } from './auth.ts';
import type { Session } from './auth.ts';
import { verifyMembershipSession } from './membership.ts';
import { parseDefinition } from './methodology.ts';
import type { Definition, SaveMethodology } from './methodology.ts';

export type ProposalLocation = { start: string; end: string; line: string };
export type ProposalCitation = { field: string; quote: string; location: ProposalLocation };
export type ProposalConflict = { text: string; quote: string; location: ProposalLocation };
export type ProposalStatus = 'drafted' | 'failed' | 'in_progress' | 'uncertain';
export type MethodologyProposal = {
  id: string; key: string; actor_id: string;
  disclosure: { filename: string; media_type: string; document_sha256: string; document_size: string; profile_id: string; profile_revision: string; provider: string; model: string };
  status: ProposalStatus; reason: string | null;
  definition: Definition | null; source: SaveMethodology['source'] | null;
  citations: ProposalCitation[]; conflicts: ProposalConflict[]; missing_criteria: string[]; unverified: string[];
};
export type ProposalRequest = { key: string; profile_id: string; filename: string; media_type: 'text/plain' | 'text/markdown'; text: string };

export const PROPOSAL_MEDIA_TYPES = ['text/plain', 'text/markdown'] as const;
export const MAX_PROPOSAL_DOCUMENT_BYTES = 200_000;
/** The same bounds the server enforces on a drafted proposal. */
export const MAX_PROPOSAL_CITATIONS = 4096;
export const MAX_PROPOSAL_UNVERIFIED = 4096;

function invalid(): never { throw new Error('Invalid proposal response'); }
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid();
  return value as Record<string, unknown>;
}
const idPattern = /^[A-Za-z0-9_-]{1,128}$/;
function id(value: unknown): string { if (typeof value !== 'string' || !idPattern.test(value)) invalid(); return value; }
function count(value: unknown): string { if (typeof value !== 'string' || !/^(0|[1-9][0-9]{0,18})$/.test(value)) invalid(); return value; }
/** Non-empty text of at most `maximumBytes` UTF-8 bytes, the server's exact bound. */
function text(value: unknown, maximumBytes: number): string {
  if (typeof value !== 'string' || value.length === 0 || new TextEncoder().encode(value).length > maximumBytes) invalid();
  return value;
}
/** A scope label: 1–200 Unicode scalars with no control characters. */
function label(value: unknown): string {
  if (typeof value !== 'string' || !validLabel(value)) invalid();
  return value;
}
export function validLabel(value: string): boolean {
  const scalars = [...value];
  return scalars.length > 0 && scalars.length <= 200 && value.trim() === value && !/[\u0000-\u001f\u007f-\u009f]/.test(value);
}
/** What the server accepts as a document: non-blank UTF-8 text of at most
 * 200,000 bytes, with no control characters except tab, line feed and
 * carriage return. */
export function validDocument(value: string): boolean {
  return value.trim().length > 0 && new TextEncoder().encode(value).length <= MAX_PROPOSAL_DOCUMENT_BYTES
    && !/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/.test(value);
}
export const validProfileId = (value: string) => idPattern.test(value);
function list<T>(value: unknown, parse: (value: unknown) => T, maximum: number): T[] {
  if (!Array.isArray(value) || value.length > maximum) invalid();
  return value.map(parse);
}
function location(value: unknown): ProposalLocation {
  const v = object(value);
  const out = { start: count(v.start), end: count(v.end), line: count(v.line) };
  if (BigInt(out.end) <= BigInt(out.start) || out.line === '0') invalid();
  return out;
}
function cited(value: unknown): ProposalCitation {
  const v = object(value);
  return { field: text(v.field, 400), quote: text(v.quote, 2000), location: location(v.location) };
}
function conflict(value: unknown): ProposalConflict {
  const v = object(value);
  return { text: text(v.text, 2000), quote: text(v.quote, 2000), location: location(v.location) };
}
function source(value: unknown): SaveMethodology['source'] {
  const v = object(value);
  // A proposal is never authored configuration.
  if (v.kind !== 'imported_proposal' || typeof v.reference !== 'string') invalid();
  return { kind: 'imported_proposal', reference: text(v.reference, 2000), note: v.note == null ? null : text(v.note, 2000) };
}

export function parseProposal(value: unknown): MethodologyProposal {
  const v = object(value);
  const d = object(v.disclosure);
  if (!['drafted', 'failed', 'in_progress', 'uncertain'].includes(v.status as string)) invalid();
  const status = v.status as ProposalStatus;
  const disclosure = {
    filename: label(d.filename), media_type: (PROPOSAL_MEDIA_TYPES as readonly unknown[]).includes(d.media_type) ? d.media_type as string : invalid(),
    document_sha256: typeof d.document_sha256 === 'string' && /^[0-9a-f]{64}$/.test(d.document_sha256) ? d.document_sha256 : invalid(),
    document_size: count(d.document_size), profile_id: id(d.profile_id), profile_revision: count(d.profile_revision), provider: id(d.provider), model: text(d.model, 200),
  };
  const proposal: MethodologyProposal = {
    id: id(v.id), key: id(v.key), actor_id: id(v.actor_id), disclosure, status,
    reason: v.reason == null ? null : id(v.reason),
    definition: v.definition == null ? null : parseDefinition(v.definition),
    source: v.source == null ? null : source(v.source),
    citations: list(v.citations, cited, MAX_PROPOSAL_CITATIONS), conflicts: list(v.conflicts, conflict, 64),
    missing_criteria: list(v.missing_criteria, id, 128), unverified: list(v.unverified, value => text(value, 400), MAX_PROPOSAL_UNVERIFIED),
  };
  // A drafted proposal carries its editable definition; nothing else does.
  if ((status === 'drafted') !== (proposal.definition !== null && proposal.source !== null)) invalid();
  if (status === 'failed' && proposal.reason === null) invalid();
  if (status !== 'drafted' && (proposal.citations.length || proposal.conflicts.length || proposal.missing_criteria.length)) invalid();
  // Every kept requirement field is cited; a citation never names a field that is not there.
  if (proposal.definition) {
    const fields = new Set(proposal.citations.map(c => c.field));
    proposal.definition.requirements.forEach((r, index) => {
      if (!fields.has(`requirements[${index}].label`)) invalid();
      for (const name of ['criteria', 'populations', 'evidence_checks', 'ratings', 'review_rules'] as const)
        (r[name] ?? []).forEach((_, item) => { if (!fields.has(`requirements[${index}].${name}[${item}]`)) invalid(); });
    });
    for (const id of proposal.missing_criteria) if (!proposal.definition.requirements.some(r => r.id === id)) invalid();
  }
  return proposal;
}

/** Citations of one editor field path, for display beside the proposed value. */
export function citationsFor(proposal: MethodologyProposal, field: string): ProposalCitation[] {
  return proposal.citations.filter(c => c.field === field);
}

/** The editor command for a proposal: a new methodology with the proposal's
 * definition and attribution. It is saved only by the ordinary Save. */
export function proposalCommand(proposal: MethodologyProposal, expectedRevision: string, key: string): SaveMethodology {
  if (proposal.status !== 'drafted' || !proposal.definition || !proposal.source) throw new Error('Only a drafted proposal can be edited');
  return {
    key, expected_revision: expectedRevision, supersedes: null, undo_of: null,
    assignment: { kind: 'firm', client_id: null, engagement_id: null },
    applicability: { audit_area: null, period_start: null, period_end: null },
    activation: { mode: 'new_tasks', available_at: 0 },
    definition: structuredClone(proposal.definition), source: { ...proposal.source },
  };
}

export async function proposeMethodology(organisation: string, request: ProposalRequest, session: Session, signal: AbortSignal): Promise<MethodologyProposal> {
  await verifyMembershipSession(session, signal);
  const response = await readJson(`/methodology/organisations/${encodeURIComponent(id(organisation))}/proposals`, signal, {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': session.csrf_token, 'X-Expected-Actor': session.identity.id, 'X-Expected-Session': session.csrf_token },
    body: JSON.stringify(request),
  });
  await verifyMembershipSession(session, signal);
  const proposal = parseProposal(response);
  if (proposal.key !== request.key) invalid();
  return proposal;
}

export async function readProposals(organisation: string, session: Session, signal: AbortSignal): Promise<MethodologyProposal[]> {
  const response = object(await readSessionJson(`/methodology/organisations/${encodeURIComponent(id(organisation))}/proposals`, session, signal));
  await verifyMembershipSession(session, signal);
  return list(response.proposals, parseProposal, 20);
}
