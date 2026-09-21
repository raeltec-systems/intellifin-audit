import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { CREDENTIAL_FIELD, SESSION_COOKIE, SIGN_IN_PATH } from './authentication.js';
import { datasets, loanCoreCredential } from './fixtures.js';
import { authenticationProof } from './loancore.js';
import { READ_ONLY_ERROR } from './read-only.js';
import { handleRequest, parseRequest } from './server.js';

const PATH = '/loancore/authentication-proof';
const credential = loanCoreCredential().token;
const signedIn = handleRequest('POST', SIGN_IN_PATH,
  { 'content-type': 'application/x-www-form-urlencoded' },
  new URLSearchParams({ [CREDENTIAL_FIELD]: credential }).toString());
const cookie = (signedIn.headers['set-cookie'] ?? '').split(';')[0]!;
const expected = {
  schemaVersion: 1,
  system: 'northstar-loancore',
  account: 'audit.readonly',
  rights: 'read-only',
  policy: 'northstar-read-only-v1',
};
const body = (response: ReturnType<typeof handleRequest>) => typeof response.body === 'string'
  ? response.body : Buffer.from(response.body).toString('utf8');

describe('Northstar authenticated read-only proof prerequisite', () => {
  it('returns the exact closed proof after the actual sign-in route validates the credential', () => {
    expect(signedIn.status).toBe(303);
    expect(cookie.startsWith(`${SESSION_COOKIE}=`)).toBe(true);
    const response = handleRequest('GET', PATH, { cookie });
    expect(response.status).toBe(200);
    expect(JSON.parse(body(response))).toEqual(expected);
    expect(response.headers['content-type']).toBe('application/json; charset=utf-8');
    expect(response.headers['cache-control']).toContain('no-store');
    expect(response.headers['location']).toBeUndefined();
    expect(response.headers['set-cookie']).toBeUndefined();
    const serialized = JSON.stringify(response);
    for (const sensitive of [credential, cookie, cookie.slice(cookie.indexOf('=') + 1)])
      expect(serialized.includes(sensitive)).toBe(false);
  });

  it.each([
    ['missing', {}],
    ['wrong', { cookie: `${SESSION_COOKIE}=invalid-session` }],
    // This is an obsolete credential-derived token, not a temporally expired session.
    ['old credential', { cookie: `${SESSION_COOKIE}=${createHash('sha256').update('loancore-session:obsolete-synthetic-credential').digest('hex')}` }],
    ['wrong cookie name', { cookie: `other_session=${cookie.slice(cookie.indexOf('=') + 1)}` }],
    ['legacy authorization header', { authorization: `Bearer ${credential}` }],
  ] as const)('refuses %s authentication without redirecting to or returning a proof', (_label, headers) => {
    const response = handleRequest('GET', PATH, headers);
    expect(response.status).toBe(401);
    expect(response.headers['location']).toBeUndefined();
    expect(response.headers['set-cookie']).toBeUndefined();
    const payload = JSON.parse(body(response)) as Record<string, unknown>;
    expect(payload.error).toBe('authentication_required');
    expect(payload).not.toHaveProperty('rights');
    expect(payload).not.toHaveProperty('account');
    expect(body(response).includes(credential)).toBe(false);
  });

  it('does not let query, body, or headers select another account or assert rights', () => {
    const response = handleRequest('GET', `${PATH}?account=administrator&rights=write&token=not-reflected`,
      { cookie, 'x-account': 'administrator' }, '{"account":"administrator","rights":"write"}');
    expect(response.status).toBe(200);
    expect(JSON.parse(body(response))).toEqual(expected);
    expect(body(response)).not.toContain('not-reflected');
    expect(handleRequest('GET', `${PATH}?cookie=${encodeURIComponent(cookie)}`).status).toBe(401);
  });

  it('rejects a bad sign-in and independently fails closed when the handler has no valid session', () => {
    const refused = handleRequest('POST', SIGN_IN_PATH,
      { 'content-type': 'application/x-www-form-urlencoded' }, 'credential=incorrect');
    expect(refused.status).toBe(401);
    expect(refused.headers['set-cookie']).toBeUndefined();
    expect(authenticationProof(parseRequest('GET', PATH)).status).toBe(401);
  });

  it.each(['POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'TRACE', 'CONNECT'])('refuses %s through the actual global method policy without changing target data', method => {
    const before = JSON.stringify(datasets.loancore());
    const employee = datasets.loancore().accounts[0]!;
    const accountPath = `/loancore/users/${encodeURIComponent(employee.employee_id)}`;
    const accountBefore = body(handleRequest('GET', accountPath, { cookie }));
    for (const headers of [{}, { cookie }]) {
      const response = handleRequest(method, PATH, headers, '{"rights":"write","status":"Disabled"}');
      expect(response.status).toBe(405);
      expect(response.headers['allow']).toBe('GET, HEAD');
      expect(JSON.parse(body(response))).toMatchObject({ error: READ_ONLY_ERROR, allowed: ['GET', 'HEAD'] });
      expect(JSON.parse(body(response))).not.toHaveProperty('rights');
      expect(response.headers['set-cookie']).toBeUndefined();
    }
    // The asserted right governs the account resource too, not just the proof endpoint.
    const mutation = handleRequest(method, accountPath, { cookie }, '{"status":"Disabled"}');
    expect(mutation.status).toBe(405);
    expect(JSON.parse(body(mutation))).toMatchObject({ error: READ_ONLY_ERROR });
    expect(JSON.stringify(datasets.loancore())).toBe(before);
    expect(body(handleRequest('GET', accountPath, { cookie }))).toBe(accountBefore);
    expect(JSON.parse(body(handleRequest('GET', PATH, { cookie })))).toEqual(expected);
  });

  it('keeps HEAD authenticated and rejects undeclared path variants without redirect proof', () => {
    expect(handleRequest('HEAD', PATH).status).toBe(401);
    const head = handleRequest('HEAD', PATH, { cookie });
    expect(head.status).toBe(200);
    expect(head.headers).toEqual(handleRequest('GET', PATH, { cookie }).headers);
    for (const path of [`${PATH}/`, `${PATH}/extra`, '/loancore/Authentication-proof']) {
      const response = handleRequest('GET', path, { cookie });
      expect(response.status).toBe(404);
      expect(response.headers['location']).toBeUndefined();
      expect(JSON.parse(body(response))).not.toHaveProperty('rights');
    }
  });
});
