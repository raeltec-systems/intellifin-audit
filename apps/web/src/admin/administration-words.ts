/**
 * The words the Administration area says for itself (UI cleanup 2026-09-22).
 *
 * NOT `copy.ts`: those strings are quotations from the UX contract and `copy.test.ts`
 * reads EXPERIENCE.md and DESIGN.md off disk to pin them character for character. These
 * are the platform's own sentences about its own administration surfaces, so they live
 * in a words module with a test that pins them — the `run-start-words.ts` pattern.
 *
 * Everything a reader meets more than once is here rather than typed into a component:
 * the three tab labels are also the breadcrumb labels package 1 set, the onboarding block
 * is said beside "Add a user" and on the landing, and the "what this release does not do"
 * caption is one caption rather than a refusal repeated per surface.
 */

/** The three areas, in the order the tabs show them. `href` is also the breadcrumb path. */
export const ADMINISTRATION_TABS = [
  { href: '/administration/users', label: 'Users' },
  { href: '/administration/sources', label: 'Population sources' },
  { href: '/administration/registrations', label: 'Systems' },
] as const;

/** Names the tab set for the landmark, so a screen reader can tell it from the shell's. */
export const ADMINISTRATION_TABS_LABEL = 'Administration areas';

export type AdministrationAreaHref = (typeof ADMINISTRATION_TABS)[number]['href'];

/**
 * What each area holds, for the landing summary.
 *
 * `singular`/`plural` feed `countNoun`, so "1 account" and "72 accounts" are one rule and
 * not two spellings. `purpose` is one sentence naming what the area is FOR — an operator
 * arriving at Administration for the first time has to know which of three doors to open.
 */
export const ADMINISTRATION_AREAS = {
  '/administration/users': {
    title: 'Users',
    singular: 'account',
    plural: 'accounts',
    purpose: 'Who can sign in, and what each of them is allowed to do.',
  },
  '/administration/sources': {
    title: 'Population sources',
    singular: 'source',
    plural: 'sources',
    purpose: 'Where the records a procedure tests come from.',
  },
  '/administration/registrations': {
    title: 'Systems',
    singular: 'system',
    plural: 'systems',
    purpose: 'The systems the agent may look in, and what it may do in each one.',
  },
} as const satisfies Record<
  AdministrationAreaHref,
  { readonly title: string; readonly singular: string; readonly plural: string; readonly purpose: string }
>;

/** One sentence for the landing, above the three areas. */
export const ADMINISTRATION_LEDE =
  'Set up the people, the record sources and the systems this deployment audits with.';

/**
 * What this release does NOT do, said once, as a caption.
 *
 * EXPERIENCE.md's UI cleanup section lists what the cleanup does not deliver and requires
 * each surface to state its availability truthfully. A refusal-shaped sentence per page
 * ("Platform diagnostics are not part of this release.") teaches a reader to skip the
 * line; one caption at the foot of the summary is read once and believed.
 */
export const ADMINISTRATION_NOT_AVAILABLE =
  'This release does not check a source or a connection for you, does not send invitations and has no password recovery. There is no platform diagnostics screen.';

/* -------------------------------------------------------------- configuration health --- */

/**
 * The health lines, each derived from an EXACT count of a real row set (UX-37).
 *
 * Every one of these is a statement about the environment, so each is a function of a
 * number this deployment really holds — never `rows.length` of a bounded page, and never
 * a sentence that renders whether or not anything is true. A count of zero renders the
 * `clear` sentence, which says what was checked rather than saying nothing: a health
 * section that disappears when everything is fine is indistinguishable from one that
 * never ran.
 */
export interface HealthLine {
  readonly clear: string;
  readonly problem: (count: number) => string;
}

export const ACCOUNTS_WITHOUT_ROLE: HealthLine = {
  clear: 'Every account holds a role.',
  problem: (count) =>
    count === 1
      ? '1 account holds no role. It can sign in and is refused every action.'
      : `${count.toLocaleString('en-US')} accounts hold no role. They can sign in and are refused every action.`,
};

/**
 * One PoC Administrator must always remain, and the command enforces it.
 *
 * At exactly one holder the line is a warning rather than a fault: nothing is broken, and
 * the operator should know that the one change the guard will refuse is the one that
 * would leave none.
 */
export const ADMINISTRATOR_COVER: HealthLine = {
  clear: 'More than one account can administer this deployment.',
  problem: (count) =>
    count === 0
      ? 'No account can administer this deployment. Recovering needs shell access.'
      : 'One account can administer this deployment. A change that would leave none is refused.',
};

export const SOURCES_WITHOUT_A_CONFIRMED_COUNT: HealthLine = {
  clear: 'Every source has something that confirms its record count.',
  problem: (count) =>
    count === 1
      ? '1 source has nothing confirming its record count. No procedure bound to it can be submitted.'
      : `${count.toLocaleString('en-US')} sources have nothing confirming their record count. No procedure bound to them can be submitted.`,
};

