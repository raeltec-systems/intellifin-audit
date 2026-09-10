import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import { STALE_DATA_ACTION, updatedAtTitle } from '../design/copy';
import { utcStamp } from './labels';
import { LIVE_SENTENCES } from './live-status';

vi.mock('next/navigation', () => ({ useRouter: () => ({ refresh: () => undefined }) }));

import { LiveBanner } from './LiveBanner';
import { changesOpenWaits } from '../shell/BellLive';

describe('LiveBanner', () => {
  it('renders the read instant, the connecting state and the no-JavaScript refresh link before any frame arrives', () => {
    const readAt = '2026-09-09T06:00:00.000Z';
    const html = renderToStaticMarkup(
      React.createElement(LiveBanner, { url: '/api/runs/r/events', cursor: 3, readAt, href: '/runs/r' }),
    );
    expect(html).toContain(updatedAtTitle(utcStamp(new Date(readAt))));
    expect(html).toContain('data-live-status="connecting"');
    expect(html).toContain('data-live-seq="3"');
    expect(html).toContain(LIVE_SENTENCES.connecting);
    expect(html).toContain(`href="/runs/r"`);
    expect(html).toContain(STALE_DATA_ACTION);
    // Only the status WORD is live-announced; the counting sentence is not.
    expect(html).toContain('aria-live="polite">Connecting<');
    expect(html).toContain('ls-banner--info');
  });
});

describe('the bell refreshes only on what changes an open item', () => {
  it('names the escalation events, the flag and the two ways a Run ends, and nothing else', () => {
    for (const type of [
      'execution.escalation-raised', 'execution.escalation-answered', 'execution.escalation-timeout',
      // Story 5.5: a flag becomes an open item, and a Run ending closes one.
      'lifecycle.run-flagged', 'lifecycle.run-canceled', 'lifecycle.result-sealed',
    ]) {
      expect(changesOpenWaits(type)).toBe(true);
    }
    for (const type of [
      'execution.observations-registered', 'lifecycle.run-queued', 'security.action-denied',
      // A pause holds a Run in PAUSED, which is ACTIVE, so neither count moves.
      'lifecycle.run-paused', 'lifecycle.run-resumed', 'lifecycle.run-pause-requested',
    ]) {
      expect(changesOpenWaits(type)).toBe(false);
    }
  });
});
