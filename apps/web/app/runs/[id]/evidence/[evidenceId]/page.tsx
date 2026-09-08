import type { Metadata } from 'next';

import {
  requestEvidenceReadGrant,
} from '@intellifin/application';
import {
  CryptoUuidV7Generator,
  DrizzleRunDetailRepository,
  PostgresEvidenceReadGrantRepository,
  SystemClock,
} from '@intellifin/infrastructure';

import { getRuntime } from '../../../../../src/bootstrap';
import { Banner } from '../../../../../src/design/Banner';
import { RunDenied, RunDetailFrame, openRun } from '../../../../../src/runs/detail';
import { groundingValueText } from '../../../../../src/runs/grounding-inspector';
import { readSnapshotCellWithGrant, type EvidenceSnapshotReadFailure } from '../../../../../src/runs/evidence-snapshot-reader';
import { UntrustedText } from '../../../../../src/runs/UntrustedText';
import { currentCorrelationId, requireServerAction } from '../../../../../src/server-session';

export const metadata: Metadata = { title: 'Stored snapshot · IntelliFin Audit' };
export const dynamic = 'force-dynamic';

const FAILURE_COPY: Readonly<Record<EvidenceSnapshotReadFailure, string>> = {
  'grant-unavailable': 'The stored snapshot could not be made available before its read window closed.',
  'capability-mismatch': 'The stored snapshot capability did not match this Run and locator.',
  'download-failed': 'The stored snapshot could not be retrieved.',
  'download-object-missing': 'The registered stored snapshot object is missing.',
  'download-redirected': 'The stored snapshot response did not come from its exact capability URL.',
  'download-media-type-mismatch': 'The stored snapshot media type did not match its registered Evidence.',
  'download-too-large': 'The stored snapshot exceeded the inspector size bound.',
  'download-size-mismatch': 'The stored snapshot size did not match its registered Evidence.',
  'download-digest-mismatch': 'The stored snapshot digest did not match its registered Evidence.',
  'access-denied': 'This stored snapshot read is no longer authorized.',
  'snapshot-unreadable': 'The stored snapshot is unreadable by the domain extractor.',
  'locator-malformed': 'The recorded grounding locator is malformed.',
  'locator-unresolved': 'The recorded grounding locator does not resolve in the stored snapshot.',
};

/**
 * Open one recorded grounding cell. The URL is an internal page path; the object-store
 * capability is fetched and consumed on the server and never reaches this page's HTML.
 */
export default async function StoredSnapshotPage({
  params,
  searchParams,
}: {
  readonly params: Promise<{ readonly id: string; readonly evidenceId: string }>;
  readonly searchParams: Promise<{ readonly locator?: string | readonly string[] }>;
}): Promise<React.JSX.Element> {
  const { id, evidenceId } = await params;
  const access = await openRun(id);
  if (!access.allowed) return <RunDenied reason={access.reason} />;
  const decision = await requireServerAction('run.initiate');
  if (!decision.allowed) return <RunDenied reason={decision.reason} />;
  const locatorValue = (await searchParams).locator;
  const locator = typeof locatorValue === 'string' ? locatorValue : null;
  const runtime = await getRuntime();
  const detail = new DrizzleRunDetailRepository(runtime.db);
  const grounding = locator === null
    ? null
    : await detail.readObservationGrounding(access.run.runId, evidenceId.toLowerCase(), locator);
  if (locator === null || grounding === null || grounding.grounding === null) {
    return <RunDenied reason="This locator is not a recorded grounding for the Run." />;
  }

  const correlationId = await currentCorrelationId();
  const grants = new PostgresEvidenceReadGrantRepository(runtime.db);
  const requested = await requestEvidenceReadGrant(
    { repository: grants, ids: new CryptoUuidV7Generator(), clock: new SystemClock() },
    {
      session: decision.session,
      correlationId,
      request: { runId: access.run.runId, evidenceId: evidenceId.toLowerCase(), locator },
    },
  );
  if (!requested.ok) return <RunDenied reason={requested.reason} />;
  const read = await readSnapshotCellWithGrant(
    grants,
    {
      grantId: requested.grantId,
      runId: access.run.runId,
      evidenceId: evidenceId.toLowerCase(),
      actorId: decision.session.userId,
      locator,
      correlationId,
    },
    {
      reportIntegrityMismatch: (mismatch) => grants.reportIntegrityMismatch(mismatch),
    },
  );

  return (
    <RunDetailFrame run={access.run} tab="evidence" readAt={access.readAt}>
      <section className="ls-card ls-stack" aria-labelledby="stored-snapshot-heading">
        <h2 id="stored-snapshot-heading">Stored Structural Snapshot</h2>
        <dl className="ls-definition">
          <div>
            <dt>Evidence ID</dt>
            <dd className="ls-mono">{evidenceId}</dd>
          </div>
          <div>
            <dt>Locator</dt>
            <dd className="ls-mono">{locator}</dd>
          </div>
          <div>
            <dt>Field label</dt>
            <dd>
              <UntrustedText field="recorded grounding field label">{grounding.grounding.label}</UntrustedText>
            </dd>
          </div>
        </dl>
        {read.cell === null ? (
          <Banner tone="warning" title="Snapshot cell unavailable">
            {FAILURE_COPY[read.failure]}
          </Banner>
        ) : (
          <UntrustedText field={`${grounding.name}, as read at the stored snapshot locator`}>
            {groundingValueText(read.cell.value)}
          </UntrustedText>
        )}
      </section>
    </RunDetailFrame>
  );
}
