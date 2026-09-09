import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  RUN_TIMELINE_CHANNEL,
  formatEndFrame,
  formatHeartbeatFrame,
  formatListFrame,
  formatTimelineFrame,
  parseTimelineNotification,
  HEARTBEAT_MS,
  STREAM_LIFETIME_MS,
} from './run-timeline-channel.js';

describe('the Timeline notification', () => {
  it('parses exactly what the writers send', () => {
    expect(parseTimelineNotification(JSON.stringify({ runId: 'run-1', sequence: 7 }))).toEqual({ runId: 'run-1', sequence: 7 });
  });

  it('refuses anything else, because a notification is untrusted input on a shared channel', () => {
    for (const payload of [
      '', 'null', '[]', '"x"', '{', JSON.stringify({ runId: 'run-1' }), JSON.stringify({ sequence: 1 }),
      JSON.stringify({ runId: '', sequence: 1 }), JSON.stringify({ runId: 'run-1', sequence: 0 }),
      JSON.stringify({ runId: 'run-1', sequence: 1.5 }), JSON.stringify({ runId: 'run-1', sequence: '1' }),
      JSON.stringify({ runId: 'x'.repeat(201), sequence: 1 }), JSON.stringify({ runId: 'run-1', sequence: Number.MAX_SAFE_INTEGER + 2 }),
    ]) {
      expect(parseTimelineNotification(payload), payload).toBeNull();
    }
  });

  it('is the channel every writer in this package notifies on', () => {
    // A listener on a differently spelled channel would wait forever and look like a
    // quiet Run. Every `pg_notify(` in the infrastructure source names this constant's
    // value, and the writers are found by walking the tree rather than by a list.
    const root = fileURLToPath(new URL('../', import.meta.url));
    const notifies: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir)) {
        const path = join(dir, entry);
        if (statSync(path).isDirectory()) { walk(path); continue; }
        if (!path.endsWith('.ts') || path.endsWith('.test.ts')) continue;
        for (const match of readFileSync(path, 'utf8').matchAll(/pg_notify\(\s*'([^']*)'/g)) notifies.push(match[1]!);
      }
    };
    walk(root);
    expect(notifies.length).toBeGreaterThanOrEqual(8);
    expect(new Set(notifies)).toEqual(new Set([RUN_TIMELINE_CHANNEL]));
  });
});

describe('the SSE frames', () => {
  const envelope = { runId: 'run-1', seq: 3, eventType: 'lifecycle.run-queued', occurredAt: '2026-09-09T06:00:00.000Z', outcome: 'success', source: 'web' };

  it('give the per-Run frame an id that is the cursor, and the list frame none', () => {
    expect(formatTimelineFrame(envelope)).toBe(`id: 3\nevent: timeline\ndata: ${JSON.stringify(envelope)}\n\n`);
    expect(formatListFrame(envelope)).toBe(`event: timeline\ndata: ${JSON.stringify(envelope)}\n\n`);
  });

  it('keep the heartbeat and the end observable as named events', () => {
    expect(formatHeartbeatFrame(new Date('2026-09-09T06:00:00Z'))).toBe('event: heartbeat\ndata: {"at":"2026-09-09T06:00:00.000Z"}\n\n');
    expect(formatEndFrame('lifetime')).toBe('event: end\ndata: {"reason":"lifetime"}\n\n');
  });

  it('keep the cadence inside AD-17 and the lifetime under the proxy cap', () => {
    expect(HEARTBEAT_MS).toBeLessThanOrEqual(30_000);
    // Under the 15-second stale rule, so a healthy stream never reads as stale.
    expect(HEARTBEAT_MS).toBeLessThan(15_000);
    expect(STREAM_LIFETIME_MS).toBeLessThan(15 * 60_000);
  });
});
