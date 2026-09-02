import { spawnSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, beforeAll, describe, expect, it } from 'vitest';

const repoRoot = fileURLToPath(new URL('../../', import.meta.url));

/**
 * AD-1 is enforced by a check, not by prose. Each case plants one file that breaks
 * exactly one rule and asserts that rule fires by name.
 *
 * The layer cases import by RELATIVE path on purpose. A workspace-package specifier
 * (`@intellifin/infrastructure`) is unresolvable from a package that does not depend
 * on it, so it trips `not-to-unresolvable` and the layer rule under test never gets
 * the chance to speak. A relative path resolves, which forces the layer rule itself
 * to be the thing that catches it.
 */
const FIXTURE_DIR = '__boundary_violation__';

interface Case {
  /** Package directory holding the planted file, relative to the repository root. */
  readonly plantIn: string;
  /** Import specifier the planted file uses. */
  readonly imports: string;
  /** The dependency-cruiser rule that must fire. */
  readonly rule: string;
}

const CASES: readonly Case[] = [
  {
    plantIn: 'packages/domain/src',
    imports: 'drizzle-orm',
    rule: 'no-vendor-sdk-in-business-code',
  },
  {
    plantIn: 'packages/domain/src',
    imports: '../../../application/src/index.js',
    rule: 'domain-imports-nothing-outward',
  },
  {
    plantIn: 'packages/application/src',
    imports: '../../../infrastructure/src/index.js',
    rule: 'application-imports-only-domain',
  },
  {
    plantIn: 'packages/infrastructure/src',
    imports: '../../../../apps/worker/src/main.js',
    rule: 'infrastructure-imports-no-composition-root',
  },
  {
    plantIn: 'apps/web/src',
    imports: '../../../../packages/infrastructure/src/db/migrate.js',
    rule: 'no-migrator-in-apps',
  },
];

const fixtureDirs = [...new Set(CASES.map((c) => path.join(repoRoot, c.plantIn, FIXTURE_DIR)))];

function cleanFixtures(): void {
  for (const dir of fixtureDirs) {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Plants the violating file and returns its repository-relative path. */
function plant(testCase: Case): string {
  const dir = path.join(repoRoot, testCase.plantIn, FIXTURE_DIR);
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, 'violation.ts');
  writeFileSync(file, `import '${testCase.imports}';\nexport const leak = true;\n`);
  return path.posix.join(testCase.plantIn, FIXTURE_DIR, 'violation.ts');
}

function cruise(): { status: number | null; output: string } {
  const result = spawnSync(
    'pnpm',
    ['boundaries'],
    { cwd: repoRoot, encoding: 'utf8', env: { ...process.env, NO_COLOR: '1' } },
  );
  return { status: result.status, output: `${result.stdout}\n${result.stderr}` };
}

describe('dependency boundaries (AD-1)', () => {
  // A fixture left behind by a crashed run would poison every later case and every
  // `pnpm -r typecheck`, so clear them before the first case as well as after each.
  beforeAll(cleanFixtures);
  afterEach(cleanFixtures);

  it.each(CASES)('fires $rule when $plantIn imports $imports', (testCase) => {
    const planted = plant(testCase);
    const { status, output } = cruise();

    expect(status, output).not.toBe(0);
    expect(output).toContain(testCase.rule);
    expect(output).toContain(planted);

    // The named rule must be the one that caught this file, not a bystander.
    const line = output
      .split('\n')
      .find((l) => l.includes(testCase.rule) && l.includes(planted));
    expect(line, `no "${testCase.rule}" violation reported for ${planted}\n${output}`).toBeDefined();
  });

  it('exits zero on the clean workspace', () => {
    const { status, output } = cruise();
    expect(status, output).toBe(0);
  });
});
