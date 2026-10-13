// CloudFront Function behaviour, run with `node --test`. The functions are
// plain cloudfront-js-2.0 handlers; they are evaluated here without AWS.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const load = (name) =>
  new Function(`${readFileSync(new URL(`../functions/${name}.js`, import.meta.url), 'utf8')}; return handler;`)();
const run = (handler, uri, querystring = {}) => handler({ request: { uri, querystring } }).uri;

test('the /api prefix is removed exactly as the development proxy does', () => {
  const strip = load('strip-api-prefix');
  // Same rule as zobba/web/vite.config.ts: path.replace(/^\/api(?=\/)/, '')
  for (const uri of ['/api/auth/callback', '/api/health/ready', '/api/', '/api/api/x', '/apix/y', '/api']) {
    assert.equal(run(strip, uri), uri.replace(/^\/api(?=\/)/, ''), uri);
  }
});

test('the query string is untouched', () => {
  const strip = load('strip-api-prefix');
  const request = { uri: '/api/auth/callback', querystring: { code: { value: 'c' }, state: { value: 's' } } };
  const result = strip({ request });
  assert.equal(result.uri, '/auth/callback');
  assert.deepEqual(result.querystring, { code: { value: 'c' }, state: { value: 's' } });
});

test('client-side routes are served index.html; files are not rewritten', () => {
  const routes = load('web-routes');
  for (const uri of ['/', '/status', '/membership', '/methodology/x']) assert.equal(run(routes, uri), '/index.html', uri);
  for (const uri of ['/index.html', '/assets/index-abc123.js', '/favicon.svg']) assert.equal(run(routes, uri), uri, uri);
});
