import { useEffect, useRef, useState } from 'react';
import { AccessError } from './auth';
import type { Session } from './auth';
import type { Scope } from './engagements';
import { answerQuestion, readQuestions } from './work';
import type { RoutingQuestion } from './work';

interface Props {
  scope: Scope;
  session: Session;
  accessReady: boolean;
  onAccessFailure: (error?: AccessError) => void;
  /// A question just returned by the server for an untargeted direction.
  latest: RoutingQuestion | null;
}

const VISIBLE = 5;
const accessStatus = (reason: unknown) => reason instanceof AccessError && [401, 403, 404, 412].includes(reason.status);

/// One owner: the actor, the exact session and the composite engagement scope.
export function routingOwner(session: Session, scope: Scope): string {
  return JSON.stringify([session.identity.id, session.csrf_token, scope.organisation_id, scope.client_id, scope.engagement_id]);
}

/// Durable targeting questions. Nothing is applied until the person chooses
/// targets; each chosen Task receives its own Guide with its own receipt.
export function RoutingQuestions({ scope, session, accessReady, onAccessFailure, latest }: Props) {
  const owner = routingOwner(session, scope);
  const [state, setState] = useState<{ owner: string; questions: RoutingQuestion[]; hasMore: boolean; readError: string; selected: Record<string, string[]>; errors: Record<string, string> }>(
    () => ({ owner, questions: [], hasMore: false, readError: '', selected: {}, errors: {} }));
  const [busy, setBusy] = useState<string | null>(null);
  const current = useRef(owner); current.current = owner;
  const generation = useRef(0);
  // Another actor, session or engagement never sees, answers or merges into
  // the previous owner's questions; every pending completion is fenced.
  const view = state.owner === owner ? state : { owner, questions: [], hasMore: false, readError: '', selected: {}, errors: {} };
  useEffect(() => {
    generation.current += 1;
    setBusy(null);
    setState({ owner, questions: [], hasMore: false, readError: '', selected: {}, errors: {} });
  }, [owner]);
  const patch = (requestOwner: string, change: (value: typeof state) => typeof state) =>
    setState(value => value.owner === requestOwner && current.current === requestOwner ? change(value) : value);

  useEffect(() => {
    if (!accessReady) return;
    const request = new AbortController();
    const requestOwner = owner, requestGeneration = generation.current;
    const deadline = setTimeout(() => request.abort(), 8000);
    readQuestions(scope, session, request.signal).then(page => {
      if (request.signal.aborted || requestGeneration !== generation.current) return;
      patch(requestOwner, value => ({ ...value, questions: merge(value.questions, page.questions), hasMore: page.has_more, readError: '' }));
    }, reason => {
      if (requestGeneration !== generation.current || current.current !== requestOwner) return;
      if (accessStatus(reason)) { onAccessFailure(reason as AccessError); return; }
      patch(requestOwner, value => ({ ...value, readError: 'Targeting questions could not be loaded. Earlier questions remain unanswered until they load.' }));
    }).finally(() => clearTimeout(deadline));
    return () => { request.abort(); clearTimeout(deadline); };
  }, [scope, session, accessReady, onAccessFailure, owner]);
  useEffect(() => { if (latest) patch(owner, value => ({ ...value, questions: merge(value.questions, [latest]) })); }, [latest, owner]);

  async function answer(question: RoutingQuestion) {
    const chosen = view.selected[question.id] ?? [];
    if (!chosen.length || busy) return;
    const requestOwner = owner, requestGeneration = generation.current;
    setBusy(question.id);
    patch(requestOwner, value => ({ ...value, errors: { ...value.errors, [question.id]: '' } }));
    const request = new AbortController();
    const deadline = setTimeout(() => request.abort(), 8000);
    try {
      const answered = await answerQuestion(scope, session, question.id, chosen, request.signal);
      if (requestGeneration !== generation.current) return;
      patch(requestOwner, value => ({ ...value, questions: merge(value.questions, [answered]) }));
    } catch (reason) {
      if (requestGeneration !== generation.current || current.current !== requestOwner) return;
      const conflict = reason instanceof AccessError && reason.status === 409;
      patch(requestOwner, value => ({ ...value, errors: { ...value.errors, [question.id]: conflict
        ? 'A chosen Task has changed or stopped since this question was asked. Nothing was applied; send the direction again.'
        : 'The answer was not confirmed. Sending it again is safe and creates no duplicates.' } }));
      if (accessStatus(reason)) onAccessFailure(reason as AccessError);
    } finally {
      clearTimeout(deadline);
      if (requestGeneration === generation.current) setBusy(null);
    }
  }

  const visible = view.questions.slice(0, VISIBLE);
  const more = view.hasMore || view.questions.length > VISIBLE;
  if (!visible.length && !view.readError) return null;
  return <section className="routing-questions" aria-label="Targeting questions">
    {view.readError ? <p role="alert">{view.readError}</p> : null}
    {visible.map(question => <article key={question.id} className="routing-question" aria-label={`Which Task should receive: ${question.content}`}>
      <p className="retained-text">{question.content}</p>
      {question.answer ? <>
        <p>Sent as guidance to {question.answer.length === 1 ? 'one Task' : `${question.answer.length} Tasks`}:</p>
        <ul className="routed-receipts">{question.answer.map(guide => <li key={guide.command_id}>
          Received for <strong>{question.candidates.find(c => c.task_id === guide.task_id)?.objective ?? guide.task_id}</strong> · receipt {guide.event_cursor}
        </li>)}</ul>
      </> : <fieldset disabled={!accessReady || busy === question.id}>
        <legend>Which Task should receive this guidance? Choose one or more.</legend>
        {question.candidates.map(candidate => <label key={candidate.task_id} className="routing-candidate">
          <input type="checkbox" checked={(view.selected[question.id] ?? []).includes(candidate.task_id)} onChange={event => {
            const checked = event.currentTarget.checked;
            patch(owner, value => {
              const now = value.selected[question.id] ?? [];
              return { ...value, selected: { ...value.selected, [question.id]: checked ? [...now, candidate.task_id] : now.filter(id => id !== candidate.task_id) } };
            });
          }} /> {candidate.objective}
        </label>)}
        <button type="button" className="quiet-button" disabled={!(view.selected[question.id] ?? []).length} onClick={() => void answer(question)}>Send to selected Tasks</button>
      </fieldset>}
      {view.errors[question.id] ? <p role="alert">{view.errors[question.id]}</p> : null}
    </article>)}
    {more ? <p className="routing-more" role="status">More targeting questions exist than are shown here.</p> : null}
  </section>;
}

function merge(current: RoutingQuestion[], found: RoutingQuestion[]): RoutingQuestion[] {
  const result = [...current];
  for (const question of found) {
    const index = result.findIndex(item => item.id === question.id);
    if (index === -1) result.unshift(question); else result[index] = question;
  }
  return result;
}
