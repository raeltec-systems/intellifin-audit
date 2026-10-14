// Story 22.5 cited answers. Every response is strictly parsed. The answer is
// model output: it is attributed data, rendered as text, and grants no
// authority. Verification adds a closed result per source; it never edits the
// answer. A citation never grants source access: an unreadable source carries
// no quote, filename or storage version.
import { readSessionJson } from './auth.ts';
import type { Session } from './auth.ts';
import { parseScope } from './engagements.ts';
import type { Scope } from './engagements.ts';
import { identifier } from './conversation.ts';
import type { components } from './generated/api.ts';

export type CitedAnswer = components['schemas']['CitedAnswerResponse'];
export type AnswerSegment = components['schemas']['AnswerSegmentResponse'];
export type CitationSource = components['schemas']['CitationSourceResponse'];
export type UnverifiedReason = 'not_found_at_location' | 'location_missing' | 'source_unreadable' | 'page_only';

const reasons: readonly UnverifiedReason[] = ['not_found_at_location', 'location_missing', 'source_unreadable', 'page_only'];
const MAX_ANSWER_BYTES = 16384, MAX_SEGMENTS = 64, MAX_SOURCES = 8, MAX_QUOTE_BYTES = 1000, MAX_LOCATOR_BYTES = 300;
/// The evidence filename bound (Story 21.1): at most 255 UTF-8 bytes.
const MAX_FILENAME_BYTES = 255;
const bytes = (value: string) => new TextEncoder().encode(value).length;

function invalid(): never { throw new Error('Invalid answers response'); }
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid();
  return value as Record<string, unknown>;
}
function array(value: unknown, max: number): unknown[] {
  if (!Array.isArray(value) || value.length > max) invalid();
  return value;
}
function text(value: unknown, max: number): string {
  if (typeof value !== 'string' || bytes(value) > max) invalid();
  return value;
}
function optional<T>(value: unknown, parse: (value: unknown) => T): T | null {
  return value === null ? null : parse(value);
}
function label(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0 || bytes(value) > MAX_LOCATOR_BYTES || /[\u0000-\u001f\u007f-\u009f]/.test(value)) invalid();
  return value;
}
/// An attributed evidence filename under the same bound the evidence viewer
/// accepts. Its text is data; only control characters are refused.
function filename(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0 || bytes(value) > MAX_FILENAME_BYTES || /[\u0000-\u001f\u007f-\u009f]/.test(value)) invalid();
  return value;
}
function offset(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) invalid();
  return value;
}

export function parseSource(value: unknown): CitationSource {
  const v = record(value);
  if (typeof v.readable !== 'boolean') invalid();
  const verification = v.verification === 'verified' || v.verification === 'unverified' || v.verification === 'unchecked' ? v.verification : invalid();
  const reason = optional(v.reason, value => reasons.includes(value as UnverifiedReason) ? value as UnverifiedReason : invalid());
  // Exactly an unverified source carries a closed reason.
  if ((verification === 'unverified') !== (reason !== null)) invalid();
  // An unchecked source (its answer's verification failed) names no exact original.
  if (verification === 'unchecked' && v.readable !== false) invalid();
  const source: CitationSource = {
    original_id: identifier(v.original_id),
    readable: v.readable,
    filename: optional(v.filename, filename),
    version: optional(v.version, value => label(value)),
    sha256: optional(v.sha256, value => typeof value === 'string' && /^[0-9a-f]{64}$/.test(value) ? value : invalid()),
    locator: optional(v.locator, label),
    location: optional(v.location, label),
    byte_start: optional(v.byte_start, offset),
    byte_end: optional(v.byte_end, offset),
    quote: optional(v.quote, value => text(value, MAX_QUOTE_BYTES)),
    verification,
    reason,
  };
  // An unreadable source discloses nothing beyond its closed verification: no
  // quote, filename, version, digest or location. A readable one names its
  // exact original; its filename may be unrecorded.
  const required = [source.version, source.sha256, source.quote];
  const disclosed = [source.filename, source.version, source.sha256, source.quote, source.locator, source.location, source.byte_start, source.byte_end];
  if (source.readable ? required.some(value => value === null) : disclosed.some(value => value !== null)) invalid();
  if ((source.locator === null) !== (source.location === null)) invalid();
  const start = source.byte_start ?? null, end = source.byte_end ?? null;
  if ((start === null) !== (end === null) || (start !== null && end !== null && start >= end)) invalid();
  return source;
}

