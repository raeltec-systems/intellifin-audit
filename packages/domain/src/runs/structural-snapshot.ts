import { canonicalJson, type JsonValue } from '../canonical-json.js';
import { decodePopulationUtf8, parsePopulationCsv } from './population.js';
import {
  groundedText,
  normalizeObservedAt,
  OBSERVATION_LIMITS,
  type ObservationAttribute,
  type ObservationCheckDiagnostic,
  type ObservationCheckOutcome,
  type ObservationCorroboration,
  type ObservationRecord,
} from './observation.js';

/**
 * Corroboration against the stored Structural Snapshot (Story 3.6).
 *
 * An adapter asserts what it saw. Until something re-reads the stored bytes, a wrong or
 * invented attribute value is indistinguishable from a correct one and the Observation
 * stands on the adapter's word alone. This module is the re-read: it takes the bytes that
 * were frozen as Evidence and the Observation that names them, resolves every grounding's
 * locator against those bytes, and says `matched` or `contradictory` for each attribute.
 *
 * **Pure. Bytes in, verdict out.** There is no fetch, no clock, no store and no host type
 * anywhere in it — the caller hands it what it already froze. That is not only AD-11
 * hygiene: corroboration runs INSIDE the registration transaction and before the digest
 * (observation registration v1), so an I/O of any kind here would hold a PostgreSQL
 * transaction open across a network call, and a value that could differ between two reads
 * would make a redelivered batch produce a different digest and read as an integrity
 * failure.
 *
 * ## The four substrates
 *
 * A Structural Snapshot is one of exactly four kinds, and each carries its own locator
 * grammar and its own label rule:
 *
 * | Substrate | Locator grammar | Label rule |
 * | --- | --- | --- |
 * | `web_tree` | (a later epic) | accessible name |
 * | `desktop_tree` | (a later epic) | control name |
 * | `sheet` | `$.rows[<index>].<column>` | the header cell |
 * | `json` | `$.<collection>[<index>].<field>` | the property key |
 *
 * `web_tree` and `desktop_tree` are EXPLICIT unimplemented cases, never a silent
 * fallthrough: an agent capture reaching this build is reported `corroboration-unsupported`
 * and its check FAILS. A substrate that quietly returned "matched" for a snapshot nobody
 * read would be the exact defect this story exists to remove.
 *
 * ## One grammar, deliberately
 *
 * `sheet` and `json` share `$.<collection>[<index>].<field>` — the shape
 * `execute-adapter-steps.ts` already writes — because two grammars would have to agree on
 * every locator anybody thought to try and would diverge on the first one nobody did. For
 * a `sheet` the collection segment is fixed at `rows`: a sheet artifact carries exactly one
 * table here, and leaving its name free would let two defensible extractors disagree about
 * whether `$.rows[0].role` or `$.role-matrix[0].role` addresses it. `<index>` is the
 * 0-based DATA row, after the header and after a synthetic marker line.
 */

export const SNAPSHOT_SUBSTRATES = ['web_tree', 'desktop_tree', 'sheet', 'json'] as const;
export type SnapshotSubstrate = (typeof SNAPSHOT_SUBSTRATES)[number];

/** The substrates this build re-reads. The other two are refused by name, never skipped. */
export const IMPLEMENTED_SNAPSHOT_SUBSTRATES = ['sheet', 'json'] as const;

/** The one collection segment a `sheet` locator may name (see the note above). */
export const SHEET_COLLECTION = 'rows';

export function isSnapshotSubstrate(value: unknown): value is SnapshotSubstrate {
  return typeof value === 'string' && (SNAPSHOT_SUBSTRATES as readonly string[]).includes(value);
}

/**
 * The substrate a stored artifact's registered media type names, or `null`.
 *
 * The media type is what registration recorded beside the digest, so this is a property of
 * the frozen artifact rather than a guess about its content. An unknown media type is
 * `null`: the caller then has no snapshot for that Evidence and the corroboration is
 * reported unavailable, which is true.
 */
export function snapshotSubstrateForMediaType(mediaType: string | null): SnapshotSubstrate | null {
  if (typeof mediaType !== 'string') return null;
  if (/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(mediaType)) return 'json';
  if (/^text\/csv(?:\s*;\s*charset=utf-8)?$/i.test(mediaType)) return 'sheet';
  return null;
}

/** One stored artifact, as the caller froze it. Nothing here fetches or reads it back. */
export interface StoredSnapshot {
  readonly evidenceId: string;
  readonly substrate: SnapshotSubstrate;
  readonly bytes: Uint8Array;
}

