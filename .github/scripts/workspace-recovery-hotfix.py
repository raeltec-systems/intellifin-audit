from pathlib import Path


def replace(path, old, new, count=1):
    p = Path(path)
    text = p.read_text()
    actual = text.count(old)
    assert actual == count, f'{path}: expected {count} matches; found {actual}'
    p.write_text(text.replace(old, new))

p = 'packages/application/src/runs/provision-workspace.ts'
replace(p, '  recording?: RecordingCopy;\n}', '''  recording?: RecordingCopy;
  /** Closed operational facts only; never a raw error, provider ID or endpoint. */
  reportFailure?: (failure: WorkspaceFailureNotice) => void;
}

export interface WorkspaceFailureNotice {
  readonly runId: string;
  readonly stage: 'workspace';
  readonly diagnostic: 'workspace-persistence-failed' | 'workspace-persistence-unconfirmed' | 'workspace-cleanup-failed' | 'workspace-identity-invalid';
  readonly errorCode?: string;
}

/** The generation-50 storage budget. Provider identifiers must never be shortened. */
export const WORKSPACE_ID_MAX_LENGTH = 4096;

class WorkspaceIdentityInvalid extends Error {
  override readonly name = 'WorkspaceIdentityInvalid';
}

// Read DATA properties only, never messages, SQL, parameters, URLs, arbitrary codes
// or getters. Bound the walk and ignore cycles and hostile objects.
const WORKSPACE_ERROR_CODES = new Set(['23514', '23502', '23503', '23505', '40001', '40P01', '08001', '08003', '08006', '08007', '53300', '57P01', '57P02', '57P03', 'ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT']);
function workspaceErrorCode(error: unknown): string | undefined {
  const seen = new Set<unknown>();
  let current = error;
  try {
    for (let depth = 0; depth < 5; depth += 1) {
      if (current === null || typeof current !== 'object' || seen.has(current)) break;
      seen.add(current);
      const code = Object.getOwnPropertyDescriptor(current, 'code')?.value as unknown;
      if (typeof code === 'string' && WORKSPACE_ERROR_CODES.has(code)) return code;
      current = Object.getOwnPropertyDescriptor(current, 'cause')?.value as unknown;
    }
  } catch { /* Unknown shapes contribute no diagnostic fields. */ }
  return undefined;
}

function reportWorkspaceFailure(deps: WorkspaceDependencies, runId: string, diagnostic: WorkspaceFailureNotice['diagnostic'], error?: unknown): void {
  const errorCode = workspaceErrorCode(error);
  try {
    deps.reportFailure?.({ runId, stage: 'workspace', diagnostic, ...(errorCode === undefined ? {} : { errorCode }) });
  } catch { /* Telemetry must not prevent cleanup or failure sealing. */ }
}''')
replace(p, "  | 'workspace-policy'\n", "  | 'workspace-policy'\n  | 'workspace-persistence-failed'\n  | 'workspace-identity-invalid'\n")
replace(p, '''      createdByThisClaim = true;
    }
  } catch (error) {
    const code = failureCode(error);''', '''      createdByThisClaim = true;
    }
    if (typeof handle.ref.workspaceId !== 'string' || handle.ref.workspaceId.length === 0 || handle.ref.workspaceId.length > WORKSPACE_ID_MAX_LENGTH) {
      throw new WorkspaceIdentityInvalid();
    }
  } catch (error) {
    const code = failureCode(error);
    const invalidIdentity = error instanceof WorkspaceIdentityInvalid;
    if (invalidIdentity) {
      reportWorkspaceFailure(deps, job.runId, 'workspace-identity-invalid');
      // Give back only a session THIS claim made; a reattached session may now
      // be held by another claimant. Its invalid identity cannot be persisted.
      if (createdByThisClaim && handle !== null) {
        await deps.browser.release(handle.ref, WORKSPACE_RELEASE_TIMEOUT_MS).catch((cleanupError: unknown) => {
          reportWorkspaceFailure(deps, job.runId, 'workspace-cleanup-failed', cleanupError);
        });
      }
    }''')
replace(p, '''    const failure: WorkspaceDiagnostic = releaseFailed
      ? 'workspace-release-failed'
      : diagnosticOf(code);
    const spent = (releaseFailed ? false : terminalCode(code)) || checkpoint.attempts >= budget;''', '''    const failure: WorkspaceDiagnostic = invalidIdentity
      ? 'workspace-identity-invalid'
      : releaseFailed ? 'workspace-release-failed' : diagnosticOf(code);
    const spent = invalidIdentity || (releaseFailed ? false : terminalCode(code)) || checkpoint.attempts >= budget;''')
