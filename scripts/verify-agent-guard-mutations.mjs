/** Executable, bounded mutation evidence. Run only in a clean disposable detached worktree.
 * Default mode uses local unit tests; --browser launches local synthetic HTTP targets. Every mutation is restored in finally, even on failure.
 * Passing this subset is NOT complete Story 4.11 acceptance or live-provider evidence.
 */
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
const root = process.cwd();
function git(...args) { return spawnSync('git', args, { cwd: root, encoding: 'utf8' }); }
if (!git('rev-parse', '--git-dir').stdout.includes('/worktrees/')) throw new Error('Mutations require a linked disposable worktree.');
if (git('symbolic-ref', '-q', 'HEAD').status === 0) throw new Error('Use a disposable detached worktree; never mutate a development branch.');
if (git('diff', '--quiet').status !== 0 || git('diff', '--cached', '--quiet').status !== 0) throw new Error('Tracked work must be clean before mutation.');
const baselineSha = git('rev-parse', 'HEAD').stdout.trim();
const output = process.argv[2];
if (!output) throw new Error('Supply a secret-free JSON evidence output path.');
const browserMode = process.argv.includes('--browser');
const cases = [
  { id: 'escalation-agent-generated-label', file: 'apps/web/src/runs/EscalationPanel.tsx',
    before: '<UntrustedText field="AGENT-GENERATED question">', after: '<UntrustedText field="QUESTION">',
    test: 'apps/web/src/runs/agent-escalation-golden.test.ts', name: 'retains the generated label' },
  { id: 'golden-retrieved-objective-separation', file: 'packages/infrastructure/src/runs/agent-model-gateway.ts',
    before: 'objective: request.objective,', after: "objective: request.objective + request.retrieved.map(entry => entry.text).join(''),",
    test: 'tests/unit/agent-abuse-golden.test.ts', name: 'remains verbatim data' },
  { id: 'golden-invented-tool-refusal', file: 'packages/infrastructure/src/runs/agent-model-gateway.ts',
    before: 'const tool = tools.get(action.toolId);', after: 'const tool = tools.get(action.toolId) ?? request.tools[0];',
    test: 'tests/unit/agent-abuse-golden.test.ts', name: 'rejects an invented tool' },
  { id: 'seeded-write-action-gate', file: 'packages/domain/src/runs/tool-action.ts',
    before: '!isPermittedReadAction(action) ||\n    !(contract.permitted_actions as readonly string[]).includes(action)', after: 'false',
    test: 'tests/unit/scope-widening.test.ts', name: 'SW-2: the write verb' },
  { id: 'seeded-origin-action-gate', file: 'packages/domain/src/runs/tool-action.ts',
    before: 'if (!permitted) {', after: 'if (false) {', test: 'tests/unit/scope-widening.test.ts', name: 'SW-1:|SW-3:' },
  { id: 'credential-before-artifact-storage', file: 'packages/application/src/runs/evidence-package.ts',
    before: "if (guard.discloses(bytes)) throw new PopulationAcquisitionError('credential');", after: '/* MUTANT: disclose before storage */',
    test: 'packages/application/src/runs/agent-capture.test.ts', name: 'refuses secret bytes before storage' },
  { id: 'identity-single-snapshot', file: 'packages/application/src/runs/register-observations.ts',
    before: "if (hasIdentityGroundingSplit(record)) refuse('identity-grounding-split');", after: '/* MUTANT: permit split identity */',
    test: 'packages/application/src/runs/register-observations.test.ts', name: 'identity and values use different Evidence snapshots' },
  { id: 'missing-screenshot-evidence', file: 'packages/domain/src/runs/observation.ts',
    before: 'input.requiredCaptureKinds?.some(kind => !input.registeredCaptureKinds?.includes(kind))', after: 'false',
    test: 'packages/application/src/runs/execute-agent-work-item.test.ts', name: 'required screenshot capture is missing' },
  { id: 'unknown-tool-security-event', file: 'packages/application/src/runs/execute-agent-work-item.ts',
    before: 'if (decision.securityEvent) {', after: 'if (false) {',
    test: 'packages/application/src/runs/execute-agent-work-item.test.ts', name: 'logs a security denial for unknown-tool' },
  { id: 'invalid-provider-security-event', file: 'packages/application/src/runs/execute-agent-work-item.ts',
    before: "if (diagnostic !== 'model-invalid-response' && diagnostic !== 'model-invalid-action' && diagnostic !== 'model-policy-contradiction') return;", after: 'return;',
    test: 'packages/application/src/runs/execute-agent-work-item.test.ts', name: 'logs a security denial for provider-invalid-response' },
];
if (browserMode) cases.push(
  { id: 'browser-context-separation', file: 'packages/infrastructure/src/runs/browser-execution.ts',
    before: "const context = await browser.newContext({ serviceWorkers: 'block', acceptDownloads: false });",
    after: "const context = this.live.values().next().value?.context ?? await browser.newContext({ serviceWorkers: 'block', acceptDownloads: false });",
    test: 'tests/integration/agent-isolation.test.ts', name: 'keeps concurrent authenticated Runs', browser: true },
  { id: 'browser-cross-run-reference', file: 'packages/infrastructure/src/runs/browser-execution.ts',
    before: "if (!live || live.ref.runId !== ref.runId || live.ref.mode !== ref.mode) return null;",
    after: "if (!live || live.ref.mode !== ref.mode) return null;",
    test: 'tests/integration/agent-isolation.test.ts', name: 'keeps concurrent authenticated Runs', browser: true },
  { id: 'browser-workspace-egress', file: 'packages/infrastructure/src/runs/browser-execution.ts',
    before: 'return origins.some((origin) => withinOrigin(origin, candidate));', after: 'return true;',
    test: 'tests/integration/agent-isolation.test.ts', name: 'keeps concurrent authenticated Runs', browser: true },
  { id: 'browser-script-write-method', file: 'packages/infrastructure/src/runs/browser-execution.ts',
    before: '(isReadOnlyBrowserMethod(request.method()) || isArmedAuthenticationPost(live, request))', after: 'true',
    test: 'tests/integration/agent-isolation.test.ts', name: 'blocks a retrieved page from writing', browser: true },
  { id: 'browser-ended-workspace-state', file: 'packages/infrastructure/src/runs/browser-execution.ts',
    before: 'await this.teardown(ref.workspaceId, live.browser, live.context, bound);', after: '/* MUTANT: leave workspace open */',
    test: 'tests/integration/agent-abuse.test.ts', name: 'removes credential-bearing browser state', browser: true },
);
const scratch = await mkdtemp(join(tmpdir(), 'agent-mutations-'));
const results = [];
async function run(entry, label) {
  const reportPath = join(scratch, `${entry.id}-${label}.json`);
  const args = ['exec', 'vitest', 'run', ...(entry.browser ? ['--config', 'tests/integration/vitest.config.ts'] : []), entry.test, '-t', entry.name, '--reporter=json', `--outputFile=${reportPath}`];
  const child = spawnSync('pnpm', args, { cwd: root, env: { ...process.env, pnpm_config_verify_deps_before_run: 'false' }, encoding: 'utf8', timeout: 60000, maxBuffer: 8 * 1024 * 1024 });
  if (child.error || child.signal) throw new Error(`Test process did not finish: ${entry.id}/${label}`);
  const report = JSON.parse(await readFile(reportPath, 'utf8'));
  const assertions = report.testResults.flatMap(suite => suite.assertionResults).filter(row => row.status !== 'pending');
  return { exit: child.status, passed: report.numPassedTests, failed: report.numFailedTests,
    assertions: assertions.map(row => ({ name: row.fullName, status: row.status,
      failures: row.failureMessages.map(message => message.replaceAll(root, '<worktree>').slice(0, 2400)) })) };
}
try {
  for (const entry of cases) {
    const path = resolve(root, entry.file), source = await readFile(path, 'utf8');
    if (source.split(entry.before).length !== 2) throw new Error(`Mutation anchor drift: ${entry.id}`);
    const green = await run(entry, 'baseline');
    if (green.exit !== 0 || green.passed < 1 || green.failed !== 0) throw new Error(`Baseline failed or selected no tests: ${entry.id}`);
    let red;
    try { await writeFile(path, source.replace(entry.before, entry.after)); red = await run(entry, 'mutant'); }
    finally { await writeFile(path, source); }
    if (red.exit === 0 || red.failed < 1 || !red.assertions.some(row => row.status === 'failed')) throw new Error(`Mutation survived or produced no assertion failure: ${entry.id}`);
    results.push({ id: entry.id, file: entry.file, guard: entry.before, replacement: entry.after,
      sourceSha256: createHash('sha256').update(source).digest('hex'), testSha256: createHash('sha256').update(await readFile(entry.test)).digest('hex'), test: entry.test, testName: entry.name, green, red });
    await writeFile(output, JSON.stringify({ schemaVersion: 1, baselineSha, mode: browserMode ? 'local-unit-and-chromium' : 'local-unit-intercepted-provider', completed: false, results }, null, 2) + '\n');
    process.stdout.write(`${entry.id}: baseline ${green.passed} passed; mutant ${red.failed} failed\n`);
  }
  await writeFile(output, JSON.stringify({ schemaVersion: 1, baselineSha, mode: browserMode ? 'local-unit-and-chromium' : 'local-unit-intercepted-provider', completed: true,
    limitations: ['No real model service, actual worker journey or Solari acceptance. Browser results exist only when --browser was executed.', 'This is a selected guard subset; Story 4.11 requires the remaining matrix and per-test mutations.'], results }, null, 2) + '\n');
} finally { await rm(scratch, { recursive: true, force: true }); }
