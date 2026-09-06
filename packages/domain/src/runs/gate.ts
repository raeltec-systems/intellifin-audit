import { canonicalJson, type JsonValue } from '../canonical-json.js';
import { COMPLIANCE_OBSERVATION_FIELDS } from '../procedures/plan-compiler.js';
import { isTemplateId, type TemplateId } from '../procedures/templates.js';
import { adapterLookupColumn } from './execution.js';
import { normalizeObservedAt, type ObservationCoverage } from './observation.js';
import { populationUtcDate, type PopulationCheck, type PopulationCheckName } from './population.js';

/**
 * The Run-level Evidence Quality Gate (addendum §H), as a closed vocabulary and one pure
 * decision (Story 3.8).
 *
 * Pure. No I/O, no clock, no host types. Everything here decides MEANING; the one
 * transactional command that records the rows and takes the terminal transition is
 * `packages/application/src/runs/run-gate.ts`.
 *
 * **Every §H row is here, and the list is a transcription rather than a design.** The
 * table in the addendum has twenty rows and so does `GATE_CHECKS`, in the addendum's own
 * order.
 *
 * Six of them are DECIDED per Observation (Stories 3.4 and 3.6) and this module rolls their
 * recorded outcomes up rather than judging them a second time. Every check the population
 * stage recorded (Story 3.2) is ROUTED onto its §H row by `POPULATION_CHECK_DIAGNOSTIC`.
 * The remaining rows — coverage, condition completeness, the population field rules, access
 * and integrity — are decided here, from facts those stories captured; several rows take
 * input from more than one of the three, and a row that finds nothing from any of them is a
 * `PASS` that was actually evaluated.
 *
 * A roll-up is not a second copy: it reads the outcome that was recorded, which is what
 * "the Run-level Gate consumes those results rather than re-running them" means.
 *
 * **A row's failure outcome belongs to its DIAGNOSTIC, not to the row.** §H gives two rows
 * both outcomes — population acquisition is `RUN_FAILED` when acquisition cannot complete
 * and `INCONCLUSIVE` when the declaration is absent or contradictory, and
 * pagination/extraction completeness is the same shape — so a table keyed by row could not
 * express the addendum without losing half of it. `GATE_DIAGNOSTIC_STATE` is keyed by
 * diagnostic and is exhaustive by type.
 *
 * **`CANCELED` is not reachable from here.** It is reserved for a person cancelling a Run
 * (Story 3.10); no Gate row, no limit and no timeout produces it. `limits.ts` says the same
 * thing about the other half of this story.
 */

/* ------------------------------------------------------------------ the §H rows --- */

/**
 * Every addendum §H row, in the addendum's order.
 *
 * The WHOLE vocabulary lands at once, exactly as `procedure_version.state` carried the
 * whole §E vocabulary from its first commit and `OBSERVATION_CHECKS` carried all six of
 * its rows before two of them had an implementation. A table that grows one row per story
 * ends up not being a table, and this one is what an auditor reads to know the Run was
 * judged completely.
 */
export const GATE_CHECKS = [
  'workspace-access',
  'population-acquisition',
  'count-reconciliation-file',
  'count-reconciliation-inclusion',
  'empty-population',
  'per-record-coverage',
  'identity-corroboration',
  'search-completeness',
  'required-evidence',
  'observation-corroboration',
  'condition-completeness',
  'extraction-completeness',
  'schema',
  'mandatory-values',
  'duplicate-primary-keys',
  'ambiguous-match',
  'unnamed-value',
  'snapshot-freshness',
  'observation-freshness',
  'integrity',
] as const;
export type GateCheckName = (typeof GATE_CHECKS)[number];

export const GATE_OUTCOMES = ['PASS', 'FAIL'] as const;
export type GateOutcome = (typeof GATE_OUTCOMES)[number];

export function isGateCheckName(value: unknown): value is GateCheckName {
  return typeof value === 'string' && (GATE_CHECKS as readonly string[]).includes(value);
}

/**
 * Why a §H row failed. A closed vocabulary of constants: never an error message, never a
 * URL, never a captured value, never a credential reference.
 */
