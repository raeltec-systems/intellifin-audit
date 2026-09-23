import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

// @ts-expect-error -- a plain ESM harness module with no declaration file.
import { OUTPUT_READ_LIMIT, OUTPUT_TAIL_LINE_LENGTH, OUTPUT_TAIL_LINES, outputTail, readTail } from '../../scripts/playwright-output-tail.mjs';

/**
 * The agent-abuse mutation harness keeps this tail when a Playwright run fails before its
 * tests, and it goes into a CI job log and an uploaded artifact. So what it removes matters as
 * much as what it keeps: a secret value, a terminal escape, the runner's path. The inputs are
 * shaped like the real `[WebServer]` lines a `next dev` that never became ready prints.
 */
const root = '/home/runner/work/_temp/agent-abuse-e2e-worktree';
const databaseUrl = 'postgres://postgres:postgres@localhost:5432/intellifin_e2e?sslmode=require';
const authSecret = 'ci-e2e-secret-at-least-32-characters-long';

type Tail = (text: string | null | undefined, context: { root: string; env: Record<string, string | undefined> }) => string[];
const tail = outputTail as Tail;
const readBack = readTail as (path: string, limit?: number) => Promise<string>;

describe('outputTail', () => {
  it('keeps the web server lines in order, without escapes, the worktree path or secret values', () => {
    const text = [
      '\u001b[2m[WebServer] \u001b[22m ✓ Ready in 368ms',
      `[WebServer] Error: connect ECONNREFUSED at ${root}/apps/web/src/bootstrap.ts`,
      `[WebServer] {"level":50,"message":"Startup checks deferred","databaseUrl":"${databaseUrl}"}`,
      `[WebServer] secret ${authSecret} and service web`,
      '',
      '   ',
    ].join('\n');
    const lines = tail(text, { root, env: { DATABASE_URL: databaseUrl, BETTER_AUTH_SECRET: authSecret, SERVICE_NAME: 'web' } });
    expect(lines).toEqual([
      '[WebServer]  ✓ Ready in 368ms',
      '[WebServer] Error: connect ECONNREFUSED at <worktree>/apps/web/src/bootstrap.ts',
      '[WebServer] {"level":50,"message":"Startup checks deferred","databaseUrl":"<DATABASE_URL>"}',
      // SERVICE_NAME is not a secret name, so its value stays; a secret's value never does.
      '[WebServer] secret <BETTER_AUTH_SECRET> and service web',
    ]);
  });

  it('replaces a longer secret whole before a shorter one it contains', () => {
    const lines = tail('token abcdefgh-ijklmnop and abcdefgh', {
      root, env: { SHORT_TOKEN: 'abcdefgh', LONG_TOKEN: 'abcdefgh-ijklmnop' },
    });
    expect(lines).toEqual(['token <LONG_TOKEN> and <SHORT_TOKEN>']);
  });

  it('leaves a value shorter than eight characters, which is more often a word than a secret', () => {
    expect(tail('password is short', { root, env: { E2E_PASSWORD: 'short' } })).toEqual(['password is short']);
  });

  it('keeps only the last lines, each bounded, and cuts a line only after its secrets are gone', () => {
    // Lines of different shapes, so none of them is folded into a run.
    const many = Array.from({ length: OUTPUT_TAIL_LINES + 20 }, (_, index) => `[WebServer] ${'x'.repeat(index + 1)}`).join('\n');
    const kept = tail(many, { root, env: {} });
    expect(kept).toHaveLength(OUTPUT_TAIL_LINES);
    expect(kept[0]).toBe(`[WebServer] ${'x'.repeat(21)}`);
    expect(kept.at(-1)).toBe(`[WebServer] ${'x'.repeat(OUTPUT_TAIL_LINES + 20)}`);

    // The secret straddles the cut. Redacting after cutting would leave its first half.
    const long = `${'x'.repeat(OUTPUT_TAIL_LINE_LENGTH - 10)}${authSecret}`;
    const [cut] = tail(long, { root, env: { BETTER_AUTH_SECRET: authSecret } });
    expect(cut).toHaveLength(OUTPUT_TAIL_LINE_LENGTH + 1);
    expect(cut?.endsWith('…')).toBe(true);
    expect(cut).not.toContain(authSecret.slice(0, 10));
  });

  it('folds a run of lines that differ only in their numbers, before the tail is cut', () => {
    // The shape of the d1a3f30 failure: a server that is up and never ready answers the same
    // health poll for three minutes. The lines printed before the polls must survive.
    const polls = Array.from({ length: 200 }, (_, index) =>
      `[WebServer]  GET /api/health 503 in ${10 + (index % 7)}ms (next.js: 2ms, application-code: ${5 + index}ms)`);
    // Next prints some timings with a decimal; that must not break the run.
    polls[100] = '[WebServer]  GET /api/health 503 in 9ms (next.js: 2.0ms, application-code: 5ms)';
    polls[199] = '[WebServer]  GET /api/health 503 in 5012ms (next.js: 2ms, application-code: 5003ms)';
    const text = ['[WebServer] ✓ Ready in 453ms', '[WebServer] ○ Compiling /api/health ...', ...polls,
      'Error: Timed out waiting 180000ms from config.webServer.'].join('\n');
    expect(tail(text, { root, env: {} })).toEqual([
      '[WebServer] ✓ Ready in 453ms',
      '[WebServer] ○ Compiling /api/health ...',
      '[WebServer]  GET /api/health 503 in 10ms (next.js: 2ms, application-code: 5ms)',
      '… 198 more lines like this …',
      // The last line of the run is kept word for word, so a slower poll shows its time.
      '[WebServer]  GET /api/health 503 in 5012ms (next.js: 2ms, application-code: 5003ms)',
      'Error: Timed out waiting 180000ms from config.webServer.',
    ]);
    // Two alike are both kept; one different word ends a run.
    expect(tail('poll 1\npoll 2\npoll 3 done\npoll 4', { root, env: {} })).toEqual(['poll 1', 'poll 2', 'poll 3 done', 'poll 4']);
  });

  it('answers an empty tail for no output', () => {
    expect(tail(null, { root, env: {} })).toEqual([]);
    expect(tail(undefined, { root, env: {} })).toEqual([]);
    expect(tail('\n\n', { root, env: {} })).toEqual([]);
  });
});