export interface SnapshotLocator {
  readonly collection: string;
  readonly index: number;
  readonly field: string;
}

/**
 * `$.<collection>[<index>].<field>`, anchored.
 *
 * Neither segment may contain `.`, `[` or `]`, so the parse is unique: there is exactly
 * one `$.`, one bracketed index and one trailing `.field`. The index carries no leading
 * zero, because `[07]` and `[7]` would otherwise be two spellings of one cell.
 */
const LOCATOR = /^\$\.([^.[\]]+)\[(0|[1-9][0-9]*)\]\.([^.[\]]+)$/;

export function parseSnapshotLocator(locator: unknown): SnapshotLocator | null {
  if (typeof locator !== 'string' || locator.length > OBSERVATION_LIMITS.text) return null;
  const match = LOCATOR.exec(locator);
  if (match === null) return null;
  const index = Number(match[2]);
  if (!Number.isSafeInteger(index)) return null;
  return { collection: match[1]!, index, field: match[3]! };
}

/** Why a stored snapshot could not be re-read at all. */
export type SnapshotReadFailure = 'substrate-unsupported' | 'snapshot-unreadable';

export type ParsedSnapshot =
  | {
      readonly ok: true;
      readonly substrate: 'sheet';
      readonly headers: readonly string[];
      readonly rows: readonly Record<string, JsonValue>[];
    }
  | {
      readonly ok: true;
      readonly substrate: 'json';
      readonly collections: ReadonlyMap<string, readonly Record<string, JsonValue>[]>;
    }
  | { readonly ok: false; readonly failure: SnapshotReadFailure };

function plainObject(value: unknown): value is Record<string, JsonValue> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Read one stored snapshot into the view the locator grammar addresses.
 *
 * Decoding is the domain's own fatal UTF-8 (`decodePopulationUtf8`): a snapshot with a
 * BOM, a NUL or an invalid sequence is unreadable rather than silently substituted, for
 * the same reason `canonicalJson` refuses a lone surrogate. A `sheet` is parsed by
 * `parsePopulationCsv`, which is RFC 4180, drops a leading `# SYNTHETIC` marker line and
 * refuses a repaired header — the same parser the population reconciliation uses, so a
 * cell address means one thing in this product and not two.
 */
export function readStructuralSnapshot(snapshot: StoredSnapshot): ParsedSnapshot {
  if (snapshot.substrate === 'web_tree' || snapshot.substrate === 'desktop_tree') {
    return { ok: false, failure: 'substrate-unsupported' };
  }
  let text: string;
  try {
    text = decodePopulationUtf8(snapshot.bytes);
  } catch {
    return { ok: false, failure: 'snapshot-unreadable' };
  }
  if (snapshot.substrate === 'sheet') {
    let headers: readonly string[] = [];
    try {
      const rows = parsePopulationCsv(text, (parsed) => {
        headers = parsed;
      });
      return { ok: true, substrate: 'sheet', headers, rows };
    } catch {
      return { ok: false, failure: 'snapshot-unreadable' };
    }
  }
  let envelope: unknown;
  try {
    envelope = JSON.parse(text);
  } catch {
    return { ok: false, failure: 'snapshot-unreadable' };
  }
  if (!plainObject(envelope)) return { ok: false, failure: 'snapshot-unreadable' };
  const collections = new Map<string, readonly Record<string, JsonValue>[]>();
  // Every envelope key holding an array of objects is addressable. NOT only the four
  // collection names: the extractor re-reads what the locator names, and a key such as
  // `schema` (an array of strings) simply never resolves.
  for (const key of Object.keys(envelope)) {
    const value = envelope[key];
    if (Array.isArray(value) && value.every(plainObject)) {
      collections.set(key, value as readonly Record<string, JsonValue>[]);
    }
  }
  return { ok: true, substrate: 'json', collections };
}

/** The value at a locator and the label the substrate's own rule produces for it. */
export interface SnapshotCell {
  readonly value: JsonValue;
  readonly label: string;
}

/**
 * Resolve one locator against a parsed snapshot, or `null` when it addresses nothing.
 *
 * `Object.hasOwn`, never a bare index: a field named `constructor` or `toString` would
 * otherwise return an inherited function and the extractor would carry on with it. That
 * has bitten this repository five times, and here the key comes out of a stored locator.
 */