export const GATE_DIAGNOSTICS = [
  'session-step-failed',
  'target-access-denied',
  'acquisition-incomplete',
  'declaration-absent',
  'declaration-contradictory',
  'declared-count-mismatch',
  'declared-digest-mismatch',
  'rows-unaccounted',
  'exclusion-reason-missing',
  'population-empty',
  'record-uncovered',
  'record-uninspected',
  'record-ambiguous',
  'identity-uncorroborated',
  'absence-unproven',
  'evidence-missing',
  'observation-contradicted',
  'condition-evaluation-missing',
  'extraction-incomplete',
  'acquisition-unavailable',
  'schema-field-missing',
  'schema-field-undeclared',
  'mandatory-identifier-empty',
  'mandatory-value-missing',
  'timestamp-unparseable',
  'duplicate-primary-key',
  'ambiguous-match',
  'unnamed-value',
  'snapshot-stale',
  'snapshot-future-dated',
  'snapshot-generation-unknown',
  'observation-stale',
  'integrity-mismatch',
] as const;
export type GateDiagnostic = (typeof GATE_DIAGNOSTICS)[number];

export function isGateDiagnostic(value: unknown): value is GateDiagnostic {
  return typeof value === 'string' && (GATE_DIAGNOSTICS as readonly string[]).includes(value);
}

/** Which §H row each diagnostic belongs to. Exhaustive by type; nothing routes by string. */
export const GATE_DIAGNOSTIC_ROW: Readonly<Record<GateDiagnostic, GateCheckName>> = {
  'session-step-failed': 'workspace-access',
  'target-access-denied': 'workspace-access',
  'acquisition-incomplete': 'population-acquisition',
  'declaration-absent': 'population-acquisition',
  'declaration-contradictory': 'population-acquisition',
  'declared-count-mismatch': 'count-reconciliation-file',
  'declared-digest-mismatch': 'count-reconciliation-file',
  'rows-unaccounted': 'count-reconciliation-inclusion',
  'exclusion-reason-missing': 'count-reconciliation-inclusion',
  'population-empty': 'empty-population',
  'record-uncovered': 'per-record-coverage',
  'record-uninspected': 'per-record-coverage',
  'record-ambiguous': 'per-record-coverage',
  'identity-uncorroborated': 'identity-corroboration',
  'absence-unproven': 'search-completeness',
  'evidence-missing': 'required-evidence',
  'observation-contradicted': 'observation-corroboration',
  'condition-evaluation-missing': 'condition-completeness',
  'extraction-incomplete': 'extraction-completeness',
  'acquisition-unavailable': 'extraction-completeness',
  'schema-field-missing': 'schema',
  'schema-field-undeclared': 'schema',
  'mandatory-identifier-empty': 'mandatory-values',
  'mandatory-value-missing': 'mandatory-values',
  'timestamp-unparseable': 'mandatory-values',
  'duplicate-primary-key': 'duplicate-primary-keys',
  'ambiguous-match': 'ambiguous-match',
  'unnamed-value': 'unnamed-value',
  'snapshot-stale': 'snapshot-freshness',
  'snapshot-future-dated': 'snapshot-freshness',
  'snapshot-generation-unknown': 'snapshot-freshness',
  'observation-stale': 'observation-freshness',
  'integrity-mismatch': 'integrity',
};

/**
 * The Run state each diagnostic produces, transcribed from §H's "Failure outcome" column.
 *
 * `RUN_FAILED` only where §H says so: workspace and Target System access, an acquisition
 * that cannot complete (which is the same diagnostic on the population-acquisition and the
 * extraction-completeness row, because §H gives both rows that outcome for that cause), a
 * denied action, and an integrity mismatch found DURING the Run. Everything else is
 * `INCONCLUSIVE`: Evidence exists and is insufficient, which is a different statement from
 * "execution failed" and the whole reason §E keeps two terminal states.
 */
export const GATE_DIAGNOSTIC_STATE: Readonly<
  Record<GateDiagnostic, 'INCONCLUSIVE' | 'RUN_FAILED'>
