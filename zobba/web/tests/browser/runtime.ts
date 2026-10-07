import { DatabaseProxy } from './database-proxy.ts';
import { spawn, spawnSync } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import type { Server } from 'node:net';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { createServer as createViteServer } from 'vite';
import type { ViteDevServer } from 'vite';
import { protectProxyErrors } from '../../proxy-errors';

export { DatabaseProxy };

const root = fileURLToPath(new URL('../../..', import.meta.url));
const web = resolve(root, 'web');

export function port(server: Server): number {
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Expected a loopback TCP listener');
  return address.port;
}

async function listen(server: Server): Promise<void> {
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
}

async function close(server: Server): Promise<void> {
  if (!server.listening) return;
  await new Promise<void>((resolveClose, reject) => {
    server.close((error) => error ? reject(error) : resolveClose());
  });
}

export async function freePort(): Promise<number> {
  const listener = createServer();
  await listen(listener);
  const available = port(listener);
  await close(listener);
  return available;
}

function runtimeUrl(): URL {
  const value = process.env.ZOBBA_TEST_RUNTIME_DATABASE_URL;
  if (!value) throw new Error('Set ZOBBA_TEST_RUNTIME_DATABASE_URL to the migrated disposable test database.');
  let url: URL;
  try { url = new URL(value); } catch { throw new Error('Invalid disposable test database URL.'); }
  // A developer can isolate socket loss against their already configured local
  // runtime without changing that database. CI always requires the test database.
  const localDevelopment = !process.env.CI && value === process.env.ZOBBA_RUNTIME_DATABASE_URL &&
    ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname);
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || !url.hostname ||
    (!decodeURIComponent(url.pathname).endsWith('_test') && !localDevelopment)) {
    throw new Error('Browser checks require a PostgreSQL TCP test database or the exact configured loopback development database.');
  }
  return url;
}

export async function stop(process: ChildProcess): Promise<void> {
  if (!process.pid || process.exitCode !== null || process.signalCode !== null) return;
  const exited = once(process, 'exit');
  process.kill('SIGTERM');
  const timer = setTimeout(() => process.kill('SIGKILL'), 3000);
  try { await exited; } finally { clearTimeout(timer); }
}

const externalStorageEnvironment = /^(?:AWS(?:_|$)|S3(?:_|$)|MINIO(?:_|$)|OBJECT_STORE(?:_|$)|OBJECTSTORE(?:_|$)|OBJECT_STORAGE(?:_|$)|OBJSTORE(?:_|$)|RUST_S3(?:_|$)|STORAGE(?:_|$)|ZOBBA_.*(?:AWS|S3|MINIO|OBJECT.?STORE|OBJSTORE|EVIDENCE|STORAGE))/i;

export function sanitizedStorageEnvironment(source: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  return Object.fromEntries(Object.entries(source).filter(([name]) => !externalStorageEnvironment.test(name)));
}

const privateRuntimeEnvironment = /^(?:ZOBBA_.*DATABASE_URL$|ZOBBA_OIDC_|PG[A-Z_]*$)/i;

export function sanitizedRuntimeEnvironment(source: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  return Object.fromEntries(Object.entries(sanitizedStorageEnvironment(source))
    .filter(([name]) => !privateRuntimeEnvironment.test(name)));
}

export function buildEvidenceApiHarness(): string {
  const result = spawnSync('cargo', [
    'test', '--locked', '-p', 'zobba-api', '--test', 'evidence_fixture', '--no-run', '--message-format=json',
  ], {
    cwd: root,
    encoding: 'utf8',
    env: sanitizedRuntimeEnvironment(),
    maxBuffer: 16 * 1024 * 1024,
  });
  if (result.error || result.status !== 0) throw new Error('The owned Rust API test harness build failed.');

  for (const line of result.stdout.split(/\r?\n/)) {
    try {
      const message = JSON.parse(line) as {
        reason?: string;
        target?: { name?: string; kind?: string[] };
        executable?: string | null;
      };
      if (message.reason === 'compiler-artifact' && message.target?.name === 'evidence_fixture' &&
        message.target.kind?.includes('test') && message.executable) return message.executable;
    } catch { /* Cargo emits one JSON object per line; ignore non-artifact messages. */ }
  }
  throw new Error('The evidence API test harness executable was not produced.');
}