replace(p, '''  const committed = await guarded(async (context) => {
    await context.save(open, 'RUNNING');
    await context.saveStepExecution({
      stepExecutionId,
      planStepId: checkpoint.stepId,
      workItemId: null,
      action: WORKSPACE_ACTION,
      state: 'SUCCEEDED',
      attempt: checkpoint.attempts,
      startedAt,
      completedAt: deps.clock.now().toISOString(),
      diagnostic: null,
    });
    await event(context, diagnostic, 'RUNNING', open, {
      attempt: checkpoint.attempts,
      ...(deniedTotal > 0 ? { deniedTotal } : {}),
    });
    await recordDenials(context, denials);
  });''', '''  let committed: boolean;
  try {
    committed = await guarded(async (context) => {
      await context.save(open, 'RUNNING');
      await context.saveStepExecution({
        stepExecutionId,
        planStepId: checkpoint.stepId,
        workItemId: null,
        action: WORKSPACE_ACTION,
        state: 'SUCCEEDED',
        attempt: checkpoint.attempts,
        startedAt,
        completedAt: deps.clock.now().toISOString(),
        diagnostic: null,
      });
      await event(context, diagnostic, 'RUNNING', open, {
        attempt: checkpoint.attempts,
        ...(deniedTotal > 0 ? { deniedTotal } : {}),
      });
      await recordDenials(context, denials);
    });
  } catch (error) {
    let recovered: 'committed' | 'failed' | 'retained' | 'lost';
    try {
      // A lost COMMIT acknowledgement is not proof of a rollback. Re-read under
      // the Run lock before ending a Run or releasing a possibly committed browser.
      recovered = await deps.repository.transaction(job.runId, async (context) => {
        const current = context.checkpoint;
        if (current?.status === 'OPEN' && current.revision === open.revision &&
            current.workspaceId === open.workspaceId && context.run?.state === 'RUNNING') {
          return 'committed';
        }
        if (context.run?.state !== 'RUNNING' || current?.status !== 'PROVISIONING' ||
            current.revision !== checkpoint.revision) {
          return current?.workspaceId === open.workspaceId ? 'retained' : 'lost';
        }
        // OPEN rolled back and this is still our lease. Retain the valid identity
        // on FAILED so the reaper can finish an unavailable cleanup.
        const failed: WorkspaceCheckpoint = { ...open, status: 'FAILED', diagnostic: 'workspace-persistence-failed' };
        await context.save(failed, 'RUN_FAILED');
        await context.saveStepExecution({
          stepExecutionId,
          planStepId: checkpoint.stepId,
          workItemId: null,
          action: WORKSPACE_ACTION,
          state: 'FAILED',
          attempt: checkpoint.attempts,
          startedAt,
          completedAt: deps.clock.now().toISOString(),
          diagnostic: 'workspace-persistence-failed',
        });
        await event(context, 'workspace-persistence-failed', 'RUN_FAILED', failed, { attempt: checkpoint.attempts }, 'failure');
        await completeRun(context, { run, state: 'RUN_FAILED', at: deps.clock.now().toISOString(), plan });
        return 'failed';
      });
    } catch (confirmationError) {
      // Ownership is unknown. Do not revoke a session that might have committed.
      // A persisted identity is reaped; otherwise provider lifetime is the backstop.
      reportWorkspaceFailure(deps, job.runId, 'workspace-persistence-unconfirmed', confirmationError);
      throw new Error('Workspace persistence could not be confirmed');
    }
    if (recovered === 'committed') {
      return workspaceReplaced
        ? { retry: false, provisioned: true, workspaceReplaced: true, deferred: false }
        : { retry: false, provisioned: true, deferred: false };
    }
    reportWorkspaceFailure(deps, job.runId, 'workspace-persistence-failed', error);
    if (recovered === 'failed') {
      await releaseWorkspace(deps, job.runId).catch((cleanupError: unknown) => {
        reportWorkspaceFailure(deps, job.runId, 'workspace-cleanup-failed', cleanupError);
      });
    } else if (recovered === 'lost' && createdByThisClaim) {
      await deps.browser.release(handle.ref, WORKSPACE_RELEASE_TIMEOUT_MS).catch((cleanupError: unknown) => {
        reportWorkspaceFailure(deps, job.runId, 'workspace-cleanup-failed', cleanupError);
      });
    }
    return { retry: false, provisioned: false, deferred: recovered !== 'failed' };
  }''')