> = {
  'session-step-failed': 'RUN_FAILED',
  'target-access-denied': 'RUN_FAILED',
  'acquisition-incomplete': 'RUN_FAILED',
  'declaration-absent': 'INCONCLUSIVE',
  'declaration-contradictory': 'INCONCLUSIVE',
  'declared-count-mismatch': 'INCONCLUSIVE',
  'declared-digest-mismatch': 'INCONCLUSIVE',
  'rows-unaccounted': 'INCONCLUSIVE',
  'exclusion-reason-missing': 'INCONCLUSIVE',
  'population-empty': 'INCONCLUSIVE',
  'record-uncovered': 'INCONCLUSIVE',
  'record-uninspected': 'INCONCLUSIVE',
  'record-ambiguous': 'INCONCLUSIVE',
  'identity-uncorroborated': 'INCONCLUSIVE',
  'absence-unproven': 'INCONCLUSIVE',
  'evidence-missing': 'INCONCLUSIVE',
  'observation-contradicted': 'INCONCLUSIVE',
  'condition-evaluation-missing': 'INCONCLUSIVE',
  'extraction-incomplete': 'INCONCLUSIVE',
  // §H gives the pagination/extraction row BOTH outcomes, exactly as it gives the
  // population-acquisition row both: partial data is `INCONCLUSIVE`, and an acquisition
  // that could not complete at all is `RUN_FAILED`. One failure genuinely lands on two
  // rows — a Session Step whose `extract-adapter` acquisition failed is both an access
  // failure and an extraction that never completed — and the addendum says so twice.
  'acquisition-unavailable': 'RUN_FAILED',
  'schema-field-missing': 'INCONCLUSIVE',
  'schema-field-undeclared': 'INCONCLUSIVE',
  'mandatory-identifier-empty': 'INCONCLUSIVE',
  'mandatory-value-missing': 'INCONCLUSIVE',
  'timestamp-unparseable': 'INCONCLUSIVE',
  'duplicate-primary-key': 'INCONCLUSIVE',
  'ambiguous-match': 'INCONCLUSIVE',
  'unnamed-value': 'INCONCLUSIVE',
  'snapshot-stale': 'INCONCLUSIVE',
  'snapshot-future-dated': 'INCONCLUSIVE',
  'snapshot-generation-unknown': 'INCONCLUSIVE',
  'observation-stale': 'INCONCLUSIVE',
  'integrity-mismatch': 'RUN_FAILED',
};

/**
 * Which §H row each recorded population check belongs to, and what it says when it fails.
 *
 * `Record<PopulationCheckName, …>` on purpose: `POPULATION_CHECK_NAMES` is a closed union
 * the reconciler is typed against, so a check added there without a §H row here does not
 * compile. This is the only place the two stories' vocabularies meet.
 */
export const POPULATION_CHECK_DIAGNOSTIC: Readonly<Record<PopulationCheckName, GateDiagnostic>> = {
  parse: 'acquisition-incomplete',
  declaration: 'declaration-absent',
  'response-contract': 'declaration-contradictory',
  generation: 'declaration-contradictory',
  'source-identity': 'declaration-contradictory',
  'declared-count': 'declared-count-mismatch',
  'declared-digest': 'declared-digest-mismatch',
  'declared-schema': 'schema-field-missing',
  'declared-period': 'snapshot-stale',
  'complete-extraction': 'extraction-incomplete',
  freshness: 'snapshot-stale',
  'complete-inclusion': 'rows-unaccounted',
  'nonempty-population': 'population-empty',
};

/**
 * Recorded population checks whose §H row this module derives from the counts instead.
 *
 * They keep their entry in `POPULATION_CHECK_DIAGNOSTIC` — the closed mapping is what
 * guarantees every recorded check has a row — but the row is decided by the arithmetic in
 * `runGateChecks`, so routing the boolean as well would double-count the same fact.
 */
const RECOMPUTED_POPULATION_CHECKS: readonly PopulationCheckName[] = ['complete-inclusion'];

/* ------------------------------------------------------------------- findings --- */

/**
 * One §H finding: what failed, and which Target System, Work Item or population record it
 * is about.
 *
 * Identities only. There is nowhere here for a value, a message or a byte of Evidence, so
 * nothing the Gate records — and the Gate's rows go into an immutable audit event — can
 * carry one.
 */
