import { readFileSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { fileURLToPath } from 'node:url';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  acquirePopulation,
  executeAdapterSteps,
  executeAgentSteps,
  initiateRun,
  provisionWorkspace,
  raiseEscalation,
  type RaiseEscalationInput,
  type AgentModelGateway,
  type EvidenceStore,
} from '@intellifin/application';
import {
  bindingDigest,
  bindingDigestEnvelope,
  initialDraftCompliance,
  initialDraftEvidence,
  initialDraftPopulation,
  initialDraftSections,
  registrationDigest,
  sha256HexOfBytes,
  snapshotFromRegistration,
  type JsonValue,
} from '@intellifin/domain';
import {
  createDb,
  createExceptionFingerprinter,
  createSqlClient,
  CryptoUuidV7Generator,
  DrizzleRoleRepository,
  PostgresAgentExecutionRepository,
  PostgresAdapterExecutionRepository,
  PostgresPopulationRepository,
  PostgresProceduresUnitOfWork,
  PostgresRunsUnitOfWork,
  PostgresWaitRepository,
  PostgresWorkspaceRepository,
  SystemClock,
  type Database,
  type Sql,
} from '@intellifin/infrastructure';
import { PlaywrightBrowserExecution } from '@intellifin/infrastructure/browser';
import { ManifestCredentialResolver } from '@intellifin/infrastructure/credentials';
import { HttpPopulationAcquisition as NorthstarPopulationAcquisition } from '@intellifin/infrastructure/acquisition';
import { handleRequest } from '../../apps/northstar/src/server.js';
import { executeAgentWorkItem } from '../../packages/application/src/runs/execute-agent-work-item.js';
import { PostgresAgentWorkRepository } from '../../packages/infrastructure/src/runs/agent-work-repository.js';
import { activeRunVersion } from '../fixtures/active-run-version.js';

/**
 * Story 4.10's golden run is deliberately a fixture journey rather than a model test.
 * Northstar supplies the page and source bytes; the local model only selects opaque tool
 * ids and locators from the request. All expected case values and the terminal outcome are
 * read from disk, so this test cannot become a second evaluator hidden in a fixture.
 */
const databaseUrl = process.env['DATABASE_URL'];
const EXPECTATIONS_PATH = fileURLToPath(new URL('../../fixtures/northstar/expectations/p-4-config-deviation.json', import.meta.url));
const COUNT_EXPECTATIONS_PATH = fileURLToPath(new URL('../../fixtures/northstar/generated/prodconsole-parameters.count.json', import.meta.url));
const TOKEN = 'synthetic-prodconsole-test-credential-with-no-page-auth';
const CREDENTIAL_REF = 'cred://synthetic/prodconsole-public';

interface P4Expectation {
  readonly run_expectation: { readonly terminal_outcome: string };
  readonly cases: readonly {
    readonly case_id: string;
    readonly record_key: string | null;
    readonly expected_record_evaluation: string | null;
  }[];
}

interface CountExpectation {
  readonly declared_count: number;
}

interface AgentModelRequestLike {
  readonly tools: readonly { readonly toolId: string; readonly action: string; readonly destination: string; readonly locator: unknown }[];
  readonly retrieved: readonly { readonly source: string; readonly text: string }[];
  actions?: readonly {
    readonly toolId: string;
    readonly action: string;
    readonly destination: string;
    readonly locator: unknown;
    readonly parameters: readonly unknown[];
  }[];
}

const expectation = JSON.parse(readFileSync(EXPECTATIONS_PATH, 'utf8')) as P4Expectation;
const countExpectation = JSON.parse(readFileSync(COUNT_EXPECTATIONS_PATH, 'utf8')) as CountExpectation;

function expectedOutcome(value: string): string {
  return {
    Pass: 'PASS',
    'Control Failure': 'CONTROL_FAILURE',
    Inconclusive: 'INCONCLUSIVE',
    'Run Failed': 'RUN_FAILED',
  }[value] ?? value.toUpperCase().replaceAll(' ', '_');
}

function bodyBuffer(body: string | Uint8Array): Buffer {
  return typeof body === 'string' ? Buffer.from(body, 'utf8') : Buffer.from(body);
}

