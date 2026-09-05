import { canonicalJson, type JsonValue } from '../canonical-json.js';
import { sha256Hex } from '../sha256.js';

/**
 * The versioned Observation wire schema (addendum §B.1), and its validator.
 *
 * One shape for every Observation, whatever produced it: an adapter extraction now, an
 * agent read later. Story 3.4 adds batched registration, the per-Observation Gate checks
 * and the `found = false` completeness rules; the SHAPE lands once, here, so those
 * stories extend it rather than inventing a second one beside it.
 *
 * `found` is a three-valued string, not a boolean plus a flag: §B.1's vocabulary is
 * `true` / `false` / `ambiguous`, and an `ambiguous` match is not a `found` boolean with
 * something else set. Written as a string it is storable, pinnable by a CHECK constraint
 * and impossible to read as "falsy".
 *
 * `corroboration` is set by the Evidence Quality Gate at registration (Story 3.6 reads
 * the stored Structural Snapshot). Until then it is `null`, which means "not yet judged"
 * and never "matched".
 */

export const OBSERVATION_SCHEMA_VERSION = 1 as const;

export const OBSERVATION_FOUND_VALUES = ['true', 'false', 'ambiguous'] as const;
export type ObservationFound = (typeof OBSERVATION_FOUND_VALUES)[number];

export const OBSERVATION_CAPTURE_METHODS = ['agent', 'adapter'] as const;
export type ObservationCaptureMethod = (typeof OBSERVATION_CAPTURE_METHODS)[number];

export const OBSERVATION_MATCH_ORIGINS = ['platform', 'human-matched'] as const;
export type ObservationMatchOrigin = (typeof OBSERVATION_MATCH_ORIGINS)[number];

export const OBSERVATION_CORROBORATIONS = ['matched', 'contradictory', 'model-read'] as const;
export type ObservationCorroboration = (typeof OBSERVATION_CORROBORATIONS)[number];

/** Bounds applied before anything else looks at a value. */
export const OBSERVATION_LIMITS = {
  /** Identifiers, locators, labels. */
  text: 1024,
  /** One captured value, original or normalized. */
  value: 8192,
  /** Declared attributes on one Observation. */
  attributes: 64,
  /** Evidence items one Observation may link. */
  evidence: 16,
  /**
   * Observations one registration batch may carry.
   *
   * Equal to `POPULATION_LIMITS.rows` on purpose: one adapter Work Item produces at most
   * one Observation per included population record, so this is the population's own cap
   * said where the batch is bounded rather than left implied. It is a REFUSAL, not a
   * truncation — a batch this build cannot register atomically must not be registered
   * half way. The cost is stated: the registration event carries every Observation's
   * digest, so a batch at the cap writes a large immutable payload.
   */
  batch: 100000,
} as const;

/**
 * Where an attribute value was read from, inside a stored Evidence artifact.
 *
 * `evidenceId` names a Structural Snapshot or a file/extraction Evidence item — never a
 * screenshot or a recording (§B.1). `locator` is a path within it, and it is the path
 * Story 3.6 re-reads; `label` is the field's name as the Target System presents it.
 */
export interface ObservationGrounding {
  readonly evidenceId: string;
  readonly locator: string;
  readonly label: string;
  readonly extractedText: string;
}

export interface ObservationAttribute {
  readonly name: string;
  /** Exactly what the Target System presented. Never trimmed, folded or reformatted. */
  readonly originalValue: JsonValue;
  /** The §B normalization of it. For an opaque identifier this IS the original string. */
  readonly normalizedValue: JsonValue;
  readonly grounding: ObservationGrounding | null;
  readonly corroboration: ObservationCorroboration | null;
}

export interface ObservationRecord {
  readonly schemaVersion: typeof OBSERVATION_SCHEMA_VERSION;
  readonly observationId: string;
  readonly workItemId: string;
  readonly populationRecordKey: string;
  readonly targetSystem: string;
  readonly found: ObservationFound;
  /** UTC instant, ISO 8601 with a `Z` offset. */
  readonly observedAt: string;
  readonly stepExecutionId: string;
  readonly captureMethod: ObservationCaptureMethod;
  readonly matchOrigin: ObservationMatchOrigin;
  /** The grounded attribute holding the matching key as the Target System displays it. */
  readonly identity: ObservationAttribute | null;
  readonly attributes: readonly ObservationAttribute[];
  readonly evidenceIds: readonly string[];
}

