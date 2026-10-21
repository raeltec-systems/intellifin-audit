import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { databaseEndpoint } from './browser/database-endpoint.ts';

test('PostgreSQL TCP endpoint preserves IPv6 and port precedence', () => {
  assert.deepEqual(databaseEndpoint(new URL('postgres://role@[::1]:55439/db'), '1'), { host: '::1', port: 55439 });
  assert.deepEqual(databaseEndpoint(new URL('postgres://role@localhost/db'), '55439'), { host: 'localhost', port: 55439 });
  assert.deepEqual(databaseEndpoint(new URL('postgres://role@localhost/db'), ''), { host: 'localhost', port: 5432 });
  assert.equal(databaseEndpoint(new URL('postgres://role@localhost:5433/db'), 'invalid').port, 5433);
});

test('invalid effective ports fail with a fixed secret-safe diagnostic', () => {
  for (const port of ['0', '-1', '65536', '1.5', 'garbage', ' 5432', '5432 ']) {
    assert.throws(() => databaseEndpoint(new URL('postgres://role:secret@localhost/db'), port),
      { message: 'Invalid PostgreSQL TCP endpoint.' });
  }
  assert.throws(() => databaseEndpoint(new URL('postgres://role@localhost:0/db')));
  assert.throws(() => databaseEndpoint(new URL('https://localhost/db')));
});

test('resolved IPv6 and PGPORT endpoints connect to real loopback sockets', { timeout: 5000 }, async () => {
  const { createServer, connect } = await import('node:net');
  const { once } = await import('node:events');
  for (const host of ['::1', '127.0.0.1']) {
    const server = createServer((socket) => socket.end('routed'));
    server.listen(0, host);
    await once(server, 'listening');
    try {
      const port = server.address().port;
      const bracketed = host === '::1' ? `[${host}]` : host;
      for (const [source, pgport] of [
        [new URL(`postgres://role@${bracketed}:${port}/db`), '1'],
        [new URL(`postgres://role@${bracketed}/db`), String(port)],
      ]) {
        const socket = connect(databaseEndpoint(source, pgport));
        socket.setTimeout(1000, () => socket.destroy(new Error('Endpoint socket timed out.')));
        try {
          let received = '';
          for await (const chunk of socket) received += chunk.toString();
          assert.equal(received, 'routed');
        } finally { socket.destroy(); }
      }
    } finally {
      await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  }
});

test('default resolver reads PGPORT from the environment', () => {
  const previous = process.env.PGPORT;
  try {
    process.env.PGPORT = '55439';
    assert.equal(databaseEndpoint(new URL('postgres://role@localhost/db')).port, 55439);
    process.env.PGPORT = 'invalid';
    assert.throws(() => databaseEndpoint(new URL('postgres://role@localhost/db')));
    delete process.env.PGPORT;
    assert.equal(databaseEndpoint(new URL('postgres://role@localhost/db')).port, 5432);
  } finally {
    if (previous === undefined) delete process.env.PGPORT;
    else process.env.PGPORT = previous;
  }
});

test('browser DatabaseProxy routes IPv6 and PGPORT, disconnects and recovers', { timeout: 10000 }, async () => {
  const { DatabaseProxy } = await import('./browser/database-proxy.ts');
  const { createServer, connect } = await import('node:net');
  const { once } = await import('node:events');
  const previous = process.env.PGPORT;
  const upstreamSockets = new Set();
  try {
    for (const host of ['::1', '127.0.0.1']) {
      const server = createServer((socket) => {
        upstreamSockets.add(socket);
        socket.on('close', () => upstreamSockets.delete(socket));
        socket.on('error', () => socket.destroy());
        socket.pipe(socket);
      });
      server.listen(0, host);
      await once(server, 'listening');
      try {
        const bracketed = host === '::1' ? `[${host}]` : host;
        for (const explicit of [true, false]) {
          process.env.PGPORT = explicit ? '1' : String(server.address().port);
          const source = new URL(`postgres://role@${bracketed}${explicit ? `:${server.address().port}` : ''}/db`);
          const proxy = new DatabaseProxy(source);
          const proxyUrl = new URL(await proxy.start());
          const open = () => {
            const socket = connect({ host: proxyUrl.hostname, port: Number(proxyUrl.port) });
            socket.setTimeout(1000, () => socket.destroy(new Error('Proxy routing timed out.')));
            return socket;
          };
          let socket;
          try {
            socket = open();
            socket.write('ready');
            assert.equal((await once(socket, 'data'))[0].toString(), 'ready');
            const closed = once(socket, 'close');
            proxy.disconnect();
            await closed;
            socket = open();
            await once(socket, 'close');
            proxy.restore();
            socket = open();
            socket.write('recovered');
            assert.equal((await once(socket, 'data'))[0].toString(), 'recovered');
          } finally {
            socket?.destroy();
            await proxy.close();
          }
        }
      } finally {
        for (const socket of upstreamSockets) socket.destroy();
        await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
      }
    }
  } finally {
    if (previous === undefined) delete process.env.PGPORT;
    else process.env.PGPORT = previous;
  }
});
