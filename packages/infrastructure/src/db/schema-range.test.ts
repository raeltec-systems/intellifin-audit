import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { SUPPORTED_SCHEMA_MAX, SUPPORTED_SCHEMA_MIN, SUPPORTED_SCHEMA_RANGE } from './compat.js';

/**
 * The drift guard.
 *
 * A release migrates the database to whatever generation the migrations seed, then the
 * same build's processes refuse to start outside their declared range. If a story adds
 * a migration and forgets to raise `SUPPORTED_SCHEMA_MAX`, every process refuses to
 * start against a database its own release just migrated -- which is exactly what
 * happened on the Story 1.2 release, when the range still lived in the environment.
 *
 * This test reads the migrations and fails before that reaches a release.
 */

const MIGRATIONS_FOLDER = fileURLToPath(new URL('../../drizzle', import.meta.url));

/** Every generation seeded by `INSERT INTO "schema_meta" ("version") VALUES (n)`. */
function seededGenerations(): number[] {
  const seeded: number[] = [];
  for (const entry of readdirSync(MIGRATIONS_FOLDER).sort()) {
    if (!entry.endsWith('.sql')) continue;
    const sql = readFileSync(`${MIGRATIONS_FOLDER}/${entry}`, 'utf8');
    const pattern = /INSERT\s+INTO\s+"schema_meta"\s*\(\s*"version"\s*\)\s*VALUES\s*\(\s*(\d+)\s*\)/gi;
    for (const match of sql.matchAll(pattern)) {
      seeded.push(Number.parseInt(match[1] as string, 10));
    }
  }
  return seeded;
}

describe('supported schema range', () => {
  it('declares a max equal to the highest generation the migrations seed', () => {
    const seeded = seededGenerations();
    expect(seeded.length).toBeGreaterThan(0);
    expect(SUPPORTED_SCHEMA_MAX).toBe(Math.max(...seeded));
  });

  it('seeds every generation from 1 to the max exactly once, with no gaps', () => {
    const seeded = seededGenerations().sort((a, b) => a - b);
    expect(seeded).toEqual(Array.from({ length: seeded.length }, (_index, i) => i + 1));
  });

  it('declares a min at or below the max, starting at generation 1 or later', () => {
    expect(SUPPORTED_SCHEMA_MIN).toBeGreaterThanOrEqual(1);
    expect(SUPPORTED_SCHEMA_MIN).toBeLessThanOrEqual(SUPPORTED_SCHEMA_MAX);
    expect(SUPPORTED_SCHEMA_RANGE).toBe(`${SUPPORTED_SCHEMA_MIN}..${SUPPORTED_SCHEMA_MAX}`);
  });
});