export interface GateFinding {
  readonly diagnostic: GateDiagnostic;
  readonly targetSystem: string | null;
  readonly workItemId: string | null;
  readonly record: string | null;
}

/**
 * How many affected identities one diagnostic names.
 *
 * A Run over a hundred thousand records can produce a hundred thousand findings, and the
 * Gate's rows are read back onto the Result and appended to an immutable chain. The exact
 * TOTAL is always kept; the named list is a bounded sample. A payload that grew with the
 * population would be a Run that cannot commit its own conclusion.
 */
export const GATE_AFFECTED_LIMIT = 32;

export interface GateFindingTally {
  readonly diagnostic: GateDiagnostic;
  /** Exact, never truncated. */
  readonly total: number;
  readonly targetSystems: readonly string[];
  readonly workItems: readonly string[];
  readonly records: readonly string[];
}

/** Collect an identity into a bounded, duplicate-free sample. */
function collect(into: string[], seen: Set<string>, value: string | null): void {
  if (value === null || seen.has(value)) return;
  seen.add(value);
  if (into.length < GATE_AFFECTED_LIMIT) into.push(value);
}

/**
 * Tally findings by diagnostic, streaming.
 *
 * Takes an iterable rather than an array so a producer walking a hundred thousand
 * population rows never holds a hundred thousand findings: the counts and the bounded
 * samples are all that survive the walk.
 */
export function tallyGateFindings(findings: Iterable<GateFinding>): readonly GateFindingTally[] {
  interface Accumulator {
    total: number;
    targetSystems: string[];
    workItems: string[];
    records: string[];
    seen: { targetSystems: Set<string>; workItems: Set<string>; records: Set<string> };
  }
  const byDiagnostic = new Map<GateDiagnostic, Accumulator>();
  for (const finding of findings) {
    let entry = byDiagnostic.get(finding.diagnostic);
    if (entry === undefined) {
      entry = {
        total: 0,
        targetSystems: [],
        workItems: [],
        records: [],
        seen: { targetSystems: new Set(), workItems: new Set(), records: new Set() },
      };
      byDiagnostic.set(finding.diagnostic, entry);
    }
    entry.total += 1;
    collect(entry.targetSystems, entry.seen.targetSystems, finding.targetSystem);
    collect(entry.workItems, entry.seen.workItems, finding.workItemId);
    collect(entry.records, entry.seen.records, finding.record);
  }
  // Walking the VOCABULARY rather than the map is what puts the tallies in a fixed order
  // AND what refuses a diagnostic the vocabulary does not name: this is the one place a
  // finding is built from something that is not a literal, and a name that got past it
  // would be routed by `GATE_DIAGNOSTIC_ROW['constructor']` — an inherited FUNCTION — to a
  // row key nothing matches, and would vanish with the Gate reporting a clean pass.
  return GATE_DIAGNOSTICS.flatMap((diagnostic) => {
    const entry = byDiagnostic.get(diagnostic);
    return entry === undefined
      ? []
      : [
          {
            diagnostic,
            total: entry.total,
            targetSystems: entry.targetSystems,
            workItems: entry.workItems,
            records: entry.records,
          },
        ];
  });
}

/** What the Result names for one §H row: the affected systems, Work Items and records. */
export interface GateAffected {
  readonly targetSystems: readonly string[];
  readonly workItems: readonly string[];
  readonly records: readonly string[];
  /** The exact number of findings on this row, however few identities are named. */
  readonly total: number;
}

export interface GateCheckResult {
  readonly check: GateCheckName;
  readonly outcome: GateOutcome;
  /** Deduplicated, in vocabulary order. Empty exactly when the outcome is `PASS`. */
  readonly diagnostics: readonly GateDiagnostic[];
  readonly affected: GateAffected;
}

/* -------------------------------------------------------------- §H arithmetic --- */

/** The reconciliation counts §H's inclusion-level row is judged on. */
export interface PopulationGateCounts {
  readonly rowsParsed: number;
  readonly included: number;
  readonly excluded: number;
  readonly indeterminate: number;
  /** Excluded or indeterminate rows carrying no reason at all. Ordinals, bounded. */
  readonly unexplained: readonly number[];
}

