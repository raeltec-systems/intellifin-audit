import { spawn } from 'node:child_process';
import { execFileSync } from 'node:child_process';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

export const APPROVED_SOLARI_TARGET = 'https://northstar-production-b312.up.railway.app';
export const LIVE_EMPLOYEE_ID = 'E-000102';

/** Only the dedicated, explicitly selected live job may consume provider capacity. */
export function liveSolariConfiguration(env: NodeJS.ProcessEnv = process.env) {
  const required = (name: string) => {
    const value = env[name]?.trim();
    if (!value) throw new Error(`Live Solari gate blocked: ${name} is required.`);
    return value;
  };
  if (required('INTELLIFIN_LIVE_SOLARI') !== '1') throw new Error('Live Solari gate was not explicitly enabled.');
  const databaseUrl = required('DATABASE_URL');
  const database = new URL(databaseUrl);
  // CI=true alone is not authority to mutate a remote database.
  if (!['localhost', '127.0.0.1', '[::1]', 'postgres', 'db'].includes(database.hostname)
    || !/(?:^|[_-])(?:test|ci|e2e)(?:[_-]|$)/i.test(database.pathname.slice(1))) {
    throw new Error('Live Solari gate requires an explicitly disposable local/CI test database.');
  }
  const apiKey = required('SOLARI_API_KEY');
  if (!apiKey.startsWith('slr_live_')) throw new Error('Live Solari gate requires a live Solari key.');
  if (env['SOLARI_RECORDING'] && env['SOLARI_RECORDING'] !== 'false') throw new Error('Provider recording must remain disabled.');
  // This gate has no custom gateway/proxy path. The production adapter uses the real SDK.
  if (env['SOLARI_BASE_URL'] || env['NODE_OPTIONS']) throw new Error('Live Solari gate refuses gateway overrides and injected Node options.');
  const anthropic = Boolean(env['ANTHROPIC_API_KEY']?.trim());
  const openai = Boolean(env['OPENAI_API_KEY']?.trim());
  if (anthropic === openai) throw new Error('Live Solari gate requires exactly one configured real model provider.');
  const provider = anthropic ? 'anthropic' : 'openai';
  const modelKey = required(anthropic ? 'ANTHROPIC_API_KEY' : 'OPENAI_API_KEY');
  if (/synthetic|fixture|intercept/i.test(modelKey)) throw new Error('Live Solari gate refuses synthetic model credentials.');
  const modelId = required(anthropic ? 'AGENT_ANTHROPIC_MODEL' : 'AGENT_OPENAI_MODEL');
  if (/synthetic|fixture|intercept/i.test(modelId)) throw new Error('Live Solari gate refuses synthetic model identities.');
  const candidate = required('SOLARI_ACCEPTANCE_CANDIDATE_SHA');
  if (!/^[a-f0-9]{40}$/.test(candidate)
    || execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim() !== candidate
    || execFileSync('git', ['status', '--porcelain', '--untracked-files=no'], { encoding: 'utf8' }).trim()) {
    throw new Error('Live Solari gate requires the exact clean checked-out candidate SHA.');
  }
  const target = env['SOLARI_ACCEPTANCE_TARGET'] ?? APPROVED_SOLARI_TARGET;
  if (target !== APPROVED_SOLARI_TARGET) {
    // A changed deployment needs explicit operator approval, never a discovered tunnel.
    if (env['SOLARI_ACCEPTANCE_APPROVED_TARGET'] !== target) throw new Error('Alternative synthetic target has not been explicitly approved.');
    const parsed = new URL(target);
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.port || parsed.search || parsed.hash
      || parsed.pathname !== '/' || !parsed.hostname.endsWith('.up.railway.app')) {
      throw new Error('Alternative target must be an approved existing public Railway HTTPS origin.');
    }
  }
  return { databaseUrl, apiKey, provider, modelKey, modelId, candidate, target, region: env['SOLARI_REGION'] ?? 'us-west' };
}

/** Bounded polling; error text never includes response bodies, credentials or SDK errors. */
export async function pollLive<T>(read: () => Promise<T>, accepted: (value: T) => boolean, timeoutMs: number, label: string): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  do {
    const value = await read();
    if (accepted(value)) return value;
    await delay(500);
  } while (Date.now() < deadline);
  throw new Error(`Live Solari gate timed out: ${label}.`);
}

export function startLiveWorker(env: NodeJS.ProcessEnv) {
  // No --import, synthetic model preload, proxy tunnel, or alternate worker entrypoint.
  const process_ = spawn(process.execPath, [resolve('apps/worker/dist/main.js')], {
    cwd: process.cwd(), env, stdio: ['ignore', 'pipe', 'pipe'],
  });
  let log = '';
  let failed = false;
  let closed = false;
  const collect = (chunk: Buffer) => { log += chunk.toString('utf8'); if (log.length > 8_000_000) failed = true; };
  process_.stdout.on('data', collect); process_.stderr.on('data', collect);
  process_.on('error', () => { failed = true; });
  process_.on('close', code => { closed = true; if (code !== 0) failed = true; });
  return {
    readLog: () => log,
    async ready() {
      await pollLive(async () => {
        if (failed || closed) throw new Error('Live worker failed before readiness; raw logs are withheld to contain credentials.');
        return log.includes('Heartbeat loop started');
      }, Boolean, 60_000, 'worker readiness');
    },
    assertRunning() { if (failed || closed) throw new Error('Live worker terminated unexpectedly; raw logs are withheld.'); },
    async stop() {
      if (closed) {
        if (failed) throw new Error('Live worker exited unsuccessfully; raw logs are withheld.');
        return;
      }
      process_.kill('SIGTERM');
      try { await pollLive(async () => closed, Boolean, 30_000, 'worker graceful shutdown'); }
      catch { process_.kill('SIGKILL'); throw new Error('Live worker required forced shutdown; remote cleanup must be checked in the report.'); }
      if (failed) throw new Error('Live worker exited unsuccessfully; raw logs are withheld.');
    },
  };
}
