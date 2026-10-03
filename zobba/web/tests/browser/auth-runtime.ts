import { spawn, spawnSync } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { readFileSync, readdirSync, readlinkSync } from 'node:fs';
import { once } from 'node:events';
import { request as httpsRequest } from 'node:https';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { createServer as createViteServer } from 'vite';
import type { ViteDevServer } from 'vite';
import { buildEvidenceApiHarness, DatabaseProxy, freePort, port, sanitizedRuntimeEnvironment, sanitizedStorageEnvironment, stop } from './runtime';
import { databaseEndpoint } from './database-endpoint.ts';
import { protectProxyErrors } from '../../proxy-errors';
import { startEvidenceS3Fixture } from './evidence-s3.ts';
import type { EvidenceS3Fixture } from './evidence-s3.ts';

const root = fileURLToPath(new URL('../../..', import.meta.url));
const fixtureRoot = resolve(root, 'fixtures/oidc');

function testDatabase(name: string): URL {
  const value = process.env[name];
  if (!value) throw new Error(`Set ${name} to the dedicated disposable test database.`);
  const url = new URL(value);
  if (!['postgres:', 'postgresql:'].includes(url.protocol) ||
    !['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname) ||
    !decodeURIComponent(url.pathname).endsWith('_test')) {
    throw new Error('Authentication browser checks require an explicitly configured loopback *_test database.');
  }
  return url;
}

function run(command: string, args: string[], env: NodeJS.ProcessEnv): string {
  const result = spawnSync(command, args, { cwd: root, env, encoding: 'utf8' });
  if (result.error || result.status !== 0) throw new Error(`Owned browser fixture command failed: ${command} ${args[0] ?? ''}`);
  return result.stdout;
}

function databaseMutationEnvironment(environment: NodeJS.ProcessEnv, database: URL, host: string, port: number): NodeJS.ProcessEnv {
  return {
    ...environment,
    PGHOST: host,
    PGPORT: String(port),
    PGUSER: decodeURIComponent(database.username),
    PGPASSWORD: decodeURIComponent(database.password),
    PGDATABASE: decodeURIComponent(database.pathname.slice(1)),
    PGCONNECT_TIMEOUT: '5',
    PGOPTIONS: '-c statement_timeout=10000 -c lock_timeout=5000',
  };
}

const sqlAsyncPhases = [
  'evidence-barrier-completion',
  'evidence-observe-session-barrier',
  'evidence-observe-metadata-lock',
  'evidence-admin-completion',
  'evidence-observe-admin-lock',
] as const;
export type SqlAsyncPhase = typeof sqlAsyncPhases[number];

function runSqlAsync(statement: string, environment: NodeJS.ProcessEnv, phase?: SqlAsyncPhase): Promise<void> {
  if (phase !== undefined && !sqlAsyncPhases.includes(phase)) {
    return Promise.reject(new Error('Synthetic browser database mutation failed. Invalid diagnostic phase.'));
  }
  return new Promise<void>((resolveSql, rejectSql) => {
    let settled = false;
    let timeout: NodeJS.Timeout | undefined;
    let forceKill: NodeJS.Timeout | undefined;
    let sqlstate: string | null = null;
    let diagnosticPrefix = '';
    let diagnosticBytes = 0;
    const child = spawn('psql', ['-X', '-q', '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=sqlstate'], {
      cwd: root, env: environment, stdio: ['pipe', 'ignore', 'pipe'],
    });
    // Never persist or emit raw stderr. Parse only a SQLSTATE from a bounded
    // prefix; connection errors without a server SQLSTATE remain unclassified.
    child.stderr.on('data', (chunk: Buffer) => {
      if (settled || sqlstate !== null || diagnosticBytes >= 4096) return;
      const prefix = chunk.subarray(0, 4096 - diagnosticBytes); diagnosticBytes += prefix.length;
      diagnosticPrefix += prefix.toString('utf8');
      const match = /\b(?:ERROR|FATAL|PANIC):[ \t]+([0-9A-Z]{5})(?=[\r\n]|$)/.exec(diagnosticPrefix);
      if (match?.[1]) { sqlstate = match[1]; diagnosticPrefix = ''; }
    });
    const failure = (source: 'spawn' | 'stdin' | 'close' | 'deadline', exit_code: number | null = null, signal: NodeJS.Signals | null = null) =>
      new Error(`Synthetic browser database mutation failed. ${JSON.stringify({ phase: phase ?? 'unlabelled', source, sqlstate, exit_code, signal })}`);
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      diagnosticPrefix = '';
      if (timeout) clearTimeout(timeout);
      if (error) rejectSql(error);
      else resolveSql();
    };
    child.once('error', () => finish(failure('spawn')));
    child.stdin.on('error', () => finish(failure('stdin')));
    child.once('close', (code, signal) => {
      if (forceKill) clearTimeout(forceKill);
      if (code === 0) finish();
      else finish(failure('close', code, signal));
    });
    timeout = setTimeout(() => {
      child.kill('SIGTERM');
      forceKill = setTimeout(() => child.kill('SIGKILL'), 500);
      finish(failure('deadline'));
    }, 10_000);
    try {
      child.stdin.end(statement);
    } catch {
      finish(failure('stdin'));
      child.kill('SIGTERM');
    }
  });
}

