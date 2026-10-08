#!/usr/bin/env node
// Test driver for the provider's real, cookie-bound password form and code flow.
// It never calls the application's callback or manufactures authorization codes.
import { request } from 'node:https';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fixtureDirectory } from './setup.mjs';

export function httpsRequest(url, { ca, method = 'GET', headers = {}, body } = {}) {
  return new Promise((done, reject) => {
    const req = request(url, { ca, method, headers, timeout: 10_000 }, (res) => {
      const chunks = [];
      let size = 0;
      res.on('data', (chunk) => {
        size += chunk.length;
        if (size > 2 * 1024 * 1024) { res.destroy(); reject(new Error('fixture_response_too_large')); return; }
        chunks.push(chunk);
      });
      res.on('end', () => done({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString('utf8') }));
      res.on('error', () => reject(new Error('fixture_response_failed')));
    });
    req.on('timeout', () => req.destroy(new Error('fixture_request_timeout')));
    req.on('error', () => reject(new Error('fixture_request_failed')));
    req.end(body);
  });
}

export async function completeLogin(authorizationUrl, account = 'auditor-a', { directory = fixtureDirectory } = {}) {
  const config = JSON.parse(readFileSync(join(directory, 'fixture.json'), 'utf8'));
  const ca = readFileSync(join(directory, 'ca.pem'));
  let url = new URL(authorizationUrl);
  if (url.protocol !== 'https:' || url.hostname !== '127.0.0.1' || url.username || url.password || url.pathname !== '/auth') throw new Error('fixture_authorization_url_invalid');
  const issuer = url.origin;
  const callback = new URL(url.searchParams.get('redirect_uri'));
  if (callback.protocol !== 'https:' || callback.hostname !== 'localhost' || callback.pathname !== '/api/auth/callback' || callback.username || callback.password || callback.search || callback.hash) throw new Error('fixture_callback_invalid');
  const cookies = new Map();
  let method = 'GET';
  let body;
  for (let hop = 0; hop < 16; hop += 1) {
    if (url.origin === callback.origin && url.pathname === callback.pathname) {
      if (!url.searchParams.get('code')) throw new Error('fixture_authorization_refused');
      return { code: url.searchParams.get('code'), state: url.searchParams.get('state'), redirect_uri: url.href };
    }
    if (url.origin !== issuer) throw new Error('fixture_redirect_refused');
    const headers = {};
    const sentCookies = [...cookies.values()].filter((cookie) => url.pathname.startsWith(cookie.path)).map((cookie) => `${cookie.name}=${cookie.value}`);
    if (sentCookies.length) headers.cookie = sentCookies.join('; ');
    if (method === 'POST') { headers.origin = issuer; headers['content-type'] = 'application/x-www-form-urlencoded'; }
    const response = await httpsRequest(url, { ca, method, headers, body });
    for (const raw of response.headers['set-cookie'] ?? []) {
      const [pair, ...attributes] = raw.split(';');
      const index = pair.indexOf('=');
      const name = pair.slice(0, index);
      const value = pair.slice(index + 1);
      const path = attributes.find((attribute) => /^\s*path=/i.test(attribute))?.trim().slice(5) ?? '/';
      const key = `${name}:${path}`;
      if (!value || attributes.some((attribute) => /^\s*max-age=0$/i.test(attribute))) cookies.delete(key);
      else cookies.set(key, { name, value, path });
    }
    if ([302, 303].includes(response.status) && response.headers.location) {
      url = new URL(response.headers.location, url);
      method = 'GET'; body = undefined; continue;
    }
    if (response.status === 200 && url.pathname.startsWith('/interaction/')) {
      const csrf = /name="csrf" value="([A-Za-z0-9_-]+)"/.exec(response.body)?.[1];
      if (!csrf) throw new Error('fixture_login_form_invalid');
      body = new URLSearchParams({ username: account, password: config.account_password, csrf }).toString();
      method = 'POST'; continue;
    }
    throw new Error('fixture_login_failed');
  }
  throw new Error('fixture_redirect_limit');
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const input = process.argv[2] === '--stdin' ? JSON.parse(readFileSync(0, 'utf8')) : { authorization_url: process.argv[2], account: process.argv[3] };
    console.log(JSON.stringify(await completeLogin(input.authorization_url, input.account)));
  } catch {
    console.error('fixture_login_flow_failed');
    process.exitCode = 1;
  }
}
