import { canonicalJson, type JsonValue } from '../canonical-json.js';
import { hmacSha256Hex, sha256Hex, utf8Bytes } from '../sha256.js';
import { COMPLIANCE_OBSERVATION_FIELDS, evaluateComplianceRecord, reduceComplianceEvaluations } from '../procedures/plan-compiler.js';
import type { ComplianceObservation, ComplianceRecordEvaluation } from '../procedures/plan-compiler.js';
import type { DraftComplianceFields } from '../procedures/compliance-draft.js';
import { isTemplateId, type TemplateId } from '../procedures/templates.js';
import { decodePopulationUtf8, parsePopulationCsv } from './population.js';
import {
  OBSERVATION_LIMITS,
  canBeCompliant,
  corroborationAllowsCompliant,
  normalizeObservationValue,
  type EvaluationValue,
  type ObservationAttribute,
  type ObservationCheckResult,
  type ObservationCorroborationState,
  type ObservationCoverage,
  type ObservationEvaluation,
  type ObservationRecord,
} from './observation.js';

/**
 * Deterministic evaluation of a corroborated Observation, and the Exception it raises
 * (Story 3.7).
 *
 * **There is exactly one rules engine and it is not here.** `evaluateComplianceRecord` in
 * `packages/domain/src/procedures/plan-compiler.ts` already implements the approval and
 * permission-pair rules, the decimal boundaries, the closed applicability grammar and the
 * conservative evidence handling, over the conditions the Procedure Version FROZE. This
 * module wires an Observation into it and maps the answer back onto §B.1's evaluation
 * shape. A second engine would agree with the first on every case anybody thought to try
 * and diverge on the first one nobody did — and the divergence would be an audit
 * conclusion.
 *
 * Everything here is pure. No clock, no store, no I/O of any kind: evaluation runs INSIDE
 * the registration transaction (`register-observations.ts`), where a network call would
 * hold a PostgreSQL transaction open across it, and it must be deterministic, because the
 * story's own acceptance criterion is that repeating it over identical Observations under
 * the same version yields identical results.
 */

/* ------------------------------------------------------- frozen reference data --- */

/** One policy entry of a versioned role-expansion Reference Source. */
export interface RoleExpansionEntry {
  readonly role: string;
  readonly permissions: readonly string[];
}

/**
 * A role expansion as the compiled `permission-pairs` rule consumes it.
 *
 * A LIST of entries, never a map keyed by role. The RoleMatrix declares `AMBIGUOUS_DUAL`
 * twice with different permissions, and merging the two would union them into
 * `CREATE_PAYMENT + RELEASE_PAYMENT` — a prohibited pair, and a confident Control Failure
 * where the contract requires Unevaluated. `evaluateRule` compares the entries' signatures
 * and refuses to expand a role two entries disagree about; that only works while they are
 * still two entries.
 *
 * `complete` is false whenever the expansion could not be read in full. `evaluateRule`
 * treats that exactly as it treats an absent expansion: `incomplete role expansion`, which
 * is Unevaluated. Nothing here ever falls through to "no prohibited pair found".
 */
export interface RoleExpansion {
  readonly complete: boolean;
  readonly entries: readonly RoleExpansionEntry[];
}

/** The expansion nobody could read. Never a pass: it is `incomplete role expansion`. */
export const NO_ROLE_EXPANSION: RoleExpansion = { complete: false, entries: [] };

/**
 * The served RoleMatrix columns, in order.
 *
 * The leading `entry` ordinal is what keeps two conflicting policy entries for one role
 * distinguishable; a flattened `role,permission` file cannot express them and no
 * downstream reader can recover the boundary (adapter extraction v1). A header that is not
 * exactly this is not a role expansion, and reading one as if it were would silently merge
 * the entries this ordinal exists to keep apart.
 */
export const ROLE_MATRIX_COLUMNS = ['entry', 'role', 'permission'] as const;

/** A stored Reference Source artifact, as the producer froze it. Bytes in, data out. */
export interface ReferenceArtifact {
  readonly bytes: Uint8Array;
  readonly mediaType: string;
}

function isRoleMatrixCsv(mediaType: string): boolean {
  return /^text\/csv(?:;\s*charset=utf-8)?$/i.test(mediaType);
}