async function listenNorthstar(): Promise<{ readonly server: Server; readonly origin: string }> {
  const server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on('data', (chunk: Buffer | string) => chunks.push(Buffer.from(chunk)));
    request.on('end', () => {
      const answer = handleRequest(
        request.method ?? 'GET',
        request.url ?? '/',
        request.headers as Readonly<Record<string, string | readonly string[] | undefined>>,
        Buffer.concat(chunks).toString('utf8'),
      );
      const body = bodyBuffer(answer.body);
      response.writeHead(answer.status, {
        ...answer.headers,
        'content-length': String(body.byteLength),
      });
      response.end(body);
    });
  });
  await new Promise<void>((resolveListen, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolveListen());
  });
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('Northstar fixture server did not bind a TCP port');
  return { server, origin: `http://127.0.0.1:${address.port}` };
}

function isRecord(value: JsonValue): value is Record<string, JsonValue> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

describe.skipIf(!databaseUrl)('P-4 ProdConsole agent journey', () => {
  let sql: Sql;
  let db: Database;
  let server: Server;
  let northstarOrigin: string;
  const ids = new CryptoUuidV7Generator();
  const clock = new SystemClock();
  const author = ids.next();
  const runs: string[] = [];
  const procedures: string[] = [];
  const bindings: string[] = [];
  const browsers: PlaywrightBrowserExecution[] = [];
  let credentialResolutions = 0;
  const manifestCredentials = new ManifestCredentialResolver(new Map([[CREDENTIAL_REF, TOKEN]]));
  const credentialResolver = {
    async resolve(reference: string, timeoutMs: number) {
      credentialResolutions += 1;
      return manifestCredentials.resolve(reference, timeoutMs);
    },
  };
  const exceptions = createExceptionFingerprinter({ keyId: 'p4-prodconsole-test', key: 'p4-prodconsole-test-key' });

  beforeAll(async () => {
    const parsedDatabase = new URL(databaseUrl!);
    if (
      !['localhost', '127.0.0.1', '[::1]', 'postgres', 'db'].includes(parsedDatabase.hostname) ||
      !/(?:^|[_-])(?:test|ci)(?:[_-]|$)/iu.test(parsedDatabase.pathname.slice(1))
    ) {
      throw new Error('ProdConsole integration requires an isolated local or CI test database');
    }
    sql = createSqlClient(databaseUrl!, { max: 5 });
    db = createDb(sql);
    await sql`INSERT INTO auth_user(id,name,email) VALUES (${author},'P-4 integration',${author + '@test.invalid'})`;
    await sql`INSERT INTO user_role(user_id,role) VALUES (${author},'auditor')`;
    const fixture = await listenNorthstar();
    server = fixture.server;
    northstarOrigin = fixture.origin;
  }, 30_000);

  afterAll(async () => {
    for (const browser of browsers) await browser.close().catch(() => undefined);
    if (server) await new Promise<void>((resolveClose) => server.close(() => resolveClose()));
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
      for (const procedureId of procedures) {
        await sql`DELETE FROM procedure_version WHERE procedure_id=${procedureId}`;
        await sql`DELETE FROM procedure WHERE procedure_id=${procedureId}`;
      }
      for (const bindingId of bindings) await sql`DELETE FROM population_source_binding WHERE binding_id=${bindingId}`;
      await sql`DELETE FROM auth_user WHERE id=${author}`;
    } finally {
      await sql.end({ timeout: 5 });
    }
  }, 30_000);

  async function seedRun(): Promise<{
    readonly job: { readonly schemaVersion: 1; readonly runId: string; readonly correlationId: string };
    readonly dependencies: Parameters<typeof executeAgentWorkItem>[0];
    readonly targetRegistrationId: string;
    readonly storeObjects: Map<string, Uint8Array>;
    readonly modelCalls: AgentModelRequestLike[];
  }> {
    const source = {
      kind: 'versioned-file' as const,
      location: `${northstarOrigin}/files/config-registry.csv`,
      declaredSchema: ['parameter', 'approved_value', 'effective_time', 'disposition'],
      sensitiveFields: [],
      declaredCountMechanism: 'cover-sheet' as const,
    };
    const registration = {
      registrationId: ids.next(),
      displayName: 'ProdConsole',
      kind: 'web' as const,
      allowedOrigins: [`${northstarOrigin}/prodconsole/configuration`],
      applicationIdentity: '',
      // The published P-4 target is public. The reference remains a required frozen
      // registration field for compatibility with the v1 plan shape; the P-4 public access
      // verification must never resolve or present it.
      credentialRef: CREDENTIAL_REF,
      permittedActions: ['navigate', 'read-attribute', 'read-metadata', 'capture-screenshot'] as const,
      attributeLabelPatterns: ['Parameter', 'Value', 'Snapshot identifier', 'Expected parameter count', 'Snapshot taken at'] as const,
      secondaryKey: '',
    };
    const target = snapshotFromRegistration({ ...registration, digest: registrationDigest(registration) });
    const bindingId = ids.next();
    const sourceSnapshot = {
      bindingId,
      displayName: 'ConfigRegistry baseline',
      digest: bindingDigest(source),
      contract: bindingDigestEnvelope(source),
    };
    const inputs = {
      ...initialDraftPopulation('P-4'),
      ...initialDraftCompliance('P-4'),
      ...initialDraftEvidence('P-4'),
      templateId: 'P-4' as const,
      controlName: 'Northstar ProdConsole configuration baseline',
      sections: initialDraftSections('P-4'),
      scope: 'Compare the published ProdConsole configuration with the ConfigRegistry baseline.',
      period: { from: '2026-08-01', to: '2026-08-31' },
      sourceSnapshot,
      schedule: { frequency: 'once' as const, startTime: '00:00', periodDerivationRule: 'explicit-period' as const },
      targets: [target],
      instructions: [{ registrationId: registration.registrationId, text: 'Read the frozen ProdConsole parameter and metadata labels.' }],
    };
    bindings.push(bindingId);
    await sql`INSERT INTO population_source_binding(binding_id,display_name,kind,location,declared_schema,declared_count_mechanism,digest) VALUES (${bindingId},${sourceSnapshot.displayName},${source.kind},${source.location},${source.declaredSchema},${source.declaredCountMechanism},${sourceSnapshot.digest})`;
    const version = activeRunVersion(ids.next(), ids.next(), author, inputs);
    procedures.push(version.procedureId);
    await new PostgresProceduresUnitOfWork(db).execute(async context => {
      await context.procedures.insertProcedure(version);
      await context.procedures.insertVersion(version);
    });

    const started = await initiateRun(
      { roles: new DrizzleRoleRepository(db), unitOfWork: new PostgresRunsUnitOfWork(db), ids, clock },
      {
        session: { userId: author, sessionId: author },
        request: { procedureId: version.procedureId, period: inputs.period, requestToken: ids.next() },
      },
    );
    if (!started.ok) throw new Error('P-4 integration run initiation refused');
    runs.push(started.runId);
    const [run] = await sql<{ correlation_id: string }[]>`SELECT correlation_id FROM audit_run WHERE run_id=${started.runId}`;
    const job = { schemaVersion: 1 as const, runId: started.runId, correlationId: run!.correlation_id };

    const storeObjects = new Map<string, Uint8Array>();
    const store: EvidenceStore = {
      async read(key) {
        return storeObjects.get(key)?.slice() ?? null;
      },
      async putIfAbsent(key, bytes) {
        if (!storeObjects.has(key)) storeObjects.set(key, bytes.slice());
      },
    };
    const browser = new PlaywrightBrowserExecution({ mode: 'local' });
    browsers.push(browser);
    expect(await provisionWorkspace({ repository: new PostgresWorkspaceRepository(db), browser, clock, ids }, job)).toMatchObject({ provisioned: true });
    const population = await acquirePopulation({
      repository: new PostgresPopulationRepository(db),
      acquisition: new NorthstarPopulationAcquisition(),
      store,
      clock,
      ids,
    }, job);
    expect(population).toMatchObject({ retry: false });

    // This call exercises the public P-4 access prerequisite implemented by the runtime.
    // It must not fabricate a signed-in session or resolve CREDENTIAL_REF for ProdConsole.
    const agentPhase = await executeAgentSteps({ repository: new PostgresAgentExecutionRepository(db), browser, credentials: credentialResolver, clock, ids }, job);
    expect(agentPhase.proceed).toBe(true);
    expect(agentPhase.retry).toBe(false);
    expect(credentialResolutions).toBe(0);
    const adapterPhase = await executeAdapterSteps({
      repository: new PostgresAdapterExecutionRepository(db),
      reference: { acquireReference: async (): Promise<never> => { throw new Error('P-4 must not use an adapter shortcut'); } },
      extraction: { extract: async (): Promise<never> => { throw new Error('P-4 must not use an adapter shortcut'); } },
      credentials: credentialResolver,
      store,
      clock,
      ids,
      exceptions,
    }, job);
    expect(adapterPhase.retry).toBe(false);

    const modelCalls: AgentModelRequestLike[] = [];
    const identity: AgentModelGateway['identity'] = {
      provider: 'anthropic',
      modelId: 'local-prodconsole-proposal-stub',
      promptVersion: 'local-fixture-test',
      buildVersion: 'local-test',
      configuration: { responseFormat: 'agent-action-proposal-v1', maxOutputTokens: 256, maxActions: 16, temperature: 0 },
    };
    const model: AgentModelGateway = {
      identity,
      async propose(request) {
        const captured: AgentModelRequestLike = { tools: request.tools, retrieved: request.retrieved };
        modelCalls.push(captured);
        // The model can see untrusted page text, including the seeded Description. It may
        // select only actual approved tools and locators; it never supplies a value.
        const actions = request.phase === 'evaluation'
          ? []
          : request.tools
            .filter(tool => tool.action === 'read-attribute' || tool.action === 'read-metadata')
            .map(tool => ({ toolId: tool.toolId, action: tool.action, destination: tool.destination, locator: tool.locator, parameters: [] as const }));
        captured.actions = actions;
        return {
          schemaVersion: 1,
          phase: request.phase,
          route: 'anthropic' as const,
          model: identity,
          actions,
          uncertainty: { kind: 'none' as const, rationale: null },
          usage: { inputTokens: 24, outputTokens: 12, totalTokens: 36 },
        };
      },
    };
    const dependencies = {
      repository: new PostgresAgentWorkRepository(db),
      browser,
      credentials: credentialResolver,
      model,
      store,
      clock,
      ids,
      exceptions,
      waits: {
        raiseEscalation: (input: RaiseEscalationInput) =>
          raiseEscalation({ repository: new PostgresWaitRepository(db), clock, ids }, input),
      },
    };
    return { job, dependencies, targetRegistrationId: registration.registrationId, storeObjects, modelCalls };
  }

  it('runs the real P-4 page and registers one Observation per distinct baseline key', async () => {
    const seeded = await seedRun();
    await executeAgentWorkItem(seeded.dependencies, seeded.job);

    expect(seeded.modelCalls.length).toBeGreaterThan(0);
    for (const call of seeded.modelCalls) {
      for (const action of call.actions ?? []) {
        expect(action.parameters).toEqual([]);
        expect(call.tools).toContainEqual(expect.objectContaining({
          toolId: action.toolId,
          action: action.action,
          destination: action.destination,
          locator: action.locator,
        }));
      }
    }

    const populationRows = await sql<{ values: JsonValue }[]>`SELECT values FROM population_row WHERE run_id=${seeded.job.runId} AND disposition='included' ORDER BY ordinal`;
    const baselineKeys = [...new Set(populationRows.flatMap(row => isRecord(row.values) && typeof row.values['parameter'] === 'string' ? [row.values['parameter']] : []))];
    expect(baselineKeys).toHaveLength(5);

    const workItems = await sql<{ work_item_id: string; subject_key: string | null; registration_id: string; state: string; observations: number; evidence_id: string | null }[]>`SELECT work_item_id,subject_key,registration_id,state,observations,evidence_id FROM run_work_item WHERE run_id=${seeded.job.runId} ORDER BY ordinal`;
    expect(workItems).toHaveLength(1);
    expect(workItems[0]).toMatchObject({ subject_key: null, registration_id: seeded.targetRegistrationId, state: 'OBSERVED', observations: 5 });
    expect(workItems[0]!.evidence_id).toBeTruthy();

    const observations = await sql<{
      observation_id: string;
      population_record_key: string;
      found: string;
      identity: Record<string, unknown> | null;
      attributes: readonly Record<string, unknown>[];
      evidence_ids: readonly string[];
      coverage: string;
    }[]>`SELECT observation_id,population_record_key,found,identity,attributes,evidence_ids,coverage FROM run_observation WHERE run_id=${seeded.job.runId} ORDER BY population_record_key`;
    expect(observations).toHaveLength(baselineKeys.length);
    expect(observations.map(row => row.population_record_key).sort()).toEqual([...baselineKeys].sort());
    expect(new Set(observations.map(row => row.population_record_key)).size).toBe(5);
    for (const row of observations.filter(candidate => candidate.found === 'true')) {
      expect(row.identity).toMatchObject({ name: 'parameter', normalizedValue: row.population_record_key });
    }

    const evaluations = await sql<{ population_record_key: string; value: string; rationale: string | null }[]>`SELECT o.population_record_key,e.value,e.rationale FROM run_observation o JOIN run_observation_evaluation e ON e.observation_id=o.observation_id WHERE o.run_id=${seeded.job.runId} ORDER BY o.population_record_key`;
    const expectedEvaluations = new Map(
      expectation.cases
        .filter(entry => entry.record_key !== null && entry.expected_record_evaluation !== null)
        .map(entry => [entry.record_key!, entry.expected_record_evaluation!] as const),
    );
    expect(evaluations).toHaveLength(5);
    for (const row of evaluations) expect(row.value).toBe(expectedEvaluations.get(row.population_record_key));

    const missing = observations.find(row => row.population_record_key === 'production_debug_mode');
    expect(missing).toMatchObject({ found: 'false', identity: null, coverage: 'UNINSPECTED' });
    const missingObservedValue = missing?.attributes.find(attribute => attribute['name'] === 'observed_value');
    expect(missingObservedValue).toMatchObject({ originalValue: null, grounding: null });

    const prohibited = observations.find(row => row.population_record_key === 'legacy_direct_db_access');
    expect(prohibited).toMatchObject({ found: 'true' });
    expect(JSON.stringify(prohibited)).not.toContain('CR-0000');
    expect(evaluations.find(row => row.population_record_key === 'legacy_direct_db_access')?.value).toBe('EXCEPTION');
    expect(evaluations.find(row => row.population_record_key === 'legacy_direct_db_access')?.rationale ?? '').not.toContain('CR-0000');
    expect(evaluations.find(row => row.population_record_key === 'session_timeout_minutes')?.value).toBe('UNEVALUATED');

    const countRows = await sql<{ check_name: string; outcome: string; diagnostics: readonly string[] }[]>`SELECT check_name,outcome,diagnostics FROM run_gate_check WHERE run_id=${seeded.job.runId} ORDER BY check_name`;
    expect(countRows).toHaveLength(20);
    const failedChecks = countRows.filter(row => row.outcome === 'FAIL').map(row => row.check_name).sort();
    // The source duplicate, missing P-4 parameter, ungrounded absent value, and the page's
    // independently published count each remain findings. Assert this set before reading
    // run_result so a weakened outcome cannot hide a missing §H failure.
    expect(failedChecks).toEqual([
      'count-reconciliation-file',
      'duplicate-primary-keys',
      'per-record-coverage',
      'required-evidence',
      'search-completeness',
    ].sort());
    expect(countRows.find(row => row.check_name === 'count-reconciliation-file')?.diagnostics).toContain('declared-count-mismatch');

    const [result] = await sql<{ outcome: string; outcome_row: string; gate_passed: boolean }[]>`SELECT outcome,outcome_row,gate_passed FROM run_result WHERE run_id=${seeded.job.runId}`;
    expect(result).toMatchObject({ outcome: expectedOutcome(expectation.run_expectation.terminal_outcome), gate_passed: false });
    expect(result!.outcome_row).toBe('gate-failed');

    expect(workItems[0]!.observations).not.toBe(countExpectation.declared_count);
    for (const key of seeded.storeObjects.keys()) {
      const bytes = seeded.storeObjects.get(key)!;
      expect(sha256HexOfBytes(bytes)).toMatch(/^[0-9a-f]{64}$/u);
      expect(new TextDecoder().decode(bytes)).not.toContain(TOKEN);
    }
  }, 180_000);
});
