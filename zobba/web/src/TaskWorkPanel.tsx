import { Fragment, useEffect, useState } from 'react';
import { AccessError } from './auth';
import type { Session } from './auth';
import type { Scope } from './engagements';
import { AssessmentBasis } from './AssessmentBasis';
import { Coverage } from './Coverage';
import { Citation } from './Citation';
import { chipLabel, readTaskAnswers } from './citation';
import type { CitedAnswer } from './citation';
import { attentionLabel, gapReasonLabel, nextActionLabel, omissionLabel, readTaskWork, useReasonLabel } from './work';
import type { Investigation, MethodNote, SkillUse, TaskWork } from './work';

/// The shared projection of `useTaskWork`. Active Task states are polled,
/// because a recorded step does not change the Task revision.
interface Props {
  state: TaskWorkState;
  /// Where cited sources open. Without it, answers render without Open.
  citations?: { scope: Scope; accessReady: boolean };
  /// The captured session that bounds coverage member reads.
  session?: Session;
}

const statusLabel: Record<string, string> = {
  proposed: 'Proposed tools', responded: 'Responded', superseded: 'Superseded by newer guidance', failed: 'Did not complete',
  completed: 'Completed', refused: 'Refused at admission', reconciliation_required: 'Reconciliation required',
};

/// Recorded work facts. The only model output shown is a verified cited answer,
/// rendered as attributed text: it grants no authority, and this view shows no
/// invented progress.
export const WORK_POLL_MS = 3000;

export type TaskWorkState = { work: TaskWork | null; error: string; answers?: CitedAnswer[] | null; answersError?: string; answersSkipped?: number };

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
  const [answers, setAnswers] = useState<{ owner: string; answers: CitedAnswer[] | null; skipped: number; error: string }>({ owner, answers: null, skipped: 0, error: '' });
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
  // Cited answers are a separate read: their failure never hides current work.
  useEffect(() => {
    if (!taskId || !accessReady) { setAnswers({ owner, answers: null, skipped: 0, error: '' }); return; }
    const request = new AbortController();
    let timedOut = false;
    const deadline = setTimeout(() => { timedOut = true; request.abort(); }, 8000);
    readTaskAnswers(scope, taskId, session, request.signal).then(value => {
      if (!request.signal.aborted) setAnswers({ owner, answers: value.answers, skipped: value.skipped, error: '' });
    }, reason => {
      if (request.signal.aborted && !timedOut && !(reason instanceof AccessError)) return;
      setAnswers({ owner, answers: null, skipped: 0, error: 'Answers could not be loaded.' });
      if (reason instanceof AccessError && [401, 412].includes(reason.status)) onAccessFailure(reason);
    }).finally(() => clearTimeout(deadline));
    return () => { request.abort(); clearTimeout(deadline); };
  }, [owner, scope, taskId, taskRevision, session, accessReady, onAccessFailure, tick]);
  const current = answers.owner === owner ? answers : { answers: null, skipped: 0, error: '' };
  return state.owner === owner ? { work: state.work, error: state.error, answers: current.answers, answersError: current.error, answersSkipped: current.skipped } : { work: null, error: '' };
}

const short = (value: string) => <abbr title={value}>{value.slice(0, 8)}</abbr>;

