import { expect, test } from '@playwright/test';
import { retainLiveAcceptanceReport } from '../fixtures/live-acceptance-report';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import {
  bindingDigest, bindingDigestEnvelope, initialDraftCompliance, initialDraftEvidence,
  initialDraftPopulation, initialDraftSections, registrationDigest, snapshotFromRegistration,
  type FrozenPlanInputs,
} from '@intellifin/domain';
import { acquirePopulation, cancelRun, executeAgentSteps, guardedCredentials, initiateRun, provisionWorkspace, releaseWorkspace } from '@intellifin/application';
import {
  createDb, createSqlClient, CryptoUuidV7Generator, DrizzleRoleRepository, evidenceS3Config, loadConfig,
  PostgresAgentExecutionRepository, PostgresAuditUnitOfWork, PostgresPopulationRepository, PostgresProceduresUnitOfWork,
  PostgresRunCancellationRepository, PostgresRunsUnitOfWork, PostgresWorkspaceRepository, SystemClock,
} from '@intellifin/infrastructure';
import { PlaywrightBrowserExecution, type PlaywrightWorkspace } from '@intellifin/infrastructure/browser';
import { ManifestCredentialResolver } from '@intellifin/infrastructure/credentials';
import { HttpPopulationAcquisition } from '@intellifin/infrastructure/acquisition';
import { createS3EvidenceStore } from '@intellifin/infrastructure/evidence';
import { startSyntheticS3 } from '../fixtures/s3-server';
import { agentWorkspace } from '../../apps/worker/src/startup';
import { activeRunVersion } from '../fixtures/active-run-version';
import { LIVE_EMPLOYEE_ID, liveSolariConfiguration } from '../fixtures/solari-audit-acceptance';

/** The second live gate proves simultaneous managed browser state isolation. It calls
 * the same application stages, repositories and provider composition as the worker.
 * It makes no model requests and does not claim worker-memory or provider-firewall isolation. */
