import { describe, expect, it } from 'vitest';

import { SESSION_COOKIE_NAMES } from '@intellifin/infrastructure';

import {
  PROTECTED_ROUTE_FAMILIES,
  PUBLIC_EXACT_PATHS,
  PUBLIC_PATH_PREFIXES,
  PUBLIC_ROOT_FILES,
  isApiPath,
  isProtectedPath,
  isPublicPath,
} from './route-access';
import { SESSION_COOKIE_PREFIXES } from './session-cookie';

/**
 * FR-1: "Unauthenticated requests cannot access Procedure, Run, Evidence, Exception,
 * Live View, Replay, or administration data." None of those routes exists yet, which
 * is the point: default-deny has to protect them before they are written, so the test
 * asserts over the declared families rather than over routes on disk.
 */

const EVERY_EXAMPLE = PROTECTED_ROUTE_FAMILIES.flatMap((entry) =>
  entry.examples.map((path) => ({ family: entry.family, path })),
);

describe('protected route families', () => {
  it('declares all eight families FR-1 names', () => {
    expect(PROTECTED_ROUTE_FAMILIES.map((entry) => entry.family)).toEqual([
      'procedure',
      'run',
      'evidence',
      'exception',
      'live-view',
      'replay',
      'review',
      'administration',
    ]);
  });

  it.each(EVERY_EXAMPLE)('protects $family at $path', ({ path }) => {
    expect(isPublicPath(path)).toBe(false);
    expect(isProtectedPath(path)).toBe(true);
  });

  it.each(EVERY_EXAMPLE)('protects $path with a trailing slash too', ({ path }) => {
    expect(isProtectedPath(`${path}/`)).toBe(true);
  });
});

describe('the public allowlist', () => {
  it('is exactly what it declares and nothing else', () => {
    expect([...PUBLIC_EXACT_PATHS]).toEqual(['/sign-in', '/api/health', '/_next/image']);
    expect([...PUBLIC_PATH_PREFIXES]).toEqual(['/api/auth/', '/_next/static/', '/_next/image/']);
    // Every prefix ends in a slash, or it also matches its own look-alikes.
    for (const prefix of PUBLIC_PATH_PREFIXES) expect(prefix.endsWith('/')).toBe(true);
    expect([...PUBLIC_ROOT_FILES]).toEqual(['/favicon.ico', '/robots.txt', '/sitemap.xml']);
  });

  it.each([
    '/sign-in',
    '/sign-in/',
    '/api/health',
    '/api/auth',
    '/api/auth/sign-in/email',
    '/api/auth/get-session',
    '/_next/static/chunks/main.js',
    '/_next/image',
    '/_next/image/abc.png',
    '/favicon.ico',
  ])('lets %s through', (path) => {
    expect(isPublicPath(path)).toBe(true);
  });

  it.each([
    '/sign-in-secretly',
    '/api/healthz',
    '/api/authorize',
    '/api/auth-admin/users',
    '/_next/staticky/leak',
    '/_next/imagery',
    '/_next/imagex/leak',
    '/_next/images/../../runs',
  ])('does not let %s through on a prefix that merely looks like one', (path) => {
    expect(isPublicPath(path)).toBe(false);
  });
});

describe('a route nobody has written yet', () => {
  it.each([
    '/',
    '/overview',
    '/notifications',
    '/some-future-surface',
    '/api/some-future-endpoint',
    '/api/v2/anything',
  ])('protects %s by default', (path) => {
    expect(isProtectedPath(path)).toBe(true);
  });
});

describe('API versus page paths', () => {
  it.each(['/api', '/api/session', '/api/runs/RUN-1/events'])('treats %s as an API path', (path) => {
    expect(isApiPath(path)).toBe(true);
  });

  it.each(['/', '/runs', '/apiary', '/sign-in'])('treats %s as a page path', (path) => {
    expect(isApiPath(path)).toBe(false);
  });
});

describe('the session cookie names the middleware looks for', () => {
  it('matches the names Better Auth is configured to set', () => {
    // The middleware runs on the edge and cannot import the infrastructure barrel,
    // so it keeps its own copy. This is the guard against the two drifting.
    expect([...SESSION_COOKIE_PREFIXES]).toEqual([...SESSION_COOKIE_NAMES]);
  });
});
