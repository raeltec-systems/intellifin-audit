import { hostname } from 'node:os';

import { createDb, createSqlClient } from '../db/client.js';
import { assertPostgres18, assertSchemaSupported } from '../db/compat.js';
import { classifyTelemetryError, sanitizeTelemetryFields } from '../telemetry/sanitize.js';
import { DrizzleRegistrationRepository } from './registration-repository.js';
import { recordProbe, type ProbeState } from './probe.js';

/**
 * The Target System connectivity sweep — its own entry point, invoked like the release
 * migrator (AD-10, AD-15).
 *
 * **Why it is here and not in `apps/worker/src/`.** `.dependency-cruiser.cjs` fails the
 * build on ANY import of `registrations/probe` from `apps/`, transitively, and that rule
 * is deliberate: the web must never make an outbound call to a registered system, and the
 * worker must never pull the prober into its heartbeat bundle. An entry point under
 * `apps/worker/src/` would have to import this module and would break the rule it exists
 * to serve. So the sweep lives beside the writer it uses — exactly where `db/migrate.ts`
 * lives — and is started as its own process:
 *
 *     DATABASE_URL=postgres://... pnpm --filter @intellifin/worker probe
 *
 * which forwards to `node dist/registrations/probe-runner.js`. Nothing imports it. The
 * heartbeat loop cannot reach it, and neither can the web.
 *
 * **What it may do to a Target System.** `GET`, once, with a deadline, no credentials, no
 * redirect following, and no body sent. It records `reachable` or `unreachable` and NOTHING
 * about what it saw: a response body, a header or an error string from a customer's system
 * is exactly the payload NFR-6 keeps out of this product's data, and a "detail" column is
 * where it would end up.
 *
 * It never migrates and it never writes a registration. A probe for a registration that
 * has been removed between the read and the write is discarded, not an error.
 */

/** A system that has not answered in this long has not answered. */
export const PROBE_TIMEOUT_MS = 5_000;

/** Only these two. A registration naming `file:` or `ftp:` is not probed at all. */
const PROBEABLE_PROTOCOLS = new Set(['http:', 'https:']);

export interface ProbeOutcome {
  readonly registrationId: string;
  readonly displayName: string;
  readonly state: ProbeState;
  /** `false` when the registration disappeared between the read and the write. */
  readonly recorded: boolean;
}

export interface ProbeSweepResult {
  readonly probed: number;
  readonly reachable: number;
  readonly unreachable: number;
  /** Active registrations with no probeable origin — a desktop system, for instance. */
  readonly skipped: number;
  readonly outcomes: readonly ProbeOutcome[];
}

export interface Fetcher {
  (origin: string, signal: AbortSignal): Promise<{ readonly ok: boolean; readonly status: number }>;
}

/**
 * One bounded read. Anything but a completed response is `unreachable`.
 *
 * `redirect: 'manual'` on purpose: following a redirect would let a registered origin send
 * the worker somewhere nobody allowlisted, which is the same class of problem as an
 * out-of-scope origin in an Audit Instruction. A 3xx counts as reachable — the system
 * answered — and where it points is not this process's business.
 */
const defaultFetcher: Fetcher = async (origin, signal) => {
  const response = await fetch(origin, {
    method: 'GET',
    redirect: 'manual',
    signal,
    headers: { accept: '*/*' },
  });
  return { ok: response.status < 500, status: response.status };
};

/**
 * Try each allowlisted origin until one answers.
 *
 * A registration is reachable when ANY of its origins is: the origins are an allowlist of
 * places the agent may go, not a list of things that must all be up, and a system behind
 * two of them is not down because the second is being replaced.
 */
export async function probeOrigins(
  origins: readonly string[],
  fetcher: Fetcher = defaultFetcher,
  timeoutMs: number = PROBE_TIMEOUT_MS,
): Promise<ProbeState | 'no-probeable-origin'> {
  const probeable = origins.filter((origin) => {
    try {
      return PROBEABLE_PROTOCOLS.has(new URL(origin).protocol);
    } catch {
      // An origin that is not a URL cannot be fetched. It is not "unreachable" — nothing
      // was attempted — so it is not a probeable origin.
      return false;
    }
  });
  if (probeable.length === 0) return 'no-probeable-origin';

  for (const origin of probeable) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const answer = await fetcher(origin, controller.signal);
      if (answer.ok) return 'reachable';
    } catch {
      // A refusal, a DNS failure, a timeout: all the same answer, and none of them is
      // recorded in any more detail than "unreachable".
    } finally {
      clearTimeout(timer);
      // Abort AFTER the answer, always.
      //
      // `fetch` resolves as soon as the headers arrive; the body is a stream nobody
      // here reads, and an unread body holds the socket open. So the timeout bounded
      // the fetch and not the PROCESS: a target that answers and then holds its body
      // kept the sweep alive for as long as it cared to — measured at 105 seconds past
      // "Probe sweep complete", and unbounded against a server that never closes. The
      // abort releases it. It is a no-op on a request that already finished.
      controller.abort();
    }
  }
  return 'unreachable';
}

