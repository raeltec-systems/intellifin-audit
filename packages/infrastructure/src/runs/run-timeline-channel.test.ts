import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
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

/** Every non-test source file of this package, found by walking the tree rather than by a list. */
const SOURCE_ROOT = fileURLToPath(new URL('../', import.meta.url));
function infrastructureSources(): ReadonlyArray<{ readonly path: string; readonly text: string }> {
  const found: Array<{ readonly path: string; readonly text: string }> = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir)) {
      const path = join(dir, entry);
      if (statSync(path).isDirectory()) { walk(path); continue; }
      if (!path.endsWith('.ts') || path.endsWith('.test.ts')) continue;
      found.push({ path, text: readFileSync(path, 'utf8') });
    }
  };
  walk(SOURCE_ROOT);
  return found;
}

/**
 * The keys of a plain object literal's body, in order, or `null` when it is not one (a
 * spread, a quoted or computed key, or anything but `key` and `key: value`).
 */
function literalKeys(body: string): string[] | null {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let at = 0; at < body.length; at += 1) {
    const char = body[at];
    if (char === '(' || char === '[' || char === '{') depth += 1;
    else if (char === ')' || char === ']' || char === '}') depth -= 1;
    else if (char === ',' && depth === 0) { parts.push(body.slice(start, at)); start = at + 1; }
  }
  parts.push(body.slice(start));
  const keys: string[] = [];
  for (const part of parts) {
    const property = part.trim();
    if (property === '') continue;
    const key = /^([A-Za-z_$][\w$]*)\s*(?::|$)/.exec(property);
    if (key === null) return null;
    keys.push(key[1]!);
  }
  return keys;
}

/**
 * Every `pg_notify('run_timeline', ...)` in the package, with what is wrong with its payload
 * spelling, or `null` when it is exactly `${JSON.stringify({ runId…, sequence… })}`.
 */
function timelineNotifySites(): ReadonlyArray<{ readonly where: string; readonly problem: string | null }> {
  const sites: Array<{ readonly where: string; readonly problem: string | null }> = [];
  for (const { path, text } of infrastructureSources()) {
    for (const found of text.matchAll(/pg_notify\(\s*'run_timeline'\s*,\s*/g)) {
      const where = `${relative(SOURCE_ROOT, path)}:${text.slice(0, found.index).split('\n').length}`;
      const rest = text.slice(found.index + found[0].length);
      const open = '${JSON.stringify({';
      if (!rest.startsWith(open)) { sites.push({ where, problem: 'the payload is not ${JSON.stringify({ ... })}' }); continue; }
      let depth = 0;
      let close = open.length - 1;
      for (; close < rest.length; close += 1) {
        if (rest[close] === '{') depth += 1;
        else if (rest[close] === '}' && --depth === 0) break;
      }
      const keys = literalKeys(rest.slice(open.length, close));
      if (!/^\)\}\s*\)/.test(rest.slice(close + 1))) sites.push({ where, problem: 'JSON.stringify is given more than the object literal' });
      else if (keys === null) sites.push({ where, problem: 'the object literal is not plain keys' });
      else if (keys.join(',') !== 'runId,sequence') sites.push({ where, problem: `the keys are [${keys.join(', ')}], not [runId, sequence]` });
      else sites.push({ where, problem: null });
    }
  }
  return sites;
}

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
    const notifies: string[] = [];
    for (const { text } of infrastructureSources()) {
      for (const match of text.matchAll(/pg_notify\(\s*'([^']*)'/g)) notifies.push(match[1]!);
    }
    expect(notifies.length).toBeGreaterThanOrEqual(8);
    expect(new Set(notifies)).toEqual(new Set([RUN_TIMELINE_CHANNEL]));
  });

  it('carries the one payload spelling at every notify, so one transaction folds its wake-ups into one', () => {
    // `appendAuditEvent` notifies for every append to a Run's chain, and most writers notify
    // for the same event again through their `notifyTimeline` port (Story 10.7). PostgreSQL
    // folds identical (channel, payload) pairs of one transaction into one notification, and
    // only identical BYTES are identical: `{ sequence, runId }` is a second payload, and the
    // list stream (one frame per notification, no cursor) would forward that event twice.
    // So every site stringifies an object literal whose keys are exactly `runId` then
    // `sequence`, and every offender is named.
    const sites = timelineNotifySites();
    const offenders = sites.filter((site) => site.problem !== null).map((site) => `${site.where}: ${site.problem}`);
    expect(offenders, `run_timeline notifies with another payload spelling:\n${offenders.join('\n')}`).toEqual([]);
    // The walk found the sites (eighteen at Story 10.7), the append's own among them.
    expect(sites.length).toBeGreaterThanOrEqual(18);
    expect(sites.some((site) => site.where.startsWith(join('db', 'audit-events.ts:')))).toBe(true);
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
