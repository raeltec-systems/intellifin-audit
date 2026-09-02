import { datasets, type LoanCoreAccount } from './fixtures.js';
import { escapeHtml, html, json, type NorthstarRequest, type NorthstarResponse } from './http.js';
import { field, layout, tableHead, tableRows } from './page.js';

/**
 * LoanCore — the synthetic loan origination and servicing web application (addendum A.2).
 *
 * The P-1 Target System. An agent signs in (this account is already signed in: a sign-in
 * form would be a POST, and this system refuses every write), searches by employee ID or
 * full name, opens an account page, and reads Status, Username, Roles and Employee ID.
 *
 * The seeded cases live in the DATASET, not here. `page_behaviour` names which of the
 * addendum D situations an account is: a page that cannot render, a system failure, a
 * different employee's page, a value that appears only in a filter option, a transcription
 * distractor, a partial page of results, two candidates with no identifier. This module
 * knows how to render each behaviour; it does not know which account has which.
 */

const SYSTEM = 'LoanCore';

function accounts(): readonly LoanCoreAccount[] {
  return datasets.loancore().accounts;
}

/** Lookup by employee id. A `Map`, so an id of `constructor` finds nothing. */
function byEmployeeId(): ReadonlyMap<string, LoanCoreAccount> {
  const index = new Map<string, LoanCoreAccount>();
  for (const account of accounts()) index.set(account.employee_id, account);
  return index;
}

export function home(): NorthstarResponse {
  return html(
    200,
    layout({
      system: SYSTEM,
      title: 'User administration',
      body: `
<h2>User administration</h2>
<p>Search for an account by employee ID or by full name.</p>
<ul>
  <li><a href="/loancore/users?employee_id=E-000103">Search by employee ID</a></li>
  <li><a href="/loancore/users?name=Rita+Musonda">Search by full name</a></li>
</ul>
<p class="note">This account holds read access only. Creating, changing and disabling accounts are not available to it, and the system refuses the attempt.</p>
`,
    }),
  );
}

/**
 * The search surface.
 *
 * An employee-ID search is exact. A name search is exact on the full name, case-insensitive.
 * Neither is fuzzy: addendum B puts fuzzy identity matching out of scope, and a synthetic
 * system that guessed would make the *choose candidate* case unreachable.
 */
export function search(request: NorthstarRequest): NorthstarResponse {
  const employeeId = (request.query.get('employee_id') ?? '').trim();
  const name = (request.query.get('name') ?? '').trim();

  if (employeeId === '' && name === '') {
    return html(
      200,
      layout({
        system: SYSTEM,
        title: 'Search accounts',
        body: `<h2>Search accounts</h2>
<form method="get" action="/loancore/users">
  <p><label for="employee_id">Employee ID</label> <input id="employee_id" name="employee_id" type="text"></p>
  <p><label for="name">Full name</label> <input id="name" name="name" type="text"></p>
  <p><button type="submit">Search</button></p>
</form>
<p>Enter an employee ID or a full name.</p>`,
      }),
    );
  }

  if (employeeId !== '') {
    const account = byEmployeeId().get(employeeId);
    if (account?.page_behaviour === 'system-failure') return systemFailure();
    // A record whose account is only findable by name: the ID search finds nothing, which
    // is what makes the fallback name search — and the *choose candidate* case — happen.
    const matches =
      account === undefined || account.page_behaviour === 'ambiguous-candidates' ? [] : [account];
    return results({ criterion: `employee ID ${employeeId}`, matches, account });
  }

  const lowered = name.toLocaleLowerCase();
  const matches = accounts().filter((row) => row.full_name.toLocaleLowerCase() === lowered);
  const ambiguous = matches.find((row) => row.page_behaviour === 'ambiguous-candidates');
  if (ambiguous !== undefined) return candidates(ambiguous);
  const failing = matches.find((row) => row.page_behaviour === 'system-failure');
  if (failing !== undefined) return systemFailure();
  return results({ criterion: `full name ${name}`, matches, account: matches[0] });
}

/** The ordinary result list, plus the seeded partial-pagination variant. */
function results(options: {
  readonly criterion: string;
  readonly matches: readonly LoanCoreAccount[];
  readonly account: LoanCoreAccount | undefined;
}): NorthstarResponse {
  const { criterion, matches, account } = options;
  const listed = matches.length;
  // The seeded case: the page REPORTS more matches than it lists and offers no next page.
  const reported =
    account?.page_behaviour === 'partial-pagination' ? (account.reported_match_count ?? listed) : listed;

  if (listed === 0) {
    return html(
      200,
      layout({
        system: SYSTEM,
        title: 'Search results',
        body: `<h2>Search results</h2>
<p>Searched for ${escapeHtml(criterion)}.</p>
<p id="no-results">No accounts match that search.</p>`,
      }),
    );
  }

  const rows = matches.map((row) => [
    row.employee_id,
    row.username,
    row.full_name,
    row.status,
    row.last_login,
  ]);
  const links = matches
    .map(
      (row) =>
        `<li><a href="/loancore/users/${encodeURIComponent(row.employee_id)}">Open ${escapeHtml(row.username)}</a></li>`,
    )
    .join('\n');

  return html(
    200,
    layout({
      system: SYSTEM,
      title: 'Search results',
      body: `<h2>Search results</h2>
<p>Searched for ${escapeHtml(criterion)}.</p>
<p id="result-summary">Showing ${String(listed)} of ${String(reported)} matching accounts.</p>
<table>
<caption>Accounts matching ${escapeHtml(criterion)}</caption>
${tableHead(['Employee ID', 'Username', 'Full name', 'Status', 'Last login'])}
${tableRows(rows)}
</table>
<ul>
${links}
</ul>`,
    }),
  );
}