const OBSERVATION_KEYS = [
  'schemaVersion', 'observationId', 'workItemId', 'populationRecordKey', 'targetSystem', 'found',
  'observedAt', 'stepExecutionId', 'captureMethod', 'matchOrigin', 'identity', 'attributes', 'evidenceIds',
] as const satisfies readonly (keyof ObservationRecord)[];

const GROUNDING_KEYS = ['evidenceId', 'locator', 'label', 'extractedText'] as const;
const ATTRIBUTE_KEYS = ['name', 'originalValue', 'normalizedValue', 'grounding', 'corroboration'] as const;

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}

function text(value: unknown, limit: number): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= limit;
}

/** A storable, canonicalizable captured value. `canonicalJson` refuses a lone surrogate
 * and a NUL, both of which have no canonical form and no storable form. */
function storableValue(value: unknown): value is JsonValue {
  try {
    return canonicalJson(value as JsonValue).length <= OBSERVATION_LIMITS.value;
  } catch {
    return false;
  }
}

/** ISO 8601 in UTC, to millisecond precision, with a real calendar date behind it. */
export function isObservationInstant(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(value)) return false;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && new Date(parsed).toISOString().slice(0, 19) === value.slice(0, 19);
}

export function isObservationGrounding(value: unknown): value is ObservationGrounding {
  if (!object(value) || !exactKeys(value, GROUNDING_KEYS)) return false;
  return (
    text(value['evidenceId'], OBSERVATION_LIMITS.text) &&
    text(value['locator'], OBSERVATION_LIMITS.text) &&
    text(value['label'], OBSERVATION_LIMITS.text) &&
    typeof value['extractedText'] === 'string' &&
    value['extractedText'].length <= OBSERVATION_LIMITS.value &&
    storableValue(value['extractedText'])
  );
}

export function isObservationAttribute(value: unknown): value is ObservationAttribute {
  if (!object(value) || !exactKeys(value, ATTRIBUTE_KEYS)) return false;
  const corroboration = value['corroboration'];
  return (
    text(value['name'], OBSERVATION_LIMITS.text) &&
    storableValue(value['originalValue']) &&
    storableValue(value['normalizedValue']) &&
    (value['grounding'] === null || isObservationGrounding(value['grounding'])) &&
    (corroboration === null ||
      (typeof corroboration === 'string' &&
        (OBSERVATION_CORROBORATIONS as readonly string[]).includes(corroboration)))
  );
}

/**
 * The whole schema, structurally.
 *
 * §B.1's one substantive cross-field rule is enforced here: a grounded identity
 * attribute is REQUIRED when `found = true`, and must be absent otherwise — an
 * `ambiguous` or absent Observation that carried an identity would be asserting the
 * match it exists to say did not resolve.
 */
export function isObservationRecord(value: unknown): value is ObservationRecord {
  if (!object(value) || !exactKeys(value, OBSERVATION_KEYS)) return false;
  const found = value['found'];
  if (value['schemaVersion'] !== OBSERVATION_SCHEMA_VERSION) return false;
  if (!text(value['observationId'], OBSERVATION_LIMITS.text)) return false;
  if (!text(value['workItemId'], OBSERVATION_LIMITS.text)) return false;
  if (!text(value['populationRecordKey'], OBSERVATION_LIMITS.text)) return false;
  if (!text(value['targetSystem'], OBSERVATION_LIMITS.text)) return false;
  if (typeof found !== 'string' || !(OBSERVATION_FOUND_VALUES as readonly string[]).includes(found)) return false;
  if (!isObservationInstant(value['observedAt'])) return false;
  if (!text(value['stepExecutionId'], OBSERVATION_LIMITS.text)) return false;
  if (
    typeof value['captureMethod'] !== 'string' ||
    !(OBSERVATION_CAPTURE_METHODS as readonly string[]).includes(value['captureMethod'])
  )
    return false;
  if (
    typeof value['matchOrigin'] !== 'string' ||
    !(OBSERVATION_MATCH_ORIGINS as readonly string[]).includes(value['matchOrigin'])
  )
    return false;
  const identity = value['identity'];
  if (identity !== null && !isObservationAttribute(identity)) return false;
  if (found === 'true' && (identity === null || identity.grounding === null)) return false;
  if (found !== 'true' && identity !== null) return false;
  const attributes = value['attributes'];
  if (!Array.isArray(attributes) || attributes.length > OBSERVATION_LIMITS.attributes) return false;
  if (!attributes.every(isObservationAttribute)) return false;
  const names = attributes.map((attribute) => attribute.name);
  if (new Set(names).size !== names.length) return false;
  const evidenceIds = value['evidenceIds'];
  if (!Array.isArray(evidenceIds) || evidenceIds.length > OBSERVATION_LIMITS.evidence) return false;
  if (!evidenceIds.every((id) => text(id, OBSERVATION_LIMITS.text))) return false;
  if (new Set(evidenceIds as string[]).size !== evidenceIds.length) return false;
  // Every grounding must name Evidence this Observation actually links, or the
  // Observation points at an artifact nothing recorded it as depending on.
  const linked = new Set(evidenceIds as string[]);
  const grounded = [identity, ...attributes].filter(
    (attribute): attribute is ObservationAttribute => attribute !== null && attribute.grounding !== null,
  );
  return grounded.every((attribute) => linked.has(attribute.grounding!.evidenceId));
}

