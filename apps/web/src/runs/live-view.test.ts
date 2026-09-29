import { describe, expect, it } from 'vitest';

import { ACTIVE_RUN_STATES, RUN_STATES } from '@intellifin/domain';
import type { RunFrameRow, RunStepExecutionRow } from '@intellifin/infrastructure';

import {
  ADAPTER_ARTIFACT_WORDS,
  LIVE_VIEW_CHROME,
  adapterStepArtifact,
  chromeDotClass,
  currentStepExecution,
  frameNarration,
  liveViewChrome,
  logicalStepProgress,
  plannedStepCount,
  plannedStepIds,
  readAdapterLog,
  stepNarration,
  type AdapterLogEvidenceReader,
  type AdapterLogSessionStep,
} from './live-view';

const EXECUTION: RunStepExecutionRow = {
  stepExecutionId: '01990000-0000-7000-8000-0000000005a1',
  planStepId: 'loancore-2',
  workItemId: null,
  action: 'inspect-record',
  state: 'RUNNING',
  attempt: 1,
  startedAt: '2026-09-09T06:12:00.000Z',
  completedAt: null,
  diagnostic: null,
};

const FRAME: RunFrameRow = {
  evidenceId: '01990000-0000-7000-8000-0000000005b1',
  toolActionId: '01990000-0000-7000-8000-0000000005b2',
  stepExecutionId: EXECUTION.stepExecutionId,
  workItemId: null,
  action: 'read-attribute',
  digest: 'a'.repeat(64),
  size: 1024,
  mediaType: 'image/png',
  sourceLocation: 'http://localhost:4300/loancore/users/E-000102',
  capturedAt: '2026-09-09T06:12:03.000Z',
  actionStartedAt: '2026-09-09T06:12:02.000Z',
};

describe('the session viewer chrome', () => {
  it('maps every Run state the domain has, and gives a Queued Run no session word', () => {
    // Every state is mapped deliberately: a state that fell through to a word would put a
    // session label on a Run that has none, and the four words are a closed vocabulary.
    const mapped = Object.fromEntries(RUN_STATES.map((state) => [state, liveViewChrome(state)]));
    expect(mapped).toEqual({
      QUEUED: null,
      RUNNING: 'LIVE',
      PAUSED: 'PAUSED',
      AWAITING_AUDITOR: 'AWAITING',
      COMPLETED: 'REPLAY',
      INCONCLUSIVE: 'REPLAY',
      RUN_FAILED: 'REPLAY',
      CANCELED: 'REPLAY',
    });
  });

  it('gives every active state but Queued a live session word, and every terminal state REPLAY', () => {
    for (const state of ACTIVE_RUN_STATES) {
      expect(liveViewChrome(state) === 'REPLAY', state).toBe(false);
    }
    for (const state of RUN_STATES) {
      const terminal = !(ACTIVE_RUN_STATES as readonly string[]).includes(state);
      if (terminal) expect(liveViewChrome(state), state).toBe('REPLAY');
    }
  });

  it('refuses a word for a state outside the vocabulary rather than guessing one', () => {
    expect(liveViewChrome('constructor')).toBeNull();
    expect(liveViewChrome('')).toBeNull();
    expect(liveViewChrome('LIVE')).toBeNull();
  });

  it('names a dot class for every word in the closed vocabulary', () => {
    expect(LIVE_VIEW_CHROME.map(chromeDotClass)).toEqual([
      'ls-session__dot ls-session__dot--live',
      'ls-session__dot ls-session__dot--paused',
      'ls-session__dot ls-session__dot--awaiting',
      'ls-session__dot ls-session__dot--replay',
    ]);
  });
});

