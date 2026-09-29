import Link from 'next/link';

import type { RunEscalationAnswerEntry } from '@intellifin/infrastructure';

import type { EscalationAnswersView } from './decision-read';
import {
  ESCALATION_ANSWER_WORDS,
  answeredByWords,
  escalationAnswerTitle,
  escalationAnswerWords,
  escalationAnswersShownWords,
  escalationRaiseSentences,
  escalationReplayHref,
} from './decision-words';
import { NamedSentence } from './NamedSentence';
import { pauseStepNamer, type PauseStepNamer } from './pause-words';
import { UntrustedPolicy, UntrustedText } from './UntrustedText';

/**
 * Every Escalation a person answered, on the Execution Timeline (Story 10.10, legacy 4.8
 * AC 4 and 5.6 AC 3): the question it was, the answer, who gave it and when, where it was
 * raised, and a link to its jump target on Replay.
 *
 * Every fact is read from the wait row and the two events that name it, by the wait's
 * identity; the record is reached through the Evidence the raise named. Nothing is paired
 * by time, and a raise whose record does not establish its step or its Work Item says so.
 * The question and the candidate text are the Audit Agent's: the question is never shown
 * here, and a chosen candidate's text only inert, under its source label, with the policy
 * said once for the section (UX-27).
 *
 * Rendered only for a Run with an answered Escalation: an empty section would be a
 * statement about Escalations nobody asked for.
 */
export function EscalationAnswersSection({ answers, plan, recordNames, actorNames, runId, replayable }: EscalationAnswersView & {
  readonly runId: string;
  /**
   * Whether Replay exists for this Run: only a Run that has ended is replayed, and a link
   * to a Replay of a Run still going would open a page that says it has none.
   */
  readonly replayable: boolean;
}): React.JSX.Element | null {
  if (answers.total === 0) return null;
  const name = pauseStepNamer(plan, recordNames);
  const candidates = answers.entries.some((entry) => entry.answer.kind === 'candidate');
  return (
    <section className="ls-card ls-stack" aria-labelledby="escalation-answers-heading">
      <h2 id="escalation-answers-heading">{ESCALATION_ANSWER_WORDS.heading}</h2>
      <p>{ESCALATION_ANSWER_WORDS.intro}</p>
      {answers.entries.length < answers.total
        ? <p className="ls-caption">{escalationAnswersShownWords(answers.entries.length, answers.total)}</p>
        : null}
      {candidates ? <UntrustedPolicy /> : null}
      <ol className="ls-escalation-answers">
        {answers.entries.map((entry) => (
          <EscalationAnswerEntry
            key={entry.waitId}
            entry={entry}
            name={name}
            actorNames={actorNames}
            runId={runId}
            replayable={replayable}
          />
        ))}
      </ol>
    </section>
  );
}

function EscalationAnswerEntry({ entry, name, actorNames, runId, replayable }: {
  readonly entry: RunEscalationAnswerEntry;
  readonly name: PauseStepNamer;
  readonly actorNames: ReadonlyMap<string, string>;
  readonly runId: string;
  readonly replayable: boolean;
}): React.JSX.Element {
  const headingId = `escalation-answer-${entry.waitId}`;
  const answeredId = `escalation-answered-${entry.waitId}`;
  return (
    <li className="ls-escalation-answers__entry" data-wait-id={entry.waitId} data-answer={entry.answer.kind}>
      <h3 id={headingId}>{escalationAnswerTitle(entry.kind)}</h3>
      <p className="ls-escalation-answers__line" id={answeredId}>
        <NamedSentence sentence={answeredByWords('{time}')} id={entry.answeredBy} names={actorNames} at={entry.answeredAt} />
      </p>
      <p className="ls-escalation-answers__line">
        {escalationAnswerWords(entry.kind, entry.answer)}
        {entry.canceledRun ? ` ${ESCALATION_ANSWER_WORDS.aborted}` : null}
      </p>
      {entry.answer.kind === 'candidate' ? (
        <UntrustedText field={ESCALATION_ANSWER_WORDS.candidateField} policy={false}>
          {entry.answer.label}
        </UntrustedText>
      ) : null}
      <p className="ls-escalation-answers__line">{escalationRaiseSentences(entry.raise, name).join(' ')}</p>
      {replayable ? (
        <p className="ls-escalation-answers__line">
          {/* The name is the approved "Open in Replay"; the entry's heading and its
              "Answered by" line are its description, so several such links — two answers
              to the same kind of question included — are told apart. */}
          <Link href={escalationReplayHref(runId, entry.waitId)} aria-describedby={`${headingId} ${answeredId}`}>
            {ESCALATION_ANSWER_WORDS.openInReplay}
          </Link>
        </p>
      ) : null}
    </li>
  );
}