type EvidenceLockSnapshot = {
  api_connections: number; api_unsettled: number;
  metadata: Array<{ pid: number; blockers: number[] }>;
  admin_waiting: boolean; admin_blockers: number[];
};
export interface EvidenceSessionBarrier {
  proof: {
    holder_pid: number | null; metadata_pid: number | null; admin_pid: number | null;
    idle: EvidenceLockSnapshot | null; metadata: EvidenceLockSnapshot | null; chain: EvidenceLockSnapshot | null;
    holder_completed: boolean; admin_completed: boolean; release: 'none' | 'commit' | 'rollback';
    phases: string[];
  };
  prepare: () => Promise<void>;
  observeMetadata: () => Promise<void>;
  startAdmin: () => Promise<void>;
  observeChain: () => Promise<void>;
  commit: () => Promise<void>;
  close: () => Promise<void>;
}

/** One owned interactive child; only fixed fixture SQL enters its stdin. */
function evidenceSqlChild(environment: NodeJS.ProcessEnv, role: 'holder' | 'admin', deadline: number) {
  let ended = false, exited = false, error: Error | null = null, sqlstate: string | null = null;
  let stdout = '', stderr = '', stderrBytes = 0;
  let pending: { resolve: (line: string) => void; reject: (error: Error) => void } | null = null;
  let forceKill: NodeJS.Timeout | undefined;
  let markClosed!: () => void;
  const closed = new Promise<void>(resolveClosed => { markClosed = resolveClosed; });
  const child = spawn('psql', ['-X', '-q', '-t', '-A', '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=sqlstate'], {
    cwd: root, env: environment, stdio: ['pipe', 'pipe', 'pipe'],
  });
  const fail = (source: 'spawn' | 'stdin' | 'frame' | 'close' | 'deadline', code: number | null = null, signal: NodeJS.Signals | null = null) => {
    error ??= new Error(`Synthetic browser database mutation failed. ${JSON.stringify({ phase: `evidence-owned-${role}`, source, sqlstate, code, signal })}`);
    pending?.reject(error); pending = null;
  };
  const terminate = () => {
    if (exited) return;
    child.kill('SIGTERM'); forceKill ??= setTimeout(() => child.kill('SIGKILL'), 500);
  };
  const timeout = setTimeout(() => { fail('deadline'); terminate(); }, Math.max(0, deadline - Date.now()));
  child.once('error', () => { fail('spawn'); terminate(); });
  child.stdin.on('error', () => { fail('stdin'); terminate(); });
  child.stderr.on('data', (chunk: Buffer) => {
    if (sqlstate || stderrBytes >= 4096) return;
    const prefix = chunk.subarray(0, 4096 - stderrBytes); stderrBytes += prefix.length; stderr += prefix.toString('utf8');
    const match = /\b(?:ERROR|FATAL|PANIC):[ \t]+([0-9A-Z]{5})(?=[\r\n]|$)/.exec(stderr);
    if (match?.[1]) { sqlstate = match[1]; stderr = ''; }
  });
  child.stdout.on('data', (chunk: Buffer) => {
    // Each fixed command emits exactly one short frame. Never expose raw output.
    if (Buffer.byteLength(stdout) + chunk.length > 4096) { fail('frame'); terminate(); return; }
    stdout += chunk.toString('utf8');
    for (let newline = stdout.indexOf('\n'); newline >= 0; newline = stdout.indexOf('\n')) {
      const line = stdout.slice(0, newline); stdout = stdout.slice(newline + 1);
      if (!pending) { fail('frame'); terminate(); return; }
      const receiver = pending; pending = null; receiver.resolve(line);
    }
  });
  child.once('close', (code, signal) => {
    exited = true; clearTimeout(timeout); if (forceKill) clearTimeout(forceKill);
    if (code !== 0 || !ended || pending) fail('close', code, signal);
    stderr = ''; stdout = ''; markClosed();
  });
  return {
    exchange(statement: string): Promise<string> {
      if (error) return Promise.reject(error);
      if (ended || exited || pending) return Promise.reject(new Error('Owned evidence SQL phase is invalid.'));
      const reply = new Promise<string>((resolveLine, rejectLine) => { pending = { resolve: resolveLine, reject: rejectLine }; });
      try { child.stdin.write(`${statement}\n`); } catch { fail('stdin'); terminate(); }
      return reply;
    },
    end(statement: 'COMMIT;' | 'ROLLBACK;') {
      if (ended || exited) return;
      ended = true;
      try { child.stdin.end(`${statement}\n`); } catch { fail('stdin'); terminate(); }
    },
    async complete() { await closed; if (error) throw error; },
  };
}