describe('the Step counter and narration', () => {
  it('counts the frozen plan\'s own steps and says nothing when the plan is unreadable', () => {
    const plan = {
      sessionSteps: [{}, {}],
      targetSystems: [{ planSteps: [{}, {}, {}] }, { planSteps: [{}, {}, {}] }],
    } as never;
    expect(plannedStepCount(plan)).toBe(8);
    expect(plannedStepCount(null)).toBeNull();
  });

  it('gives the frame the SAME narration string as its Step row, in audit words', () => {
    // EXPERIENCE.md: "Session viewer frames carry an `alt` narration equal to the Step
    // narration." Equal, not merely similar — so the two callers share one function.
    // The plan-step id and the ISO instant that used to end this sentence are on the rail
    // under Technical details (UI cleanup 2026-09-22, UX-28): they were inside the one
    // string a screen-reader user hears as the picture's caption.
    const narration = stepNarration(EXECUTION, 'LoanCore');
    expect(narration).toBe('Opening the page on LoanCore');
    expect(frameNarration(FRAME, EXECUTION, 'LoanCore')).toBe(narration);
    expect(narration).not.toContain(EXECUTION.planStepId);
    expect(narration).not.toContain('2026-09-09T06:12:00.000Z');
  });

  it('narrates the capturing action when the Step Execution cannot be resolved', () => {
    expect(frameNarration(FRAME, null, 'LoanCore')).toBe('Reading an approved field on LoanCore');
    expect(frameNarration(FRAME, null, null)).toBe('Reading an approved field');
    // A field the caller resolved against the frozen label patterns is named; a caller
    // with none gets the general sentence rather than a field this module guessed at.
    expect(frameNarration(FRAME, null, 'LoanCore', null, 'account_status')).toBe('Reading the account status');
  });

  // UX-DR37 makes the frame's `alt` the Step narration, and Replay labels each scrubber
  // pill with it — so a narration naming only the Target System gave a three-leaver Run
  // three pills a screen-reader user could not tell apart, while the sighted reader saw
  // the record on the jump list beside them.
  it('names the RECORD as well as the system, so two Work Items of one Run differ', () => {
    expect(stepNarration(EXECUTION, 'LoanCore', 'E-000103'))
      .toBe('Opening the record for E-000103 on LoanCore');
    const said = ['E-000102', 'E-000103', 'E-000105']
      .map((record) => stepNarration(EXECUTION, 'LoanCore', record));
    expect(new Set(said).size).toBe(3);
    expect(frameNarration(FRAME, EXECUTION, 'LoanCore', 'E-000103')).toBe(stepNarration(EXECUTION, 'LoanCore', 'E-000103'));
  });

  it('says only where when the Work Item inspected no record of its own', () => {
    // P-4 inspects a page, not a population, so there is no record to name and the
    // sentence must not gain a dangling "for".
    expect(stepNarration(EXECUTION, 'ProdConsole', null)).toBe('Opening the page on ProdConsole');
    expect(frameNarration({ ...FRAME, action: 'search' }, null, 'LoanCore', 'E-000103'))
      .toBe('Searching LoanCore for E-000103');
  });

  it('narrates without a Target System when the Step names none', () => {
    expect(stepNarration({ ...EXECUTION, action: 'create-workspace', planStepId: 'session-1' }, null))
      .toBe('Creating the Agent Workspace');
  });

  it('shows a plan action and a Tool Action this build does not know as they were stored', () => {
    // A vocabulary this build has not transcribed falls back through `planActionWord` and
    // `toolActionNameWord` to the stored value: a true statement about the row, never a
    // sentence this module invented.
    expect(stepNarration({ ...EXECUTION, action: 'teleport-somewhere' }, 'LoanCore', 'E-000103'))
      .toBe('teleport-somewhere for E-000103 on LoanCore');
    expect(frameNarration({ ...FRAME, action: 'constructor' }, null, 'LoanCore'))
      .toBe('constructor on LoanCore');
  });

  it('takes the newest Step Execution as the current one, whatever order it was read in', () => {
    const older = { ...EXECUTION, stepExecutionId: 'older', startedAt: '2026-09-09T06:10:00.000Z' };
    const newer = { ...EXECUTION, stepExecutionId: 'newer', startedAt: '2026-09-09T06:14:00.000Z' };
    expect(currentStepExecution([older, newer])?.stepExecutionId).toBe('newer');
    expect(currentStepExecution([newer, older])?.stepExecutionId).toBe('newer');
    expect(currentStepExecution([])).toBeNull();
  });
});

