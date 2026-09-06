import { describe, expect, it } from 'vitest';
import type { ExecutablePlan, GateCheckResult, PackageArtifact, RunRecord } from '@intellifin/domain';
import { runRunLevelGate } from './run-gate.js';
import type {
  GateCheckRow,
  GateFactTally,
  PackageSeal,
  RunGateContext,
  RunGatePopulationFacts,
} from './execution-ports.js';

/**
 * The Run-level Gate over facts it was handed rather than facts a stage produced.
 *
 * `execute-adapter-steps.test.ts` drives the Gate end to end, which is where its normal
 * behaviour is pinned. What cannot be driven that way is a Gate reached with NO readable
 * plan: `executeAdapterSteps` refuses that plan as `unsupported-frozen-plan` before its
 * first Work Item, so the branch is unreachable from the composed stage — and a branch
 * nothing exercises is a branch that can be inverted silently. `runRunLevelGate` takes
 * `plan: ExecutablePlan | null`, so it is exercised here, at the seam that accepts it.
 */

const RUN: RunRecord = {
  runId: '01a06fd8-0000-7000-8000-0000000000f1',
  correlationId: '01a06fd8-0000-7000-8000-0000000000f2',
  procedureId: '01a06fd8-0000-7000-8000-0000000000f3',
  versionId: '01a06fd8-0000-7000-8000-0000000000f4',
  versionNumber: 1,
  procedureName: 'Segregation of duties',
  period: { from: '2026-08-01', to: '2026-08-31' },
  state: 'RUNNING',
  kind: 'STANDARD',
  initiatorId: 'auditor',
  sessionId: 'session',
  initiatedAt: '2026-09-02T00:00:00.000Z',
  authorizationRole: 'auditor',
  requestToken: '01a06fd8-0000-7000-8000-0000000000f5',
};

const DECIDED_AT = '2026-09-05T00:00:00.000Z';
const NO_TALLY: GateFactTally = { total: 0, sample: [] };

/** A Run with nothing wrong with it except whatever the test supplies. */
const CLEAN_POPULATION: RunGatePopulationFacts = {
  checks: [
    { name: 'parse', passed: true },
    { name: 'declaration', passed: true },
    { name: 'response-contract', passed: true },
    { name: 'declared-count', passed: true },
    { name: 'declared-digest', passed: true },
    { name: 'declared-schema', passed: true },
    { name: 'declared-period', passed: true },
    { name: 'complete-extraction', passed: true },
    { name: 'generation', passed: true },
    { name: 'source-identity', passed: true },
    { name: 'freshness', passed: true },
    { name: 'complete-inclusion', passed: true },
    { name: 'nonempty-population', passed: true },
  ],
  included: 1,
  excluded: 0,
  indeterminate: 0,
  rowsParsed: 1,
  unexplained: [],
  generatedAt: '2026-09-01T00:00:00.000Z',
};

class FakeGate implements RunGateContext {
  rows: GateCheckRow[] = [];
  state: RunRecord['state'] | null = null;
  seal: PackageSeal | null = null;
  events: { eventType: string; payload: Record<string, unknown> }[] = [];
  /** Every `expected` this Gate asked the condition-gap reader for. */
  askedFor: number[] = [];
  private sequence = 0;

  auditEvents = {
    append: async (draft: { eventType: string; payload: Record<string, unknown> }) => {
      this.sequence += 1;
      this.events.push({ eventType: draft.eventType, payload: draft.payload });
      return { sequence: this.sequence } as never;
    },
  };

  readPackageArtifacts = async (): Promise<readonly PackageArtifact[]> => [];
  abandonArtifacts = async (): Promise<void> => undefined;
  readSeal = async (): Promise<PackageSeal | null> => this.seal;
  writeSeal = async (seal: PackageSeal): Promise<void> => {
    this.seal = seal;
  };
  notifyTimeline = async (): Promise<void> => undefined;

  readGateChecks = async (): Promise<readonly GateCheckRow[]> => this.rows;
  saveGateChecks = async (rows: readonly GateCheckRow[]): Promise<void> => {
    this.rows = [...rows];
  };
  saveRunState = async (state: RunRecord['state']): Promise<void> => {
    this.state = state;
  };
  readPopulationFacts = async (): Promise<RunGatePopulationFacts | null> => CLEAN_POPULATION;
  readPopulationRows = async () => [];
  readGateObservations = async () => [];
  readFailedObservationChecks = async () => ({});
  readConditionGaps = async (expected: number): Promise<GateFactTally> => {
    this.askedFor.push(expected);
    // The real reader answers "no gaps" for `expected <= 0`: every Observation has at
    // least zero evaluations. That is exactly why a Run with no readable plan must not
    // reach this reader at all.
    return NO_TALLY;
  };
  readUnnamedValues = async (): Promise<GateFactTally> => NO_TALLY;
  readIncompleteExtractions = async () => [];
  readAccessFailures = async () => ({ failedSessionSteps: [], denied: [] });
  readIntegrityFindings = async () => [];
}

function row(results: readonly GateCheckResult[], check: string): GateCheckResult {
  const found = results.find((result) => result.check === check);
  expect(found, `no ${check} row`).toBeDefined();
  return found!;
}

/** A plan carrying `n` frozen compiled conditions, and nothing else this Gate reads. */
function plan(conditions: number): ExecutablePlan {
  return {
    schemaVersion: 1,
    compilerVersion: '1',
    inputs: {
      templateId: 'P-2',
      complianceConditions: Array.from({ length: conditions }, (_, index) => ({
        conditionId: `C${String(index + 1)}`,
      })),
      targets: [],
      allowVersionedDuplicates: false,
      sourceSnapshot: null,
    },
    sessionSteps: [],
    targetSystems: [],
    observations: [],
    credentialReferences: [],
    limits: {
      retriesPerStep: 3,
      stepTimeoutSeconds: 120,
      runStepExecutions: 10000,
      runTimeoutSeconds: 3600,
      runTokens: 1000000,
    },
  } as unknown as ExecutablePlan;
}

describe('runRunLevelGate', () => {
  it('counts condition gaps against the number of conditions the plan froze', async () => {
    const context = new FakeGate();
    const outcome = await runRunLevelGate(context, { run: RUN, plan: plan(2), decidedAt: DECIDED_AT });
    expect(context.askedFor).toEqual([2]);
    expect(row(outcome.results, 'condition-completeness').outcome).toBe('PASS');
    expect(outcome.decision).toMatchObject({ passed: true, state: 'COMPLETED' });
  });

  it('never passes condition completeness for a Run whose plan could not be read', async () => {
    // A plan this build cannot read declares no conditions, so there is no number to
    // compare evaluations against and the gap reader would find no gaps — a PASS for want
    // of a count. §H's row is "every condition has an evaluation for every record its
    // applicability predicate selects", and a Run with no readable plan has verified that
    // for exactly nothing.
    const context = new FakeGate();
    const outcome = await runRunLevelGate(context, { run: RUN, plan: null, decidedAt: DECIDED_AT });
    const completeness = row(outcome.results, 'condition-completeness');
    expect(completeness.outcome).toBe('FAIL');
    expect(completeness.diagnostics).toEqual(['condition-evaluation-missing']);
    // The gap reader is never consulted: there is nothing to consult it with.
    expect(context.askedFor).toEqual([]);
    expect(outcome.decision).toMatchObject({ passed: false, state: 'INCONCLUSIVE' });
    expect(context.state).toBe('INCONCLUSIVE');
    // And the Run is still sealed at that terminal transition, as every other one is.
    expect(context.seal?.runState).toBe('INCONCLUSIVE');
  });
});