p = 'apps/worker/src/main.ts'
n = Path(p).read_text().count('await provisionWorkspace(workspace, job)')
assert n >= 2
replace(p, 'await provisionWorkspace(workspace, job)', 'await provision(job)', n)
replace(p, '''    repository: new PostgresWorkspaceRepository(db),
    browser,
    clock: new SystemClock(),
    ids: new CryptoUuidV7Generator(),
  };''', '''    repository: new PostgresWorkspaceRepository(db),
    browser,
    clock: new SystemClock(),
    ids: new CryptoUuidV7Generator(),
    reportFailure: (failure) => telemetry.captureError('Run stage failed', new Error('Workspace operation failed'), { ...failure }),
  };
  const provision = async (job: PopulationJob) => {
    try {
      return await provisionWorkspace(workspace, job);
    } catch (error) {
      telemetry.captureError('Run stage failed', new Error('Workspace stage failed'), {
        runId: job.runId, correlationId: job.correlationId,
        stage: 'workspace', diagnostic: 'workspace-persistence-unconfirmed',
      });
      throw error;
    }
  };''')
replace('packages/infrastructure/src/telemetry/sentry.ts', "  'Run ended',\n", "  'Run ended',\n  'Run stage failed',\n")
p = 'packages/infrastructure/src/runs/run-stop-repository.ts'
replace(p, '''             rw.status AS workspace_status, rw.diagnostic AS workspace_diagnostic,''', '''             CASE WHEN workspace_stop.diagnostic IS NOT NULL THEN 'FAILED' ELSE rw.status END AS workspace_status,
             coalesce(workspace_stop.diagnostic, rw.diagnostic) AS workspace_diagnostic,''')
replace(p, '''      LEFT JOIN run_workspace rw ON rw.run_id = r.run_id
''', '''      LEFT JOIN run_workspace rw ON rw.run_id = r.run_id
      -- Cleanup can clear the mutable failure. Preserve the original terminal cause.
      LEFT JOIN LATERAL (
        SELECT e.payload->>'diagnostic' AS diagnostic
        FROM audit_events e
        WHERE e.aggregate_id = r.run_id::text
          AND e.event_type = 'lifecycle.agent-workspace'
          AND e.outcome = 'failure' AND e.payload->>'state' = 'RUN_FAILED'
        ORDER BY e.sequence ASC LIMIT 1
      ) workspace_stop ON true
''')
replace('apps/web/src/runs/stop-reason.ts', "  'workspace-policy': 'A frozen origin could not be turned into a workspace policy.',", "  'workspace-policy': 'A frozen origin could not be turned into a workspace policy.',\n  'workspace-persistence-failed': 'The Agent Workspace opened, but the platform could not save its execution state. No audit conclusion was issued. Ask an administrator to check the worker and database before retrying.',\n  'workspace-identity-invalid': 'The Agent Workspace provider returned an identity this platform cannot retain. Ask an administrator to check the provider integration before retrying.',")

