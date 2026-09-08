import { createServer, type Server } from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  acquirePopulation, executeAdapterSteps, executeAgentSteps, initiateRun, provisionWorkspace, raiseEscalation,
  type AgentModelGateway, type EvidenceStore,
} from '@intellifin/application';
import {
  bindingDigest, bindingDigestEnvelope, GATE_CHECKS, RUN_LIMIT_CAUSES, initialDraftCompliance, initialDraftEvidence, initialDraftPopulation,
  initialDraftSections, registrationDigest, sha256Hex, sha256HexOfBytes, snapshotFromRegistration, utf8Bytes,
} from '@intellifin/domain';
import {
  createDb, createExceptionFingerprinter, createSqlClient, CryptoUuidV7Generator, DrizzleRoleRepository,
  PostgresAdapterExecutionRepository, PostgresAgentExecutionRepository, PostgresPopulationRepository,
  PostgresProceduresUnitOfWork, PostgresRunsUnitOfWork, PostgresWaitRepository, PostgresWorkspaceRepository,
  SystemClock, type Database, type Sql,
} from '@intellifin/infrastructure';
import { PlaywrightBrowserExecution } from '@intellifin/infrastructure/browser';
import { ManifestCredentialResolver } from '@intellifin/infrastructure/credentials';
import { executeAgentWorkItem } from '../../packages/application/src/runs/execute-agent-work-item.js';
import { PostgresAgentWorkRepository } from '../../packages/infrastructure/src/runs/agent-work-repository.js';
import { activeRunVersion } from '../fixtures/active-run-version.js';

// Real PostgreSQL + local Chromium + synthetic HTTP target. The proposal gateway is a
// fixture stub: this proves the worker path, not live model or Solari acceptance.
const url = process.env['DATABASE_URL'];
const TOKEN = 'synthetic-journey-audit-password';
const REF = 'cred://synthetic/agent-journey';