/**
 * Read one role expansion out of the bytes a Reference Source Session Step froze.
 *
 * The same RFC 4180 parser the population and the Structural Snapshot use, so a cell means
 * one thing in this product and not two — marker line, quoting and all. Every failure is
 * `NO_ROLE_EXPANSION` rather than a partial expansion: a role expanded from half a file is
 * indistinguishable from a role with fewer permissions, and the second reads as Compliant.
 */
export function readRoleExpansion(bytes: Uint8Array): RoleExpansion {
  let rows: Record<string, JsonValue>[];
  try {
    rows = parsePopulationCsv(decodePopulationUtf8(bytes));
  } catch {
    return NO_ROLE_EXPANSION;
  }
  // The header, read off the first row's keys: `parsePopulationCsv` builds every row from
  // the header in order and has already refused a blank or duplicated one.
  const header = rows.length === 0 ? [] : Object.keys(rows[0]!);
  if (
    header.length !== ROLE_MATRIX_COLUMNS.length ||
    ROLE_MATRIX_COLUMNS.some((column, index) => header[index] !== column)
  ) {
    return NO_ROLE_EXPANSION;
  }
  // Grouped by the ordinal, in first-seen order. Two rows sharing an ordinal must name the
  // same role: an ordinal that named two roles would make the grouping a guess.
  const byOrdinal = new Map<string, { role: string; permissions: string[] }>();
  for (const row of rows) {
    const ordinal = row['entry'];
    const role = row['role'];
    const permission = row['permission'];
    if (typeof ordinal !== 'string' || ordinal === '') return NO_ROLE_EXPANSION;
    if (typeof role !== 'string' || role === '') return NO_ROLE_EXPANSION;
    if (typeof permission !== 'string' || permission === '') return NO_ROLE_EXPANSION;
    const existing = byOrdinal.get(ordinal);
    if (existing === undefined) byOrdinal.set(ordinal, { role, permissions: [permission] });
    else if (existing.role !== role) return NO_ROLE_EXPANSION;
    else existing.permissions.push(permission);
  }
  if (byOrdinal.size === 0) return NO_ROLE_EXPANSION;
  return {
    complete: true,
    entries: [...byOrdinal.values()].map((entry) => ({
      role: entry.role,
      permissions: [...entry.permissions],
    })),
  };
}

/**
 * The one role expansion of a Run, from every Reference Source it froze.
 *
 * Exactly one artifact must be readable as a role expansion. Zero is
 * `incomplete role expansion`; so is more than one, because choosing between two policy
 * files is the same ambiguity the `entry` ordinal exists to preserve, one level up.
 */
export function roleExpansionFrom(artifacts: readonly ReferenceArtifact[]): RoleExpansion {
  const expansions = artifacts
    .filter((artifact) => isRoleMatrixCsv(artifact.mediaType))
    .map((artifact) => readRoleExpansion(artifact.bytes))
    .filter((expansion) => expansion.complete);
  return expansions.length === 1 ? expansions[0]! : NO_ROLE_EXPANSION;
}

/* ------------------------------------------------------- the evaluated record --- */

/**
 * One Observation offered for evaluation, with everything the frozen rules may read.
 *
 * `populationValues` is the frozen population record this Observation covers, and it is
 * `null` when the included population does not carry EXACTLY ONE row for that key. A
 * duplicate primary key is an Evidence Quality Gate event, and there is no honest way to
 * pick between two rows that disagree: first-wins, last-wins and a union all produce a
 * confident answer to a question the data cannot answer. `null` makes the record
 * ambiguous, which is Unevaluated.
 *
 * It is a separate input rather than something read off the Observation because
 * `plan.observations` is the UNION across every Target System of the Procedure: P-3
 * declares `amount`, `currency` and `processed_time`, which live in the population and not
 * in the approvals system, so a rule that could see only the Observation could never
 * evaluate P-3 at all.
 */
export interface RecordEvaluationInput {
  readonly record: ObservationRecord;
  readonly coverage: ObservationCoverage;
  readonly corroboration: ObservationCorroborationState;
  readonly checks: readonly ObservationCheckResult[];
  readonly populationValues: Readonly<Record<string, JsonValue>> | null;
}

