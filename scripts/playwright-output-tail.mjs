/**
 * The end of a Playwright child process's own output, for a run that failed before its tests.
 *
 * `verify-agent-abuse-e2e-mutations.mjs` reads Playwright's JSON report, and that reporter
 * keeps nothing that belongs to no test. The `[WebServer]` lines are the only place a web
 * server that never became ready says why, so CI's "Timed out waiting 180000ms from
 * config.webServer." on d1a3f30 (attempt 1) left no reason at all. The harness now adds the
 * line reporter, which prints those lines to the child's stdout, and keeps this tail only
 * when the run failed outside its tests.
 *
 * `outputTail` is pure: text in, lines out. Terminal escapes are removed, the worktree path is named rather
 * than printed, and the value of every environment variable whose NAME marks it as secret is
 * replaced by that name, all before the result is bounded, so a cut line cannot keep half of
 * a value.
 *
 * A server that never becomes ready answers the same health poll for three minutes, and
 * those lines alone fill the tail. So a run of lines that differ only in their numbers is
 * kept as its first line, a count, and its last line, BEFORE the tail is cut: the lines
 * the server printed before the polls began are the ones that say why.
 *
 * The child writes to files rather than to pipes the harness holds: past its `maxBuffer`,
 * `spawnSync` kills a run and keeps the FIRST bytes of a pipe, so the tail would not be
 * where the run stopped. `readTail` reads back only the end of such a file, in whole lines.
 */
import { open } from 'node:fs/promises';
import { stripVTControlCharacters } from 'node:util';

export const OUTPUT_TAIL_LINES = 80;
export const OUTPUT_TAIL_LINE_LENGTH = 400;
const SECRET_NAME = /SECRET|PASSWORD|TOKEN|KEY|DATABASE_URL/u;
/** A shorter value is an ordinary word far more often than it is a secret. */
const MIN_REDACTED_LENGTH = 8;
/** At most this many bytes of a run's output are read back. */
export const OUTPUT_READ_LIMIT = 8 * 1024 * 1024;

/**
 * The end of a file a child process wrote, in whole lines. A window that starts inside a line
 * starts inside whatever that line holds, and half a secret is a value the redaction can no
 * longer recognize, so the partial first line is dropped. No line break at all: nothing.
 * @param {string} path
 * @param {number} [limit]
 * @returns {Promise<string>}
 */
export async function readTail(path, limit = OUTPUT_READ_LIMIT) {
  const handle = await open(path, 'r');
  try {
    const { size } = await handle.stat();
    const length = Math.min(size, limit);
    const window = Buffer.alloc(length);
    const { bytesRead } = await handle.read(window, 0, length, size - length);
    const text = window.subarray(0, bytesRead).toString('utf8');
    if (length === size) return text;
    const firstBreak = text.indexOf('\n');
    return firstBreak === -1 ? '' : text.slice(firstBreak + 1);
  } finally {
    await handle.close();
  }
}

/**
 * @param {string | null | undefined} text
 * @param {{ root: string, env: Record<string, string | undefined> }} context
 * @returns {string[]}
 */
export function outputTail(text, { root, env }) {
  let clean = stripVTControlCharacters(text ?? '');
  if (root !== '') clean = clean.replaceAll(root, '<worktree>');
  const secrets = Object.entries(env)
    .filter(([name, value]) => SECRET_NAME.test(name) && typeof value === 'string' && value.length >= MIN_REDACTED_LENGTH)
    // Longest first: a value that contains another is replaced whole, not in pieces.
    .sort(([, a], [, b]) => String(b).length - String(a).length);
  for (const [name, value] of secrets) clean = clean.replaceAll(String(value), `<${name}>`);
  return collapseRepeats(clean.split(/\r?\n/u).filter(line => line.trim() !== '')).slice(-OUTPUT_TAIL_LINES)
    .map(line => line.length > OUTPUT_TAIL_LINE_LENGTH ? `${line.slice(0, OUTPUT_TAIL_LINE_LENGTH)}…` : line);
}

/**
 * Consecutive lines with one shape once their numbers are ignored (`2ms` and `2.0ms` alike:
 * Next prints both). The first and the last are kept word for word, so a poll that went from
 * 10ms to 5000ms still shows both ends.
 * @param {string[]} lines
 * @returns {string[]}
 */
function collapseRepeats(lines) {
  const shape = (/** @type {string} */ line) => line.replace(/\d+(?:\.\d+)?/gu, '#');
  const kept = [];
  for (let start = 0; start < lines.length;) {
    let end = start + 1;
    while (end < lines.length && shape(lines[end]) === shape(lines[start])) end += 1;
    const run = end - start;
    kept.push(lines[start]);
    if (run > 2) kept.push(`… ${run - 2} more lines like this …`);
    if (run > 1) kept.push(lines[end - 1]);
    start = end;
  }
  return kept;
}
