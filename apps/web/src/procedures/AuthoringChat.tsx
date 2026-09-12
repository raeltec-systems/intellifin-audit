'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Button } from '../design/Button';

/** The thread scrolls independently of the page. Reading earlier messages pauses
 * follow-along; a new message sent by this auditor returns to the latest turn. */
export function AuthoringChat({ children, composer, busy, requestId }: {
  readonly children: ReactNode; readonly composer: ReactNode;
  readonly busy: boolean; readonly requestId: string | undefined;
}): React.JSX.Element {
  const thread = useRef<HTMLDivElement>(null), follows = useRef(true);
  const previousRequest = useRef(requestId);
  const size = useRef({ width: 0, height: 0 });
  const [away, setAway] = useState(false);
  useEffect(() => {
    const node = thread.current;
    if (!node) return;
    if (requestId !== previousRequest.current) { follows.current = true; previousRequest.current = requestId; setAway(false); }
    if (follows.current) node.scrollTop = node.scrollHeight;
  }, [children, requestId]);
  useEffect(() => {
    const node = thread.current;
    if (!node) return;
    const resize = () => {
      size.current = { width: node.clientWidth, height: node.clientHeight };
      if (follows.current) node.scrollTop = node.scrollHeight;
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  return <div className="ls-chat">
    <div className="ls-chat__thread" ref={thread} role="log" aria-label="Conversation with IntelliFin"
      aria-live="polite" aria-relevant="additions" aria-busy={busy} tabIndex={0}
      onScroll={() => {
        const node = thread.current!;
        // Reflow on a viewport/keyboard resize is not the reader scrolling back.
        if (size.current.width !== node.clientWidth || size.current.height !== node.clientHeight) {
          size.current = { width: node.clientWidth, height: node.clientHeight };
          if (follows.current) node.scrollTop = node.scrollHeight;
          return;
        }
        follows.current = node.scrollHeight - node.scrollTop - node.clientHeight < 64;
        setAway(!follows.current);
      }}>
      {children}
    </div>
    {away ? <div className="ls-chat__latest"><Button type="button" onClick={() => {
      follows.current = true; setAway(false); if (thread.current) thread.current.scrollTop = thread.current.scrollHeight;
    }}>Jump to latest</Button></div> : null}
    {composer}
  </div>;
}

export function ChatMessage({ from, children, pending = false }: {
  readonly from: 'auditor' | 'assistant'; readonly children: ReactNode; readonly pending?: boolean;
}): React.JSX.Element {
  return <article className={`ls-chat__message ls-chat__message--${from}`} aria-label={from === 'auditor' ? 'Message from you' : 'Message from IntelliFin'}>
    <div className="ls-chat__byline">{from === 'auditor' ? 'You' : 'IntelliFin'}{pending ? <span className="ls-chat__activity" aria-hidden="true" /> : null}</div>
    <div className="ls-chat__content">{children}</div>
  </article>;
}
