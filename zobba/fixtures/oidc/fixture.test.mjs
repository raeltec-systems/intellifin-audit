import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { request as rawHttpsRequest } from 'node:https';
import { createServer } from 'node:net';
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { decodeJwt, decodeProtectedHeader, importJWK, jwtVerify } from 'jose';
import { setup } from './setup.mjs';
import { startFixture } from './server.mjs';
import { completeLogin, httpsRequest } from './flow.mjs';

async function freePort() {
  const socket = createServer();
  await new Promise((done) => socket.listen(0, '127.0.0.1', done));
  const port = socket.address().port;
  await new Promise((done) => socket.close(done));
  return port;
}

test('independent HTTPS OIDC fixture uses real code, login, PKCE and controlled negative responses', async (t) => {
  const root = mkdtempSync(join(tmpdir(), 'zobba-oidc-fixture-'));
  const directory = join(root, '.local');
  setup(directory);
  const before = createHash('sha256').update(readFileSync(join(directory, 'fixture.json'))).digest('hex');
  setup(directory);
  assert.equal(createHash('sha256').update(readFileSync(join(directory, 'fixture.json'))).digest('hex'), before);
  assert.equal(statSync(directory).mode & 0o777, 0o700);
  assert.equal(statSync(join(directory, 'fixture.json')).mode & 0o777, 0o600);
  process.env.ZOBBA_LOCAL_FIXTURES = '1';
  const fixture = await startFixture({ directory, port: await freePort() });
  const { config, issuer, redirectUri } = fixture;
  const ca = readFileSync(join(directory, 'ca.pem'));
  t.after(async () => { await fixture.close(); rmSync(root, { recursive: true, force: true }); });
  const request = (path, options) => httpsRequest(`${issuer}${path}`, { ca, ...options });

  await t.test('malformed private configuration produces only a fixed setup diagnostic', () => {
    const configPath = join(directory, 'fixture.json');
    const original = readFileSync(configPath);
    const sentinel = 'DO_NOT_LOG_PRIVATE_FIXTURE_CONFIG_SENTINEL';
    try {
      writeFileSync(configPath, `${sentinel} {malformed json`, { mode: 0o600 });
      const result = spawnSync(process.execPath, [fileURLToPath(new URL('./setup.mjs', import.meta.url))], {
        env: { ...process.env, ZOBBA_FIXTURE_DIR: directory },
        encoding: 'utf8',
        timeout: 10_000,
      });
      assert.equal(result.status, 1);
      assert.equal(result.stdout, '');
      assert.equal(result.stderr, 'fixture_setup_failed\n');
      assert.equal(`${result.stdout}${result.stderr}`.includes(sentinel), false);
    } finally {
      writeFileSync(configPath, original, { mode: 0o600 });
    }
  });

  async function admin(path, body) {
    const response = await request(`/__admin/${path}`, { method: 'POST', headers: { authorization: `Bearer ${config.admin_secret}`, 'content-type': 'application/json' }, body: JSON.stringify(body ?? {}) });
    assert.equal(response.status, 200);
  }
  function authorization(verifier, overrides = {}) {
    const url = new URL(`${issuer}/auth`);
    url.search = new URLSearchParams({ client_id: config.client_id, redirect_uri: redirectUri, response_type: 'code', scope: 'openid profile', claims: JSON.stringify({ id_token: { name: null } }), nonce: 'fixture-nonce', state: 'fixture-state', code_challenge: createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 'S256', ...overrides });
    return url.href;
  }
  async function issue(account = 'auditor-a') {
    const verifier = randomBytes(48).toString('base64url');
    const flow = await completeLogin(authorization(verifier), account, { directory });
    assert.equal(flow.state, 'fixture-state');
    return { ...flow, verifier };
  }
  async function exchange(code, verifier) {
    const response = await request('/token', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', authorization: `Basic ${Buffer.from(`${config.client_id}:${config.client_secret}`).toString('base64')}` }, body: new URLSearchParams({ grant_type: 'authorization_code', redirect_uri: redirectUri, code, code_verifier: verifier }).toString() });
    return { status: response.status, body: JSON.parse(response.body) };
  }

  await t.test('requires explicit configuration and validates local CA', async () => {
    delete process.env.ZOBBA_LOCAL_FIXTURES;
    await assert.rejects(startFixture({ directory, port: await freePort() }), /explicit_local/);
    process.env.ZOBBA_LOCAL_FIXTURES = '1';
    await assert.rejects(httpsRequest(`${issuer}/health`), /request_failed/);
    assert.equal((await request('/health')).status, 200);
  });

  await t.test('malformed request target receives a fixed refusal and the HTTPS server stays usable', async () => {
    const sentinel = 'DO_NOT_LOG_MALFORMED_TARGET_SENTINEL';
    // The options-form path sends this exact target over TLS, without a client
    // URL parser rejecting it before the fixture receives the request.
    const response = await new Promise((done, reject) => {
      const req = rawHttpsRequest({ hostname: '127.0.0.1', port: new URL(issuer).port, path: `https://[${sentinel}/`, ca, timeout: 5000 }, (res) => {
        const chunks = [];
        res.on('data', (chunk) => chunks.push(chunk));
        res.on('end', () => done({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString('utf8') }));
        res.on('error', reject);
      });
      req.on('timeout', () => req.destroy(new Error('malformed_target_response_timeout')));
      req.on('error', reject);
      req.end();
    });
    assert.equal(response.status, 400);
    assert.equal(response.body, '{"error":"fixture_request_refused"}');
    assert.equal(JSON.stringify(response).includes(sentinel), false);
    assert.deepEqual(JSON.parse((await request('/health')).body), { status: 'ready', synthetic: true });
    assert.equal(JSON.parse((await request('/.well-known/openid-configuration')).body).issuer, issuer);
  });

  await t.test('discovery registers exact callback, RS256 and S256', async () => {
    const response = await request('/.well-known/openid-configuration');
    const metadata = JSON.parse(response.body);
    assert.equal(response.status, 200);
    assert.equal(metadata.issuer, issuer);
    assert.deepEqual(metadata.code_challenge_methods_supported, ['S256']);
    assert.deepEqual(metadata.response_types_supported, ['code']);
    assert.deepEqual(metadata.id_token_signing_alg_values_supported, ['RS256']);
    assert.equal((await request('/__admin/scenario', { method: 'POST', body: '{"scenario":"normal"}' })).status, 401);
    await assert.rejects(completeLogin(authorization('x'.repeat(43), { redirect_uri: 'https://localhost:5173/api/auth/unregistered' }), 'auditor-a', { directory }));
    await assert.rejects(completeLogin(authorization('x'.repeat(43), { code_challenge_method: 'plain' }), 'auditor-a', { directory }));
  });

  await t.test('password authentication and PKCE produce a signed ID token; replay refuses', async () => {
    const flow = await issue('manager-a');
    const response = await exchange(flow.code, flow.verifier);
    assert.equal(response.status, 200);
    const jwks = JSON.parse((await request('/jwks')).body);
    const { payload } = await jwtVerify(response.body.id_token, await importJWK(jwks.keys[0], 'RS256'), { issuer, audience: config.client_id, algorithms: ['RS256'] });
    assert.equal(payload.sub, 'manager-a');
    assert.equal(payload.name, 'manager-a');
    assert.equal(payload.nonce, 'fixture-nonce');
    assert.equal((await exchange(flow.code, flow.verifier)).status, 400);
    const wrong = await issue();
    assert.equal((await exchange(wrong.code, 'wrong'.repeat(12))).status, 400);
    await assert.rejects(completeLogin(authorization('x'.repeat(43)), 'unknown-account', { directory }), /login_failed/);
  });

  const claimScenarios = {
    bad_issuer: (claims) => assert.equal(claims.iss, 'https://wrong-issuer.invalid'),
    bad_audience: (claims) => assert.equal(claims.aud, 'wrong-client'),
    multi_audience: (claims) => assert.deepEqual(claims.aud, [config.client_id, 'wrong-client']),
    missing_azp: (claims) => { assert.equal(claims.azp, undefined); assert.equal(claims.aud.length, 2); },
    bad_azp: (claims) => assert.equal(claims.azp, 'wrong-client'),
    bad_nonce: (claims) => assert.equal(claims.nonce, 'unrelated-nonce'),
    no_nonce: (claims) => assert.equal(claims.nonce, undefined),
    bad_at_hash: (claims) => assert.equal(claims.at_hash, 'invalid-hash-value'),
    expired: (claims) => {
      const now = Math.floor(Date.now() / 1000);
      assert.ok(claims.exp < now);
      assert.ok(claims.iat >= now - 65 && claims.iat < now);
      assert.equal(claims.exp - claims.iat, 60);
    },
    old_iat: (claims) => assert.ok(claims.iat < Date.now() / 1000 - 600),
    future_iat: (claims) => assert.ok(claims.iat > Date.now() / 1000 + 60),
    bad_expiry: (claims) => assert.equal(claims.exp - claims.iat, 7200),
  };
  for (const [scenario, check] of Object.entries(claimScenarios)) {
    await t.test(`real code exchange exposes ${scenario} fixture`, async () => {
      await admin('scenario', { scenario });
      const flow = await issue();
      const response = await exchange(flow.code, flow.verifier);
      assert.equal(response.status, 200);
      check(decodeJwt(response.body.id_token));
      if (scenario === 'expired') {
        const key = JSON.parse((await request('/jwks')).body).keys[0];
        const verifier = await importJWK(key, 'RS256');
        const options = { issuer, audience: config.client_id, algorithms: ['RS256'], maxTokenAge: 600 };
        await assert.rejects(jwtVerify(response.body.id_token, verifier, options), { code: 'ERR_JWT_EXPIRED' });
        // One second before expiry, this exact token passes the normal
        // signature, issuer, audience and issued-at-age checks.
        const claims = decodeJwt(response.body.id_token);
        const { payload } = await jwtVerify(response.body.id_token, verifier, { ...options, currentDate: new Date((claims.exp - 1) * 1000) });
        assert.equal(payload.nonce, 'fixture-nonce');
      }
    });
  }
  for (const scenario of ['bad_signature', 'bad_algorithm', 'no_signature', 'unknown_key', 'untrusted_jku', 'untrusted_x5u']) {
    await t.test(`real code exchange exposes ${scenario} fixture`, async () => {
      await admin('scenario', { scenario });
      const flow = await issue();
      const response = await exchange(flow.code, flow.verifier);
      assert.equal(response.status, 200);
      const publicKeys = JSON.parse((await request('/jwks')).body).keys;
      await assert.rejects(jwtVerify(response.body.id_token, await importJWK(publicKeys[0], 'RS256'), { issuer, audience: config.client_id, algorithms: ['RS256'] }));
    });
  }
  await t.test('rotation publishes a new signing key only after a real token exchange', async () => {
    await admin('reset');
    const beforeKeys = JSON.parse((await request('/jwks')).body).keys;
    assert.equal(beforeKeys.length, 1);
    await admin('scenario', { scenario: 'key_rotation' });
    const flow = await issue();
    const response = await exchange(flow.code, flow.verifier);
    const header = decodeProtectedHeader(response.body.id_token);
    assert.ok(beforeKeys.every((key) => key.kid !== header.kid));
    const afterKeys = JSON.parse((await request('/jwks')).body).keys;
    const key = afterKeys.find((candidate) => candidate.kid === header.kid);
    assert.ok(key);
    await jwtVerify(response.body.id_token, await importJWK(key, 'RS256'), { issuer, audience: config.client_id, algorithms: ['RS256'] });
  });

  await t.test('same-kid rotation replaces key material and retains the original key identifier', async () => {
    await admin('reset');
    const beforeKey = JSON.parse((await request('/jwks')).body).keys[0];
    await admin('scenario', { scenario: 'same_kid_rotation' });
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const flow = await issue();
      const response = await exchange(flow.code, flow.verifier);
      const afterKeys = JSON.parse((await request('/jwks')).body).keys;
      assert.equal(afterKeys.length, 1);
      assert.equal(decodeProtectedHeader(response.body.id_token).kid, beforeKey.kid);
      assert.equal(afterKeys[0].kid, beforeKey.kid);
      assert.notEqual(afterKeys[0].n, beforeKey.n);
      await assert.rejects(jwtVerify(response.body.id_token, await importJWK(beforeKey, 'RS256')));
      await jwtVerify(response.body.id_token, await importJWK(afterKeys[0], 'RS256'), { issuer, audience: config.client_id, algorithms: ['RS256'] });
    }
  });

  for (const scenario of ['retired_key', 'retired_key_unavailable']) {
    await t.test(`${scenario} emits an otherwise valid token signed by the retired original key`, async () => {
      await admin('reset');
      const beforeKey = JSON.parse((await request('/jwks')).body).keys[0];
      await admin('scenario', { scenario });
      const flow = await issue();
      const response = await exchange(flow.code, flow.verifier);
      assert.equal(response.status, 200);
      await jwtVerify(response.body.id_token, await importJWK(beforeKey, 'RS256'), { issuer, audience: config.client_id, algorithms: ['RS256'] });
      const jwks = await request('/jwks');
      if (scenario === 'retired_key_unavailable') {
        assert.equal(jwks.status, 503);
        assert.deepEqual(JSON.parse(jwks.body), { error: 'fixture_jwks_unavailable' });
      } else {
        assert.equal(jwks.status, 200);
        const afterKeys = JSON.parse(jwks.body).keys;
        assert.equal(afterKeys.length, 1);
        assert.notEqual(afterKeys[0].kid, beforeKey.kid);
        await assert.rejects(jwtVerify(response.body.id_token, await importJWK(afterKeys[0], 'RS256')));
      }
    });
  }

  const endpoints = [['token', '/token'], ['jwks', '/jwks'], ['discovery', '/.well-known/openid-configuration']];
  for (const [endpoint, path] of endpoints) {
    for (const kind of ['oversized', 'oversized_chunked', 'padded', 'padded_chunked']) {
      const scenario = `${kind}_${endpoint}`;
      await t.test(`${scenario} retains a valid protocol response with independently checked body length`, async () => {
        await admin('reset');
        await admin('scenario', { scenario });
        let response;
        if (endpoint === 'token') {
          const flow = await issue();
          response = await request(path, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded', authorization: `Basic ${Buffer.from(`${config.client_id}:${config.client_secret}`).toString('base64')}` }, body: new URLSearchParams({ grant_type: 'authorization_code', redirect_uri: redirectUri, code: flow.code, code_verifier: flow.verifier }).toString() });
        } else {
          response = await request(path);
        }
        assert.equal(response.status, 200);
        const bytes = Buffer.byteLength(response.body);
        const limit = endpoint === 'token' ? 64 * 1024 : 256 * 1024;
        const oversized = kind.startsWith('oversized');
        assert.equal(bytes > limit, oversized);
        if (kind.endsWith('_chunked')) {
          assert.equal(response.headers['content-length'], undefined);
          assert.equal(response.headers['transfer-encoding'], 'chunked');
        } else {
          assert.equal(Number(response.headers['content-length']), bytes);
          assert.equal(response.headers['transfer-encoding'], undefined);
        }
        const body = JSON.parse(response.body);
        assert.equal(body.padding.length, oversized ? 1024 * 1024 : endpoint === 'token' ? 32 * 1024 : 128 * 1024);
        if (endpoint === 'token') {
          assert.equal(body.token_type, 'Bearer');
          assert.ok(body.access_token);
          const key = JSON.parse((await request('/jwks')).body).keys[0];
          const { payload } = await jwtVerify(body.id_token, await importJWK(key, 'RS256'), { issuer, audience: config.client_id, algorithms: ['RS256'] });
          assert.equal(payload.sub, 'auditor-a');
          assert.equal(payload.nonce, 'fixture-nonce');
          assert.ok(payload.iat >= Math.floor(Date.now() / 1000) - 60);
          assert.equal(payload.exp - payload.iat, 300);
        } else if (endpoint === 'jwks') {
          assert.equal(body.keys.length, 1);
          const flow = await issue();
          const token = await exchange(flow.code, flow.verifier);
          await jwtVerify(token.body.id_token, await importJWK(body.keys[0], 'RS256'), { issuer, audience: config.client_id, algorithms: ['RS256'] });
        } else {
          assert.equal(body.issuer, issuer);
          assert.equal(body.authorization_endpoint, `${issuer}/auth`);
          assert.equal(body.token_endpoint, `${issuer}/token`);
          assert.equal(body.jwks_uri, `${issuer}/jwks`);
          assert.deepEqual(body.id_token_signing_alg_values_supported, ['RS256']);
          assert.deepEqual(body.code_challenge_methods_supported, ['S256']);
          assert.deepEqual(body.response_types_supported, ['code']);
        }
      });
    }
  }

  await t.test('padded token fixtures still require real client, code and PKCE verification', async () => {
    for (const scenario of ['oversized_token', 'oversized_chunked_token', 'padded_token', 'padded_chunked_token']) {
      await admin('scenario', { scenario });
      const flow = await issue();
      const response = await exchange(flow.code, 'wrong'.repeat(12));
      assert.equal(response.status, 400);
      assert.equal(response.body.id_token, undefined);
      assert.equal(response.body.padding, undefined);
    }
  });

  await t.test('redirect fixtures remain isolated behind authenticated controls', async () => {
    for (const [endpoint, path] of endpoints) {
      await admin('scenario', { scenario: `redirect_${endpoint}` });
      const redirect = await request(path);
      assert.equal(redirect.status, 302);
      assert.ok(redirect.headers.location.startsWith(`${issuer}/__untrusted/`));
    }
    await admin('reset');
  });
  for (const [scenario, key, value] of [
    ['untrusted_token_endpoint', 'token_endpoint', 'https://untrusted.invalid/token'],
    ['untrusted_authorization_endpoint', 'authorization_endpoint', 'https://untrusted.invalid/auth'],
    ['untrusted_jwks_uri', 'jwks_uri', 'https://untrusted.invalid/jwks'],
    ['bad_discovery_issuer', 'issuer', 'https://untrusted.invalid'],
  ]) {
    await t.test(`discovery exposes ${scenario} fixture`, async () => {
      await admin('scenario', { scenario });
      const response = await request('/.well-known/openid-configuration');
      assert.equal(JSON.parse(response.body)[key], value);
      await admin('reset');
    });
  }
});
