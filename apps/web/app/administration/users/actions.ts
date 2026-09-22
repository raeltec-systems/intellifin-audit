'use server';

import { redirect } from 'next/navigation';

import { isRole } from '@intellifin/domain';

import { USER_FILTER_ROLE_NONE, usersHref } from '../../../src/admin/user-directory-query';
import { requireServerAction } from '../../../src/server-session';

/**
 * The user directory's search, as a Server Action that lands on a GET URL
 * (UI cleanup 2026-09-22, UX-38).
 *
 * The RESULT of a search is a plain GET — `/administration/users?q=dana&role=auditor` —
 * which is shareable, bookmarkable, survives the back button and is what the page reads
 * its filter from. The submission itself is a POST, because `form-method.test.ts`
 * requires every form in this application to declare `method="post"`: a form with no
 * method, or with `get`, is the shape that put a password in a URL three times in this
 * repository's history, and the guard is deliberately mechanical rather than reasoned
 * about per form. A Server Action form submits natively with no JavaScript, so the
 * search works before hydration and with scripting off — which a `router.push` would not.
 *
 * It authorizes FIRST, before it reads its input, like every Server Action here: Next
 * exposes this as its own POST endpoint addressed by an id in the client bundle, so
 * reaching the page is not a precondition for invoking it. Reading nothing and changing
 * nothing does not make that optional — a refused caller must not learn from this
 * endpoint that the surface exists.
 *
 * It mutates nothing. There is no command, no unit of work and no writer reachable from
 * here; the only thing it does is choose where to send the browser.
 */
export async function searchUsersAction(form: FormData): Promise<void> {
  const decision = await requireServerAction('administration.users.manage');
  // A refused caller is sent to the surface, which renders the audited refusal and
  // nothing else. Answering differently here would turn this endpoint into a way of
  // asking whether an account matches a search.
  if (!decision.allowed) redirect('/administration/users');

  const typed = form.get('q');
  const role = form.get('role');

  redirect(
    usersHref({
      // A file part, or a missing field, is not a search term. `FormData` values are
      // `string | File`, so the type is checked rather than coerced.
      search: typeof typed === 'string' ? typed : '',
      // The role travels only when it is one this build knows: the empty string means
      // "any role" and is simply omitted, and anything else is dropped rather than
      // becoming a filter nothing can satisfy.
      role:
        typeof role === 'string' && (role === USER_FILTER_ROLE_NONE || isRole(role))
          ? role
          : undefined,
    }),
  );
}