/** The frozen reference data the compiled rules of this Template may consult. */
export interface RecordEvaluationReference {
  readonly roleExpansion: RoleExpansion;
}

export interface RecordEvaluation {
  /** §B's fixed reduction over the per-condition values: Exception, Unevaluated, Compliant. */
  readonly value: EvaluationValue;
  readonly evaluations: readonly ObservationEvaluation[];
}

/**
 * Why an evaluation this evaluator produced could not be Compliant.
 *
 * The floor beneath the evidence facts, and it exists because a COMPLIANT evaluation on a
 * record that is not `COVERED`, or one its own stored snapshot contradicts, is REFUSED by
 * `registerObservations` and by the `run_observation_evaluation` composite foreign key —
 * which would roll back the whole batch, the Work Item and the Step Execution with it. A
 * mistake in the evidence facts must degrade an outcome, never destroy a Run.
 */
export const UNSUPPORTABLE_COMPLIANT = 'record coverage or corroboration cannot support COMPLIANT';

/**
 * A condition whose frozen applicability predicate said it does not apply to this record.
 *
 * Compiler 1 gives such a condition the value `COMPLIANT` — a pure condition never changes
 * what is in the population, and a record cannot fail a rule that was not about it — and
 * that is the value stored, because the record's own evaluation is the compiler's fixed
 * reduction over these values and a second reduction here would be a second rules engine.
 *
 * The reason is recorded so that the §H count of APPLICABLE conditions (Story 3.8) can
 * exclude it. A row that says only `COMPLIANT` is indistinguishable from a rule that was
 * evaluated and passed, and counting the two together would report coverage nobody has.
 */
export const CONDITION_NOT_APPLICABLE = 'condition does not apply to this record';

/**
 * The values the frozen rules are evaluated over.
 *
 * Only the Template's DECLARED Observation fields, and nothing else. The population rows
 * and the extraction rows both carry columns no condition names — P-2's `username` and
 * P-3's `memo` are the seeded prompt-like strings — and a value no rule can read is a value
 * no rule can be steered by. They are Evidence, they are frozen, they are served verbatim,
 * and they do not enter this map.
 *
 * The population supplies the base and the Observation's own grounded attributes win: the
 * Target System's reading of a field is what was observed. `found` is the three-valued
 * §B.1 state narrowed to the boolean the compiled grammar reads, and an `ambiguous` match
 * has no boolean reading at all — it is left absent, so a condition that names `found` is
 * `missing or invalid Observation field found` rather than quietly false.
 */
export function observationRuleValues(
  templateId: TemplateId,
  record: ObservationRecord,
  populationValues: Readonly<Record<string, JsonValue>> | null,
): Readonly<Record<string, unknown>> {
  const declared = COMPLIANCE_OBSERVATION_FIELDS[templateId];
  const values: Record<string, unknown> = {};
  if (populationValues !== null) {
    for (const [name, valueType] of Object.entries(declared)) {
      if (name === 'found' || !Object.hasOwn(populationValues, name)) continue;
      values[name] = normalizeObservationValue(valueType, populationValues[name] as JsonValue);
    }
  }
  const attributes: readonly (ObservationAttribute | null)[] = [record.identity, ...record.attributes];
  for (const attribute of attributes) {
    // `Object.hasOwn`, not a bare index: the attribute name comes from a Target System's
    // response, and `MAP['constructor']` returns an inherited function rather than nothing.
    if (attribute === null || attribute.name === 'found' || !Object.hasOwn(declared, attribute.name)) continue;
    values[attribute.name] = attribute.normalizedValue;
  }
  if (record.found !== 'ambiguous') values['found'] = record.found === 'true';
  return values;
}

/**
 * The §H evidence facts one Observation carries into the frozen rules.
 *
 * This is where the per-record Gate outcome OUTRANKS the rule verdict: a record with any
 * failing per-Observation check is not `complete`, and `evaluateComplianceRecord` then
 * records every applicable condition `UNEVALUATED` — including one the rule would have
 * called an Exception. An Exception raised on a record whose identity did not corroborate
 * is a finding about a record nobody has established the identity of.
 */
