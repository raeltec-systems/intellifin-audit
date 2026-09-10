import { describe, expect, it } from 'vitest';

import { LIVE_GATE_REASONS, LIVE_LOST_MS, LIVE_SENTENCES, LIVE_STALE_MS, LIVE_STATUSES, RUN_ENDING_EVENTS, isRunEndingEvent, acceptsLiveSeq, liveGateReason, liveSentence, liveStatus, parseLiveCursor, silenceSeconds } from './live-status';

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

describe('which Timeline events mean a Run has ended (Story 5.7)', () => {
  it('names the one event every terminal transition appends, and the cancellation beside it', () => {
    expect([...RUN_ENDING_EVENTS]).toEqual(['lifecycle.result-sealed', 'lifecycle.run-canceled']);
    for (const type of RUN_ENDING_EVENTS) expect(isRunEndingEvent(type)).toBe(true);
  });
  it('is not fooled by an event that only sounds terminal', () => {
    for (const type of [
      'lifecycle.run-queued', 'lifecycle.run-paused', 'lifecycle.run-resumed',
      'lifecycle.run-pause-requested', 'lifecycle.run-flagged', 'lifecycle.cancellation-superseded',
      'lifecycle.pause-superseded', 'execution.escalation-raised', 'failure.evidence-integrity',
      // A prefix of a real one, and an inherited property name.
      'lifecycle.result-seal', 'constructor', 'toString', '',
    ]) {
      expect(isRunEndingEvent(type)).toBe(false);
    }
  });
});

describe('the live control gate (Story 5.7, UX-DR25)', () => {
  it('is OPEN while the page is connecting, live, or merely stale', () => {
    // Stale is deliberately not a gate: a quiet Run goes stale routinely, and a surface
    // that locked itself every fifteen seconds would be unusable exactly when somebody
    // most wants to pause it. UX-DR25 disables at sixty seconds, not fifteen.
    for (const status of ['connecting', 'live', 'stale'] as const) {
      expect(liveGateReason(status, false)).toBeNull();
    }
  });
  it('closes on a lost stream and on an ended one', () => {
    expect(liveGateReason('lost', false)).toBe('lost');
    expect(liveGateReason('ended', false)).toBe('ended');
  });
  it('closes on a Run that has ended, whatever the stream is doing', () => {
    // The terminal event outranks every stream state: it is set the moment that event
    // arrives, which closes the second between it and the server re-read.
    for (const status of LIVE_STATUSES) {
      expect(liveGateReason(status, true)).toBe('runEnded');
    }
  });
  it('closes on a narrow viewport, above every other reason', () => {
    // EXPERIENCE.md makes Live View read-only below 1024px. The stylesheet only revealed
    // the desktop-only sentence, so Pause, Cancel, Flag and the Escalation answer stayed
    // usable on a phone; this is the rule that withdraws them.
    //
    // It outranks the stream reasons because it is the one a reader can act on: told the
    // connection is lost they can only wait, told to open a desktop browser they can.
    for (const status of LIVE_STATUSES) {
      expect(liveGateReason(status, false, false)).toBe('viewport');
      expect(liveGateReason(status, true, false)).toBe('viewport');
    }
    // And a desktop is unaffected, which is the half a one-sided test would miss.
    expect(liveGateReason('live', false, true)).toBeNull();
  });
  it('gives every reason a sentence that says what is unavailable and why', () => {
    for (const [reason, sentence] of Object.entries(LIVE_GATE_REASONS)) {
      expect(sentence.length).toBeGreaterThan(20);
      expect(sentence.endsWith('.')).toBe(true);
      // A disabled control must never be disabled silently, and a reason nobody can read
      // is the tooltip-only explanation DESIGN.md forbids.
      expect(sentence).not.toBe(reason);
    }
  });
});

describe('a reconnect replays every missed event, in order, with no gap and no duplicate', () => {
  /**
   * What the page actually renders, composed from the SAME primitive the hook composes.
   * `deliveries` is what the wire hands over across one or more connections; the cursor a
   * reconnect resumes from is whatever the page last saw.
   */
  function rendered(cursor: number, deliveries: readonly number[]): { seqs: number[]; cursor: number } {
    const seqs: number[] = [];
    let lastSeq = cursor;
    for (const seq of deliveries) {
      if (!acceptsLiveSeq(lastSeq, seq)) continue;
      lastSeq = seq;
      seqs.push(seq);
    }
    return { seqs, cursor: lastSeq };
  }

  it('renders a first connection in order', () => {
    expect(rendered(0, [1, 2, 3])).toEqual({ seqs: [1, 2, 3], cursor: 3 });
  });

  it('replays an OVERLAPPING resume without rendering anything twice', () => {
    // The page saw 1..3 and the server, resumed from 1 because that was the last frame
    // the browser acknowledged, replays 2..5. Nothing is skipped and nothing repeats.
    const first = rendered(0, [1, 2, 3]);
    const after = rendered(first.cursor, [2, 3, 4, 5]);
    expect([...first.seqs, ...after.seqs]).toEqual([1, 2, 3, 4, 5]);
  });

  it('renders the whole gap when the drop lasted a while', () => {
    const first = rendered(0, [1]);
    const after = rendered(first.cursor, [2, 3, 4, 5, 6, 7]);
    expect([...first.seqs, ...after.seqs]).toEqual([1, 2, 3, 4, 5, 6, 7]);
  });

  it('renders nothing when the resume carries only frames already seen', () => {
    const first = rendered(0, [1, 2, 3]);
    expect(rendered(first.cursor, [1, 2, 3])).toEqual({ seqs: [], cursor: 3 });
  });

  it('never walks the cursor backwards, whatever arrives', () => {
    // A slow reconnect can deliver an old frame after a newer one. The cursor only grows,
    // so that frame is refused rather than re-opening a window the page has passed.
    const out = rendered(0, [1, 5, 2, 3, 6, 4]);
    expect(out).toEqual({ seqs: [1, 5, 6], cursor: 6 });
  });

  it('refuses a sequence that is not a safe integer', () => {
    for (const seq of [Number.NaN, Number.POSITIVE_INFINITY, 1.5, Number.MAX_SAFE_INTEGER + 2]) {
      expect(acceptsLiveSeq(0, seq)).toBe(false);
    }
    expect(acceptsLiveSeq(0, Number.MAX_SAFE_INTEGER)).toBe(true);
  });
});