/* ------------------------------------------------------------------ Story 3.4 --- */

/**
 * The registration contract: the digest, the coverage state, the honest-absence rule and
 * the per-Observation checks (Story 3.4).
 *
 * Everything below is pure. It decides what a registered Observation MEANS; the one
 * transactional write that stores it is `registerObservations` in the application layer,
 * and every producer goes through that one seam.
 */

/**
 * The stable identity of one Observation.
 *
 * DERIVED, not minted. `run_observation` is unique on `(work_item_id,
 * population_record_key)`, so a redelivered batch must produce the SAME Observation or
 * the row that survives and the row the batch describes are two different things: the
 * digest in the second event would name a record nobody stored, and the per-Observation
 * checks and evaluations — both keyed by `observation_id` — would be orphans pointing at
 * an id that exists nowhere. A freshly minted UUIDv7 makes redelivery look like tampering.
 *
 * RFC 9562 §5.8 UUIDv8: sixteen bytes of a SHA-256 over the canonical JSON of the pair,
 * with the version and variant nibbles set. Nothing here is a secret and nothing here is
 * random; it is a name.
 */
export function observationIdFor(workItemId: string, populationRecordKey: string): string {
  const hash = sha256Hex(canonicalJson([workItemId, populationRecordKey] as unknown as JsonValue));
  const variant = ((Number.parseInt(hash[16]!, 16) & 0x3) | 0x8).toString(16);
  return (
    `${hash.slice(0, 8)}-${hash.slice(8, 12)}-8${hash.slice(13, 16)}-` +
    `${variant}${hash.slice(17, 20)}-${hash.slice(20, 32)}`
  );
}

/**
 * The exact bytes an Observation digest is taken over.
 *
 * Written key by key, never a spread. A spread would carry whatever a caller happened to
 * hang off its object into a value the audit chain freezes — the `snapshotFromRegistration`
 * lesson, one layer along. The projection is EXACTLY the thirteen wire keys of §B.1 and
 * nothing else: no attempt counter, no lease, no revision, no row version. Those change
 * for operational reasons, and a digest that moved with them would make an untouched row
 * look tampered with, which is the opposite of what this digest is for.
 */
export function observationDigestEnvelope(record: ObservationRecord): JsonValue {
  const attribute = (value: ObservationAttribute): JsonValue => ({
    corroboration: value.corroboration,
    grounding:
      value.grounding === null
        ? null
        : {
            evidence_id: value.grounding.evidenceId,
            extracted_text: value.grounding.extractedText,
            label: value.grounding.label,
            locator: value.grounding.locator,
          },
    name: value.name,
    normalized_value: value.normalizedValue,
    original_value: value.originalValue,
  });
  return {
    attributes: record.attributes.map(attribute),
    capture_method: record.captureMethod,
    evidence_ids: [...record.evidenceIds],
    found: record.found,
    identity: record.identity === null ? null : attribute(record.identity),
    match_origin: record.matchOrigin,
    observation_id: record.observationId,
    observed_at: record.observedAt,
    population_record_key: record.populationRecordKey,
    schema_version: record.schemaVersion,
    step_execution_id: record.stepExecutionId,
    target_system: record.targetSystem,
    work_item_id: record.workItemId,
  };
}