export interface SweepDependencies {
  readonly fetcher?: Fetcher;
  readonly timeoutMs?: number;
  readonly observedBy?: string;
  readonly now?: () => Date;
}

/** Read the active registrations, probe each, write one row per registration. */
export async function runProbeSweep(
  db: Parameters<typeof recordProbe>[0],
  dependencies: SweepDependencies = {},
): Promise<ProbeSweepResult> {
  const fetcher = dependencies.fetcher ?? defaultFetcher;
  const timeoutMs = dependencies.timeoutMs ?? PROBE_TIMEOUT_MS;
  const observedBy = dependencies.observedBy ?? hostname();
  const now = dependencies.now ?? ((): Date => new Date());

  // The job's read, not the surface's: active only, unpaged. See the repository.
  const registrations = await new DrizzleRegistrationRepository(db).listActiveProbeTargets();
  const outcomes: ProbeOutcome[] = [];
  let reachable = 0;
  let unreachable = 0;
  let skipped = 0;

  for (const registration of registrations) {
    // A retired registration is not probed. Retirement is the control that stops a system
    // being used, and a retired row whose connectivity kept refreshing would read as live.
    const state = await probeOrigins(registration.allowedOrigins, fetcher, timeoutMs);
    if (state === 'no-probeable-origin') {
      // A desktop system has an application identity and no origin. There is nothing to
      // fetch, and writing "unreachable" would be a claim the probe cannot support — the
      // surface keeps saying "Never probed", which is true.
      skipped += 1;
      continue;
    }

    const recorded = await recordProbe(db, {
      registrationId: registration.registrationId,
      state,
      observedAt: now(),
      observedBy,
    });
    if (state === 'reachable') reachable += 1;
    else unreachable += 1;
    outcomes.push({
      registrationId: registration.registrationId,
      displayName: registration.displayName,
      state,
      recorded,
    });
  }

  return { probed: outcomes.length, reachable, unreachable, skipped, outcomes };
}

function log(level: 'info' | 'error', message: string, fields: Record<string, unknown> = {}): void {
  const line = JSON.stringify({
    level,
    time: new Date().toISOString(),
    service: 'probe',
    message,
    ...sanitizeTelemetryFields(fields),
  });
  if (level === 'error') process.stderr.write(`${line}\n`);
  else process.stdout.write(`${line}\n`);
}

/**
 * `import.meta.main`, never `process.argv[1] === fileURLToPath(import.meta.url)`.
 *
 * Those two are not the same test. `import.meta.url` is the RESOLVED path; `argv[1]` is
 * the path as invoked. Run through a symlink — which is exactly what pnpm's
 * `node_modules` is, and what a `--prod deploy` tree gives you — they differ, the guard
 * is false, and the module loads and does NOTHING while exiting 0. For a release
 * migrator that is a deploy that reports success against an unmigrated database.
 */
const isEntryPoint = import.meta.main;

if (isEntryPoint) {
  const databaseUrl = process.env['DATABASE_URL'];
  if (!databaseUrl) {
    log('error', 'Refusing to probe', { reason: 'DATABASE_URL is required' });
    process.exit(1);
  }
  // The deadline is a policy the command owns, and this IS the command's process, so the
  // entry point is where an operator may set it (AD-11: configuration is read at a
  // composition root). A sweep over many registrations pointed at hosts that do not
  // resolve is otherwise bounded only by five seconds times the number of them.
  const rawTimeout = process.env['PROBE_TIMEOUT_MS'];
  const timeoutMs = rawTimeout === undefined || rawTimeout === '' ? PROBE_TIMEOUT_MS : Number(rawTimeout);
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 120_000) {
    log('error', 'Refusing to probe', { reason: 'PROBE_TIMEOUT_MS must be 1..120000 milliseconds' });
    process.exit(1);
  }

  const sql = createSqlClient(databaseUrl, { max: 2 });
  try {
    // The same two guards every process runs. A sweep against a database outside the
    // supported range would write rows whose shape this build does not understand.
    await assertPostgres18(sql);
    await assertSchemaSupported(sql);
    const result = await runProbeSweep(createDb(sql), { timeoutMs });
    log('info', 'Probe sweep complete', {
      probed: result.probed,
      probeReachable: result.reachable,
      probeUnreachable: result.unreachable,
      probeSkipped: result.skipped,
    });
  } catch (error) {
    log('error', 'Probe sweep failed', { ...classifyTelemetryError(error) });
    await sql.end({ timeout: 5 }).catch(() => undefined);
    process.exit(1);
  }
  await sql.end({ timeout: 5 }).catch(() => undefined);
}
