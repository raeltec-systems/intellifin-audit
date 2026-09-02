import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
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
  /**
   * A repository-relative file that must exist for the case to mean anything.
   *
   * Only the built-output cases need one. They import from `dist`, which exists after
   * `pnpm build` and not on a fresh clone; without the guard the case would plant an
   * unresolvable import, trip `not-to-unresolvable` instead, and look like it proved
   * the rule it is named after.
   */
  readonly requires?: string;
}

const CASES: readonly Case[] = [
  {
    plantIn: 'packages/domain/src',
    imports: 'drizzle-orm',
    rule: 'no-vendor-sdk-in-business-code',
  },
  {
    plantIn: 'packages/application/src',
    imports: 'better-auth',
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
  {
    // AD-10: the web process never probes a Target System, and the rule that says so is
    // worth nothing until it has been seen to fire.
    plantIn: 'apps/web/src',
    imports: '../../../../packages/infrastructure/src/registrations/probe.js',
    rule: 'no-target-system-probe-in-apps',
  },
  {
    // The same rule covers the worker. Story 1.8 gave the worker a probe, and this is why
    // the sweep lives in `packages/infrastructure/src/registrations/probe-runner.ts` and
    // is started as its own process — the way the release migrator is — rather than as a
    // file under `apps/worker/src/` that would have to import this and break the rule.
    plantIn: 'apps/worker/src',
    imports: '../../../../packages/infrastructure/src/registrations/probe.js',
    rule: 'no-target-system-probe-in-apps',
  },
  {
    // The sweep itself, from the worker. `to.path` is a PREFIX — `.../registrations/probe`
    // matches `probe-runner.ts` too — so an entry point under `apps/worker/src/` that
    // imported the sweep is refused exactly as one that imported the writer. That is not
    // an accident of the pattern; it is the reason the runner is not there.
    plantIn: 'apps/worker/src',
    imports: '../../../../packages/infrastructure/src/registrations/probe-runner.js',
    rule: 'no-target-system-probe-in-apps',
  },
  {
    // And from the web, which must never make an outbound call to a registered system.
    plantIn: 'apps/web/src',
    imports: '../../../../packages/infrastructure/src/registrations/probe-runner.js',
    rule: 'no-target-system-probe-in-apps',
  },
  {
    /**
     * The same import spelled at the BUILT path.
     *
     * Both probe rules and both migrator rules match `(src|dist)`, and the `dist` half
     * was dead: built output sat in dependency-cruiser's `exclude`, and an excluded
     * path is not rule-checked at all — so this exact import passed `pnpm boundaries`
     * with a `no-orphans` warning as the only trace. That is the third time this
     * codebase has been bitten by the same shape, after `node_modules` and a bare
     * `.d.ts`. Built output now sits in `doNotFollow`, which keeps it in the graph.
     */
    plantIn: 'apps/web/src',
    imports: '../../../../packages/infrastructure/dist/registrations/probe.js',
    rule: 'no-target-system-probe-in-apps',
    requires: 'packages/infrastructure/dist/registrations/probe.js',
  },
  {
    plantIn: 'apps/web/src',
    imports: '../../../../packages/infrastructure/dist/db/migrate.js',
    rule: 'no-migrator-in-apps',
    requires: 'packages/infrastructure/dist/db/migrate.js',
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
  // Windows only: `pnpm` is a .CMD shim spawnSync cannot exec. See scripts/check-boundaries.mjs.
  const corepackCandidates =
    process.platform === 'win32'
      ? [
          path.join(path.dirname(process.execPath), 'node_modules', 'corepack', 'dist', 'pnpm.js'),
          path.resolve(
            path.dirname(process.execPath),
            '..',
            'lib',
            'node_modules',
            'corepack',
            'dist',
            'pnpm.js',
          ),
        ]
      : [];
  const corepackPnpm = corepackCandidates.find(existsSync);
  const result = spawnSync(
    corepackPnpm ? process.execPath : 'pnpm',
    [...(corepackPnpm ? [corepackPnpm] : []), 'boundaries'],
    {
      cwd: repoRoot,
      encoding: 'utf8',
      env: { ...process.env, NO_COLOR: '1' },
      shell: process.platform === 'win32' && !corepackPnpm,
    },
  );
  return { status: result.status, output: `${result.stdout}\n${result.stderr}` };
}

describe('dependency boundaries (AD-1)', () => {
  // A fixture left behind by a crashed run would poison every later case and every
  // `pnpm -r typecheck`, so clear them before the first case as well as after each.
  beforeAll(cleanFixtures);
  afterEach(cleanFixtures);

  it.each(CASES)(
    'fires $rule when $plantIn imports $imports',
    (testCase) => {
      // A built-output case on an unbuilt tree proves nothing; skip rather than pass.
      if (testCase.requires !== undefined && !existsSync(path.join(repoRoot, testCase.requires))) {
        return;
      }
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
    },
    30_000,
  );

  it('exits zero on the clean workspace', () => {
    const { status, output } = cruise();
    expect(status, output).toBe(0);
  }, 30_000);
});