/** The RFC 8785 text that is hashed. Exposed so a fixture can pin bytes, not only a digest. */
export function observationCanonicalText(record: ObservationRecord): string {
  return canonicalJson(observationDigestEnvelope(record));
}

/**
 * SHA-256 over the RFC 8785 canonical JSON of the wire record, lower-case hex.
 *
 * The shared `canonical-json.ts` — the same serializer the audit chain, the registration
 * digest and the binding digest use. A second canonicalizer would agree on every value
 * anybody thought to try and diverge on the first one nobody did.
 */
export function observationDigest(record: ObservationRecord): string {
  return sha256Hex(observationCanonicalText(record));
}

/**
 * One digest over a whole registered batch, in registration order.
 *
 * The per-row digest detects an edit to a row; this detects an edit to a stored DIGEST,
 * a removed row or a reordered batch — none of which a per-row digest can see, because
 * each row would still agree with itself.
 */
export function observationBatchDigest(digests: readonly string[]): string {
  return sha256Hex(canonicalJson([...digests] as unknown as JsonValue));
}

/* ------------------------------------------------------------------- coverage --- */

/**
 * What a registered Observation says about the record it covers (§H per-record coverage).
 *
 * `COVERED` — the record was looked at and the answer is usable: a resolved match, or an
 * absence that proved it looked.
 * `UNINSPECTED` — `found = false` that could not prove it looked. NEVER Compliant.
 * `AMBIGUOUS` — more than one candidate. The record is Unevaluated (§B), and §H's
 * per-record coverage check counts only `found ∈ {true, false}`, so calling this covered
 * would be a lie in exactly the place the Gate reads.
 */
export const OBSERVATION_COVERAGE_VALUES = ['COVERED', 'UNINSPECTED', 'AMBIGUOUS'] as const;
export type ObservationCoverage = (typeof OBSERVATION_COVERAGE_VALUES)[number];

export function isObservationCoverage(value: unknown): value is ObservationCoverage {
  return typeof value === 'string' && (OBSERVATION_COVERAGE_VALUES as readonly string[]).includes(value);
}

/** Only a covered record can be Compliant (§H, and the `run_observation_evaluation` FK). */
export function canBeCompliant(coverage: ObservationCoverage): boolean {
  return coverage === 'COVERED';
}

/* ------------------------------------------------------------- honest absence --- */

/** One search key and the value that was actually put into the search. */
export interface ObservationQueryKey {
  /** The declared search key's name, exactly as the Template froze it. */
  readonly key: string;
  /** The query value derived from the Adapter Action, never a value an agent reported. */
  readonly value: string;
}

/**
 * What makes `found = false` a finding rather than a gap (§B.1 Absence Observation).
 *
 * Three things together, and any one missing means nobody proved they looked:
 * a query key the adapter actually derived, for EVERY declared search key; an empty
 * response actually stored as Evidence; and an extraction that actually completed.
 */
export interface ObservationAbsenceProof {
  /** One entry per declared search key. Order is not significant; the key set is. */
  readonly queryKeys: readonly ObservationQueryKey[];
  /** The Evidence item holding the empty result. Must be linked AND registered. */
  readonly emptyResultEvidenceId: string;
  /** The extraction consumed every declared page, row and result without gaps or loops. */
  readonly extractionComplete: boolean;
}

export function isObservationQueryKey(value: unknown): value is ObservationQueryKey {
  return (
    object(value) &&
    exactKeys(value, ['key', 'value']) &&
    text(value['key'], OBSERVATION_LIMITS.text) &&
    typeof value['value'] === 'string' &&
    value['value'].length <= OBSERVATION_LIMITS.value
  );
}

export function isObservationAbsenceProof(value: unknown): value is ObservationAbsenceProof {
  if (!object(value) || !exactKeys(value, ['queryKeys', 'emptyResultEvidenceId', 'extractionComplete'])) {
    return false;
  }
  const keys = value['queryKeys'];
  return (
    Array.isArray(keys) &&
    keys.length > 0 &&
    keys.length <= OBSERVATION_LIMITS.attributes &&
    keys.every(isObservationQueryKey) &&
    new Set(keys.map((entry: ObservationQueryKey) => entry.key)).size === keys.length &&
    text(value['emptyResultEvidenceId'], OBSERVATION_LIMITS.text) &&
    typeof value['extractionComplete'] === 'boolean'
  );
}