export const SYSTEMS_NEVER_CHECKED: HealthLine = {
  clear: 'A worker has checked the connection to every system.',
  problem: (count) =>
    count === 1
      ? '1 system has had no connection check. That is a check a worker runs, not this page.'
      : `${count.toLocaleString('en-US')} systems have had no connection check. That is a check a worker runs, not this page.`,
};

/** The sentence for a health line, decided by the exact count. */
export function healthSentence(line: HealthLine, count: number): string {
  return count === 0 ? line.clear : line.problem(count);
}

export const CONFIGURATION_HEALTH_TITLE = 'Configuration';

/* --------------------------------------------------------------------- users (UX-38) --- */

export const USER_SEARCH_LABEL = 'Search by name or email address';
export const USER_ROLE_FILTER_LABEL = 'Role';
export const USER_FILTER_SUBMIT = 'Search';
export const USER_FILTER_CLEAR = 'Clear';

/** The role filter's "every role" entry. An empty value posts as "no filter". */
export const USER_ROLE_FILTER_ANY = 'Any role';
/** The role filter's entry for an account with no `user_role` row. */
export const USER_ROLE_FILTER_NONE = 'No role';

/** `Showing 1–25 of 72 accounts` — the exact total beside the bounded page. */
export function userPageSentence(from: number, to: number, total: number): string {
  const noun = total === 1 ? 'account' : 'accounts';
  return `Showing ${from.toLocaleString('en-US')}–${to.toLocaleString('en-US')} of ${total.toLocaleString('en-US')} ${noun}.`;
}

export const USER_SEARCH_EMPTY_HEADLINE = 'No account matches this search.';
export const USER_SEARCH_EMPTY_SENTENCE =
  'Every account in this environment is listed here when the search is cleared. An empty result is about the search, not about who can sign in.';

export const USERS_EMPTY_HEADLINE = 'No accounts exist yet.';
export const USERS_EMPTY_SENTENCE =
  'Every account in this environment would be listed here with the role it holds. An empty list does not mean access is controlled; it means nobody can sign in.';

/* ------------------------------------------------------- per-row controls (UX-39) --- */

export const CHANGE_USER_SUMMARY = 'Change';

/**
 * What the row's disclosure adds to its visible word, for a screen reader that hears the
 * control out of the row's context. Read after "Change".
 */
export function changeUserLabel(name: string): string {
  return ` what ${name} may do`;
}

/**
 * The two guardrails, said where the control is rather than only when it refuses.
 *
 * The command enforces both — that is the control — and a person must not have to be
 * refused to learn them.
 */
export const ROLE_GUARDRAILS =
  'You cannot change your own role, and a change that would leave no PoC Administrator is refused.';

/* -------------------------------------------------------- onboarding (UX-40) --- */

export const ONBOARDING_TITLE = 'How a new person signs in';

/**
 * The supported onboarding, stated exactly as far as it goes.
 *
 * There is no invitation email, no self-service reset and no password-change command in
 * this build; `seed:identity` is an operator script and never resets a password either.
 * So the honest answer to "how does somebody get a new password" is that nothing in this
 * release does it, which is what the third sentence says — an invented remedy would send
 * an administrator looking for a screen that is not there.
 */
export const ONBOARDING_STEPS: readonly string[] = [
  'You type an address, a name and a first password here, and give that password to the person directly. This deployment sends no email.',
  'They sign in with it straight away, and hold the role you chose from their first request.',
  'Nothing in this release changes a password afterwards: there is no reset link and no password-change screen. An account whose password is lost has to be replaced with a new one, and the role moved to it.',
];

/* ---------------------------------------------------- source field list (UX-42) --- */

export const FIELD_LIST_PREVIEW_TITLE = 'What will be saved';

export const FIELD_ORDER_SENTENCE =
  'The order has to be the order the file has them in. A reader told the wrong order reads the wrong column.';

/** Said when nothing has been typed yet. Never a count of zero rendered as a list. */
export const FIELD_LIST_EMPTY = 'No field names yet.';

export function fieldListDuplicateWarning(names: readonly string[]): string {
  return names.length === 1
    ? `${names[0]} is listed more than once. Saving is refused until each name appears once.`
    : `${names.join(', ')} are listed more than once. Saving is refused until each name appears once.`;
}

export const FIELD_LIST_BLANK_WARNING =
  'Blank lines are ignored, so they are not saved and are not counted.';

/**
 * What this surface does NOT check, said where somebody would expect it to (UX-42).
 *
 * The plan tracks source and connection validation separately; a form that silently did
 * not check would leave an operator believing a saved source had been reached.
 */
export const SOURCE_NOT_VALIDATED =
  'Nothing here opens the source or checks that these field names match it. A Run is what reads it, and a Run reports what it found.';

/* -------------------------------------------- systems: two facts, not one (UX-44) --- */

export const CONNECTION_CHECK_LABEL = 'Connection check';
export const CONNECTION_CHECK_NOT_RUN = 'Not yet run';

/**
 * The sentence under a connection check that has not run.
 *
 * It REPLACES "No worker has observed this system yet", which EXPERIENCE.md's UI cleanup
 * section names directly: a system a completed Run used has been observed, so that
 * sentence was false on exactly the systems an operator cares most about. This one says
 * what the check is and who runs it, and claims nothing about audit activity — which is
 * the fact beside it.
 */
