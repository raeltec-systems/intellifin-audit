import { useEffect, useState } from 'react';
import { AccessError } from './auth';
import type { Session } from './auth';
import type { Scope } from './engagements';
import { attentionLabel, nextActionLabel, omissionLabel, readTaskWork } from './work';
import type { TaskWork } from './work';

/// The shared projection of `useTaskWork`. Active Task states are polled,
/// because a recorded step does not change the Task revision.
interface Props {
  state: TaskWorkState;
}

const statusLabel: Record<string, string> = {
  proposed: 'Proposed tools', responded: 'Responded', superseded: 'Superseded by newer guidance', failed: 'Did not complete',
  completed: 'Completed', refused: 'Refused at admission', reconciliation_required: 'Reconciliation required',
};

/// Recorded work facts only. Model output is never rendered here: it is
/// attributed data that grants no authority, and this view shows no invented progress.
export const WORK_POLL_MS = 3000;

export type TaskWorkState = { work: TaskWork | null; error: string };

interface Source {
  scope: Scope;
  /// Null when no Task is selected: nothing is read.
  taskId: string | null;
  taskRevision: string;
  taskState: string;
  session: Session;
  accessReady: boolean;
  onAccessFailure: (error?: AccessError) => void;
}

/// One subscription per selected Task: Current work and the context accounting
/// render the same read, so one poll serves both and they cannot disagree.
/// A changed actor, session or Task discards the previous projection.
export function useTaskWork({ scope, taskId, taskRevision, taskState, session, accessReady, onAccessFailure }: Source): TaskWorkState {
  const owner = taskId ? `${session.identity.id}/${session.csrf_token}/${taskId}` : '';
  const [state, setState] = useState<{ owner: string; work: TaskWork | null; error: string }>({ owner, work: null, error: '' });
  const [tick, setTick] = useState(0);
  const active = taskState === 'ready' || taskState === 'running';
  useEffect(() => {
    if (!taskId || !accessReady || !active) return;
    const timer = setInterval(() => setTick(value => value + 1), WORK_POLL_MS);
    return () => clearInterval(timer);
  }, [taskId, accessReady, active]);
  useEffect(() => {
    if (!taskId || !accessReady) { setState({ owner, work: null, error: '' }); return; }
    const request = new AbortController();
    // Cleanup aborts are ownership changes; only the deadline is a failed read.
    let timedOut = false;
    const deadline = setTimeout(() => { timedOut = true; request.abort(); }, 8000);
    readTaskWork(scope, taskId, session, request.signal).then(value => {
      if (!request.signal.aborted) setState({ owner, work: value, error: '' });
    }, reason => {
      if (request.signal.aborted && !timedOut && !(reason instanceof AccessError)) return;
      setState({ owner, work: null, error: 'Current work could not be loaded.' });
      if (reason instanceof AccessError && [401, 403, 404, 412].includes(reason.status)) onAccessFailure(reason);
    }).finally(() => clearTimeout(deadline));
    return () => { request.abort(); clearTimeout(deadline); };
  }, [owner, scope, taskId, taskRevision, session, accessReady, onAccessFailure, tick]);
  return state.owner === owner ? { work: state.work, error: state.error } : { work: null, error: '' };
}

const short = (value: string) => <abbr title={value}>{value.slice(0, 8)}</abbr>;

