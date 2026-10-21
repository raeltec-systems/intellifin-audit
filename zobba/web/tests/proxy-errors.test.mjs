import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:net';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { createServer as createViteServer, createLogger } from 'vite';

// Exercise Vite's real built-in error listener, not only the sanitizer callback.
test('proxy failure never logs callback query or cookie credentials', async () => {
  const listener = createServer();
  listener.listen(0, '127.0.0.1');
  await once(listener, 'listening');
  const unavailablePort = listener.address().port;
  await new Promise((resolve) => listener.close(resolve));
  const recorded = [];
  const logger = createLogger('error');
  logger.error = (message, options) => {
    recorded.push(message, JSON.stringify(options?.error, Object.getOwnPropertyNames(options?.error ?? {})));
  };
  const tlsKey = process.env.ZOBBA_LOCAL_TLS_KEY;
  const tlsCert = process.env.ZOBBA_LOCAL_TLS_CERT;
  delete process.env.ZOBBA_LOCAL_TLS_KEY;
  delete process.env.ZOBBA_LOCAL_TLS_CERT;
  let vite;
  try {
    vite = await createViteServer({ root: fileURLToPath(new URL('..', import.meta.url)),
      configFile: fileURLToPath(new URL('../vite.config.ts', import.meta.url)), customLogger: logger,
      server: { host: '127.0.0.1', port: 0, proxy: { '/api': { target: `http://127.0.0.1:${unavailablePort}` } } },
    });
    await vite.listen();
    const port = vite.httpServer.address().port;
    const response = await fetch(`http://127.0.0.1:${port}/api/auth/callback?code=secret-code-sentinel&state=secret-state-sentinel`, {
      headers: { Cookie: '__Host-zobba-login=secret-cookie-sentinel', Authorization: 'Bearer secret-authorization-sentinel' },
    });
    assert.equal(response.status, 502);
    const output = recorded.join('\n');
    assert.match(output, /upstream_unavailable/);
    assert.doesNotMatch(output, /secret-|code=|state=|ECONNREFUSED/);
  } finally {
    await vite?.close();
    if (tlsKey !== undefined) process.env.ZOBBA_LOCAL_TLS_KEY = tlsKey;
    if (tlsCert !== undefined) process.env.ZOBBA_LOCAL_TLS_CERT = tlsCert;
  }
});