export function readSnapshotCell(
  parsed: ParsedSnapshot,
  locator: SnapshotLocator,
): SnapshotCell | null {
  if (!parsed.ok) return null;
  if (parsed.substrate === 'sheet') {
    if (locator.collection !== SHEET_COLLECTION) return null;
    const row = parsed.rows[locator.index];
    if (row === undefined) return null;
    // The label rule for a sheet is the HEADER CELL: the column has to be declared by the
    // header row of the stored bytes, not merely present on one parsed row.
    const column = parsed.headers.indexOf(locator.field);
    if (column < 0 || !Object.hasOwn(row, locator.field)) return null;
    return { value: row[locator.field] as JsonValue, label: parsed.headers[column]! };
  }
  const rows = parsed.collections.get(locator.collection);
  if (rows === undefined) return null;
  const row = rows[locator.index];
  if (row === undefined || !Object.hasOwn(row, locator.field)) return null;
  // The label rule for JSON is the PROPERTY KEY: the key as the stored object carries it.
  const key = Object.keys(row).find((candidate) => candidate === locator.field);
  if (key === undefined) return null;
  return { value: row[locator.field] as JsonValue, label: key };
}

/* ----------------------------------------------------------------- the verdict --- */

/**
 * Why one attribute did not corroborate. Closed, and never a value or a message.
 *
 * The stored diagnostic is coarser than this on purpose (see
 * `snapshotCorroborationDiagnostic`): `run_observation_check.diagnostic` is a closed
 * vocabulary the Gate reads, while these names exist so a failure can be tested and read
 * for what it actually was.
 */
export const SNAPSHOT_CORROBORATION_FAILURES = [
  'substrate-unsupported',
  'snapshot-unavailable',
  'snapshot-unreadable',
  'locator-malformed',
  'locator-unresolved',
  'label-drift',
  'value-contradicted',
  'extracted-text-contradicted',
  'normalization-unauthorized',
  'identity-key-mismatch',
] as const;
export type SnapshotCorroborationFailure = (typeof SNAPSHOT_CORROBORATION_FAILURES)[number];

export interface AttributeCorroboration {
  readonly name: string;
  /** `matched`, `contradictory`, or `null` when nothing was in a position to judge it. */
  readonly corroboration: ObservationCorroboration | null;
  readonly failure: SnapshotCorroborationFailure | null;
}

export interface SnapshotCorroborationResult {
  readonly observationId: string;
  readonly outcome: ObservationCheckOutcome;
  readonly diagnostic: ObservationCheckDiagnostic | null;
  /** The identity attribute's verdict, kept apart from the declared attributes. */
  readonly identity: AttributeCorroboration | null;
  readonly attributes: readonly AttributeCorroboration[];
}

/**
 * The stored diagnostic for one failure.
 *
 * `label-drift` and an identity that does not re-read to the population record key keep
 * their own names because the Result surfaces them to a person; everything else is one
 * contradiction. "Nothing could read it" and "it read differently" are deliberately
 * different words: only the second accuses the Observation of being wrong.
 */
export function snapshotCorroborationDiagnostic(
  failure: SnapshotCorroborationFailure,
): ObservationCheckDiagnostic {
  switch (failure) {
    case 'substrate-unsupported':
      return 'corroboration-unsupported';
    case 'snapshot-unavailable':
    case 'snapshot-unreadable':
      return 'corroboration-unavailable';
    case 'label-drift':
      return 'corroboration-label-drift';
    case 'identity-key-mismatch':
      return 'identity-mismatch';
    default:
      return 'corroboration-contradictory';
  }
}

/** A failure that says nothing could be read, as opposed to one that says it read wrong. */
function unjudged(failure: SnapshotCorroborationFailure): boolean {
  return (
    failure === 'substrate-unsupported' ||
    failure === 'snapshot-unavailable' ||
    failure === 'snapshot-unreadable'
  );
}

/**
 * Is `normalizedValue` an authorized normalization of the value the snapshot holds?
 *
 * §B normalizes a date-time to UTC and retains the original beside it; compiler 1
 * authorizes no other transformation, so for everything else the normalized value IS the
 * original. Two forms are accepted and no third: the original itself, and its UTC
 * normalization. `007` therefore never normalizes to `7`, and a string is never parsed as
 * a number — the comparison is over RFC 8785 canonical bytes, which distinguish `"007"`,
 * `"7"` and `7` from one another.
 */
function authorizedNormalization(original: JsonValue, normalized: JsonValue): boolean {
  const canonical = canonicalJson(normalized);
  if (canonical === canonicalJson(original)) return true;
  if (typeof original !== 'string') return false;
  const utc = normalizeObservedAt(original);
  return utc !== null && canonical === canonicalJson(utc.observedAt);
}