function ownedEvidenceSessionBarrier(environment: NodeJS.ProcessEnv, apiName: string): EvidenceSessionBarrier {
  if (!/^zobba-browser-api-[0-9]+-[0-9]+$/.test(apiName)) throw new Error('Invalid owned API identity.');
  const proof: EvidenceSessionBarrier['proof'] = { holder_pid: null, metadata_pid: null, admin_pid: null,
    idle: null, metadata: null, chain: null, holder_completed: false, admin_completed: false, release: 'none', phases: [] };
  let holder: ReturnType<typeof evidenceSqlChild> | undefined, admin: ReturnType<typeof evidenceSqlChild> | undefined;
  let deadline = 0, phase: 'new' | 'held' | 'metadata' | 'admin' | 'chain' | 'committed' | 'closed' = 'new';
  const requirePhase = (expected: typeof phase) => { if (phase !== expected) throw new Error('Owned evidence barrier phase is invalid.'); };
  const pid = (line: string) => { const match = /^ready:([1-9][0-9]{0,9})$/.exec(line), value = Number(match?.[1]); if (!Number.isSafeInteger(value) || value < 1 || value > 2147483647) throw new Error('Owned evidence SQL readiness was invalid.'); return value; };
  const readSnapshot = async (): Promise<EvidenceLockSnapshot> => {
    const line = await holder!.exchange(`DO $$ BEGIN PERFORM pg_stat_clear_snapshot(); END $$;
WITH api AS MATERIALIZED (SELECT pid,state,xact_start,wait_event_type,query FROM pg_catalog.pg_stat_activity WHERE datname=current_database() AND application_name='${apiName}'),
metadata AS MATERIALIZED (SELECT pid,pg_blocking_pids(pid) AS blockers FROM api WHERE state='active' AND wait_event_type='Lock' AND query='SELECT public.evidence_session_locked($1,$2)' AND ${proof.holder_pid ?? 0}=ANY(pg_blocking_pids(pid)))
SELECT 'snapshot:'||json_build_object('api_connections',(SELECT count(*) FROM api),'api_unsettled',(SELECT count(*) FROM api WHERE state<>'idle' OR xact_start IS NOT NULL),
'metadata',coalesce((SELECT json_agg(json_build_object('pid',pid,'blockers',blockers) ORDER BY pid) FROM metadata),'[]'::json),
'admin_waiting',EXISTS(SELECT 1 FROM pg_catalog.pg_stat_activity WHERE datname=current_database() AND pid=${proof.admin_pid ?? 0} AND application_name='${apiName}-admin' AND state='active' AND wait_event_type='Lock' AND query='UPDATE public.identities SET display_name=display_name WHERE id=''actor-a'';'),
'admin_blockers',pg_blocking_pids(${proof.admin_pid ?? 0}))::text;`);
    let value: unknown;
    try { if (!line.startsWith('snapshot:')) throw new Error(); value = JSON.parse(line.slice(9)); } catch { throw new Error('Owned evidence lock snapshot was invalid.'); }
    const validPid = (value: unknown): value is number => Number.isSafeInteger(value) && typeof value === 'number' && value > 0 && value <= 2147483647;
    const validPids = (value: unknown): value is number[] => Array.isArray(value) && value.length <= 32 && value.every(validPid);
    if (!value || typeof value !== 'object') throw new Error('Owned evidence lock snapshot was invalid.');
    const row = value as Record<string, unknown>;
    if (typeof row.api_connections !== 'number' || !Number.isInteger(row.api_connections) || row.api_connections < 1 || row.api_connections > 32 ||
      typeof row.api_unsettled !== 'number' || !Number.isInteger(row.api_unsettled) || row.api_unsettled < 0 || row.api_unsettled > row.api_connections ||
      !Array.isArray(row.metadata) || row.metadata.length > 32 || !row.metadata.every(item => item && typeof item === 'object' && validPid(item.pid) && validPids(item.blockers)) ||
      typeof row.admin_waiting !== 'boolean' || !validPids(row.admin_blockers)) throw new Error('Owned evidence lock snapshot was invalid.');
    return { api_connections: row.api_connections, api_unsettled: row.api_unsettled,
      metadata: row.metadata.map(item => ({ pid: item.pid as number, blockers: item.blockers as number[] })), admin_waiting: row.admin_waiting, admin_blockers: row.admin_blockers };
  };
  const observe = async (name: 'idle' | 'metadata' | 'chain', accepted: (snapshot: EvidenceLockSnapshot) => boolean) => {
    let expired = false, timer: NodeJS.Timeout | undefined;
    const limit = new Promise<never>((_, reject) => { timer = setTimeout(() => { expired = true; reject(new Error(`Owned evidence ${name} observation timed out.`)); }, Math.max(0, Math.min(2000, deadline - Date.now()))); });
    const observations = async () => {
      while (!expired) { const snapshot = await readSnapshot(); if (!expired && accepted(snapshot)) { proof[name] = snapshot; proof.phases.push(`${name}-observed`); return snapshot; } }
      throw new Error(`Owned evidence ${name} observation timed out.`);
    };
    try { return await Promise.race([observations(), limit]); } finally { expired = true; if (timer) clearTimeout(timer); }
  };
  const metadataOwned = (snapshot: EvidenceLockSnapshot) => snapshot.api_unsettled === 1 && snapshot.metadata.length === 1 &&
    snapshot.metadata[0]!.blockers.length === 1 && snapshot.metadata[0]!.blockers[0] === proof.holder_pid;
  const completeChildren = async () => {
    const results = await Promise.allSettled([
      ...(holder ? [holder.complete().then(() => { proof.holder_completed = true; })] : []),
      ...(admin ? [admin.complete().then(() => { proof.admin_completed = true; })] : []),
    ]);
    const errors = results.flatMap(result => result.status === 'rejected' ? [result.reason as unknown] : []);
    if (errors.length === 1) throw errors[0];
    if (errors.length > 1) throw new AggregateError(errors, 'Owned evidence SQL children failed.');
  };
  return {
    proof,
    async prepare() {
      requirePhase('new'); deadline = Date.now() + 10_000;
      holder = evidenceSqlChild(environment, 'holder', deadline);
      await observe('idle', snapshot => snapshot.api_unsettled === 0);
      proof.holder_pid = pid(await holder.exchange(`BEGIN; SET LOCAL application_name='${apiName}-holder'; DO $$ BEGIN PERFORM 1 FROM public.sessions WHERE actor_id='actor-a' FOR UPDATE; IF NOT FOUND THEN RAISE EXCEPTION 'Owned session is missing'; END IF; END $$; SELECT 'ready:'||pg_backend_pid();`));
      phase = 'held'; proof.phases.push('session-lock-ready');
    },
    async observeMetadata() { requirePhase('held'); const snapshot = await observe('metadata', metadataOwned); proof.metadata_pid = snapshot.metadata[0]!.pid; phase = 'metadata'; },
    async startAdmin() {
      requirePhase('metadata'); admin = evidenceSqlChild(environment, 'admin', deadline);
      proof.admin_pid = pid(await admin.exchange(`BEGIN; SET LOCAL application_name='${apiName}-admin'; SELECT 'ready:'||pg_backend_pid();\nUPDATE public.identities SET display_name=display_name WHERE id='actor-a';`));
      phase = 'admin'; proof.phases.push('admin-started');
    },
    async observeChain() {
      requirePhase('admin'); await observe('chain', snapshot => metadataOwned(snapshot) && snapshot.metadata[0]!.pid === proof.metadata_pid && snapshot.admin_waiting && snapshot.admin_blockers.length === 1 && snapshot.admin_blockers[0] === proof.metadata_pid);
      phase = 'chain';
    },
    async commit() {
      requirePhase('chain'); proof.release = 'commit'; proof.phases.push('owned-chain-commit');
      holder!.end('COMMIT;'); admin!.end('COMMIT;'); await completeChildren(); phase = 'committed';
    },
    async close() {
      if (phase === 'closed') return;
      if (proof.release === 'none') { proof.release = 'rollback'; proof.phases.push('cleanup-rollback'); holder?.end('ROLLBACK;'); admin?.end('ROLLBACK;'); }
      try { await completeChildren(); } finally { phase = 'closed'; }
    },
  };
}

