import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { SessionConnectionProvider, SessionStateWord } from './SessionStateWord';

const render = (connection: React.ComponentProps<typeof SessionConnectionProvider>['value'], chrome: 'LIVE' | 'REPLAY' | null): string =>
  renderToStaticMarkup(
    React.createElement(SessionConnectionProvider, { value: connection }, React.createElement(SessionStateWord, { chrome })),
  );

describe('the session strip word (Story 10.8)', () => {
  it('shows RECONNECTING with its own dot while the provider says the connection is lost', () => {
    const html = render({ status: 'lost', runEnded: false }, 'LIVE');
    expect(html).toContain('>RECONNECTING</span>');
    expect(html).toContain('ls-session__dot--reconnecting');
    expect(html).not.toContain('ls-session__dot--live');
    expect(html).toContain('data-session-word="RECONNECTING"');
  });

  it('keeps the Run\'s word while connected, and outside any live page', () => {
    expect(render({ status: 'live', runEnded: false }, 'LIVE')).toContain('>LIVE</span>');
    expect(render(null, 'LIVE')).toContain('>LIVE</span>');
    expect(render(null, null)).toContain('>NO SESSION</span>');
    expect(render({ status: 'lost', runEnded: false }, 'REPLAY')).toContain('>REPLAY</span>');
  });
});
