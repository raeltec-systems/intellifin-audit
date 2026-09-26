import type { HumanMatchDecision } from '@intellifin/application';
import { MASKED_VALUE } from '../design/copy';
import { TechnicalDetails } from '../design/TechnicalDetails';
import { Timestamp } from '../design/Timestamp';
import { ActorName } from './ActorName';
import { matchOriginWord } from './labels';
import { UntrustedText } from './UntrustedText';

/** Presentation of stored provenance only; never reclassifies a match. */
export function HumanMatch({ runId, matchOrigin, decision }: {
  readonly runId: string; readonly matchOrigin?: string | null;
  readonly decision?: HumanMatchDecision | null;
}): React.JSX.Element | null {
  if (matchOrigin !== 'human-matched') return null;
  return <div className="ls-stack">
    <strong>{matchOriginWord(matchOrigin)}</strong>
    {decision == null ? null : <>
      <UntrustedText field="Answer" policy={true}>{decision.answerMasked !== false ? MASKED_VALUE : decision.answerLabel ?? MASKED_VALUE}</UntrustedText>
      <p><ActorName id={decision.actorId} names={new Map(decision.actorName === undefined ? [] : [[decision.actorId, decision.actorName]])} /> · <Timestamp value={decision.decidedAt} /></p>
      <TechnicalDetails items={[{ label: 'Wait identifier', value: decision.waitId, mono: true }, { label: 'Answer option identifier', value: decision.answerOptionId, mono: true }]} />
    </>}
  </div>;
}