p = 'packages/application/src/runs/provision-workspace.test.ts'
replace(p, "describe('provisionWorkspace', () => {", "describe('provisionWorkspace', () => {\n" + r'''
  it('seals a named failure and releases a newly opened browser when OPEN persistence rolls back', async () => {
    const state = store(agentPlan());
    const browser = new FakeBrowser({ mode: 'solari', attachable: true });
    const notices: unknown[] = [];
    const deps = {
      ...DEPS(state, browser),
      reportFailure: (notice: unknown) => { notices.push(notice); },
      repository: {
        ...repository(state),
        transaction: async <T>(runId: string, work: (context: WorkspaceExecutionContext) => Promise<T>): Promise<T> =>
          repository(state).transaction(runId, async (context) => {
            const save = context.save;
            context.save = async (checkpoint, runState) => {
              if (checkpoint.status === 'OPEN') throw new Error('SQL and password MUST NOT ESCAPE', { cause: { code: '23514', detail: 'provider-secret', constraint_name: 'raw-secret' } });
              await save(checkpoint, runState);
            };
            return work(context);
          }),
      },
    };
    expect(await provisionWorkspace(deps, JOB)).toEqual({ retry: false, provisioned: false, deferred: false });
    expect(state.run?.state).toBe('RUN_FAILED');
    expect(state.result).not.toBeNull();
    expect(state.seal).not.toBeNull();
    expect(state.executions).toMatchObject([{ state: 'FAILED', action: 'create-workspace', diagnostic: 'workspace-persistence-failed' }]);
    expect(state.events).toEqual(expect.arrayContaining([expect.objectContaining({ outcome: 'failure', payload: expect.objectContaining({ diagnostic: 'workspace-persistence-failed', state: 'RUN_FAILED' }) })]));
    expect(browser.created).toEqual(['ws-1']);
    expect(browser.released).toEqual([{ runId: RUN.runId, workspaceId: 'ws-1', mode: 'solari' }]);
    expect(state.checkpoint?.status).toBe('RELEASED');
    expect(notices).toEqual([{ runId: RUN.runId, stage: 'workspace', diagnostic: 'workspace-persistence-failed', errorCode: '23514' }]);
    expect(JSON.stringify({ notices, events: state.events, executions: state.executions })).not.toMatch(/MUST NOT ESCAPE|provider-secret|raw-secret/);
  });

  it('retains the failed session for the reaper when cleanup is unavailable', async () => {
    const state = store(agentPlan());
    const browser = new FakeBrowser({ mode: 'solari', failRelease: new Error('cleanup-secret') });
    const notices: unknown[] = [];
    const deps = {
      ...DEPS(state, browser),
      reportFailure: (notice: unknown) => { notices.push(notice); },
      repository: {
        ...repository(state),
        transaction: async <T>(runId: string, work: (context: WorkspaceExecutionContext) => Promise<T>): Promise<T> =>
          repository(state).transaction(runId, async (context) => {
            const save = context.save;
            context.save = async (checkpoint, runState) => {
              if (checkpoint.status === 'OPEN') throw new Error('save-secret');
              await save(checkpoint, runState);
            };
            return work(context);
          }),
      },
    };
    expect(await provisionWorkspace(deps, JOB)).toMatchObject({ retry: false, provisioned: false });
    expect(state.checkpoint).toMatchObject({ status: 'FAILED', workspaceId: 'ws-1', diagnostic: 'workspace-persistence-failed' });
    expect(notices).toEqual(expect.arrayContaining([expect.objectContaining({ diagnostic: 'workspace-cleanup-failed' })]));
    expect(JSON.stringify(notices)).not.toMatch(/cleanup-secret|save-secret/);
  });

  it('does not release a committed workspace when only its commit acknowledgement was lost', async () => {
    const state = store(agentPlan());
    const browser = new FakeBrowser({ mode: 'solari' });
    let injected = false;
    const deps = {
      ...DEPS(state, browser),
      repository: {
        ...repository(state),
        transaction: async <T>(runId: string, work: (context: WorkspaceExecutionContext) => Promise<T>): Promise<T> => {
          const result = await repository(state).transaction(runId, work);
          if (!injected && state.checkpoint?.status === 'OPEN') { injected = true; throw new Error('lost acknowledgement'); }
          return result;
        },
      },
    };
    expect(await provisionWorkspace(deps, JOB)).toEqual({ retry: false, provisioned: true, deferred: false });
    expect(state.run?.state).toBe('RUNNING');
    expect(state.checkpoint?.status).toBe('OPEN');
    expect(state.executions).toHaveLength(1);
    expect(state.executions[0]?.state).toBe('SUCCEEDED');
    expect(browser.released).toEqual([]);
    expect(browser.created).toEqual(['ws-1']);
  });

  it('reports uncertainty without revoking a browser when the database cannot confirm ownership', async () => {
    const state = store(agentPlan());
    const browser = new FakeBrowser({ mode: 'solari' });
    const notices: unknown[] = [];
    let calls = 0;
    const deps = {
      ...DEPS(state, browser),
      reportFailure: (notice: unknown) => { notices.push(notice); },
      repository: {
        ...repository(state),
        transaction: async <T>(runId: string, work: (context: WorkspaceExecutionContext) => Promise<T>): Promise<T> => {
          calls += 1;
          if (calls > 1) throw new Error('database-secret', { cause: { code: '08006' } });
          return repository(state).transaction(runId, work);
        },
      },
    };
    await expect(provisionWorkspace(deps, JOB)).rejects.toThrow('Workspace persistence could not be confirmed');
    expect(notices).toEqual(expect.arrayContaining([expect.objectContaining({ stage: 'workspace', diagnostic: 'workspace-persistence-unconfirmed', errorCode: '08006' })]));
    expect(JSON.stringify(notices)).not.toContain('database-secret');
    expect(browser.released).toEqual([]);
    expect(browser.created).toEqual(['ws-1']);
  });

  it.each(['', 'x'.repeat(4097)])('refuses an unpersistable provider identity without logging or retaining it', async (workspaceId) => {
    const state = store(agentPlan());
    const browser = new FakeBrowser({ mode: 'solari' });
    browser.create = async ({ runId }) => ({ ref: { runId, workspaceId, mode: 'solari' }, expiresAt: null, takeDenials: () => [], denied: () => 0 });
    expect(await provisionWorkspace(DEPS(state, browser), JOB)).toMatchObject({ retry: false, provisioned: false });
    expect(state.run?.state).toBe('RUN_FAILED');
    expect(state.checkpoint).toMatchObject({ workspaceId: null, diagnostic: 'workspace-identity-invalid' });
    expect(browser.released).toHaveLength(1);
    expect(state.executions[0]?.diagnostic).toBe('workspace-identity-invalid');
    expect(JSON.stringify(state.events)).not.toContain('x'.repeat(4097));
  });

  it('cannot let a diagnostic observer or hostile error getter prevent failure sealing', async () => {
    const state = store(agentPlan());
    const browser = new FakeBrowser();
    const hostile = Object.create(null, { code: { get: () => { throw new Error('getter-secret'); } }, cause: { value: null } });
    const deps = {
      ...DEPS(state, browser),
      reportFailure: () => { throw new Error('sink-secret'); },
      repository: {
        ...repository(state),
        transaction: async <T>(runId: string, work: (context: WorkspaceExecutionContext) => Promise<T>): Promise<T> =>
          repository(state).transaction(runId, async (context) => {
            const save = context.save;
            context.save = async (checkpoint, runState) => {
              if (checkpoint.status === 'OPEN') throw hostile;
              await save(checkpoint, runState);
            };
            return work(context);
          }),
      },
    };
    await expect(provisionWorkspace(deps, JOB)).resolves.toMatchObject({ retry: false, provisioned: false });
    expect(state.run?.state).toBe('RUN_FAILED');
    expect(browser.released).toHaveLength(1);
  });
''')

