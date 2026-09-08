import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  EVIDENCE_READ_GRANT_QUEUE,
  EVIDENCE_READ_GRANT_SCHEMA_VERSION,
  issueEvidenceReadGrant,
  requestEvidenceReadGrant,
} from '@intellifin/application';
import {
  createDb,
  createSqlClient,
  CryptoUuidV7Generator,
  DrizzleRunDetailRepository,
  migrateRunsQueue,
  PostgresEvidenceReadGrantRepository,
  PostgresProceduresUnitOfWork,
  SystemClock,
  type Database,
  type Sql,
} from '@intellifin/infrastructure';
import { sha256HexOfBytes, utf8Bytes } from '@intellifin/domain';

import { readSnapshotCellWithGrant } from '../../apps/web/src/runs/evidence-snapshot-reader.js';
import { activeRunVersion } from '../fixtures/active-run-version.js';

const databaseUrl = process.env.DATABASE_URL;
const WEB_TREE_MEDIA_TYPE = 'application/vnd.intellifin.web-tree+json';
const LOCATOR = '$.nodes[0].value';

interface SeededRun {
  readonly runId: string;
  readonly evidenceId: string;
  readonly objectKey: string;
  readonly registeredBytes: Uint8Array;
  readonly digest: string;
  readonly size: number;
}

