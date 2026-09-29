import type { ExecutablePlan } from '@intellifin/domain';
import type { RunPauseEntry, RunPauseHistory } from '@intellifin/infrastructure';

import { Reference } from '../design/Reference';
import { readableStamp } from '../design/time';
import type { PauseRequestsView } from './decision-read';
import { pauseHistoryRows, pauseRequestsShownWords } from './decision-words';
import { PauseRequestEntry } from './PauseRequests';
import {
  PAUSE_WORDS,
  keySegments,
  pauseClosureSentences,
  pauseHoldSentences,
  pauseStepNamer,
  pauseSubjectKeys,
  pauseTitleWords,
  pausedByWords,
  pausesShownWords,
  type PauseHoldRead,
  type PauseStepNamer,
} from './pause-words';

/**
 * Sentences that name records, with each record key kept on one line (`keySegments`): a
 * key such as `E-000102` would otherwise break after its hyphen. Only the rendering changes;
 * the text is the sentence the words module built.
 */
function KeyedText({ sentences, keys }: {
  readonly sentences: readonly string[];
  readonly keys: readonly string[];
}): React.JSX.Element {
  return (
    <>
      {keySegments(sentences.join(' '), keys).map((segment, index) =>
        segment.key ? <span key={index} className="ls-nowrap">{segment.text}</span> : segment.text)}
    </>
  );
}

/**
 * Every pause of a Run, on the Execution Timeline (Story 10.6, legacy 5.4): where each one
 * held the Run, and which attempt each resume started.
 *
 * Every fact here is read from a durable record by an exact identity — the wait row, the
 * pause's own event, the Step Execution that event or the resumed attempt's start event
 * names — and nothing is paired by time. A record that does not establish a fact says so
 * in words, because a blank beside a pause would read as one that held the Run nowhere.
 *
 * Rendered only for a Run that has been paused, or asked to pause: an empty section would
 * be a statement about pauses that nobody asked for.
 *
 * Since Story 10.10 the list also holds each pause REQUEST the Run never honoured, in the
 * order it was asked for (`pauseHistoryRows`): a "Pause request" entry, read from that
 * request's own record.
 */
export function PauseHistorySection({ history, plan, recordNames, actorNames, requests }: {
  readonly history: RunPauseHistory;
  /** The Run's frozen plan, which names each step; `null` names none and the section says so. */
  readonly plan: ExecutablePlan | null;
  /** Record key to name, from `readRecordNames`, for the records the pauses name. */
  readonly recordNames: ReadonlyMap<string, string>;
  /** User id to person's name, from `ActorNameReader`. An id with no name is shown as the id. */
  readonly actorNames: ReadonlyMap<string, string>;
  /**
   * The pause requests the Run never honoured (Story 10.10). REQUIRED, so no surface that
   * lists the pauses can leave the unhonoured requests out and say nothing.
   */
  readonly requests: PauseRequestsView;
}): React.JSX.Element | null {
  if (history.total === 0 && requests.requests.total === 0) return null;
  const name = pauseStepNamer(plan, recordNames);
  const requestName = pauseStepNamer(requests.plan, requests.recordNames);
  const actor = (id: string | null): string | null => (id === null ? null : actorNames.get(id) ?? id);
  return (
    <section className="ls-card ls-stack" aria-labelledby="pause-history-heading">
      <h2 id="pause-history-heading">{PAUSE_WORDS.heading}</h2>
      <p>{PAUSE_WORDS.intro}</p>
      {history.entries.length < history.total
        ? <p className="ls-caption">{pausesShownWords(history.entries.length, history.total)}</p>
        : null}
      {requests.requests.entries.length < requests.requests.total
        ? <p className="ls-caption">{pauseRequestsShownWords(requests.requests.entries.length, requests.requests.total)}</p>
        : null}
      <ol className="ls-pause-history">
        {pauseHistoryRows(history.entries, requests.requests.entries).map((row) => row.kind === 'pause'
          ? <PauseHistoryEntry key={row.entry.waitId} ordinal={row.ordinal} entry={row.entry} name={name} actor={actor} />
          : <PauseRequestEntry key={row.entry.eventId} entry={row.entry} name={requestName} actorNames={requests.actorNames} />)}
      </ol>
    </section>
  );
}

function PauseHistoryEntry({ ordinal, entry, name, actor }: {
  readonly ordinal: number;
  readonly entry: RunPauseEntry;
  readonly name: PauseStepNamer;
  readonly actor: (id: string | null) => string | null;
}): React.JSX.Element {
  const superseded = entry.hold.kind === 'recorded' ? entry.hold.superseded : null;
  const started = entry.closure.kind === 'resumed' && entry.closure.restart.kind === 'started'
    ? entry.closure.restart.attempt
    : null;
  const keys = pauseSubjectKeys([entry]);
  return (
    <li className="ls-pause-history__entry" data-wait-id={entry.waitId}>
      <h3>{pauseTitleWords(ordinal)}</h3>
      <p className="ls-pause-history__line">{pausedByWords(actor(entry.pausedBy), readableStamp(entry.pausedAt))}</p>
      <p className="ls-pause-history__line">
        <KeyedText sentences={pauseHoldSentences(entry, name, 'past')} keys={keys} />
        {superseded === null ? null : <> <Reference kind="Step Execution" value={superseded.stepExecutionId} /></>}
      </p>
      <p className="ls-pause-history__line">
        <KeyedText sentences={pauseClosureSentences(entry, name, { actor, time: (iso) => readableStamp(iso) })} keys={keys} />
        {started === null ? null : <> <Reference kind="Step Execution" value={started.stepExecutionId} /></>}
      </p>
    </li>
  );
}

/**
 * Where the pause holding the Run now holds it, on the Paused banner.
 *
 * Anything but a read hold is said as unreadable, never as an absence: the banner is only
 * rendered for a Run that IS paused, so a missing sentence would claim the pause holds it
 * nowhere.
 */
export function PauseHoldNote({ hold }: { readonly hold: PauseHoldRead }): React.JSX.Element {
  if (hold.kind !== 'read') return <p className="ls-pause-history__line">{PAUSE_WORDS.holdUnreadable}</p>;
  return (
    <p className="ls-pause-history__line">
      <KeyedText sentences={hold.sentences} keys={hold.keys} />
      {hold.supersededStepExecutionId === null
        ? null
        : <> <Reference kind="Step Execution" value={hold.supersededStepExecutionId} /></>}
    </p>
  );
}