p = 'tests/integration/agent-workspace.test.ts'
replace(p, '  DrizzleRunRepository,\n', '  DrizzleRunRepository,\n  DrizzleRunStopReader,\n')
replace(p, '  type WorkspaceRef,\n', '  type WorkspaceRef,\n  type WorkspaceExecutionContext,\n')
replace(p, "  it('provisions one workspace, bound to the Run, and records it on the Timeline', async () => {", r'''  it('preserves a real rolled-back OPEN failure after cleanup and on the Run stop reader', async () => {
    const job = await seed('web');
    const workspaceId = 'B'.repeat(768);
    const ref: WorkspaceRef = { runId: job.runId, workspaceId, mode: 'solari' };
    let releases = 0;
    const execution: BrowserExecution = {
      mode: 'solari',
      create: async () => ({ ref, expiresAt: null, takeDenials: () => [], denied: () => 0 }),
      attach: async () => null,
      release: async () => { releases += 1; },
      downloadRecording: async () => null,
      perform: async () => { throw new BrowserActionError('unavailable'); },
    };
    const actual = new PostgresWorkspaceRepository(db);
    const repository = {
      reapableRunIds: (after: string | null, limit: number) => actual.reapableRunIds(after, limit),
      transaction: <T>(runId: string, work: (context: WorkspaceExecutionContext) => Promise<T>): Promise<T> =>
        actual.transaction(runId, async (context) => {
          const save = context.save;
          context.save = async (checkpoint, runState) => {
            // A genuine CHECK violation: PostgreSQL rolls this OPEN transaction back.
            await save(checkpoint.status === 'OPEN' ? { ...checkpoint, attempts: 0 } : checkpoint, runState);
          };
          return work(context);
        }),
    };
    const notices: unknown[] = [];
    expect(await provisionWorkspace({ ...deps(execution), repository, reportFailure: (notice) => { notices.push(notice); } }, job)).toMatchObject({ retry: false, provisioned: false });
    expect((await new DrizzleRunRepository(db).findRun(job.runId))?.state).toBe('RUN_FAILED');
    expect(await row(job.runId)).toMatchObject({ status: 'RELEASED', workspace_id: workspaceId });
    expect(releases).toBe(1);
    const stop = await new DrizzleRunStopReader(db).readStop(job.runId);
    expect(stop?.stop).toEqual({ stage: 'workspace', diagnostic: 'workspace-persistence-failed' });
    const executions = await sql<{ state: string; diagnostic: string }[]>`SELECT state,diagnostic FROM run_step_execution WHERE run_id=${job.runId}`;
    expect(executions).toEqual([{ state: 'FAILED', diagnostic: 'workspace-persistence-failed' }]);
    expect(notices).toEqual([expect.objectContaining({ errorCode: '23514', stage: 'workspace' })]);
    expect(JSON.stringify(notices)).not.toContain(workspaceId);
  });

  it('continues to report a terminal provider refusal after its empty workspace row is released', async () => {
    const job = await seed('web');
    const execution: BrowserExecution = {
      mode: 'solari',
      create: async () => { throw new WorkspaceProvisionError('entitlement'); },
      attach: async () => null,
      release: async () => undefined,
      downloadRecording: async () => null,
      perform: async () => { throw new BrowserActionError('unavailable'); },
    };
    await provisionWorkspace(deps(execution), job);
    await releaseWorkspace(deps(execution), job.runId);
    expect(await row(job.runId)).toMatchObject({ status: 'RELEASED' });
    expect((await new DrizzleRunStopReader(db).readStop(job.runId))?.stop).toEqual({ stage: 'workspace', diagnostic: 'workspace-entitlement' });
  });

''' + "  it('provisions one workspace, bound to the Run, and records it on the Timeline', async () => {")

