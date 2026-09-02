import { spawnSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it } from 'vitest';

const repoRoot = fileURLToPath(new URL('../../', import.meta.url));
const violationDir = path.join(repoRoot, 'packages/domain/src/__boundary_violation__');

function cruise(): { status: number | null; output: string } {
  const result = spawnSync(
    'pnpm',
    ['exec', 'depcruise', '--config', '.dependency-cruiser.cjs', '--no-cache', 'apps', 'packages'],
    { cwd: repoRoot, encoding: 'utf8', env: { ...process.env, NO_COLOR: '1' } },
  );
  return { status: result.status, output: `${result.stdout}\n${result.stderr}` };
}

/** AD-1 is enforced by a check, not by prose: a vendor import in domain must fail. */
describe('dependency boundaries (AD-1)', () => {
  afterEach(() => {
    rmSync(violationDir, { recursive: true, force: true });
  });

  it('exits non-zero and names the file when packages/domain imports drizzle-orm', () => {
    rmSync(violationDir, { recursive: true, force: true });
    mkdirSync(violationDir, { recursive: true });
    const file = path.join(violationDir, 'violation.ts');
    writeFileSync(file, 'import "drizzle-orm";\nexport const leak = true;\n');
    const { status, output } = cruise();
    expect(status).not.toBe(0);
    expect(output).toContain('packages/domain/src/__boundary_violation__/violation.ts');
    expect(output).toContain('drizzle-orm');
  });

  it('exits zero on the clean workspace', () => {
    const { status, output } = cruise();
    expect(status, output).toBe(0);
  });
});
