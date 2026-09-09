import { createHash, randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, readFile, writeFile, copyFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { createDb, createSqlClient, CryptoUuidV7Generator, PostgresProceduresUnitOfWork, type Sql } from '@intellifin/infrastructure';
import { runMigrations } from '@intellifin/infrastructure/migrate';
import { activeRunVersion } from '../fixtures/active-run-version.js';

const databaseUrl = process.env.DATABASE_URL;
const folder = fileURLToPath(new URL('../../packages/infrastructure/drizzle/', import.meta.url));
const migrationName = '0032_petite_doctor_octopus.sql';

describe.skipIf(!databaseUrl)('real populated-schema evidence upgrade', () => {
  it('upgrades sealed Runs, preserves their facts and restores guards on both success and rollback', async () => {
    const url = new URL(databaseUrl!);
    if (!['localhost', '127.0.0.1', '[::1]', 'postgres', 'db'].includes(url.hostname) || !/(?:^|[_-])(?:test|ci)(?:[_-]|$)/i.test(url.pathname.slice(1))) {
      throw new Error('Upgrade tests require a local throwaway test database');
    }
    const admin = createSqlClient(databaseUrl!, { max: 1 });
    const name = 'intellifin_test_upgrade_' + randomUUID().replaceAll('-', '');
    const temporary = await mkdtemp(join(tmpdir(), 'intellifin-upgrade-'));
    let sql: Sql | null = null;
    let created = false;
    try {
      await admin.unsafe(`CREATE DATABASE "${name}"`);
      created = true;
      url.pathname = '/' + name;
      const historicalUrl = url.toString();
      const journal = JSON.parse(await readFile(join(folder, 'meta/_journal.json'), 'utf8')) as { entries: { idx: number; tag: string }[] };
      const prefix = async (label: string, generation: number, transform?: (text: string) => string): Promise<string> => {
        const destination = join(temporary, label);
        await mkdir(join(destination, 'meta'), { recursive: true });
        const entries = journal.entries.filter(entry => entry.idx <= generation);
        await writeFile(join(destination, 'meta/_journal.json'), JSON.stringify({ ...journal, entries }));
        for (const entry of entries) {
          const filename = entry.tag + '.sql';
          if (filename === migrationName && transform) await writeFile(join(destination, filename), transform(await readFile(join(folder, filename), 'utf8')));
          else await copyFile(join(folder, filename), join(destination, filename));
        }
        return destination;
      };
      expect(await runMigrations(historicalUrl, { migrationsFolder: await prefix('before', 31) })).toBe(31);
      sql = createSqlClient(historicalUrl, { max: 1 });
      const db = createDb(sql);
      // The historical rows name real synthetic artifacts, with their real byte digests.
      // The migrator owns metadata only; it must not replace the evidence these rows name.
      const populationBytes = Buffer.from('employee_id,full_name\nE-SYNTH-1,Synthetic Leaver\n');
      const envelopeBytes = Buffer.from('{"synthetic":true,"source":"historical-workbook"}');
      const referenceBytes = Buffer.from('{"roles":[{"role":"reader","allowed":true}]}');
      const populationKey = join(temporary, 'population.csv');
      const envelopeKey = join(temporary, 'population-envelope.json');
      const referenceKey = join(temporary, 'reference.json');
      await writeFile(populationKey, populationBytes);
      await writeFile(envelopeKey, envelopeBytes);
      await writeFile(referenceKey, referenceBytes);
      const digest = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
      const assertOriginalBytes = async () => {
        expect(await readFile(populationKey)).toEqual(populationBytes);
        expect(await readFile(envelopeKey)).toEqual(envelopeBytes);
        expect(await readFile(referenceKey)).toEqual(referenceBytes);
      };
      const ids = new CryptoUuidV7Generator();
      const author = ids.next(), runId = ids.next(), referenceId = ids.next(), populationId = ids.next();
      const version = activeRunVersion(ids.next(), ids.next(), author);
      await sql`INSERT INTO auth_user(id,name,email) VALUES(${author},'Synthetic upgrade reviewer',${author + '@test.invalid'})`;
      await new PostgresProceduresUnitOfWork(db).execute(async context => {
        await context.procedures.insertProcedure(version);
        await context.procedures.insertVersion(version);
      });
      await sql.begin(async tx => {
        await tx`INSERT INTO audit_run(run_id,request_token,correlation_id,procedure_id,version_id,version_number,procedure_name,period_from,period_to,state,kind,initiator_id,session_id,authorization_role,initiated_at)
          VALUES(${runId},${ids.next()},${ids.next()},${version.procedureId},${version.versionId},1,'Synthetic historical Run','2026-08-01','2026-08-31','COMPLETED','STANDARD',${author},'synthetic-session','auditor','2026-09-01T09:00:00Z')`;
        await tx`INSERT INTO population_evidence(run_id,evidence_id,object_key,envelope_key,raw_digest,envelope_digest,size,state,required)
          VALUES(${runId},${populationId},${populationKey},${envelopeKey},${digest(populationBytes)},${digest(envelopeBytes)},${populationBytes.length},'REGISTERED',true)`;
        await tx`INSERT INTO run_evidence(evidence_id,run_id,kind,registration_id,object_key,digest,size,state,required)
          VALUES(${referenceId},${runId},'reference-source','synthetic-reference',${referenceKey},${digest(referenceBytes)},${referenceBytes.length},'REGISTERED',true)`;
        await tx`INSERT INTO run_session_step(run_id,step_id,ordinal,registration_id,display_name,action,state,attempts,evidence_id)
          VALUES(${runId},'reference-step',1,'synthetic-reference','Reference','extract-adapter','ACQUIRED',1,${referenceId})`;
        await tx`INSERT INTO run_step_execution(step_execution_id,run_id,plan_step_id,action,state,attempt,started_at,completed_at)
          VALUES(${ids.next()},${runId},'reference-step','extract-adapter','SUCCEEDED',1,'2026-09-01T09:00:00Z','2026-09-01T09:01:20Z')`;
        await tx`INSERT INTO population_snapshot(run_id,included,excluded,indeterminate,checks) VALUES(${runId},1,0,0,'[]'::jsonb)`;
        await tx`INSERT INTO run_evidence_package(run_id,state,run_state,sealed_at,required_total,registered,missing_required,abandoned)
          VALUES(${runId},'SEALED','COMPLETED','2026-09-01T09:02:00Z',2,2,'[]'::jsonb,'[]'::jsonb)`;
        await tx`INSERT INTO run_result(run_id,version,outcome,outcome_row,sealed,run_state,gate_passed,sealed_at,scope,publication)
          VALUES(${runId},1,'PASS','pass',true,'COMPLETED',true,'2026-09-01T09:02:00Z',NULL,'{}'::jsonb)`;
      });
      const beforeEvidence = await sql`SELECT to_jsonb(e) AS value FROM run_evidence e WHERE run_id=${runId}`;
      const beforePopulation = await sql`SELECT to_jsonb(e) AS value FROM population_evidence e WHERE run_id=${runId}`;
      const beforeResult = await sql`SELECT to_jsonb(r) AS value FROM run_result r WHERE run_id=${runId}`;
      const beforeSeal = await sql`SELECT to_jsonb(p) AS value FROM run_evidence_package p WHERE run_id=${runId}`;
      const assertProtected = async () => {
        const guards = await sql!`SELECT tgenabled FROM pg_trigger WHERE tgname IN ('run_evidence_frozen_after_seal','population_evidence_frozen_after_seal') ORDER BY tgname`;
        expect(guards.map(row => row.tgenabled)).toEqual(['O', 'O']);
        await expect(sql!`UPDATE run_evidence SET size=size WHERE run_id=${runId}`).rejects.toThrow(/is frozen/);
      };
      await assertProtected();
      // Mutation: the old unguarded backfill must fail against REAL sealed records.
      const withoutGuards = await prefix('mutation', 32, text => text.replace(/^ALTER TABLE .* (?:DISABLE|ENABLE) TRIGGER .*;--> statement-breakpoint\n/gm, ''));
      // Drizzle wraps the PostgreSQL exception. Assert the server's cause and SQLSTATE,
      // not the wrapper's query text: a syntax or connection failure is not guard proof.
      await expect(runMigrations(historicalUrl, { migrationsFolder: withoutGuards })).rejects.toMatchObject({
        cause: expect.objectContaining({ code: '23514', message: expect.stringMatching(/is frozen/) }),
      });
      await assertProtected();
      expect((await sql`SELECT max(version) AS version FROM schema_meta`)[0]?.version).toBe(31);
      // Failure after disabling a trigger must roll back the DDL as well as the data.
      const broken = await prefix('rollback', 32, text => text.replace('ALTER TABLE "population_evidence" DISABLE TRIGGER "population_evidence_frozen_after_seal";', 'ALTER TABLE "population_evidence" DISABLE TRIGGER "population_evidence_frozen_after_seal";--> statement-breakpoint\nSELECT 1/0;'));
      await expect(runMigrations(historicalUrl, { migrationsFolder: broken })).rejects.toMatchObject({
        cause: expect.objectContaining({ code: '22012', message: expect.stringMatching(/division by zero/) }),
      });
      await assertProtected();
      expect(await runMigrations(historicalUrl)).toBeGreaterThanOrEqual(32);
      await assertProtected();
      await assertOriginalBytes();
      // `role` joins the generation-32 columns this comparison already subtracts: the
      // upgrade adds keys, and every key that existed before must be unchanged.
      expect(await sql`SELECT to_jsonb(e)-'captured_at'-'capture_method'-'capture_time_source'-'role' AS value FROM run_evidence e WHERE run_id=${runId}`).toEqual(beforeEvidence);
      // Generation 43's backfill is structural: every historical row was Evidence.
      expect(await sql`SELECT DISTINCT role FROM run_evidence WHERE run_id=${runId}`).toEqual([{ role: 'evidence' }]);
      expect(await sql`SELECT to_jsonb(e)-'captured_at'-'capture_method'-'capture_time_source' AS value FROM population_evidence e WHERE run_id=${runId}`).toEqual(beforePopulation);
      expect(await sql`SELECT to_jsonb(r) AS value FROM run_result r WHERE run_id=${runId}`).toEqual(beforeResult);
      expect(await sql`SELECT to_jsonb(p) AS value FROM run_evidence_package p WHERE run_id=${runId}`).toEqual(beforeSeal);
      const provenance = (await sql`SELECT captured_at,capture_time_source FROM run_evidence WHERE run_id=${runId}`)[0]!;
      expect(new Date(provenance.captured_at).toISOString()).toBe('2026-09-01T09:01:20.000Z');
      expect(provenance.capture_time_source).toBe('step-execution');
      expect((await sql`SELECT captured_at FROM population_evidence WHERE run_id=${runId}`)[0]?.captured_at).toBeNull();
      expect((await sql`SELECT declared_count,retrieved_count FROM population_snapshot WHERE run_id=${runId}`)[0]).toMatchObject({ declared_count: null, retrieved_count: 1 });
      await expect(sql`DELETE FROM population_evidence WHERE run_id=${runId}`).rejects.toThrow(/is frozen/);
      await expect(sql`UPDATE run_result SET outcome='CONTROL_FAILURE' WHERE run_id=${runId}`).rejects.toThrow(/immutable/);
      const afterEvidence = await sql`SELECT to_jsonb(e) AS value FROM run_evidence e WHERE run_id=${runId}`;
      const afterPopulation = await sql`SELECT to_jsonb(e) AS value FROM population_evidence e WHERE run_id=${runId}`;
      const afterSnapshot = await sql`SELECT to_jsonb(s) AS value FROM population_snapshot s WHERE run_id=${runId}`;
      expect(await runMigrations(historicalUrl)).toBeGreaterThanOrEqual(32);
      expect(await sql`SELECT to_jsonb(e) AS value FROM run_evidence e WHERE run_id=${runId}`).toEqual(afterEvidence);
      expect(await sql`SELECT to_jsonb(e) AS value FROM population_evidence e WHERE run_id=${runId}`).toEqual(afterPopulation);
      expect(await sql`SELECT to_jsonb(s) AS value FROM population_snapshot s WHERE run_id=${runId}`).toEqual(afterSnapshot);
      expect(await sql`SELECT to_jsonb(r) AS value FROM run_result r WHERE run_id=${runId}`).toEqual(beforeResult);
      expect(await sql`SELECT to_jsonb(p) AS value FROM run_evidence_package p WHERE run_id=${runId}`).toEqual(beforeSeal);
      await assertProtected();
      await assertOriginalBytes();
    } finally {
      if (sql) await sql.end({ timeout: 5 });
      if (created) await admin.unsafe(`DROP DATABASE "${name}" WITH (FORCE)`);
      await admin.end({ timeout: 5 });
      await rm(temporary, { recursive: true, force: true });
    }
  }, 120000);
});