describe.skipIf(!url)('local browser agent journeys through PostgreSQL registration', () => {
  let sql: Sql; let db: Database; let server: Server; let origin: string;
  const ids = new CryptoUuidV7Generator(), clock = new SystemClock(), author = ids.next();
  const runs: string[] = [], procedures: string[] = [], bindings: string[] = [];
  const browsers: PlaywrightBrowserExecution[] = [];
  const requests: { method: string; path: string; authenticated: boolean }[] = [];
  const sessions = new Set<string>();
  const credentials = new ManifestCredentialResolver(new Map([[REF, TOKEN]]));
  const exceptions = createExceptionFingerprinter({ keyId: 'synthetic-journey', key: 'synthetic-only-key' });
  beforeAll(async () => {
    const target = new URL(url!);
    if (!['localhost', '127.0.0.1', '[::1]', 'postgres', 'db'].includes(target.hostname) || !/(?:^|[_-])(?:test|ci)(?:[_-]|$)/i.test(target.pathname.slice(1))) throw new Error('Agent journey tests require an isolated local or CI test database');
    sql = createSqlClient(url!, { max: 5 }); db = createDb(sql);
    await sql`INSERT INTO auth_user(id,name,email) VALUES (${author},'Agent journey',${author + '@test.invalid'})`;
    await sql`INSERT INTO user_role(user_id,role) VALUES (${author},'auditor')`;
    server = createServer((request, response) => {
      const chunks: Buffer[] = [];
      request.on('data', (chunk: Buffer) => chunks.push(chunk));
      request.on('end', () => {
        const current = new URL(request.url ?? '/', 'http://synthetic.invalid');
        const authenticated = sessions.has((request.headers.cookie ?? '').replace(/^session=/u, ''));
        requests.push({ method: request.method ?? 'GET', path: current.pathname + current.search, authenticated });
        if (request.method === 'POST' && current.pathname === '/loancore/sign-in') {
          if (new URLSearchParams(Buffer.concat(chunks).toString('utf8')).get('credential') !== TOKEN) { response.writeHead(401); response.end('Refused'); return; }
          const session = ids.next(); sessions.add(session);
          response.writeHead(303, { location: '/loancore', 'set-cookie': `session=${session}; Path=/; HttpOnly` }); response.end(); return;
        }
        response.setHeader('content-type', 'text/html; charset=utf-8');
        if (!authenticated) { response.end('<form method="post" action="/loancore/sign-in"><input type="password" name="credential"><button type="submit">Sign in</button></form>'); return; }
        const auth = '<p role="status" aria-label="Current signed-in account">Signed in as audit.readonly</p>';
        const search = '<form method="get" action="/loancore"><label>Employee ID<input name="employee_id"></label><label>Full name<input name="full_name"></label><button type="submit">Search</button></form>';
        if (current.searchParams.get('employee_id') === 'E-101' || current.searchParams.get('full_name') === 'Esther Kabwe') {
          response.writeHead(303, { location: '/loancore/account/E-101' }); response.end(); return;
        }
        if (current.pathname === '/loancore/account/E-101') {
          response.end(auth + '<dl><dt>Employee ID</dt><dd>E-101</dd><dt>Full name</dt><dd>Esther Kabwe</dd><dt>Status</dt><dd>disabled</dd><dt>Username</dt><dd>ekabwe</dd><dt>Roles</dt><dd><ul><li>read_only</li></ul></dd></dl>'); return;
        }
        // A partial page deliberately does not make the approved completion claim true.
        const partial = current.searchParams.get('employee_id') === 'E-303' || current.searchParams.get('full_name') === 'Partial Person';
        const summary = current.search ? `<p role="status" aria-label="result-summary">Showing 0 of ${partial ? '1' : '0'} matching accounts.</p>` : '';
        response.end(auth + search + summary);
      });
    });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    origin = `http://127.0.0.1:${(server.address() as { port: number }).port}/loancore`;
  });
  afterAll(async () => {
    for (const browser of browsers) await browser.close().catch(() => undefined);
    if (server) await new Promise<void>(resolve => server.close(() => resolve()));
    if (!sql) return;
    try {
      for (const runId of runs) {
        await sql`DELETE FROM notification WHERE run_id=${runId}`;
        await sql`DELETE FROM pgboss.job WHERE name IN ('runs','waits') AND data->>'runId'=${runId}`;
        await sql`DELETE FROM run_wait WHERE run_id=${runId}`;
        await sql`DELETE FROM run_agent_turn WHERE run_id=${runId}`;
        await sql`DELETE FROM run_agent_work WHERE run_id=${runId}`;
        // Tear down the whole disposable Run before its protected capture metadata.
        await sql`DELETE FROM run_result_review WHERE run_id=${runId}`;
        await sql`DELETE FROM run_result WHERE run_id=${runId}`;
        await sql`DELETE FROM run_evidence_integrity WHERE run_id=${runId}`;
        await sql`DELETE FROM run_evidence_package WHERE run_id=${runId}`;
        await sql`DELETE FROM run_observation_evaluation WHERE run_id=${runId}`;
        await sql`DELETE FROM run_observation_check WHERE run_id=${runId}`;
        await sql`DELETE FROM run_observation WHERE run_id=${runId}`;
        await sql`DELETE FROM run_exception WHERE run_id=${runId}`;
        await sql`DELETE FROM run_evidence_capture WHERE run_id=${runId}`;
        await sql`DELETE FROM run_tool_action WHERE run_id=${runId}`;
        await sql`DELETE FROM run_step_execution WHERE run_id=${runId}`;
        await sql`DELETE FROM run_session_step WHERE run_id=${runId}`;
        await sql`DELETE FROM run_work_item WHERE run_id=${runId}`;
        await sql`DELETE FROM run_gate_check WHERE run_id=${runId}`;
        await sql`DELETE FROM run_evidence WHERE run_id=${runId}`;
        await sql`DELETE FROM run_execution WHERE run_id=${runId}`;
        await sql`DELETE FROM population_row WHERE run_id=${runId}`;
        await sql`DELETE FROM population_snapshot WHERE run_id=${runId}`;
        await sql`DELETE FROM population_evidence WHERE run_id=${runId}`;
        await sql`DELETE FROM population_execution WHERE run_id=${runId}`;
        await sql`DELETE FROM audit_events WHERE aggregate_id=${runId}`;
        await sql`DELETE FROM audit_event_heads WHERE aggregate_id=${runId}`;
        await sql`DELETE FROM run_initiation_request WHERE run_id=${runId} OR refused_run_id=${runId}`;
        await sql`DELETE FROM audit_run WHERE run_id=${runId}`;
      }
      for (const procedureId of procedures) { await sql`DELETE FROM procedure_version WHERE procedure_id=${procedureId}`; await sql`DELETE FROM procedure WHERE procedure_id=${procedureId}`; }
      for (const bindingId of bindings) await sql`DELETE FROM population_source_binding WHERE binding_id=${bindingId}`;
      await sql`DELETE FROM auth_user WHERE id=${author}`;
    } finally { await sql.end({ timeout: 5 }); }
  });

  async function seed(employeeId: string, name: string, extraRows: readonly { employeeId: string; name: string }[] = []) {
    const schema = ['employee_id', 'full_name', 'employment_status', 'termination_effective_date'];
    const source = { kind: 'versioned-file' as const, location: 'https://synthetic.invalid/leavers.csv', declaredSchema: schema, sensitiveFields: [], declaredCountMechanism: 'cover-sheet' as const };
    const registration = { registrationId: ids.next(), displayName: 'LoanCore', kind: 'web' as const, allowedOrigins: [origin], applicationIdentity: '', credentialRef: REF, permittedActions: ['navigate', 'search', 'read-attribute'] as const, attributeLabelPatterns: ['Employee ID', 'Full name', 'Status', 'Username', 'Roles'], secondaryKey: 'Full name', authenticationDestination: `${origin}/sign-in` };
    const inputs = { ...initialDraftPopulation('P-1'), ...initialDraftCompliance('P-1'), ...initialDraftEvidence('P-1'), templateId: 'P-1' as const, controlName: 'Synthetic leaver review', sections: initialDraftSections('P-1'), scope: 'Synthetic terminated employees', period: { from: '2026-08-01', to: '2026-08-31' }, sourceSnapshot: { bindingId: ids.next(), displayName: 'Synthetic leavers', digest: bindingDigest(source), contract: bindingDigestEnvelope(source) }, schedule: { frequency: 'once' as const, startTime: '00:00', periodDerivationRule: 'explicit-period' as const }, targets: [snapshotFromRegistration({ ...registration, digest: registrationDigest(registration) })], instructions: [{ registrationId: registration.registrationId, text: 'Search by the approved employee keys and inspect the account.' }] };
    bindings.push(inputs.sourceSnapshot.bindingId);
    await sql`INSERT INTO population_source_binding(binding_id,display_name,kind,location,declared_schema,declared_count_mechanism,digest) VALUES (${inputs.sourceSnapshot.bindingId},'Synthetic leavers',${source.kind},${source.location},${schema},${source.declaredCountMechanism},${inputs.sourceSnapshot.digest})`;
    const version = activeRunVersion(ids.next(), ids.next(), author, inputs); procedures.push(version.procedureId);
    await new PostgresProceduresUnitOfWork(db).execute(async context => { await context.procedures.insertProcedure(version); await context.procedures.insertVersion(version); });
    const started = await initiateRun({ roles: new DrizzleRoleRepository(db), unitOfWork: new PostgresRunsUnitOfWork(db), ids, clock }, { session: { userId: author, sessionId: author }, request: { procedureId: version.procedureId, period: inputs.period, requestToken: ids.next() } });
    if (!started.ok) throw new Error(started.reason); runs.push(started.runId);
    const [run] = await sql<{ correlation_id: string }[]>`SELECT correlation_id FROM audit_run WHERE run_id=${started.runId}`;
    const job = { schemaVersion: 1 as const, runId: started.runId, correlationId: run!.correlation_id };
    const objects = new Map<string, Uint8Array>();
    const store: EvidenceStore = { async read(key) { return objects.get(key)?.slice() ?? null; }, async putIfAbsent(key, bytes) { if (!objects.has(key)) objects.set(key, bytes.slice()); } };
    const browser = new PlaywrightBrowserExecution({ mode: 'local' }); browsers.push(browser);
    expect(await provisionWorkspace({ repository: new PostgresWorkspaceRepository(db), browser, clock, ids }, job)).toMatchObject({ provisioned: true });
    const sourceRows = [{ employeeId, name }, ...extraRows];
    const body = `${schema.join(',')}\n` + sourceRows.map(row => `${row.employeeId},${row.name},Terminated,2026-08-15\n`).join('');
    await acquirePopulation({ repository: new PostgresPopulationRepository(db), acquisition: { async acquire() { return { bytes: utf8Bytes(body), mediaType: 'text/csv', declaration: { schema_version: 1, representation: 'csv-raw-v1', source: source.location, generation: 'synthetic-1', generated_at: new Date(Date.now() - 60_000).toISOString(), effective_period: inputs.period, schema, count: sourceRows.length, sha256: sha256Hex(body), complete: true } }; } }, store, clock, ids }, job);
    expect(await executeAgentSteps({ repository: new PostgresAgentExecutionRepository(db), browser, credentials, clock, ids }, job)).toMatchObject({ proceed: true });
    const unused = async (): Promise<never> => { throw new Error('A web target must not use an extraction shortcut'); };
    await executeAdapterSteps({ repository: new PostgresAdapterExecutionRepository(db), reference: { acquireReference: unused }, extraction: { extract: unused }, credentials, store, clock, ids, exceptions }, job);
    const selectedTools: string[] = [];
    const identity: AgentModelGateway['identity'] = { provider: 'anthropic', modelId: 'local-fixture-proposal-stub', promptVersion: 'test', buildVersion: 'test', configuration: { responseFormat: 'agent-action-proposal-v1', maxOutputTokens: 128, maxActions: 1, temperature: 0 } };
    const model: AgentModelGateway = { identity, async propose(request) {
      expect(JSON.stringify(request)).not.toContain(TOKEN);
      if (request.phase === 'evaluation' && request.evaluation) return {
        schemaVersion: 1, phase: 'evaluation', route: 'anthropic', model: identity, actions: [],
        agentProposals: request.evaluation.conditions.map(condition => ({ observationId: request.evaluation!.observationId, conditionId: condition.conditionId, value: 'COMPLIANT', confidence: '0.9', rationale: 'Synthetic test proposal for the captured read-only role.' })),
        uncertainty: { kind: 'none', rationale: null }, usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
      };
      const tool = request.tools.find(candidate => candidate.action === 'read-attribute') ?? request.tools.find(candidate => candidate.action === 'search') ?? request.tools[0];
      if (tool) selectedTools.push(tool.action);
      return { schemaVersion: 1, route: 'anthropic', model: identity, actions: tool ? [{ toolId: tool.toolId, action: tool.action, destination: tool.destination, locator: tool.locator, parameters: [] }] : [], uncertainty: tool ? { kind: 'none', rationale: null } : { kind: 'insufficient-evidence', rationale: 'Fixture cannot find an approved interaction.' }, usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 } };
    } };
    const dependencies = { repository: new PostgresAgentWorkRepository(db), browser, credentials, model, store, clock, ids, exceptions, waits: { raiseEscalation: (input: Parameters<typeof raiseEscalation>[1]) => raiseEscalation({ repository: new PostgresWaitRepository(db), clock, ids }, input) } };
    return { job, dependencies, objects, selectedTools, plan: version.compiledPlan! };
  }

  it.each(['missing', 'duplicate'] as const)('seals %s source identity as a shared Gate INCONCLUSIVE without selecting a row', async kind => {
    const seeded = kind === 'missing' ? await seed('', 'Missing key person')
      : await seed('E-101', 'Esther Kabwe', [{ employeeId: 'E-101', name: 'Conflicting source person' }]);
    const beforeRows = await sql`SELECT ordinal,"values" FROM population_row WHERE run_id=${seeded.job.runId} ORDER BY ordinal`;
    const beforeEvidence = await sql`SELECT raw_digest,envelope_digest,object_key,envelope_key FROM population_evidence WHERE run_id=${seeded.job.runId}`;
    let modelCalls = 0;
    const model: AgentModelGateway = { ...seeded.dependencies.model, async propose() { modelCalls++; throw new Error('Unresolved source identity must not reach a model.'); } };
    await executeAgentWorkItem({ ...seeded.dependencies, model }, seeded.job);
    expect(modelCalls).toBe(0);
    expect((await sql`SELECT state FROM audit_run WHERE run_id=${seeded.job.runId}`)[0]?.state).toBe('INCONCLUSIVE');
    const expectedCheck = kind === 'missing' ? 'mandatory-values' : 'duplicate-primary-keys';
    const expectedDiagnostic = kind === 'missing' ? 'mandatory-identifier-empty' : 'duplicate-primary-key';
    expect((await sql`SELECT outcome,diagnostics FROM run_gate_check WHERE run_id=${seeded.job.runId} AND check_name=${expectedCheck}`)[0]).toMatchObject({ outcome: 'FAIL', diagnostics: expect.arrayContaining([expectedDiagnostic]) });
    expect(await sql`SELECT event_type FROM audit_events WHERE aggregate_id=${seeded.job.runId} AND payload->>'diagnostic'=${expectedDiagnostic}`).toHaveLength(1);
    expect((await sql`SELECT outcome FROM run_result WHERE run_id=${seeded.job.runId}`)[0]?.outcome).toBe('INCONCLUSIVE');
    expect(await sql`SELECT observation_id FROM run_observation WHERE run_id=${seeded.job.runId}`).toHaveLength(0);
    expect(await sql`SELECT wait_id FROM run_wait WHERE run_id=${seeded.job.runId}`).toHaveLength(0);
    expect(await sql`SELECT ordinal,"values" FROM population_row WHERE run_id=${seeded.job.runId} ORDER BY ordinal`).toEqual(beforeRows);
    expect(await sql`SELECT raw_digest,envelope_digest,object_key,envelope_key FROM population_evidence WHERE run_id=${seeded.job.runId}`).toEqual(beforeEvidence);
    const sealed = await sql`SELECT to_jsonb(r)::text AS value FROM run_result r WHERE run_id=${seeded.job.runId}`;
    await executeAgentWorkItem({ ...seeded.dependencies, model }, seeded.job);
    expect(await sql`SELECT to_jsonb(r)::text AS value FROM run_result r WHERE run_id=${seeded.job.runId}`).toEqual(sealed);
  }, 120_000);

  it('searches, captures and registers a grounded found Observation through the real shared writer', async () => {
    const seeded = await seed('E-101', 'Esther Kabwe');
    await executeAgentWorkItem(seeded.dependencies, seeded.job);
    const observations = await sql`SELECT population_record_key,found,match_origin,identity,attributes,corroboration,coverage FROM run_observation WHERE run_id=${seeded.job.runId}`;
    expect(observations).toHaveLength(1);
    expect(observations[0]).toMatchObject({ population_record_key: 'E-101', found: 'true', match_origin: 'platform', corroboration: 'MATCHED', coverage: 'COVERED' });
    expect(observations[0]!['attributes']).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'account_status', normalizedValue: 'disabled', corroboration: 'matched' }),
      expect.objectContaining({ name: 'username', normalizedValue: 'ekabwe', corroboration: 'matched' }),
      expect.objectContaining({ name: 'roles', normalizedValue: ['read_only'], corroboration: 'matched' }),
    ]));
    expect(seeded.selectedTools).toContain('search'); expect(seeded.selectedTools).toContain('read-attribute');
    const evidence = await sql<{ object_key: string; digest: string; kind: string }[]>`SELECT object_key,digest,kind FROM run_evidence WHERE run_id=${seeded.job.runId} AND state='REGISTERED'`;
    expect(evidence.some(row => row.kind === 'structural-snapshot')).toBe(true);
    for (const row of evidence) { const bytes = seeded.objects.get(row.object_key); expect(bytes).toBeDefined(); expect(sha256HexOfBytes(bytes!)).toBe(row.digest); expect(new TextDecoder().decode(bytes)).not.toContain(TOKEN); }
    expect(await sql`SELECT run_id FROM run_result WHERE run_id=${seeded.job.runId}`).toHaveLength(1);
    // Queue redelivery in a fresh repository cannot duplicate the Observation or capture.
    await executeAgentWorkItem({ ...seeded.dependencies, repository: new PostgresAgentWorkRepository(db) }, seeded.job);
    expect(await sql`SELECT observation_id FROM run_observation WHERE run_id=${seeded.job.runId}`).toHaveLength(1);
  }, 120_000);

  it('proves both search keys against registered complete empty pages before recording absence', async () => {
    const seeded = await seed('E-202', 'Absent Person');
    await executeAgentWorkItem(seeded.dependencies, seeded.job);
    const observations = await sql`SELECT found,coverage,attributes FROM run_observation WHERE run_id=${seeded.job.runId}`;
    expect(observations).toHaveLength(1); expect(observations[0]).toMatchObject({ found: 'false', coverage: 'COVERED' });
    const searches = await sql`SELECT parameters FROM run_tool_action WHERE run_id=${seeded.job.runId} AND action='search' AND outcome='performed'`;
    expect(JSON.stringify(searches)).toContain('E-202'); expect(JSON.stringify(searches)).toContain('Absent Person');
    expect(await sql`SELECT value FROM run_observation_evaluation WHERE run_id=${seeded.job.runId} AND condition_id='C1'`).toEqual([expect.objectContaining({ value: 'COMPLIANT' })]);
    expect(requests.some(row => row.path.includes('employee_id=E-202') && row.authenticated)).toBe(true);
  }, 120_000);

  it('does not turn an incomplete empty search into a compliant absence', async () => {
    const seeded = await seed('E-303', 'Partial Person');
    await executeAgentWorkItem(seeded.dependencies, seeded.job);
    const actions = await sql`SELECT parameters FROM run_tool_action WHERE run_id=${seeded.job.runId} AND action='search' AND outcome='performed'`;
    expect(JSON.stringify(actions)).toContain('E-303');
    expect(await sql`SELECT observation_id FROM run_observation_evaluation WHERE run_id=${seeded.job.runId} AND value='COMPLIANT'`).toHaveLength(0);
    expect(await sql`SELECT run_id FROM run_result WHERE run_id=${seeded.job.runId} AND outcome='PASS'`).toHaveLength(0);
  }, 120_000);
  it('refuses model-authored search substitutions before a browser search executes', async () => {
    const seeded = await seed('E-101', 'Esther Kabwe');
    const original = seeded.dependencies.model;
    const model: AgentModelGateway = { ...original, async propose(request) {
      const proposed = await original.propose(request);
      return { ...proposed, actions: proposed.actions.map(action => ({ ...action, parameters: [{name:'employee_id',value:'OUT-OF-SCOPE'}] })) };
    } };
    await executeAgentWorkItem({ ...seeded.dependencies, model }, seeded.job);
    expect(await sql`SELECT tool_action_id FROM run_tool_action WHERE run_id=${seeded.job.runId} AND action='search' AND outcome='performed'`).toHaveLength(0);
    expect(await sql`SELECT observation_id FROM run_observation WHERE run_id=${seeded.job.runId}`).toHaveLength(0);
    expect(await sql`SELECT run_id FROM run_result WHERE run_id=${seeded.job.runId} AND outcome='PASS'`).toHaveLength(0);
    expect(await sql`SELECT event_type FROM audit_events WHERE aggregate_id=${seeded.job.runId} AND event_type='security.action-denied'`).toHaveLength(1);
  }, 120_000);

  it.each(RUN_LIMIT_CAUSES)('records the shared Gate and seals %s with partial Evidence unchanged on replay', async cause => {
    const seeded = await seed('E-101', 'Esther Kabwe');
    const partialBefore = [...seeded.objects].map(([key, bytes]) => [key, bytes.slice()] as const);
    expect(partialBefore.length).toBeGreaterThan(0);
    const [population] = await sql`SELECT started_at FROM population_execution WHERE run_id=${seeded.job.runId}`;
    const runStartedAt = new Date(population!.started_at).getTime();
    let deadlineReached = false, modelCalls = 0;
    const limitedClock = { now: () => new Date(deadlineReached
      ? runStartedAt + seeded.plan.limits.runTimeoutSeconds * 1000 + 1
      : Date.now()) };
    if (cause === 'run-step-execution-limit') {
      const [count] = await sql`SELECT count(*)::int AS count FROM run_step_execution WHERE run_id=${seeded.job.runId}`;
      const priorCount = seeded.plan.limits.runStepExecutions - 1 - Number(count!.count);
      expect(priorCount).toBeGreaterThan(0);
      // Real preceding Step Execution rows make the next agent attempt the final allowed
      // one. No frozen plan limit, count reader or runtime branch is substituted.
      await sql`INSERT INTO run_step_execution(step_execution_id,run_id,plan_step_id,work_item_id,
        action,state,attempt,started_at,completed_at,diagnostic)
        SELECT gen_random_uuid(),${seeded.job.runId},'preceding-run-step',NULL,'extract-adapter',
          'SUCCEEDED',1,now(),now(),NULL FROM generate_series(1,${priorCount})`;
    }
    const original = seeded.dependencies.model;
    const model: AgentModelGateway = { ...original, async propose(request) {
      modelCalls++;
      const proposed = await original.propose(request);
      if (cause === 'run-time-limit') deadlineReached = true;
      return cause === 'run-token-limit'
        ? { ...proposed, usage: { inputTokens: seeded.plan.limits.runTokens, outputTokens: 1, totalTokens: seeded.plan.limits.runTokens + 1 } }
        : proposed;
    } };
    const dependencies = { ...seeded.dependencies, model, clock: limitedClock };
    await executeAgentWorkItem(dependencies, seeded.job);
    expect(modelCalls).toBe(1);
    expect(await sql`SELECT tool_action_id FROM run_tool_action WHERE run_id=${seeded.job.runId} AND action='search' AND outcome='performed'`).toHaveLength(0);
    const [work] = await sql`SELECT tokens,diagnostic,run_started_at FROM run_agent_work WHERE run_id=${seeded.job.runId}`;
    expect(work?.diagnostic).toBe(cause);
    expect(new Date(work!.run_started_at).getTime()).toBe(runStartedAt);
    if (cause === 'run-token-limit') expect(work?.tokens).toBe(seeded.plan.limits.runTokens + 1);
    if (cause === 'run-step-execution-limit') {
      expect((await sql`SELECT count(*)::int AS count FROM run_step_execution WHERE run_id=${seeded.job.runId}`)[0]?.count).toBe(seeded.plan.limits.runStepExecutions);
    }
    expect((await sql`SELECT state FROM audit_run WHERE run_id=${seeded.job.runId}`)[0]?.state).toBe('INCONCLUSIVE');
    const checks = await sql`SELECT * FROM run_gate_check WHERE run_id=${seeded.job.runId} ORDER BY check_name`;
    expect(checks.map(row => String(row.check_name))).toEqual([...GATE_CHECKS].sort());
    const summary = await sql`SELECT payload FROM audit_events WHERE aggregate_id=${seeded.job.runId}
      AND event_type='execution.gate-checked' AND payload->>'check'='run-level-gate'`;
    expect(summary).toEqual([expect.objectContaining({ payload: expect.objectContaining({ limitCause: cause, runState: 'INCONCLUSIVE', checks: 20 }) })]);
    const result = await sql`SELECT * FROM run_result WHERE run_id=${seeded.job.runId}`;
    expect(result).toEqual([expect.objectContaining({ outcome: 'INCONCLUSIVE', run_state: 'INCONCLUSIVE', sealed: true })]);
    const seal = await sql`SELECT * FROM run_evidence_package WHERE run_id=${seeded.job.runId}`;
    expect(seal).toEqual([expect.objectContaining({ state: 'SEALED', run_state: 'INCONCLUSIVE' })]);
    const evidence = await sql`SELECT * FROM run_evidence WHERE run_id=${seeded.job.runId} ORDER BY evidence_id`;
    expect(evidence.some(row => row.kind === 'structural-snapshot' && row.state === 'REGISTERED')).toBe(true);
    for (const row of evidence.filter(row => row.state === 'REGISTERED')) {
      expect(sha256HexOfBytes(seeded.objects.get(String(row.object_key))!)).toBe(row.digest);
    }
    for (const [key, bytes] of partialBefore) expect(seeded.objects.get(key)).toEqual(bytes);
    const objectsAfter = [...seeded.objects].map(([key, bytes]) => [key, bytes.slice()] as const);
    const eventsBefore = await sql`SELECT * FROM audit_events WHERE aggregate_id=${seeded.job.runId} ORDER BY sequence`;
    await executeAgentWorkItem({ ...dependencies, repository: new PostgresAgentWorkRepository(db) }, seeded.job);
    expect(await sql`SELECT * FROM run_gate_check WHERE run_id=${seeded.job.runId} ORDER BY check_name`).toEqual(checks);
    expect(await sql`SELECT * FROM run_result WHERE run_id=${seeded.job.runId}`).toEqual(result);
    expect(await sql`SELECT * FROM run_evidence_package WHERE run_id=${seeded.job.runId}`).toEqual(seal);
    expect(await sql`SELECT * FROM run_evidence WHERE run_id=${seeded.job.runId} ORDER BY evidence_id`).toEqual(evidence);
    expect(await sql`SELECT * FROM audit_events WHERE aggregate_id=${seeded.job.runId} ORDER BY sequence`).toEqual(eventsBefore);
    expect([...seeded.objects]).toEqual(objectsAfter);
  }, 120_000);

});