/** Why an absence could not be believed. A closed vocabulary; never a value or a message. */
export const ABSENCE_FAILURES = [
  'absence-proof-missing',
  'query-key-missing',
  'query-key-mismatch',
  'empty-result-unlinked',
  'empty-result-unregistered',
  'extraction-incomplete',
] as const;
export type AbsenceFailure = (typeof ABSENCE_FAILURES)[number];

export interface AbsenceJudgement {
  readonly honest: boolean;
  readonly failure: AbsenceFailure | null;
}

/**
 * Judge one `found = false` Observation.
 *
 * `expected` is the declared search keys with the POPULATION record's normalized value
 * for each, supplied by the caller from the population row. `proof.queryKeys` is what the
 * Adapter Action actually searched for. Comparing the two is the whole check: a Template
 * declaring two search keys (P-1 declares `employee_id` and `full_name`) is not proven
 * absent by an adapter that searched one of them, and the record stays `UNINSPECTED` —
 * which is the safe direction.
 *
 * Values are compared as exact opaque strings. §B's matching rule is exact normalized
 * identifiers; no trimming, case folding or numeric parsing is authorized anywhere.
 */
export function judgeAbsence(input: {
  readonly proof: ObservationAbsenceProof | null;
  readonly expected: readonly ObservationQueryKey[];
  readonly linkedEvidenceIds: readonly string[];
  readonly registeredEvidenceIds: readonly string[];
}): AbsenceJudgement {
  const fail = (failure: AbsenceFailure): AbsenceJudgement => ({ honest: false, failure });
  const proof = input.proof;
  if (proof === null || !isObservationAbsenceProof(proof)) return fail('absence-proof-missing');
  if (input.expected.length === 0) return fail('query-key-missing');
  const searched = new Map(proof.queryKeys.map((entry) => [entry.key, entry.value]));
  for (const entry of input.expected) {
    if (!searched.has(entry.key)) return fail('query-key-missing');
    if (searched.get(entry.key) !== entry.value) return fail('query-key-mismatch');
  }
  // A key the adapter searched that the Template never declared is not a reason to
  // disbelieve the absence, but a MISSING declared key is; the loop above is the rule.
  if (!input.linkedEvidenceIds.includes(proof.emptyResultEvidenceId)) return fail('empty-result-unlinked');
  if (!input.registeredEvidenceIds.includes(proof.emptyResultEvidenceId)) {
    return fail('empty-result-unregistered');
  }
  if (!proof.extractionComplete) return fail('extraction-incomplete');
  return { honest: true, failure: null };
}

/** Convenience over `judgeAbsence` for a caller that only needs the verdict. */
export function isHonestAbsence(input: {
  readonly proof: ObservationAbsenceProof | null;
  readonly expected: readonly ObservationQueryKey[];
  readonly linkedEvidenceIds: readonly string[];
  readonly registeredEvidenceIds: readonly string[];
}): boolean {
  return judgeAbsence(input).honest;
}

/* ----------------------------------------------------- per-Observation checks --- */

/**
 * The §H checks one Observation can be judged by on its own, as a closed vocabulary.
 *
 * The whole vocabulary lands at once, the way the `procedure_version.state` CHECK carried
 * the whole §E vocabulary from its first commit: a table that grows one row per story ends
 * up not being a table. Story 3.4 decides the first five; `observation-corroboration` is
 * written only by the Story 3.6 seam, because only a re-read of the stored Structural
 * Snapshot can decide it and this story must not pretend to.
 */
export const OBSERVATION_CHECKS = [
  'identity-corroboration',
  'search-completeness',
  'ambiguous-match',
  'required-evidence',
  'freshness',
  'observation-corroboration',
] as const;
export type ObservationCheckName = (typeof OBSERVATION_CHECKS)[number];

export const OBSERVATION_CHECK_OUTCOMES = ['PASS', 'FAIL'] as const;
export type ObservationCheckOutcome = (typeof OBSERVATION_CHECK_OUTCOMES)[number];