function resetSyntheticFixture(database: URL, host: string, port: number, schemaVersion = 11): void {
  const result = spawnSync('psql', ['-X', '-q', '-1', '-v', 'ON_ERROR_STOP=1'], {
    cwd: root,
    encoding: 'utf8',
    // The caller has verified the isolated *_test database. Keep production
    // TRUNCATE refusal intact: remove this synthetic fixture in dependency order
    // within psql's single transaction, including the deferred Task-cycle and
    // Admin-continuity checks. This is never an application lifecycle operation.
    input: `
DELETE FROM public.model_tool_bindings;
DELETE FROM public.model_results;
DELETE FROM public.model_invocations;
DELETE FROM public.model_catalogues;
DELETE FROM public.model_profiles;
DELETE FROM public.knowledge_withdrawals;
DELETE FROM public.knowledge_publications;
DELETE FROM public.knowledge_invalidations;
DELETE FROM public.knowledge_source_corrections;
DELETE FROM public.knowledge_captures;
DELETE FROM public.knowledge_layout_events;
DELETE FROM public.knowledge_events;
DELETE FROM public.knowledge_records;
DELETE FROM public.task_skill_selections;
DELETE FROM public.skill_status;
DELETE FROM public.skill_events;
DELETE FROM public.skill_versions;
DELETE FROM public.task_methodology_changes;
DELETE FROM public.task_methodology_heads;
DELETE FROM public.task_methodology_bindings;
DELETE FROM public.methodology_recalls;
DELETE FROM public.methodology_assignments;
DELETE FROM public.methodology_versions;
DELETE FROM public.methodology_events;
DELETE FROM public.operation_receipts;
DELETE FROM public.operation_receipt_slots;
DELETE FROM public.operation_receipt_producers;
DELETE FROM public.operation_claims;
DELETE FROM public.operation_attempts;
DELETE FROM public.operation_decisions;
DELETE FROM public.operations;
DELETE FROM public.task_observations;
DELETE FROM public.task_receipt_slots;
DELETE FROM public.task_claims;
DELETE FROM public.task_deliveries;
DELETE FROM public.task_wakeups;
DELETE FROM public.task_events;
DELETE FROM public.task_commands;
DELETE FROM public.task_cycles;
DELETE FROM public.tasks;
DELETE FROM public.task_counters;
DELETE FROM public.permission_heads;
DELETE FROM public.permission_versions;
DELETE FROM public.trusted_attachment_metadata;
DELETE FROM public.evidence_originals;
DELETE FROM public.evidence_reservations;
DELETE FROM public.membership_events;
DELETE FROM public.membership_invitations;
DELETE FROM public.engagement_assignments;
DELETE FROM public.organisation_memberships;
DELETE FROM public.membership_versions;
DELETE FROM public.engagements;
DELETE FROM public.clients;
DELETE FROM public.organisations;
DELETE FROM public.sessions;
DELETE FROM public.identities;
UPDATE public.zobba_bootstrap SET local_fixture_issuer=NULL WHERE singleton;`.split("\n").filter(line => (schemaVersion >= 10 || !line.startsWith("DELETE FROM public.knowledge_")) && (schemaVersion >= 11 || !line.startsWith("DELETE FROM public.model_"))).join("\n"),
    timeout: 10_000,
    env: {
      ...sanitizedRuntimeEnvironment(),
      PGHOST: host,
      PGPORT: String(port),
      PGUSER: decodeURIComponent(database.username),
      PGPASSWORD: decodeURIComponent(database.password),
      PGDATABASE: decodeURIComponent(database.pathname.slice(1)),
      PGCONNECT_TIMEOUT: '5',
      PGOPTIONS: '-c statement_timeout=10000 -c lock_timeout=5000',
    },
  });
  if (result.error || result.status !== 0) throw new Error('Synthetic browser fixture reset refused.');
}

