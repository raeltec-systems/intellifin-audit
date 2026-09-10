'use client';

import { useRef } from 'react';

import type { SectionState } from './section-summary';

/** The word beside each step. Never a colour on its own (DESIGN.md). */
const MARK_WORDS: Readonly<Record<SectionState, string>> = {
  done: 'Set',
  todo: 'To do',
  attention: 'Check this',
  reference: 'From the Template',
};

/**
 * One step of the Builder: a line saying what is set, and the editor behind it.
 *
 * It is a native `<details>`, so it opens and closes before React hydrates and with a
 * keyboard — the standing rule that a control must never depend on hydration.
 *
 * Whether it starts open is decided ONCE, on the first render, and after that the
 * element belongs to the reader. React is never told about a toggle, so it never writes
 * `open` again: a controlled `open` would slam a section shut under somebody reading the
 * banner of the save that just turned "To do" into "Set", and — worse — would close a
 * step opened before hydration the moment anything else on the page re-rendered.
 */
export function BuilderStep({
  number,
  title,
  question,
  line,
  state,
  heading,
  initiallyOpen,
  children,
}: {
  readonly number: number;
  readonly title: string;
  readonly question: string;
  readonly line: string;
  readonly state: SectionState;
  /** The domain's own section heading, so a test or a link can address this step. */
  readonly heading: string;
  readonly initiallyOpen: boolean;
  readonly children: React.ReactNode;
}): React.JSX.Element {
  // `useRef(...).current`, not state: the value must be read once and then never
  // re-applied. `initiallyOpen` legitimately changes when a save answers this step.
  const startsOpen = useRef(initiallyOpen).current;
  return (
    <details className="ls-step" data-step={heading} data-step-state={state} open={startsOpen}>
      <summary className="ls-step__summary">
        <span className="ls-step__number" aria-hidden="true">
          {number}
        </span>
        <span className="ls-step__head">
          <span className="ls-step__title">{title}</span>
          <span className="ls-step__line">{line}</span>
        </span>
        <span className={`ls-step__mark ls-step__mark--${state}`}>{MARK_WORDS[state]}</span>
      </summary>
      <div className="ls-step__body ls-stack">
        <p className="ls-step__question">{question}</p>
        {children}
      </div>
    </details>
  );
}
