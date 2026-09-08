/** Test-only mutation harness for real hydrated UI and worker-process abuse tests.
 * Requires a clean detached linked worktree, built packages, seeded throwaway E2E DB,
 * E2E account environment and local Chromium. No live model/Solari credentials.
 */
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
const root = process.cwd();
const git = (...args) => spawnSync('git', args, { cwd: root, encoding: 'utf8' });
if (!git('rev-parse', '--git-dir').stdout.includes('/worktrees/') || git('symbolic-ref', '-q', 'HEAD').status === 0) throw new Error('Use a disposable detached linked worktree.');
if (git('diff', '--quiet').status !== 0 || git('diff', '--cached', '--quiet').status !== 0) throw new Error('Tracked work must be clean.');
if (process.env.PLAYWRIGHT_BASE_URL) throw new Error('Tests must start the candidate web server, not reuse an external deployment.');
if (!process.argv[2]) throw new Error('Provide an absolute JSON evidence path.');
const output = resolve(process.argv[2]);
const baselineSha = git('rev-parse', 'HEAD').stdout.trim();
const cases = [
  { id: 'hydrated-no-preselected-answer', file: 'apps/web/src/runs/EscalationPanel.tsx',
    before: 'const [pendingOption, setPendingOption] = useState<EscalationOption | null>(null);',
    after: 'const [pendingOption, setPendingOption] = useState<EscalationOption | null>(wait.options[0] ?? null);',
    test: 'tests/e2e/agent-escalation-abuse.spec.ts', minimum: 5 },
  { id: 'hydrated-closed-answer-selection', file: 'apps/web/src/runs/EscalationPanel.tsx',
    before: 'onClick={() => setPendingOption(option)}', after: 'onClick={() => setPendingOption(options[0] ?? null)}',
    test: 'tests/e2e/agent-escalation-abuse.spec.ts', minimum: 5 },
  { id: 'worker-malformed-proposal-security-event', file: 'packages/application/src/runs/execute-agent-work-item.ts',
    before: "if (diagnostic !== 'model-invalid-response' && diagnostic !== 'model-invalid-action') return;", after: 'return;',
    test: 'tests/e2e/agent-worker-abuse.spec.ts', count: 3, rebuild: true },
  { id: 'retrieved-worker-security-denial', file: 'packages/application/src/runs/execute-agent-work-item.ts',
    before: "if (diagnostic !== 'model-invalid-response' && diagnostic !== 'model-invalid-action') return;", after: 'return;',
    test: 'tests/e2e/agent-retrieved-abuse.spec.ts', count: 6, rebuild: true },
  { id: 'terminal-worker-workspace-closure', file: 'packages/infrastructure/src/runs/browser-execution.ts',
    before: 'await this.teardown(ref.workspaceId, live.browser, live.context, bound);', after: 'void bound;',
    test: 'tests/e2e/agent-retrieved-abuse.spec.ts', count: 6, rebuild: '@intellifin/infrastructure' },
  { id: 'stored-frozen-objective-scope-rule', file: 'packages/infrastructure/drizzle/0014_young_vance_astro.sql',
    before: "IF OLD.state IN ('APPROVED', 'ACTIVE', 'RETIRED') OR OLD.frozen_review IS NOT NULL THEN", after: 'IF FALSE THEN',
    test: 'tests/e2e/agent-retrieved-abuse.spec.ts', count: 6, databaseMutation: true },
];
const scratch = await mkdtemp(join(tmpdir(), 'agent-abuse-e2e-mutations-'));
const results = [];
const verifiedBaselines = new Map();
let mutationSql;
async function frozenDefinitionMutation(entry) {
  const url = new URL(process.env.DATABASE_URL ?? '');
  if (!['localhost', '127.0.0.1'].includes(url.hostname) || url.pathname !== '/intellifin_e2e') throw new Error('Frozen-definition mutation requires the dedicated loopback intellifin_e2e database.');
  const { createSqlClient } = await import('../packages/infrastructure/dist/index.js');
  mutationSql ??= createSqlClient(url.href, { max: 1 });
  const [row] = await mutationSql`SELECT pg_get_functiondef('protect_procedure_definition()'::regprocedure) AS definition`;
  const original = String(row.definition);
  if (original.split(entry.before).length !== 2) throw new Error('Applied frozen-definition guard drift.');
  await mutationSql.unsafe(original.replace(entry.before, entry.after));
  return async () => { await mutationSql.unsafe(original); };
}
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
function build(packageName = '@intellifin/application') {
  const child = spawnSync('pnpm', ['--filter', packageName, 'build'], { cwd: root, env: process.env, encoding: 'utf8', timeout: 120000 });
  if (child.error || child.status !== 0) throw new Error('Candidate application build failed; no mutation result claimed.');
}
function specs(suites) { return suites.flatMap(suite => [...suite.specs, ...specs(suite.suites ?? [])]); }
async function run(entry, phase) {
  const reportPath = join(scratch, `${entry.id}-${phase}.json`);
  const child = spawnSync('pnpm', ['exec', 'playwright', 'test', entry.test, '--project=chromium', '--reporter=json'], {
    cwd: root, env: { ...process.env, CI: 'true', PLAYWRIGHT_JSON_OUTPUT_NAME: reportPath, pnpm_config_verify_deps_before_run: 'false' },
    encoding: 'utf8', timeout: 600000, maxBuffer: 16 * 1024 * 1024,
  });
  if (child.error || child.signal) throw new Error(`Process did not finish: ${entry.id}/${phase}`);
  const report = JSON.parse(await readFile(reportPath, 'utf8'));
  const reportErrors = report.errors.map(error => String(error.message ?? '').replaceAll(root, '<worktree>').slice(0, 2400));
  const assertions = specs(report.suites).filter(spec => spec.file.endsWith(entry.test.split('/').at(-1))).flatMap(spec => spec.tests.filter(test => test.projectName === 'chromium').map(test => ({
    name: spec.title, status: test.results.at(-1)?.status,
    errors: (test.results.at(-1)?.errors ?? []).map(error => String(error.message ?? '').replaceAll(root, '<worktree>').slice(0, 2400)),
  })));
  return { exit: child.status, reportErrors, passed: assertions.filter(row => row.status === 'passed').length, failed: assertions.filter(row => row.status === 'failed').length, assertions };
}
try {
  for (const entry of cases) {
    const path = resolve(root, entry.file), source = await readFile(path, 'utf8');
    if (source.split(entry.before).length !== 2) throw new Error(`Mutation anchor drift: ${entry.id}`);
    if (entry.rebuild) build(typeof entry.rebuild === 'string' ? entry.rebuild : undefined);
    const green = verifiedBaselines.get(entry.test) ?? await run(entry, 'baseline');
    await writeFile(output, JSON.stringify({ baselineSha, completed: false, pending: { id: entry.id, phase: 'baseline', result: green }, results }, null, 2) + '\n');
    if (green.reportErrors.length > 0 || green.exit !== 0 || (entry.count === undefined ? green.passed < entry.minimum : green.passed !== entry.count) || green.failed !== 0) { process.stderr.write(JSON.stringify(green, null, 2) + '\n'); throw new Error(`Baseline failed or test count changed: ${entry.id}`); }
    verifiedBaselines.set(entry.test, green);
    let red;
    let restoreDatabase;
    try {
      await writeFile(path, source.replace(entry.before, entry.after));
      if (entry.databaseMutation) restoreDatabase = await frozenDefinitionMutation(entry);
      if (entry.rebuild) build(typeof entry.rebuild === 'string' ? entry.rebuild : undefined);
      red = await run(entry, 'mutant');
    } finally { try { await restoreDatabase?.(); } finally { await writeFile(path, source); if (entry.rebuild) build(typeof entry.rebuild === 'string' ? entry.rebuild : undefined); } }
    // Every seeded case must itself fail an assertion, not time out or fail setup.
    await writeFile(output, JSON.stringify({ baselineSha, completed: false, pending: { id: entry.id, phase: 'mutant', green, result: red }, results }, null, 2) + '\n');
    if (red.reportErrors.length > 0 || red.exit === 0 || red.failed !== green.passed || red.assertions.some(row => !row.errors.some(error => /expect\(|AssertionError/u.test(error)))) throw new Error(`Mutation survived or lacked per-case assertion failures: ${entry.id}`);
    results.push({ id: entry.id, source: entry.file, guard: entry.before, replacement: entry.after, sourceSha256: digest(source), test: entry.test, testSha256: digest(await readFile(entry.test)), green, red });
    await writeFile(output, JSON.stringify({ baselineSha, mode: 'local-chromium-hydrated-ui-and-worker-intercepted-provider', completed: false, results }, null, 2) + '\n');
    process.stdout.write(`${entry.id}: baseline ${green.passed} passed; mutant ${red.failed} failed\n`);
  }
  await writeFile(output, JSON.stringify({ baselineSha, mode: 'local-chromium-hydrated-ui-and-worker-intercepted-provider', completed: true, limitations: ['No live model or Solari acceptance.', 'This selected matrix does not replace every Story 4.11 case.'], results }, null, 2) + '\n');
} finally { await mutationSql?.end({ timeout: 5 }); await rm(scratch, { recursive: true, force: true }); }