async function ready(url: string, ca: Buffer): Promise<boolean> {
  return new Promise((resolveReady) => {
    const request = httpsRequest(url, { ca, timeout: 1000 }, (response) => {
      response.resume(); resolveReady(response.statusCode === 200);
    });
    request.on('error', () => resolveReady(false));
    request.on('timeout', () => { request.destroy(); resolveReady(false); });
    request.end();
  });
}

export interface AuthRuntime {
  url: string;
  issuer: string;
  listeners: { host: string; port: number }[];
  password: string;
  processStatus: () => { api: number | null | undefined; provider: number | null | undefined; worker: number | null | undefined };
  readKnowledgeEvent: (scope: { organisation_id: string; client_id: string; engagement_id: string }, actor: string, key: string) => unknown;
  sql: (statement: string) => void;
  sqlAsync: (statement: string, phase?: SqlAsyncPhase) => Promise<void>;
  evidenceSessionBarrier: () => EvidenceSessionBarrier;
  disconnectDatabase: () => void;
  restoreDatabase: () => void;
  captureCallback: () => Promise<string>;
  restartApi: (options?: { evidence?: boolean }) => Promise<void>;
  upgradeKnowledgeSchema: () => Promise<void>;
  startWorker: (duration?: number) => Promise<void>;
  stopWorker: () => Promise<void>;
  freezeWorker: () => Promise<{ process_id: number; application_name: string; state: string; connections: number; unsettled_transactions: number; granted_locks: number; live_children: number }>;
  thawWorker: () => void;
  crashWorker: () => Promise<void>;
  scenario: (name: 'normal' | 'slow_discovery') => Promise<void>;
  evidence?: Pick<EvidenceS3Fixture, 'endpoint' | 'stats' | 'holdNext' | 'faultNext'>;
  close: () => Promise<void>;
}

