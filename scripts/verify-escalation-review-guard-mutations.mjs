/**
 * Executable Story 4.5–4.9 mutation evidence for complete absence keys, token accounting, grounded matching, durable
 * wait closure and inclusive human-review thresholds. Run only in a clean disposable detached linked worktree.
 * Every source mutation is restored in finally. The closure case uses real PostgreSQL;
 * no provider is used. --unit-only produces explicitly incomplete local evidence.
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
  throw new Error('Escalation/review mutations require a linked disposable worktree.');
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

const unitOnly = process.argv.includes('--unit-only');
if (!unitOnly && !process.env['DATABASE_URL']) {
  throw new Error('DATABASE_URL is required for the real PostgreSQL closed-wait mutation.');
}
const cases = [
  {
    id: 'absence-first-declared-search-key-only',
    file: 'packages/application/src/runs/agent-observation.ts',
    before: 'absence: { queryKeys: input.queryKeys, emptyResultEvidenceId:',
    after: 'absence: { queryKeys: input.queryKeys.slice(0, 1), emptyResultEvidenceId:',
    test: 'packages/application/src/runs/agent-observation.test.ts',
    name: 'retains both actual lookup keys and the registered empty result',
    requirement: 'Story 4.5: the worker absence producer supplies every declared lookup key to the shared completeness judge.',
  },
  {
    id: 'agent-measured-token-accounting-removed',
    file: 'packages/application/src/runs/execute-agent-model-turn.ts',
    before: 'tokens: prior.tokens + response.usage.totalTokens,',
    after: 'tokens: prior.tokens,',
    test: 'packages/application/src/runs/execute-agent-model-turn.test.ts',
    name: 'reserves before I/O and records real usage after the response',
    requirement: 'Story 4.6: the durable model-turn path used by the worker must add measured provider usage to prior Run consumption.',
  },
  {
    id: 'single-grounded-match-escalates',
    file: 'packages/application/src/runs/agent-tool-planner.ts',
    before: 'if (primaryValues.length === 1) {',
    after: 'if (false) {',
    test: 'packages/application/src/runs/agent-tool-planner.test.ts',
    name: 'grounds one candidate and exposes only frozen locators for declared fields',
    requirement: 'Story 4.7: one grounded key match resolves without raising an Escalation.',
  },
  {
    id: 'closed-wait-repeat-closure-guard',
    file: 'packages/infrastructure/src/runs/wait-repository.ts',
    before: `currentWait = lockedWait;
            if (lockedWait.closedAt !== null) return { outcome: 'superseded', wait: lockedWait, run: current };
            if (current.state !== 'AWAITING_AUDITOR') return { outcome: 'not-awaiting', wait: lockedWait, run: current };
            if (current.revision !== input.expectedRunRevision)`,
    after: `currentWait = lockedWait;
            // Mutant: permit a closed wait to enter the closure path again.
            if (current.state !== 'AWAITING_AUDITOR') return { outcome: 'not-awaiting', wait: lockedWait, run: current };
            if (current.revision !== input.expectedRunRevision)`,
    test: 'tests/integration/run-waits.test.ts',
    name: 'closes once with the expected revision and leaves the original wake as the sole job',
    config: 'tests/integration/vitest.config.ts',
    requirement: 'Story 4.8: a repeated closure returns the durable closed-wait refusal; independent SQL immutability remains enabled.',
  },
  {
    id: 'agent-review-threshold-strict',
    file: 'packages/domain/src/runs/evaluation.ts',
    before: 'compareComplianceDecimals(agent.confidence, fields.agentJudgedThreshold) >= 0;',
    after: 'compareComplianceDecimals(agent.confidence, fields.agentJudgedThreshold) > 0;',
    test: 'packages/domain/src/runs/evaluation.test.ts',
    name: 'keeps an applicable C2 proposal Agent-Judged and pending at the inclusive threshold',
    requirement: 'Story 4.9: confidence equal to the frozen decimal threshold requires human confirmation.',
  },
].filter(entry => !unitOnly || !entry.config);

const scratch = await mkdtemp(join(tmpdir(), 'escalation-review-guard-mutations-'));
const results = [];

async function retain(completed) {
  await writeFile(output, JSON.stringify({
    schemaVersion: 1, baselineSha,
    mode: unitOnly ? 'local-unit-only-incomplete' : 'unit-and-real-postgresql-no-provider',
    completed, results,
  }, null, 2) + '\n');
}

function assertionReport(report) {
  const suites = Array.isArray(report.testResults) ? report.testResults : [];
  return suites
    .flatMap((suite) => Array.isArray(suite.assertionResults) ? suite.assertionResults : [])
    .filter((row) => row.status === 'passed' || row.status === 'failed')
    .map((row) => ({
      name: row.fullName,
      status: row.status,
      failures: (row.failureMessages ?? []).map((message) =>
        String(message).replaceAll(root, '<worktree>')
          .replaceAll(process.env['DATABASE_URL'] ?? '<no-database-url>', '<test-database>').slice(0, 2400),
      ),
    }));
}

async function run(entry, label) {
  const reportPath = join(scratch, `${entry.id}-${label}.json`);
  const child = spawnSync(
    'pnpm',
    [
      'exec', 'vitest', 'run', ...(entry.config ? ['--config', entry.config] : []), entry.test, '-t', entry.name,
      '--reporter=json', `--outputFile=${reportPath}`,
    ],
    {
      cwd: root,
      env: { ...process.env, pnpm_config_verify_deps_before_run: 'false' },
      encoding: 'utf8',
      timeout: entry.config ? 180_000 : 60_000,
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
    const record = {
      id: entry.id, requirement: entry.requirement, file: entry.file,
      guard: entry.before, replacement: entry.after,
      sourceSha256: createHash('sha256').update(source).digest('hex'),
      testSha256: createHash('sha256').update(await readFile(entry.test)).digest('hex'),
      test: entry.test, testName: entry.name, green, red: null,
    };
    results.push(record);
    await retain(false);
    if (green.exit !== 0 || green.passed !== 1 || green.failed !== 0 ||
        green.assertions.length !== 1 || !green.assertions[0].name.includes(entry.name) ||
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
    record.red = red;
    await retain(false);
    if (red.exit === 0 || red.failed !== 1 || !red.assertions.some((row) => row.status === 'failed' && row.name.includes(entry.name) && row.failures.some(message => /AssertionError|expect\(/u.test(message)))) {
      throw new Error(`Mutation survived or produced no assertion failure: ${entry.id}`);
    }

    process.stdout.write(`${entry.id}: baseline ${green.passed} passed; mutant ${red.failed} failed\n`);
  }

  await writeFile(output, JSON.stringify({
    schemaVersion: 1,
    baselineSha,
    mode: unitOnly ? 'local-unit-only-incomplete' : 'unit-and-real-postgresql-no-provider',
    completed: !unitOnly,
    limitations: [
      'No browser, live model provider, complete worker journey or Solari acceptance was used.',
      ...(unitOnly ? ['The PostgreSQL closed-wait mutation was not run; Story 4.8 mutation acceptance remains incomplete.'] : []),
      'Removing the repository closed-wait guard changes the duplicate-answer refusal; independent state, revision and SQL immutability protections remain active.',
    ],
    results,
  }, null, 2) + '\n');
} finally {
  await rm(scratch, { recursive: true, force: true });
}
