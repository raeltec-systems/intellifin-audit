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
import { DatabaseProxy, freePort, port, stop } from './runtime';
import { databaseEndpoint } from './database-endpoint.ts';
import { protectProxyErrors } from '../../proxy-errors';

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
  sql: (statement: string) => void;
  disconnectDatabase: () => void;
  restoreDatabase: () => void;
  captureCallback: () => Promise<string>;
  restartApi: () => Promise<void>;
  startWorker: (duration?: number) => Promise<void>;
  stopWorker: () => Promise<void>;
  freezeWorker: () => Promise<{ process_id: number; application_name: string; state: string; connections: number; unsettled_transactions: number; granted_locks: number; live_children: number }>;
  thawWorker: () => void;
  crashWorker: () => Promise<void>;
  scenario: (name: 'normal' | 'slow_discovery') => Promise<void>;
  close: () => Promise<void>;
}

export async function startAuthRuntime(): Promise<AuthRuntime> {
  // Share the smoke suite's complete alias/role/development-target guard before
  // provisioning or changing rows. Keep inherited development bindings visible
  // to this check; child credential stripping happens only afterward.
  run('python3', ['-c', "import sys; sys.path.insert(0, 'scripts'); import smoke; smoke.test_urls()"], process.env);
  const runtimeDatabase = testDatabase('ZOBBA_TEST_RUNTIME_DATABASE_URL');
  const migrationDatabase = testDatabase('ZOBBA_TEST_MIGRATION_DATABASE_URL');
  const adminDatabase = testDatabase('ZOBBA_TEST_ADMIN_DATABASE_URL');
  if (new Set([runtimeDatabase.pathname, migrationDatabase.pathname, adminDatabase.pathname]).size !== 1) {
    throw new Error('Browser database role bindings must target the same disposable database.');
  }
  // Resolve inherited PGPORT before child environments remove PostgreSQL bindings.
  migrationDatabase.port = String(databaseEndpoint(migrationDatabase).port);
  const adminEndpoint = databaseEndpoint(adminDatabase);
  run('cargo', ['build', '--quiet', '--locked', '-p', 'zobba-api', '-p', 'zobba-cli', '-p', 'zobba-worker'], process.env);
  const metadata = JSON.parse(run('cargo', ['metadata', '--locked', '--no-deps', '--format-version', '1'], process.env));
  const fixtureDirectory = resolve(process.env.ZOBBA_FIXTURE_DIR ?? resolve(fixtureRoot, '.local'));
  run('node', [resolve(fixtureRoot, 'setup.mjs')], { ...process.env, ZOBBA_FIXTURE_DIR: fixtureDirectory });
  const config = JSON.parse(readFileSync(resolve(fixtureDirectory, 'fixture.json'), 'utf8'));
  const ca = readFileSync(resolve(fixtureDirectory, 'ca.pem'));
  const appPort = await freePort();
  const apiPort = await freePort();
  const issuer = 'https://127.0.0.1:9444';
  const origin = `https://localhost:${appPort}`;
  const environment = Object.fromEntries(Object.entries(process.env)
    .filter(([name]) => !/^ZOBBA_.*DATABASE_URL$/.test(name) && !/^ZOBBA_OIDC_/.test(name) && !/^PG[A-Z_]*$/.test(name)));
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
        try { if (provider) await stop(provider); } finally { await database.close(); }
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
    run(resolve(metadata.target_directory, 'debug/zobba-cli'), ['migrate', '--runtime-role', decodeURIComponent(runtimeDatabase.username)], {
      ...environment, ZOBBA_MIGRATION_DATABASE_URL: migrationDatabase.toString(),
    });
    run(resolve(metadata.target_directory, 'debug/zobba-cli'), ['seed-local'], {
      ...environment, ...auth, ZOBBA_MIGRATION_DATABASE_URL: migrationDatabase.toString(),
    });
    const databaseUrl = await database.start();
    const apiUrl = `http://127.0.0.1:${apiPort}`;
    const startApi = async () => {
      api = spawn(resolve(metadata.target_directory, 'debug/zobba-api'), [], {
        cwd: root,
        env: { ...environment, ...auth, ZOBBA_RUNTIME_DATABASE_URL: databaseUrl, ZOBBA_API_BIND: `127.0.0.1:${apiPort}` },
        stdio: 'ignore',
      });
      api.on('error', () => {});
      let healthy = false;
      for (let attempt = 0; attempt < 100; attempt += 1) {
        if (api.exitCode !== null) throw new Error('Authentication API refused startup.');
        try {
          const response = await fetch(`${apiUrl}/health/ready`, { signal: AbortSignal.timeout(1000) });
          if (response.status === 200 && (await response.json()).schema_version === 4) { healthy = true; break; }
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
      listeners: [{ host: 'localhost', port: appPort }, { host: '127.0.0.1', port: apiPort },
        { host: '127.0.0.1', port: 9444 }, { host: '127.0.0.1', port: Number(new URL(databaseUrl).port) }],
      sql(statement) {
        // SQL text is fixed by the committed tests; no credentials enter arguments or output.
        const result = spawnSync('psql', ['-X', '-q', '-v', 'ON_ERROR_STOP=1'], {
          cwd: root, encoding: 'utf8', input: statement,
          env: { ...environment, PGHOST: adminEndpoint.host, PGPORT: String(adminEndpoint.port),
            PGUSER: decodeURIComponent(adminDatabase.username), PGPASSWORD: decodeURIComponent(adminDatabase.password),
            PGDATABASE: decodeURIComponent(adminDatabase.pathname.slice(1)) },
        });
        if (result.error || result.status !== 0) throw new Error('Synthetic browser database mutation failed.');
      },
      disconnectDatabase: () => database.disconnect(), restoreDatabase: () => database.restore(),
      captureCallback() {
        if (callbackCapture) throw new Error('Callback capture already pending');
        return new Promise<string>((resolveCallback) => { callbackCapture = resolveCallback; });
      },
      async restartApi() { if (api) await stop(api); await startApi(); },
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
