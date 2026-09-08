import { createServer, type Server } from 'node:http';
import { readFileSync } from 'node:fs';
import { handleRequest } from '../../apps/northstar/src/server.js';
import { loanCoreCredential } from '../../apps/northstar/src/fixtures.js';
import { guardedCredentials } from '../../packages/application/src/runs/credential-guard.js';
import { freezeAgentCapture } from '../../packages/application/src/runs/agent-capture.js';
import { planAgentTools } from '../../packages/application/src/runs/agent-tool-planner.js';
import { buildAbsentAgentObservation } from '../../packages/application/src/runs/agent-observation.js';
import { registerObservations } from '../../packages/application/src/runs/register-observations.js';
import { snapshotCorroboration } from '../../packages/application/src/runs/snapshot-corroboration.js';
import { ruleEvaluation } from '../../packages/application/src/runs/rule-evaluation.js';
import { runRunLevelGate } from '../../packages/application/src/runs/run-gate.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  acquirePopulation, executeAdapterSteps, executeAgentSteps, initiateRun, provisionWorkspace, raiseEscalation,
  type AgentModelGateway, type EvidenceStore,
} from '@intellifin/application';
import {
  bindingDigest, bindingDigestEnvelope, initialDraftCompliance, initialDraftEvidence, initialDraftPopulation,
  initialDraftSections, registrationDigest, sha256Hex, sha256HexOfBytes, snapshotFromRegistration, utf8Bytes, readStructuralSnapshot, authorizeToolAction, sanitizeDestination, type ToolActionParameter, type WorkItemState,
} from '@intellifin/domain';
import {
  createDb, createExceptionFingerprinter, createSqlClient, CryptoUuidV7Generator, DrizzleRoleRepository,
  PostgresAdapterExecutionRepository, PostgresAgentExecutionRepository, PostgresPopulationRepository,
  PostgresProceduresUnitOfWork, PostgresRunsUnitOfWork, PostgresWaitRepository, PostgresWorkspaceRepository,
  SystemClock, type Database, type Sql,
} from '@intellifin/infrastructure';
import { PlaywrightBrowserExecution } from '@intellifin/infrastructure/browser';
import { ManifestCredentialResolver } from '@intellifin/infrastructure/credentials';
import { executeAgentWorkItem, currentSearchQueryKeys } from '../../packages/application/src/runs/execute-agent-work-item.js';
import { PostgresAgentWorkRepository } from '../../packages/infrastructure/src/runs/agent-work-repository.js';
import { activeRunVersion } from '../fixtures/active-run-version.js';

// Real PostgreSQL + local Chromium + synthetic HTTP target. The proposal gateway is a
// fixture stub: this proves the worker path, not live model or Solari acceptance.
const url = process.env['DATABASE_URL'];
const TOKEN = loanCoreCredential().token;
const REF = loanCoreCredential().reference;
const golden = JSON.parse(readFileSync(new URL('../../fixtures/northstar/expectations/p-1-terminated-users.json', import.meta.url), 'utf8')) as {
  period: { from: string; to: string };
  cases: { case_id: string; record_key: string; expected_record_evaluation: string; expected_terminal_outcome: string; mistyped_key?: string; reported_match_count?: number; listed_match_count?: number }[];
};
const population = JSON.parse(readFileSync(new URL('../../fixtures/northstar/datasets/leavers-export.json', import.meta.url), 'utf8')) as {
  declared_schema: string[]; rows: Record<string, string>[];
};
function goldenCase(id: string) {
  const row = golden.cases.find(row => row.case_id === id);
  if (!row) throw new Error(`Missing canonical golden case ${id}`);
  return row;
}
const D12 = goldenCase('D12'), D14 = goldenCase('D14');

