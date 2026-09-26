import Link from 'next/link';
import { isActiveRunState, type RunState } from '@intellifin/domain';
import { FIXED_ESCALATION_OPTIONS } from '@intellifin/application';
import type { TimelineDecision as Decision } from '@intellifin/infrastructure';
import { ESCALATION_PANEL_COPY, MASKED_VALUE, PAUSE_COPY } from '../design/copy';
import { escalationKindWord } from '../design/plain-words';
import { Timestamp } from '../design/Timestamp';
import { ActorName } from './ActorName';
import { runLifecycleWord, stepExecutionWord } from './labels';
import { UntrustedText } from './UntrustedText';

/** Only the fixed answer vocabulary is platform copy; candidate labels remain untrusted. */
function Answer({ decision }: { readonly decision: Decision }): React.JSX.Element {
  if (decision.answerOptionId === 'mark-ambiguous') return <>Mark the record ambiguous</>;
  const kind = decision.escalationKind;
  const fixed = kind === 'unnamed-value' || kind === 'retry-or-skip'
    ? FIXED_ESCALATION_OPTIONS[kind].find(option => option.id === decision.answerOptionId) : undefined;
  return fixed === undefined
    ? decision.answerMasked === false && decision.answerLabel !== null
      ? <UntrustedText field="AGENT-GENERATED candidate">{decision.answerLabel}</UntrustedText>
      : <span>{MASKED_VALUE}</span>
    : <>{fixed.label}</>;
}

export function TimelineDecisionRow({ decision, runId, names, runState }: {
  readonly decision: Decision;
  readonly runState: string;
  readonly runId: string;
  readonly names: ReadonlyMap<string, string>;
}): React.JSX.Element {
  const replayAvailable = !isActiveRunState(runState as RunState);
  return <li className="ls-timeline__row" id={decision.kind === 'escalation' ? `wait-${decision.waitId}` : `decision-${decision.sequence}`}
    style={{ '--ls-timeline-level': 0 } as React.CSSProperties}>
    <span className="ls-timeline__marker">{decision.kind === 'pause' ? 'Pause' : 'Escalation'}</span>
    <div className="ls-timeline__name">
      <span className="ls-timeline__title">{decision.kind === 'pause' ? PAUSE_COPY.requested : escalationKindWord(decision.escalationKind ?? '')}</span>
      <div className="ls-timeline__detail">
        {names.has(decision.actorId) ? <ActorName id={decision.actorId} names={names} /> : <span>Name unavailable</span>}
        {' · '}<Timestamp value={decision.requestedAt ?? decision.occurredAt} />
        {decision.kind === 'escalation' ? <div><Answer decision={decision} /></div> : <>
          {' · '}{runLifecycleWord(decision.state ?? '') ?? 'Superseded'}{' · '}<Timestamp value={decision.occurredAt} />
        </>}
      </div>
    </div>
    <div className="ls-timeline__call">
      {decision.kind === 'pause' ? <span>Work Item · Not recorded</span> : <>
        {decision.stepId === null ? <span>{ESCALATION_PANEL_COPY.noStep}</span> : <span>Step · <code>{decision.stepId}</code></span>}
        {' · '}{decision.workItemId === null ? <span>Work Item · Not recorded</span>
          : replayAvailable ? <Link href={`/runs/${runId}/replay?workItem=${decision.workItemId}`}>Open inspection Replay</Link>
            : <Link href={`/runs/${runId}/timeline#work-item-${decision.workItemId}`}>Work Item</Link>}
        {replayAvailable ? <> · <Link href={`/runs/${runId}/replay?wait=${decision.waitId}#replay-escalation-${decision.waitId}`}>Escalation</Link></> : null}
      </>}
    </div>
    <span className="ls-timeline__status">{decision.kind === 'pause' ? stepExecutionWord('SUPERSEDED') : 'Answered'}</span>
  </li>;
}
