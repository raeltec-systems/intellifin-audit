import { eq, inArray, sql } from 'drizzle-orm';
import type {
  EvidenceIntegrityRecord,
  EvidencePackageContext,
  PackageSeal,
  RegisteredArtifact,
  SealedPackageContext,
  SealedPackageRepository,
} from '@intellifin/application';
import type { PackageArtifact } from '@intellifin/domain';
import type { Database, Transaction } from '../db/client.js';
import {
  auditRun,
  populationEvidence,
  runEvidence,
  runEvidenceIntegrity,
  runEvidencePackage,
} from '../db/schema.js';
import { DrizzleRunRepository } from './run-repository.js';
import { createAuditEventWriter, CryptoUuidV7Generator, SystemClock } from '../db/audit-events.js';
import { isUuidText } from '../db/identifier.js';

/**
 * The Evidence package, as both execution stages and the post-Run verification read it.
 *
 * One place knows that a Run's artifacts live in two tables. `population_evidence` holds
 * ONE reservation covering the raw source bytes and the acquisition envelope — they are
 * fetched, verified and registered together and neither means anything without the other —
 * and `run_evidence` holds one row per Reference Source and per adapter extraction. The
 * seal reads the union and does not care which table a row came from.
 */

/** The primary object key of the population reservation, which addresses two objects. */
const POPULATION_ARTIFACT = 'population' as const;

export function evidencePackageContext(
  tx: Database | Transaction,
  runId: string,
): Omit<EvidencePackageContext, 'auditEvents' | 'notifyTimeline'> {
  return {
    async readPackageArtifacts(): Promise<readonly PackageArtifact[]> {
      const adapter = await tx
        .select({
          evidenceId: runEvidence.evidenceId,
          kind: runEvidence.kind,
          objectKey: runEvidence.objectKey,
          required: runEvidence.required,
          state: runEvidence.state,
        })
        .from(runEvidence)
        .where(eq(runEvidence.runId, runId));
      const population = await tx
        .select({
          evidenceId: populationEvidence.evidenceId,
          objectKey: populationEvidence.objectKey,
          required: populationEvidence.required,
          state: populationEvidence.state,
        })
        .from(populationEvidence)
        .where(eq(populationEvidence.runId, runId));
      return [
        ...population.map(
          (row): PackageArtifact => ({
            evidenceId: row.evidenceId,
            kind: POPULATION_ARTIFACT,
            objectKey: row.objectKey,
            required: row.required,
            state: row.state as PackageArtifact['state'],
          }),
        ),
        ...adapter.map(
          (row): PackageArtifact => ({
            evidenceId: row.evidenceId,
            kind: row.kind as PackageArtifact['kind'],
            objectKey: row.objectKey,
            required: row.required,
            state: row.state as PackageArtifact['state'],
          }),
        ),
      ];
    },

    /**
     * Flip exactly these reservations to `ABANDONED`, and only while they are `RESERVED`.
     *
     * The `state = 'RESERVED'` predicate is the guard that makes this method unable to do
     * the one thing sealing must never do: a registered artifact is preserved forever, and
     * an UPDATE that could reach one would be a way to lose Evidence by passing the wrong
     * id. The digest and size are cleared with it, so an abandoned row cannot claim both
     * that its bytes were verified and that they never arrived.
     */
    async abandonArtifacts(evidenceIds: readonly string[]): Promise<void> {
      const ids = evidenceIds.filter((id) => isUuidText(id));
      if (ids.length === 0) return;
      await tx
        .update(runEvidence)
        .set({ state: 'ABANDONED', digest: null, size: null })
        .where(
          sql`${inArray(runEvidence.evidenceId, ids)} AND ${runEvidence.runId}=${runId} AND ${runEvidence.state}='RESERVED'`,
        );
      await tx
        .update(populationEvidence)
        .set({ state: 'ABANDONED', rawDigest: null, size: null })
        .where(
          sql`${inArray(populationEvidence.evidenceId, ids)} AND ${populationEvidence.runId}=${runId} AND ${populationEvidence.state}='RESERVED'`,
        );
    },

    async readSeal(): Promise<PackageSeal | null> {
      const row = (
        await tx.select().from(runEvidencePackage).where(eq(runEvidencePackage.runId, runId))
      )[0];
      if (!row) return null;
      return {
        runId: row.runId,
        state: row.state as PackageSeal['state'],
        runState: row.runState as PackageSeal['runState'],
        sealedAt: row.sealedAt.toISOString(),
        requiredTotal: row.requiredTotal,
        registered: row.registered,
        missingRequired: row.missingRequired as PackageSeal['missingRequired'],
        abandoned: row.abandoned as PackageSeal['abandoned'],
      };
    },

    /**
     * Write the seal. `DO NOTHING` on conflict, so the FIRST seal wins.
     *
     * The database refuses an UPDATE of this row outright, so there is no spelling of this
     * method that could rewrite a sealed outcome even if a later story wanted one.
     */
    async writeSeal(seal: PackageSeal): Promise<void> {
      await tx
        .insert(runEvidencePackage)
        .values({
          runId,
          state: seal.state,
          runState: seal.runState,
          sealedAt: new Date(seal.sealedAt),
          requiredTotal: seal.requiredTotal,
          registered: seal.registered,
          missingRequired: [...seal.missingRequired],
          abandoned: [...seal.abandoned],
        })
        .onConflictDoNothing({ target: runEvidencePackage.runId });
    },
  };
}

/**
 * The post-Run verification's transaction.
 *
 * It can read the seal, read the registered artifacts and add findings. It has no writer
 * for a Run state, a seal or an Evidence row, so "a mismatch found after the Run changes
 * no state" is a property of what this context can reach.
 */