test('two overlapping Solari Run workspaces keep authentication and browser state isolated', async ({}, testInfo) => {
  test.setTimeout(600_000);
  const configuration = liveSolariConfiguration();
  const ids = new CryptoUuidV7Generator(), clock = new SystemClock();
  const sql = createSqlClient(configuration.databaseUrl, { max: 5 }), db = createDb(sql);
  const storage = await startSyntheticS3();
  const config = loadConfig({ ...process.env, ...storage.env, SERVICE_NAME: 'worker', SOLARI_API_KEY: configuration.apiKey, SOLARI_RECORDING: 'false' });
  const browser = new PlaywrightBrowserExecution(agentWorkspace(config).connection);
  const store = createS3EvidenceStore(evidenceS3Config(config)!);
  const repository = new PostgresWorkspaceRepository(db);
  const dependencies = { repository, browser, ids, clock };
  const authorId = ids.next(), session = { userId: authorId, sessionId: ids.next() };
  const catalog = JSON.parse(readFileSync('fixtures/northstar/datasets/systems.json', 'utf8')) as {
    target_systems: { id: string; display_name: string; origin_path: string; authentication_destination_path: string;
      permitted_actions: ('navigate' | 'search' | 'open-record' | 'read-attribute' | 'capture-screenshot')[];
      attribute_label_patterns: string[]; secondary_key: string; credential_ref: string; credential_token: string }[];
  };
  const target = catalog.target_systems.find(row => row.id === 'loancore');
  if (!target?.credential_token || !target.authentication_destination_path) throw new Error('Synthetic LoanCore catalog is incomplete.');
  const origin = `${configuration.target}${target.origin_path}`;
  const held = guardedCredentials(new ManifestCredentialResolver(new Map([[target.credential_ref, target.credential_token]])));
  const derivedCookie = createHash('sha256').update(`loancore-session:${target.credential_token}`).digest('hex');
  const secrets = [configuration.apiKey, configuration.modelKey, target.credential_token, derivedCookie];
  const noSecrets = (value: string) => secrets.every(secret => !value.includes(secret));
  const runs: { schemaVersion: 1; runId: string; correlationId: string; label: string; workspace?: PlaywrightWorkspace }[] = [];
  let accepted = false;
  const report: Record<string, unknown> = {
    schemaVersion: 1, candidateSha: configuration.candidate, provider: 'solari', region: configuration.region,
    target: configuration.target, recording: false, maximumProviderSessions: 2, modelRequests: 0,
    proofScope: 'Two concurrent managed browser sessions; cookie/session/local/session/cache state and production adapter request interception. Worker memory and provider-side firewall policy are not asserted.',
    beganAt: new Date().toISOString(), acceptance: 'not-accepted',
    mutationExecution: 'Not executed live; mappings identify existing local/offline guards and required remote assertions, not live mutation results.',
  };
  async function endRun(row: typeof runs[number]) {
    const before = (await sql`SELECT mode,workspace_id,status,expires_at,released_at,diagnostic FROM run_workspace WHERE run_id=${row.runId}`)[0];
    report[`workspace${row.label}`] = before ?? null;
    await cancelRun({ roles: new DrizzleRoleRepository(db), unitOfWork: new PostgresAuditUnitOfWork(db),
      repository: new PostgresRunCancellationRepository(db), ids, clock }, {
      session, request: { runId: row.runId, reason: 'Bounded live isolation verification ended.' },
    });
    // RUNNING cancellation is durable until a worker stage reaches its boundary. This is
    // that actual stage, not a direct SQL transition, and it cannot provision after cancel.
    await provisionWorkspace(dependencies, row);
    await releaseWorkspace(dependencies, row.runId);
    const after = (await sql`SELECT mode,workspace_id,status,expires_at,released_at,diagnostic FROM run_workspace WHERE run_id=${row.runId}`)[0];
    report[`workspace${row.label}`] = after ?? before ?? null;
    if (!after || after.mode !== 'solari' || after.status !== 'RELEASED' || after.diagnostic !== null
      || !after.workspace_id || !after.released_at || !after.expires_at
      || new Date(String(after.released_at)).getTime() >= new Date(String(after.expires_at)).getTime()) {
      throw new Error('Live isolation cleanup is unconfirmed; retain the provider identity from the report.');
    }
    expect(await sql`SELECT sequence FROM audit_events WHERE aggregate_id=${row.runId} AND event_type='lifecycle.agent-workspace' AND payload->>'diagnostic'='workspace-released'`).toHaveLength(1);
  }
  try {
    await sql`INSERT INTO auth_user(id,name,email) VALUES (${authorId},'Synthetic Solari isolation',${authorId + '@test.invalid'})`;
    await sql`INSERT INTO user_role(user_id,role) VALUES (${authorId},'auditor')`;
    for (const label of ['A', 'B']) {
      const source = { kind: 'versioned-file' as const, location: `${configuration.target}/files/leavers-export.csv`,
        declaredSchema: ['employee_id', 'full_name', 'department', 'employment_status', 'termination_effective_date', 'manager'], sensitiveFields: [], declaredCountMechanism: 'cover-sheet' as const };
      const registration = { registrationId: ids.next(), displayName: target.display_name, kind: 'web' as const, allowedOrigins: [origin], applicationIdentity: '',
        credentialRef: target.credential_ref, permittedActions: target.permitted_actions, attributeLabelPatterns: target.attribute_label_patterns,
        secondaryKey: target.secondary_key, authenticationDestination: `${configuration.target}${target.authentication_destination_path}` };
      const population = initialDraftPopulation('P-1');
      const inputs: FrozenPlanInputs = { ...population, ...initialDraftCompliance('P-1'), ...initialDraftEvidence('P-1'),
        templateId: 'P-1', controlName: `Live Solari isolation ${label} ${ids.next()}`, sections: initialDraftSections('P-1'),
        scope: `Synthetic employee ${LIVE_EMPLOYEE_ID}, LoanCore only.`, period: { from: '2026-08-01', to: '2026-08-31' },
        inclusionRule: { schemaVersion: 1, all: [...population.inclusionRule.all, { column: 'employee_id', kind: 'text', operator: 'eq', value: LIVE_EMPLOYEE_ID }] },
        sourceSnapshot: { bindingId: ids.next(), displayName: 'Approved synthetic leavers', digest: bindingDigest(source), contract: bindingDigestEnvelope(source) },
        targets: [snapshotFromRegistration({ ...registration, digest: registrationDigest(registration) })],
        instructions: [{ registrationId: registration.registrationId, text: 'Inspect only the scoped synthetic employee through the read-only audit account.' }],
        schedule: { frequency: 'once', startTime: '00:00', periodDerivationRule: 'explicit-period' } };
      const version = activeRunVersion(ids.next(), ids.next(), authorId, inputs);
      await sql`INSERT INTO population_source_binding(binding_id,display_name,kind,location,declared_schema,declared_count_mechanism,digest)
        VALUES (${inputs.sourceSnapshot!.bindingId},'Approved synthetic leavers',${source.kind},${source.location},${source.declaredSchema},${source.declaredCountMechanism},${inputs.sourceSnapshot!.digest})`;
      await new PostgresProceduresUnitOfWork(db).execute(async context => {
        await context.procedures.insertProcedure(version); await context.procedures.insertVersion(version);
      });
      const started = await initiateRun({ roles: new DrizzleRoleRepository(db), unitOfWork: new PostgresRunsUnitOfWork(db), ids, clock }, {
        session, request: { procedureId: version.procedureId, period: inputs.period, requestToken: ids.next() },
      });
      if (!started.ok) throw new Error('Live isolation Run initiation was refused.');
      const [run] = await sql`SELECT correlation_id FROM audit_run WHERE run_id=${started.runId}`;
      const row: typeof runs[number] = { schemaVersion: 1, runId: started.runId, correlationId: String(run!.correlation_id), label };
      runs.push(row);
      report[`run${label}`] = { runId: row.runId, procedureId: version.procedureId, versionId: version.versionId, planInputDigest: version.planInputDigest };
      // Exactly one create attempt per Run. Capacity refusal is a failed gate, not a
      // reason to create additional sessions or substitute local Chromium.
      const provisioned = await provisionWorkspace(dependencies, row);
      if (!provisioned.provisioned) throw new Error('Live isolation requires two concurrently available Solari sessions; provisioning was refused.');
      const [checkpoint] = await sql`SELECT mode,workspace_id,status,expires_at,started_at FROM run_workspace WHERE run_id=${row.runId}`;
      report[`workspace${label}`] = checkpoint;
      expect(checkpoint).toMatchObject({ mode: 'solari', status: 'OPEN' });
      row.workspace = await browser.attach({ runId: row.runId, workspaceId: String(checkpoint!.workspace_id), mode: 'solari' }) ?? undefined;
      expect(row.workspace !== undefined).toBe(true);
      await acquirePopulation({ repository: new PostgresPopulationRepository(db), acquisition: new HttpPopulationAcquisition(), store, ids, clock }, row);
      expect((await sql`SELECT status FROM population_execution WHERE run_id=${row.runId}`)[0]?.status).toBe('POPULATION_READY');
    }
    const a = runs[0]!, b = runs[1]!, wa = a.workspace!, wb = b.workspace!;
    expect(wa.ref.workspaceId).not.toBe(wb.ref.workspaceId);
    expect(await sql`SELECT run_id FROM audit_run WHERE run_id = ANY(${runs.map(row => row.runId)}::uuid[]) AND state='RUNNING'`).toHaveLength(2);
    const access = { repository: new PostgresAgentExecutionRepository(db), browser, credentials: held.credentials, ids, clock };
    expect(await executeAgentSteps(access, a)).toMatchObject({ proceed: true });
    const pageA = wa.context.pages()[0]!;
    const marker = `synthetic-isolation-${ids.next()}`, cacheName = `synthetic-cache-${ids.next()}`;
    // Non-secret browser-state sentinels only. Authentication always comes from the
    // application's real form through executeAgentSteps; no cookies are fabricated.
    await pageA.evaluate(async ({ marker, cacheName }) => {
      localStorage.setItem(marker, 'A'); sessionStorage.setItem(marker, 'A');
      const cache = await caches.open(cacheName); await cache.put(location.origin + '/loancore/isolation-sentinel', new Response('A'));
    }, { marker, cacheName });
    const anonymousB = await browser.perform(wb.ref, { action: 'navigate', destination: origin, credential: null, capture: [] }, 30_000);
    expect(anonymousB.session).toBe(false);
    const pageB = wb.context.pages()[0]!;
    expect(await pageB.locator('input[type="password"]').count()).toBe(1);
    expect((await wb.context.cookies()).length).toBe(0);
    expect(await pageB.evaluate(async ({ marker, cacheName }) => ({ local: localStorage.getItem(marker), session: sessionStorage.getItem(marker), cached: (await caches.keys()).includes(cacheName) }), { marker, cacheName })).toEqual({ local: null, session: null, cached: false });
    expect(await executeAgentSteps(access, b)).toMatchObject({ proceed: true });
    await pageB.evaluate(marker => { localStorage.setItem(marker, 'B'); sessionStorage.setItem(marker, 'B'); }, marker);
    expect(await pageA.evaluate(marker => [localStorage.getItem(marker), sessionStorage.getItem(marker)], marker)).toEqual(['A', 'A']);
    expect(await pageB.evaluate(marker => [localStorage.getItem(marker), sessionStorage.getItem(marker)], marker)).toEqual(['B', 'B']);
    // Hold an operation in A pending while B performs its production browser read.
    // The latch changes browser test state only; it never changes an audited record.
    await pageA.evaluate(() => { document.documentElement.dataset['isolationLatch'] = 'held'; });
    let aFinished = false;
    const heldA = pageA.waitForFunction(() => document.documentElement.dataset['isolationLatch'] === 'released', null, { timeout: 45_000 }).then(() => { aFinished = true; });
    try {
      const readB = await browser.perform(wb.ref, { action: 'read-attribute', destination: origin, credential: null, capture: ['structural-snapshot'] }, 30_000, held.guard);
      expect(readB.status).toBe(200); expect(aFinished).toBe(false);
      expect(readB.artifacts?.some(artifact => artifact.kind === 'structural-snapshot')).toBe(true);
      for (const artifact of readB.artifacts ?? []) expect(noSecrets(new TextDecoder().decode(artifact.bytes)), 'Captured bytes must exclude credentials/session tokens').toBe(true);
    } finally { await pageA.evaluate(() => { document.documentElement.dataset['isolationLatch'] = 'released'; }); await heldA; }
    report['overlap'] = 'A browser operation remained pending while B completed an authenticated captured read.';
    const forged = { ...wa.ref, runId: b.runId };
    expect(await browser.attach(forged)).toBeNull();
    await expect(browser.perform(forged, { action: 'navigate', destination: origin, credential: null, capture: [] }, 1000)).rejects.toMatchObject({ code: 'unavailable' });
    await expect(browser.release(forged, 1000)).rejects.toMatchObject({ code: 'policy' });
    expect(await browser.attach(wa.ref)).not.toBeNull(); expect(await browser.attach(wb.ref)).not.toBeNull();
    // Direct browser fetches plant requests below the application action gate and reach
    // the production context interceptor. .invalid is deliberately non-routable even if
    // a guard regresses; no private service is exposed to the remote workspace.
    const forbidden = [`${configuration.target}/prodconsole`, 'https://intellifin-web.synthetic.invalid/runs'];
    const requestFailures: string[] = [];
    pageB.on('requestfailed', request => { if (forbidden.includes(request.url())) requestFailures.push(request.url()); });
    const deniedBefore = wb.denied();
    const results = await pageB.evaluate(async destinations => Promise.all(destinations.map(async destination => {
      try { await fetch(destination); return 'unexpected-response'; } catch { return 'refused'; }
    })), forbidden);
    expect(results).toEqual(['refused', 'refused']);
    expect(requestFailures.sort()).toEqual([...forbidden].sort());
    expect(wb.denied() - deniedBefore).toBe(2);
    // Leave samples in the workspace: releaseWorkspace must drain and persist them.
    report['webBoundary'] = 'Denied a synthetic web-app origin under the real remote browser interceptor; no deployed private web service was contacted.';
    await endRun(a);
    expect(await browser.attach(wa.ref)).toBeNull(); expect(pageA.isClosed()).toBe(true);
    let closedCookies = false; try { await wa.context.cookies(); } catch { closedCookies = true; }
    expect(closedCookies, 'Released workspace must no longer expose session cookies').toBe(true);
    expect(await browser.attach(wb.ref)).not.toBeNull(); expect(pageB.isClosed()).toBe(false);
    expect((await browser.perform(wb.ref, { action: 'read-attribute', destination: origin, credential: null, capture: [] }, 30_000)).session).toBe(true);
    expect(await pageB.evaluate(marker => [localStorage.getItem(marker), sessionStorage.getItem(marker)], marker)).toEqual(['B', 'B']);
    await endRun(b);
    const denialEvents = await sql`SELECT event_type,payload FROM audit_events WHERE aggregate_id=${b.runId} AND payload->>'diagnostic'='workspace-egress-denied'`;
    expect(denialEvents.filter(row => forbidden.includes(String((row.payload as { destination: string }).destination))).map(row => (row.payload as { destination: string }).destination).sort()).toEqual([...forbidden].sort());
    report['egressDenials'] = denialEvents;
    expect(await browser.attach(wb.ref)).toBeNull(); expect(pageB.isClosed()).toBe(true);
    expect(await sql`SELECT run_id FROM audit_run WHERE run_id = ANY(${runs.map(row => row.runId)}::uuid[]) AND state='CANCELED'`).toHaveLength(2);
    accepted = true;
  } finally {
    let cleanupConfirmed = runs.length === 2;
    for (const row of runs) {
      try { await endRun(row); } catch { cleanupConfirmed = false; report[`cleanup${row.label}`] = 'unconfirmed'; }
    }
    try { await browser.close(); } catch { cleanupConfirmed = false; report['clientClose'] = 'unconfirmed'; }
    report['acceptance'] = accepted && cleanupConfirmed ? 'passed' : 'not-accepted';
    report['finishedAt'] = new Date().toISOString();
    await retainLiveAcceptanceReport(testInfo, 'solari-workspace-isolation.json', report, secrets);
    await storage.close(); await sql.end({ timeout: 5 });
    if (accepted && !cleanupConfirmed) throw new Error('Live isolation failed: cleanup was not confirmed.');
  }
});
