import { createServer, type IncomingMessage, type Server } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  executeAgentSteps,
  initiateRun,
  performToolAction,
  provisionWorkspace,
  type PopulationJob,
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
  REDACTED_CREDENTIAL,
  TOOL_ACTION_METHODS,
} from '@intellifin/domain';
import {
  createDb,
  createSqlClient,
  CryptoUuidV7Generator,
  DrizzleRoleRepository,
  DrizzleRunRepository,
  PostgresAgentExecutionRepository,
  PostgresProceduresUnitOfWork,
  PostgresRunsUnitOfWork,
  PostgresWorkspaceRepository,
  SystemClock,
  type Database,
  type Sql,
} from '@intellifin/infrastructure';
import { ManifestCredentialResolver } from '@intellifin/infrastructure/credentials';
import { NO_CREDENTIALS } from '@intellifin/application';
import { PlaywrightBrowserExecution } from '@intellifin/infrastructure/browser';
import { activeRunVersion } from '../fixtures/active-run-version.js';

/**
 * The agent sign-in phase against a real PostgreSQL 18 and a real Chromium (Story 4.2).
 *
 * `execute-agent-steps.test.ts` pins the command's decisions over a fake provider and
 * `tool-action.test.ts` pins the gate. Neither can say whether a credential actually
 * reached a system or whether a denied destination actually stayed off the wire, and a
 * policy that agrees with a test proves nothing about that. Everything here therefore runs
 * a browser against a real HTTP server that REQUIRES the credential — the shape LoanCore
 * itself now has — and the server's own request log is what settles it.
 *
 * The local browser mode is what these tests drive, and it is the WEAKER of the two
 * guarantees: browser state is isolated per Run, the worker process is not isolated at all.
 */

const url = process.env.DATABASE_URL;

/** Synthetic, and the point of the containment assertions below. */
const TOKEN = 'synthetic-integration-token-never-store-me';
const CREDENTIAL_REF = 'cred://synthetic/integration-loancore';

