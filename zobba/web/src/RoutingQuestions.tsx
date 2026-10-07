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

/// Durable targeting questions. Nothing is applied until the person chooses
/// targets; each chosen Task receives its own Guide with its own receipt.
export function RoutingQuestions({ scope, session, accessReady, onAccessFailure, latest }: Props) {
  const [questions, setQuestions] = useState<RoutingQuestion[]>([]);
  const [selected, setSelected] = useState<Record<string, string[]>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const owner = useRef(`${session.identity.id}/${scope.engagement_id}`);
  useEffect(() => {
    if (!accessReady) return;
    const request = new AbortController();
    readQuestions(scope, session, request.signal).then(found => {
      if (!request.signal.aborted) setQuestions(current => merge(current, found));
    }, reason => {
      if (reason instanceof AccessError && [401, 403, 404, 412].includes(reason.status)) onAccessFailure(reason);
    });
    return () => request.abort();
  }, [scope, session, accessReady, onAccessFailure]);
  useEffect(() => { if (latest) setQuestions(current => merge(current, [latest])); }, [latest]);
  useEffect(() => { owner.current = `${session.identity.id}/${scope.engagement_id}`; }, [session, scope]);

  async function answer(question: RoutingQuestion) {
    const chosen = selected[question.id] ?? [];
    if (!chosen.length || busy) return;
    setBusy(question.id); setErrors(current => ({ ...current, [question.id]: '' }));
    const request = new AbortController();
    const deadline = setTimeout(() => request.abort(), 8000);
    try {
      const answered = await answerQuestion(scope, session, question.id, chosen, request.signal);
      setQuestions(current => merge(current, [answered]));
    } catch (reason) {
      const conflict = reason instanceof AccessError && reason.status === 409;
      setErrors(current => ({ ...current, [question.id]: conflict
        ? 'A chosen Task has changed or stopped since this question was asked. Nothing was applied; send the direction again.'
        : 'The answer was not confirmed. Sending it again is safe and creates no duplicates.' }));
      if (reason instanceof AccessError && [401, 403, 404, 412].includes(reason.status)) onAccessFailure(reason);
    } finally { clearTimeout(deadline); setBusy(null); }
  }

  const visible = questions.slice(0, 5);
  if (!visible.length) return null;
  return <section className="routing-questions" aria-label="Targeting questions">
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
          <input type="checkbox" checked={(selected[question.id] ?? []).includes(candidate.task_id)} onChange={event => {
            const checked = event.currentTarget.checked;
            setSelected(current => {
              const now = current[question.id] ?? [];
              return { ...current, [question.id]: checked ? [...now, candidate.task_id] : now.filter(id => id !== candidate.task_id) };
            });
          }} /> {candidate.objective}
        </label>)}
        <button type="button" className="quiet-button" disabled={!(selected[question.id] ?? []).length} onClick={() => void answer(question)}>Send to selected Tasks</button>
      </fieldset>}
      {errors[question.id] ? <p role="alert">{errors[question.id]}</p> : null}
    </article>)}
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