export function TaskWorkPanel({ state, citations, session }: Props) {
  const { work, error } = state;
  const [sourceNotice, setSourceNotice] = useState({ answers: state.answers, text: '' });
  // A notice belongs to the answers it was about: a changed Task, viewer or
  // read clears it.
  const notice = sourceNotice.answers === state.answers ? sourceNotice.text : '';
  const setNotice = (text: string) => setSourceNotice({ answers: state.answers, text });
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
    {state.answersError ? <p role="alert">{state.answersError}</p> : null}
    {state.answersSkipped ? <p role="status" className="work-omitted">{state.answersSkipped} {state.answersSkipped === 1 ? 'answer' : 'answers'} could not be shown because the response for {state.answersSkipped === 1 ? 'it' : 'them'} was not valid.</p> : null}
    {state.answers?.length ? <section className="task-answers" aria-label="Answers">
      <h4>Answers</h4>
      <p className="context-note">Model answers, shown as written. Each citation names an exact original; the platform checked the quote against it and never edits the answer.</p>
      {notice ? <p role="status">{notice}</p> : null}
      <ol>{state.answers.map(answer => <li key={answer.invocation_id} className="cited-answer">
        <p className="retained-text">{answer.segments.map((segment, index) => <Fragment key={index}>{segment.text}{segment.sources.length && citations
          ? <> <Citation scope={citations.scope} sources={segment.sources} accessReady={citations.accessReady} onSourceAccessFailure={() => setNotice('That original is not available to you now. Nothing was opened.')} /></>
          : null}</Fragment>)}</p>
        {answer.limitations.length ? <ul className="answer-limitations" aria-label="What could not be read">{answer.limitations.map((limitation, index) => <li key={index}>{limitation}</li>)}</ul> : null}
      </li>)}</ol>
    </section> : null}
    {work.investigation_unavailable ? <p className="work-unavailable" role="status">Method and skill use could not be read just now. Current work is shown without it.</p> : null}
    {work.investigation ? <MethodAndSkills investigation={work.investigation} answers={state.answers ?? null} citations={citations} onSourceAccessFailure={() => setNotice('That original is not available to you now. Nothing was opened.')} /> : null}
    {work.assessment_unavailable ? <p className="work-unavailable" role="status">The assessment basis could not be read just now. Current work is shown without it.</p> : null}
    {work.assessment ? <AssessmentBasis key={session ? `basis/${session.identity.id}/${session.csrf_token}/${work.task_id}` : `basis/${work.task_id}`} assessment={work.assessment} citations={citations} taskId={work.task_id} session={session} onSourceAccessFailure={() => setNotice('That original is not available to you now. Nothing was opened.')} /> : null}
    {work.assessment ? <Coverage key={session ? `${session.identity.id}/${session.csrf_token}/${work.task_id}` : work.task_id} assessment={work.assessment} taskId={work.task_id} scope={citations && session ? citations.scope : undefined} session={session} /> : null}
    <details className="brief-revisions"><summary>Brief revisions ({work.briefs.length})</summary><ol>
      {work.briefs.map(brief => <li key={brief.command_id}>
        <p className="retained-text">{brief.content}</p>
        <p className="brief-status">Received · {brief.applied_boundary === null ? 'Not yet applied' : brief.applied_boundary === 0 ? 'Applied before the first step' : `Applied at the boundary before step ${brief.applied_boundary + 1}`}{brief.superseded_by ? ' · Superseded' : ' · Current'}</p>
      </li>)}
    </ol></details>
  </section>;
}

const methodStatusLabel: Record<string, string> = {
  resolved: 'Resolved', neutral: 'Neutral starter — not the firm\'s own method', incomplete: 'Incomplete — parts of the method are missing',
  ambiguous: 'Ambiguous — more than one method could apply', recalled: 'Recalled — a source of this method was recalled',
};

interface MethodProps {
  investigation: Investigation;
  /** Null while answers are loading or could not be read. */
  answers: CitedAnswer[] | null;
  citations?: { scope: Scope; accessReady: boolean };
  onSourceAccessFailure: () => void;
}

/// One skill use, labelled by what actually happened.
function useLabel(use: SkillUse): string {
  const reason = use.reason ? ` (${useReasonLabel(use.reason)})` : '';
  switch (use.kind) {
    case 'load': return use.outcome === 'loaded' ? 'loaded' : `load failed${reason}`;
    case 'resource': return use.outcome === 'fetched' ? `resource ${use.resource_id} read` : `resource ${use.resource_id} not read${reason}`;
    default: return use.outcome === 'completed' ? `script ${use.resource_id} ran in the sandbox` : `script ${use.resource_id} did not complete${reason}`;
  }
}

