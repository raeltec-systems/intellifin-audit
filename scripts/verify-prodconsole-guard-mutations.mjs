/**
 * Executable, bounded Story 4.10 mutation evidence for the P-4 D2-b and D5
 * compiler guards. Run only in a clean disposable detached linked worktree.
 * Every source mutation is restored in finally; no provider or database is used.
 */
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const root = process.cwd();

function git(...args) {
  return spawnSync('git', args, { cwd: root, encoding: 'utf8' });
}

if (!git('rev-parse', '--git-dir').stdout.includes('/worktrees/')) {
  throw new Error('ProdConsole mutations require a linked disposable worktree.');
}
if (git('symbolic-ref', '-q', 'HEAD').status === 0) {
  throw new Error('Use a disposable detached worktree; never mutate an engineering branch.');
}
if (git('diff', '--quiet').status !== 0 || git('diff', '--cached', '--quiet').status !== 0) {
  throw new Error('Tracked work must be clean before mutation.');
}

const baselineSha = git('rev-parse', 'HEAD').stdout.trim();
const output = process.argv[2];
if (!output) throw new Error('Supply a secret-free JSON evidence output path.');

const cases = [
  {
    id: 'p4-d2b-prohibited-baseline',
    file: 'packages/domain/src/procedures/plan-compiler.ts',
    before: "if (baseline.disposition === 'prohibited') return truth(values['found'] === false);",
    after: 'if (baseline.disposition === \'prohibited\') return truth(true);',
    test: 'packages/domain/src/procedures/plan-compiler.test.ts',
    name: 'evaluates the one P-4 baseline in effect and rejects prohibited or ambiguous baselines',
    requirement: 'D2-b: a present parameter with frozen disposition prohibited must evaluate EXCEPTION.',
  },
  {
    id: 'p4-d5-duplicate-baseline-first-wins',
    file: 'packages/domain/src/procedures/plan-compiler.ts',
    before: "if (effective.length !== 1) return unknown(effective.length ? 'multiple effective baselines apply' : 'missing effective baseline');",
    after: "if (effective.length === 0) return unknown('missing effective baseline');",
    test: 'packages/domain/src/procedures/plan-compiler.test.ts',
    name: 'evaluates the one P-4 baseline in effect and rejects prohibited or ambiguous baselines',
    requirement: 'D5: multiple effective baseline rows must remain UNEVALUATED; first-wins is forbidden.',
  },
];

const scratch = await mkdtemp(join(tmpdir(), 'prodconsole-guard-mutations-'));
const results = [];

function assertionReport(report) {
  const suites = Array.isArray(report.testResults) ? report.testResults : [];
  return suites
    .flatMap((suite) => Array.isArray(suite.assertionResults) ? suite.assertionResults : [])
    .filter((row) => row.status !== 'pending')
    .map((row) => ({
      name: row.fullName,
      status: row.status,
      failures: (row.failureMessages ?? []).map((message) =>
        String(message).replaceAll(root, '<worktree>').slice(0, 2400),
      ),
    }));
}

async function run(entry, label) {
  const reportPath = join(scratch, `${entry.id}-${label}.json`);
  const child = spawnSync(
    'pnpm',
    [
      'exec', 'vitest', 'run', entry.test, '-t', entry.name,
      '--reporter=json', `--outputFile=${reportPath}`,
    ],
    {
      cwd: root,
      env: { ...process.env, pnpm_config_verify_deps_before_run: 'false' },
      encoding: 'utf8',
      timeout: 60_000,
      maxBuffer: 8 * 1024 * 1024,
    },
  );
  if (child.error || child.signal) throw new Error(`Test process did not finish: ${entry.id}/${label}`);
  let report;
  try {
    report = JSON.parse(await readFile(reportPath, 'utf8'));
  } catch (error) {
    throw new Error(`Test report was unavailable: ${entry.id}/${label}`, { cause: error });
  }
  const assertions = assertionReport(report);
  return {
    exit: child.status,
    passed: report.numPassedTests,
    failed: report.numFailedTests,
    assertions,
  };
}

try {
  for (const entry of cases) {
    const path = resolve(root, entry.file);
    const source = await readFile(path, 'utf8');
    if (source.split(entry.before).length !== 2) {
      throw new Error(`Mutation anchor drift: ${entry.id}`);
    }

    const green = await run(entry, 'baseline');
    if (green.exit !== 0 || green.passed < 1 || green.failed !== 0 ||
        green.assertions.some((row) => row.status === 'failed')) {
      throw new Error(`Baseline failed or selected no tests: ${entry.id}`);
    }

    let red;
    try {
      await writeFile(path, source.replace(entry.before, entry.after));
      red = await run(entry, 'mutant');
    } finally {
      await writeFile(path, source);
    }
    if (red.exit === 0 || red.failed < 1 || !red.assertions.some((row) => row.status === 'failed')) {
      throw new Error(`Mutation survived or produced no assertion failure: ${entry.id}`);
    }

    results.push({
      id: entry.id,
      requirement: entry.requirement,
      file: entry.file,
      guard: entry.before,
      replacement: entry.after,
      sourceSha256: createHash('sha256').update(source).digest('hex'),
      testSha256: createHash('sha256').update(await readFile(entry.test)).digest('hex'),
      test: entry.test,
      testName: entry.name,
      green,
      red,
    });
    await writeFile(output, JSON.stringify({
      schemaVersion: 1,
      baselineSha,
      mode: 'local-unit-no-provider-no-database',
      completed: false,
      results,
    }, null, 2) + '\n');
    process.stdout.write(`${entry.id}: baseline ${green.passed} passed; mutant ${red.failed} failed\n`);
  }

  await writeFile(output, JSON.stringify({
    schemaVersion: 1,
    baselineSha,
    mode: 'local-unit-no-provider-no-database',
    completed: true,
    limitations: [
      'No PostgreSQL, browser, model provider, actual worker journey or Solari acceptance was used.',
      'This is the two Story 4.10 compiler guard mutations named by D2-b and D5.',
    ],
    results,
  }, null, 2) + '\n');
} finally {
  await rm(scratch, { recursive: true, force: true });
}
