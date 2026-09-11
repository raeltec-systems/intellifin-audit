import { randomUUID } from 'node:crypto';
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { executablePlanInputs } from '../fixtures/executable-plan.js';
import { activeRunVersion } from '../fixtures/active-run-version.js';
import {
  assertSchemaSupported,
  createDb,
  createSqlClient,
  CryptoUuidV7Generator,
  DrizzleProcedureRepository,
  SUPPORTED_SCHEMA_MAX,
  type Sql,
} from '@intellifin/infrastructure';
import { runMigrations } from '@intellifin/infrastructure/migrate';

const databaseUrl = process.env.DATABASE_URL;
const folder = fileURLToPath(new URL('../../packages/infrastructure/drizzle/', import.meta.url));

/** Keep nullable JSON columns SQL NULL, rather than the JSON scalar `null`. */
const jsonb = (value: unknown): string | null => value == null ? null : JSON.stringify(value) ?? null;

describe.skipIf(!databaseUrl)('generation47 guided-authoring upgrade', () => {
  it('preserves legacy nine-section drafts and approved reviews without inventing preparation', async () => {
    const url = new URL(databaseUrl!);
    if (!['localhost', '127.0.0.1', '[::1]', 'postgres', 'db'].includes(url.hostname) || !/(?:^|[_-])(?:test|ci)(?:[_-]|$)/i.test(url.pathname.slice(1))) {
      throw new Error('Upgrade requires a disposable test database');
    }

    const admin = createSqlClient(databaseUrl!, { max: 1 });
    const name = 'intellifin_test_guided_up_' + randomUUID().replaceAll('-', '');
    const temporary = await mkdtemp(join(tmpdir(), 'intellifin-guided-upgrade-'));
    let sql: Sql | null = null;
    let created = false;

    try {
      await admin.unsafe(`CREATE DATABASE "${name}"`);
      created = true;
      url.pathname = '/' + name;
      const isolatedUrl = url.toString();
      const journal = JSON.parse(await readFile(join(folder, 'meta/_journal.json'), 'utf8')) as {
        entries: { idx: number; tag: string }[];
      };
      const preceding = join(temporary, 'generation47');
      await mkdir(join(preceding, 'meta'), { recursive: true });
      const entries = journal.entries.filter(entry => entry.idx <= 47);
      await writeFile(join(preceding, 'meta/_journal.json'), JSON.stringify({ ...journal, entries }));
      for (const entry of entries) {
        await copyFile(join(folder, entry.tag + '.sql'), join(preceding, entry.tag + '.sql'));
      }

      expect(await runMigrations(isolatedUrl, { migrationsFolder: preceding })).toBe(47);
      sql = createSqlClient(isolatedUrl, { max: 1 });

      // Current Templates have eleven sections. A generation-47 row really held the
      // original nine, and the review below is generated from those same frozen inputs.
      const currentInputs = executablePlanInputs();
      const legacyInputs = { ...currentInputs, sections: currentInputs.sections.slice(0, 9) };
      const ids = new CryptoUuidV7Generator();
      const draftProcedureId = ids.next();
      const approvedProcedureId = ids.next();
      const draftVersion = {
        ...activeRunVersion(draftProcedureId, ids.next(), ids.next(), legacyInputs),
        state: 'DRAFT' as const,
        authorship: null,
        lifecycle: null,
        decisions: [],
        submittedReview: null,
        frozenReview: null,
      };
      const approvedVersion = {
        ...activeRunVersion(approvedProcedureId, ids.next(), ids.next(), legacyInputs),
        state: 'APPROVED' as const,
        authorship: null,
        lifecycle: null,
      };

      type HistoricalVersion = ReturnType<typeof activeRunVersion>;
      const insertVersion = async (row: HistoricalVersion): Promise<void> => {
        await sql!`INSERT INTO procedure_version(
          version_id, procedure_id, version_number, state, control_name, template_id, sections,
          period, scope, source_snapshot, inclusion_rule, zero_record_pass, allow_versioned_duplicates,
          population_blockers, targets, instructions, compliance_schema_version, compliance_compiler_version,
          compliance_conditions, agent_judged_threshold, evidence_schema_version, evidence_requirements,
          schedule, plan_compiler_version, derivation_model, compiled_plan, plan_input_digest, plan_status,
          plan_failure_reason, plan_derivable, plan_attempts, authorship, decisions, frozen_review,
          submitted_review, lifecycle, platform_origin, configuration_revision
        ) VALUES(
          ${row.versionId}, ${row.procedureId}, ${row.versionNumber}, ${row.state}, ${row.controlName}, ${row.templateId},
          ${jsonb(row.sections)}::jsonb, ${jsonb(row.period)}::jsonb, ${row.scope}, ${jsonb(row.sourceSnapshot)}::jsonb,
          ${jsonb(row.inclusionRule)}::jsonb, ${row.zeroRecordPass}, ${row.allowVersionedDuplicates},
          ${jsonb(row.populationBlockers)}::jsonb, ${jsonb(row.targets)}::jsonb, ${jsonb(row.instructions)}::jsonb,
          ${row.complianceSchemaVersion}, ${row.complianceCompilerVersion}, ${jsonb(row.complianceConditions)}::jsonb,
          ${row.agentJudgedThreshold}, ${row.evidenceSchemaVersion}, ${jsonb(row.evidenceRequirements)}::jsonb,
          ${jsonb(row.schedule)}::jsonb, ${row.planCompilerVersion}, ${jsonb(row.derivationModel)}::jsonb,
          ${jsonb(row.compiledPlan)}::jsonb, ${row.planInputDigest}, ${row.planStatus}, ${row.planFailureReason ?? null},
          ${row.planDerivable}, ${jsonb(row.planAttempts)}::jsonb, ${jsonb(row.authorship)}::jsonb,
          ${jsonb(row.decisions)}::jsonb, ${jsonb(row.frozenReview)}::jsonb, ${jsonb(row.submittedReview)}::jsonb,
          ${jsonb(row.lifecycle)}::jsonb, ${jsonb(row.platformOrigin)}::jsonb, ${row.configurationRevision ?? null}
        )`;
      };

      await sql`INSERT INTO procedure(procedure_id, control_name, template_id)
        VALUES(${draftProcedureId}, ${draftVersion.controlName}, ${draftVersion.templateId}),
              (${approvedProcedureId}, ${approvedVersion.controlName}, ${approvedVersion.templateId})`;
      await insertVersion(draftVersion);
      await insertVersion(approvedVersion);

      const payloadBefore = await sql`
        SELECT version_id, sections, submitted_review, frozen_review, authorship
        FROM procedure_version
        ORDER BY version_id
      `;
      expect(payloadBefore).toEqual(expect.arrayContaining([
        expect.objectContaining({ version_id: draftVersion.versionId, sections: legacyInputs.sections, submitted_review: null, frozen_review: null, authorship: null }),
        expect.objectContaining({ version_id: approvedVersion.versionId, sections: legacyInputs.sections, submitted_review: approvedVersion.submittedReview, frozen_review: approvedVersion.frozenReview, authorship: null }),
      ]));

      // Generation 48 is additive metadata. It has no historical review to infer, so
      // every row must receive SQL NULL and the application must read it as no preparation.
      const preparationBefore = await sql`SELECT version_id, section_preparation FROM procedure_version ORDER BY version_id`;
      expect(preparationBefore).toHaveLength(2);
      expect(preparationBefore).toEqual(expect.arrayContaining([
        { version_id: draftVersion.versionId, section_preparation: null },
        { version_id: approvedVersion.versionId, section_preparation: null },
      ]));

      // The approved row carries a real submitted/frozen review and the existing database
      // trigger must continue to reject a definition rewrite after the upgrade.
      await expect(sql`UPDATE procedure_version SET sections = '[]'::jsonb WHERE version_id = ${approvedVersion.versionId}`)
        .rejects.toThrow(/immutable/i);

      // The final migration is deliberately read from the build's support declaration:
      // a later migration (for example generation 49) must not make this test stale.
      expect(await runMigrations(isolatedUrl)).toBe(SUPPORTED_SCHEMA_MAX);
      expect(await assertSchemaSupported(sql)).toBe(SUPPORTED_SCHEMA_MAX);

      const payloadAfter = await sql`
        SELECT version_id, sections, submitted_review, frozen_review, authorship
        FROM procedure_version
        ORDER BY version_id
      `;
      expect(payloadAfter).toEqual(payloadBefore);
      const preparationAfter = await sql`SELECT version_id, section_preparation FROM procedure_version ORDER BY version_id`;
      expect(preparationAfter).toHaveLength(2);
      expect(preparationAfter).toEqual(expect.arrayContaining([
        { version_id: draftVersion.versionId, section_preparation: null },
        { version_id: approvedVersion.versionId, section_preparation: null },
      ]));

      const repository = new DrizzleProcedureRepository(createDb(sql));
      const draft = await repository.findVersion(draftVersion.versionId);
      const approved = await repository.findVersion(approvedVersion.versionId);
      expect(draft).not.toBeNull();
      expect(draft).toMatchObject({ state: 'DRAFT', sections: legacyInputs.sections, sectionPreparation: null, authorship: null });
      expect(approved).not.toBeNull();
      expect(approved).toMatchObject({ state: 'APPROVED', sections: legacyInputs.sections, sectionPreparation: null, authorship: null });
      expect(approved!.submittedReview).toEqual(approvedVersion.submittedReview);
      expect(approved!.frozenReview).toEqual(approvedVersion.frozenReview);
    } finally {
      if (sql) await sql.end({ timeout: 5 });
      if (created) await admin.unsafe(`DROP DATABASE "${name}" WITH (FORCE)`);
      await admin.end({ timeout: 5 });
      await rm(temporary, { recursive: true, force: true });
    }
  }, 120_000);
});