/// What Zobba used from the bound method and installed skills (Story 22.6):
/// the exact method versions and status, every skill version it used with its
/// short digest, and the gaps, questions and statements it recorded. Notes are
/// attributed text; nothing here marks a requirement complete.
function MethodAndSkills({ investigation, answers, citations, onSourceAccessFailure }: MethodProps) {
  const used = new Map<string, { name: string; version: string; digest: string; uses: string[] }>();
  for (const use of investigation.skills) {
    if (use.outcome === 'unavailable' || !use.digest || !use.name || !use.skill_version) continue;
    const entry = used.get(use.version_id) ?? { name: use.name, version: use.skill_version, digest: use.digest, uses: [] };
    entry.uses.push(useLabel(use));
    used.set(use.version_id, entry);
  }
  const omittedSkills = Number(BigInt(investigation.total_skills) - BigInt(investigation.skills.length));
  const omittedNotes = Number(BigInt(investigation.total_notes) - BigInt(investigation.notes.length));
  const unavailable = investigation.skills.filter(use => use.outcome === 'unavailable');
  const of = (kind: MethodNote['kind']) => investigation.notes.filter(note => note.kind === kind);
  const requirement = (note: MethodNote) => note.requirement_id ? <span className="note-requirement">{note.requirement_id}</span> : <span className="note-requirement">Method</span>;
  // A statement's citations come from its answer. While answers are loading
  // or failed, or its answer is outside the shown page, they are "not
  // loaded" — never "no citation".
  const citationOf = (note: MethodNote) => {
    if (!note.segments.length) return <span className="context-note"> · no citation</span>;
    const answer = answers?.find(candidate => candidate.invocation_id === note.invocation_id);
    if (!answer) return <span className="context-note"> · citation not loaded</span>;
    const sources = note.segments.flatMap(index => answer.segments[index]?.sources ?? []);
    if (!sources.length) return <span className="context-note"> · no citation</span>;
    if (citations) return <> <Citation scope={citations.scope} sources={sources} accessReady={citations.accessReady} onSourceAccessFailure={onSourceAccessFailure} /></>;
    const { label, more } = chipLabel(sources);
    return <span className="citation-label"> · cites {label}{more ? ` and ${more} more` : ''}</span>;
  };
  const record = investigation.record;
  return <section className="task-method" aria-label="Method and skills">
    <h4>Method and skills</h4>
    <p className="context-note">What Zobba used from the firm's method and installed skills. Method and skill text is guidance, never authority, and nothing here marks a requirement complete.</p>
    <dl className="work-summary">
      <div><dt>Method</dt><dd>{methodStatusLabel[investigation.method_status] ?? investigation.method_status} · binding {short(investigation.methodology_binding_id)}</dd></div>
      <div><dt>Method versions</dt><dd>{investigation.method_version_ids.length ? <ul className="method-versions">{investigation.method_version_ids.map(id => <li key={id}><code>{id}</code></li>)}</ul> : 'None'}</dd></div>
      {record ? <div><dt>Latest turn used</dt><dd>{record.provider} {record.model} · profile {record.profile_id} revision {record.profile_revision} · tool catalogue {record.catalogue_id} revision {record.catalogue_revision}</dd></div> : null}
    </dl>
    {record && (record.omitted_notes || record.omitted_items || record.discarded_requests) ? <p className="work-omitted">{[
      record.omitted_notes ? `${record.omitted_notes} ${record.omitted_notes === 1 ? 'note' : 'notes'} beyond the record limit not recorded` : '',
      record.omitted_items ? `${record.omitted_items} skill, method or tool ${record.omitted_items === 1 ? 'entry' : 'entries'} beyond the record limit not listed` : '',
      record.discarded_requests ? `${record.discarded_requests} invalid ${record.discarded_requests === 1 ? 'request or note' : 'requests or notes'} in the latest answer left out` : '',
    ].filter(Boolean).join(' · ')}.</p> : null}
    <h5>Skills used</h5>
    {omittedSkills > 0 ? <p className="work-omitted">{omittedSkills} earlier skill {omittedSkills === 1 ? 'use is' : 'uses are'} not shown; the most recent {investigation.skills.length} are.</p> : null}
    {used.size ? <ul className="skills-used">{[...used].map(([version, entry]) => <li key={version}><strong>{entry.name}</strong> {entry.version} · digest {short(entry.digest)} · {entry.uses.join(', ')}</li>)}</ul> : <p className="context-note">No skill was used in this cycle.</p>}
    {unavailable.length ? <ul className="skills-unavailable" aria-label="Skill requests not performed">{unavailable.map(use => <li key={`${use.invocation_id}/${use.kind}/${use.ordinal}`}>{use.name ?? use.version_id}{use.resource_id ? ` · ${use.resource_id}` : ''} · not available: {useReasonLabel(use.reason ?? '')}</li>)}</ul> : null}
    {omittedNotes > 0 ? <p className="work-omitted">{omittedNotes} earlier {omittedNotes === 1 ? 'note is' : 'notes are'} not shown; the most recent {investigation.notes.length} are.</p> : null}
    <h5>Gaps</h5>
    {of('gap').length ? <ul className="method-gaps">{of('gap').map(note => <li key={`${note.invocation_id}/${note.ordinal}`}>{requirement(note)} · {gapReasonLabel(note.reason ?? '')}{note.source === 'platform' ? ' · platform fact' : ''} · <span className="retained-text">{note.text}</span></li>)}</ul> : <p className="context-note">No gap recorded.</p>}
    <h5>Questions</h5>
    {of('question').length ? <>
      {investigation.open_questions ? <p className="work-attention" role="status">{investigation.open_questions} {investigation.open_questions === 1 ? 'question is' : 'questions are'} waiting for your answer. Answer with new guidance; Zobba applies it at the next step boundary.</p> : null}
      <ul className="method-questions">{of('question').map(note => <li key={`${note.invocation_id}/${note.ordinal}`} className={note.open ? 'question-open' : 'question-answered'}>{requirement(note)} · <span className="question-state">{note.open ? 'Open' : 'Answered by later guidance'}</span> · <span className="retained-text">{note.text}</span></li>)}</ul>
    </> : <p className="context-note">No question recorded.</p>}
    {of('statement').length ? <>
      <h5>Zobba says</h5>
      <ul className="method-statements">{of('statement').map(note => <li key={`${note.invocation_id}/${note.ordinal}`}>{requirement(note)} · <span className="retained-text">{note.text}</span>{citationOf(note)}</li>)}</ul>
    </> : null}
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