/**
 * Re-read one grounded attribute and judge it.
 *
 * `matched` needs all of it: the locator parses in the substrate's grammar, it resolves to
 * a cell in the stored bytes, the re-read LABEL is the declared one, the re-read VALUE is
 * the recorded original, the grounding's extracted text is the text of that value, and the
 * recorded normalized value is an authorized normalization of it. Anything else is
 * `contradictory`, and nothing is ever repaired by preferring one side.
 */
export function corroborateAttribute(
  attribute: ObservationAttribute,
  snapshots: ReadonlyMap<string, ParsedSnapshot>,
): AttributeCorroboration {
  const fail = (failure: SnapshotCorroborationFailure): AttributeCorroboration => ({
    name: attribute.name,
    corroboration: unjudged(failure) ? null : 'contradictory',
    failure,
  });
  const grounding = attribute.grounding;
  // An attribute with no grounding was never captured (§B.1) and `required-evidence`
  // already records that. There is nothing to re-read, so there is nothing to contradict.
  if (grounding === null) return { name: attribute.name, corroboration: null, failure: null };
  const parsed = snapshots.get(grounding.evidenceId);
  if (parsed === undefined) return fail('snapshot-unavailable');
  if (!parsed.ok) return fail(parsed.failure);
  const locator = parseSnapshotLocator(grounding.locator);
  if (locator === null) return fail('locator-malformed');
  const cell = readSnapshotCell(parsed, locator);
  if (cell === null) return fail('locator-unresolved');
  if (cell.label !== grounding.label) return fail('label-drift');
  let reread: string;
  try {
    reread = canonicalJson(cell.value);
  } catch {
    // A cell with no canonical form cannot be compared with one that has one.
    return fail('value-contradicted');
  }
  let recorded: string;
  try {
    recorded = canonicalJson(attribute.originalValue);
  } catch {
    return fail('value-contradicted');
  }
  if (reread !== recorded) return fail('value-contradicted');
  if (groundedText(cell.value) !== grounding.extractedText) {
    return fail('extracted-text-contradicted');
  }
  if (!authorizedNormalization(cell.value, attribute.normalizedValue)) {
    return fail('normalization-unauthorized');
  }
  return { name: attribute.name, corroboration: 'matched', failure: null };
}

/**
 * Corroborate one Observation against the snapshots the caller froze.
 *
 * The identity is judged first and separately: §B.1 lets a declared attribute share the
 * identity's name, so a verdict list keyed by name alone would silently give one of them
 * the other's answer. For a `found = true` Observation the re-read identity must also
 * equal the normalized population record key — the half of §H identity corroboration that
 * only a re-read of the stored snapshot can decide, and the reason a record whose identity
 * does not re-read can never be Compliant.
 */
export function corroborateObservation(
  record: ObservationRecord,
  snapshots: ReadonlyMap<string, ParsedSnapshot>,
): SnapshotCorroborationResult {
  const identity =
    record.identity === null ? null : corroborateAttribute(record.identity, snapshots);
  let identityJudged = identity;
  if (
    record.found === 'true' &&
    identity !== null &&
    identity.failure === null &&
    record.identity !== null
  ) {
    const grounding = record.identity.grounding;
    const parsed = grounding === null ? undefined : snapshots.get(grounding.evidenceId);
    const locator = grounding === null ? null : parseSnapshotLocator(grounding.locator);
    const cell =
      parsed === undefined || locator === null ? null : readSnapshotCell(parsed, locator);
    // The re-read identity, normalized the way the Observation's own identity is: an
    // opaque exact string. `007` never re-reads to `7`, and a number never re-reads to
    // the string that spells it.
    if (cell === null || canonicalJson(cell.value) !== canonicalJson(record.populationRecordKey)) {
      identityJudged = {
        name: identity.name,
        corroboration: 'contradictory',
        failure: 'identity-key-mismatch',
      };
    }
  }
  const attributes = record.attributes.map((attribute) => corroborateAttribute(attribute, snapshots));
  // Deterministic precedence: the identity, then the declared attributes in their stored
  // order. The FIRST failure names the check's diagnostic, so two builds reading the same
  // bytes report the same one.
  const failed = [...(identityJudged === null ? [] : [identityJudged]), ...attributes].find(
    (entry) => entry.failure !== null,
  );
  return {
    observationId: record.observationId,
    outcome: failed === undefined ? 'PASS' : 'FAIL',
    diagnostic: failed === undefined ? null : snapshotCorroborationDiagnostic(failed.failure!),
    identity: identityJudged,
    attributes,
  };
}