describe('readTail', () => {
  // The harness sends a run's output to files: past its `maxBuffer`, a pipe that spawnSync
  // buffers kills the run and keeps the first bytes, and a failure needs the last ones.
  const dir = mkdtempSync(join(tmpdir(), 'playwright-output-tail-'));
  afterAll(() => rmSync(dir, { recursive: true, force: true }));
  const file = (name: string, text: string) => {
    const path = join(dir, name);
    writeFileSync(path, text);
    return path;
  };

  it('reads a file within the limit whole, and reads at most 8 MiB by default', async () => {
    expect(await readBack(file('small.log', 'first\nsecond\n'))).toBe('first\nsecond\n');
    expect(OUTPUT_READ_LIMIT).toBe(8 * 1024 * 1024);
  });

  it('keeps only the whole lines at the end, so a secret the window cuts leaves nothing behind', async () => {
    const earlier = `[WebServer] connect ${'x'.repeat(50)} ${authSecret}`;
    const kept = '[WebServer] kept line\n[WebServer] last line\n';
    // The window starts twenty characters before the end of the first line: inside the secret.
    const path = file('large.log', `${earlier}\n${kept}`);
    const text = await readBack(path, kept.length + 20);
    expect(text).toBe(kept);
    expect(text).not.toContain(authSecret.slice(-20));
  });

  it('answers nothing when the window holds no line break at all', async () => {
    expect(await readBack(file('one-line.log', 'y'.repeat(100)), 40)).toBe('');
  });
});