/** The three instants §H's snapshot-freshness row compares. */
export interface SnapshotFreshnessInput {
  /** The declaration's own generation time, or `null` when none was recorded. */
  readonly generatedAt: string | null;
  /** The last day of the effective period, as `YYYY-MM-DD`. */
  readonly periodTo: string;
  /** The Run's initiation instant. */
  readonly initiatedAt: string;
}

/**
 * §H, freshness — snapshot Sources: the generation time is no earlier than the end of the
 * effective period and no later than Run initiation, so the snapshot covers the period.
 *
 * Returns the diagnostic naming WHICH way it is unfit, or `null` when it is fit. Stale,
 * future-dated and unknown are three different statements and an auditor acts differently
 * on each; a single passed/failed boolean tells them none of it.
 *
 * An unreadable or absent generation time is `snapshot-generation-unknown`, which §H makes
 * `INCONCLUSIVE`. "The check was unavailable" must never be a path on which an unproven
 * snapshot passes — the Story 1.6 credential-capability lesson, one story along.
 */
export function snapshotFreshness(input: SnapshotFreshnessInput): GateDiagnostic | null {
  if (input.generatedAt === null || populationUtcDate(input.generatedAt) === null) {
    return 'snapshot-generation-unknown';
  }
  const generated = Date.parse(input.generatedAt);
  const initiated = Date.parse(input.initiatedAt);
  // The END of the period, not its start: a snapshot generated mid-period cannot cover it.
  const periodEnd = Date.parse(`${input.periodTo}T23:59:59.999Z`);
  if (!Number.isFinite(generated) || !Number.isFinite(initiated) || !Number.isFinite(periodEnd)) {
    return 'snapshot-generation-unknown';
  }
  if (generated < periodEnd) return 'snapshot-stale';
  if (generated > initiated) return 'snapshot-future-dated';
  return null;
}

/** One Observation as the coverage row reads it. */
export interface CoverageObservation {
  readonly targetSystem: string;
  readonly populationRecordKey: string;
  readonly coverage: ObservationCoverage;
  readonly workItemId: string;
}

export interface CoverageInput {
  /** The Target Systems this Run had to cover, from the FROZEN plan's classification. */
  readonly requiredTargetSystems: readonly string[];
  /** The matching key of every INCLUDED population record, in source order. */
  readonly includedRecordKeys: readonly string[];
  readonly observations: readonly CoverageObservation[];
}

/**
 * §H, per-record coverage: every population record has an Observation with
 * `found ∈ {true, false}` for every required Target System.
 *
 * `COVERED` is exactly that state and nothing else — an `AMBIGUOUS` match is not covered
 * and an absence that could not prove it looked is `UNINSPECTED` — so the arithmetic is a
 * matrix over (required Target System × included record) and each cell is covered, one of
 * the two unusable states, or missing entirely. A record whose key the extraction could
 * not use has no Observation at all, which is `record-uncovered`; inventing coverage for
 * it is exactly the lie this row exists to catch.
 */
export function coverageFindings(input: CoverageInput): readonly GateFinding[] {
  // Keyed by the CANONICAL JSON of the pair, never by a concatenation: a population record
  // key is arbitrary text up to a kilobyte, so `("reg a", "b")` and `("reg", "a b")` would
  // be one key under any separator that can appear in either half — and a coverage matrix
  // that collided two cells would report a record covered by an Observation about another
  // one. Two parts and not a concatenation, exactly as `exceptionIdFor` puts it.
  const cell = (targetSystem: string, record: string): string =>
    canonicalJson([targetSystem, record] as unknown as JsonValue);
  const observed = new Map<string, CoverageObservation>();
  for (const observation of input.observations) {
    observed.set(cell(observation.targetSystem, observation.populationRecordKey), observation);
  }
  const findings: GateFinding[] = [];
  for (const targetSystem of input.requiredTargetSystems) {
    for (const record of input.includedRecordKeys) {
      const entry = observed.get(cell(targetSystem, record));
      if (entry !== undefined && entry.coverage === 'COVERED') continue;
      findings.push({
        diagnostic:
          entry === undefined
            ? 'record-uncovered'
            : entry.coverage === 'AMBIGUOUS'
              ? 'record-ambiguous'
              : 'record-uninspected',
        targetSystem,
        workItemId: entry?.workItemId ?? null,
        record,
      });
    }
  }
  return findings;
}

