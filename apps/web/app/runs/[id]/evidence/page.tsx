import type { Metadata } from 'next';
import Link from 'next/link';

import {
  DrizzleRunDetailRepository,
  PostgresPopulationRepository,
  PostgresSealedPackageRepository,
} from '@intellifin/infrastructure';

import { getRuntime } from '../../../../src/bootstrap';
import { Banner } from '../../../../src/design/Banner';
import { Digest } from '../../../../src/design/Digest';
import { EmptyState } from '../../../../src/design/EmptyState';
import { RUN_TAB_EMPTY } from '../../../../src/design/copy';
import { EvidenceCard, GroundingInspector, evidenceCardProps } from '../../../../src/runs/EvidenceCards';
import { RunDenied, RunDetailFrame, openRun } from '../../../../src/runs/detail';
import { countText, utcStamp } from '../../../../src/runs/labels';

export const metadata: Metadata = { title: 'Run · Evidence · IntelliFin Audit' };
export const dynamic = 'force-dynamic';

/** The three post-Run integrity findings, in words. A closed vocabulary, like the row. */
const FINDING_WORDS: Readonly<Record<string, string>> = {
  'object-missing': 'The artifact is not in storage.',
  'size-mismatch': 'The stored size is not the registered size.',
  'digest-mismatch': 'The stored bytes are not the registered bytes.',
};

/** The artifact kinds the seal's lists name, in words. */
const ARTIFACT_WORDS: Readonly<Record<string, string>> = {
  population: 'Population',
  'reference-source': 'Reference Source',
  'adapter-extraction': 'Adapter extraction',
};

function artifactLabel(kind: string): string {
  return Object.hasOwn(ARTIFACT_WORDS, kind) ? ARTIFACT_WORDS[kind]! : kind;
}

/** The seal's lists are `jsonb`, so they are read as request-shaped input, not trusted. */
function artifactRefs(value: unknown): { kind: string; objectKey: string }[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) =>
    typeof entry === 'object' && entry !== null && typeof (entry as { objectKey?: unknown }).objectKey === 'string'
      ? [{ kind: String((entry as { kind?: unknown }).kind ?? ''), objectKey: (entry as { objectKey: string }).objectKey }]
      : [],
  );
}

/**
 * Run Detail → Evidence.
 *
 * The population acquisition and its artifact, one card per Reference Source and adapter
 * extraction with the FR-31 fields and its kind, the grounding inspector for every
 * Observation, and the sealed Evidence package with any post-Run integrity finding.
 *
 * A Run that collected nothing says so with the contract's own headline rather than
 * showing an empty list a reader takes for "fine".
 */
