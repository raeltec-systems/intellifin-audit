'use client';

import { createContext, useContext } from 'react';

import { chromeDotClass, sessionStripWord, type LiveViewChrome, type SessionConnection } from './live-view';

/**
 * What a subscribed Live View knows about its own connection (Story 10.8).
 *
 * `null` outside one — Replay, Run Detail, and a Run that had already ended when the page
 * was read — and that is the truth: those surfaces have no stream, so there is nothing to
 * reconnect and the strip keeps the Run's own word.
 */
const SessionConnectionContext = createContext<SessionConnection | null>(null);
export const SessionConnectionProvider = SessionConnectionContext.Provider;

/**
 * The strip's dot and word. A client component only because the word depends on the
 * page's live connection, which the server cannot know; the server render and the first
 * client render agree, because the connection starts `connecting`.
 */
export function SessionStateWord({ chrome }: { readonly chrome: LiveViewChrome | null }): React.JSX.Element {
  const word = sessionStripWord(chrome, useContext(SessionConnectionContext));
  return (
    <span className="ls-session__state" aria-hidden="true" data-session-word={word ?? 'NO SESSION'}>
      <span className={word === null ? 'ls-session__dot ls-session__dot--none' : chromeDotClass(word)} />
      {word ?? 'NO SESSION'}
    </span>
  );
}