/** One population row as the §H field rows read it. */
export interface PopulationGateRow {
  readonly ordinal: number;
  readonly values: Readonly<Record<string, JsonValue>>;
  readonly disposition: 'included' | 'excluded' | 'indeterminate';
}

export interface PopulationFieldInput {
  /** The FROZEN Template id. An unknown one has no declared fields and is judged on none. */
  readonly templateId: string;
  /** The binding's frozen `declared_schema`, in declared order. */
  readonly declaredSchema: readonly string[];
  /** FR: the version may explicitly permit versioned (duplicate-key) records. */
  readonly allowVersionedDuplicates: boolean;
  readonly rows: Iterable<PopulationGateRow>;
}

/**
 * §H's four population-row rows, in one pass: schema, mandatory values, duplicate primary
 * keys and the unparseable timestamps §H folds into mandatory values.
 *
 * Each raises its OWN diagnostic — an empty mandatory identifier, a duplicate primary key,
 * an unparseable timestamp and an undeclared schema field are four different defects with
 * four different repairs, and a single "the population is bad" would tell an auditor which
 * of them to look for exactly never.
 *
 * The required evaluation fields are the Template's declared Observation fields INTERSECTED
 * with the binding's declared schema. `COMPLIANCE_OBSERVATION_FIELDS` is the union across
 * the population AND every Target System — P-3 declares `decision`, which lives in the
 * approvals system and not in the population — so requiring all of them of a population row
 * would fail a correct Run. That is the `required-evidence` lesson (observation
 * registration v1) one layer along: what the population DECLARED it carries is what it must
 * carry.
 *
 * Duplicates are counted over EVERY parsed row, not only the included ones. §H says "No
 * duplicate Source primary key", and a duplicate that inclusion happened to filter out is
 * still two Source rows claiming one identity.
 */
export function populationFieldFindings(
  input: PopulationFieldInput,
): readonly GateFindingTally[] {
  const templateId: TemplateId | null = isTemplateId(input.templateId) ? input.templateId : null;
  const key = templateId === null ? null : adapterLookupColumn(templateId);
  const declaredFields: Readonly<Record<string, string>> =
    templateId === null ? {} : COMPLIANCE_OBSERVATION_FIELDS[templateId];
  const schema = new Set(input.declaredSchema);
  const required = input.declaredSchema.filter(
    (field) => field !== 'found' && Object.hasOwn(declaredFields, field),
  );
  const timeFields = required.filter((field) => declaredFields[field] === 'time');
  const seenKeys = new Set<string>();

  function* walk(): Generator<GateFinding> {
    for (const row of input.rows) {
      const values = row.values;
      // Schema, both ways. A field the binding never declared is as much a schema failure
      // as a declared field the row does not carry: the first is data no rule can read and
      // the second is a rule with nothing to read.
      for (const field of input.declaredSchema) {
        if (!Object.hasOwn(values, field)) {
          yield { diagnostic: 'schema-field-missing', targetSystem: null, workItemId: null, record: field };
        }
      }
      for (const field of Object.keys(values)) {
        if (!schema.has(field)) {
          yield { diagnostic: 'schema-field-undeclared', targetSystem: null, workItemId: null, record: field };
        }
      }
      const identity = key === null || !Object.hasOwn(values, key) ? undefined : values[key];
      const identityText = typeof identity === 'string' ? identity : null;
      if (key !== null && (identityText === null || identityText === '')) {
        yield {
          diagnostic: 'mandatory-identifier-empty',
          targetSystem: null,
          workItemId: null,
          record: `#${String(row.ordinal)}`,
        };
      } else if (identityText !== null) {
        if (seenKeys.has(identityText) && !input.allowVersionedDuplicates) {
          yield {
            diagnostic: 'duplicate-primary-key',
            targetSystem: null,
            workItemId: null,
            record: identityText,
          };
        }
        seenKeys.add(identityText);
      }
      // Mandatory evaluation fields, and the timestamps among them. Only INCLUDED records
      // are evaluated, so only they are required to carry evaluable values; an excluded row
      // was excluded on a rule that already read what it needed.
      if (row.disposition !== 'included') continue;
      const named = identityText === null || identityText === '' ? `#${String(row.ordinal)}` : identityText;
      for (const field of required) {
        if (field === key) continue;
        const value = Object.hasOwn(values, field) ? values[field] : undefined;
        if (value === undefined || value === null || value === '') {
          yield { diagnostic: 'mandatory-value-missing', targetSystem: null, workItemId: null, record: named };
        }
      }
      for (const field of timeFields) {
        const value = Object.hasOwn(values, field) ? values[field] : undefined;
        if (value === undefined || value === null || value === '') continue;
        if (normalizeObservedAt(value) === null && populationUtcDate(value) === null) {
          yield { diagnostic: 'timestamp-unparseable', targetSystem: null, workItemId: null, record: named };
        }
      }
    }
  }

  return tallyGateFindings(walk());
}

