import { randomUUID } from 'node:crypto';
import { mkdtemp, mkdir, readFile, writeFile, copyFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { observationAbsenceDigest } from '@intellifin/application';
import { observationDigest, observationIdFor, sha256HexOfBytes, utf8Bytes, type ObservationRecord } from '@intellifin/domain';
import { createSqlClient, CryptoUuidV7Generator, type Sql } from '@intellifin/infrastructure';
import { runMigrations } from '@intellifin/infrastructure/migrate';
import { activeRunVersion } from '../fixtures/active-run-version.js';
import { insertHistoricalProcedureVersion } from '../fixtures/historical-procedure-version.js';

const databaseUrl = process.env.DATABASE_URL;
const folder = fileURLToPath(new URL('../../packages/infrastructure/drizzle/', import.meta.url));

describe.skipIf(!databaseUrl)('generation40 to final absence guard upgrade', () => {
  it('reproduces the real FOUND collision, upgrades populated40 and preserves historical facts and protection', async () => {
    const url = new URL(databaseUrl!);
    if (!['localhost','127.0.0.1','[::1]','postgres','db'].includes(url.hostname) || !/(?:^|[_-])(?:test|ci)(?:[_-]|$)/i.test(url.pathname.slice(1))) throw new Error('Upgrade requires a disposable test database');
    const admin = createSqlClient(databaseUrl!, { max: 1 });
    const name = 'intellifin_test_abs_up_' + randomUUID().replaceAll('-','');
    const temporary = await mkdtemp(join(tmpdir(),'intellifin-absence-upgrade-'));
    let sql: Sql | null = null;
    let created = false;
    try {
      await admin.unsafe(`CREATE DATABASE "${name}"`); created = true;
      url.pathname = '/' + name;
      const isolatedUrl = url.toString();
      const journal = JSON.parse(await readFile(join(folder,'meta/_journal.json'),'utf8')) as { entries: { idx: number; tag: string }[] };
      const preceding = join(temporary,'preceding');
      await mkdir(join(preceding,'meta'),{ recursive: true });
      const entries = journal.entries.filter(entry => entry.idx <= 40);
      await writeFile(join(preceding,'meta/_journal.json'),JSON.stringify({ ...journal, entries }));
      for (const entry of entries) await copyFile(join(folder,entry.tag+'.sql'),join(preceding,entry.tag+'.sql'));
      expect(await runMigrations(isolatedUrl,{ migrationsFolder: preceding })).toBe(40);
      sql = createSqlClient(isolatedUrl,{ max: 1 });
      const connection = sql;
      const ids = new CryptoUuidV7Generator();
      const author = ids.next();
      await sql`INSERT INTO auth_user(id,name,email) VALUES(${author},'Synthetic absence upgrade reviewer',${author+'@test.invalid'})`;
      const version = activeRunVersion(ids.next(),ids.next(),author);
      await insertHistoricalProcedureVersion(sql, version);
      let ordinal = 0;
      const bytes = utf8Bytes('{"schemaVersion":1,"nodes":[],"completion":{"complete":true,"returned":0}}');
      const artifact = join(temporary,'empty-result.json');
      await writeFile(artifact,bytes);
      // The helper seeds BOTH schemas: the historical one before the upgrade and the
      // current one after it. Generation 43 added `run_evidence.role` NOT NULL, so the
      // insert has to name the columns the live schema actually has. Reading it from the
      // catalogue keeps one helper honest on both sides rather than duplicating it.
      const seed = async (sealed: boolean) => {
        const hasRole = (await connection`SELECT 1 FROM information_schema.columns
          WHERE table_name='run_evidence' AND column_name='role'`).length === 1;
        const runId=ids.next(), evidenceId=ids.next(), workItemId=ids.next(), stepExecutionId=ids.next();
        const day=String(++ordinal).padStart(2,'0');
        const at='2026-09-01T09:00:00.000Z';
        const record: ObservationRecord={ schemaVersion:1,observationId:observationIdFor(workItemId,'E-upgrade'),workItemId,populationRecordKey:'E-upgrade',targetSystem:'loancore',found:'false',observedAt:at,stepExecutionId,captureMethod:'agent',matchOrigin:'platform',identity:null,attributes:[],evidenceIds:[evidenceId] };
        await connection.begin(async tx => {
          await tx`INSERT INTO audit_run(request_token,run_id,correlation_id,procedure_id,version_id,version_number,procedure_name,period_from,period_to,state,kind,initiator_id,session_id,authorization_role,initiated_at)
            VALUES(${ids.next()},${runId},${ids.next()},${version.procedureId},${version.versionId},1,'Historical absence',${`2026-08-${day}`},${`2026-08-${day}`},'RUNNING','STANDARD',${author},'upgrade','auditor',${at})`;
          if (hasRole) {
            await tx`INSERT INTO run_evidence(evidence_id,run_id,kind,registration_id,object_key,media_type,digest,size,state,required,role)
              VALUES(${evidenceId},${runId},'structural-snapshot','loancore',${`historical/${runId}/empty`},'application/vnd.intellifin.web-tree+json',${sha256HexOfBytes(bytes)},${bytes.byteLength},'REGISTERED',false,'evidence')`;
          } else {
            await tx`INSERT INTO run_evidence(evidence_id,run_id,kind,registration_id,object_key,media_type,digest,size,state,required)
              VALUES(${evidenceId},${runId},'structural-snapshot','loancore',${`historical/${runId}/empty`},'application/vnd.intellifin.web-tree+json',${sha256HexOfBytes(bytes)},${bytes.byteLength},'REGISTERED',false)`;
          }
          await tx`INSERT INTO run_work_item(work_item_id,run_id,step_id,ordinal,registration_id,display_name,state,attempts,cycles,diagnostic,evidence_id,observations)
            VALUES(${workItemId},${runId},'inspect',1,'loancore','LoanCore','OBSERVED',1,0,NULL,${evidenceId},1)`;
          await tx`INSERT INTO run_observation(observation_id,run_id,work_item_id,schema_version,population_record_key,target_system,found,observed_at,step_execution_id,capture_method,match_origin,identity,attributes,evidence_ids,digest,coverage,observed_at_source,corroboration)
            VALUES(${record.observationId},${runId},${workItemId},1,'E-upgrade','loancore','false',${at},${stepExecutionId},'agent','platform',NULL,'[]'::jsonb,${tx.json([evidenceId])},${observationDigest(record)},'UNINSPECTED',${at},'UNJUDGED')`;
          if (sealed) {
            await tx`INSERT INTO run_evidence_package(run_id,state,run_state,sealed_at,required_total,registered,missing_required,abandoned)
              VALUES(${runId},'SEALED','INCONCLUSIVE',${at},0,1,'[]'::jsonb,'[]'::jsonb)`;
            await tx`INSERT INTO run_result(run_id,version,outcome,outcome_row,sealed,run_state,gate_passed,sealed_at,scope,publication)
              VALUES(${runId},1,'INCONCLUSIVE','gate-failed',true,'INCONCLUSIVE',false,${at},NULL,'{}'::jsonb)`;
            await tx`UPDATE audit_run SET state='INCONCLUSIVE' WHERE run_id=${runId}`;
          }
        });
        const queryKeys=[{key:'employee_id',value:'E-upgrade'},{key:'full_name',value:'Synthetic Leaver'}];
        const proof={queryKeys,emptyResultEvidenceId:evidenceId,extractionComplete:true};
        return { runId,record,proof,queryKeys,digest:observationAbsenceDigest(record.observationId,proof,queryKeys) };
      };
      const insertProof = async (row: Awaited<ReturnType<typeof seed>>) => {
        await connection`INSERT INTO run_observation_absence(observation_id,run_id,proof,expected_query_keys,digest)
          VALUES(${row.record.observationId},${row.runId},${connection.json(row.proof)},${connection.json(row.queryKeys)},${row.digest})`;
      };
      const active=await seed(false), sealed=await seed(true);
      // Actual preceding schema and real guard: SQLSTATE42702 is the PL/pgSQL FOUND/column
      // ambiguity, not a fixture assertion, network failure or isolated temporary table.
      await expect(insertProof(active)).rejects.toMatchObject({code:'42702',message:expect.stringMatching(/found.*ambiguous/i)});
      const original=await sql`SELECT to_jsonb(o) AS value FROM run_observation o ORDER BY observation_id`;
      const originalEvidence=await sql`SELECT to_jsonb(e) AS value FROM run_evidence e ORDER BY evidence_id`;
      const originalResults=await sql`SELECT to_jsonb(r) AS value FROM run_result r ORDER BY run_id`;
      const originalSeals=await sql`SELECT to_jsonb(p) AS value FROM run_evidence_package p ORDER BY run_id`;
      expect(await runMigrations(isolatedUrl)).toBeGreaterThanOrEqual(41);
      expect(await sql`SELECT to_jsonb(o) AS value FROM run_observation o ORDER BY observation_id`).toEqual(original);
      // Generation 43 adds `role`, so the upgraded rows carry one MORE key than the
      // historical ones. Every key that existed before is compared unchanged, and the new
      // one is asserted separately: adding a column is not changing a fact, and a
      // comparison that quietly tolerated a changed VALUE would stop proving preservation.
      const upgradedEvidence=await sql`SELECT to_jsonb(e) AS value FROM run_evidence e ORDER BY evidence_id`;
      expect(upgradedEvidence.map(row=>{const {role,...rest}=row['value'] as Record<string,unknown>; void role; return {value:rest};}))
        .toEqual(originalEvidence.map(row=>({value:row['value']})));
      // The backfill is STRUCTURAL, not a guess: every row this table has ever held was
      // written by a producer freezing bytes a Run concluded from.
      expect(upgradedEvidence.map(row=>(row['value'] as Record<string,unknown>)['role']))
        .toEqual(upgradedEvidence.map(()=>'evidence'));
      expect(await sql`SELECT to_jsonb(r) AS value FROM run_result r ORDER BY run_id`).toEqual(originalResults);
      expect(await sql`SELECT to_jsonb(p) AS value FROM run_evidence_package p ORDER BY run_id`).toEqual(originalSeals);
      expect(await sql`SELECT * FROM run_observation_absence`).toEqual([]);
      expect(new Uint8Array(await readFile(artifact))).toEqual(bytes);
      await expect(insertProof(sealed)).rejects.toMatchObject({code:'23514',message:expect.stringMatching(/sealed Run/)});
      const fresh=await seed(false);
      await insertProof(fresh);
      expect(await sql`SELECT proof,digest FROM run_observation_absence WHERE observation_id=${fresh.record.observationId}`).toEqual([{proof:fresh.proof,digest:fresh.digest}]);
      await expect(sql`UPDATE run_observation_absence SET proof=NULL WHERE observation_id=${fresh.record.observationId}`).rejects.toMatchObject({code:'23514'});
      await expect(sql`DELETE FROM run_observation_absence WHERE observation_id=${fresh.record.observationId}`).rejects.toMatchObject({code:'23514'});
      await expect(sql`UPDATE run_evidence SET size=size WHERE run_id=${sealed.runId}`).rejects.toMatchObject({code:'23514'});
      const beforeRepeat=await sql`SELECT to_jsonb(a) AS value FROM run_observation_absence a`;
      expect(await runMigrations(isolatedUrl)).toBeGreaterThanOrEqual(41);
      expect(await sql`SELECT to_jsonb(a) AS value FROM run_observation_absence a`).toEqual(beforeRepeat);
      expect(await sql`SELECT to_jsonb(r) AS value FROM run_result r ORDER BY run_id`).toEqual(originalResults);
      expect(await sql`SELECT to_jsonb(p) AS value FROM run_evidence_package p ORDER BY run_id`).toEqual(originalSeals);
      expect(new Uint8Array(await readFile(artifact))).toEqual(bytes);
    } finally {
      if (sql) await sql.end({timeout:5});
      // Only the uniquely named database this test successfully created is disposable.
      if (created) await admin.unsafe(`DROP DATABASE "${name}" WITH (FORCE)`);
      await admin.end({timeout:5});
      await rm(temporary,{recursive:true,force:true});
    }
  },120_000);
});
