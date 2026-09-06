import { describe, expect, it } from 'vitest';
import {
  GATE_CHECKS,
  type ExecutablePlan,
  type PackageArtifact,
  type RunRecord,
  type RunResultConditionCount,
  type RunResultExclusion,
  type RunResultFinding,
  type RunResultFindings,
} from '@intellifin/domain';
import { completeRun } from './complete-run.js';
import type {
  GateCheckRow,
  PackageSeal,
  RunGatePopulationFacts,
  RunResultContext,
  StoredRunResult,
} from './execution-ports.js';

/**
 * `CompleteRun` over facts it was handed rather than facts a stage produced.
 *
 * `execute-adapter-steps.test.ts` drives it end to end from a real Run, and
 * `tests/integration/run-result.test.ts` drives it against PostgreSQL. What is pinned here
 * is every row of the story's own I/O matrix, including the two states Epic 3 cannot
 * produce — a Gate that passed with an Agent-Judged evaluation still pending, and a
 * COMPLETED Run whose only defect is an Unevaluated condition — which no composed stage
 * can reach and which a branch nothing exercises could otherwise be inverted in silently.
 */

const RUN: RunRecord = {
  runId: '01a06fd8-0000-7000-8000-0000000000e1',
  correlationId: '01a06fd8-0000-7000-8000-0000000000e2',
  procedureId: '01a06fd8-0000-7000-8000-0000000000e3',
  versionId: '01a06fd8-0000-7000-8000-0000000000e4',
  versionNumber: 1,
  procedureName: 'High-value approvals',
  period: { from: '2026-08-01', to: '2026-08-31' },
  state: 'RUNNING',
  kind: 'STANDARD',
  initiatorId: 'auditor',
  sessionId: 'session',
  initiatedAt: '2026-09-02T00:00:00.000Z',
  authorizationRole: 'auditor',
  predecessorRunId: null,
  rerunReason: null,
  cancellation: null,
  requestToken: '01a06fd8-0000-7000-8000-0000000000e5',
};

const AT = '2026-09-06T00:00:00.000Z';
const SCOPE = 'Every USD payment of 100,000 or more processed in August 2026.';

const NO_FINDINGS: RunResultFindings = { total: 0, records: [] };