export function TaskWorkPanel({ state }: Props) {
  const { work, error } = state;
  if (error) return <section className="task-work" aria-label="Current work"><h3>Current work</h3><p role="alert">{error}</p></section>;
  if (!work) return <section className="task-work" aria-label="Current work"><h3>Current work</h3><p role="status">Loading current work…</p></section>;
  const attention = attentionLabel(work.attention);
  const recent = work.steps;
  return <section className="task-work" aria-label="Current work">
    <h3>Current work</h3>
    {!work.model_available ? <p className="work-unavailable">Model unavailable · no qualified profile is selectable for this engagement. This Task stays inert; nothing is sent to a model.</p> : null}
    <dl className="work-summary">
      <div><dt>Bound method</dt><dd>{work.methodology_binding_id ? <>{work.methodology_status ?? 'Bound'} · {short(work.methodology_binding_id)}</> : 'Not bound'}</dd></div>
      <div><dt>Current work</dt><dd>{work.current_work ?? 'No step recorded yet'}</dd></div>
      <div><dt>Next action</dt><dd>{nextActionLabel(work.next_action)}{work.next_action_invocation_id ? <> · proposed by invocation {short(work.next_action_invocation_id)}</> : null}</dd></div>
    </dl>
    {attention ? <p className="work-attention" role="status">{attention}</p> : null}
    {recent.length ? <details className="work-steps"><summary>Recorded steps ({work.total_steps})</summary>
      {work.total_steps > recent.length ? <p className="work-omitted">{work.total_steps - recent.length} earlier {work.total_steps - recent.length === 1 ? 'step is' : 'steps are'} omitted here; the most recent {recent.length} are shown.</p> : null}<ol>
      {recent.map(step => <li key={step.ordinal}><span>Step {step.ordinal + 1}</span> · {step.current_work} · {statusLabel[step.status]}{step.reason === 'context_budget' ? ' · not sent: context budget' : ''}{step.knowledge_omitted ? ` · ${step.knowledge_omitted} knowledge ${step.knowledge_omitted === 1 ? 'record' : 'records'} left out of context` : ''}{step.invocation_id ? <> · invocation {short(step.invocation_id)}</> : null}</li>)}
    </ol></details> : null}
    <details className="brief-revisions"><summary>Brief revisions ({work.briefs.length})</summary><ol>
      {work.briefs.map(brief => <li key={brief.command_id}>
        <p className="retained-text">{brief.content}</p>
        <p className="brief-status">Received · {brief.applied_boundary === null ? 'Not yet applied' : brief.applied_boundary === 0 ? 'Applied before the first step' : `Applied at the boundary before step ${brief.applied_boundary + 1}`}{brief.superseded_by ? ' · Superseded' : ' · Current'}</p>
      </li>)}
    </ol></details>
  </section>;
}

/// Server time in UTC; the instant itself is kept in the element's datetime.
const recordedAt = (seconds: string) => { const instant = new Date(Number(seconds) * 1000).toISOString(); return <time dateTime={instant}>{instant.replace('T', ' ').replace('.000Z', ' UTC')}</time>; };

const sourceLabel: Record<string, string> = { current: 'current', withdrawn: 'withdrawn · stale', corrected: 'corrected · stale', invalidated: 'invalidated · stale' };

/// What the latest turn's context was built from: the budget accounting,
/// deterministic compaction records (platform facts, never a model summary or
/// evidence), omissions and stale sources. Raw steps remain listed under
/// Current work and are never altered by compaction.
export function TaskContextUse({ state }: Props) {
  const { work, error } = state;
  if (error) return <section className="task-context" aria-label="Context of recent turns"><h4>Context of recent turns</h4><p role="alert">Context accounting could not be loaded.</p></section>;
  if (!work) return <section className="task-context" aria-label="Context of recent turns"><h4>Context of recent turns</h4><p role="status">Loading context accounting…</p></section>;
  const turn = [...work.steps].reverse().find(step => step.kind === 'model_turn');
  return <section className="task-context" aria-label="Context of recent turns"><h4>Context of recent turns</h4>
    {turn?.reason === 'context_budget' ? <p className="work-attention" role="status">The latest turn was not sent: the objective, method, brief and unresolved decisions alone exceed the context budget.</p> : null}
    {turn?.estimated_input_tokens ? <p className="context-budget">Latest turn · estimated {turn.estimated_input_tokens} input tokens (conservative) · {turn.actual_input_tokens ? `provider reported ${turn.actual_input_tokens}` : 'provider count not reported'}</p> : null}
    {work.compactions.length ? <>
      <p className="context-note">Older steps are represented by fact digests below. A digest lists recorded step facts and the knowledge revisions used; it contains no model or source text and is not evidence. An omission never means that material is absent.</p>
      {work.total_compactions > work.compactions.length ? <p className="work-omitted">{work.total_compactions - work.compactions.length} earlier compaction {work.total_compactions - work.compactions.length === 1 ? 'record is' : 'records are'} not shown.</p> : null}
      <ol className="compaction-records">{work.compactions.map(record => <li key={record.sequence}>
        <p>Steps {record.first_ordinal + 1}–{record.last_ordinal + 1} compacted · record {record.sequence + 1} · made {recordedAt(record.created_at)} · digest {short(record.digest_sha256)} · estimated {record.estimated_tokens} tokens</p>
        {record.sources.length ? <ul className="compaction-sources">{record.sources.map(source => <li key={`${source.id}/${source.revision}`} className={source.status === 'current' ? '' : 'stale-source'}>Knowledge {short(source.id)} revision {source.revision} · {sourceLabel[source.status]}</li>)}</ul> : null}
        {record.omissions.length ? <ul className="compaction-omissions">{record.omissions.map(omission => <li key={omission.category}>{omissionLabel(omission.category)}: {omission.count}</li>)}</ul> : null}
      </li>)}</ol>
    </> : <p className="context-note">No compaction: recent turns carried every recorded step of this cycle.</p>}
  </section>;
}