/* ------------------------------------------------------------- the decision --- */

export interface RunGateFacts {
  /**
   * Every check the population stage recorded, or `null` when it recorded none at all.
   *
   * `null` is an acquisition that never completed — `acquisition-incomplete`, which §H
   * makes `RUN_FAILED`. A Run that reached the Gate with no population reconciliation
   * concluded against nothing.
   */
  readonly populationChecks: readonly PopulationCheck[] | null;
  readonly population: PopulationGateCounts | null;
  readonly snapshot: SnapshotFreshnessInput | null;
  /** Every other §H finding this Run produced, already tallied and bounded. */
  readonly findings: readonly GateFindingTally[];
}

/**
 * Run every §H row over the facts the Run captured.
 *
 * Returns one result per row, in §H order, whatever happened — a row that found nothing is
 * a `PASS` that was actually evaluated, and the Run's Timeline shows twenty rows because
 * twenty rows ran. An absent row would be indistinguishable from a row nobody wrote.
 */
export function runGateChecks(facts: RunGateFacts): readonly GateCheckResult[] {
  const tallies = new Map<GateDiagnostic, GateFindingTally>();
  const add = (tally: GateFindingTally): void => {
    const existing = tallies.get(tally.diagnostic);
    if (existing === undefined) {
      tallies.set(tally.diagnostic, tally);
      return;
    }
    // Merge, keeping the exact total and a bounded, duplicate-free sample of each list.
    const merge = (left: readonly string[], right: readonly string[]): string[] => [
      ...new Set([...left, ...right]),
    ].slice(0, GATE_AFFECTED_LIMIT);
    tallies.set(tally.diagnostic, {
      diagnostic: tally.diagnostic,
      total: existing.total + tally.total,
      targetSystems: merge(existing.targetSystems, tally.targetSystems),
      workItems: merge(existing.workItems, tally.workItems),
      records: merge(existing.records, tally.records),
    });
  };
  const one = (diagnostic: GateDiagnostic, total: number, records: readonly string[] = []): void => {
    if (total <= 0) return;
    add({
      diagnostic,
      total,
      targetSystems: [],
      workItems: [],
      records: records.slice(0, GATE_AFFECTED_LIMIT),
    });
  };

  for (const tally of facts.findings) add(tally);

  // The population stage's recorded checks, routed onto their §H rows. A Run whose
  // population never reconciled at all is an acquisition that could not complete.
  if (facts.populationChecks === null) {
    one('acquisition-incomplete', 1);
  } else {
    for (const check of facts.populationChecks) {
      if (check.passed) continue;
      // `complete-inclusion` is the ONE recorded check this row recomputes below from the
      // counts rather than routing from the stored boolean — the stored boolean is exactly
      // what a defect in the counting would have written. Routing it as well would count a
      // single unaccounted row twice, and `total` is exact.
      if (RECOMPUTED_POPULATION_CHECKS.includes(check.name)) continue;
      const diagnostic = Object.hasOwn(POPULATION_CHECK_DIAGNOSTIC, check.name)
        ? POPULATION_CHECK_DIAGNOSTIC[check.name]
        : undefined;
      if (diagnostic !== undefined) one(diagnostic, 1);
    }
  }

  // §H, inclusion level: rows in = rows included + rows excluded, and every exclusion
  // carries a reason. The arithmetic is done here rather than trusted from a stored
  // boolean, because the stored boolean is exactly the thing a defect would have written.
  const counts = facts.population;
  if (counts !== null) {
    const accounted = counts.included + counts.excluded + counts.indeterminate;
    if (accounted !== counts.rowsParsed) one('rows-unaccounted', Math.abs(counts.rowsParsed - accounted));
    if (counts.indeterminate > 0) one('rows-unaccounted', counts.indeterminate);
    if (counts.unexplained.length > 0) {
      one(
        'exclusion-reason-missing',
        counts.unexplained.length,
        counts.unexplained.map((ordinal) => `#${String(ordinal)}`),
      );
    }
  }

  if (facts.snapshot !== null) {
    const diagnostic = snapshotFreshness(facts.snapshot);
    if (diagnostic !== null) one(diagnostic, 1);
  }

  const byRow = new Map<GateCheckName, GateFindingTally[]>();
  for (const tally of tallies.values()) {
    // No `Object.hasOwn` here, deliberately. Every tally that reaches this line came
    // through `tallyGateFindings`, which filters on `isGateDiagnostic`, or through a
    // literal in a routing table — so an inherited `constructor` cannot arrive, and a
    // guard against it would be a branch nothing can exercise, which is a branch that can
    // be inverted silently. The safety is at the entry point, where it is testable.
    const row = GATE_DIAGNOSTIC_ROW[tally.diagnostic];
    const list = byRow.get(row);
    if (list) list.push(tally);
    else byRow.set(row, [tally]);
  }

  return GATE_CHECKS.map((check): GateCheckResult => {
    const found = byRow.get(check) ?? [];
    // Vocabulary order, so the same failures always read the same way.
    const ordered = GATE_DIAGNOSTICS.filter((diagnostic) =>
      found.some((tally) => tally.diagnostic === diagnostic),
    );
    const limit = (values: readonly string[]): string[] => [...new Set(values)].slice(0, GATE_AFFECTED_LIMIT);
    return {
      check,
      outcome: ordered.length === 0 ? 'PASS' : 'FAIL',
      diagnostics: ordered,
      affected: {
        targetSystems: limit(found.flatMap((tally) => tally.targetSystems)),
        workItems: limit(found.flatMap((tally) => tally.workItems)),
        records: limit(found.flatMap((tally) => tally.records)),
        total: found.reduce((sum, tally) => sum + tally.total, 0),
      },
    };
  });
}