function plan(): ExecutablePlan {
  return {
    schemaVersion: 1,
    compilerVersion: '1',
    inputs: {
      templateId: 'P-3',
      controlName: 'High-value approvals',
      scope: SCOPE,
      targets: [],
      complianceConditions: [{ conditionId: 'C1' }],
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

/** Twenty §H rows, all passing — the only shape that is a passed Gate. */
function passingGate(): GateCheckRow[] {
  return GATE_CHECKS.map((check) => ({
    check,
    outcome: 'PASS' as const,
    diagnostics: [],
    targetSystems: [],
    workItems: [],
    records: [],
    total: 0,
  }));
}

function failingGate(check: (typeof GATE_CHECKS)[number]): GateCheckRow[] {
  return passingGate().map((row) =>
    row.check === check
      ? { ...row, outcome: 'FAIL' as const, diagnostics: ['record-uncovered' as const], total: 1 }
      : row,
  );
}

const EXCEPTION: RunResultFinding = {
  populationRecordKey: 'TX-500003',
  targetSystem: 'approvenow',
  value: 'EXCEPTION',
  conditionIds: ['C1'],
  diagnostics: ['approval after processing'],
  fields: { decision: 'APPROVED', approver_limit: '50000.00' },
};

const UNEVALUATED: RunResultFinding = {
  ...EXCEPTION,
  populationRecordKey: 'TX-500008',
  value: 'UNEVALUATED',
  diagnostics: ['missing or invalid Observation field decision'],
};

class FakeContext implements RunResultContext {
  gate: GateCheckRow[] = passingGate();
  conditions: RunResultConditionCount[] = [
    { conditionId: 'C1', origin: 'RULE', confirmation: null, value: 'COMPLIANT', total: 2 },
  ];
  findings: { exceptions: RunResultFindings; unevaluated: RunResultFindings } = {
    exceptions: NO_FINDINGS,
    unevaluated: NO_FINDINGS,
  };
  exclusions: RunResultExclusion[] = [];
  population: RunGatePopulationFacts | null = {
    checks: [],
    included: 2,
    excluded: 0,
    indeterminate: 0,
    rowsParsed: 2,
    unexplained: [],
    generatedAt: '2026-09-01T00:00:00.000Z',
  };
  result: StoredRunResult | null = null;
  seal: PackageSeal | null = null;
  states: RunRecord['state'][] = [];
  events: { eventType: string; outcome: string; payload: Record<string, unknown> }[] = [];
  writes = 0;
  private sequence = 0;

  auditEvents = {
    append: async (draft: {
      eventType: string;
      outcome: string;
      payload: Record<string, unknown>;
    }) => {
      this.sequence += 1;
      this.events.push({
        eventType: draft.eventType,
        outcome: draft.outcome,
        payload: draft.payload,
      });
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

  readGateChecks = async (): Promise<readonly GateCheckRow[]> => this.gate;
  saveRunState = async (state: RunRecord['state']): Promise<void> => {
    this.states.push(state);
  };
  readPopulationFacts = async (): Promise<RunGatePopulationFacts | null> => this.population;
  readPopulationRows = async () => [];
  readGateObservations = async () => [];
  readResult = async (): Promise<StoredRunResult | null> => this.result;
  writeResult = async (result: StoredRunResult): Promise<void> => {
    this.writes += 1;
    this.result = result;
  };
  readResultExclusions = async (): Promise<readonly RunResultExclusion[]> => this.exclusions;
  readConditionCounts = async (): Promise<readonly RunResultConditionCount[]> => this.conditions;
  readResultFindings = async () => this.findings;
}

describe('completeRun', () => {
  it('seals a Pass for a clean COMPLETED Run, once, with the Evidence package', async () => {
    const context = new FakeContext();
    const result = await completeRun(context, { run: RUN, state: 'COMPLETED', at: AT, plan: plan() });
    expect(result).toMatchObject({
      outcome: 'PASS',
      row: 'pass',
      sealed: true,
      version: 1,
      runState: 'COMPLETED',
      gatePassed: true,
      scope: SCOPE,
    });
    expect(context.seal?.runState).toBe('COMPLETED');
    expect(context.writes).toBe(1);
    const event = context.events.find((entry) => entry.eventType === 'lifecycle.result-sealed');
    expect(event?.outcome).toBe('success');
    expect(event?.payload).toMatchObject({ outcome: 'PASS', rule: 'pass', sealed: true, version: 1 });
  });

  it('computes the outcome exactly once and never recomputes it', async () => {
    const context = new FakeContext();
    const first = await completeRun(context, { run: RUN, state: 'COMPLETED', at: AT, plan: plan() });
    // A redelivered terminal transition, with facts that would now decide differently.
    context.gate = failingGate('per-record-coverage');
    context.findings = { exceptions: { total: 3, records: [EXCEPTION] }, unevaluated: NO_FINDINGS };
    const second = await completeRun(context, { run: RUN, state: 'INCONCLUSIVE', at: AT, plan: plan() });
    expect(second).toEqual(first);
    expect(context.writes).toBe(1);
    expect(
      context.events.filter((entry) => entry.eventType === 'lifecycle.result-sealed'),
    ).toHaveLength(1);
  });

  it('reports Control Failure and lists the Unevaluated records beside it', async () => {
    const context = new FakeContext();
    context.findings = {
      exceptions: { total: 1, records: [EXCEPTION] },
      unevaluated: { total: 1, records: [UNEVALUATED] },
    };
    const result = await completeRun(context, { run: RUN, state: 'COMPLETED', at: AT, plan: plan() });
    expect(result).toMatchObject({ outcome: 'CONTROL_FAILURE', row: 'control-failure', sealed: true });
    expect(result?.publication.exceptions.records[0]?.populationRecordKey).toBe('TX-500003');
    expect(result?.publication.unevaluated.records[0]?.populationRecordKey).toBe('TX-500008');
    // Only the §C control-specific fields of this Template reach the Result.
    expect(result?.publication.exceptions.records[0]?.fields).toEqual({
      decision: 'APPROVED',
      approver_limit: '50000.00',
    });
    // A Control Failure is a truthful conclusion, not a failed seal.
    expect(
      context.events.find((entry) => entry.eventType === 'lifecycle.result-sealed')?.outcome,
    ).toBe('success');
  });

  it('lets the Gate row win over Control Failure, which is what the order is for', async () => {
    const context = new FakeContext();
    context.gate = failingGate('per-record-coverage');
    context.findings = { exceptions: { total: 2, records: [EXCEPTION] }, unevaluated: NO_FINDINGS };
    const result = await completeRun(context, {
      run: RUN,
      state: 'INCONCLUSIVE',
      at: AT,
      plan: plan(),
    });
    expect(result).toMatchObject({ outcome: 'INCONCLUSIVE', row: 'gate-failed', gatePassed: false });
    expect(result?.publication.gate.failed).toEqual(['per-record-coverage']);
    // The Exceptions are still published: the Run found them, and the outcome says only
    // that the Evidence does not support concluding from them.
    expect(result?.publication.exceptions.total).toBe(2);
  });

  it('never reads a Gate that did not run as one that passed', async () => {
    // A Run stopped by a limit or a denial has NO Gate rows. Nineteen passing rows are not
    // a passed Gate either: a partial Gate has verified nineteen things and not twenty.
    const context = new FakeContext();
    context.gate = [];
    expect(
      await completeRun(context, { run: RUN, state: 'RUN_FAILED', at: AT, plan: plan() }),
    ).toMatchObject({ outcome: 'RUN_FAILED', gatePassed: false });

    const partial = new FakeContext();
    partial.gate = passingGate().slice(1);
    const result = await completeRun(partial, { run: RUN, state: 'COMPLETED', at: AT, plan: plan() });
    expect(result).toMatchObject({ outcome: 'INCONCLUSIVE', row: 'gate-failed', gatePassed: false });
  });

  it('moves a COMPLETED Run to INCONCLUSIVE and seals the package at that state', async () => {
    // §E's `COMPLETED → INCONCLUSIVE`, "only at Result sealing". Epic 3 cannot produce a
    // HUMAN-origin Unevaluated, so the state is constructed; the transition is real.
    const context = new FakeContext();
    context.conditions = [
      { conditionId: 'C1', origin: 'HUMAN', confirmation: null, value: 'UNEVALUATED', total: 1 },
    ];
    context.findings = { exceptions: NO_FINDINGS, unevaluated: { total: 1, records: [UNEVALUATED] } };
    const result = await completeRun(context, { run: RUN, state: 'COMPLETED', at: AT, plan: plan() });
    expect(result).toMatchObject({ outcome: 'INCONCLUSIVE', row: 'unevaluated', runState: 'INCONCLUSIVE' });
    expect(context.states).toEqual(['INCONCLUSIVE']);
    // The package records the state the Run actually reached, not the one the caller was
    // committing when it called.
    expect(context.seal?.runState).toBe('INCONCLUSIVE');
  });

  it('leaves a Pending Confirmation Result unsealed at version 1', async () => {
    // Epic 3 produces evaluations of origin RULE only, so nothing here is ever pending.
    const context = new FakeContext();
    context.conditions = [
      { conditionId: 'C2', origin: 'AGENT_JUDGED', confirmation: 'pending', value: 'COMPLIANT', total: 1 },
    ];
    const result = await completeRun(context, { run: RUN, state: 'COMPLETED', at: AT, plan: plan() });
    expect(result).toMatchObject({
      outcome: 'PENDING_CONFIRMATION',
      row: 'pending-confirmation',
      sealed: false,
      version: 1,
      runState: 'COMPLETED',
    });
    expect(
      context.events.find((entry) => entry.eventType === 'lifecycle.result-sealed')?.outcome,
    ).toBe('failure');
  });

  it('seals a zero-record Pass with every count 0 and says no record was inspected', async () => {
    const context = new FakeContext();
    context.population = {
      checks: [],
      included: 0,
      excluded: 0,
      indeterminate: 0,
      rowsParsed: 0,
      unexplained: [],
      generatedAt: '2026-09-01T00:00:00.000Z',
    };
    context.conditions = [];
    const result = await completeRun(context, { run: RUN, state: 'COMPLETED', at: AT, plan: plan() });
    expect(result?.outcome).toBe('PASS');
    expect(result?.publication.population).toEqual({
      rowsParsed: 0,
      included: 0,
      excluded: 0,
      indeterminate: 0,
    });
    expect(result?.publication.conditions).toEqual([]);
    expect(result?.publication.exceptions.total).toBe(0);
    expect(result?.publication.statement).toContain('No record was inspected.');
  });

  it('does not pass a zero-record Run whose empty population failed the Gate', async () => {
    // The opt-in is the version's, and it is consumed by the population reconciliation:
    // without it `nonempty-population` fails, §H's empty-population row fails, and the
    // Gate row above every sealing row wins. Nothing here fabricates a Pass for it.
    const context = new FakeContext();
    context.gate = failingGate('empty-population');
    context.population = {
      checks: [],
      included: 0,
      excluded: 0,
      indeterminate: 0,
      rowsParsed: 0,
      unexplained: [],
      generatedAt: '2026-09-01T00:00:00.000Z',
    };
    context.conditions = [];
    const result = await completeRun(context, {
      run: RUN,
      state: 'INCONCLUSIVE',
      at: AT,
      plan: plan(),
    });
    expect(result?.outcome).toBe('INCONCLUSIVE');
  });

  it('publishes the exclusions with their reasons and the population of record', async () => {
    const context = new FakeContext();
    context.population = {
      checks: [],
      included: 2,
      excluded: 3,
      indeterminate: 1,
      rowsParsed: 6,
      unexplained: [],
      generatedAt: '2026-09-01T00:00:00.000Z',
    };
    context.exclusions = [
      { reason: 'Outside inclusion rule: amount (decimal)', total: 3, records: ['#4', '#5', '#6'] },
    ];
    const result = await completeRun(context, { run: RUN, state: 'COMPLETED', at: AT, plan: plan() });
    expect(result?.publication.population).toEqual({
      rowsParsed: 6,
      included: 2,
      excluded: 3,
      indeterminate: 1,
    });
    expect(result?.publication.exclusions).toEqual([
      { reason: 'Outside inclusion rule: amount (decimal)', total: 3, records: ['#4', '#5', '#6'] },
    ]);
  });

  it('publishes a null scope rather than an empty one for an unreadable plan', async () => {
    const context = new FakeContext();
    const result = await completeRun(context, { run: RUN, state: 'RUN_FAILED', at: AT, plan: null });
    expect(result).toMatchObject({ outcome: 'RUN_FAILED', scope: null });
    expect(result?.publication.templateId).toBeNull();
    expect(result?.publication.controlFields).toEqual([]);
  });

  it('does nothing at all on a transition that is not terminal', async () => {
    const context = new FakeContext();
    expect(
      await completeRun(context, { run: RUN, state: 'RUNNING', at: AT, plan: plan() }),
    ).toBeNull();
    expect(context.writes).toBe(0);
    expect(context.seal).toBeNull();
    expect(context.events).toHaveLength(0);
  });
});
