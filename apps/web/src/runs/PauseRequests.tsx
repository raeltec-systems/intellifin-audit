import type { RunPauseRequestEntry } from '@intellifin/infrastructure';

import { readableStamp } from '../design/time';
import { PAUSE_REQUEST_WORDS, pauseRequestSentences, pauseRequestedByWords } from './decision-words';
import { NamedSentence } from './NamedSentence';
import type { PauseStepNamer } from './pause-words';

/**
 * One pause request the Run never honoured, as an entry in "Pauses and resumes" (Story
 * 10.10, legacy 5.4 AC 3): who asked and when, and why it never took effect.
 *
 * A request to pause at once is on the chain only because the terminal transition found it
 * still outstanding, so the Run ended first; a request to pause after an inspection says
 * which inspection, read by the Work Item its own marker row holds. Every fact is that
 * request's own record — nothing is paired with a pause or an attempt by time.
 */
export function PauseRequestEntry({ entry, name, actorNames }: {
  readonly entry: RunPauseRequestEntry;
  readonly name: PauseStepNamer;
  /** User id to person's name, from `ActorNameReader`. An id with no name is shown as the id. */
  readonly actorNames: ReadonlyMap<string, string>;
}): React.JSX.Element {
  const requested = pauseRequestedByWords(
    entry.requestedBy,
    entry.requestedAt === null ? null : readableStamp(entry.requestedAt),
  );
  return (
    <li className="ls-pause-history__entry" data-pause-request={entry.mode} data-event-id={entry.eventId}>
      <h3>{PAUSE_REQUEST_WORDS.title}</h3>
      <p className="ls-pause-history__line">
        <NamedSentence sentence={requested} id={entry.requestedBy} names={actorNames} />
      </p>
      <p className="ls-pause-history__line">{pauseRequestSentences(entry, name).join(' ')}</p>
    </li>
  );
}