/**
 * The *choose candidate* page: two rows, and neither carries an Employee ID column.
 *
 * Addendum B resolves a search only when exactly one captured row has a grounded identity
 * attribute equal to the record key. Two rows with no identity attribute at all is the
 * clearest form of "any other outcome".
 */
function candidates(account: LoanCoreAccount): NorthstarResponse {
  const usernames = account.candidate_usernames ?? [account.username];
  const rows = usernames.map((username) => [username, account.full_name, 'Active']);
  return html(
    200,
    layout({
      system: SYSTEM,
      title: 'Search results',
      body: `<h2>Search results</h2>
<p>Searched for full name ${escapeHtml(account.full_name)}.</p>
<p id="result-summary">Showing ${String(rows.length)} of ${String(rows.length)} matching accounts.</p>
<table>
<caption>Accounts matching full name ${escapeHtml(account.full_name)}</caption>
${tableHead(['Username', 'Full name', 'Status'])}
${tableRows(rows)}
</table>
<p class="note">This directory does not publish employee identifiers on name searches.</p>`,
    }),
  );
}

/** A simulated Target System failure, scoped to one record (addendum D). */
function systemFailure(): NorthstarResponse {
  return {
    ...json(503, {
      error: 'temporarily_unavailable',
      message: 'The account directory is temporarily unavailable. Try again later.',
      system: SYSTEM,
    }),
    status: 503,
  };
}

export function accountPage(request: NorthstarRequest, employeeId: string): NorthstarResponse {
  const index = byEmployeeId();
  const account = index.get(employeeId);
  if (account === undefined) return notFound(employeeId);

  switch (account.page_behaviour) {
    case 'system-failure':
      return systemFailure();
    case 'render-failure':
      return renderFailure(account);
    case 'different-employee': {
      // The seeded identity case: this URL serves somebody else's account page, complete
      // with THEIR Employee ID. Identity corroboration is what must catch it.
      const other = index.get(account.serves_page_of ?? '');
      return other === undefined ? notFound(employeeId) : normalPage(other);
    }
    case 'value-only-in-filter':
      return valueOnlyInFilter(account);
    case 'transcription-distractor':
      return transcriptionDistractor(account);
    case 'normal':
    case 'partial-pagination':
    case 'ambiguous-candidates':
      return normalPage(account);
  }
}

function record(account: LoanCoreAccount, includeStatus: boolean): string {
  return `<dl class="record">
${field('Employee ID', account.employee_id)}
${field('Full name', account.full_name)}
${field('Username', account.username)}
${includeStatus ? field('Status', account.status) : ''}
${field('Roles', account.roles.join(', '))}
${field('Last login', account.last_login)}
${field('Account ID', account.account_id)}
</dl>`;
}

function noteBlock(account: LoanCoreAccount): string {
  // Served VERBATIM as text. A seeded prompt-like string is the case; escaping it away
  // here would delete the test. `escapeHtml` stops it becoming markup and changes no
  // character a reader or a parser sees.
  return account.page_note === ''
    ? ''
    : `<h3>Account note</h3>\n<p class="note" id="account-note">${escapeHtml(account.page_note)}</p>`;
}

function normalPage(account: LoanCoreAccount): NorthstarResponse {
  return html(
    200,
    layout({
      system: SYSTEM,
      title: `Account ${account.username}`,
      body: `<h2>Account ${escapeHtml(account.username)}</h2>
${record(account, true)}
${noteBlock(account)}`,
    }),
  );
}

/** 200 with an error panel and NO attribute fields: required Evidence cannot be captured. */
function renderFailure(account: LoanCoreAccount): NorthstarResponse {
  return html(
    200,
    layout({
      system: SYSTEM,
      title: 'Account detail unavailable',
      body: `<h2>Account detail unavailable</h2>
<p id="render-failure">The account detail panel could not be displayed. Reference ${escapeHtml(account.account_id)}.</p>`,
    }),
  );
}

/** No Status field at all. The word appears only inside a filter control's options. */
function valueOnlyInFilter(account: LoanCoreAccount): NorthstarResponse {
  return html(
    200,
    layout({
      system: SYSTEM,
      title: `Account ${account.username}`,
      body: `<h2>Account ${escapeHtml(account.username)}</h2>
<form method="get" action="/loancore/users">
  <p>
    <label for="status-filter">Filter by status</label>
    <select id="status-filter" name="status">
      <option value="">Any</option>
      <option value="Active">Active</option>
      <option value="Disabled">Disabled</option>
      <option value="Suspended">Suspended</option>
    </select>
  </p>
</form>
${record(account, false)}`,
    }),
  );
}

/** Status says Active; a nearby control is labelled with the opposite word. */
function transcriptionDistractor(account: LoanCoreAccount): NorthstarResponse {
  return html(
    200,
    layout({
      system: SYSTEM,
      title: `Account ${account.username}`,
      body: `<h2>Account ${escapeHtml(account.username)}</h2>
${record(account, true)}
<form method="get" action="/loancore/users">
  <p>
    <input type="checkbox" id="show-disabled" name="show_disabled" value="1">
    <label for="show-disabled">Show disabled accounts</label>
  </p>
</form>`,
    }),
  );
}

/**
 * A missing employee renders a "not found" page, never a 500 and never a blank.
 *
 * 404 with a page a person and a Structural Snapshot can both read: a proven absence
 * needs the system's own empty-result response, and an unstyled framework error is not
 * one.
 */
export function notFound(employeeId: string): NorthstarResponse {
  return html(
    404,
    layout({
      system: SYSTEM,
      title: 'Account not found',
      body: `<h2>Account not found</h2>
<p id="not-found">No account exists for employee ID ${escapeHtml(employeeId)}.</p>`,
    }),
  );
}
