import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

/**
 * How an entry-point module decides it was run rather than imported.
 *
 * `process.argv[1] === fileURLToPath(import.meta.url)` and `import.meta.main` are not
 * the same test. `import.meta.url` is the RESOLVED path; `argv[1]` is the path as
 * invoked. Through a symlink they differ — and pnpm's `node_modules` is symlinks, as is
 * any `--prod deploy` tree — so the comparison is false, the module loads, does
 * nothing, and exits 0.
 *
 * For `db/migrate.ts` that is a release which reports success against an unmigrated
 * database, and then every process refuses to start on a schema range it does not have.
 * This test is here rather than beside a mock because the behaviour under test is
 * Node's, not ours: it runs a real file through a real symlink.
 */
const workspace = mkdtempSync(join(tmpdir(), 'entry-point-'));

afterAll(() => {
  rmSync(workspace, { recursive: true, force: true });
});

function run(path: string): string {
  const result = spawnSync(process.execPath, [path], { encoding: 'utf8' });
  return `${result.stdout}${result.stderr}`.trim();
}

describe('the entry-point guard', () => {
  const real = join(workspace, 'module.mjs');
  const link = join(workspace, 'linked.mjs');

  writeFileSync(
    real,
    [
      "import { fileURLToPath } from 'node:url';",
      "const byArgv = process.argv[1] === fileURLToPath(import.meta.url);",
      "console.log(JSON.stringify({ byArgv, byMeta: import.meta.main }));",
      '',
    ].join('\n'),
  );
  symlinkSync(real, link);

  it('agrees with `import.meta.main` when the file is run directly', () => {
    expect(JSON.parse(run(real))).toEqual({ byArgv: true, byMeta: true });
  });

  it('is WRONG when the file is run through a symlink, and `import.meta.main` is not', () => {
    // This is the whole reason the guard is `import.meta.main`. If this ever reports
    // `byArgv: true`, Node has changed and the comment above needs revisiting — but the
    // guard stays correct either way.
    expect(JSON.parse(run(link))).toEqual({ byArgv: false, byMeta: true });
  });

  it('is spelled `import.meta.main` in both entry points', async () => {
    const { readFileSync } = await import('node:fs');
    const { fileURLToPath } = await import('node:url');
    for (const file of ['./migrate.ts', '../registrations/probe-runner.ts']) {
      const source = readFileSync(fileURLToPath(new URL(file, import.meta.url)), 'utf8');
      const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '');
      expect(code, file).toContain('const isEntryPoint = import.meta.main;');
      expect(code, file).not.toContain('process.argv[1] ===');
    }
  });
});
