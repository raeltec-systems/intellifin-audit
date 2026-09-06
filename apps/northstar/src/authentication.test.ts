import { readdirSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  AUTHENTICATION_CHALLENGE,
  AUTHENTICATION_ERROR,
  AUTHENTICATION_RULE,
  CREDENTIAL_FIELD,
  SESSION_COOKIE,
  SIGN_IN_PATH,
  isSignInSurface,
  requiresCredential,
} from './authentication.js';
import { loanCoreCredential } from './fixtures.js';
import { READ_ONLY_RULE } from './read-only.js';
import { ROUTES } from './routes.js';
import { handleRequest } from './server.js';

/**
 * FR-3's other half at the system level, asserted over the ROUTE TABLE (Story 4.2).
 *
 * The same shape as `read-only.test.ts`, and for the same reason: a test that names its own
 * sample cannot notice the route that was added without one. Every LoanCore case below is
 * generated from `ROUTES`, so a LoanCore surface added by a later story is covered the
 * moment it exists — and every other system's routes are asserted to be UNAFFECTED, which
 * is the half that a change adding authentication everywhere would break silently.
 *
 * LoanCore signs in through a REAL FORM now, and there is no `Authorization` header
 * sign-in left. Leaving one would have made the form decorative — the suite would pass
 * with the form deleted.
 */

const CREDENTIAL = loanCoreCredential();
const FORM = { 'content-type': 'application/x-www-form-urlencoded' } as const;

function submit(body: string): ReturnType<typeof handleRequest> {
  return handleRequest('POST', SIGN_IN_PATH, FORM, body);
}

function signInBody(token: string): string {
  return new URLSearchParams({ [CREDENTIAL_FIELD]: token }).toString();
}

/** Every LoanCore route, split by whether a signed-out caller may reach it. */
const loancoreRoutes = ROUTES.filter((route) => requiresCredential(route.probe));
const publicRoutes = loancoreRoutes.filter((route) => isSignInSurface(route.probe));
const protectedRoutes = loancoreRoutes.filter((route) => !isSignInSurface(route.probe));
const otherRoutes = ROUTES.filter((route) => !requiresCredential(route.probe));

function bodyOf(response: { body: string | Uint8Array }): string {
  return typeof response.body === 'string' ? response.body : Buffer.from(response.body).toString('utf8');
}

function cookieFrom(setCookie: string | undefined): string {
  return (setCookie ?? '').split(';')[0] ?? '';
}

/** The session a real sign-in grants, obtained the only way there is to obtain one. */
const SESSION = cookieFrom(submit(signInBody(CREDENTIAL.token)).headers['set-cookie']);

