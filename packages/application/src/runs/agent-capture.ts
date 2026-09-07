import { WEB_TREE_MEDIA_TYPE, readStructuralSnapshot, type StoredSnapshot } from '@intellifin/domain';
import type { BrowserActionArtifact, EvidenceStore, AdapterEvidenceRecord } from './execution-ports.js';
import type { AgentWorkContext } from './agent-work-ports.js';
import type { CredentialGuard } from './credential-guard.js';
import { adapterEvidenceRecord, freezeArtifact, registerEvidence, reserveArtifact, readRegisteredArtifact } from './evidence-package.js';

/** Freeze only the artifacts of one already-persisted, permitted reading action. */
export async function freezeAgentCapture(input: {
  runId: string;
  targetSystem: string;
  templateId: string;
  toolActionId: string;
  sourceLocation: string;
  artifacts: readonly BrowserActionArtifact[];
  store: EvidenceStore;
  guard: CredentialGuard;
  budget(): number;
  now(): string;
  /** The execution loop rechecks its lease/revision under the Run lock for every write. */
  commit(work: (context: AgentWorkContext) => Promise<void>): Promise<boolean>;
}): Promise<{ snapshot: StoredSnapshot; screenshotEvidenceId: string | null } | null> {
  const structural = input.artifacts.filter(a => a.kind === 'structural-snapshot');
  const screenshots = input.artifacts.filter(a => a.kind === 'screenshot');
  if (structural.length !== 1 || screenshots.length > 1 || input.artifacts.some(a => a.location !== input.sourceLocation)) throw new Error('Invalid agent capture');
  const source = structural[0]!;
  if (source.mediaType !== WEB_TREE_MEDIA_TYPE || !readStructuralSnapshot({ evidenceId: 'pending', substrate: 'web_tree', bytes: source.bytes }).ok) throw new Error('Invalid structural snapshot');
  if (screenshots.some(a => a.mediaType !== 'image/png')) throw new Error('Invalid screenshot');
  const evidence: AdapterEvidenceRecord[] = [];
  let snapshot: StoredSnapshot | null = null;
  let screenshotEvidenceId: string | null = null;
  for (const artifact of input.artifacts) {
    const reservation = reserveArtifact({ runId: input.runId, kind: artifact.kind, scope: input.toolActionId, templateId: input.templateId });
    let row: AdapterEvidenceRecord | null = null;
    if (!await input.commit(async context => {
      row = adapterEvidenceRecord(reservation, input.targetSystem, context.evidence.find(e => e.evidenceId === reservation.evidenceId));
      await context.saveEvidence(row);
    })) return null;
    const reserved = row! as AdapterEvidenceRecord;
    const frozen = await freezeArtifact(input.store, { objectKey: reserved.objectKey, registeredDigest: reserved.digest, registeredSize: reserved.size }, artifact.bytes, input.budget, input.guard);
    const registered = registerEvidence(reserved, frozen, { mediaType: artifact.mediaType, capturedAt: input.now(), method: 'agent' });
    evidence.push(registered);
    if (artifact.kind === 'structural-snapshot') {
      const bytes = await readRegisteredArtifact(input.store, registered, input.budget);
      if (bytes === null || input.guard.discloses(bytes)) throw new Error('Snapshot verification failed');
      snapshot = { evidenceId: reserved.evidenceId, substrate: 'web_tree', bytes };
    }
    else screenshotEvidenceId = reserved.evidenceId;
  }
  if (!await input.commit(async context => {
    for (const row of evidence) {
      await context.saveEvidence(row);
      await context.saveCapture({ evidenceId: row.evidenceId, toolActionId: input.toolActionId, sourceLocation: input.sourceLocation });
    }
  })) return null;
  return snapshot === null ? null : { snapshot, screenshotEvidenceId };
}
