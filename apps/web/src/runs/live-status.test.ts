import { describe, expect, it } from 'vitest';

import { LIVE_LOST_MS, LIVE_SENTENCES, LIVE_STALE_MS, LIVE_STATUSES, liveSentence, liveStatus, parseLiveCursor, silenceSeconds } from './live-status';

describe('the live status machine', () => {
  const base = { ended: false, everConnected: true, lastMessageAt: 100_000 };

  it('is live under 15 seconds of silence, stale from 15, lost from 60', () => {
    expect(liveStatus({ ...base, now: 100_000 })).toBe('live');
    expect(liveStatus({ ...base, now: 100_000 + LIVE_STALE_MS - 1 })).toBe('live');
    expect(liveStatus({ ...base, now: 100_000 + LIVE_STALE_MS })).toBe('stale');
    expect(liveStatus({ ...base, now: 100_000 + LIVE_LOST_MS - 1 })).toBe('stale');
    expect(liveStatus({ ...base, now: 100_000 + LIVE_LOST_MS })).toBe('lost');
  });

  it('is connecting until the first frame, and the same thresholds apply while connecting', () => {
    expect(liveStatus({ ...base, everConnected: false, now: 100_000 })).toBe('connecting');
    expect(liveStatus({ ...base, everConnected: false, now: 100_000 + LIVE_STALE_MS })).toBe('stale');
  });

  it('an ended stream is ended whatever the clock says', () => {
    expect(liveStatus({ ...base, ended: true, now: 100_000 })).toBe('ended');
    expect(liveStatus({ ...base, ended: true, now: 100_000 + LIVE_LOST_MS })).toBe('ended');
  });

  it('a clock that went backwards is not silence', () => {
    expect(liveStatus({ ...base, now: 99_000 })).toBe('live');
    expect(silenceSeconds(100_000, 99_000)).toBe(0);
    expect(silenceSeconds(100_000, 117_400)).toBe(17);
  });

  it('has a sentence for every status, and the stale one names the seconds', () => {
    for (const status of LIVE_STATUSES) expect(LIVE_SENTENCES[status].length).toBeGreaterThan(10);
    expect(liveSentence('stale', 17)).toBe('No update for 17 seconds. The page may be behind the Run.');
    expect(liveSentence('lost', 90)).toBe('Connection to the Run lost. Reconnecting.');
  });
});

describe('the live cursor', () => {
  const at = (query: string): URL => new URL(`https://audit.example.test/api/runs/r/events${query}`);

  it('reads Last-Event-ID, then after, then 0', () => {
    // A reconnect carries the page's original query AND the header naming the last
    // frame it saw; only the header is current, so it wins.
    expect(parseLiveCursor(at('?after=12'), '15')).toBe(15);
    expect(parseLiveCursor(at('?after=12'), null)).toBe(12);
    expect(parseLiveCursor(at('?after=12'), '')).toBe(12);
    expect(parseLiveCursor(at(''), '5')).toBe(5);
    expect(parseLiveCursor(at(''), null)).toBe(0);
    expect(parseLiveCursor(at('?after='), null)).toBe(0);
  });

  it('refuses anything that is not a non-negative safe integer', () => {
    for (const bad of ['-1', '1.5', 'abc', '01', ' 3', '99999999999999999', '9007199254740993']) {
      expect(parseLiveCursor(at(`?after=${encodeURIComponent(bad)}`), null)).toBeNull();
    }
    expect(parseLiveCursor(at(''), 'x')).toBeNull();
  });
});
