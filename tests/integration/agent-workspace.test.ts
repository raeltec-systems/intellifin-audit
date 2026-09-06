import { createServer, type Server } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  provisionWorkspace,
  releaseWorkspace,
  BrowserActionError,
  WorkspaceProvisionError,
  type BrowserExecution,
  type WorkspaceHandle,
  type WorkspaceRef,
} from '@intellifin/application';
import {
  bindingDigest,
  bindingDigestEnvelope,
  initialDraftPopulation,
  initialDraftCompliance,
  initialDraftEvidence,
  initialDraftSections,
  registrationDigest,
  snapshotFromRegistration,
} from '@intellifin/domain';
import {
  createDb,
  createSqlClient,
  CryptoUuidV7Generator,
  DrizzleRoleRepository,
  DrizzleRunRepository,
  PostgresProceduresUnitOfWork,
  PostgresRunsUnitOfWork,
  PostgresWorkspaceRepository,
  startWorkspaceReaper,
  SystemClock,
  type Database,
  type Sql,
} from '@intellifin/infrastructure';
import {
  PlaywrightBrowserExecution,
  type PlaywrightWorkspace,
} from '@intellifin/infrastructure/browser';
import { initiateRun } from '@intellifin/application';
import { activeRunVersion } from '../fixtures/active-run-version.js';

/**
 * The Agent Workspace against a real PostgreSQL 18 and a real Chromium (Story 4.1).
 *
 * `provision-workspace.test.ts` pins the command's decisions over a fake provider;
 * `browser-execution.test.ts` pins the egress predicate. Neither can say whether a request
 * actually left the machine, and a policy that agrees with a test proves nothing about
 * that. Everything here therefore runs a browser and a real HTTP server, and the server's
 * own request log is what settles whether a denied destination was reached.
 *
 * The local mode is what these tests drive, and it is the WEAKER of the two guarantees:
 * browser state is isolated per Run and the worker process is not isolated at all. The
 * Solari path is the same code and cannot be exercised here — there is no API key in this
 * environment — so what is proved is the browser-state half, by name.
 */

const url = process.env.DATABASE_URL;

