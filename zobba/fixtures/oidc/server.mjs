#!/usr/bin/env node
import { createServer } from 'node:https';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Readable } from 'node:stream';
import Provider from 'oidc-provider';
import { decodeJwt, importJWK, SignJWT } from 'jose';
import { fixtureDirectory } from './setup.mjs';

export const scenarios = new Set([
  'normal', 'bad_issuer', 'bad_audience', 'multi_audience', 'missing_azp', 'bad_azp',
  'bad_signature', 'bad_algorithm', 'no_signature', 'unknown_key', 'key_rotation',
  'same_kid_rotation', 'retired_key', 'retired_key_unavailable',
  'expired', 'future_iat', 'old_iat', 'bad_expiry', 'bad_nonce', 'no_nonce', 'bad_at_hash',
  'untrusted_jku', 'untrusted_x5u',
  'untrusted_token_endpoint', 'untrusted_authorization_endpoint', 'untrusted_jwks_uri', 'bad_discovery_issuer',
  ...['token', 'jwks', 'discovery'].flatMap((endpoint) => ['oversized', 'oversized_chunked', 'padded', 'padded_chunked', 'slow', 'redirect'].map((kind) => `${kind}_${endpoint}`)),
]);

function equal(left, right) {
  const a = Buffer.from(String(left ?? ''));
  const b = Buffer.from(String(right ?? ''));
  return a.length === b.length && timingSafeEqual(a, b);
}

function publicKey({ kty, n, e, use, alg, kid }) { return { kty, n, e, use, alg, kid }; }
const escape = (text) => String(text).replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);

