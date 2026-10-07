import { useEffect, useState } from 'react';
import { AccessError } from './auth';
import type { Session } from './auth';
import type { Scope } from './engagements';
import { attentionLabel, nextActionLabel, readTaskWork } from './work';
import type { TaskWork } from './work';

interface Props {
  scope: Scope;
  taskId: string;
  taskRevision: string;
  /// Task state from the conversation projection: active work is polled,
  /// because a recorded step does not change the Task revision.
  taskState: string;
  session: Session;
  accessReady: boolean;
  onAccessFailure: (error?: AccessError) => void;
}

const statusLabel: Record<string, string> = {
  proposed: 'Proposed tools', responded: 'Responded', superseded: 'Superseded by newer guidance', failed: 'Did not complete',
  completed: 'Completed', refused: 'Refused at admission', reconciliation_required: 'Reconciliation required',
};

/// Recorded work facts only. Model output is never rendered here: it is
/// attributed data that grants no authority, and this view shows no invented progress.
export const WORK_POLL_MS = 3000;

export function TaskWorkPanel({ scope, taskId, taskRevision, taskState, session, accessReady, onAccessFailure }: Props) {
  const [work, setWork] = useState<TaskWork | null>(null);
  const [error, setError] = useState('');
  const [tick, setTick] = useState(0);
  const active = taskState === 'ready' || taskState === 'running';
  useEffect(() => {
    if (!accessReady || !active) return;
    const timer = setInterval(() => setTick(value => value + 1), WORK_POLL_MS);
    return () => clearInterval(timer);
  }, [accessReady, active]);
  useEffect(() => {
    if (!accessReady) { setWork(null); return; }
    const request = new AbortController();
    // Cleanup aborts are ownership changes; only the deadline is a failed read.
    let timedOut = false;
    const deadline = setTimeout(() => { timedOut = true; request.abort(); }, 8000);
    readTaskWork(scope, taskId, session, request.signal).then(value => {
      if (!request.signal.aborted) { setWork(value); setError(''); }
    }, reason => {
      if (request.signal.aborted && !timedOut && !(reason instanceof AccessError)) return;
      setWork(null); setError('Current work could not be loaded.');
      if (reason instanceof AccessError && [401, 403, 404, 412].includes(reason.status)) onAccessFailure(reason);
    }).finally(() => clearTimeout(deadline));
    return () => { request.abort(); clearTimeout(deadline); };
  }, [scope, taskId, taskRevision, session, accessReady, onAccessFailure, tick]);
  if (error) return <section className="task-work" aria-label="Current work"><h3>Current work</h3><p role="alert">{error}</p></section>;
  if (!work) return <section className="task-work" aria-label="Current work"><h3>Current work</h3><p role="status">Loading current work…</p></section>;
  const attention = attentionLabel(work.attention);
  const recent = work.steps.slice(-8);
  return <section className="task-work" aria-label="Current work">
    <h3>Current work</h3>
    {!work.model_available ? <p className="work-unavailable">Model unavailable · no qualified profile is selectable for this engagement. This Task stays inert; nothing is sent to a model.</p> : null}
    <dl className="work-summary">
      <div><dt>Bound method</dt><dd>{work.methodology_binding_id ? <>{work.methodology_status ?? 'Bound'} · <abbr title={work.methodology_binding_id}>{work.methodology_binding_id.slice(0, 8)}</abbr></> : 'Not bound'}</dd></div>
      <div><dt>Current work</dt><dd>{work.current_work ?? 'No step recorded yet'}</dd></div>
      <div><dt>Next action</dt><dd>{nextActionLabel(work.next_action)}{work.next_action_invocation_id ? <> · proposed by invocation <abbr title={work.next_action_invocation_id}>{work.next_action_invocation_id.slice(0, 8)}</abbr></> : null}</dd></div>
    </dl>
    {attention ? <p className="work-attention" role="status">{attention}</p> : null}
    {recent.length ? <details className="work-steps"><summary>Recorded steps ({work.total_steps})</summary>
      {work.total_steps > recent.length ? <p className="work-omitted">{work.total_steps - recent.length} earlier {work.total_steps - recent.length === 1 ? 'step is' : 'steps are'} omitted here; the most recent {recent.length} are shown.</p> : null}<ol>
      {recent.map(step => <li key={step.ordinal}><span>Step {step.ordinal + 1}</span> · {step.current_work} · {statusLabel[step.status]}{step.knowledge_omitted ? ` · ${step.knowledge_omitted} knowledge ${step.knowledge_omitted === 1 ? 'record' : 'records'} left out of context` : ''}{step.invocation_id ? <> · invocation <abbr title={step.invocation_id}>{step.invocation_id.slice(0, 8)}</abbr></> : null}</li>)}
    </ol></details> : null}
    <details className="brief-revisions"><summary>Brief revisions ({work.briefs.length})</summary><ol>
      {work.briefs.map(brief => <li key={brief.command_id}>
        <p className="retained-text">{brief.content}</p>
        <p className="brief-status">Received · {brief.applied_boundary === null ? 'Not yet applied' : brief.applied_boundary === 0 ? 'Applied before the first step' : `Applied at the boundary before step ${brief.applied_boundary + 1}`}{brief.superseded_by ? ' · Superseded' : ' · Current'}</p>
      </li>)}
    </ol></details>
  </section>;
}