/** What the Gate concluded, and the state the Run takes because of it. */
export interface RunGateDecision {
  readonly passed: boolean;
  /**
   * The Run state this Gate produces.
   *
   * `COMPLETED` on a pass (§E: after the last Work Item the Run-level Gate checks run,
   * `RUNNING → COMPLETED` on pass), `INCONCLUSIVE` on any failing row, and `RUN_FAILED`
   * where a failing diagnostic says so. **Never `CANCELED`**: that state is reserved for a
   * person cancelling a Run and no check, limit or timeout may produce it.
   */
  readonly state: 'COMPLETED' | 'INCONCLUSIVE' | 'RUN_FAILED';
  /** The failing rows, in §H order. What the Result names. */
  readonly failed: readonly GateCheckName[];
}

export function runGateDecision(results: readonly GateCheckResult[]): RunGateDecision {
  const failed = results.filter((result) => result.outcome === 'FAIL');
  if (failed.length === 0) return { passed: true, state: 'COMPLETED', failed: [] };
  // `RUN_FAILED` outranks `INCONCLUSIVE`: execution or integrity failing is a stronger
  // statement than Evidence falling short, and §E.1 applies its rows in order with the
  // execution-failure row above the Gate-failure row.
  const runFailed = failed.some((result) =>
    result.diagnostics.some((diagnostic) => GATE_DIAGNOSTIC_STATE[diagnostic] === 'RUN_FAILED'),
  );
  return {
    passed: false,
    state: runFailed ? 'RUN_FAILED' : 'INCONCLUSIVE',
    failed: failed.map((result) => result.check),
  };
}