/** Closed diagnostics. Never an error message, never a URL, never a captured value. */
export const OBSERVATION_CHECK_DIAGNOSTICS = [
  ...ABSENCE_FAILURES,
  'identity-ungrounded',
  'identity-mismatch',
  'ambiguous-match',
  'attribute-ungrounded',
  'evidence-unregistered',
  'capture-before-run',
  'capture-after-registration',
  'grounding-unlinked',
  'corroboration-contradictory',
] as const;
export type ObservationCheckDiagnostic = (typeof OBSERVATION_CHECK_DIAGNOSTICS)[number];

export interface ObservationCheckResult {
  readonly check: ObservationCheckName;
  readonly outcome: ObservationCheckOutcome;
  readonly diagnostic: ObservationCheckDiagnostic | null;
}

export function isObservationCheckResult(value: unknown): value is ObservationCheckResult {
  if (!object(value) || !exactKeys(value, ['check', 'outcome', 'diagnostic'])) return false;
  const diagnostic = value['diagnostic'];
  return (
    typeof value['check'] === 'string' &&
    (OBSERVATION_CHECKS as readonly string[]).includes(value['check']) &&
    typeof value['outcome'] === 'string' &&
    (OBSERVATION_CHECK_OUTCOMES as readonly string[]).includes(value['outcome']) &&
    (diagnostic === null ||
      (typeof diagnostic === 'string' &&
        (OBSERVATION_CHECK_DIAGNOSTICS as readonly string[]).includes(diagnostic)))
  );
}

export interface ObservationCheckInput {
  readonly record: ObservationRecord;
  readonly absence: ObservationAbsenceProof | null;
  /** The declared search keys with the population record's normalized value for each. */
  readonly expectedQueryKeys: readonly ObservationQueryKey[];
  /** Which of the Observation's linked Evidence items are REGISTERED right now. */
  readonly registeredEvidenceIds: readonly string[];
  /** The Run's own start, from the durable checkpoint. */
  readonly runStartedAt: string;
  /** The instant registration is happening. */
  readonly registeredAt: string;
}

/**
 * Run every §H check that one Observation can answer alone, in vocabulary order.
 *
 * A failing check is RECORDED, never a refusal: an Observation that fails a check is a
 * finding the Run-level Gate (Story 3.8) turns into `INCONCLUSIVE`. Only a wire-schema
 * violation refuses, because a record that is not in the schema has no meaning to record.
 */
export function observationChecks(input: ObservationCheckInput): readonly ObservationCheckResult[] {
  const record = input.record;
  const results: ObservationCheckResult[] = [];
  const push = (
    check: ObservationCheckName,
    diagnostic: ObservationCheckDiagnostic | null,
  ): void => {
    results.push({ check, outcome: diagnostic === null ? 'PASS' : 'FAIL', diagnostic });
  };

  // §H identity corroboration, the half that is decidable without the stored snapshot:
  // the grounded identity the Target System displayed equals the population record key,
  // compared as an exact opaque string.
  if (record.found === 'true') {
    const identity = record.identity;
    push(
      'identity-corroboration',
      identity === null || identity.grounding === null
        ? 'identity-ungrounded'
        : identity.normalizedValue === record.populationRecordKey
          ? null
          : 'identity-mismatch',
    );
  }

  if (record.found === 'false') {
    const judged = judgeAbsence({
      proof: input.absence,
      expected: input.expectedQueryKeys,
      linkedEvidenceIds: record.evidenceIds,
      registeredEvidenceIds: input.registeredEvidenceIds,
    });
    push('search-completeness', judged.failure);
  }

  push('ambiguous-match', record.found === 'ambiguous' ? 'ambiguous-match' : null);

  const registered = new Set(input.registeredEvidenceIds);
  const linked = new Set(record.evidenceIds);
  // A LIST, not a map keyed by name: the identity attribute and a declared attribute can
  // legitimately share a name, and a map would silently drop one of their groundings.
  const grounded = [record.identity, ...record.attributes]
    .filter((attribute): attribute is ObservationAttribute => attribute !== null)
    .map((attribute) => attribute.grounding)
    .filter((grounding): grounding is ObservationGrounding => grounding !== null);
  // §H required Evidence, and §B.1's "an attribute without grounding is treated as not
  // captured". What this does NOT check is whether every attribute the Procedure declares
  // is present: `plan.observations` is the union across every Target System of the
  // Procedure — P-3 declares `amount` and `processed_time`, which live in the population
  // and not in the approvals system — so requiring all of them of one adapter Observation
  // would fail a correct Run. Which system supplies which field is not in the frozen plan,
  // so it is not decidable here; per-record coverage is the Run-level Gate's question.
  push(
    'required-evidence',
    record.evidenceIds.some((id) => !registered.has(id))
      ? 'evidence-unregistered'
      : grounded.some((grounding) => !linked.has(grounding.evidenceId))
        ? 'grounding-unlinked'
        : record.attributes.some((attribute) => attribute.grounding === null)
          ? 'attribute-ungrounded'
          : null,
  );

  // §H freshness: the Observation is captured DURING the Run. A capture before the Run
  // started is somebody else's reading; one after registration is a clock nobody trusts.
  const observed = Date.parse(record.observedAt);
  push(
    'freshness',
    observed < Date.parse(input.runStartedAt)
      ? 'capture-before-run'
      : observed > Date.parse(input.registeredAt)
        ? 'capture-after-registration'
        : null,
  );
  return results;
}

