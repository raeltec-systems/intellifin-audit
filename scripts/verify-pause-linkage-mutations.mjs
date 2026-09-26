/**
 * Executable Story 10.6 mutation evidence for exact pause boundaries and durable resume provenance. Run only in a clean disposable detached linked worktree.
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
  throw new Error('Pause linkage mutations require a linked disposable worktree.');
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
  throw new Error('DATABASE_URL is required for the real PostgreSQL pause-linkage mutations.');
}
if (!unitOnly) {
  const database = new URL(process.env['DATABASE_URL']);
  if (!['localhost', '127.0.0.1', '[::1]', 'postgres', 'db'].includes(database.hostname) ||
      !/(?:^|[_-])(?:test|ci)(?:[_-]|$)/i.test(database.pathname.slice(1)))
    throw new Error('Story 10.6 mutations require a disposable local test database.');
}
const cases = [
  {
    "id": "sign-in-resume-link-removed",
    "file": "packages/application/src/runs/execute-agent-steps.ts",
    "before": "await event(context, 'sign-in-attempt-started', 'RUNNING', checkpoint, {\n        resumedFromWaitId: await context.readPendingResumeWait(),",
    "after": "await event(context, 'sign-in-attempt-started', 'RUNNING', checkpoint, {\n        resumedFromWaitId: null,",
    "test": "packages/application/src/runs/execute-agent-steps.test.ts",
    "name": "binds only the first sign-in attempt to its pending resumed wait",
    "requirement": "Story 10.6: exact durable pause and resume linkage."
  },
  {
    "id": "public-access-resume-link-removed",
    "file": "packages/application/src/runs/execute-agent-steps.ts",
    "before": "await event(context, 'public-access-attempt-started', 'RUNNING', checkpoint, {\n        resumedFromWaitId: await context.readPendingResumeWait(),",
    "after": "await event(context, 'public-access-attempt-started', 'RUNNING', checkpoint, {\n        resumedFromWaitId: null,",
    "test": "packages/application/src/runs/execute-agent-steps.test.ts",
    "name": "binds only the first public-access attempt to its pending resumed wait",
    "requirement": "Story 10.6: exact durable pause and resume linkage."
  },
  {
    "id": "reference-resume-link-removed",
    "file": "packages/application/src/runs/execute-adapter-steps.ts",
    "before": "await event(context, 'reference-attempt-started', 'RUNNING', checkpoint, {\n        resumedFromWaitId: await context.readPendingResumeWait(),",
    "after": "await event(context, 'reference-attempt-started', 'RUNNING', checkpoint, {\n        resumedFromWaitId: null,",
    "test": "packages/application/src/runs/execute-adapter-steps.test.ts",
    "name": "binds only the first reference attempt to its pending resumed wait",
    "requirement": "Story 10.6: exact durable pause and resume linkage."
  },
  {
    "id": "work-item-resume-link-removed",
    "file": "packages/application/src/runs/execute-adapter-steps.ts",
    "before": "await event(context, 'work-item-attempt-started', 'RUNNING', checkpoint, {\n        resumedFromWaitId: await context.readPendingResumeWait(),",
    "after": "await event(context, 'work-item-attempt-started', 'RUNNING', checkpoint, {\n        resumedFromWaitId: null,",
    "test": "packages/application/src/runs/execute-adapter-steps.test.ts",
    "name": "binds only the first work-item attempt to its pending resumed wait",
    "requirement": "Story 10.6: exact durable pause and resume linkage."
  },
  {
    "id": "skip-completed-agent-work",
    "file": "packages/application/src/runs/execute-agent-work-item.ts",
    "before": "await lifecycleBoundary(undefined, items.find(candidate => candidate.ordinal >= item.ordinal && !isTerminalWorkItem(candidate)))",
    "after": "await lifecycleBoundary(undefined, item)",
    "test": "packages/application/src/runs/execute-agent-work-item.test.ts",
    "name": "pauses at the next pending Work Item after an earlier item is terminal",
    "requirement": "Story 10.6: exact durable pause and resume linkage."
  },
  {
    "id": "skip-acquired-reference",
    "file": "packages/application/src/runs/execute-adapter-steps.ts",
    "before": "canceledAtBoundary(pendingReference?.stepId ?? pendingItem?.stepId, pendingReference ? null : pendingItem?.workItemId ?? null)",
    "after": "canceledAtBoundary(entry.stepId)",
    "test": "packages/application/src/runs/execute-adapter-steps.test.ts",
    "name": "pauses at pending adapter work after an earlier Reference Source was acquired",
    "requirement": "Story 10.6: exact durable pause and resume linkage."
  },
  {
    "id": "execution-run-guard-removed",
    "file": "packages/infrastructure/src/runs/pause-linkage.ts",
    "before": "ON execution.run_id = ${runId}",
    "after": "ON true",
    "test": "tests/integration/pause-run.test.ts",
    "name": "rejects a causal link whose execution contradicts the recorded Run",
    "requirement": "Story 10.6: exact durable pause and resume linkage.",
    "config": "tests/integration/vitest.config.ts"
  },
  {
    "id": "execution-step-guard-removed",
    "file": "packages/infrastructure/src/runs/pause-linkage.ts",
    "before": "AND execution.plan_step_id = started.payload ->> 'stepId'",
    "after": "",
    "test": "tests/integration/pause-run.test.ts",
    "name": "rejects a causal link whose execution contradicts the recorded Step",
    "requirement": "Story 10.6: exact durable pause and resume linkage.",
    "config": "tests/integration/vitest.config.ts"
  },
  {
    "id": "execution-attempt-guard-removed",
    "file": "packages/infrastructure/src/runs/pause-linkage.ts",
    "before": "AND execution.attempt::text = started.payload ->> 'attempt'",
    "after": "",
    "test": "tests/integration/pause-run.test.ts",
    "name": "rejects a causal link whose execution contradicts the recorded attempt",
    "requirement": "Story 10.6: exact durable pause and resume linkage.",
    "config": "tests/integration/vitest.config.ts"
  },
  {
    "id": "unique-resume-link-guard-removed",
    "file": "packages/infrastructure/src/runs/pause-linkage.ts",
    "before": "Number(row.link_count) === 1",
    "after": "Number(row.link_count) >= 1",
    "test": "tests/integration/pause-run.test.ts",
    "name": "links only the first started attempt to each exact resumed wait, including rollback and later pauses",
    "requirement": "Story 10.6: exact durable pause and resume linkage.",
    "config": "tests/integration/vitest.config.ts"
  },
  {
    "id": "resume-consumption-guard-removed",
    "file": "packages/infrastructure/src/runs/pause-linkage.ts",
    "before": "AND started.payload ->> 'resumedFromWaitId' = latest.wait_id",
    "after": "AND false",
    "test": "tests/integration/pause-run.test.ts",
    "name": "links only the first started attempt to each exact resumed wait, including rollback and later pauses",
    "requirement": "Story 10.6: exact durable pause and resume linkage.",
    "config": "tests/integration/vitest.config.ts"
  }
,
{
  "id": "human-match-run-scope",
  "file": "packages/infrastructure/src/runs/human-match-provenance.ts",
  "before": "AND w.run_id=o.run_id",
  "after": "",
  "test": "tests/integration/record-review.test.ts",
  "name": "refuses invalid human match provenance through detail and queue: foreign-wait",
  "config": "tests/integration/vitest.config.ts",
  "requirement": "Story 10.6: exact visibility provenance and frozen binding privacy."
},
{
  "id": "human-match-digest",
  "file": "packages/infrastructure/src/runs/human-match-provenance.ts",
  "before": "AND o.link->>'digest'=o.digest",
  "after": "",
  "test": "tests/integration/record-review.test.ts",
  "name": "refuses invalid human match provenance through detail and queue: wrong-digest",
  "config": "tests/integration/vitest.config.ts",
  "requirement": "Story 10.6: exact visibility provenance and frozen binding privacy."
},
{
  "id": "human-match-contradiction",
  "file": "packages/infrastructure/src/runs/human-match-provenance.ts",
  "before": "o.link_count=1",
  "after": "TRUE",
  "test": "tests/integration/record-review.test.ts",
  "name": "refuses invalid human match provenance through detail and queue: contradictory-links",
  "config": "tests/integration/vitest.config.ts",
  "requirement": "Story 10.6: exact visibility provenance and frozen binding privacy."
},

{
  "id": "capture-permitted-missing",
  "file": "packages/infrastructure/src/runs/replay-capture-gaps.ts",
  "before": "(a.capture='SUPPRESSED' OR (a.capture='PERMITTED' AND NOT EXISTS",
  "after": "(a.capture='SUPPRESSED' OR (a.capture='SUPPRESSED' AND NOT EXISTS",
  "test": "tests/integration/replay-assets.test.ts",
  "name": "reads exact missing and intentionally suppressed positions separately for Replay",
  "config": "tests/integration/vitest.config.ts",
  "requirement": "Story 10.6: exact visibility provenance and frozen binding privacy."
},
{
  "id": "frozen-secondary-key-mask",
  "file": "packages/application/src/runs/record-review.ts",
  "before": "keys.some(key =>",
  "after": "keys.every(key =>",
  "test": "packages/application/src/runs/human-match-masking.test.ts",
  "name": "removes candidate source text when full_name is sensitive",
  "requirement": "Story 10.6: exact visibility provenance and frozen binding privacy."
},
{
  "id": "legacy-snapshot-mask",
  "file": "apps/web/src/runs/HumanMatch.tsx",
  "before": "decision.answerMasked !== false",
  "after": "false",
  "test": "apps/web/src/runs/RecordReview.test.ts",
  "name": "keeps every target decision attributable in the queue and guards old presentation snapshots",
  "requirement": "Story 10.6: exact visibility provenance and frozen binding privacy."
},
{
  "id": "human-platform-distinction",
  "file": "apps/web/src/runs/HumanMatch.tsx",
  "before": "if (matchOrigin !== 'human-matched') return null;",
  "after": "if (false) return null;",
  "test": "apps/web/src/runs/HumanMatch.test.ts",
  "name": "never labels a platform match as human even with stray provenance",
  "requirement": "Story 10.6: exact visibility provenance and frozen binding privacy."
},
{
  "id": "live-adapter-digest",
  "file": "apps/web/app/runs/[id]/live/page.tsx",
  "before": "digest: step.evidenceId === null ? null : digestByEvidence.get(step.evidenceId) ?? null,",
  "after": "digest: null,",
  "test": "apps/web/app/runs/[id]/live/page.adapter-evidence.test.ts",
  "name": "resolves the exact registered artifact independently of the evidence overview prefix",
  "requirement": "Story 10.6: exact visibility provenance and frozen binding privacy."
},
{
  "id": "fresh-matching-decision",
  "file": "packages/application/src/runs/register-observations.ts",
  "before": "...(fresh.some(entry => entry.record.matchOrigin === 'human-matched' && entry.item.matchingWaitId !== undefined) ?",
  "after": "...(false ?",
  "test": "packages/application/src/runs/register-observations.test.ts",
  "name": "binds only fresh human matches to the exact answered wait without changing the Observation digest",
  "requirement": "Story 10.6: exact visibility provenance and frozen binding privacy."
}
,
{
  "id": "source-record-count",
  "file": "packages/infrastructure/src/runs/run-detail-repository.ts",
  "before": "array_agg(observation_id) AS observation_ids,count(*) OVER ()::int AS total",
  "after": "array_agg(observation_id) AS observation_ids,sum(count(*)) OVER ()::int AS total",
  "test": "tests/integration/record-review.test.ts",
  "name": "counts one human-matched source record while retaining both target decisions",
  "config": "tests/integration/vitest.config.ts",
  "requirement": "Story 10.6: count source records, not target Observations."
}
].filter(entry => !unitOnly || !entry.config);

const scratch = await mkdtemp(join(tmpdir(), 'pause-linkage-mutations-'));
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
      ...(unitOnly ? ['The PostgreSQL linkage mutations were not run; Story 10.6 mutation acceptance remains incomplete.'] : []),
      'Database cases exercise exact execution Run, step, attempt, uniqueness and one-time causal consumption guards.',
    ],
    results,
  }, null, 2) + '\n');
} finally {
  await rm(scratch, { recursive: true, force: true });
}