p = 'packages/infrastructure/src/telemetry/telemetry.test.ts'
replace(p, "describe('telemetry sanitizer', () => {", "describe('telemetry sanitizer', () => {\n" + r'''
  it('keeps workspace stage and closed database diagnostics without exposing the exception', () => {
    const chunks: string[] = [];
    const captures: unknown[] = [];
    const telemetry = createTelemetry({ serviceName: 'worker', destination: { write: (chunk: string) => chunks.push(chunk) }, sentrySink: { capture: (message, fields) => { captures.push({ message, fields }); } } });
    telemetry.captureError('Run stage failed', new Error('password-and-provider-secret'), { runId: '019823ab-0000-7000-8000-000000000001', stage: 'workspace', diagnostic: 'workspace-persistence-failed', errorCode: '23514' });
    for (const output of [chunks.join(''), JSON.stringify(captures)]) {
      expect(output).toContain('Run stage failed');
      expect(output).toContain('workspace-persistence-failed');
      expect(output).toContain('23514');
      expect(output).not.toContain('password-and-provider-secret');
    }
  });
''')

p = Path('CLAUDE.md')
p.write_text('''## 2026-09-16 — A provider success is not a committed workspace

The provider catch did not enclose the OPEN checkpoint transaction. A database CHECK
failure escaped after a browser existed, leaving PROVISIONING and no failed Step
Execution. Provisioning now seals a named workspace-persistence-failed stop in a fresh
transaction, retains the valid session identity for cleanup/reaping, and releases it
outside that transaction. Reconcile a lost COMMIT acknowledgement under the Run lock
before any release: never revoke a committed or newer claimant's session. When ownership
cannot be read, report workspace-persistence-unconfirmed; do not guess that COMMIT failed
or claim cleanup succeeded. Provider lifetime remains the backstop during database outage.

Diagnostics carry only Run/stage/closed codes. A bounded, getter-free cause walk admits
known SQLSTATE/transport codes, never messages, SQL parameters, provider identities, URLs
or arbitrary properties. Telemetry cannot break sealing. Invalid provider IDs fail explicitly.
Cleanup changes FAILED to RELEASED; the reader recovers the FIRST terminal workspace
failure from the immutable chain, so UI surfaces and Run-ended logs retain the cause.
Tests cover rollback, unavailable cleanup, lost acknowledgement, database outage, invalid
IDs and hostile diagnostics; PostgreSQL proves a real CHECK rollback and the retained
Step Execution/stop reason after release. This does not certify live Watch or Replay.

''' + p.read_text())
print('PHASE2_PATCH_APPLIED')
