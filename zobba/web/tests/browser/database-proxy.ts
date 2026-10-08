import { databaseEndpoint } from './database-endpoint.ts';
import { once } from 'node:events';
import { connect, createServer } from 'node:net';
import type { Server, Socket } from 'node:net';

function port(server: Server): number {
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

/** Break only the test API's PostgreSQL connections, never the database itself. */
export class DatabaseProxy {
  private readonly sockets = new Set<Socket>();
  private enabled = true;
  private readonly server: Server;

  private readonly source: URL;

  constructor(source: URL) {
    this.source = source;
    const endpoint = databaseEndpoint(source);
    this.server = createServer((client) => {
      if (!this.enabled) { client.destroy(); return; }
      const database = connect(endpoint);
      this.sockets.add(client);
      this.sockets.add(database);
      const dispose = () => {
        client.destroy();
        database.destroy();
        this.sockets.delete(client);
        this.sockets.delete(database);
      };
      client.on('error', dispose);
      database.on('error', dispose);
      client.on('close', dispose);
      database.on('close', dispose);
      client.pipe(database);
      database.pipe(client);
    });
  }

  async start(): Promise<string> {
    await listen(this.server);
    const url = new URL(this.source);
    url.hostname = '127.0.0.1';
    url.port = String(port(this.server));
    return url.toString();
  }

  disconnect(): void {
    this.enabled = false;
    for (const socket of this.sockets) socket.destroy();
    this.sockets.clear();
  }

  restore(): void { this.enabled = true; }

  async close(): Promise<void> {
    this.disconnect();
    await close(this.server);
  }
}