export function parseAnswer(value: unknown): CitedAnswer {
  const v = record(value);
  const segments = array(v.segments, MAX_SEGMENTS).map(segment => {
    const s = record(segment);
    return { text: text(s.text, MAX_ANSWER_BYTES), sources: array(s.sources, MAX_SOURCES).map(parseSource) };
  });
  if (typeof v.verification_failed !== 'boolean') invalid();
  const answer: CitedAnswer = {
    invocation_id: identifier(v.invocation_id),
    text: text(v.text, MAX_ANSWER_BYTES),
    segments,
    limitations: array(v.limitations, 16).map(value => text(value, 500)),
    verification_failed: v.verification_failed,
  };
  // The answer is unchanged: its segments are exactly its text.
  if (segments.length === 0 || segments.map(segment => segment.text).join('') !== answer.text) invalid();
  // A failed verification checked nothing; a completed one checked every source.
  const unchecked = segments.flatMap(segment => segment.sources).map(source => source.verification === 'unchecked');
  if (unchecked.some(value => value !== answer.verification_failed)) invalid();
  return answer;
}

/// Answers that parsed, oldest first, and how many were skipped because they
/// did not parse. One malformed answer never hides the others.
export interface TaskAnswers {
  answers: CitedAnswer[];
  skipped: number;
}

export function parseAnswers(value: unknown): TaskAnswers {
  const answers: CitedAnswer[] = [];
  let skipped = 0;
  const seen = new Set<string>();
  for (const item of array(record(value).answers, 20)) {
    try {
      const answer = parseAnswer(item);
      if (seen.has(answer.invocation_id)) { skipped += 1; continue; }
      seen.add(answer.invocation_id);
      answers.push(answer);
    } catch {
      skipped += 1;
    }
  }
  return { answers, skipped };
}

export async function readTaskAnswers(scope: Scope, taskId: string, session: Session | null, signal: AbortSignal): Promise<TaskAnswers> {
  parseScope(scope);
  const query = new URLSearchParams({ organisation_id: scope.organisation_id, client_id: scope.client_id });
  return parseAnswers(await readSessionJson(`/engagements/${encodeURIComponent(scope.engagement_id)}/tasks/${identifier(taskId)}/answers?${query}`, session, signal));
}

/** A short chip label: the first readable source's filename, shortened. */
export function chipLabel(sources: readonly CitationSource[]): { label: string; more: number } {
  const first = sources.find(source => source.readable && source.filename) ?? null;
  const name = first?.filename ?? 'Source';
  const label = [...name].length > 24 ? `${[...name].slice(0, 23).join('')}…` : name;
  return { label, more: Math.max(0, sources.length - 1) };
}

/** A bounded quote for the card: at most 280 characters. */
export function boundedQuote(quote: string): string {
  const characters = [...quote];
  return characters.length > 280 ? `${characters.slice(0, 279).join('')}…` : quote;
}

export const reasonLabel: Record<UnverifiedReason, string> = {
  not_found_at_location: 'The quoted text was not found at this location.',
  location_missing: 'No location was given.',
  source_unreadable: 'The source could not be read safely.',
  page_only: 'Only the page was confirmed; the page was read as an image.',
};
/** Shown on a source whose answer could not be verified at all. */
export const uncheckedLabel = 'Verification of this answer could not be completed; this source was not checked.';

/** The location to show when an original is opened from a citation. */
export interface CitedLocation {
  label: string;
  byteStart: number | null;
  byteEnd: number | null;
}

/**
 * Split preview text at a cited UTF-8 byte range. Null when the range is not
 * wholly inside the preview or does not fall on character boundaries: then
 * nothing is highlighted and the location label alone is shown.
 */
export function splitAtBytes(preview: string, start: number, end: number): [string, string, string] | null {
  const encoded = new TextEncoder().encode(preview);
  if (start < 0 || end <= start || end > encoded.length) return null;
  const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
  try {
    return [decoder.decode(encoded.slice(0, start)), decoder.decode(encoded.slice(start, end)), decoder.decode(encoded.slice(end))];
  } catch {
    return null;
  }
}