describe.skipIf(!url)('canonical D12/D14 absence negatives: local browser and PostgreSQL', () => {
  let sql: Sql; let db: Database; let server: Server; let origin: string;
  const ids = new CryptoUuidV7Generator(), clock = new SystemClock(), author = ids.next();
  const runs: string[] = [], procedures: string[] = [], bindings: string[] = [];
  const browsers: PlaywrightBrowserExecution[] = [];
  const requests: { method: string; path: string; authenticated: boolean }[] = [];
  const credentials = new ManifestCredentialResolver(new Map([[REF, TOKEN]]));
  const exceptions = createExceptionFingerprinter({ keyId: 'synthetic-journey', key: 'synthetic-only-key' });
  beforeAll(async () => {
    const target = new URL(url!);
    if (!['localhost', '127.0.0.1', '[::1]', 'postgres', 'db'].includes(target.hostname) || !/(?:^|[_-])(?:test|ci)(?:[_-]|$)/i.test(target.pathname.slice(1))) throw new Error('Agent journey tests require an isolated local or CI test database');
    sql = createSqlClient(url!, { max: 5 }); db = createDb(sql);
    await sql`INSERT INTO auth_user(id,name,email) VALUES (${author},'Agent journey',${author + '@test.invalid'})`;
    await sql`INSERT INTO user_role(user_id,role) VALUES (${author},'auditor')`;
    server = createServer(async (request, response) => {
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(Buffer.from(chunk));
      const result = handleRequest(request.method ?? 'GET', request.url ?? '/', request.headers, Buffer.concat(chunks).toString('utf8'));
      requests.push({ method: request.method ?? 'GET', path: request.url ?? '/', authenticated: result.status !== 401 && Boolean(request.headers.cookie) });
      response.writeHead(result.status, result.headers); response.end(result.body);
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

  async function seed(testCase: typeof D12) {
    const rows = population.rows.filter(row => row.employee_id === testCase.record_key);
    if (rows.length !== 1) throw new Error('This canonical case requires exactly one source row.');
    const schema = population.declared_schema;
    const source = { kind: 'versioned-file' as const, location: 'https://synthetic.invalid/leavers.csv', declaredSchema: schema, sensitiveFields: [], declaredCountMechanism: 'cover-sheet' as const };
    const registration = { registrationId: ids.next(), displayName: 'LoanCore', kind: 'web' as const, allowedOrigins: [origin], applicationIdentity: '', credentialRef: REF, permittedActions: ['navigate', 'search', 'read-attribute'] as const, attributeLabelPatterns: ['Employee ID', 'Full name', 'Status', 'Username', 'Roles'], secondaryKey: 'Full name', authenticationDestination: `${origin}/sign-in` };
    const inputs = { ...initialDraftPopulation('P-1'), ...initialDraftCompliance('P-1'), ...initialDraftEvidence('P-1'), templateId: 'P-1' as const, controlName: 'Synthetic leaver review', sections: initialDraftSections('P-1'), scope: 'Synthetic terminated employees', period: golden.period, sourceSnapshot: { bindingId: ids.next(), displayName: 'Synthetic leavers', digest: bindingDigest(source), contract: bindingDigestEnvelope(source) }, schedule: { frequency: 'once' as const, startTime: '00:00', periodDerivationRule: 'explicit-period' as const }, targets: [snapshotFromRegistration({ ...registration, digest: registrationDigest(registration) })], instructions: [{ registrationId: registration.registrationId, text: 'Search by the approved employee keys and inspect the account.' }] };
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
    // Explicit one-record test population, derived from the original golden row. This
    // fixture acquisition isolates D12/D14 from the unrelated duplicate source case.
    const csv = (value: string) => /[,"\r\n]/u.test(value) ? '"' + value.replaceAll('"', '""') + '"' : value;
    const body = `${schema.join(',')}\n` + rows.map(row => schema.map(key => csv(row[key] ?? '')).join(',')).join('\n') + '\n';
    await acquirePopulation({ repository: new PostgresPopulationRepository(db), acquisition: { async acquire() { return { bytes: utf8Bytes(body), mediaType: 'text/csv', declaration: { schema_version: 1, representation: 'csv-raw-v1', source: source.location, generation: 'synthetic-1', generated_at: new Date(Date.now() - 60_000).toISOString(), effective_period: inputs.period, schema, count: rows.length, sha256: sha256Hex(body), complete: true } }; } }, store, clock, ids }, job);
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
    return { job, dependencies, objects, selectedTools, plan: version.compiledPlan!, target: inputs.targets[0]!, store, browser };
  }


  it('D14: real canonical partial page becomes UNINSPECTED and INCONCLUSIVE without an escalation', async () => {
    const seeded = await seed(D14);
    await executeAgentWorkItem(seeded.dependencies, seeded.job);
    expect(seeded.selectedTools).toContain('search');
    const captures = await sql<{ object_key: string; digest: string }[]>`SELECT object_key,digest FROM run_evidence WHERE run_id=${seeded.job.runId} AND kind='structural-snapshot' AND state='REGISTERED'`;
    const partial = captures.flatMap(row => {
      const bytes = seeded.objects.get(row.object_key)!;
      expect(sha256HexOfBytes(bytes)).toBe(row.digest);
      const parsed = readStructuralSnapshot({ evidenceId: row.object_key, substrate: 'web_tree', bytes });
      return parsed.ok && parsed.substrate === 'web_tree' && parsed.document.completion?.complete === false ? [parsed.document] : [];
    });
    expect(partial).toHaveLength(1);
    expect(partial[0]!.completion).toEqual({ returned: D14.reported_match_count, complete: false });
    expect(partial[0]!.nodes.filter(node => node.role === 'datum' && node.label === 'Employee ID')).toHaveLength(D14.listed_match_count!);
    expect(await sql`SELECT state,diagnostic FROM run_work_item WHERE run_id=${seeded.job.runId}`).toEqual([expect.objectContaining({ state: 'UNINSPECTED', diagnostic: 'extraction-incomplete' })]);
    expect(await sql`SELECT wait_id FROM run_wait WHERE run_id=${seeded.job.runId}`).toHaveLength(0);
    expect(await sql`SELECT observation_id FROM run_observation WHERE run_id=${seeded.job.runId} AND found='false'`).toHaveLength(0);
    expect(await sql`SELECT value FROM run_observation_evaluation WHERE run_id=${seeded.job.runId} AND value='COMPLIANT'`).toHaveLength(0);
    expect((await sql`SELECT state FROM audit_run WHERE run_id=${seeded.job.runId}`)[0]?.state).toBe(D14.expected_terminal_outcome.toUpperCase());
    expect((await sql`SELECT outcome FROM run_result WHERE run_id=${seeded.job.runId}`)[0]?.outcome).toBe(D14.expected_terminal_outcome.toUpperCase());
    expect(requests.some(request => request.path.includes(`employee_id=${D14.record_key}`) && request.authenticated)).toBe(true);
  }, 120_000);

  it('D12 stronger prevention: a model-authored mistype is terminally denied before browser I/O', async () => {
    const seeded = await seed(D12);
    if (!D12.mistyped_key) throw new Error('Canonical D12 has no mistyped key.');
    const original = seeded.dependencies.model;
    let attempted = false;
    const model: AgentModelGateway = { ...original, async propose(request) {
      const response = await original.propose(request);
      return { ...response, actions: response.actions.map(action => {
        if (action.action !== 'search') return action;
        attempted = true;
        return { ...action, parameters: [{ name: 'employee_id', value: D12.mistyped_key! }] };
      }) };
    } };
    const requestStart = requests.length;
    await executeAgentWorkItem({ ...seeded.dependencies, model }, seeded.job);
    expect(attempted).toBe(true);
    expect(requests.slice(requestStart).some(request => request.path.includes(D12.mistyped_key!))).toBe(false);
    expect(await sql`SELECT tool_action_id FROM run_tool_action WHERE run_id=${seeded.job.runId} AND action='search' AND outcome='performed'`).toHaveLength(0);
    expect(await sql`SELECT event_type FROM audit_events WHERE aggregate_id=${seeded.job.runId} AND event_type='security.action-denied'`).toHaveLength(1);
    expect(await sql`SELECT observation_id FROM run_observation WHERE run_id=${seeded.job.runId}`).toHaveLength(0);
    // This is the earlier action-denial contract, not a completed mistyped search.
    // runStopFor('action-denied') terminates RUN_FAILED. The separate downstream
    // fault-injection test below still requires canonical D12 UNINSPECTED/INCONCLUSIVE.
    expect(await sql`SELECT payload FROM audit_events WHERE aggregate_id=${seeded.job.runId} AND event_type='security.action-denied'`).toEqual([
      expect.objectContaining({ payload: expect.objectContaining({ cause: 'action-denied', diagnostic: 'model-invalid-action', state: 'RUN_FAILED' }) }),
    ]);
    expect((await sql`SELECT state FROM audit_run WHERE run_id=${seeded.job.runId}`)[0]?.state).toBe('RUN_FAILED');
    expect((await sql`SELECT outcome FROM run_result WHERE run_id=${seeded.job.runId}`)[0]?.outcome).toBe('RUN_FAILED');
  }, 120_000);

  it('D12 downstream fault injection: actual mistyped search and exact persisted query fail shared absence judgement', async () => {
    const seeded = await seed(D12);
    if (!D12.mistyped_key) throw new Error('Canonical D12 has no mistyped key.');
    const repository = seeded.dependencies.repository;
    const initial = await repository.transaction(seeded.job.runId, async context => ({ run: context.run!, record: (await context.includedRecords())[0]!, workspace: context.workspace! }));
    const step = seeded.plan.targetSystems[0]!.planSteps.find(step => step.action === 'inspect-record')!;
    const item = { workItemId: ids.next(), subjectKey: D12.record_key, stepId: step.id, ordinal: 1,
      registrationId: seeded.target.registrationId, displayName: seeded.target.displayName,
      state: 'IN_PROGRESS' as WorkItemState, attempts: 1, cycles: 1, diagnostic: null as string | null, evidenceId: null as string | null, observations: 0 };
    const execution = { stepExecutionId: ids.next(), planStepId: step.id, workItemId: item.workItemId,
      action: step.action, state: 'RUNNING' as const, attempt: 1, startedAt: clock.now().toISOString(), completedAt: null, diagnostic: null };
    await repository.transaction(seeded.job.runId, async context => { await context.saveWorkItem(item); await context.saveStepExecution(execution); });
    const held = guardedCredentials(credentials); await held.credentials.resolve(REF, 1000);
    const commit = async (work: Parameters<typeof freezeAgentCapture>[0]['commit'] extends (work: infer W) => unknown ? W : never) => {
      await repository.transaction(seeded.job.runId, work); return true;
    };
    async function capture(action: 'navigate' | 'search', destination: string, parameters: readonly ToolActionParameter[]) {
      const startedAt = clock.now().toISOString();
      const response = await seeded.browser.perform(initial.workspace, { action, destination, parameters, credential: null, capture: ['structural-snapshot', 'screenshot'] }, 10_000, held.guard);
      const toolActionId = ids.next();
      await repository.transaction(seeded.job.runId, async context => context.saveToolAction({ toolActionId,
        runId: seeded.job.runId, stepExecutionId: execution.stepExecutionId, workItemId: item.workItemId,
        surface: 'agent', targetSystem: seeded.target.registrationId, action, method: response.method,
        destination: sanitizeDestination(response.location), parameters, outcome: 'performed', denial: null, offending: null,
        status: response.status, redirected: response.redirected, downloads: response.downloads, startedAt,
        completedAt: clock.now().toISOString(), diagnostic: null, capture: 'PERMITTED', captureSuppression: null }));
      const frozen = await freezeAgentCapture({ runId: seeded.job.runId, targetSystem: seeded.target.registrationId,
        templateId: 'P-1', toolActionId, sourceLocation: response.location, artifacts: response.artifacts ?? [],
        store: seeded.store, guard: held.guard, budget: () => 10_000, now: () => clock.now().toISOString(), commit });
      if (!frozen) throw new Error('Actual fault-injection capture did not freeze.');
      return { ...frozen, sourceLocation: response.location, toolActionId };
    }
    const controls = await capture('navigate', `${origin}/users`, []);
    const planned = planAgentTools({ plan: seeded.plan, target: seeded.target, population: initial.record,
      snapshot: controls.snapshot, sourceLocation: controls.sourceLocation, searches: [] });
    const search = planned.tools.find(tool => tool.action === 'search' && planned.parametersByToolId[tool.toolId]?.some(parameter => parameter.value === D12.record_key));
    expect(search).toBeDefined();
    const mistypedParameters = planned.parametersByToolId[search!.toolId]!.map(parameter => ({ ...parameter, value: D12.mistyped_key! }));
    // Explicit fault injection AFTER the production authorization boundary. The normal
    // runtime above refuses this request. Here we exercise only the downstream judge;
    // no production guard, frozen scope or credential path is changed to admit the typo.
    expect(authorizeToolAction({ target: seeded.target, scopeValues: new Set(Object.values(initial.record.values).filter((value): value is string => typeof value === 'string')) }, {
      action: 'search', destination: search!.destination, parameters: mistypedParameters,
    })).toMatchObject({ allowed: false, denial: 'parameter-out-of-scope' });
    const empty = await capture('search', search!.destination, mistypedParameters);
    const parsed = readStructuralSnapshot(empty.snapshot);
    expect(parsed.ok && parsed.substrate === 'web_tree' ? parsed.document.completion : null).toEqual({ returned: 0, complete: true });
    const queryKeys = currentSearchQueryKeys([{ parameters: mistypedParameters, snapshot: empty.snapshot, controlSnapshot: controls.snapshot }], seeded.target);
    expect(queryKeys).toEqual([{ key: 'employee_id', value: D12.mistyped_key }]);
    const observation = buildAbsentAgentObservation({ plan: seeded.plan, target: seeded.target, population: initial.record,
      workItemId: item.workItemId, stepExecutionId: execution.stepExecutionId, snapshot: empty.snapshot,
      queryKeys, searchEvidenceIds: [empty.snapshot.evidenceId], screenshotEvidenceId: empty.screenshotEvidenceId, observedAt: clock.now().toISOString() });
    expect(observation).not.toBeNull();
    await repository.transaction(seeded.job.runId, async context => {
      const result = await registerObservations(context, { run: initial.run, workItemId: item.workItemId,
        stepExecutionId: execution.stepExecutionId, targetSystem: seeded.target.registrationId, templateId: 'P-1',
        runStartedAt: initial.run.initiatedAt, registeredAt: clock.now().toISOString(), items: [observation!],
        evidenceRequirements: seeded.plan.inputs.evidenceRequirements }, {
          corroboration: snapshotCorroboration([controls.snapshot, empty.snapshot]),
          evaluation: ruleEvaluation({ plan: seeded.plan, records: [initial.record], references: [], period: initial.run.period }), exceptions,
        });
      expect(result.coverage.UNINSPECTED).toBe(1);
      await context.saveWorkItem({ ...item, state: 'UNINSPECTED', diagnostic: 'absence-unproven', observations: 1, evidenceId: empty.snapshot.evidenceId });
      await context.saveStepExecution({ ...execution, state: 'SUCCEEDED', completedAt: clock.now().toISOString(), diagnostic: 'absence-unproven' });
      await runRunLevelGate(context, { run: initial.run, plan: seeded.plan, decidedAt: clock.now().toISOString() });
    });
    expect(await sql`SELECT found,coverage FROM run_observation WHERE run_id=${seeded.job.runId}`).toEqual([{ found: 'false', coverage: 'UNINSPECTED' }]);
    const [proof] = await sql`SELECT proof FROM run_observation_absence WHERE run_id=${seeded.job.runId}`;
    expect(proof!.proof.queryKeys).toEqual([{ key: 'employee_id', value: D12.mistyped_key }]);
    expect(await sql`SELECT diagnostic FROM run_observation_check WHERE run_id=${seeded.job.runId} AND diagnostic='query-key-mismatch'`).toHaveLength(1);
    expect(await sql`SELECT value FROM run_observation_evaluation WHERE run_id=${seeded.job.runId}`).toEqual(expect.arrayContaining([expect.objectContaining({ value: D12.expected_record_evaluation })]));
    expect(await sql`SELECT value FROM run_observation_evaluation WHERE run_id=${seeded.job.runId} AND value='COMPLIANT'`).toHaveLength(0);
    expect((await sql`SELECT outcome FROM run_result WHERE run_id=${seeded.job.runId}`)[0]?.outcome).toBe(D12.expected_terminal_outcome.toUpperCase());
    expect(requests.some(request => request.path.includes(D12.mistyped_key!) && request.authenticated)).toBe(true);
  }, 120_000);
});