/**
 * The coverage state, derived from the record and its absence proof.
 *
 * Derived on every registration and stored beside the row, the way Story 2.4's compiled
 * status is: the Gate and the evaluator read one column instead of re-deriving a rule
 * each of them would have to hold a second copy of.
 */
export function observationCoverage(input: {
  readonly record: ObservationRecord;
  readonly absence: ObservationAbsenceProof | null;
  readonly expectedQueryKeys: readonly ObservationQueryKey[];
  readonly registeredEvidenceIds: readonly string[];
}): ObservationCoverage {
  if (input.record.found === 'ambiguous') return 'AMBIGUOUS';
  if (input.record.found === 'true') return 'COVERED';
  return isHonestAbsence({
    proof: input.absence,
    expected: input.expectedQueryKeys,
    linkedEvidenceIds: input.record.evidenceIds,
    registeredEvidenceIds: input.registeredEvidenceIds,
  })
    ? 'COVERED'
    : 'UNINSPECTED';
}

/* --------------------------------------------------- per-condition evaluation --- */

/**
 * §B.1's per-condition evaluation, as data.
 *
 * Story 3.4 owns the SHAPE and the transaction; Story 3.7 owns the deterministic
 * evaluator that produces one. `UNEVALUATED` is a VALUE, never an origin: an Unevaluated
 * evaluation still records the origin that produced it.
 */
export const EVALUATION_ORIGINS = ['RULE', 'AGENT_JUDGED', 'HUMAN'] as const;
export type EvaluationOrigin = (typeof EVALUATION_ORIGINS)[number];

export const EVALUATION_VALUES = ['COMPLIANT', 'EXCEPTION', 'UNEVALUATED'] as const;
export type EvaluationValue = (typeof EVALUATION_VALUES)[number];

export const EVALUATION_CONFIRMATIONS = ['pending', 'confirmed', 'rejected'] as const;
export type EvaluationConfirmation = (typeof EVALUATION_CONFIRMATIONS)[number];

/** A decimal in [0,1], to six places. `1.0000001` and `-0` have no reading here. */
const EVALUATION_CONFIDENCE_PATTERN = /^(?:0(?:\.\d{1,6})?|1(?:\.0{1,6})?)$/;

export interface ObservationEvaluation {
  readonly conditionId: string;
  readonly origin: EvaluationOrigin;
  readonly value: EvaluationValue;
  /** Agent-Judged only. */
  readonly confirmation: EvaluationConfirmation | null;
  /**
   * Agent-Judged only: a DECIMAL STRING in [0,1], never a binary float.
   *
   * It is compared against the Procedure Version's frozen `agentJudgedThreshold`, which
   * Story 2.4 stores as a decimal string for exactly this reason. Two representations of
   * one quantity is one representation too many.
   */
  readonly confidence: string | null;
  readonly rationale: string | null;
  readonly diagnostic: string | null;
  readonly evidenceIds: readonly string[];
}

const EVALUATION_KEYS = [
  'conditionId', 'origin', 'value', 'confirmation', 'confidence', 'rationale', 'diagnostic', 'evidenceIds',
] as const satisfies readonly (keyof ObservationEvaluation)[];

