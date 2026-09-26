import Link from 'next/link';
import { TechnicalDetails } from '../design/TechnicalDetails';
import type { RunPauseLinkage } from '@intellifin/infrastructure';
import { Timestamp } from '../design/Timestamp';
import { ActorName } from './ActorName';

/** Exact stored fields. Null is historical/unstarted, never a guessed current step. */
export function PauseLinkageFacts({ entry }: { readonly entry: RunPauseLinkage }): React.JSX.Element {
  return <dl className="ls-definition">
    <div><dt>Step</dt><dd>{entry.planStepId ?? 'Not recorded'}</dd></div>
    <div><dt>Attempt</dt><dd>{entry.attempt ?? (entry.inFlight === false ? 'None' : 'Not recorded')}</dd></div>
    <div><dt>Step Execution identifier</dt><dd className="ls-mono">{entry.stepExecutionId ?? (entry.inFlight === false ? 'None' : 'Not recorded')}</dd></div>
  </dl>;
}
export function PauseLinkageHistory({ entries, total, names, firstHref, nextHref }: {
  readonly firstHref?: string | null; readonly nextHref?: string | null;
  readonly entries: readonly RunPauseLinkage[]; readonly total: number; readonly names: ReadonlyMap<string, string>;
}): React.JSX.Element | null {
  if (total === 0) return null;
  return <section className="ls-card ls-stack" aria-labelledby="pause-resume-history">
    <h2 id="pause-resume-history">Pause · Resume</h2>
    <p>{entries.length} / {total}</p>
    <ol className="ls-plain-list">{entries.map(entry => <li key={entry.eventId} id={`pause-event-${entry.sequence}`}>
      <h3>{entry.kind === 'pause' ? 'Pause' : 'Resume'}</h3>
      <p><ActorName id={entry.actorId} names={names} /> · <Timestamp value={entry.occurredAt} /></p>
      <TechnicalDetails items={[{ label: 'Wait identifier', value: entry.waitId ?? 'Not recorded', mono: true }]} />
      <PauseLinkageFacts entry={entry} />
    </li>)}</ol>
    {firstHref || nextHref ? <nav>
      {firstHref ? <Link href={firstHref}>First page</Link> : null}
      {nextHref ? <Link href={nextHref}>Next page</Link> : null}
    </nav> : null}
  </section>;
}