describe.skipIf(!url)('the isolated Agent Workspace', () => {
  let sql: Sql;
  let db: Database;
  let server: Server;
  let origin = '';
  const ids = new CryptoUuidV7Generator();
  const author = ids.next();
  const procedures: string[] = [];
  const bindings: string[] = [];
  const workspaces: PlaywrightBrowserExecution[] = [];
  /** Every path the real server was actually asked for. The denial proof lives here. */
  let requested: string[] = [];

  beforeAll(async () => {
    const target = new URL(url!);
    if (
      !['localhost', '127.0.0.1', '[::1]', 'postgres', 'db'].includes(target.hostname) ||
      !/(?:^|[_-])(?:test|ci)(?:[_-]|$)/i.test(target.pathname.slice(1))
    ) {
      throw new Error('Agent Workspace tests require an isolated local or CI test database');
    }
    sql = createSqlClient(url!, { max: 5 });
    db = createDb(sql);
    await sql`INSERT INTO auth_user(id,name,email) VALUES(${author},'Workspace test',${author + '@test.invalid'})`;
    await sql`INSERT INTO user_role(user_id,role) VALUES(${author},'auditor')`;
    server = createServer((request, response) => {
      requested.push(request.url ?? '');
      response.writeHead(200, {
        'content-type': 'text/html; charset=utf-8',
        'set-cookie': `visit=${request.url ?? ''}; Path=/`,
      });
      response.end('<!doctype html><title>synthetic</title><body>synthetic</body>');
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    origin = `http://127.0.0.1:${String((server.address() as { port: number }).port)}/console`;
  });

  afterAll(async () => {
    for (const execution of workspaces) await execution.close().catch(() => undefined);
    if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
    if (!sql) return;
    try {
      for (const id of procedures) {
        const runs = await sql<{ id: string }[]>`SELECT run_id::text AS id FROM audit_run WHERE procedure_id=${id}`;
        for (const run of runs) {
          await sql`DELETE FROM pgboss.job WHERE name='runs' AND data->>'runId'=${run.id}`;
          await sql`DELETE FROM run_step_execution WHERE run_id=${run.id}`;
          await sql`DELETE FROM run_gate_check WHERE run_id=${run.id}`;
          await sql`DELETE FROM run_result WHERE run_id=${run.id}`;
          await sql`DELETE FROM run_evidence_integrity WHERE run_id=${run.id}`;
          await sql`DELETE FROM run_evidence_package WHERE run_id=${run.id}`;
          await sql`DELETE FROM audit_events WHERE aggregate_id=${run.id}`;
          await sql`DELETE FROM audit_event_heads WHERE aggregate_id=${run.id}`;
          await sql`DELETE FROM run_initiation_request WHERE run_id=${run.id}`;
        }
        // `run_workspace` cascades from `audit_run`, deliberately: it is operational state
        // rather than a recorded outcome, and a foreign key nobody knew about does not fail
        // its own suite — it leaves rows behind and fails an unrelated one later on a count.
        await sql`DELETE FROM audit_run WHERE procedure_id=${id}`;
        await sql`DELETE FROM procedure_version WHERE procedure_id=${id}`;
        await sql`DELETE FROM procedure WHERE procedure_id=${id}`;
      }
      for (const id of bindings) await sql`DELETE FROM population_source_binding WHERE binding_id=${id}`;
      await sql`DELETE FROM auth_user WHERE id=${author}`;
    } finally {
      await sql.end({ timeout: 5 });
    }
  });

  /** One ACTIVE Procedure Version and one QUEUED Run, agent-driven or adapter-only. */
  async function seed(kind: 'web' | 'api'): Promise<{ schemaVersion: 1; runId: string; correlationId: string }> {
    const source = {
      kind: 'versioned-file' as const,
      location: 'https://synthetic.invalid/accounts.csv',
      declaredSchema: ['account_id', 'status'],
      sensitiveFields: [],
      declaredCountMechanism: 'cover-sheet' as const,
    };
    const registration = {
      registrationId: ids.next(),
      displayName: 'AccessGate',
      kind,
      allowedOrigins: [origin],
      applicationIdentity: '',
      credentialRef: 'vault://synthetic/access',
      permittedActions:
        kind === 'web'
          ? (['navigate', 'read-attribute'] as const)
          : (['list-records', 'read-attribute'] as const),
      attributeLabelPatterns: ['Account'],
      secondaryKey: '',
    };
    const inputs = {
      ...initialDraftPopulation('P-2'),
      ...initialDraftCompliance('P-2'),
      ...initialDraftEvidence('P-2'),
      templateId: 'P-2' as const,
      controlName: 'Agent Workspace integration',
      sections: initialDraftSections('P-2'),
      scope: 'All accounts',
      period: { from: '2026-08-01', to: '2026-08-31' },
      sourceSnapshot: {
        bindingId: ids.next(),
        displayName: 'Accounts',
        digest: bindingDigest(source),
        contract: bindingDigestEnvelope(source),
      },
      schedule: {
        frequency: 'once' as const,
        startTime: '00:00',
        periodDerivationRule: 'explicit-period' as const,
      },
      targets: [snapshotFromRegistration({ ...registration, digest: registrationDigest(registration) })],
      instructions:
        kind === 'web'
          ? [{ registrationId: registration.registrationId, text: 'Read the account role list.' }]
          : [],
    };
    bindings.push(inputs.sourceSnapshot.bindingId);
    await sql`INSERT INTO population_source_binding(binding_id,display_name,kind,location,declared_schema,declared_count_mechanism,digest) VALUES (${inputs.sourceSnapshot.bindingId},'Accounts',${source.kind},${source.location},${source.declaredSchema},${source.declaredCountMechanism},${inputs.sourceSnapshot.digest})`;
    const row = activeRunVersion(ids.next(), ids.next(), author, inputs);
    procedures.push(row.procedureId);
    await new PostgresProceduresUnitOfWork(db).execute(async (context) => {
      await context.procedures.insertProcedure(row);
      await context.procedures.insertVersion(row);
    });
    const started = await initiateRun(
      {
        roles: new DrizzleRoleRepository(db),
        unitOfWork: new PostgresRunsUnitOfWork(db),
        ids,
        clock: new SystemClock(),
      },
      {
        session: { userId: author, sessionId: author },
        request: { procedureId: row.procedureId, period: inputs.period, requestToken: ids.next() },
      },
    );
    if (!started.ok) throw new Error(started.reason);
    const run = (await new DrizzleRunRepository(db).findRun(started.runId))!;
    return { schemaVersion: 1, runId: run.runId, correlationId: run.correlationId };
  }

  /**
   * Drive a Run to a terminal state by raw SQL, sealing it first.
   *
   * Generation 21 refuses a terminal Run with no Evidence package and generation 25 refuses
   * one with no Result, both as DEFERRED constraint triggers — so a bare state update fails
   * to commit. Three statements, because postgres.js autocommits each one and the deferred
   * check fires at the end of the last.
   */
  async function terminate(runId: string, state: 'RUN_FAILED' | 'INCONCLUSIVE'): Promise<void> {
    await sql`INSERT INTO run_evidence_package(run_id,state,run_state,sealed_at,required_total,registered,missing_required,abandoned)
              VALUES(${runId},'SEALED',${state},now(),0,0,'[]'::jsonb,'[]'::jsonb) ON CONFLICT DO NOTHING`;
    // §E.1's row, not the Run state spelled differently: an INCONCLUSIVE outcome is
    // `gate-failed` or `unevaluated`, and `run_result_row` refuses anything else.
    await sql`INSERT INTO run_result(run_id,version,outcome,outcome_row,sealed,run_state,gate_passed,sealed_at,scope,publication)
              VALUES(${runId},1,${state},${state === 'RUN_FAILED' ? 'run-failed' : 'gate-failed'},true,${state},false,now(),NULL,'{}'::jsonb) ON CONFLICT DO NOTHING`;
    await sql`UPDATE audit_run SET state=${state} WHERE run_id=${runId}`;
  }

  /** A fresh execution instance is what a RESTARTED worker actually looks like. */
  function browser(): PlaywrightBrowserExecution {
    const execution = new PlaywrightBrowserExecution({ mode: 'local' });
    workspaces.push(execution);
    return execution;
  }

  function deps(execution: BrowserExecution) {
    return {
      repository: new PostgresWorkspaceRepository(db),
      browser: execution,
      clock: new SystemClock(),
      ids: new CryptoUuidV7Generator(),
    };
  }

  async function row(runId: string) {
    const rows = await sql<
      {
        status: string;
        mode: string;
        workspace_id: string | null;
        expires_at: Date | null;
        attempts: number;
        step_id: string;
        released_at: Date | null;
        diagnostic: string | null;
      }[]
    >`SELECT status,mode,workspace_id,expires_at,attempts,step_id,released_at,diagnostic FROM run_workspace WHERE run_id=${runId}`;
    return rows[0] ?? null;
  }

  async function events(runId: string) {
    return sql<{ event_type: string; payload: Record<string, unknown> }[]>`
      SELECT event_type, payload FROM audit_events WHERE aggregate_id=${runId} ORDER BY sequence`;
  }

  it('provisions one workspace, bound to the Run, and records it on the Timeline', async () => {
    const job = await seed('web');
    const execution = browser();
    expect(await provisionWorkspace(deps(execution), job)).toEqual({ retry: false, provisioned: true });
    const stored = await row(job.runId);
    expect(stored).toMatchObject({ status: 'OPEN', mode: 'local', attempts: 1, released_at: null });
    expect(stored?.workspace_id).toMatch(/^[0-9a-f-]{36}$/);
    // A locally launched browser has no plan-tier deadline, and a fabricated one would be a
    // fact nobody measured.
    expect(stored?.expires_at).toBeNull();
    // The FROZEN `create-workspace` step, which the compiler emits first for an agent plan.
    expect(stored?.step_id).toBe('session-1');
    const executions = await sql<{ action: string; state: string; plan_step_id: string }[]>`
      SELECT action,state,plan_step_id FROM run_step_execution WHERE run_id=${job.runId}`;
    expect(executions).toEqual([
      { action: 'create-workspace', state: 'SUCCEEDED', plan_step_id: 'session-1' },
    ]);
    const appended = await events(job.runId);
    const workspace = appended.filter((entry) => entry.event_type === 'lifecycle.agent-workspace');
    expect(workspace).toHaveLength(1);
    expect(workspace[0]?.payload).toMatchObject({
      diagnostic: 'workspace-created',
      mode: 'local',
      workspaceId: stored?.workspace_id,
    });
    // Nothing credential-shaped, and no wire-protocol endpoint, can be in the chain.
    expect(JSON.stringify(workspace[0]?.payload)).not.toMatch(/ws:\/\/|wss:\/\/|apiKey|token/i);
  }, 60_000);

  it('provisions nothing at all for an adapter-only Run', async () => {
    const job = await seed('api');
    const execution = browser();
    expect(await provisionWorkspace(deps(execution), job)).toEqual({ retry: false, provisioned: false });
    expect(await row(job.runId)).toBeNull();
    expect((await events(job.runId)).filter((e) => e.event_type === 'lifecycle.agent-workspace')).toEqual([]);
  }, 60_000);

  it('reattaches by the stored identity rather than creating a second workspace', async () => {
    const job = await seed('web');
    const execution = browser();
    await provisionWorkspace(deps(execution), job);
    const first = await row(job.runId);
    // The claim was lost — a lease that expired while the process stayed up.
    await sql`UPDATE run_workspace SET status='RETRY' WHERE run_id=${job.runId}`;
    await provisionWorkspace(deps(execution), job);
    const second = await row(job.runId);
    expect(second?.workspace_id).toBe(first?.workspace_id);
    expect(second).toMatchObject({ status: 'OPEN', attempts: 2 });
    expect((await events(job.runId)).at(-1)?.payload).toMatchObject({
      diagnostic: 'workspace-reattached',
    });
  }, 60_000);

  it('releases the stale identity and makes one replacement when the worker has restarted', async () => {
    const job = await seed('web');
    await provisionWorkspace(deps(browser()), job);
    const first = await row(job.runId);
    await sql`UPDATE run_workspace SET status='RETRY' WHERE run_id=${job.runId}`;
    // A DIFFERENT execution instance is what a restarted worker is: a browser does not
    // survive the process that connected to it, so the identity cannot be reattached to.
    await provisionWorkspace(deps(browser()), job);
    const second = await row(job.runId);
    expect(second?.workspace_id).not.toBe(first?.workspace_id);
    expect(second).toMatchObject({ status: 'OPEN' });
    expect((await events(job.runId)).at(-1)?.payload).toMatchObject({
      diagnostic: 'workspace-reattach-failed',
    });
  }, 60_000);

  it('lets a request inside the frozen origins through and denies every other destination', async () => {
    const job = await seed('web');
    const execution = browser();
    await provisionWorkspace(deps(execution), job);
    const stored = await row(job.runId);
    const handle = (await execution.attach({
      runId: job.runId,
      workspaceId: stored!.workspace_id!,
      mode: 'local',
    })) as PlaywrightWorkspace;
    requested = [];
    const page = await handle.context.newPage();

    const allowed = await page.goto(`${origin}/accounts`);
    expect(allowed?.status()).toBe(200);
    // The same host and port, one path segment outside the frozen origin.
    await expect(page.goto(`${origin}-other/accounts`)).rejects.toThrow();
    // The server's own log is the proof: the denied request never left the browser.
    expect(requested).toEqual(['/console/accounts']);

    await terminate(job.runId, 'RUN_FAILED');
    await releaseWorkspace(deps(execution), job.runId);
    const denials = (await events(job.runId)).filter((e) => e.event_type === 'security.action-denied');
    expect(denials).toHaveLength(1);
    expect(denials[0]?.payload).toMatchObject({
      cause: 'scope-violation',
      diagnostic: 'workspace-egress-denied',
      destination: `${origin}-other/accounts`,
    });
    expect(await row(job.runId)).toMatchObject({ status: 'RELEASED' });
  }, 90_000);

  it('keeps two concurrent Runs from seeing each other cookies, storage or session', async () => {
    const first = await seed('web');
    const second = await seed('web');
    const execution = browser();
    await provisionWorkspace(deps(execution), first);
    await provisionWorkspace(deps(execution), second);
    const handles = await Promise.all(
      [first, second].map(async (job) => {
        const stored = await row(job.runId);
        return (await execution.attach({
          runId: job.runId,
          workspaceId: stored!.workspace_id!,
          mode: 'local',
        })) as PlaywrightWorkspace;
      }),
    );
    const pages = await Promise.all(handles.map((handle) => handle.context.newPage()));
    await pages[0]!.goto(`${origin}/one`);
    await pages[1]!.goto(`${origin}/two`);
    await pages[0]!.evaluate("localStorage.setItem('who','run-one')");
    await pages[1]!.evaluate("localStorage.setItem('who','run-two')");

    // Browser state — cookies, localStorage, session — is isolated per Run. This is the
    // half the local mode delivers; the worker PROCESS is shared and is not isolated at
    // all, which is exactly why the mode is recorded on every workspace row.
    expect(await pages[0]!.evaluate('localStorage.getItem("who")')).toBe('run-one');
    expect(await pages[1]!.evaluate('localStorage.getItem("who")')).toBe('run-two');
    const cookies = await Promise.all(handles.map((handle) => handle.context.cookies()));
    expect(cookies[0]?.map((cookie) => cookie.value)).toEqual(['/console/one']);
    expect(cookies[1]?.map((cookie) => cookie.value)).toEqual(['/console/two']);
    expect((await row(first.runId))?.workspace_id).not.toBe((await row(second.runId))?.workspace_id);
  }, 90_000);

  it('reaps a workspace whose Run has ended and leaves one whose Run can still act', async () => {
    const ended = await seed('web');
    const live = await seed('web');
    const execution = browser();
    await provisionWorkspace(deps(execution), ended);
    await provisionWorkspace(deps(execution), live);
    await terminate(ended.runId, 'INCONCLUSIVE');

    const repository = new PostgresWorkspaceRepository(db);
    const selected = await repository.reapableRunIds(null, 100);
    expect(selected).toContain(ended.runId);
    expect(selected).not.toContain(live.runId);

    const reaped: string[] = [];
    const stop = startWorkspaceReaper(
      { reapableRunIds: (after, limit) => repository.reapableRunIds(after, limit) },
      async (runId) => {
        reaped.push(runId);
        await releaseWorkspace(deps(execution), runId);
      },
      () => undefined,
      { intervalMs: 3_600_000 },
    );
    await new Promise((resolve) => setTimeout(resolve, 200));
    await stop();
    expect(reaped).toContain(ended.runId);
    expect(await row(ended.runId)).toMatchObject({ status: 'RELEASED' });
    expect(await row(live.runId)).toMatchObject({ status: 'OPEN', released_at: null });
  }, 90_000);

  it('reaps a FAILED workspace that still names a session nothing could give back', async () => {
    const job = await seed('web');
    const workspaceId = ids.next();
    // Reattach impossible AND the release throws. The adapter resolves `InvalidSessionId`
    // and a 404 as SUCCESS, so a throw is an outage, a capacity refusal or a policy denial
    // and the remote session may well still be running. No replacement is made, the row
    // keeps the identity, and the budget runs out with it still there.
    const holding: BrowserExecution = {
      mode: 'local',
      create: (input: { runId: string }): Promise<WorkspaceHandle> =>
        Promise.resolve({
          ref: { runId: input.runId, workspaceId, mode: 'local' },
          expiresAt: null,
          takeDenials: () => [],
          denied: () => 0,
        }),
      attach: (): Promise<WorkspaceHandle | null> => Promise.resolve(null),
      release: (_ref: WorkspaceRef) => Promise.reject(new Error('the provider did not answer')),
      perform: () => Promise.reject(new BrowserActionError('unavailable')),
    };
    await provisionWorkspace(deps(holding), job);
    expect(await row(job.runId)).toMatchObject({ status: 'OPEN', workspace_id: workspaceId });
    // The claim was lost once; every attempt after that fails on its own and leaves RETRY.
    await sql`UPDATE run_workspace SET status='RETRY' WHERE run_id=${job.runId}`;
    for (const attempt of [2, 3]) {
      expect(await provisionWorkspace(deps(holding), job)).toEqual({ retry: true, provisioned: false });
      expect(await row(job.runId)).toMatchObject({
        status: 'RETRY',
        attempts: attempt,
        workspace_id: workspaceId,
        diagnostic: 'workspace-release-failed',
      });
    }
    await provisionWorkspace(deps(holding), job);
    expect(await row(job.runId)).toMatchObject({
      status: 'FAILED',
      attempts: 4,
      workspace_id: workspaceId,
      diagnostic: 'workspace-release-failed',
    });
    expect((await new DrizzleRunRepository(db).findRun(job.runId))?.state).toBe('RUN_FAILED');

    // The property the whole thing turns on. Keeping the identity is worth nothing if the
    // backstop cannot see the row it is kept on, and `FAILED` is exactly where a Run in a
    // terminal state ends: a read that omitted the status could never finish the job.
    const repository = new PostgresWorkspaceRepository(db);
    expect(await repository.reapableRunIds(null, 100)).toContain(job.runId);

    // And once the provider answers again, the reaper is what gives the session back.
    const answering: BrowserExecution = { ...holding, release: () => Promise.resolve() };
    const reaped: string[] = [];
    const stop = startWorkspaceReaper(
      { reapableRunIds: (after, limit) => repository.reapableRunIds(after, limit) },
      async (runId) => {
        reaped.push(runId);
        await releaseWorkspace(deps(answering), runId);
      },
      () => undefined,
      { intervalMs: 3_600_000, page: 100 },
    );
    await new Promise((resolve) => setTimeout(resolve, 200));
    await stop();
    expect(reaped).toContain(job.runId);
    expect(await row(job.runId)).toMatchObject({ status: 'RELEASED', workspace_id: workspaceId });
  }, 90_000);

  it('fails the Run when provisioning is exhausted, and seals a Result for it', async () => {
    const job = await seed('web');
    const failing: BrowserExecution = {
      mode: 'local',
      create: () => Promise.reject(new WorkspaceProvisionError('unavailable')),
      attach: (): Promise<WorkspaceHandle | null> => Promise.resolve(null),
      release: (_ref: WorkspaceRef) => Promise.resolve(),
      // Story 4.2's port member. A workspace that never provisioned cannot act in one.
      perform: () => Promise.reject(new BrowserActionError('unavailable')),
    };
    for (const attempt of [1, 2, 3]) {
      expect(await provisionWorkspace(deps(failing), job)).toEqual({ retry: true, provisioned: false });
      expect(await row(job.runId)).toMatchObject({ status: 'RETRY', attempts: attempt });
    }
    expect(await provisionWorkspace(deps(failing), job)).toEqual({ retry: false, provisioned: false });
    expect(await row(job.runId)).toMatchObject({
      status: 'FAILED',
      attempts: 4,
      diagnostic: 'workspace-unavailable',
    });
    expect((await new DrizzleRunRepository(db).findRun(job.runId))?.state).toBe('RUN_FAILED');
    // §E makes a Run-level Session Step's exhaustion RUN_FAILED, and generation 25 refuses a
    // terminal Run with no Result — so a branch that forgot would fail to commit.
    const results = await sql<{ outcome: string }[]>`SELECT outcome FROM run_result WHERE run_id=${job.runId}`;
    expect(results).toHaveLength(1);
    expect(results[0]?.outcome).toBe('RUN_FAILED');
  }, 60_000);

  describe('the generation-27 constraints, asserted with raw SQL', () => {
    /** A constraint tested through the command proves nothing about the constraint. */
    async function insert(
      overrides: {
        status?: string;
        attempts?: number;
        mode?: string;
        workspaceId?: string | null;
        releasedAt?: string | null;
      } = {},
    ): Promise<void> {
      const job = await seed('web');
      const now = new Date().toISOString();
      // Columns and casts written out: a raw statement has no column type to infer from,
      // so every timestamp goes as ISO text with an explicit `::timestamptz`.
      await sql`
        INSERT INTO run_workspace
          (run_id,revision,status,attempts,step_id,workspace_id,mode,expires_at,
           started_at,attempt_started_at,lease_until,released_at,diagnostic)
        VALUES (
          ${job.runId}, 1, ${overrides.status ?? 'OPEN'}, ${overrides.attempts ?? 1},
          'session-1', ${overrides.workspaceId === undefined ? 'ws-raw' : overrides.workspaceId},
          ${overrides.mode ?? 'local'}, NULL,
          ${now}::timestamptz, ${now}::timestamptz, ${now}::timestamptz,
          ${overrides.releasedAt ?? null}::timestamptz, NULL)`;
    }

    it('refuses an OPEN workspace that names no identity', async () => {
      await expect(insert({ workspaceId: null })).rejects.toThrow(/run_workspace_open_identity/);
    });

    it('refuses a released row with no release time, and a live row that has one', async () => {
      await expect(insert({ status: 'RELEASED', releasedAt: null })).rejects.toThrow(
        /run_workspace_released_at/,
      );
      await expect(insert({ status: 'OPEN', releasedAt: new Date().toISOString() })).rejects.toThrow(
        /run_workspace_released_at/,
      );
    });

    it('refuses a status, a mode and an attempt count outside the vocabulary', async () => {
      await expect(insert({ status: 'HELD' })).rejects.toThrow(/run_workspace_status/);
      await expect(insert({ mode: 'puppeteer' })).rejects.toThrow(/run_workspace_mode/);
      await expect(insert({ attempts: 5 })).rejects.toThrow(/run_workspace_counts/);
      await expect(insert({ attempts: 0 })).rejects.toThrow(/run_workspace_counts/);
    });

    it('accepts a RELEASED row that names its release time', async () => {
      await expect(
        insert({ status: 'RELEASED', releasedAt: new Date().toISOString() }),
      ).resolves.toBeUndefined();
    });
  });
});