describe.skipIf(!url)('the agent sign-in phase', () => {
  let sql: Sql;
  let db: Database;
  let server: Server;
  let origin = '';
  const ids = new CryptoUuidV7Generator();
  const author = ids.next();
  const procedures: string[] = [];
  const bindings: string[] = [];
  const browsers: PlaywrightBrowserExecution[] = [];
  /** Every request the real server was asked for, and whether it carried the credential. */
  let requested: { path: string; method: string; credential: boolean; cookie: string }[] = [];
  /**
   * A synthetic system that puts the credential in a PATH it redirects to (Story 4.3).
   *
   * `sanitizeDestination` strips the query and `user:pass@` and keeps the path, so without
   * the redaction this would put a working credential into the immutable action log. It is
   * off by default, because it is the hostile case rather than the ordinary one.
   */
  let leakCredentialInPath = false;
  /**
   * A synthetic system whose sign-in form posts to ANOTHER origin (Story 4.2).
   *
   * The hostile case the form mechanism has to refuse: a plan naming two web Target
   * Systems puts BOTH origins in the workspace's egress allowlist, so a form on one
   * system's page pointing at the other's would hand it the first one's credential and the
   * interception would let it through. Off by default.
   */
  let crossOriginSignInForm = false;
  /**
   * A synthetic system whose sign-in form is `method="get"` (Story 4.2).
   *
   * The defect this repository has shipped three times, seen from the other side: a GET
   * form puts whatever is typed into the URL, into browser history, into the `Referer`
   * header and into every access log. The workspace refuses to type into one. Off by
   * default.
   */
  let getSignInForm = false;

  beforeAll(async () => {
    const target = new URL(url!);
    if (
      !['localhost', '127.0.0.1', '[::1]', 'postgres', 'db'].includes(target.hostname) ||
      !/(?:^|[_-])(?:test|ci)(?:[_-]|$)/i.test(target.pathname.slice(1))
    ) {
      throw new Error('Agent execution tests require an isolated local or CI test database');
    }
    sql = createSqlClient(url!, { max: 5 });
    db = createDb(sql);
    await sql`INSERT INTO auth_user(id,name,email) VALUES(${author},'Agent test',${author + '@test.invalid'})`;
    await sql`INSERT INTO user_role(user_id,role) VALUES(${author},'auditor')`;
    // The synthetic system, in the shape LoanCore now has: a real sign-in FORM at the
    // frozen origin, a `POST` that carries the credential in a body, a `303` to the home
    // page, and a session cookie. There is no header sign-in — leaving one would let every
    // assertion below pass against a build whose form does nothing.
    //
    // The page a signed-out caller is shown references a sub-resource at a DIFFERENT
    // system's origin. In the cross-origin test below both are inside the workspace's
    // egress allowlist — the UNION of the frozen web Targets' origins — so that is the
    // request which must not carry LoanCore's credential. In every other test it is
    // outside the allowlist, aborted in the browser, and must NOT fail the Tool Action: a
    // page referencing a font, a beacon or an image off-origin is ordinary.
    server = createServer((request: IncomingMessage, response) => {
      const path = request.url ?? '';
      const method = (request.method ?? 'GET').toUpperCase();
      const cookie = String(request.headers['cookie'] ?? '');
      const chunks: Buffer[] = [];
      request.on('data', (chunk: Buffer) => chunks.push(chunk));
      request.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf8');
        const credential = new URLSearchParams(body).get('credential') === TOKEN;
        requested.push({ path, method, credential, cookie });
        const signedIn = cookie.includes('session=granted');

        if (method === 'POST' && path.startsWith('/loancore/sign-in')) {
          if (!credential) {
            response.writeHead(401, { 'content-type': 'application/json; charset=utf-8' });
            response.end('{"error":"authentication_required"}');
            return;
          }
          response.writeHead(303, {
            location: '/loancore',
            'set-cookie': 'session=granted; Path=/',
          });
          response.end();
          return;
        }
        if (leakCredentialInPath && signedIn && path === '/loancore') {
          response.writeHead(302, { location: `/loancore/session/${TOKEN}` });
          response.end();
          return;
        }
        const other = origin.replace('/loancore', '/zelsewhere');
        const form = `<form method="${getSignInForm ? 'get' : 'post'}" action="${crossOriginSignInForm ? `${other}/sign-in` : '/loancore/sign-in'}"><input name="credential" type="password"><button type="submit">Sign in</button></form>`;
        response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        response.end(
          path.startsWith('/loancore')
            ? `<!doctype html><title>synthetic</title><body>synthetic<img src="/zelsewhere/pixel" alt="">${signedIn ? '<p role="status" aria-label="Current signed-in account">Signed in as audit.readonly</p>' : form}</body>`
            : '<!doctype html><title>synthetic</title><body>synthetic</body>',
        );
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    origin = `http://127.0.0.1:${String((server.address() as { port: number }).port)}/loancore`;
  });

  afterAll(async () => {
    for (const execution of browsers) await execution.close().catch(() => undefined);
    if (server) await new Promise<void>((resolve) => server.close(() => resolve()));
    if (!sql) return;
    try {
      for (const id of procedures) {
        const runs = await sql<{ id: string }[]>`SELECT run_id::text AS id FROM audit_run WHERE procedure_id=${id}`;
        for (const run of runs) {
          await sql`DELETE FROM pgboss.job WHERE name='runs' AND data->>'runId'=${run.id}`;
          // `run_tool_action` names a Step Execution with a real foreign key, so it goes first.
          await sql`DELETE FROM run_tool_action WHERE run_id=${run.id}`;
          await sql`DELETE FROM run_step_execution WHERE run_id=${run.id}`;
          await sql`DELETE FROM run_session_step WHERE run_id=${run.id}`;
          await sql`DELETE FROM run_gate_check WHERE run_id=${run.id}`;
          await sql`DELETE FROM run_result WHERE run_id=${run.id}`;
          await sql`DELETE FROM run_evidence_integrity WHERE run_id=${run.id}`;
          await sql`DELETE FROM run_evidence_package WHERE run_id=${run.id}`;
          await sql`DELETE FROM audit_events WHERE aggregate_id=${run.id}`;
          await sql`DELETE FROM audit_event_heads WHERE aggregate_id=${run.id}`;
          await sql`DELETE FROM run_initiation_request WHERE run_id=${run.id} OR refused_run_id=${run.id}`;
          await sql`DELETE FROM population_execution WHERE run_id=${run.id}`;
        }
        // `run_workspace` and `run_agent_execution` cascade from `audit_run`, deliberately:
        // both are operational state rather than a recorded outcome.
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

  /** One ACTIVE agent-driven Procedure Version and one QUEUED Run. */
  async function seed(options: { allowedOrigins?: readonly string[] } = {}): Promise<PopulationJob> {
    const source = {
      kind: 'versioned-file' as const,
      location: 'https://synthetic.invalid/accounts.csv',
      declaredSchema: ['account_id', 'status'],
      sensitiveFields: [],
      declaredCountMechanism: 'cover-sheet' as const,
    };
    const registration = {
      registrationId: ids.next(),
      displayName: 'LoanCore',
      kind: 'web' as const,
      allowedOrigins: options.allowedOrigins ?? [origin],
      applicationIdentity: '',
      credentialRef: CREDENTIAL_REF,
      permittedActions: ['navigate', 'search', 'read-attribute'] as const,
      attributeLabelPatterns: ['Account'],
      secondaryKey: '',
      authenticationDestination: `${origin}/sign-in`,
    };
    const inputs = {
      ...initialDraftPopulation('P-2'),
      ...initialDraftCompliance('P-2'),
      ...initialDraftEvidence('P-2'),
      templateId: 'P-2' as const,
      controlName: 'Agent sign-in integration',
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
      instructions: [{ registrationId: registration.registrationId, text: 'Read the account.' }],
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

  function browser(): PlaywrightBrowserExecution {
    const execution = new PlaywrightBrowserExecution({ mode: 'local' });
    browsers.push(execution);
    return execution;
  }

  /**
   * A workspace and a ready population, which is what the frozen order puts before a
   * sign-in. The population itself is not acquired here — this phase's precondition is the
   * checkpoint saying it finished, and Story 3.2 owns the acquiring.
   */
  async function ready(job: PopulationJob, execution: PlaywrightBrowserExecution): Promise<void> {
    const workspace = {
      repository: new PostgresWorkspaceRepository(db),
      browser: execution,
      clock: new SystemClock(),
      ids,
    };
    expect(await provisionWorkspace(workspace, job)).toEqual({ retry: false, provisioned: true });
    await sql`INSERT INTO population_execution(run_id,revision,status,attempts,step_id,attempt_id,started_at,attempt_started_at,lease_until)
              VALUES(${job.runId},1,'POPULATION_READY',1,'session-2',${ids.next()},now(),now(),now()+interval '1 hour')
              ON CONFLICT (run_id) DO UPDATE SET status='POPULATION_READY'`;
  }

  function deps(execution: PlaywrightBrowserExecution, tokens = new Map([[CREDENTIAL_REF, TOKEN]])) {
    return {
      repository: new PostgresAgentExecutionRepository(db),
      browser: execution,
      credentials: new ManifestCredentialResolver(tokens),
      clock: new SystemClock(),
      ids,
    };
  }

  it('signs in through the port and establishes a session in the workspace', async () => {
    requested = [];
    const job = await seed();
    const execution = browser();
    await ready(job, execution);

    expect(await executeAgentSteps(deps(execution), job)).toEqual({ retry: false, proceed: true });

    const [checkpoint] = await sql<{ status: string; attempts: number; diagnostic: string | null }[]>`
      SELECT status, attempts, diagnostic FROM run_agent_execution WHERE run_id=${job.runId}`;
    expect(checkpoint).toMatchObject({ status: 'SIGNED_IN', attempts: 1, diagnostic: null });

    const [step] = await sql<{ action: string; state: string; evidence_id: string | null }[]>`
      SELECT action, state, evidence_id FROM run_session_step WHERE run_id=${job.runId}`;
    // A sign-in freezes no bytes, and `run_session_step_acquired` reads the ACTION for
    // exactly that reason: written the obvious way, the constraint refuses this row.
    expect(step).toMatchObject({ action: 'sign-in', state: 'ACQUIRED', evidence_id: null });

    const executions = await sql<{ action: string; state: string }[]>`
      SELECT action, state FROM run_step_execution WHERE run_id=${job.runId} ORDER BY started_at`;
    // The workspace's own Step Execution first, then the sign-in's. Both are provenance for
    // a FROZEN step, and the sign-in's is the one this phase wrote.
    expect(executions.map((row) => row.action)).toEqual(['create-workspace', 'sign-in']);
    expect(executions[1]).toMatchObject({ state: 'SUCCEEDED' });

    // The system was asked, and the credential reached it — through the form's own POST,
    // which is the only place the token appears in the server's log.
    expect(requested.length).toBeGreaterThanOrEqual(2);
    expect(requested[0]).toMatchObject({ path: '/loancore', method: 'GET', credential: false });
    const submission = requested.filter((entry) => entry.credential);
    expect(submission).toHaveLength(1);
    expect(submission[0]).toMatchObject({ path: '/loancore/sign-in', method: 'POST' });
    // And the redirect the submission answered was followed with the session it granted.
    expect(requested.at(-1)).toMatchObject({ path: '/loancore', method: 'GET' });
    expect(requested.at(-1)?.cookie).toContain('session=granted');
  }, 120_000);

  it('records the action in the shared log, with no credential anywhere in it', async () => {
    requested = [];
    const job = await seed();
    const execution = browser();
    await ready(job, execution);
    await executeAgentSteps(deps(execution), job);

    const [action] = await sql<
      {
        surface: string;
        target_system: string;
        action: string;
        method: string;
        destination: string;
        outcome: string;
        denial: string | null;
        status: number;
        redirected: boolean;
        downloads: number;
        parameters: unknown;
      }[]
    >`SELECT surface, target_system, action, method, destination, outcome, denial, status, redirected, downloads, parameters
      FROM run_tool_action WHERE run_id=${job.runId}`;
    expect(action).toMatchObject({
      surface: 'agent',
      action: 'navigate',
      // The form's own POST, which is what the platform actually put on the wire. It is
      // read back from the workspace rather than assumed, and recording the `GET` the
      // action started with would leave the submission invisible in the one record a
      // reader checks the read-only guarantee against.
      method: 'POST',
      outcome: 'performed',
      denial: null,
      status: 200,
      // The system answered the submission with a 303 the browser followed.
      redirected: true,
      downloads: 0,
    });
    expect(action?.parameters).toEqual([]);
    expect(action?.destination).toContain('/loancore');

    // The containment claim, positively: the token appears in NOTHING this Run stored.
    const [dump] = await sql<{ text: string }[]>`
      SELECT coalesce(string_agg(t, ' '), '') AS text FROM (
        SELECT payload::text AS t FROM audit_events WHERE aggregate_id=${job.runId}
        UNION ALL SELECT to_jsonb(a)::text FROM run_tool_action a WHERE run_id=${job.runId}
        UNION ALL SELECT to_jsonb(s)::text FROM run_session_step s WHERE run_id=${job.runId}
        UNION ALL SELECT to_jsonb(w)::text FROM run_workspace w WHERE run_id=${job.runId}
        UNION ALL SELECT to_jsonb(c)::text FROM run_agent_execution c WHERE run_id=${job.runId}
      ) rows`;
    expect(dump?.text).not.toContain(TOKEN);
    // "Audited by reference" does NOT mean putting the reference in the payload: the
    // Target System is named instead, and `FORBIDDEN_PAYLOAD_KEYS` refuses the key outright.
    expect(dump?.text).not.toContain(CREDENTIAL_REF);
  }, 120_000);

  it('records the sign-in as a credential-entry action whose capture was SUPPRESSED', async () => {
    // Story 4.3. The action is on the log and its row SAYS capture was suppressed and why.
    // A gap with no explanation is what a reader takes for nothing having occurred.
    const job = await seed();
    const execution = browser();
    await ready(job, execution);
    await executeAgentSteps(deps(execution), job);
    const [action] = await sql<{ capture: string; capture_suppression: string | null }[]>`
      SELECT capture, capture_suppression FROM run_tool_action WHERE run_id=${job.runId}`;
    expect(action).toMatchObject({ capture: 'SUPPRESSED', capture_suppression: 'credential-entry' });
  }, 120_000);

  it('redacts the credential out of a destination the Target System chose', async () => {
    // The hostile case: the system redirects the sign-in to a path carrying the token.
    // `sanitizeDestination` strips a query and `user:pass@` and KEEPS the path, so without
    // the redaction the immutable action log would hold a working credential for ever.
    leakCredentialInPath = true;
    try {
      const job = await seed();
      const execution = browser();
      await ready(job, execution);
      await executeAgentSteps(deps(execution), job);
      const [action] = await sql<{ destination: string; redirected: boolean }[]>`
        SELECT destination, redirected FROM run_tool_action WHERE run_id=${job.runId}`;
      // The redirect really happened and really landed on the leaking path...
      expect(action?.redirected).toBe(true);
      expect(action?.destination).toContain('/loancore/session/');
      // ...and what was STORED does not carry the credential.
      expect(action?.destination).not.toContain(TOKEN);
      expect(action?.destination).toContain(REDACTED_CREDENTIAL);
      const [dump] = await sql<{ text: string }[]>`
        SELECT coalesce(string_agg(t, ' '), '') AS text FROM (
          SELECT payload::text AS t FROM audit_events WHERE aggregate_id=${job.runId}
          UNION ALL SELECT to_jsonb(a)::text FROM run_tool_action a WHERE run_id=${job.runId}
        ) rows`;
      expect(dump?.text).not.toContain(TOKEN);
    } finally {
      leakCredentialInPath = false;
    }
  }, 120_000);

  it('puts the sign-in in the audit chain, and the chain still verifies', async () => {
    const job = await seed();
    const execution = browser();
    await ready(job, execution);
    await executeAgentSteps(deps(execution), job);

    const events = await sql<{ event_type: string; outcome: string; payload: Record<string, unknown>; sequence: string }[]>`
      SELECT event_type, outcome, payload, sequence::text FROM audit_events
      WHERE aggregate_id=${job.runId} ORDER BY sequence`;
    const diagnostics = events.map((event) => String(event.payload['diagnostic'] ?? ''));
    expect(diagnostics).toContain('agent-execution-started');
    expect(diagnostics).toContain('session-established');
    expect(diagnostics).toContain('agent-sign-in-complete');
    // Every event of this Run is one unbroken chain: the sequence has no gaps.
    const sequences = events.map((event) => Number(event.sequence));
    expect(sequences).toEqual(sequences.map((_value, index) => index + 1));
  }, 120_000);

  it('DENIES a destination outside the frozen origins, and it never reaches the system', async () => {
    requested = [];
    const job = await seed();
    const execution = browser();
    await ready(job, execution);
    // Sign in first, so the workspace is live and the gate is the only thing between the
    // action and a server that would happily answer it.
    await executeAgentSteps(deps(execution), job);
    const before = requested.length;

    const target = (await new PostgresAgentExecutionRepository(db).transaction(job.runId, async (context) =>
      (await context.frozenPlan())!.inputs.targets[0]!,
    ))!;
    const ref = { runId: job.runId, workspaceId: '', mode: 'local' as const };
    const [workspace] = await sql<{ id: string }[]>`SELECT workspace_id AS id FROM run_workspace WHERE run_id=${job.runId}`;
    const live = { ...ref, workspaceId: workspace!.id };

    const denied = await performToolAction(execution, {
      ref: live,
      runId: job.runId,
      stepExecutionId: '',
      workItemId: null,
      toolActionId: ids.next(),
      scope: { target, scopeValues: new Set() },
      guard: NO_CREDENTIALS,
      // A path the SAME server answers, one segment outside the frozen origin. The
      // sibling-prefix case is the one a string comparison gets wrong, and this server
      // would answer it, so the gate is what has to stop it.
      request: { action: 'navigate', destination: `${origin}-elsewhere/users`, parameters: [] },
      credential: null,
      startedAt: new Date().toISOString(),
      completedAt: () => new Date().toISOString(),
      timeoutMs: () => 10_000,
    });
    expect(denied.ok).toBe(false);
    expect(denied.action).toMatchObject({ outcome: 'denied', denial: 'origin-not-allowed' });
    // The proof is the server's own log, not the gate agreeing with itself.
    expect(requested.slice(before)).toEqual([]);
  }, 120_000);

  it('presents the credential to the destination\u2019s own origin and to nothing else', async () => {
    requested = [];
    // Two frozen origins, which is what a plan naming two web Target Systems produces. The
    // workspace's allowlist is their UNION, so a page at one can reference the other and
    // the browser will fetch it — and it must never receive the first one's credential.
    //
    // `zelsewhere`, not `elsewhere`: `allowed_origins` is a normalized SET and is SORTED,
    // so the sign-in destination is whichever origin sorts first. Named to sort after
    // `/loancore` deliberately, because the alternative silently signed in somewhere else.
    const job = await seed({ allowedOrigins: [origin, origin.replace('/loancore', '/zelsewhere')] });
    const execution = browser();
    await ready(job, execution);
    await executeAgentSteps(deps(execution), job);

    const loancore = requested.filter((entry) => entry.path.startsWith('/loancore'));
    const elsewhere = requested.filter((entry) => entry.path.startsWith('/zelsewhere'));
    expect(loancore.filter((entry) => entry.credential)).toHaveLength(1);
    // The sub-resource was fetched — the allowlist permits it — and it carried nothing.
    expect(elsewhere.length).toBeGreaterThanOrEqual(1);
    expect(elsewhere.every((entry) => !entry.credential)).toBe(true);
  }, 120_000);

  it('signs in again in a workspace that already holds the session, without a form', async () => {
    // The IDEMPOTENT branch, and it is reachable: a database failure between a successful
    // sign-in and its commit leaves the checkpoint saying `RETRY` while the browser still
    // holds the cookie, and the phase's own sweep re-claims in the same process. The system
    // then serves the administration home rather than the form, and a mechanism that
    // insisted on a form would report `contract` and cost the Run.
    requested = [];
    const job = await seed();
    const execution = browser();
    await ready(job, execution);
    await executeAgentSteps(deps(execution), job);
    const submissions = requested.filter((entry) => entry.credential).length;
    expect(submissions).toBe(1);

    const target = (await new PostgresAgentExecutionRepository(db).transaction(job.runId, async (context) =>
      (await context.frozenPlan())!.inputs.targets[0]!,
    ))!;
    const [workspace] = await sql<{ id: string }[]>`SELECT workspace_id AS id FROM run_workspace WHERE run_id=${job.runId}`;
    const again = await execution.perform(
      { runId: job.runId, workspaceId: workspace!.id, mode: 'local' },
      {
        action: 'navigate',
        destination: target.contract.allowed_origins[0]!,
        authenticationDestination: target.contract.authentication_destination!,
        credential: await new ManifestCredentialResolver(new Map([[CREDENTIAL_REF, TOKEN]])).resolve(
          CREDENTIAL_REF,
          10_000,
        ),
      },
      10_000,
    );
    expect(again).toMatchObject({ status: 200, session: true });
    // Nothing was typed and nothing was submitted the second time: the session was already
    // there, and saying so is what makes this branch honest rather than convenient.
    expect(requested.filter((entry) => entry.credential)).toHaveLength(submissions);
    expect(again.method).toBe('GET');
  }, 120_000);

  it('REFUSES a sign-in form that is method="get", and types nothing into it', async () => {
    // A GET form puts the credential in the URL, in browser history, in the `Referer`
    // header and in every access log. `form-method.test.ts` is the product's guard against
    // shipping one; this is the workspace refusing to USE one a Target System serves,
    // which is the half a fixture's own tests cannot cover.
    getSignInForm = true;
    requested = [];
    try {
      const job = await seed();
      const execution = browser();
      await ready(job, execution);
      await executeAgentSteps(deps(execution), job);

      // The server's own log FIRST, because it is the proof: nothing carrying the
      // credential was ever sent, in a body or in a query string. Asserting the diagnostic
      // first would let a build that typed the credential and then failed for some other
      // reason fail this test for the wrong reason, and the leak would go unnamed.
      expect(requested.filter((entry) => entry.credential)).toEqual([]);
      expect(requested.filter((entry) => entry.path.includes(TOKEN))).toEqual([]);
      const [step] = await sql<{ state: string; diagnostic: string }[]>`
        SELECT state, diagnostic FROM run_session_step WHERE run_id=${job.runId}`;
      expect(step).toMatchObject({ state: 'FAILED', diagnostic: 'sign-in-scope-violation' });
    } finally {
      getSignInForm = false;
    }
  }, 120_000);

  it('REFUSES a sign-in form that posts to another origin, and posts nothing to it', async () => {
    // The guarantee the interception's header injection used to give, in the shape the
    // form mechanism has to give it. Both origins are inside the workspace's egress
    // allowlist, so the interception would happily let this request out; what stops it is
    // the mechanism judging the form's own resolved action against the DESTINATION's
    // frozen origin before anything is typed.
    crossOriginSignInForm = true;
    requested = [];
    try {
      const job = await seed({ allowedOrigins: [origin, origin.replace('/loancore', '/zelsewhere')] });
      const execution = browser();
      await ready(job, execution);
      await executeAgentSteps(deps(execution), job);

      // The proof is the server's own log, not the mechanism agreeing with itself, and it
      // is asserted FIRST: nothing carrying the credential was ever sent, to either origin.
      expect(requested.filter((entry) => entry.credential)).toEqual([]);
      expect(requested.filter((entry) => entry.method === 'POST')).toEqual([]);
      const [step] = await sql<{ state: string; diagnostic: string }[]>`
        SELECT state, diagnostic FROM run_session_step WHERE run_id=${job.runId}`;
      expect(step).toMatchObject({ state: 'FAILED', diagnostic: 'sign-in-scope-violation' });
    } finally {
      crossOriginSignInForm = false;
    }
  }, 120_000);

  it('aborts an out-of-scope destination inside the browser even with the gate bypassed', async () => {
    requested = [];
    const job = await seed();
    const execution = browser();
    await ready(job, execution);
    await executeAgentSteps(deps(execution), job);
    const before = requested.length;
    const [workspace] = await sql<{ id: string }[]>`SELECT workspace_id AS id FROM run_workspace WHERE run_id=${job.runId}`;
    // The gate is the first boundary and the workspace's egress interception is the second.
    // Calling the port DIRECTLY is what proves the second one exists: a provider adapter
    // that trusted the gate would put this request on the wire.
    await expect(
      execution.perform(
        { runId: job.runId, workspaceId: workspace!.id, mode: 'local' },
        { action: 'navigate', destination: `${origin}-elsewhere/users`, credential: null, capture: [] },
        10_000,
      ),
    ).rejects.toMatchObject({ code: 'scope' });
    expect(requested.slice(before)).toEqual([]);
  }, 120_000);

  it('records a Target System refusal as a DENIAL with a security event, not as an outage', async () => {
    requested = [];
    const job = await seed();
    const execution = browser();
    await ready(job, execution);
    // A credential the manifest does not name would fail before the request; this one
    // resolves and is simply WRONG, so the system itself answers 401.
    await executeAgentSteps(deps(execution, new Map([[CREDENTIAL_REF, 'not-the-token']])), job);

    const [step] = await sql<{ state: string; diagnostic: string; attempts: number }[]>`
      SELECT state, diagnostic, attempts FROM run_session_step WHERE run_id=${job.runId}`;
    expect(step).toMatchObject({ state: 'FAILED', diagnostic: 'sign-in-denied', attempts: 1 });

    const security = await sql<{ payload: Record<string, unknown> }[]>`
      SELECT payload FROM audit_events WHERE aggregate_id=${job.runId} AND event_type='security.action-denied'`;
    expect(security).toHaveLength(1);
    expect(security[0]?.payload['cause']).toBe('action-denied');

    const [action] = await sql<{ outcome: string; status: number }[]>`
      SELECT outcome, status FROM run_tool_action WHERE run_id=${job.runId}`;
    expect(action).toMatchObject({ outcome: 'performed', status: 401 });

    const [run] = await sql<{ state: string }[]>`SELECT state FROM audit_run WHERE run_id=${job.runId}`;
    expect(run?.state).toBe('RUN_FAILED');
    // ONE attempt against a system that said no. Retrying a refusal proves nothing.
    expect(requested.filter((entry) => entry.path === '/loancore')).toHaveLength(1);
  }, 120_000);

  it('refuses a credential-shaped payload key outright, so "by reference" cannot be misread', async () => {
    // The guard `FORBIDDEN_PAYLOAD_KEYS` provides, asserted against the real appender
    // rather than against a copy of the list.
    const job = await seed();
    const execution = browser();
    await ready(job, execution);
    await executeAgentSteps(deps(execution), job);
    const [head] = await sql<{ aggregate_id: string }[]>`
      SELECT aggregate_id FROM audit_event_heads WHERE aggregate_id=${job.runId}`;
    expect(head).toBeDefined();
    const columns = await sql<{ column_name: string }[]>`
      SELECT column_name FROM information_schema.columns WHERE table_name='run_tool_action' ORDER BY column_name`;
    // The table has nowhere for a credential to live, by construction.
    expect(columns.map((row) => row.column_name)).toEqual([
      'action',
      // Story 4.3: whether the platform captured anything from this action, and why not.
      // Two more columns and still nowhere for a credential, a header or a body.
      'capture',
      'capture_suppression',
      'completed_at',
      'denial',
      'destination',
      'diagnostic',
      'downloads',
      'method',
      'offending',
      'outcome',
      'parameters',
      'redirected',
      'run_id',
      'started_at',
      'status',
      'step_execution_id',
      'surface',
      'target_system',
      'tool_action_id',
      'work_item_id',
    ]);
  }, 120_000);

  it('refuses an action outcome and a denial that disagree, at the database', async () => {
    const job = await seed();
    const execution = browser();
    await ready(job, execution);
    await executeAgentSteps(deps(execution), job);
    const [row] = await sql<{ id: string; step: string }[]>`
      SELECT tool_action_id::text AS id, step_execution_id::text AS step FROM run_tool_action WHERE run_id=${job.runId}`;
    // A denial that names no rule, and a performed action that names one: either alone
    // permits a row that reads as the other, which is why the CHECK is one expression.
    await expect(
      sql`INSERT INTO run_tool_action(tool_action_id,run_id,step_execution_id,surface,target_system,action,method,destination,parameters,outcome,denial,redirected,downloads,started_at,capture)
          VALUES(gen_random_uuid(),${job.runId},${row!.step},'agent','x','navigate','GET','http://x/','[]'::jsonb,'denied',NULL,false,0,now(),'PERMITTED')`,
    ).rejects.toThrow(/run_tool_action_denied/);
    await expect(
      sql`INSERT INTO run_tool_action(tool_action_id,run_id,step_execution_id,surface,target_system,action,method,destination,parameters,outcome,denial,redirected,downloads,started_at,capture)
          VALUES(gen_random_uuid(),${job.runId},${row!.step},'agent','x','navigate','GET','http://x/','[]'::jsonb,'performed','origin-not-allowed',false,0,now(),'PERMITTED')`,
    ).rejects.toThrow(/run_tool_action_denied/);
    // The method vocabulary is CLOSED, and it is the domain's `TOOL_ACTION_METHODS` rather
    // than a list retyped into SQL. `POST` is in it for one operation — submitting a Target
    // System's own sign-in form, which creates a session and no audited business data — so
    // the CHECK is asserted in BOTH directions: every method the domain names is storable,
    // and a method it does not name is refused. A CHECK that quietly refused a method the
    // platform really makes would be found by nothing else.
    for (const method of TOOL_ACTION_METHODS) {
      await expect(
        sql`INSERT INTO run_tool_action(tool_action_id,run_id,step_execution_id,surface,target_system,action,method,destination,parameters,outcome,denial,redirected,downloads,started_at,capture)
            VALUES(gen_random_uuid(),${job.runId},${row!.step},'agent','x','navigate',${method},'http://x/','[]'::jsonb,'performed',NULL,false,0,now(),'PERMITTED')`,
      ).resolves.toBeDefined();
    }
    for (const method of ['PUT', 'DELETE', 'PATCH', 'post']) {
      await expect(
        sql`INSERT INTO run_tool_action(tool_action_id,run_id,step_execution_id,surface,target_system,action,method,destination,parameters,outcome,denial,redirected,downloads,started_at,capture)
            VALUES(gen_random_uuid(),${job.runId},${row!.step},'agent','x','navigate',${method},'http://x/','[]'::jsonb,'performed',NULL,false,0,now(),'PERMITTED')`,
      ).rejects.toThrow(/run_tool_action_method/);
    }
    // And a denial reason outside the closed vocabulary.
    await expect(
      sql`INSERT INTO run_tool_action(tool_action_id,run_id,step_execution_id,surface,target_system,action,method,destination,parameters,outcome,denial,redirected,downloads,started_at,capture)
          VALUES(gen_random_uuid(),${job.runId},${row!.step},'agent','x','navigate','GET','http://x/','[]'::jsonb,'denied','invented-reason',false,0,now(),'PERMITTED')`,
    ).rejects.toThrow(/run_tool_action_denial/);
    // Story 4.3's own pair, at the database. A SUPPRESSED row with no reason is a gap
    // wearing a label; a PERMITTED row with one says capture was both allowed and refused.
    // One CHECK, like `run_tool_action_denied`, because either half alone permits a row
    // that reads as the other.
    await expect(
      sql`INSERT INTO run_tool_action(tool_action_id,run_id,step_execution_id,surface,target_system,action,method,destination,parameters,outcome,denial,redirected,downloads,started_at,capture,capture_suppression)
          VALUES(gen_random_uuid(),${job.runId},${row!.step},'agent','x','navigate','GET','http://x/','[]'::jsonb,'performed',NULL,false,0,now(),'SUPPRESSED',NULL)`,
    ).rejects.toThrow(/run_tool_action_capture_suppressed/);
    await expect(
      sql`INSERT INTO run_tool_action(tool_action_id,run_id,step_execution_id,surface,target_system,action,method,destination,parameters,outcome,denial,redirected,downloads,started_at,capture,capture_suppression)
          VALUES(gen_random_uuid(),${job.runId},${row!.step},'agent','x','navigate','GET','http://x/','[]'::jsonb,'performed',NULL,false,0,now(),'PERMITTED','credential-entry')`,
    ).rejects.toThrow(/run_tool_action_capture_suppressed/);
    // And neither half may be spelled outside its closed vocabulary.
    await expect(
      sql`INSERT INTO run_tool_action(tool_action_id,run_id,step_execution_id,surface,target_system,action,method,destination,parameters,outcome,denial,redirected,downloads,started_at,capture)
          VALUES(gen_random_uuid(),${job.runId},${row!.step},'agent','x','navigate','GET','http://x/','[]'::jsonb,'performed',NULL,false,0,now(),'permitted')`,
    ).rejects.toThrow(/run_tool_action_capture/);
    await expect(
      sql`INSERT INTO run_tool_action(tool_action_id,run_id,step_execution_id,surface,target_system,action,method,destination,parameters,outcome,denial,redirected,downloads,started_at,capture,capture_suppression)
          VALUES(gen_random_uuid(),${job.runId},${row!.step},'agent','x','navigate','GET','http://x/','[]'::jsonb,'performed',NULL,false,0,now(),'SUPPRESSED','because-i-said-so')`,
    ).rejects.toThrow(/run_tool_action_capture_reason/);
    expect(row?.id).toBeDefined();
  }, 120_000);
});