/**
 * The whole evaluation shape, structurally, with §B.1's two cross-field rules:
 * `confirmation` and `confidence` belong to an Agent-Judged evaluation and to no other.
 */
export function isObservationEvaluation(value: unknown): value is ObservationEvaluation {
  if (!object(value) || !exactKeys(value, EVALUATION_KEYS)) return false;
  const origin = value['origin'];
  const confirmation = value['confirmation'];
  const confidence = value['confidence'];
  const rationale = value['rationale'];
  const diagnostic = value['diagnostic'];
  const evidenceIds = value['evidenceIds'];
  if (!text(value['conditionId'], OBSERVATION_LIMITS.text)) return false;
  if (typeof origin !== 'string' || !(EVALUATION_ORIGINS as readonly string[]).includes(origin)) return false;
  if (typeof value['value'] !== 'string' || !(EVALUATION_VALUES as readonly string[]).includes(value['value'])) {
    return false;
  }
  if (
    confirmation !== null &&
    (origin !== 'AGENT_JUDGED' ||
      typeof confirmation !== 'string' ||
      !(EVALUATION_CONFIRMATIONS as readonly string[]).includes(confirmation))
  ) {
    return false;
  }
  if (
    confidence !== null &&
    (origin !== 'AGENT_JUDGED' ||
      typeof confidence !== 'string' ||
      !EVALUATION_CONFIDENCE_PATTERN.test(confidence))
  ) {
    return false;
  }
  if (rationale !== null && !text(rationale, OBSERVATION_LIMITS.value)) return false;
  if (diagnostic !== null && !text(diagnostic, OBSERVATION_LIMITS.text)) return false;
  if (!Array.isArray(evidenceIds) || evidenceIds.length > OBSERVATION_LIMITS.evidence) return false;
  return (
    evidenceIds.every((id) => text(id, OBSERVATION_LIMITS.text)) &&
    new Set(evidenceIds as string[]).size === evidenceIds.length
  );
}

/* ------------------------------------------------------- capture-time offsets --- */

/**
 * §B: every timestamp is normalized to UTC and the original offset is retained.
 *
 * Returns the UTC instant and the source text VERBATIM, or `null` when the value is not
 * an ISO 8601 instant with a real calendar date behind it. The wire record's `observedAt`
 * is the normalized half; the source half is retained beside the stored row, so a capture
 * time is never silently shifted — the instant is provably the same one.
 */
export function normalizeObservedAt(
  value: unknown,
): { readonly observedAt: string; readonly source: string } | null {
  if (typeof value !== 'string') return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?(Z|[+-]\d{2}:\d{2})$/.exec(value);
  if (match === null) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  const fraction = match[7];
  const zone = match[8]!;
  const milliseconds = fraction === undefined ? 0 : Number.parseInt(fraction.padEnd(3, '0'), 10);
  // `setUTCFullYear` rather than `Date.UTC`, which maps a two-digit year into the 1900s,
  // and rather than `Date.parse`, which is where the trap is: V8 ROLLS OVER an impossible
  // calendar date instead of refusing it, so `2026-02-30T00:00:00Z` parses happily to
  // 2026-03-02 — a capture time silently shifted by two days by the one function whose
  // whole promise is that it never shifts one. The fields are re-rendered and compared.
  const rendered = new Date(0);
  rendered.setUTCFullYear(year, month - 1, day);
  rendered.setUTCHours(hour, minute, second, milliseconds);
  if (
    rendered.getUTCFullYear() !== year ||
    rendered.getUTCMonth() !== month - 1 ||
    rendered.getUTCDate() !== day ||
    rendered.getUTCHours() !== hour ||
    rendered.getUTCMinutes() !== minute ||
    rendered.getUTCSeconds() !== second
  ) {
    return null;
  }
  let offsetMinutes = 0;
  if (zone !== 'Z') {
    const hours = Number(zone.slice(1, 3));
    const minutes = Number(zone.slice(4, 6));
    if (hours > 23 || minutes > 59) return null;
    offsetMinutes = (zone.startsWith('-') ? -1 : 1) * (hours * 60 + minutes);
  }
  const instant = rendered.getTime() - offsetMinutes * 60_000;
  if (!Number.isFinite(instant)) return null;
  const observedAt = new Date(instant).toISOString();
  return isObservationInstant(observedAt) ? { observedAt, source: value } : null;
}