describe('the fixture declares a credential at all', () => {
  it('has a reference and an invented token, and they are different values', () => {
    expect(CREDENTIAL.reference).toMatch(/^cred:\/\//);
    expect(CREDENTIAL.token.length).toBeGreaterThan(16);
    expect(CREDENTIAL.token).not.toBe(CREDENTIAL.reference);
  });

  it('found LoanCore routes of both kinds, so the walks below are not vacuous', () => {
    // The failure this guards is a rename that leaves every assertion unexecuted and green.
    expect(protectedRoutes.length).toBeGreaterThanOrEqual(2);
    expect(publicRoutes.map((route) => route.id).sort()).toEqual([
      'loancore-home',
      'loancore-sign-in',
    ]);
    expect(otherRoutes.length).toBeGreaterThanOrEqual(10);
  });
});

describe('the sign-in is a form, and the form is what establishes a session', () => {
  it('serves a form whose method is POST, so the credential never lands in a URL', () => {
    // A form with no method, or with `method="get"`, puts whatever was typed into the URL,
    // into browser history, into the `Referer` header and into every access log. This
    // repository has shipped that three times.
    const page = bodyOf(handleRequest('GET', SIGN_IN_PATH));
    expect(page).toContain(`<form method="post" action="${SIGN_IN_PATH}"`);
    // `type="password"` is the input type whose defined meaning is "a credential goes
    // here", and it is what the Agent Workspace's sign-in mechanism looks for.
    expect(page).toContain(`name="${CREDENTIAL_FIELD}" type="password"`);
    // The page a signed-out caller is shown must not contain the value it is asking for.
    expect(page).not.toContain(CREDENTIAL.token);
  });

  it('serves the same form at the frozen origin itself, which is where a Run signs in', () => {
    // `/loancore` is the allowed origin a Procedure Version freezes. A caller with no
    // session is shown the form THERE, so the platform navigates to the origin it froze
    // and needs to guess no path and parse no page to find the form.
    expect(bodyOf(handleRequest('GET', '/loancore'))).toContain(`action="${SIGN_IN_PATH}"`);
    expect(bodyOf(handleRequest('GET', '/loancore/'))).toContain(`action="${SIGN_IN_PATH}"`);
  });

  it('grants a session for the declared credential, and redirects to the home page', () => {
    const response = submit(signInBody(CREDENTIAL.token));
    // 303, so the session is established by a redirect a browser follows rather than by a
    // body a resubmission would repeat.
    expect(response.status).toBe(303);
    expect(response.headers['location']).toBe('/loancore');
    const cookie = response.headers['set-cookie'] ?? '';
    expect(cookie).toContain(`${SESSION_COOKIE}=`);
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('Path=/loancore');
    // The session value is DERIVED from the credential and is never the credential: the
    // token must appear in nothing this system hands back.
    expect(cookie).not.toContain(CREDENTIAL.token);
    expect(bodyOf(response)).not.toContain(CREDENTIAL.token);
  });

  it('shows the administration home once the session is held', () => {
    const home = handleRequest('GET', '/loancore', { cookie: SESSION });
    expect(home.status).toBe(200);
    expect(bodyOf(home)).toContain('User administration');
    // And no longer the form: a page offering a sign-in to somebody already signed in is
    // a page saying something untrue about the session it is being read with.
    expect(bodyOf(home)).not.toContain(`action="${SIGN_IN_PATH}"`);
  });

  it('refuses a submission that does not carry the declared credential', () => {
    for (const body of ['', signInBody(''), signInBody('wrong'), `${CREDENTIAL_FIELD}`]) {
      const response = submit(body);
      expect(response.status, JSON.stringify(body)).toBe(401);
      expect(response.headers['set-cookie'], JSON.stringify(body)).toBeUndefined();
      const payload = JSON.parse(bodyOf(response)) as Record<string, unknown>;
      expect(payload['error']).toBe(AUTHENTICATION_ERROR);
      expect(payload['rule']).toBe(AUTHENTICATION_RULE);
    }
  });

  it('takes the FIRST value of a repeated field, so a second one is not a second chance', () => {
    const response = submit(`${CREDENTIAL_FIELD}=wrong&${signInBody(CREDENTIAL.token)}`);
    expect(response.status).toBe(401);
    expect(response.headers['set-cookie']).toBeUndefined();
  });

  it('does not accept an Authorization header instead of the form', () => {
    // The header sign-in is GONE. Leaving one would make the form decorative: this suite
    // would pass with the form deleted, which is exactly the failure "assert both
    // directions" exists to prevent.
    const response = handleRequest('GET', '/loancore/users', {
      authorization: `Bearer ${CREDENTIAL.token}`,
    });
    expect(response.status).toBe(401);
    expect(response.headers['set-cookie']).toBeUndefined();
  });

  it('refuses a cookie whose value is not the one this system granted', () => {
    expect(handleRequest('GET', '/loancore/users', { cookie: `${SESSION_COOKIE}=guessed` }).status).toBe(401);
    expect(handleRequest('GET', '/loancore/users', { cookie: 'other=value' }).status).toBe(401);
  });
});

describe('every protected LoanCore route refuses an unauthenticated read', () => {
  for (const route of protectedRoutes) {
    it(`GET ${route.probe} (${route.id})`, () => {
      const response = handleRequest('GET', route.probe);
      expect(response.status).toBe(401);
      // RFC 9110: a 401 without a challenge is a refusal that never says how to satisfy it.
      // The challenge names the FORM, because a `Bearer` challenge would name a way of
      // authenticating this system no longer has.
      expect(response.headers['www-authenticate']).toBe(AUTHENTICATION_CHALLENGE);
      expect(response.headers['www-authenticate']).toContain(SIGN_IN_PATH);
      const payload = JSON.parse(bodyOf(response)) as Record<string, unknown>;
      expect(payload['error']).toBe(AUTHENTICATION_ERROR);
      // The rule itself, verbatim. A denial a Run records must name the rule, not merely
      // carry a status code.
      expect(payload['rule']).toBe(AUTHENTICATION_RULE);
      expect(payload['path']).toBe(route.probe);
      expect(payload['signIn']).toBe(SIGN_IN_PATH);
      // Nothing the system knows leaks into the refusal: not the credential, not the page.
      expect(bodyOf(response)).not.toContain(CREDENTIAL.token);
    });
  }
});

describe('every LoanCore route serves a read once the session is held', () => {
  for (const route of loancoreRoutes) {
    it(`GET ${route.probe} (${route.id})`, () => {
      const response = handleRequest('GET', route.probe, { cookie: SESSION });
      expect(response.status).toBe(200);
      // A `Set-Cookie` on every response would rewrite the session on every read, which is
      // a second sign-in nobody performed.
      expect(response.headers['set-cookie']).toBeUndefined();
      expect(bodyOf(response)).not.toContain(CREDENTIAL.token);
    });
  }
});

describe('authentication is applied above routing', () => {
  it('refuses an unauthenticated read of a LoanCore path no route serves', () => {
    // 404 says "there is nothing here", which is a statement about this system's contents
    // and one an unauthenticated caller has not earned. 401 says what is actually true.
    const response = handleRequest('GET', '/loancore/nothing/is/served/here');
    expect(response.status).toBe(401);
    expect(JSON.parse(bodyOf(response))['rule']).toBe(AUTHENTICATION_RULE);
  });

  it('answers 404 for the same path once the session is held', () => {
    expect(handleRequest('GET', '/loancore/nothing/is/served/here', { cookie: SESSION }).status).toBe(404);
  });

  it('refuses a mutation BEFORE it considers the session', () => {
    // Read-only stays above authentication: a 401 first would suggest that a credential
    // could make a mutation acceptable.
    const response = handleRequest('POST', '/loancore', { cookie: SESSION });
    expect(response.status).toBe(405);
    expect(JSON.parse(bodyOf(response))['rule']).toBe(READ_ONLY_RULE);
  });

  it('refuses a mutation of the SIGN-IN path that the route did not declare', () => {
    // The sign-in declares `POST` and nothing else. A `PUT` there is refused by the
    // read-only rule, not answered by the sign-in handler.
    const response = handleRequest('PUT', SIGN_IN_PATH, FORM, signInBody(CREDENTIAL.token));
    expect(response.status).toBe(405);
    expect(response.headers['allow']).toBe('GET, HEAD, POST');
    expect(JSON.parse(bodyOf(response))['rule']).toBe(READ_ONLY_RULE);
  });

  it('is a path BOUNDARY, so a sibling prefix is not inside it', () => {
    expect(requiresCredential('/loancore')).toBe(true);
    expect(requiresCredential('/loancore/users/E-000103')).toBe(true);
    expect(requiresCredential('/loancore-other')).toBe(false);
    expect(requiresCredential('/loancoreother')).toBe(false);
    expect(requiresCredential('/')).toBe(false);
  });

  it('allowlists exactly two sign-in surfaces, on a path boundary', () => {
    expect(isSignInSurface('/loancore')).toBe(true);
    expect(isSignInSurface('/loancore/')).toBe(true);
    expect(isSignInSurface(SIGN_IN_PATH)).toBe(true);
    expect(isSignInSurface('/loancore/sign-in/more')).toBe(false);
    expect(isSignInSurface('/loancore/sign-inx')).toBe(false);
    expect(isSignInSurface('/loancore/users')).toBe(false);
  });
});

describe('every other synthetic system stays unauthenticated', () => {
  for (const route of otherRoutes) {
    it(`GET ${route.probe} (${route.id})`, () => {
      const response = handleRequest('GET', route.probe);
      // Adding authentication everywhere would make every Epic 3 adapter test carry a
      // credential for no reason, and Epic 3's adapter path resolves its credential from
      // the frozen registration rather than from anything this fixture invented.
      expect(response.status).not.toBe(401);
      expect(response.headers['set-cookie']).toBeUndefined();
    });
  }
});

describe('no surface of this process can put a credential in a URL', () => {
  /**
   * Every `<form>` in this application that carries a password field, scanned from source.
   *
   * `apps/web/src/form-method.test.ts` is the same rule for the product, and it does not
   * reach here. A form with no `method`, or with `method="get"`, submits as a GET, so
   * whatever was typed lands in the URL, in browser history, in the `Referer` header and
   * in every access log in between — the defect this repository has shipped three times.
   * LoanCore's search forms are legitimately `method="get"`; they carry no credential, so
   * the rule is scoped to the forms that do rather than banned outright.
   */
  const SOURCE_ROOT = fileURLToPath(new URL('.', import.meta.url));

  function sourceFiles(directory: string): string[] {
    const found: string[] = [];
    for (const entry of readdirSync(directory)) {
      if (entry === 'node_modules' || entry === 'dist') continue;
      const path = `${directory}/${entry}`;
      // A broken symlink makes `statSync` throw, which would fail this suite for a reason
      // that has nothing to do with forms.
      let isDirectory: boolean;
      try {
        isDirectory = statSync(path).isDirectory();
      } catch {
        continue;
      }
      if (isDirectory) found.push(...sourceFiles(path));
      else if (entry.endsWith('.ts') && !entry.endsWith('.test.ts')) found.push(path);
    }
    return found;
  }

  /**
   * Every form in the source, as its opening tag plus everything up to `</form>`.
   *
   * Per FORM rather than per FILE: `loancore.ts` holds the sign-in form AND two search
   * forms that are legitimately `method="get"`, so a file-level check would either fail on
   * the searches or have to exempt the file that contains the one form that matters.
   *
   * The opening tag is read quote-aware, so a `>` inside an attribute value is not the end
   * of the tag — the mistake `apps/web/src/form-method.test.ts` was written twice to fix.
   */
  function forms(source: string): { tag: string; markup: string }[] {
    const found: { tag: string; markup: string }[] = [];
    for (let index = source.indexOf('<form'); index >= 0; index = source.indexOf('<form', index + 1)) {
      let quote = '';
      for (let cursor = index; cursor < source.length; cursor += 1) {
        const character = source[cursor]!;
        if (quote !== '') {
          if (character === quote) quote = '';
          continue;
        }
        if (character === '"' || character === "'") quote = character;
        else if (character === '>') {
          const close = source.indexOf('</form>', cursor);
          found.push({
            tag: source.slice(index, cursor + 1),
            // An unclosed form is a defect in its own right; reading to the end of the file
            // is the fail-closed direction, because it can only add password fields.
            markup: source.slice(index, close < 0 ? source.length : close),
          });
          break;
        }
      }
    }
    return found;
  }

  const files = sourceFiles(SOURCE_ROOT);

  it('found source to scan, so the assertion below is not vacuous', () => {
    expect(files.length).toBeGreaterThan(5);
  });

  it('gives every password-carrying form method="post"', () => {
    let checked = 0;
    for (const file of files) {
      for (const form of forms(readFileSync(file, 'utf8'))) {
        if (!form.markup.includes('type="password"')) continue;
        checked += 1;
        expect(form.tag, `${file}: ${form.tag}`).toContain('method="post"');
      }
    }
    // The one that exists today is the LoanCore sign-in. A rename that left this loop with
    // nothing to check would make it pass while checking nothing.
    expect(checked).toBe(1);
  });
});