export default async function RunEvidencePage({
  params,
  searchParams,
}: {
  readonly params: Promise<{ id: string }>;
  readonly searchParams: Promise<{ after?: string }>;
}): Promise<React.JSX.Element> {
  const { id } = await params;
  const access = await openRun(id);
  if (!access.allowed) return <RunDenied reason={access.reason} />;
  const { run, readAt } = access;

  // The excluded/indeterminate row list is paged by ordinal; a value that is not a
  // non-negative integer is treated as the first page rather than as an error.
  const after = Number((await searchParams).after ?? 0);
  const runtime = await getRuntime();
  const detail = new DrizzleRunDetailRepository(runtime.db);
  const [items, observations, population, evidencePackage] = await Promise.all([
    detail.readEvidenceItems(run.runId),
    detail.readObservations(run.runId),
    new PostgresPopulationRepository(runtime.db).readPopulation(run.runId, after),
    new PostgresSealedPackageRepository(runtime.db).readSealedPackage(run.runId),
  ]);

  const populationEvidence = population?.evidence ?? null;
  const mediaTypes = new Map(items.map((item) => [item.evidenceId, item.mediaType]));
  const mediaTypeOf = (evidenceId: string): string | null => mediaTypes.get(evidenceId) ?? null;
  const missing = artifactRefs(evidencePackage?.seal.missingRequired);
  const abandoned = artifactRefs(evidencePackage?.seal.abandoned);
  const summary = population?.summary ?? null;

  return (
    <RunDetailFrame run={run} tab="evidence" readAt={readAt}>
      {population === null && items.length === 0 ? (
        <EmptyState
          icon="archive"
          headline={RUN_TAB_EMPTY.evidence.headline}
          sentence={RUN_TAB_EMPTY.evidence.sentence}
        />
      ) : null}

      {population === null ? null : (
        <section className="ls-card ls-stack" aria-labelledby="population-heading">
          <h2 id="population-heading">Population acquisition</h2>
          <p>
            {population.status === 'POPULATION_READY'
              ? 'Population verified. Target checks are pending.'
              : population.status === 'TERMINAL'
                ? 'Population acquisition stopped.'
                : 'Population acquisition is in progress.'}{' '}
            Attempts: {population.attempts}.
          </p>
          {/* A population diagnostic is a closed platform constant, never a message a
              Target System supplied. */}
          {population.diagnostic ? (
            <Banner tone="warning" title="Population diagnostic">
              {population.diagnostic}
            </Banner>
          ) : null}
          {summary === null ? null : (
            <>
              <dl className="ls-definition">
                <div>
                  <dt>Rows acquired</dt>
                  {/* The stored retrieved count (generation 32), not a sum recomputed on
                      the way to the screen. The database CHECK pins the two together, so
                      this is the same number said once. */}
                  <dd className="ls-mono">{countText(summary.retrievedCount)}</dd>
                </div>
                <div>
                  <dt>Included</dt>
                  <dd className="ls-mono">{countText(summary.included)}</dd>
                </div>
                <div>
                  <dt>Excluded</dt>
                  <dd className="ls-mono">{countText(summary.excluded)}</dd>
                </div>
                <div>
                  <dt>Indeterminate</dt>
                  <dd className="ls-mono">{countText(summary.indeterminate)}</dd>
                </div>
                <div>
                  <dt>Snapshot generated at (UTC)</dt>
                  <dd className={summary.generatedAt === null ? undefined : 'ls-mono'}>
                    {/* §H's freshness row has to say WHICH way a snapshot is unfit, and
                        an unrecorded generation time is "unknown", not "fine". */}
                    {summary.generatedAt === null
                      ? 'Not recorded by the source declaration.'
                      : utcStamp(summary.generatedAt)}
                  </dd>
                </div>
                <div>
                  <dt>Digest of the parsed rows</dt>
                  {summary.rowsDigest === null ? (
                    <dd>Not recorded: the population was never parsed.</dd>
                  ) : (
                    <Digest as="dd" label="Population rows" value={summary.rowsDigest} />
                  )}
                </div>
              </dl>
              <ul className="ls-plain-list">
                {summary.checks.map((check) => (
                  <li key={check.name}>
                    {check.name}: {check.passed ? 'Passed' : 'Failed'}
                  </li>
                ))}
              </ul>
            </>
          )}
          {populationEvidence ? (
            <ul className="ls-plain-list">
              <EvidenceCard
                evidenceId={populationEvidence.evidenceId}
                kind="population"
                source="Population Source snapshot"
                workItemId={null}
                stepId={null}
                /* Stored from generation 32, measured at the registration that verified the
                   raw bytes. A row an earlier build wrote still carries none, and the card
                   says so rather than borrowing an instant from somewhere else. */
                capturedAt={populationEvidence.capturedAt}
                captureMethod={populationEvidence.captureMethod}
                captureTimeSource={populationEvidence.captureTimeSource}
                digest={populationEvidence.rawDigest}
                size={populationEvidence.size}
                state={populationEvidence.state}
                /* The stored key, not a second spelling of `evidenceObjectKeys`. */
                objectKey={populationEvidence.objectKey}
                note={null}
              />
            </ul>
          ) : null}
          {population.rows.length === 0 && !(after > 0) ? null : (
            <>
              <h3 className="ls-overline">Excluded and indeterminate rows</h3>
              <div className="ls-table-scroll">
                <table className="ls-table">
                  <caption>Every row the inclusion rule did not include, with its reasons.</caption>
                  <thead>
                    <tr>
                      <th scope="col">Source row</th>
                      <th scope="col">Disposition</th>
                      <th scope="col">Reasons</th>
                    </tr>
                  </thead>
                  <tbody>
                    {population.rows.map((row) => (
                      <tr key={row.ordinal}>
                        <th scope="row" className="ls-mono" data-label="Source row">
                          {row.ordinal}
                        </th>
                        <td data-label="Disposition">{row.disposition}</td>
                        {/* The inclusion rule's own sentences about a source's row. */}
                        <td data-label="Reasons">{row.reasons.join('; ')}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <nav className="ls-pagination" aria-label="Excluded row pages">
                {after > 0 ? <Link href={`/runs/${run.runId}/evidence`}>First rows</Link> : null}
                {population.next === null ? null : (
                  <Link href={`/runs/${run.runId}/evidence?after=${population.next}`}>Next rows</Link>
                )}
              </nav>
            </>
          )}
        </section>
      )}

      {items.length === 0 ? null : (
        <section className="ls-card ls-stack" aria-labelledby="evidence-items">
          <h2 id="evidence-items">Evidence items</h2>
          <ul className="ls-plain-list">
            {items.map((item) => (
              <EvidenceCard key={item.evidenceId} {...evidenceCardProps(item)} />
            ))}
          </ul>
        </section>
      )}

      {observations.rows.length === 0 ? null : (
        <section className="ls-card ls-stack" aria-labelledby="grounding-heading">
          <h2 id="grounding-heading">Observations and grounding</h2>
          <p>
            {countText(observations.rows.length)} of {countText(observations.total)} Observations
            are listed.
          </p>
          <ul className="ls-plain-list">
            {observations.rows.map((observation) => (
              <GroundingInspector
                key={observation.observationId}
                observation={observation}
                mediaTypeOf={mediaTypeOf}
                snapshotHrefOf={(evidenceId, locator) =>
                  `/runs/${run.runId}/evidence/${encodeURIComponent(evidenceId)}?locator=${encodeURIComponent(locator)}`
                }
              />
            ))}
          </ul>
        </section>
      )}

      {evidencePackage === null ? null : (
        <section className="ls-card ls-stack" aria-labelledby="evidence-package-heading">
          <h2 id="evidence-package-heading">Evidence package</h2>
          {/* Sealing runs on EVERY terminal transition. An incomplete package is a
              truthful record of an incomplete Run, so it is stated in words rather than
              left as an absence a reader takes for "fine". */}
          <p>
            {evidencePackage.seal.state === 'SEALED'
              ? 'Sealed. Every artifact this Run required is registered and verified.'
              : 'Sealed as incomplete. An artifact this Run required was never registered.'}{' '}
            Registered artifacts: {countText(evidencePackage.seal.registered)}. Required:{' '}
            {countText(evidencePackage.seal.requiredTotal)}.
          </p>
          {missing.length === 0 ? null : (
            <>
              <h3 className="ls-overline">Required artifacts that were never registered</h3>
              <ul className="ls-plain-list">
                {missing.map((entry) => (
                  <li key={entry.objectKey}>
                    {artifactLabel(entry.kind)}: {entry.objectKey}
                  </li>
                ))}
              </ul>
            </>
          )}
          {abandoned.length === 0 ? null : (
            <>
              <h3 className="ls-overline">Abandoned reservations</h3>
              {/* Never silently dropped: an upload that never completed is named here. */}
              <ul className="ls-plain-list">
                {abandoned.map((entry) => (
                  <li key={entry.objectKey}>
                    {artifactLabel(entry.kind)}: {entry.objectKey}
                  </li>
                ))}
              </ul>
            </>
          )}
          {evidencePackage.findings.length === 0 ? null : (
            <>
              <Banner tone="danger" title="Audit Trail integrity">
                Stored Evidence no longer matches what this Run registered. The sealed outcome
                is unchanged; a mismatch found after a Run is corrected only by a new Run.
              </Banner>
              <div className="ls-table-scroll">
                <table className="ls-table">
                  <caption>Integrity findings, discovered after the Run</caption>
                  <thead>
                    <tr>
                      <th scope="col">Artifact</th>
                      <th scope="col">Finding</th>
                      <th scope="col">Registered SHA-256</th>
                      <th scope="col">SHA-256 now</th>
                      <th scope="col">Detected</th>
                    </tr>
                  </thead>
                  <tbody>
                    {evidencePackage.findings.map((finding) => (
                      <tr key={finding.findingId}>
                        <th scope="row" className="ls-mono" data-label="Artifact">
                          {finding.objectKey}
                        </th>
                        <td data-label="Finding">
                          {Object.hasOwn(FINDING_WORDS, finding.finding)
                            ? FINDING_WORDS[finding.finding]
                            : finding.finding}
                        </td>
                        <td data-label="Registered SHA-256">
                          <Digest label="Registered Evidence" value={finding.expectedDigest} />
                        </td>
                        <td data-label="SHA-256 now">
                          {finding.observedDigest === null ? (
                            'The artifact is not there.'
                          ) : (
                            <Digest label="Stored Evidence" value={finding.observedDigest} />
                          )}
                        </td>
                        <td className="ls-mono" data-label="Detected">
                          {utcStamp(finding.detectedAt)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </section>
      )}
    </RunDetailFrame>
  );
}
