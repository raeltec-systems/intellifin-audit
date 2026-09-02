import { readFileSync, readdirSync, statSync } from 'node:fs';
import { basename, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

/**
 * NFR-13: every synthetic fixture says it is synthetic, and this walks all of them.
 *
 * The point is the WALK. A test that lists the files it checks stops checking the moment
 * somebody adds one, and the suite still passes because every file it names is fine. This
 * enumerates the folder, refuses an extension it has no rule for, and refuses an empty
 * result — so a fixture added later is covered, and a walk that silently found nothing
 * fails instead of reporting success.
 *
 * It also refuses anything that could be mistaken for real: a URL whose host is not
 * `.synthetic.invalid` or a loopback, and any email address at all.
 */

const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));
const FIXTURES = join(REPO_ROOT, 'fixtures', 'northstar');

export const SYNTHETIC_MARKER = 'SYNTHETIC-NORTHSTAR-FIXTURE';

/**
 * Files at the fixture root that are TOOLING, not fixtures. Everything else under
 * `fixtures/northstar/` is a fixture and is checked.
 *
 * An allowlist of exclusions, never an allowlist of folders. It was
 * `['datasets', 'expectations', 'generated']`, and a fourth folder added later was
 * invisible: planting `fixtures/northstar/samples/` with a real bank domain, an email
 * address and an account-shaped number, and no marker, left all 98 cases green. That is
 * the same shape as "a glob that cannot match is a promise of coverage that does not
 * exist" — a rule that names what it checks cannot notice what it was never told about.
 * NFR-13 says no production or personal data anywhere in the fixtures, so the walk
 * starts at the root and subtracts.
 */
const NOT_FIXTURES = new Set(['generate.py', 'README.md']);

function walk(directory: string): readonly string[] {
  const found: string[] = [];
  for (const entry of readdirSync(directory).sort()) {
    const path = join(directory, entry);
    // `statSync` rather than a dirent flag, and wrapped: a broken symlink must not fail
    // the suite with an error that says nothing about a fixture.
    let isDirectory: boolean;
    try {
      isDirectory = statSync(path).isDirectory();
    } catch {
      continue;
    }
    if (isDirectory) found.push(...walk(path));
    else found.push(path);
  }
  return found;
}

const FILES = walk(FIXTURES).filter((file) => !NOT_FIXTURES.has(basename(file)));

/** The top-level folders actually present, derived rather than declared. */
const FIXTURE_DIRS = [
  ...new Set(
    FILES.map((file) => relative(FIXTURES, file).split(sep)[0] ?? '').filter(
      (segment) => segment !== '' && !NOT_FIXTURES.has(segment),
    ),
  ),
].sort();

describe('the fixture walk', () => {
  it('found files in every fixture folder', () => {
    // Vacuous coverage is the failure mode this guards. A directory renamed or a glob that
    // cannot match would otherwise leave every assertion below unexecuted and green.
    // The three folders that must exist. Any OTHER folder added under the fixture root
    // is walked too, without anybody remembering to list it here.
    for (const directory of ['datasets', 'expectations', 'generated']) {
      expect(FIXTURE_DIRS, `fixtures/northstar/${directory} is missing`).toContain(directory);
    }
    expect(FILES.length).toBeGreaterThanOrEqual(20);
  });

  it('has a rule for every extension it found', () => {
    // A fixture in a format nobody thought about is not a fixture that passes by default.
    const unknown = FILES.filter((file) => !file.endsWith('.json') && !file.endsWith('.csv'));
    expect(unknown.map((file) => relative(REPO_ROOT, file))).toEqual([]);
  });
});

describe('every fixture carries the synthetic marker', () => {
  for (const file of FILES) {
    const name = relative(REPO_ROOT, file);
    it(name, () => {
      const contents = readFileSync(file, 'utf8');
      if (file.endsWith('.json')) {
        const parsed = JSON.parse(contents) as { synthetic?: { marker?: unknown } };
        expect(parsed.synthetic?.marker).toBe(SYNTHETIC_MARKER);
      } else {
        // A served artifact that escapes this folder must still say what it is, so the
        // marker rides on the file's own first line.
        expect(contents.split('\n')[0] ?? '').toContain(SYNTHETIC_MARKER);
      }
    });
  }
});

describe('no fixture can be mistaken for something real', () => {
  const ALLOWED_HOSTS = /(^|\.)synthetic\.invalid$|^localhost$|^127\.0\.0\.1$|^\[::1\]$/;

  for (const file of FILES) {
    const name = relative(REPO_ROOT, file);
    it(`${name} names no real host`, () => {
      const contents = readFileSync(file, 'utf8');
      const urls = contents.match(/https?:\/\/[^\s"'),;]+/g) ?? [];
      for (const url of urls) {
        let host: string;
        try {
          host = new URL(url).host;
        } catch {
          throw new Error(`${name} contains "${url}", which is not a URL`);
        }
        // Strip the port: a loopback with a port is still a loopback.
        const bare = host.replace(/:\d+$/, '');
        expect(bare, `${name} names the host ${bare}`).toMatch(ALLOWED_HOSTS);
      }
    });

    it(`${name} holds no email address`, () => {
      const contents = readFileSync(file, 'utf8');
      // An address that resolves to a person is exactly what NFR-13 forbids, and the
      // safest rule for a fixture is that there are no addresses in it at all.
      expect(contents).not.toMatch(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/);
    });
  }
});