export const CONNECTION_CHECK_NOT_RUN_SENTENCE =
  'A worker checks whether the address answers. This page never contacts a system, and no check has been recorded for this one.';

export const AUDIT_ACTIVITY_LABEL = 'Last audit activity';
export const AUDIT_ACTIVITY_NONE = 'No Run has used this system';
export const AUDIT_ACTIVITY_NONE_SENTENCE =
  'A Run records which systems its Procedure Version froze. None that has finished names this one.';

/** `Ran E-000103 leavers · Completed` — the Procedure the Run tested and how it ended. */
export function auditActivitySentence(procedureName: string, execution: string): string {
  return `${procedureName} · ${execution}`;
}

/* ----------------------------------------- the authentication endpoint (UX-45) --- */

/**
 * What the field IS, said in its own label.
 *
 * The form used to call it "Exact address of the sign-in form" and then explain it as
 * "the address the form sends to" — two different things on one control. The contract's
 * own distinction (`authentication_destination`,
 * `docs/contracts/credential-containment-v1.md`) is that the agent may BROWSE anywhere in
 * the allowed list, the sign-in PAGE is one of those addresses, and the credential may be
 * posted to exactly one endpoint. The label names the endpoint, and the help names the
 * other two so a reader can tell all three apart.
 */
export const AUTH_ENDPOINT_LABEL = 'Authentication endpoint (where the sign-in form sends the credential)';

export const AUTH_ENDPOINT_HELP =
  'The exact address the sign-in form posts to, with no query string. It must be one of the addresses above. The list above is where the agent may browse, and the sign-in page is one of those; this is the single address the password may be sent to, and the agent refuses to send it anywhere else.';

export const AUTH_ENDPOINT_ABSENT =
  'Leave it empty if the agent never signs in here. With no endpoint set it refuses to enter a credential at all.';

export const AUTH_ENDPOINT_NONE_SET = 'None set, so the agent never signs in here';

/** What a stored credential reference IS, in one sentence. */
export const CREDENTIAL_REFERENCE_MEANING =
  'A name this deployment gave to a credential it keeps elsewhere. It is not the password and nothing here can read one.';

/** Said above the list of names a deployment declared, when there are any. */
export const CREDENTIAL_REFERENCE_KNOWN = 'Names this deployment has declared. Pick one, or type another.';

/** Said when no name can be offered, so the empty list is never read as "none exist". */
export const CREDENTIAL_REFERENCE_UNKNOWN =
  'This process cannot list the declared names. Type the one the deployment gave you.';

/* --------------------------------------------- affected procedures (UX-46) --- */

export const AFFECTED_PROCEDURES_LABEL = 'Procedures that would need approving again';

/**
 * The named list, or the honest statement that the names could not be read.
 *
 * The pinned `registrationChangeWarning` sentence still carries the COUNT; this adds the
 * names beside it. A change that could not read the names is not a change that affects
 * none: `null` says so rather than rendering an empty list.
 */
export function affectedProceduresSentence(
  names: readonly string[] | null,
  total: number,
): string {
  if (names === null) return 'The affected procedures could not be listed. Reload before saving.';
  if (names.length === 0) return 'No Active procedure uses it.';
  const shown = names.join(', ');
  return names.length < total
    ? `${shown}, and ${(total - names.length).toLocaleString('en-US')} more.`
    : `${shown}.`;
}

/* ------------------------------------------------------- inventory first (UX-43) --- */

export const ADD_SOURCE_SUMMARY = 'Add a population source';
export const ADD_SYSTEM_SUMMARY = 'Add a system';
export const ADD_USER_SUMMARY = 'Add a user';

export const SOURCE_SEARCH_LABEL = 'Search sources by name';
export const SYSTEM_SEARCH_LABEL = 'Search systems by name';

/** Said under a filtered inventory, so a short list is never read as a short deployment. */
export function inventoryFilterSentence(shown: number, total: number, plural: string): string {
  return `Showing ${shown.toLocaleString('en-US')} of ${total.toLocaleString('en-US')} ${plural}.`;
}

/**
 * Said beside the inventory when the read itself is bounded (UX-43).
 *
 * A search filters the rows this page already holds; it does not reach past the read
 * limit into rows the page never fetched. A person who searched and got nothing must
 * know that the search covered a page, not the deployment.
 */
export const INVENTORY_SEARCH_BOUNDED =
  'This deployment may hold more than this page shows; searching and paging every row is not part of this release.';

/* ------------------------------------------------------------------- field list preview (UX-42) --- */

/** The names a duplicated line would produce, in the order the field list already uses. */
export function duplicateFieldNames(names: readonly string[]): string[] {
  const seen = new Set<string>();
  const duplicated = new Set<string>();
  for (const name of names) {
    if (seen.has(name)) duplicated.add(name);
    seen.add(name);
  }
  return names.filter((name, index) => duplicated.has(name) && names.indexOf(name) === index);
}
