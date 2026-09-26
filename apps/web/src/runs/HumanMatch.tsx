import type { RunHumanMatch } from '@intellifin/infrastructure';

import { Reference } from '../design/Reference';
import { TechnicalDetails } from '../design/TechnicalDetails';
import { Timestamp } from '../design/Timestamp';
import { ActorName } from './ActorName';
import { UntrustedText } from './UntrustedText';
import { MATCH_DECISION_WORDS, choseCandidateWords } from './match-words';

/**
 * The human-matched records a surface renders, with the names of the people who matched
 * them (Story 10.6, legacy 4.7).
 *
 * A platform match is absent from `matches` — it has no decision to show, and the surfaces
 * show no flag for it. A human-matched record is present whether or not its decision could
 * be read exactly, so the flag never disappears because the link did.
 */
export interface HumanMatchIndex {
  readonly matches: readonly RunHumanMatch[];
  /** User id to display name, from `ActorNameReader`; an id with no name shows as the id. */
  readonly names: ReadonlyMap<string, string>;
}

/** The index of a surface that read no human-matched record. */
export const NO_HUMAN_MATCHES: HumanMatchIndex = { matches: [], names: new Map() };

/** The human match of one Observation, or `null` when the platform matched it. */
export function humanMatchFor(index: HumanMatchIndex, observationId: string | null): RunHumanMatch | null {
  if (observationId === null) return null;
  return index.matches.find((match) => match.observationId === observationId) ?? null;
}

/** Every human match of one record on one Target System, as a Result names it. */
export function humanMatchesForRecord(
  index: HumanMatchIndex,
  targetSystem: string,
  populationRecordKey: string,
): readonly RunHumanMatch[] {
  return index.matches.filter((match) =>
    match.targetSystem === targetSystem && match.populationRecordKey === populationRecordKey);
}

/**
 * One human-selected match, said where the record is shown.
 *
 * The line carries the decision a reader needs to trace it — who chose, which candidate,
 * when, and the Escalation that asked — or says that the decision is not linked. `detail`
 * adds the candidate's own text, which the Audit Agent wrote and is therefore rendered
 * inert under its source label, and the answered wait's identifier under Technical details.
 * The untrusted-content policy is said ONCE by the surface above it (UX-27).
 */
export function HumanMatchNote({
  match,
  names,
  detail = false,
  prefix = null,
}: {
  readonly match: RunHumanMatch;
  readonly names: ReadonlyMap<string, string>;
  readonly detail?: boolean;
  /** What the note is about when the surface lists more than one system, e.g. a system name. */
  readonly prefix?: string | null;
}): React.JSX.Element {
  const decision = match.decision;
  return (
    <div className="ls-human-match" data-human-match={decision.state}>
      <p className="ls-human-match__line">
        {prefix === null ? null : <>{prefix}: </>}
        <strong className="ls-human-match__flag">{MATCH_DECISION_WORDS.flag}</strong>
        {' · '}
        {decision.state === 'linked' ? (
          <>
            <ActorName id={decision.decidedBy} names={names} />{' '}
            {choseCandidateWords(decision.candidate, decision.candidates)} on{' '}
            <Timestamp value={decision.decidedAt} precision="minute" /> (
            <Reference kind="Escalation" value={decision.waitId} />).
          </>
        ) : (
          MATCH_DECISION_WORDS.notLinked
        )}
      </p>
      {detail && decision.state === 'linked' ? (
        <>
          <UntrustedText field={MATCH_DECISION_WORDS.candidateField} policy={false}>
            {decision.candidateLabel}
          </UntrustedText>
          <TechnicalDetails items={[{ label: MATCH_DECISION_WORDS.waitIdentifier, value: decision.waitId, mono: true }]} />
        </>
      ) : null}
    </div>
  );
}
