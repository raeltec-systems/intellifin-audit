/**
 * TEST-HARNESS ONLY. Lets a proxy-unaware client reach an allowlisted host from a
 * container whose egress is intercepted. Used to run `probe-solari.mjs` here.
 *
 * NOT PRODUCT CODE, and on no shipped path. The worker composes the Solari SDK directly
 * through `PlaywrightBrowserExecution`; Railway has no interception proxy, so nothing in a
 * deployment loads this. Same shape and same boundary as the test-only Anthropic HTTP
 * preload the Story 2.7 browser proof already uses.
 *
 * WHY IT IS NEEDED HERE, measured rather than assumed. This environment's allowlist governs
 * ONLY traffic that goes through its CONNECT proxy: a raw socket to the very same host is
 * refused with `HTTP/1.1 403 Forbidden`, `x-deny-reason: host_not_allowed`, whether it
 * carries a plain GET or a WebSocket upgrade. The Solari SDK dials its wire-protocol socket
 * directly and has no proxy support at all, so no allowlist entry can reach it — which is
 * why an earlier ask to "allow the WebSocket host" was the wrong ask.
 *
 * What it does: starts a LOCAL FORWARDER — a TCP server that opens a CONNECT tunnel per
 * connection and pipes bytes through it — then patches `tls.connect` to redirect only the
 * TCP endpoint at that forwarder while keeping `servername`. The handshake still terminates
 * at the true host and is still validated against its certificate, and the caller receives a
 * genuine `TLSSocket`. An earlier version returned a synthetic socket and broke `fetch`,
 * which undici drives through `tls.connect` itself — hence a redirect rather than a wrapper.
 *
 *   cd packages/infrastructure
 *   TUNNEL_HOSTS=api.getsolari.com node --import ./scripts/proxy-tunnel-preload.mjs \
 *     scripts/probe-solari.mjs
 */
import net from 'node:net';
import tls from 'node:tls';

const proxy = process.env.HTTPS_PROXY ?? process.env.https_proxy;
const TARGETS = new Set(
  (process.env.TUNNEL_HOSTS ?? 'api.getsolari.com').split(',').map((host) => host.trim()),
);

if (proxy) {
  const url = new URL(proxy);
  const forwarder = net.createServer((client) => {
    const upstream = net.connect({ host: url.hostname, port: Number(url.port) }, () => {
      upstream.write(`CONNECT ${client.__host}:443 HTTP/1.1\r\nHost: ${client.__host}:443\r\n\r\n`);
    });
    let head = '';
    const onData = (chunk) => {
      head += chunk.toString('latin1');
      const end = head.indexOf('\r\n\r\n');
      if (end === -1) return;
      upstream.removeListener('data', onData);
      if (!/ 200 /.test(head.split('\r\n')[0])) {
        client.destroy();
        upstream.destroy();
        return;
      }
      const rest = Buffer.from(head.slice(end + 4), 'latin1');
      if (rest.length) client.write(rest);
      upstream.pipe(client);
      client.pipe(upstream);
    };
    upstream.on('data', onData);
    upstream.on('error', () => client.destroy());
    client.on('error', () => upstream.destroy());
  });

  // One forwarder port per target host, so the CONNECT names the right authority.
  const ports = new Map();
  const listen = (host) =>
    new Promise((resolve) => {
      const server = net.createServer((client) => {
        client.__host = host;
        forwarder.emit('connection', client);
      });
      server.listen(0, '127.0.0.1', () => resolve(server.address().port));
    });
  for (const host of TARGETS) ports.set(host, await listen(host));

  const original = tls.connect.bind(tls);
  tls.connect = function connectViaForwarder(...args) {
    const options = typeof args[0] === 'object' ? args[0] : null;
    const host = options?.host ?? options?.servername;
    if (!options || !host || !ports.has(host)) return original(...args);
    // Redirect the TCP endpoint only. `servername` stays the true host, so the certificate
    // is still validated against it and the caller gets a genuine TLSSocket.
    return original(
      {
        ...options,
        host: '127.0.0.1',
        port: ports.get(host),
        servername: options.servername ?? host,
      },
      ...args.slice(1),
    );
  };
}