export class PostgresSealedPackageRepository implements SealedPackageRepository {
  constructor(private readonly db: Database) {}

  async transaction<T>(
    runId: string,
    work: (context: SealedPackageContext) => Promise<T>,
  ): Promise<T> {
    if (!isUuidText(runId)) throw new Error('Invalid Run identity');
    return this.db.transaction(async (tx: Transaction) => {
      await tx
        .select({ id: auditRun.runId })
        .from(auditRun)
        .where(eq(auditRun.runId, runId))
        .for('update');
      const run = await new DrizzleRunRepository(tx).findRun(runId);
      const packageContext = evidencePackageContext(tx, runId);
      return work({
        run,
        auditEvents: createAuditEventWriter(tx, new SystemClock(), new CryptoUuidV7Generator()),
        readSeal: packageContext.readSeal,
        async readRegisteredArtifacts(): Promise<readonly RegisteredArtifact[]> {
          const adapter = await tx
            .select({
              evidenceId: runEvidence.evidenceId,
              kind: runEvidence.kind,
              objectKey: runEvidence.objectKey,
              digest: runEvidence.digest,
              size: runEvidence.size,
            })
            .from(runEvidence)
            .where(sql`${runEvidence.runId}=${runId} AND ${runEvidence.state}='REGISTERED'`);
          // The population reservation addresses TWO objects and registration verified
          // both, so both are verified again. The envelope is what preserves the
          // declaration beside the bytes; a package that re-checked only the raw bytes
          // would leave the half a reader compares counts against unchecked.
          const population = await tx
            .select({
              evidenceId: populationEvidence.evidenceId,
              objectKey: populationEvidence.objectKey,
              envelopeKey: populationEvidence.envelopeKey,
              rawDigest: populationEvidence.rawDigest,
              envelopeDigest: populationEvidence.envelopeDigest,
              size: populationEvidence.size,
            })
            .from(populationEvidence)
            .where(
              sql`${populationEvidence.runId}=${runId} AND ${populationEvidence.state}='REGISTERED'`,
            );
          const artifacts: RegisteredArtifact[] = [];
          for (const row of population) {
            if (row.rawDigest === null || row.size === null) continue;
            artifacts.push({
              evidenceId: row.evidenceId,
              kind: POPULATION_ARTIFACT,
              objectKey: row.objectKey,
              digest: row.rawDigest,
              size: row.size,
            });
            // The acquisition envelope is the other half of the same reservation, and it
            // is what preserves the independently published declaration beside the bytes.
            // Its size was never stored separately, so it is verified by digest alone: a
            // fabricated `expectedSize` would put a number nobody measured into an
            // immutable chain, and the digest already makes every check a length would.
            if (row.envelopeDigest !== null) {
              artifacts.push({
                evidenceId: row.evidenceId,
                kind: POPULATION_ARTIFACT,
                objectKey: row.envelopeKey,
                digest: row.envelopeDigest,
                size: null,
              });
            }
          }
          for (const row of adapter) {
            if (row.digest === null) continue;
            artifacts.push({
              evidenceId: row.evidenceId,
              kind: row.kind as RegisteredArtifact['kind'],
              objectKey: row.objectKey,
              digest: row.digest,
              size: row.size,
            });
          }
          return artifacts;
        },
        async readIntegrityFindings(): Promise<readonly EvidenceIntegrityRecord[]> {
          const rows = await tx
            .select()
            .from(runEvidenceIntegrity)
            .where(eq(runEvidenceIntegrity.runId, runId));
          return rows.map((row) => ({
            findingId: row.findingId,
            evidenceId: row.evidenceId,
            objectKey: row.objectKey,
            finding: row.finding as EvidenceIntegrityRecord['finding'],
            expectedDigest: row.expectedDigest,
            observedDigest: row.observedDigest,
            expectedSize: row.expectedSize,
            observedSize: row.observedSize,
            detectedAt: row.detectedAt.toISOString(),
          }));
        },
        async recordIntegrityFindings(findings: readonly EvidenceIntegrityRecord[]) {
          if (findings.length === 0) return;
          await tx
            .insert(runEvidenceIntegrity)
            .values(
              findings.map((finding) => ({
                findingId: finding.findingId,
                runId,
                evidenceId: finding.evidenceId,
                objectKey: finding.objectKey,
                finding: finding.finding,
                expectedDigest: finding.expectedDigest,
                observedDigest: finding.observedDigest,
                expectedSize: finding.expectedSize,
                observedSize: finding.observedSize,
                detectedAt: new Date(finding.detectedAt),
              })),
            )
            // A re-verification of a mismatch already recorded adds nothing: the unique
            // index on (evidence_id, finding) is what makes the command idempotent, so a
            // sweep run twice does not multiply one integrity event into two.
            .onConflictDoNothing({
              target: [
                runEvidenceIntegrity.evidenceId,
                runEvidenceIntegrity.objectKey,
                runEvidenceIntegrity.finding,
              ],
            });
        },
        async notifyTimeline(sequence: number) {
          await tx.execute(
            sql`SELECT pg_notify('run_timeline',${JSON.stringify({ runId, sequence })})`,
          );
        },
      });
    });
  }

  /** What the Result and the exports read: the seal, and any integrity finding on it. */
  async readSealedPackage(runId: string) {
    if (!isUuidText(runId)) return null;
    const seal = (
      await this.db.select().from(runEvidencePackage).where(eq(runEvidencePackage.runId, runId))
    )[0];
    if (!seal) return null;
    const findings = await this.db
      .select()
      .from(runEvidenceIntegrity)
      .where(eq(runEvidenceIntegrity.runId, runId));
    return { seal, findings };
  }
}