describe('the logical Step counter (UI cleanup 2026-09-22, UX-47)', () => {
  // A three-leaver P-1 plan: three Session Steps and one Target System's three plan steps.
  const PLAN = {
    sessionSteps: [{ id: 'session-1' }, { id: 'session-2' }, { id: 'session-3' }],
    targetSystems: [{ planSteps: [{ id: 'loancore-1' }, { id: 'loancore-2' }, { id: 'loancore-3' }] }],
  } as never;

  const execution = (planStepId: string, workItemId: string | null, attempt = 1) =>
    ({ planStepId, workItemId, attempt });

  it('names every plan step the frozen plan declares, and nothing when it cannot be read', () => {
    expect(plannedStepIds(PLAN)).toEqual(['session-1', 'session-2', 'session-3', 'loancore-1', 'loancore-2', 'loancore-3']);
    expect(plannedStepIds(null)).toBeNull();
  });

  it('never exceeds the planned count when a pause superseded an attempt and a resume restarted it', () => {
    // THE FINDING. The chrome read "Step 7 of 6": the numerator was the exact TOTAL of
    // `run_step_execution`, which counts ATTEMPTS — a pause supersedes the attempt in
    // flight and the resume starts a new one, so a Run on the sixth of six plan steps
    // reported seven. Restore the attempt count and this assertion fails.
    const executions = [
      execution('session-1', null),
      execution('session-2', null),
      execution('session-3', null),
      execution('loancore-1', 'item-1'),
      execution('loancore-2', 'item-1'),
      // Superseded by a pause, then restarted as attempt 2 — two rows, one logical step.
      execution('loancore-3', 'item-1', 1),
      execution('loancore-3', 'item-1', 2),
    ];
    const progress = logicalStepProgress(executions, plannedStepIds(PLAN));
    expect(executions.length).toBe(7);
    expect(plannedStepCount(PLAN)).toBe(6);
    expect(progress.started).toBe(6);
    expect(progress.started).toBeLessThanOrEqual(plannedStepCount(PLAN)!);
    expect(progress.retries).toBe(1);
  });

  it('holds the invariant across every record of a multi-record Run', () => {
    // The plan declares three per-target steps and the Run walks them once PER RECORD, so
    // counting (plan step, Work Item) pairs gives nine against six declared steps — the
    // very shape the finding is about. `units` says that number under its own name; the
    // counter's numerator stays the distinct plan steps.
    const executions = ['item-1', 'item-2', 'item-3'].flatMap((item) => [
      execution('loancore-1', item), execution('loancore-2', item), execution('loancore-3', item),
    ]);
    const progress = logicalStepProgress(executions, plannedStepIds(PLAN));
    expect(progress.units).toBe(9);
    expect(progress.started).toBe(3);
    expect(progress.started).toBeLessThanOrEqual(plannedStepCount(PLAN)!);
  });

  it('ignores a Step Execution naming a plan step this version does not declare', () => {
    // A stale row, or one written under another Version, cannot push the counter past the
    // denominator: the intersection is what holds the invariant, not a clamp.
    const progress = logicalStepProgress(
      [execution('session-1', null), execution('from-another-version', null)],
      plannedStepIds(PLAN),
    );
    expect(progress.started).toBe(1);
  });

  it('counts every distinct step when the plan could not be read at all', () => {
    // With no denominator there is no invariant to hold, and dropping the rows would
    // report a Run that had executed nothing.
    const progress = logicalStepProgress([execution('a', null), execution('b', null), execution('b', null)], null);
    expect(progress.started).toBe(2);
    expect(plannedStepCount(null)).toBeNull();
  });
});

/**
 * The adapter log's artifact, decided (Story 10.6, legacy 5.3 AC 2; owner decision
 * 2026-09-25). Live View passed `digest: null` for every row, so an acquired step said
 * "No artifact registered." over an artifact the Run had registered. Three situations, and
 * never one sentence for all three.
 */