export function observationEvidenceFacts(
  input: RecordEvaluationInput,
): ComplianceObservation['evidence'] {
  return {
    inspected: input.coverage === 'COVERED',
    complete: input.checks.every((check) => check.outcome === 'PASS'),
    // Either the Target System offered more than one candidate, or the population offers
    // more than one row for this key. Both are "which record is this?", unanswered.
    ambiguous: input.coverage === 'AMBIGUOUS' || input.populationValues === null,
    contradictory: input.corroboration === 'CONTRADICTORY',
    absenceProven: input.record.found === 'false' && input.coverage === 'COVERED',
  };
}

/** Join a condition's diagnostics for storage, bounded by the column that holds them. */
function diagnosticText(diagnostics: readonly string[]): string | null {
  if (diagnostics.length === 0) return null;
  const joined = diagnostics.join('; ');
  return joined.length > OBSERVATION_LIMITS.text ? joined.slice(0, OBSERVATION_LIMITS.text) : joined;
}

/**
 * Evaluate one corroborated Observation against the version's frozen compiled conditions.
 *
 * Every row this produces carries origin `RULE`, including one that records an
 * Agent-Judged condition as Unevaluated: the origin says which evaluator wrote the row,
 * and the deterministic one did. Nothing here consults a model, re-derives a condition
 * from authored prose, or reads an expectation file.
 */
export function evaluateObservationRecord(
  templateId: TemplateId,
  fields: DraftComplianceFields,
  input: RecordEvaluationInput,
  reference: RecordEvaluationReference,
): RecordEvaluation {
  const observation: ComplianceObservation = {
    values: observationRuleValues(templateId, input.record, input.populationValues),
    evidence: observationEvidenceFacts(input),
    roleMatrix: reference.roleExpansion,
  };
  const result: ComplianceRecordEvaluation = evaluateComplianceRecord(templateId, fields, observation);
  const compliantAllowed =
    canBeCompliant(input.coverage) && corroborationAllowsCompliant(input.corroboration);
  const evidenceIds = [...input.record.evidenceIds];
  const evaluations = result.conditions.map((condition): ObservationEvaluation => {
    const supportable = condition.value !== 'COMPLIANT' || compliantAllowed;
    const reasons = condition.applicable === false
      ? [...condition.diagnostics, CONDITION_NOT_APPLICABLE]
      : [...condition.diagnostics];
    return {
      conditionId: condition.conditionId,
      origin: 'RULE',
      value: supportable ? condition.value : 'UNEVALUATED',
      // §B.1: `confirmation` and `confidence` belong to an Agent-Judged evaluation and to
      // no other. This one is never Agent-Judged.
      confirmation: null,
      confidence: null,
      // Deliberately none. A rule's reason is its diagnostics; a free-text rationale is
      // where retrieved content gets quoted back as the reason for an outcome, which is
      // exactly what the seeded prompt-like memos are there to catch.
      rationale: null,
      diagnostic: supportable
        ? diagnosticText(reasons)
        : diagnosticText([...reasons, UNSUPPORTABLE_COMPLIANT]),
      evidenceIds,
    };
  });
  return {
    // The one reduction, shared with the compiler: Exception, then Unevaluated, then
    // Compliant, with an absent evaluation represented rather than filtered out.
    value: reduceComplianceEvaluations(evaluations.map((evaluation) => evaluation.value)),
    evaluations,
  };
}

/* --------------------------------------------------------------- the Exception --- */

/**
 * The stable identity of one Exception.
 *
 * DERIVED from the Run and the Observation, never minted, for the reason `observationIdFor`
 * is: a redelivered batch must reach the SAME Exception or a retry raises a second finding
 * about one record. RFC 9562 §5.8 UUIDv8 over a SHA-256 of the canonical JSON of the pair
 * — two parts and not a concatenation, so `("a","bc")` and `("ab","c")` are different.
 */
export function exceptionIdFor(runId: string, observationId: string): string {
  const hash = sha256Hex(canonicalJson([runId, observationId] as unknown as JsonValue));
  const variant = ((Number.parseInt(hash[16]!, 16) & 0x3) | 0x8).toString(16);
  return (
    `${hash.slice(0, 8)}-${hash.slice(8, 12)}-8${hash.slice(13, 16)}-` +
    `${variant}${hash.slice(17, 20)}-${hash.slice(20, 32)}`
  );
}