async function readBody(request) {
  const chunks = [];
  let length = 0;
  for await (const chunk of request) {
    length += chunk.length;
    if (length > 8192) throw new Error('fixture_request_too_large');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

function json(response, status, body) {
  response.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
  response.end(JSON.stringify(body));
}

export async function startFixture({ directory = fixtureDirectory, port = Number(process.env.ZOBBA_FIXTURE_PORT ?? 9443), appPort = Number(process.env.ZOBBA_FIXTURE_APP_PORT ?? 5173) } = {}) {
  if (process.env.ZOBBA_LOCAL_FIXTURES !== '1') throw new Error('fixture_requires_explicit_local_configuration');
  if (!Number.isInteger(port) || port < 1024 || port > 65535 || !Number.isInteger(appPort) || appPort < 1024 || appPort > 65535) throw new Error('fixture_port_invalid');
  const config = JSON.parse(readFileSync(join(directory, 'fixture.json'), 'utf8'));
  const issuer = `https://127.0.0.1:${port}`;
  const redirectUri = `https://localhost:${appPort}/api/auth/callback`;
  let scenario = 'normal';
  let publishedKeys = [publicKey(config.keys[0])];
  const counters = { token_requests: 0, jwks_requests: 0, discovery_requests: 0, untrusted_key_requests: 0 };
  const csrfTokens = new Map();
  const provider = new Provider(issuer, {
    clients: [{ client_id: config.client_id, client_secret: config.client_secret, redirect_uris: [redirectUri], response_types: ['code'], grant_types: ['authorization_code'], token_endpoint_auth_method: 'client_secret_basic', id_token_signed_response_alg: 'RS256' }],
    jwks: { keys: [config.keys[0]] },
    cookies: { keys: config.cookie_keys, short: { secure: true, sameSite: 'lax' }, long: { secure: true, sameSite: 'lax' } },
    features: { devInteractions: { enabled: false }, claimsParameter: { enabled: true } },
    enabledJWA: { idTokenSigningAlgValues: ['RS256'] },
    pkce: { methods: ['S256'], required: () => true },
    responseTypes: ['code'],
    claims: { openid: ['sub'], profile: ['name'] },
    scopes: ['openid', 'profile'],
    ttl: { IdToken: 300, AccessToken: 300, Grant: 600, AuthorizationCode: 60, Interaction: 300, Session: 600 },
    interactions: { url: (_ctx, interaction) => `/interaction/${interaction.uid}` },
    findAccount: async (_ctx, id) => config.accounts.includes(id) ? { accountId: id, claims: async () => ({ sub: id, name: id }) } : undefined,
    renderError: async (ctx) => { ctx.type = 'text/plain'; ctx.body = 'Synthetic sign-in request refused.'; },
  });

  async function mutateToken(token) {
    if (scenario === 'normal' || /^(oversized|padded|slow|redirect)_/.test(scenario)) return token;
    const claims = decodeJwt(token);
    const now = Math.floor(Date.now() / 1000);
    let key = config.keys[0];
    const header = { alg: 'RS256', kid: key.kid };
    switch (scenario) {
      case 'bad_issuer': claims.iss = 'https://wrong-issuer.invalid'; break;
      case 'bad_audience': claims.aud = 'wrong-client'; break;
      case 'multi_audience': claims.aud = [config.client_id, 'wrong-client']; claims.azp = config.client_id; break;
      case 'missing_azp': claims.aud = [config.client_id, 'wrong-client']; delete claims.azp; break;
      case 'bad_azp': claims.azp = 'wrong-client'; break;
      case 'bad_nonce': claims.nonce = 'unrelated-nonce'; break;
      case 'no_nonce': delete claims.nonce; break;
      case 'bad_at_hash': claims.at_hash = 'invalid-hash-value'; break;
      case 'expired': claims.iat = now - 61; claims.exp = now - 1; break;
      case 'future_iat': claims.iat = now + 120; claims.exp = now + 420; break;
      case 'old_iat': claims.iat = now - 700; claims.exp = now + 300; break;
      case 'bad_expiry': claims.iat = now; claims.exp = now + 7200; break;
      case 'bad_signature': key = config.keys[2]; break;
      case 'unknown_key': key = config.keys[2]; header.kid = key.kid; break;
      case 'key_rotation':
        key = config.keys[1]; header.kid = key.kid;
        publishedKeys = [publicKey(config.keys[0]), publicKey(key)];
        break;
      case 'same_kid_rotation':
        key = config.keys[1];
        publishedKeys = [{ ...publicKey(key), kid: header.kid }];
        break;
      case 'bad_algorithm': header.alg = 'RS512'; break;
      case 'no_signature': return `${Buffer.from(JSON.stringify({ alg: 'none', kid: key.kid })).toString('base64url')}.${Buffer.from(JSON.stringify(claims)).toString('base64url')}.`;
      case 'untrusted_jku': key = config.keys[2]; header.kid = key.kid; header.jku = `${issuer}/__untrusted/jwks`; break;
      case 'untrusted_x5u': key = config.keys[2]; header.kid = key.kid; header.x5u = `${issuer}/__untrusted/cert`; break;
    }
    return new SignJWT(claims).setProtectedHeader(header).sign(await importJWK({ ...key, alg: header.alg }, header.alg));
  }

  // Provider middleware changes the real provider's responses only after its
  // authorization-code and PKCE checks. No application route trusts this API.
  provider.use(async (ctx, next) => {
    const endpoint = ctx.path === '/token' ? 'token' : ctx.path === '/jwks' ? 'jwks' : ctx.path === '/.well-known/openid-configuration' ? 'discovery' : undefined;
    if (endpoint) counters[`${endpoint}_requests`] += 1;
    if (endpoint && scenario === `slow_${endpoint}`) await new Promise((done) => setTimeout(done, 6500));
    if (endpoint && scenario === `redirect_${endpoint}`) { ctx.status = 302; ctx.set('Location', `${issuer}/__untrusted/${endpoint}`); return; }
    if (endpoint === 'jwks' && scenario === 'retired_key_unavailable') {
      ctx.status = 503; ctx.body = { error: 'fixture_jwks_unavailable' };
      return;
    }
    await next();
    if (endpoint === 'token' && ctx.body?.id_token) ctx.body.id_token = await mutateToken(ctx.body.id_token);
    if (endpoint === 'jwks') ctx.body = { keys: publishedKeys };
    if (endpoint === 'discovery' && ctx.body) {
      const mutations = {
        untrusted_token_endpoint: ['token_endpoint', 'https://untrusted.invalid/token'],
        untrusted_authorization_endpoint: ['authorization_endpoint', 'https://untrusted.invalid/auth'],
        untrusted_jwks_uri: ['jwks_uri', 'https://untrusted.invalid/jwks'],
        bad_discovery_issuer: ['issuer', 'https://untrusted.invalid'],
      };
      const mutation = mutations[scenario];
      if (mutation) ctx.body[mutation[0]] = mutation[1];
    }
    const padding = /^(oversized|padded)(_chunked)?_(token|jwks|discovery)$/.exec(scenario);
    if (endpoint && padding?.[3] === endpoint && ctx.status === 200 && ctx.body) {
      // Keep the original, valid protocol response. Without the relying party's
      // byte limit this padding must not independently invalidate the response.
      const size = padding[1] === 'oversized' ? 1024 * 1024 : endpoint === 'token' ? 32 * 1024 : 128 * 1024;
      const body = JSON.stringify({ ...ctx.body, padding: 'x'.repeat(size) });
      ctx.type = 'application/json';
      if (padding[2]) {
        ctx.remove('Content-Length');
        ctx.body = Readable.from((function* () {
          for (let offset = 0; offset < body.length; offset += 16 * 1024) yield body.slice(offset, offset + 16 * 1024);
        })());
      } else {
        ctx.body = body;
        ctx.set('Content-Length', String(Buffer.byteLength(body)));
      }
    }
  });

  // Expected client cancellation during streaming-limit tests must not dump
  // provider errors or request context. Other failures retain one fixed code.
  provider.on('error', (error) => {
    if (error?.code !== 'ERR_STREAM_PREMATURE_CLOSE') console.error('fixture_provider_request_failed');
  });
  const callback = provider.callback();
  const server = createServer({ key: readFileSync(join(directory, 'idp-key.pem')), cert: readFileSync(join(directory, 'idp-cert.pem')), minVersion: 'TLSv1.2' }, async (request, response) => {
    response.setHeader('cache-control', 'no-store');
    response.setHeader('x-content-type-options', 'nosniff');
    // `no-referrer` makes Chromium send Origin:null on this password form.
    // Keep the same-origin CSRF proof while stripping cross-origin referrers.
    response.setHeader('referrer-policy', 'same-origin');
    try {
      // Parse untrusted targets inside the fixed-error boundary. Never derive a
      // public URL or redirect from Host or forwarded headers.
      const pathname = new URL(request.url, issuer).pathname;
      if (pathname === '/health') { json(response, 200, { status: 'ready', synthetic: true }); return; }
      if (pathname.startsWith('/__admin/')) {
        if (!equal(request.headers.authorization, `Bearer ${config.admin_secret}`)) { json(response, 401, { error: 'fixture_admin_required' }); return; }
        if (pathname === '/__admin/status' && request.method === 'GET') { json(response, 200, { scenario, ...counters }); return; }
        if (pathname === '/__admin/reset' && request.method === 'POST') {
          scenario = 'normal'; publishedKeys = [publicKey(config.keys[0])];
          for (const name of Object.keys(counters)) counters[name] = 0;
          json(response, 200, { scenario }); return;
        }
        if (pathname === '/__admin/scenario' && request.method === 'POST') {
          const input = JSON.parse(await readBody(request));
          if (!scenarios.has(input.scenario)) { json(response, 400, { error: 'fixture_scenario_invalid' }); return; }
          scenario = input.scenario;
          if (scenario === 'retired_key' || scenario === 'retired_key_unavailable') publishedKeys = [publicKey(config.keys[1])];
          json(response, 200, { scenario }); return;
        }
        json(response, 404, { error: 'fixture_route_not_found' }); return;
      }
      if (pathname.startsWith('/__untrusted/')) { counters.untrusted_key_requests += 1; json(response, 200, { keys: [publicKey(config.keys[2])] }); return; }
      if (pathname.startsWith('/interaction/')) {
        const { uid, prompt, params, session } = await provider.interactionDetails(request, response);
        if (pathname !== `/interaction/${uid}`) { json(response, 400, { error: 'fixture_interaction_invalid' }); return; }
        if (request.method === 'GET' && prompt.name === 'consent') {
          const grant = new provider.Grant({ accountId: session.accountId, clientId: params.client_id });
          grant.addOIDCScope('openid profile');
          if (prompt.details.missingOIDCClaims) grant.addOIDCClaims(prompt.details.missingOIDCClaims);
          const grantId = await grant.save();
          await provider.interactionFinished(request, response, { consent: { grantId } }, { mergeWithLastSubmission: true });
          return;
        }
        if (prompt.name !== 'login') { json(response, 400, { error: 'fixture_interaction_invalid' }); return; }
        if (request.method === 'POST') {
          const body = new URLSearchParams(await readBody(request));
          const csrf = csrfTokens.get(uid);
          csrfTokens.delete(uid);
          if (request.headers.origin !== issuer || !csrf || !equal(body.get('csrf'), csrf.token) || csrf.expires < Date.now()) { json(response, 403, { error: 'fixture_form_refused' }); return; }
          const username = body.get('username');
          if (!config.accounts.includes(username) || !equal(body.get('password'), config.account_password)) { json(response, 401, { error: 'fixture_credentials_invalid' }); return; }
          await provider.interactionFinished(request, response, { login: { accountId: username } }, { mergeWithLastSubmission: false });
          return;
        }
        if (request.method !== 'GET') { json(response, 405, { error: 'fixture_method_invalid' }); return; }
        for (const [key, value] of csrfTokens) if (value.expires < Date.now()) csrfTokens.delete(key);
        if (csrfTokens.size >= 1000) { json(response, 503, { error: 'fixture_capacity' }); return; }
        const csrf = randomBytes(24).toString('base64url');
        csrfTokens.set(uid, { token: csrf, expires: Date.now() + 300_000 });
        response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'content-security-policy': `default-src 'none'; img-src data:; style-src 'unsafe-inline'; form-action 'self' ${new URL(redirectUri).origin}; frame-ancestors 'none'; base-uri 'none'` });
        response.end(`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><link rel="icon" href="data:,"><title>Synthetic Zobba sign-in</title><style>body{font:18px system-ui;max-width:32rem;margin:10vh auto;padding:1rem;color:#182d2a;background:#faf9f6}label,input,select,button{display:block;margin:.6rem 0}input,select,button{font:inherit;padding:.6rem;max-width:100%;box-sizing:border-box}button{background:#173e35;color:white;border:0;border-radius:.35rem;cursor:pointer}input:focus-visible,select:focus-visible,button:focus-visible{outline:3px solid #967000;outline-offset:3px}</style><main><h1>Synthetic account sign-in</h1><p>Local test identity provider. Use a generated fixture password.</p><form method="post" action="/interaction/${escape(uid)}"><input type="hidden" name="csrf" value="${csrf}"><label for="username">Account</label><select id="username" name="username" autocomplete="username" required autofocus>${config.accounts.map((account) => `<option value="${escape(account)}">${escape(account)}</option>`).join('')}</select><label for="password">Password</label><input id="password" name="password" type="password" autocomplete="current-password" required><button type="submit">Sign in</button></form></main></html>`);
        return;
      }
      callback(request, response);
    } catch {
      if (!response.headersSent) json(response, 400, { error: 'fixture_request_refused' });
      else response.end();
    }
  });
  server.requestTimeout = 10_000;
  server.headersTimeout = 10_000;
  await new Promise((done, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', done); });
  return { server, issuer, redirectUri, config, close: () => new Promise((done) => { server.closeAllConnections(); server.close(done); }) };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const fixture = await startFixture();
    console.log(`Synthetic OIDC fixture ready at ${fixture.issuer}`);
    for (const signal of ['SIGTERM', 'SIGINT']) process.once(signal, async () => { await fixture.close(); process.exit(0); });
  } catch {
    console.error('fixture_start_failed: run setup and enable ZOBBA_LOCAL_FIXTURES=1');
    process.exitCode = 1;
  }
}