describe('the adapter log artifact (Story 10.6, legacy 5.3)', () => {
  const EVIDENCE = '01990000-0000-7000-8000-0000000007e1';
  const DIGEST = 'c'.repeat(64);
  const step = (overrides: Partial<AdapterLogSessionStep> = {}): AdapterLogSessionStep => ({
    stepId: 'session-2', action: 'extract-adapter', displayName: 'RoleMatrix', state: 'ACQUIRED', attempts: 1,
    evidenceId: EVIDENCE, ...overrides,
  });
  /** A reader that records every call, so a test can say which ids were asked for. */
  function reader(answer: () => Promise<readonly { evidenceId: string; state: string; digest: string | null }[]>) {
    const calls: { runId: string; ids: readonly string[] }[] = [];
    const port: AdapterLogEvidenceReader = {
      readEvidenceItemsByIds: async (runId, ids) => { calls.push({ runId, ids }); return answer(); },
    };
    return { port, calls };
  }

  it('names the registered Evidence and its digest when the exact read returns it', () => {
    const read = new Map([[EVIDENCE, { state: 'REGISTERED', digest: DIGEST }]]);
    expect(adapterStepArtifact(EVIDENCE, read)).toEqual({ kind: 'registered', evidenceId: EVIDENCE, digest: DIGEST });
  });

  it('says no artifact is registered for a step that names none, whatever the read did', () => {
    expect(adapterStepArtifact(null, new Map())).toEqual({ kind: 'none' });
    // The read failing does not turn a step that names nothing into an unreadable one.
    expect(adapterStepArtifact(null, null)).toEqual({ kind: 'none' });
  });

  it('says no artifact is registered for a reservation that was never registered', () => {
    for (const state of ['RESERVED', 'ABANDONED']) {
      expect(adapterStepArtifact(EVIDENCE, new Map([[EVIDENCE, { state, digest: null }]]))).toEqual({ kind: 'none' });
    }
  });

  it('says the record could not be read, never that there is none, when the read failed or missed the row', () => {
    expect(adapterStepArtifact(EVIDENCE, null)).toEqual({ kind: 'unavailable' });
    // The step names an artifact the read did not return: an absence nobody observed.
    expect(adapterStepArtifact(EVIDENCE, new Map())).toEqual({ kind: 'unavailable' });
  });

  it('keeps the three sentences distinct', () => {
    expect(ADAPTER_ARTIFACT_WORDS.none).not.toBe(ADAPTER_ARTIFACT_WORDS.unavailable);
    // The unavailable sentence claims neither that an artifact exists nor that none does.
    expect(ADAPTER_ARTIFACT_WORDS.unavailable).not.toContain('No artifact');
    expect(ADAPTER_ARTIFACT_WORDS.unavailable).toContain('could not be read');
  });

  it('reads EXACTLY the Evidence ids the adapter steps name, and only for adapter steps', async () => {
    const other = '01990000-0000-7000-8000-0000000007e2';
    const { port, calls } = reader(async () => [{ evidenceId: EVIDENCE, state: 'REGISTERED', digest: DIGEST }]);
    const rows = await readAdapterLog(port, 'run-1', [
      step(),
      step({ stepId: 'session-1', action: 'sign-in', evidenceId: other }),
      step({ stepId: 'session-3', displayName: 'AccessGate', state: 'IN_PROGRESS', evidenceId: null }),
    ]);
    expect(calls).toEqual([{ runId: 'run-1', ids: [EVIDENCE] }]);
    expect(rows.map((row) => row.stepId)).toEqual(['session-2', 'session-3']);
    expect(rows[0]!.artifact).toEqual({ kind: 'registered', evidenceId: EVIDENCE, digest: DIGEST });
    expect(rows[1]!.artifact).toEqual({ kind: 'none' });
    // The plan action as a word, then the system — the row the viewers already said.
    expect(rows[0]!.displayName).toMatch(/ · RoleMatrix$/);
  });

  it('issues no read at all when no adapter step names an artifact', async () => {
    const { port, calls } = reader(async () => { throw new Error('must not be called'); });
    const rows = await readAdapterLog(port, 'run-1', [step({ evidenceId: null, state: 'PENDING' })]);
    expect(calls).toEqual([]);
    expect(rows[0]!.artifact).toEqual({ kind: 'none' });
  });

  it('reads every distinct artifact beyond the repository’s 64-id bound', async () => {
    const ids = Array.from({ length: 65 }, (_, index) => `01990000-0000-7000-8000-${index.toString(16).padStart(12, '0')}`);
    const requested: string[][] = [];
    const port: AdapterLogEvidenceReader = {
      readEvidenceItemsByIds: async (runId, selected) => {
        expect(runId).toBe('run-1');
        requested.push([...selected]);
        // The real repository retains only the first 64 distinct identifiers per call.
        return [...new Set(selected)].slice(0, 64).map((evidenceId) => ({ evidenceId, state: 'REGISTERED', digest: DIGEST }));
      },
    };
    const steps = [
      step({ stepId: 'duplicate', evidenceId: ids[0]! }),
      ...ids.map((evidenceId, index) => step({ stepId: `session-${index}`, evidenceId })),
    ];
    const rows = await readAdapterLog(port, 'run-1', steps);
    expect(requested).toEqual([ids.slice(0, 64), ids.slice(64)]);
    expect(rows.map((row) => row.artifact)).toEqual(steps.map(({ evidenceId }) => ({
      kind: 'registered', evidenceId, digest: DIGEST,
    })));
  });

  it('keeps all named artifacts unavailable when a later batch fails', async () => {
    const steps = Array.from({ length: 65 }, (_, index) => step({
      stepId: `session-${index}`, evidenceId: `01990000-0000-7000-8000-${index.toString(16).padStart(12, '0')}`,
    }));
    let calls = 0;
    const port: AdapterLogEvidenceReader = {
      readEvidenceItemsByIds: async (_runId, ids) => {
        if (++calls === 2) throw new Error('connection reset');
        return ids.map((evidenceId) => ({ evidenceId, state: 'REGISTERED', digest: DIGEST }));
      },
    };
    const rows = await readAdapterLog(port, 'run-1', [...steps, step({ evidenceId: null })]);
    expect(calls).toBe(2);
    expect(rows.map((row) => row.artifact.kind)).toEqual([...steps.map(() => 'unavailable'), 'none']);
  });

  it('turns a failed read into "could not be read" for every step that names an artifact', async () => {
    const { port } = reader(async () => { throw new Error('connection reset'); });
    const rows = await readAdapterLog(port, 'run-1', [step(), step({ stepId: 'session-3', evidenceId: null })]);
    expect(rows.map((row) => row.artifact.kind)).toEqual(['unavailable', 'none']);
  });
});