/**
 * What an Exception fingerprint is taken over, written key by key.
 *
 * Never a spread: a spread would carry whatever a caller hung off its object into a value
 * that is stored permanently and can never be taken back out.
 *
 * The RUN is deliberately absent. A fingerprint identifies the FINDING — this Procedure,
 * this Template, this Target System, this population record, these conditions — so the same
 * control failure recurring next month fingerprints the same and can be recognised as the
 * same finding. The Run is on the row beside it, where it belongs.
 */
export interface ExceptionFingerprintEnvelope {
  readonly procedureId: string;
  readonly templateId: string;
  readonly targetSystem: string;
  readonly populationRecordKey: string;
  readonly conditionIds: readonly string[];
}

/** The exact bytes a fingerprint is computed over. Exposed so a vector can pin them. */
export function exceptionFingerprintText(envelope: ExceptionFingerprintEnvelope): string {
  return canonicalJson({
    condition_ids: [...envelope.conditionIds],
    population_record_key: envelope.populationRecordKey,
    procedure_id: envelope.procedureId,
    target_system: envelope.targetSystem,
    template_id: envelope.templateId,
  });
}

/**
 * HMAC-SHA-256 over the RFC 8785 canonical JSON of the envelope, lower-case hex.
 *
 * Keyed, not plain: an unkeyed digest over a small closed vocabulary of record keys and
 * condition ids is a dictionary anybody holding the fingerprints can invert, and a
 * fingerprint is written into an immutable row that can never be taken back out. The key
 * id is retained beside every fingerprint so a rotated key still says which key produced
 * which value.
 */
export function exceptionFingerprint(key: Uint8Array, envelope: ExceptionFingerprintEnvelope): string {
  return hmacSha256Hex(key, utf8Bytes(exceptionFingerprintText(envelope)));
}

/** One permanent Exception, as it is written. Never updated and never deleted alone. */
export interface RaisedException {
  readonly exceptionId: string;
  readonly runId: string;
  readonly observationId: string;
  readonly workItemId: string;
  readonly targetSystem: string;
  readonly populationRecordKey: string;
  /** The conditions that evaluated `EXCEPTION`, in the version's frozen order. */
  readonly conditionIds: readonly string[];
  /** Every violating pair, and every other reason the rules gave, verbatim. */
  readonly diagnostics: readonly string[];
  readonly fingerprint: string;
  readonly fingerprintKeyId: string;
  readonly raisedAt: string;
}

export function isRaisedException(value: unknown): value is RaisedException {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  const strings = (entry: unknown): boolean =>
    Array.isArray(entry) &&
    entry.length > 0 &&
    entry.length <= OBSERVATION_LIMITS.attributes &&
    entry.every((item) => typeof item === 'string' && item.length > 0 && item.length <= OBSERVATION_LIMITS.value);
  return (
    typeof candidate['exceptionId'] === 'string' &&
    typeof candidate['runId'] === 'string' &&
    typeof candidate['observationId'] === 'string' &&
    typeof candidate['workItemId'] === 'string' &&
    typeof candidate['targetSystem'] === 'string' &&
    typeof candidate['populationRecordKey'] === 'string' &&
    strings(candidate['conditionIds']) &&
    // Bounded here as well as by the generation-23 CHECK, so a caller gets a named refusal
    // rather than a constraint violation — the `coverage-conflict` discipline.
    Array.isArray(candidate['diagnostics']) &&
    candidate['diagnostics'].length <= OBSERVATION_LIMITS.attributes &&
    (candidate['diagnostics'] as unknown[]).every(
      (item) => typeof item === 'string' && item.length <= OBSERVATION_LIMITS.value,
    ) &&
    typeof candidate['fingerprint'] === 'string' &&
    /^[0-9a-f]{64}$/.test(candidate['fingerprint']) &&
    typeof candidate['fingerprintKeyId'] === 'string' &&
    candidate['fingerprintKeyId'].length > 0 &&
    candidate['fingerprintKeyId'].length <= OBSERVATION_LIMITS.text &&
    typeof candidate['raisedAt'] === 'string'
  );
}

/** A Template id, validated, or `null` for a plan this build has no rules for. */
export function evaluableTemplateId(value: unknown): TemplateId | null {
  return isTemplateId(value) ? value : null;
}
