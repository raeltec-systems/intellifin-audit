import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';

import { FIXTURES_ROOT } from './fixtures.js';
import { ROUTES } from './routes.js';
import { handleRequest } from './server.js';

/**
 * The Northstar composition root — the only module that touches `node:http`.
 *
 * It is an ordinary Node server on purpose. There is no database, no framework and no
 * configuration beyond a port: these are somebody else's systems, and the less this
 * process is, the less of it can go wrong while a Run is being observed.
 */

const DEFAULT_PORT = 4300;

/**
 * `NORTHSTAR_PORT` first, then `PORT`, then the default.
 *
 * `NORTHSTAR_PORT` is the explicit one the browser suite sets. `PORT` is the convention
 * every container platform injects, Railway included, and a service that ignores it
 * binds a port nothing routes to and fails its healthcheck with the process healthy.
 * The specific name wins so a local run cannot be redirected by an ambient `PORT`.
 */
function port(): number {
  const raw = process.env['NORTHSTAR_PORT'] ?? process.env['PORT'];
  if (raw === undefined || raw === '') return DEFAULT_PORT;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
    process.stderr.write(`northstar: NORTHSTAR_PORT/PORT must be a port number, found "${raw}"\n`);
    process.exit(1);
  }
  return parsed;
}

function respond(request: IncomingMessage, response: ServerResponse): void {
  const answer = handleRequest(request.method ?? 'GET', request.url ?? '/');
  const body = typeof answer.body === 'string' ? Buffer.from(answer.body, 'utf8') : Buffer.from(answer.body);
  response.writeHead(answer.status, { ...answer.headers, 'content-length': String(body.byteLength) });
  // HEAD carries the headers of the GET and none of the body (RFC 9110). Writing one
  // would make a HEAD and a GET disagree about what the system serves.
  if ((request.method ?? 'GET').toUpperCase() === 'HEAD') response.end();
  else response.end(body);
}

const server = createServer((request, response) => {
  try {
    respond(request, response);
  } catch (error) {
    // A synthetic system that throws a stack trace at a Run is a system that taught the
    // Run nothing. Answer in the same shape as every other refusal.
    process.stderr.write(`northstar: ${String(error)}\n`);
    const body = Buffer.from(
      `${JSON.stringify({ error: 'internal_error', message: 'The system could not answer.' }, null, 2)}\n`,
      'utf8',
    );
    response.writeHead(500, {
      'content-type': 'application/json; charset=utf-8',
      'content-length': String(body.byteLength),
    });
    response.end(body);
  }
});

const listenPort = port();
server.listen(listenPort, () => {
  process.stdout.write(
    `${JSON.stringify({
      level: 'info',
      time: new Date().toISOString(),
      service: 'northstar',
      message: 'Serving the synthetic Northstar systems',
      port: listenPort,
      routes: ROUTES.length,
      fixtures: FIXTURES_ROOT,
    })}\n`,
  );
});

const shutdown = (signal: string): void => {
  process.stdout.write(
    `${JSON.stringify({ level: 'info', service: 'northstar', message: 'Shutting down', signal })}\n`,
  );
  server.close(() => process.exit(0));
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