export async function startRuntime(): Promise<{
  url: string;
  disconnectDatabase: () => void;
  restoreDatabase: () => void;
  close: () => Promise<void>;
}> {
  const source = runtimeUrl();
  const apiExecutable = buildEvidenceApiHarness();
  const database = new DatabaseProxy(source);
  let api: ChildProcess | undefined;
  let vite: ViteDevServer | undefined;
  const cleanup = async () => {
    try { await vite?.close(); } finally {
      try { if (api) await stop(api); } finally { await database.close(); }
    }
  };

  try {
    const databaseUrl = await database.start();
    const apiPort = await freePort();
    const apiUrl = `http://127.0.0.1:${apiPort}`;
    // Runtime children get no migration/admin/test database bindings.
    const environment = sanitizedRuntimeEnvironment(Object.fromEntries(Object.entries(process.env)
      .filter(([name]) => !/^ZOBBA_.*DATABASE_URL$/.test(name) &&
        !/^ZOBBA_OIDC_/.test(name) && !['ZOBBA_PUBLIC_ORIGIN', 'ZOBBA_LOCAL_FIXTURES'].includes(name))));
    api = spawn(apiExecutable, ['--serve'], {
      cwd: root,
      env: { ...environment, ZOBBA_RUNTIME_DATABASE_URL: databaseUrl, ZOBBA_API_BIND: `127.0.0.1:${apiPort}` },
      stdio: 'ignore',
    });
    const child = api;
    let spawnFailed = false;
    child.on('error', () => { spawnFailed = true; });
    const deadline = Date.now() + 20_000;
    let serving = false;
    while (Date.now() < deadline) {
      if (spawnFailed || child.exitCode !== null) throw new Error('Test API refused startup; run the explicit test database smoke setup first.');
      try {
        const response = await fetch(`${apiUrl}/health/ready`, { signal: AbortSignal.timeout(1500) });
        const body = await response.json();
        if (response.status === 200 && body.service === 'api' && body.status === 'ready' && body.schema_version === 12) {
          serving = true;
          break;
        }
      } catch { /* Retry startup; never log database URLs or connection errors. */ }
      await delay(100);
    }
    if (!serving) throw new Error('Test API did not become ready within its startup budget.');

    // This diagnostic suite deliberately owns an HTTP server. Loading a sourced
    // development fixture environment must not silently change its protocol.
    const tlsKey = process.env.ZOBBA_LOCAL_TLS_KEY;
    const tlsCert = process.env.ZOBBA_LOCAL_TLS_CERT;
    delete process.env.ZOBBA_LOCAL_TLS_KEY;
    delete process.env.ZOBBA_LOCAL_TLS_CERT;
    try {
      vite = await createViteServer({
        root: web,
        configFile: resolve(web, 'vite.config.ts'),
        logLevel: 'error',
        server: {
          host: '127.0.0.1',
          port: 0,
          strictPort: true,
          proxy: { '/api': { target: apiUrl, rewrite: (path) => path.replace(/^\/api(?=\/)/, ''), configure: protectProxyErrors } },
        },
      });
    } finally {
      if (tlsKey !== undefined) process.env.ZOBBA_LOCAL_TLS_KEY = tlsKey;
      if (tlsCert !== undefined) process.env.ZOBBA_LOCAL_TLS_CERT = tlsCert;
    }
    await vite.listen();
    if (!vite.httpServer) throw new Error('Vite did not expose its loopback server.');
    return {
      url: `http://127.0.0.1:${port(vite.httpServer)}`,
      disconnectDatabase: () => database.disconnect(),
      restoreDatabase: () => database.restore(),
      close: cleanup,
    };
  } catch (error) {
    await cleanup();
    throw error;
  }
}