export async function startAuthRuntime(options: { evidence?: boolean; schema9?: { cli: string; api: string } } = {}): Promise<AuthRuntime> {
  // Share the smoke suite's complete alias/role/development-target guard before
  // provisioning or changing rows. Keep inherited development bindings visible
  // to this check; child credential stripping happens only afterward.
  run('python3', ['-c', "import sys; sys.path.insert(0, 'scripts'); import smoke; smoke.test_urls()"], sanitizedStorageEnvironment());
  const runtimeDatabase = testDatabase('ZOBBA_TEST_RUNTIME_DATABASE_URL');
  const migrationDatabase = testDatabase('ZOBBA_TEST_MIGRATION_DATABASE_URL');
  const adminDatabase = testDatabase('ZOBBA_TEST_ADMIN_DATABASE_URL');
  if (new Set([runtimeDatabase.pathname, migrationDatabase.pathname, adminDatabase.pathname]).size !== 1) {
    throw new Error('Browser database role bindings must target the same disposable database.');
  }
  // Resolve inherited PGPORT before child environments remove PostgreSQL bindings.
  migrationDatabase.port = String(databaseEndpoint(migrationDatabase).port);
  const migrationEndpoint = databaseEndpoint(migrationDatabase);
  const adminEndpoint = databaseEndpoint(adminDatabase);
  run('cargo', ['build', '--quiet', '--locked', '-p', 'zobba-cli', '-p', 'zobba-worker'], sanitizedRuntimeEnvironment());
  const apiExecutable = buildEvidenceApiHarness();
  let schemaVersion = options.schema9 ? 9 : 11;
  const metadata = JSON.parse(run('cargo', ['metadata', '--locked', '--no-deps', '--format-version', '1'], sanitizedRuntimeEnvironment()));
  const fixtureDirectory = resolve(process.env.ZOBBA_FIXTURE_DIR ?? resolve(fixtureRoot, '.local'));
  run('node', [resolve(fixtureRoot, 'setup.mjs')], { ...sanitizedRuntimeEnvironment(), ZOBBA_FIXTURE_DIR: fixtureDirectory });
  const config = JSON.parse(readFileSync(resolve(fixtureDirectory, 'fixture.json'), 'utf8'));
  const ca = readFileSync(resolve(fixtureDirectory, 'ca.pem'));
  const appPort = await freePort();
  const apiPort = await freePort();
  const issuer = 'https://127.0.0.1:9444';
  const origin = `https://localhost:${appPort}`;
  const environment = sanitizedRuntimeEnvironment(Object.fromEntries(Object.entries(process.env)
    .filter(([name]) => !/^ZOBBA_.*DATABASE_URL$/.test(name) && !/^ZOBBA_OIDC_/.test(name) && !/^PG[A-Z_]*$/.test(name))));
  let evidence: EvidenceS3Fixture | undefined;
  let evidenceEnabled = options.evidence === true;
  const auth = {
    ZOBBA_LOCAL_FIXTURES: '1', ZOBBA_OIDC_ISSUER: issuer,
    ZOBBA_OIDC_CLIENT_ID: config.client_id, ZOBBA_OIDC_CLIENT_SECRET: config.client_secret,
    ZOBBA_OIDC_REDIRECT_URI: `${origin}/api/auth/callback`, ZOBBA_PUBLIC_ORIGIN: origin,
    ZOBBA_OIDC_CA_FILE: resolve(fixtureDirectory, 'ca.pem'),
  };
  const database = new DatabaseProxy(runtimeDatabase);
  let provider: ChildProcess | undefined;
  let api: ChildProcess | undefined;
  let worker: ChildProcess | undefined;
  let workerSequence = 0;
  let workerApplicationName = '';
  let vite: ViteDevServer | undefined;
  let callbackCapture: ((url: string) => void) | null = null;
  const cleanup = async () => {
    try { await vite?.close(); } finally {
      try { if (worker) { worker.kill('SIGCONT'); await stop(worker); } } finally {
      try { if (api) await stop(api); } finally {
        try { if (provider) await stop(provider); } finally {
          try { await evidence?.close(); } finally { await database.close(); }
        }
      }
      }
    }
  };
  try {
    // An occupied fixture port is an error; never take over an existing process.
    if (await ready(`${issuer}/.well-known/openid-configuration`, ca)) throw new Error('Browser fixture port 9444 is already in use.');
    provider = spawn('node', [resolve(fixtureRoot, 'server.mjs')], {
      cwd: root,
      env: { ...environment, ZOBBA_LOCAL_FIXTURES: '1', ZOBBA_FIXTURE_DIR: fixtureDirectory,
        ZOBBA_FIXTURE_PORT: '9444', ZOBBA_FIXTURE_APP_PORT: String(appPort) },
      stdio: 'ignore',
    });
    provider.on('error', () => {});
    let serving = false;
    for (let attempt = 0; attempt < 100; attempt += 1) {
      if (provider.exitCode !== null) throw new Error('Synthetic OIDC fixture refused startup.');
      if (await ready(`${issuer}/.well-known/openid-configuration`, ca)) { serving = true; break; }
      await delay(100);
    }
    if (!serving) throw new Error('Synthetic OIDC fixture did not become ready.');
    if (options.schema9) {
      // Historical upgrade proof owns this already guard-checked disposable DB.
      await runSqlAsync('DROP SCHEMA public CASCADE; CREATE SCHEMA public; REVOKE CREATE ON SCHEMA public FROM PUBLIC;',
        databaseMutationEnvironment(environment, migrationDatabase, migrationEndpoint.host, migrationEndpoint.port));
    }
    const initialCli = options.schema9?.cli ?? resolve(metadata.target_directory, 'debug/zobba-cli');
    run(initialCli, ['migrate', '--runtime-role', decodeURIComponent(runtimeDatabase.username)], {
      ...environment, ZOBBA_MIGRATION_DATABASE_URL: migrationDatabase.toString(),
    });
    // The earlier issuer marker is deliberately cleared only after the complete
    // smoke/test-database guard above has verified every configured endpoint.
    resetSyntheticFixture(adminDatabase, adminEndpoint.host, adminEndpoint.port, schemaVersion);
    run(initialCli, ['seed-local'], {
      ...environment, ...auth, ZOBBA_MIGRATION_DATABASE_URL: migrationDatabase.toString(),
    });
    const apiApplicationName = `zobba-browser-api-${process.pid}-${apiPort}`;
    const proxyDatabase = new URL(await database.start());
    proxyDatabase.searchParams.set('application_name', apiApplicationName);
    const databaseUrl = proxyDatabase.toString();
    if (evidenceEnabled) evidence = await startEvidenceS3Fixture();
    const apiUrl = `http://127.0.0.1:${apiPort}`;
    const startApi = async () => {
      api = spawn(schemaVersion === 9 ? options.schema9!.api : apiExecutable, ['--serve'], {
        cwd: root,
        env: {
          ...environment, ...auth, ZOBBA_RUNTIME_DATABASE_URL: databaseUrl, ZOBBA_API_BIND: `127.0.0.1:${apiPort}`,
          ...(evidenceEnabled && evidence ? { ZOBBA_TEST_EVIDENCE_S3_ENDPOINT: evidence.endpoint } : {}),
        },
        stdio: 'ignore',
      });
      api.on('error', () => {});
      let healthy = false;
      for (let attempt = 0; attempt < 100; attempt += 1) {
        if (api.exitCode !== null) throw new Error('Authentication API refused startup.');
        try {
          const response = await fetch(`${apiUrl}/health/ready`, { signal: AbortSignal.timeout(1000) });
          if (response.status === 200 && (await response.json()).schema_version === schemaVersion) { healthy = true; break; }
        } catch { /* Startup is bounded; do not expose URLs or provider errors. */ }
        await delay(100);
      }
      if (!healthy) throw new Error('Authentication API did not become ready.');
    };
    await startApi();
    vite = await createViteServer({ root: resolve(root, 'web'), configFile: resolve(root, 'web/vite.config.ts'), logLevel: 'error',
      plugins: [{ name: 'owned-test-callback-capture', configureServer(server) {
        // Capture the real HTTP callback before the API sees it. Browser route
        // interception cannot reliably intercept a later redirect-chain hop.
        server.middlewares.use((request, response, next) => {
          if (!callbackCapture || request.method !== 'GET' || !request.url?.startsWith('/api/auth/callback?')) { next(); return; }
          const complete = callbackCapture; callbackCapture = null;
          response.writeHead(200, { 'Content-Type': 'text/html', 'Cache-Control': 'no-store' });
          response.end('<title>Callback boundary check</title><p>Callback held for boundary verification.</p>');
          complete(`${origin}${request.url}`);
        });
      } }],
      server: { host: 'localhost', port: appPort, strictPort: true,
        https: { key: readFileSync(resolve(fixtureDirectory, 'app-key.pem')), cert: readFileSync(resolve(fixtureDirectory, 'app-cert.pem')) },
        proxy: { '/api': { target: apiUrl, rewrite: (path) => path.replace(/^\/api(?=\/)/, ''), configure: protectProxyErrors } },
      },
    });
    await vite.listen();
    if (!vite.httpServer || port(vite.httpServer) !== appPort) throw new Error('Unexpected browser fixture origin.');
    return {
      url: origin, issuer, password: config.account_password,
      processStatus: () => ({ api: api?.exitCode, provider: provider?.exitCode, worker: worker?.exitCode }),
      listeners: [{ host: 'localhost', port: appPort }, { host: '127.0.0.1', port: apiPort },
        { host: '127.0.0.1', port: 9444 }, { host: '127.0.0.1', port: Number(new URL(databaseUrl).port) },
        ...(evidence ? [{ host: '127.0.0.1', port: Number(new URL(evidence.endpoint).port) }] : [])],
      ...(evidence ? { evidence: {
        endpoint: evidence.endpoint, stats: () => evidence!.stats(),
        holdNext: (method: 'PUT' | 'GET') => evidence!.holdNext(method),
        faultNext: (fault: 'lost-put-ack' | 'corrupt-get' | 'missing-version' | 'missing-bucket') => evidence!.faultNext(fault),
      } } : {}),
      sql(statement) {
        // SQL text is fixed by the committed tests; no credentials enter arguments or output.
        const result = spawnSync('psql', ['-X', '-q', '-v', 'ON_ERROR_STOP=1'], {
          cwd: root, encoding: 'utf8', input: statement, timeout: 10_000,
          env: databaseMutationEnvironment(environment, adminDatabase, adminEndpoint.host, adminEndpoint.port),
        });
        if (result.error || result.status !== 0) throw new Error('Synthetic browser database mutation failed.');
      },
      sqlAsync(statement, phase) {
        return runSqlAsync(statement,
          databaseMutationEnvironment(environment, adminDatabase, adminEndpoint.host, adminEndpoint.port), phase);
      },
      evidenceSessionBarrier: () => ownedEvidenceSessionBarrier(
        databaseMutationEnvironment(environment, adminDatabase, adminEndpoint.host, adminEndpoint.port), apiApplicationName),
      readKnowledgeEvent(scope, actor, key) {
        // Exact read-only correlation in the already guard-checked disposable
        // fixture. This never resubmits a command or lends database visibility
        // to the browser: tests must separately verify the current scoped API.
        const values = [scope.organisation_id, scope.client_id, scope.engagement_id, actor, key];
        if (values.some(value => !/^[A-Za-z0-9_-]{1,128}$/.test(value))) throw new Error('Invalid synthetic knowledge event identity.');
        const result = spawnSync('psql', ['-X', '-q', '-t', '-A', '-v', 'ON_ERROR_STOP=1'], {
          cwd: root, encoding: 'utf8', timeout: 10_000,
          env: databaseMutationEnvironment(environment, adminDatabase, adminEndpoint.host, adminEndpoint.port),
          input: `BEGIN READ ONLY; SELECT json_build_object('event_id',id,'command',command,'receipt',receipt)::text FROM public.knowledge_events WHERE organisation_id='${values[0]}' AND client_id='${values[1]}' AND engagement_id='${values[2]}' AND actor_id='${values[3]}' AND key='${values[4]}' AND owner_id IS NULL; COMMIT;`,
        });
        if (result.error || result.status !== 0) throw new Error('Synthetic knowledge receipt lookup failed.');
        return result.stdout.trim() ? JSON.parse(result.stdout) : null;
      },
      disconnectDatabase: () => database.disconnect(), restoreDatabase: () => database.restore(),
      captureCallback() {
        if (callbackCapture) throw new Error('Callback capture already pending');
        return new Promise<string>((resolveCallback) => { callbackCapture = resolveCallback; });
      },
      async restartApi(restartOptions = {}) {
        const requestedEvidence = restartOptions.evidence;
        if (requestedEvidence === true && !evidence) throw new Error('Evidence fixture is unavailable for this runtime.');
        const previousEvidenceEnabled = evidenceEnabled;
        if (requestedEvidence !== undefined) evidenceEnabled = requestedEvidence;
        try {
          if (api) await stop(api);
          await startApi();
        } catch (error) {
          evidenceEnabled = previousEvidenceEnabled;
          throw error;
        }
      },
      async upgradeKnowledgeSchema() {
        if (schemaVersion !== 9 || !options.schema9) throw new Error('No historical knowledge upgrade is active.');
        if (worker) await stop(worker);
        if (api) await stop(api);
        run(resolve(metadata.target_directory, 'debug/zobba-cli'), ['migrate', '--runtime-role', decodeURIComponent(runtimeDatabase.username)], {
          ...environment, ZOBBA_MIGRATION_DATABASE_URL: migrationDatabase.toString(),
        });
        schemaVersion = 11;
        await startApi();
      },
      async startWorker(duration = 30_000) {
        if (worker && worker.exitCode === null && worker.signalCode === null) throw new Error('Owned worker is already running.');
        if (!Number.isInteger(duration) || duration < 10 || duration > 30_000) throw new Error('Invalid owned inert duration.');
        const workerPort = await freePort();
        // Identify only this owned worker's connections in freeze diagnostics.
        // database_options preserves this supported URL application_name field.
        workerApplicationName = `zobba_browser_worker_${appPort}_${++workerSequence}`;
        const workerDatabase = new URL(databaseUrl);
        workerDatabase.searchParams.set('application_name', workerApplicationName);
        worker = spawn(resolve(metadata.target_directory, 'debug/zobba-worker'), [], {
          cwd: root,
          env: { ...environment, ZOBBA_RUNTIME_DATABASE_URL: workerDatabase.toString(), ZOBBA_WORKER_BIND: `127.0.0.1:${workerPort}`, ZOBBA_INERT_DURATION_MS: String(duration) },
          stdio: 'ignore',
        });
        worker.on('error', () => {});
        for (let attempt = 0; attempt < 100; attempt += 1) {
          if (worker.exitCode !== null || worker.signalCode !== null) throw new Error('Owned worker refused startup.');
          try { if ((await fetch(`http://127.0.0.1:${workerPort}/health/ready`, { signal: AbortSignal.timeout(1000) })).status === 200) return; }
          catch { /* Fixed bounded readiness probe; never expose runtime credentials. */ }
          await delay(100);
        }
        throw new Error('Owned worker did not become ready.');
      },
      async stopWorker() { if (worker) { worker.kill('SIGCONT'); await stop(worker); worker = undefined; } },
      async freezeWorker() {
        const owned = worker;
        if (!owned?.pid || owned.exitCode !== null || owned.signalCode !== null) throw new Error('No owned worker to freeze.');
        const pid = owned.pid;
        const ownedExecutable = readlinkSync(`/proc/${pid}/exe`);
        const applicationName = workerApplicationName;
        const state = (processId: number) => {
          const stat = readFileSync(`/proc/${processId}/stat`, 'utf8');
          return stat.slice(stat.lastIndexOf(')') + 2).split(' ')[0]!;
        };
        // This qualified container omits /proc/<pid>/task/<tid>/children.
        // Bind candidates by the actual parent PID before inspecting executable.
        const liveChildren = () => readdirSync('/proc')
          .filter(child => /^\d+$/.test(child)).filter(child => {
            try {
              const stat = readFileSync(`/proc/${child}/stat`, 'utf8');
              const fields = stat.slice(stat.lastIndexOf(')') + 2).split(' ');
              if (Number(fields[1]) !== pid) return false;
              const args = readFileSync(`/proc/${child}/cmdline`, 'utf8').split('\0');
              return readlinkSync(`/proc/${child}/exe`) === ownedExecutable && args[1] === '--inert-child' && !['Z', 'X'].includes(state(Number(child)));
            } catch { return false; /* This exact child may have exited during observation. */ }
          }).length;
        const until = Date.now() + 5000;
        while (Date.now() < until) {
          if (worker !== owned || owned.exitCode !== null || owned.signalCode !== null || !owned.kill('SIGSTOP')) throw new Error('Owned worker exited before freeze.');
          let retained = false;
          try {
            // Signal delivery is asynchronous. Inspect transactions only after
            // the exact owned coordinator is stopped and cannot start another.
            while (!['T', 't'].includes(state(pid))) {
              if (Date.now() >= until) throw new Error('Owned worker freeze deadline exceeded.');
              await delay(10);
            }
            const result = spawnSync('psql', ['-X', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1'], {
              cwd: root, encoding: 'utf8', timeout: 2000,
              input: `WITH owned AS MATERIALIZED (SELECT pid,state,xact_start FROM pg_catalog.pg_stat_activity WHERE datname=current_database() AND backend_type='client backend' AND application_name='${applicationName}') SELECT json_build_object('connections',count(*),'unsettled_transactions',count(*) FILTER (WHERE state<>'idle' OR xact_start IS NOT NULL),'granted_locks',(SELECT count(*) FROM pg_catalog.pg_locks WHERE granted AND pid IN (SELECT pid FROM owned)))::text FROM owned;`,
              env: { ...environment, PGHOST: adminEndpoint.host, PGPORT: String(adminEndpoint.port), PGUSER: decodeURIComponent(adminDatabase.username),
                PGPASSWORD: decodeURIComponent(adminDatabase.password), PGDATABASE: decodeURIComponent(adminDatabase.pathname.slice(1)), PGCONNECT_TIMEOUT: '2', PGOPTIONS: '-c statement_timeout=1000' },
            });
            if (result.error || result.status !== 0) throw new Error('Owned worker freeze database observation failed.');
            const observed = JSON.parse(result.stdout) as { connections: number; unsettled_transactions: number; granted_locks: number };
            const children = liveChildren();
            if (observed.connections > 0 && observed.unsettled_transactions === 0 && observed.granted_locks === 0 && children > 0) {
              retained = true;
              return { process_id: pid, application_name: applicationName, state: state(pid), ...observed, live_children: children };
            }
          } finally {
            // SIGSTOP inside a transaction can itself block controls. Thaw that
            // sample and retry; never lengthen the API deadline to hide it.
            if (!retained) owned.kill('SIGCONT');
          }
          await delay(50);
        }
        throw new Error('Could not freeze the owned worker between transactions with live inert activity.');
      },
      thawWorker() { if (!worker?.kill('SIGCONT')) throw new Error('No owned worker to resume.'); },
      async crashWorker() {
        if (!worker || worker.exitCode !== null || worker.signalCode !== null) throw new Error('No live owned worker to interrupt.');
        const exited = once(worker, 'exit');
        worker.kill('SIGKILL');
        await exited; worker = undefined;
      },
      async scenario(name) {
        await new Promise<void>((resolveScenario, reject) => {
          const request = httpsRequest(`${issuer}/__admin/scenario`, { ca, method: 'POST', timeout: 2000,
            headers: { Authorization: `Bearer ${config.admin_secret}`, 'Content-Type': 'application/json' },
          }, (response) => {
            response.resume();
            if (response.statusCode === 200) resolveScenario(); else reject(new Error('Fixture scenario refused'));
          });
          request.on('error', () => reject(new Error('Fixture scenario unavailable')));
          request.on('timeout', () => { request.destroy(); reject(new Error('Fixture scenario timed out')); });
          request.end(JSON.stringify({ scenario: name }));
        });
      },
      close: cleanup,
    };
  } catch (error) { await cleanup(); throw error; }
}