describe.skipIf(!databaseUrl)('stored Evidence read grants on PostgreSQL', () => {
  let sql: Sql;
  let db: Database;
  const ids = new CryptoUuidV7Generator();
  const clock = new SystemClock();
  const author = ids.next();
  const procedureId = ids.next();
  const versionId = ids.next();
  const runIds: string[] = [];

  beforeAll(async () => {
    const target = new URL(databaseUrl!);
    if (!['localhost', '127.0.0.1', '[::1]', 'postgres', 'db'].includes(target.hostname) ||
        !/(?:^|[_-])(?:test|ci)(?:[_-]|$)/i.test(target.pathname.slice(1))) {
      throw new Error('Evidence read grant tests require an isolated test database');
    }
    sql = createSqlClient(databaseUrl!, { max: 8 });
    db = createDb(sql);
    await sql`INSERT INTO auth_user(id,name,email) VALUES (${author},'Evidence read test',${author + '@test.invalid'})`;
    await sql`INSERT INTO user_role(user_id,role) VALUES (${author},'auditor')`;
    const version = activeRunVersion(procedureId, versionId, author);
    await new PostgresProceduresUnitOfWork(db).execute(async context => {
      await context.procedures.insertProcedure(version);
      await context.procedures.insertVersion(version);
    });
    // The production release creates all consumers after schema migration. This call is
    // idempotent and makes the durable request assertion below work in an isolated test DB
    // whose migration job did not pre-provision pg-boss queues.
    await migrateRunsQueue(db);
  });

  afterAll(async () => {
    if (!sql) return;
    try {
      for (const runId of runIds) {
        await sql`DELETE FROM pgboss.job WHERE name=${EVIDENCE_READ_GRANT_QUEUE} AND data->>'grantId' IN (SELECT grant_id::text FROM evidence_read_grant WHERE run_id=${runId})`;
        await sql`DELETE FROM evidence_read_grant WHERE run_id=${runId}`;
        await sql`DELETE FROM run_evidence_integrity WHERE run_id=${runId}`;
        await sql`DELETE FROM run_result_review WHERE run_id=${runId}`;
        await sql`DELETE FROM run_result WHERE run_id=${runId}`;
        await sql`DELETE FROM run_evidence_package WHERE run_id=${runId}`;
        await sql`DELETE FROM run_observation WHERE run_id=${runId}`;
        await sql`DELETE FROM run_work_item WHERE run_id=${runId}`;
        await sql`DELETE FROM run_evidence WHERE run_id=${runId}`;
        await sql`DELETE FROM audit_events WHERE aggregate_id=${runId}`;
        await sql`DELETE FROM audit_event_heads WHERE aggregate_id=${runId}`;
        await sql`DELETE FROM audit_run WHERE run_id=${runId}`;
      }
      await sql`DELETE FROM procedure_version WHERE procedure_id=${procedureId}`;
      await sql`DELETE FROM procedure WHERE procedure_id=${procedureId}`;
      await sql`DELETE FROM user_role WHERE user_id=${author}`;
      await sql`DELETE FROM auth_user WHERE id=${author}`;
    } finally {
      await sql.end({ timeout: 5 });
    }
  });

  async function seedRun(options: { readonly terminal?: boolean } = {}): Promise<SeededRun> {
    const runId = ids.next();
    const evidenceId = ids.next();
    const correlationId = ids.next();
    const requestToken = ids.next();
    const objectKey = `structural-snapshot/${runId}/${evidenceId}`;
    const registeredBytes = utf8Bytes(JSON.stringify({
      schemaVersion: 1,
      nodes: [{ group: 'record:0', role: 'datum', label: 'Employee ID', value: 'E-1', target: null }],
    }));
    const digest = sha256HexOfBytes(registeredBytes);
    const at = clock.now().toISOString();
    const ordinal = runIds.length + 1;
    const day = String(Math.min(28, ordinal + 1)).padStart(2, '0');
    await sql`INSERT INTO audit_run(
      request_token,run_id,correlation_id,procedure_id,version_id,version_number,
      procedure_name,period_from,period_to,state,kind,initiator_id,session_id,
      authorization_role,initiated_at
    ) VALUES (
      ${requestToken},${runId},${correlationId},${procedureId},${versionId},1,
      'Evidence read test',${`2026-08-${day}`},${`2026-08-${day}`},'RUNNING','STANDARD',
      ${author},${`evidence-read-${ordinal}`},'auditor',${at}
    )`;
    await sql`INSERT INTO run_evidence(
      evidence_id,run_id,kind,registration_id,object_key,media_type,digest,size,state,
      required,captured_at,capture_method,capture_time_source
    ) VALUES (
      ${evidenceId},${runId},'structural-snapshot','evidence-read-target',${objectKey},
      ${WEB_TREE_MEDIA_TYPE},${digest},${registeredBytes.byteLength},'REGISTERED',false,
      ${at},'agent','registration'
    )`;
    runIds.push(runId);
    if (options.terminal) {
      // Seed a truthful terminal package/result before testing the post-Run mismatch path.
      // The snapshot is optional for this fixture, so the package is SEALED over the one
      // registered artifact without needing population or Gate rows.
      await sql`INSERT INTO run_evidence_package(
        run_id,state,run_state,sealed_at,required_total,registered,missing_required,abandoned
      ) VALUES (${runId},'SEALED','COMPLETED',${at},0,1,'[]'::jsonb,'[]'::jsonb)`;
      await sql`INSERT INTO run_result(
        run_id,version,outcome,outcome_row,sealed,run_state,gate_passed,sealed_at,scope,publication
      ) VALUES (${runId},1,'PASS','pass',true,'COMPLETED',true,${at},NULL,'{}'::jsonb)`;
      await sql`UPDATE audit_run SET state='COMPLETED' WHERE run_id=${runId}`;
    }
    return { runId, evidenceId, objectKey, registeredBytes, digest, size: registeredBytes.byteLength };
  }

  async function requestGrant(run: SeededRun): Promise<{ readonly grantId: string; readonly repository: PostgresEvidenceReadGrantRepository }> {
    const repository = new PostgresEvidenceReadGrantRepository(db, { clock, ids });
    const requested = await requestEvidenceReadGrant(
      { repository, ids, clock },
      {
        session: { userId: author, sessionId: `session-${run.runId}` },
        correlationId: ids.next(),
        request: { runId: run.runId, evidenceId: run.evidenceId, locator: LOCATOR },
      },
    );
    expect(requested.ok).toBe(true);
    if (!requested.ok) throw new Error('grant request fixture failed');
    const jobs = await sql`SELECT data FROM pgboss.job WHERE name=${EVIDENCE_READ_GRANT_QUEUE} AND data->>'grantId'=${requested.grantId}`;
    expect(jobs).toHaveLength(1);
    expect(jobs[0]!.data).toMatchObject({ schemaVersion: EVIDENCE_READ_GRANT_SCHEMA_VERSION, grantId: requested.grantId });
    return { grantId: requested.grantId, repository };
  }

  async function issue(run: SeededRun): Promise<{ readonly grantId: string; readonly repository: PostgresEvidenceReadGrantRepository }> {
    const requested = await requestGrant(run);
    const result = await issueEvidenceReadGrant(
      {
        repository: requested.repository,
        clock,
        signer: {
          signGet: async ({ bucketKey, expiresAt }) => {
            expect(bucketKey).toBe(run.objectKey);
            return { signedUrl: `https://objects.invalid/${run.evidenceId}`, signedUrlExpiresAt: expiresAt };
          },
        },
      },
      { schemaVersion: EVIDENCE_READ_GRANT_SCHEMA_VERSION, grantId: requested.grantId },
    );
    expect(result).toEqual({ status: 'issued', grantId: requested.grantId });
    return requested;
  }

  it('persists the request, issues only the registered snapshot, and revokes a capability after role loss', async () => {
    const run = await seedRun();
    const { grantId, repository } = await issue(run);
    const now = clock.now().toISOString();
    expect(await repository.readForActor({ grantId, actorId: author, now })).toMatchObject({
      grantId,
      runId: run.runId,
      evidenceId: run.evidenceId,
      digest: run.digest,
      size: run.size,
    });

    await sql`DELETE FROM user_role WHERE user_id=${author}`;
    try {
      expect(await repository.readForActor({ grantId, actorId: author, now })).toBeNull();
      expect(await sql`SELECT status,denial_code,signed_url FROM evidence_read_grant WHERE grant_id=${grantId}`).toEqual([
        { status: 'denied', denial_code: 'unauthorized', signed_url: null },
      ]);
      expect(await sql`SELECT event_type,payload FROM audit_events WHERE aggregate_id=${run.runId} AND event_type='evidence-access.denied'`).toHaveLength(1);
    } finally {
      await sql`INSERT INTO user_role(user_id,role) VALUES (${author},'auditor')`;
    }
  });

  it('rechecks the fresh role after bytes have been downloaded and refuses to render revoked access', async () => {
    const run = await seedRun();
    const { grantId, repository } = await issue(run);
    const result = await readSnapshotCellWithGrant(repository, {
      grantId, runId: run.runId, evidenceId: run.evidenceId, actorId: author,
      locator: LOCATOR, correlationId: ids.next(), maxGrantWaitMs: 0,
    }, {
      fetch: async () => {
        await sql`DELETE FROM user_role WHERE user_id=${author}`;
        return new Response(run.registeredBytes.buffer as ArrayBuffer);
      },
    }).finally(async () => { await sql`INSERT INTO user_role(user_id,role) VALUES (${author},'auditor')`; });
    expect(result).toEqual({ cell: null, failure: 'access-denied' });
    expect(await sql`SELECT status,denial_code,signed_url FROM evidence_read_grant WHERE grant_id=${grantId}`)
      .toEqual([{ status: 'denied', denial_code: 'unauthorized', signed_url: null }]);
    expect(await sql`SELECT event_type FROM audit_events WHERE aggregate_id=${run.runId} AND event_type='evidence-access.read'`).toEqual([]);
  });

  it('commits an expired denial with the matching code when authorization is refused after the deadline', async () => {
    const run = await seedRun();
    const repository = new PostgresEvidenceReadGrantRepository(db, { clock, ids });
    const grantId = ids.next();
    const requestedAt = new Date(Date.now() - 60_000).toISOString();
    const expiresAt = new Date(Date.now() - 30_000).toISOString();
    await repository.request({ grantId, runId: run.runId, evidenceId: run.evidenceId, locator: LOCATOR,
      actorId: author, sessionId: 'expired-denial', correlationId: ids.next(), requestedAt, expiresAt });
    await expect(repository.transaction(grantId, context => context.deny('unauthorized')))
      .resolves.toEqual({ changed: true, code: 'expired' });
    expect(await sql`SELECT status,denial_code FROM evidence_read_grant WHERE grant_id=${grantId}`)
      .toEqual([{ status: 'expired', denial_code: 'expired' }]);
  });

  it('resolves recorded groundings beyond the 50-Observation sample and refuses ambiguous or cross-Run locators', async () => {
    const run = await seedRun();
    const workItem = ids.next();
    await sql`INSERT INTO run_work_item(work_item_id,run_id,step_id,ordinal,registration_id,display_name,state,attempts,cycles,diagnostic,evidence_id,observations)
      VALUES(${workItem},${run.runId},'inspect',1,'evidence-read-target','Stored read','OBSERVED',1,0,NULL,${run.evidenceId},51)`;
    for (let index = 0; index < 51; index += 1) {
      const value = `E-${String(index).padStart(3,'0')}`;
      const identity = { name: 'employee_id', originalValue: value, normalizedValue: value,
        grounding: { evidenceId: run.evidenceId, locator: `$.nodes[${index}].value`, label: 'Employee ID', extractedText: value }, corroboration: 'matched' };
      await sql`INSERT INTO run_observation(observation_id,run_id,work_item_id,schema_version,population_record_key,target_system,found,observed_at,
        step_execution_id,capture_method,match_origin,identity,attributes,evidence_ids,digest,coverage,observed_at_source,corroboration)
        VALUES(${ids.next()},${run.runId},${workItem},1,${value},'evidence-read-target','true',${clock.now().toISOString()},
        ${ids.next()},'agent','platform',${JSON.stringify(identity)}::jsonb,'[]'::jsonb,${JSON.stringify([run.evidenceId])}::jsonb,
        ${'d'.repeat(64)},'COVERED',${clock.now().toISOString()},'MATCHED')`;
    }
    const detail = new DrizzleRunDetailRepository(db);
    expect((await detail.readObservations(run.runId)).rows).toHaveLength(50);
    expect(await detail.readObservationGrounding(run.runId, run.evidenceId, '$.nodes[50].value'))
      .toMatchObject({ normalizedValue: 'E-050' });
    expect(await detail.readObservationGrounding(ids.next(), run.evidenceId, '$.nodes[50].value')).toBeNull();
    expect(await detail.readObservationGrounding(run.runId, run.evidenceId, '$.nodes[51].value')).toBeNull();
    // Two different recorded interpretations of a cell must not be picked arbitrarily.
    const duplicate = { name: 'other_key', originalValue: 'E-050', normalizedValue: 'E-050',
      grounding: { evidenceId: run.evidenceId, locator: '$.nodes[50].value', label: 'Employee ID', extractedText: 'E-050' }, corroboration: 'matched' };
    await sql`INSERT INTO run_observation(observation_id,run_id,work_item_id,schema_version,population_record_key,target_system,found,observed_at,
      step_execution_id,capture_method,match_origin,identity,attributes,evidence_ids,digest,coverage,observed_at_source,corroboration)
      VALUES(${ids.next()},${run.runId},${workItem},1,'E-duplicate','evidence-read-target','true',${clock.now().toISOString()},
      ${ids.next()},'agent','platform',${JSON.stringify(duplicate)}::jsonb,'[]'::jsonb,${JSON.stringify([run.evidenceId])}::jsonb,
      ${'e'.repeat(64)},'COVERED',${clock.now().toISOString()},'MATCHED')`;
    expect(await detail.readObservationGrounding(run.runId, run.evidenceId, '$.nodes[50].value')).toBeNull();
  });

  it('fails an active Run on verified tampering through the canonical completion and package path', async () => {
    const run = await seedRun();
    const repository = new PostgresEvidenceReadGrantRepository(db, { clock, ids });
    await repository.reportIntegrityMismatch({ runId: run.runId, evidenceId: run.evidenceId, finding: 'digest-mismatch',
      expectedDigest: run.digest, observedDigest: 'f'.repeat(64), expectedSize: run.size, observedSize: run.size });
    expect(await sql`SELECT state FROM audit_run WHERE run_id=${run.runId}`).toEqual([{ state: 'RUN_FAILED' }]);
    expect(await sql`SELECT outcome,sealed,run_state FROM run_result WHERE run_id=${run.runId}`)
      .toEqual([{ outcome: 'RUN_FAILED', sealed: true, run_state: 'RUN_FAILED' }]);
    expect(await sql`SELECT state,run_state FROM run_evidence_package WHERE run_id=${run.runId}`)
      .toEqual([{ state: 'SEALED', run_state: 'RUN_FAILED' }]);
    expect(await sql`SELECT evidence_id FROM run_evidence_integrity WHERE run_id=${run.runId}`).toEqual([]);
    expect(await sql`SELECT payload FROM audit_events WHERE aggregate_id=${run.runId} AND event_type='failure.evidence-integrity'`)
      .toMatchObject([{ payload: { stateChanged: true, finding: 'digest-mismatch' } }]);
  });

  it('expires an issued capability at its bounded deadline and removes the signed URL', async () => {
    const run = await seedRun();
    const { grantId, repository } = await issue(run);
    const issued = await repository.readForActor({ grantId, actorId: author, now: clock.now().toISOString() });
    expect(issued).not.toBeNull();
    const afterDeadline = new Date(Date.parse(issued!.signedUrlExpiresAt) + 1).toISOString();
    expect(await repository.readForActor({ grantId, actorId: author, now: afterDeadline })).toBeNull();
    expect(await sql`SELECT status,denial_code,signed_url FROM evidence_read_grant WHERE grant_id=${grantId}`).toEqual([
      { status: 'expired', denial_code: 'expired', signed_url: null },
    ]);
  });

  it('reports a tampered stored read through the sealed integrity path without changing the Run', async () => {
    const run = await seedRun({ terminal: true });
    const { grantId, repository } = await issue(run);
    const tampered = utf8Bytes('x'.repeat(run.size));
    const mismatches: unknown[] = [];
    const result = await readSnapshotCellWithGrant(
      repository,
      {
        grantId,
        runId: run.runId,
        evidenceId: run.evidenceId,
        actorId: author,
        locator: LOCATOR,
        correlationId: ids.next(),
        maxGrantWaitMs: 0,
      },
      {
        now: () => clock.now(),
        fetch: async () => new Response(tampered.buffer as ArrayBuffer, {
          status: 200,
          headers: { 'content-type': WEB_TREE_MEDIA_TYPE, 'content-length': String(tampered.byteLength) },
        }),
        reportIntegrityMismatch: async mismatch => {
          mismatches.push(mismatch);
          await repository.reportIntegrityMismatch(mismatch);
        },
      },
    );
    expect(result).toEqual({ cell: null, failure: 'download-digest-mismatch' });
    expect(mismatches).toEqual([{
      runId: run.runId,
      evidenceId: run.evidenceId,
      finding: 'digest-mismatch',
      expectedDigest: run.digest,
      observedDigest: sha256HexOfBytes(tampered),
      expectedSize: run.size,
      observedSize: run.size,
    }]);
    expect(await sql`SELECT state FROM audit_run WHERE run_id=${run.runId}`).toEqual([{ state: 'COMPLETED' }]);
    expect(await sql`SELECT finding,expected_digest,observed_digest,expected_size,observed_size FROM run_evidence_integrity WHERE run_id=${run.runId}`).toMatchObject([{
      finding: 'digest-mismatch', expected_digest: run.digest, observed_digest: sha256HexOfBytes(tampered), expected_size: run.size, observed_size: run.size,
    }]);
    expect(await sql`SELECT source,payload FROM audit_events WHERE aggregate_id=${run.runId} AND event_type='failure.evidence-integrity'`).toMatchObject([{
      source: 'web', payload: { evidenceId: run.evidenceId, finding: 'digest-mismatch', stateChanged: false },
    }]);
  });

  it('records a confirmed object-store 404 as an object-missing finding while leaving a transient failure unclassified', async () => {
    const run = await seedRun({ terminal: true });
    const { grantId, repository } = await issue(run);
    const mismatches: unknown[] = [];
    const result = await readSnapshotCellWithGrant(
      repository,
      {
        grantId,
        runId: run.runId,
        evidenceId: run.evidenceId,
        actorId: author,
        locator: LOCATOR,
        correlationId: ids.next(),
        maxGrantWaitMs: 0,
      },
      {
        now: () => clock.now(),
        fetch: async () => new Response(null, { status: 404 }),
        reportIntegrityMismatch: async mismatch => {
          mismatches.push(mismatch);
          await repository.reportIntegrityMismatch(mismatch);
        },
      },
    );
    expect(result).toEqual({ cell: null, failure: 'download-object-missing' });
    expect(mismatches).toEqual([{
      runId: run.runId,
      evidenceId: run.evidenceId,
      finding: 'object-missing',
      expectedDigest: run.digest,
      observedDigest: null,
      expectedSize: run.size,
      observedSize: null,
    }]);
    expect(await sql`SELECT state FROM audit_run WHERE run_id=${run.runId}`).toEqual([{ state: 'COMPLETED' }]);
    expect(await sql`SELECT finding,observed_digest,observed_size FROM run_evidence_integrity WHERE run_id=${run.runId}`).toEqual([
      { finding: 'object-missing', observed_digest: null, observed_size: null },
    ]);
  });

  it('rechecks the sealed path when a Run becomes terminal while an active integrity read waits on its lock', async () => {
    const run = await seedRun();
    const repository = new PostgresEvidenceReadGrantRepository(db, { clock, ids });
    const tampered = utf8Bytes('x'.repeat(run.size));
    const mismatch = {
      runId: run.runId,
      evidenceId: run.evidenceId,
      finding: 'digest-mismatch' as const,
      expectedDigest: run.digest,
      observedDigest: sha256HexOfBytes(tampered),
      expectedSize: run.size,
      observedSize: run.size,
    };
    let report: Promise<void> | undefined;
    await sql.begin(async transaction => {
      // Force the reporter's active transaction to wait after its initial, non-locking
      // state read. The same transaction then performs the truthful terminal transition.
      await transaction`SELECT run_id FROM audit_run WHERE run_id=${run.runId} FOR UPDATE`;
      const [holder] = await transaction`SELECT pg_backend_pid() AS pid`;
      report = repository.reportIntegrityMismatch(mismatch);
      // Prove the reporter reached its locked active path before committing the competing
      // terminal transition. An arbitrary delay could accidentally test only a terminal read.
      await expect.poll(async () => Number((await sql`SELECT count(*)::int AS total
        FROM pg_stat_activity WHERE ${Number(holder!.pid)} = ANY(pg_blocking_pids(pid))`)[0]!.total),
      { timeout: 5_000, interval: 20 }).toBeGreaterThan(0);
      const cancellation = {
        requestedBy: author,
        sessionId: `race-${run.runId}`,
        requestedAt: clock.now().toISOString(),
        reason: 'integrity race fixture',
      } as const;
      await transaction`UPDATE audit_run
        SET state='CANCELED', cancel_requested_at=${cancellation.requestedAt}::timestamptz,
            cancel_requested_by=${cancellation.requestedBy}, cancel_requested_session=${cancellation.sessionId},
            cancel_reason=${cancellation.reason}
        WHERE run_id=${run.runId}`;
      await transaction`INSERT INTO run_evidence_package(
        run_id,state,run_state,sealed_at,required_total,registered,missing_required,abandoned
      ) VALUES (${run.runId},'SEALED','CANCELED',${cancellation.requestedAt},0,1,'[]'::jsonb,'[]'::jsonb)`;
      await transaction`INSERT INTO run_result(
        run_id,version,outcome,outcome_row,sealed,run_state,gate_passed,sealed_at,scope,publication
      ) VALUES (${run.runId},1,'CANCELED','canceled',true,'CANCELED',false,${cancellation.requestedAt},NULL,'{}'::jsonb)`;
    });
    if (report === undefined) throw new Error('integrity race fixture did not start');
    await report;
    expect(await sql`SELECT state FROM audit_run WHERE run_id=${run.runId}`).toEqual([{ state: 'CANCELED' }]);
    expect(await sql`SELECT finding,observed_digest FROM run_evidence_integrity WHERE run_id=${run.runId}`).toMatchObject([{
      finding: 'digest-mismatch', observed_digest: mismatch.observedDigest,
    }]);
    expect(await sql`SELECT source,payload FROM audit_events WHERE aggregate_id=${run.runId} AND event_type='failure.evidence-integrity'`).toMatchObject([{
      source: 'web', payload: { evidenceId: run.evidenceId, stateChanged: false },
    }]);
  });
});
