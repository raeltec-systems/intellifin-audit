'use client';

import { useEffect, useId, useRef, type ReactNode } from 'react';

export interface GuidedQuestion {
  readonly id: string;
  readonly label: string;
  readonly question: string;
  readonly content: ReactNode;
}

/** Navigation state only. Each existing editor is mounted once, including while hidden,
 * so moving between questions never discards an edit or its submission guard. */
export function GuidedQuestions({ label, questions, selected, onSelect }: {
  readonly label: string;
  readonly questions: readonly GuidedQuestion[];
  readonly selected: string;
  readonly onSelect: (id: string) => void;
}): React.JSX.Element {
  const id = useId();
  const headings = useRef<Record<string, HTMLHeadingElement | null>>({});
  const first = useRef(true);
  useEffect(() => {
    if (first.current) { first.current = false; return; }
    headings.current[selected]?.focus();
  }, [selected]);
  return <div className="ls-guide-questions ls-stack" data-guided-questions={label}>
    <nav aria-label={label} className="ls-guide-questions__nav">
      {questions.map((question, index) => <button key={question.id} type="button"
        className="ls-guide-questions__choice"
        aria-current={selected === question.id ? 'step' : undefined}
        aria-controls={`${id}-${question.id}`} onClick={() => onSelect(question.id)}>
        {index + 1}. {question.label}
      </button>)}
    </nav>
    {questions.map(question => <div className="ls-guide-question ls-stack" key={question.id}
      id={`${id}-${question.id}`} hidden={question.id !== selected} data-guide-question={question.id}>
      <h3 className="ls-guide-question__heading" tabIndex={-1} ref={node => { headings.current[question.id] = node; }}>{question.question}</h3>
      {question.content}
    </div>)}
  </div>;
}
