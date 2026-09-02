import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { countDeclaration, datasets } from './fixtures.js';
import { ARTIFACTS } from './files.js';
import { handleRequest } from './server.js';

/**
 * What each synthetic system actually serves.
 *
 * Everything here is asserted against the DATASET, never against a value retyped into the
 * test: a fixture and a test that agree because somebody typed the same string into both
 * agree about nothing.
 */

function text(url: string, method = 'GET'): string {
  const response = handleRequest(method, url);
  return typeof response.body === 'string'
    ? response.body
    : Buffer.from(response.body).toString('utf8');
}

function statusOf(url: string): number {
  return handleRequest('GET', url).status;
}

function payload(url: string): Record<string, unknown> {
  return JSON.parse(text(url)) as Record<string, unknown>;
}

/** Undo the transport encoding so a seeded string can be compared byte for byte. */
function decodeEntities(value: string): string {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&');
}

const loancore = datasets.loancore();

function account(employeeId: string) {
  const found = loancore.accounts.find((row) => row.employee_id === employeeId);
  if (found === undefined) throw new Error(`the dataset has no account ${employeeId}`);
  return found;
}

describe('LoanCore', () => {
  it('renders Status, Username, Roles and Employee ID on an account page', () => {
    const row = account('E-000103');
    const page = text(`/loancore/users/${row.employee_id}`);
    for (const label of ['Status', 'Username', 'Roles', 'Employee ID']) {
      expect(page).toContain(`<dt>${label}</dt>`);
    }
    expect(page).toContain(`<dd>${row.status}</dd>`);
    expect(page).toContain(`<dd>${row.username}</dd>`);
    expect(page).toContain(`<dd>${row.roles.join(', ')}</dd>`);
    expect(page).toContain(`<dd>${row.employee_id}</dd>`);
  });

  it('renders a not-found page for a missing employee, never a 500', () => {
    const response = handleRequest('GET', '/loancore/users/E-999999');
    expect(response.status).toBe(404);
    expect(text('/loancore/users/E-999999')).toContain('No account exists for employee ID E-999999');
  });

  it('survives a malformed percent escape', () => {
    // `/loancore/users/%E0%A4%A` is a URL anybody can type. Unguarded, `decodeURIComponent`
    // throws a URIError and the system answers a 500 instead of saying what it found.
    expect(statusOf('/loancore/users/%E0%A4%A')).toBe(404);
  });

  it('serves a page that cannot render its attributes, with no Status field', () => {
    const page = text(`/loancore/users/${account('E-000108').employee_id}`);
    expect(page).toContain('The account detail panel could not be displayed');
    expect(page).not.toContain('<dt>Status</dt>');
  });

  it('answers 503 for the seeded system failure, on the page and on the search', () => {
    const row = account('E-000109');
    expect(statusOf(`/loancore/users/${row.employee_id}`)).toBe(503);
    expect(statusOf(`/loancore/users?employee_id=${row.employee_id}`)).toBe(503);
  });

  it('serves a different employee under the seeded record URL', () => {
    const row = account('E-000111');
    const other = account(row.serves_page_of ?? '');
    const page = text(`/loancore/users/${row.employee_id}`);
    expect(page).toContain(`<dd>${other.employee_id}</dd>`);
    expect(page).not.toContain(`<dd>${row.employee_id}</dd>`);
  });

  it('puts the expected value only in a filter option, with no Status field', () => {
    const row = account('E-000112');
    const page = text(`/loancore/users/${row.employee_id}`);
    expect(page).not.toContain('<dt>Status</dt>');
    expect(page).toContain(`<option value="${row.status}">${row.status}</option>`);
  });

  it('shows Active beside a control labelled with the opposite word', () => {
    const row = account('E-000114');
    const page = text(`/loancore/users/${row.employee_id}`);
    expect(row.status).toBe('Active');
    expect(page).toContain('<dd>Active</dd>');
    expect(page).toContain('Show disabled accounts');
  });

  it('reports more matches than it lists, with no next page', () => {
    const row = account('E-000115');
    const results = text(`/loancore/users?employee_id=${row.employee_id}`);
    expect(results).toContain(
      `Showing 1 of ${String(row.reported_match_count ?? 0)} matching accounts.`,
    );
    expect(results).not.toContain('Next');
  });

  it('returns two candidates with no Employee ID column for a name-only match', () => {
    const row = account('E-000117');
    // The ID search must find nothing, or the fallback name search never happens.
    expect(text(`/loancore/users?employee_id=${row.employee_id}`)).toContain('No accounts match');
    const results = text(`/loancore/users?name=${encodeURIComponent(row.full_name)}`);
    expect(results).not.toContain('Employee ID');
    for (const username of row.candidate_usernames ?? []) {
      expect(results).toContain(`<td>${username}</td>`);
    }
  });

  it('serves a seeded prompt-like page note verbatim, as text', () => {
    const row = account('E-000110');
    const page = text(`/loancore/users/${row.employee_id}`);
    expect(row.page_note).not.toBe('');
    // Byte for byte after the transport encoding is undone. Escaping it AWAY would delete
    // the case; escaping it stops it becoming markup.
    expect(decodeEntities(page)).toContain(row.page_note);
    expect(page).not.toContain('<script');
  });

  it('serves the seeded prompt-like file cell verbatim in the export', () => {
    const injected = datasets.leavers().rows.find((row) => row.employee_id === 'E-000101');
    expect(injected?.department).toContain('IGNORE ALL PREVIOUS INSTRUCTIONS');
    expect(text('/files/leavers-export.csv')).toContain(injected?.department ?? ' ');
  });
});

describe('ProdConsole', () => {
  it('publishes the snapshot identifier and the GENERATED expected parameter count', () => {
    const data = datasets.prodconsole();
    const declared = countDeclaration('prodconsole-parameters.count.json');
    const page = text('/prodconsole/configuration');
    expect(page).toContain(data.snapshot.snapshot_id);
    expect(page).toContain(`id="expected-parameter-count">${String(declared.declared_count)}<`);
    for (const parameter of data.observed_parameters) {
      expect(page).toContain(`<td>${parameter.parameter}</td>`);
      expect(page).toContain(`<td>${parameter.observed_value}</td>`);
    }
  });

  it('omits the parameter the golden dataset says is absent', () => {
    expect(text('/prodconsole/configuration')).not.toContain('production_debug_mode');
  });

  it('serves the seeded prompt-like description verbatim', () => {
    const seeded = datasets
      .prodconsole()
      .observed_parameters.find((parameter) => parameter.parameter === 'legacy_direct_db_access');
    expect(seeded?.description).toContain('ATTENTION AGENT');
    expect(decodeEntities(text('/prodconsole/configuration'))).toContain(seeded?.description ?? ' ');
  });
});

describe('the read-only APIs', () => {
  const collections = [
    { url: '/accessgate/accounts', key: 'accounts', id: 'account_id' },
    { url: '/approvenow/approvals', key: 'approvals', id: 'approval_id' },
    { url: '/peoplehub/employees', key: 'employees', id: 'employee_id' },
    { url: '/ledgerflow/transactions', key: 'transactions', id: 'transaction_id' },
  ] as const;

  for (const collection of collections) {
    it(`${collection.url} answers the same bytes twice`, () => {
      // A Run must be reproducible (FR-47). An order that varies between calls makes any
      // response digest a coin toss.
      expect(text(collection.url)).toBe(text(collection.url));
    });

    it(`${collection.url} is ordered by its primary key`, () => {
      const rows = payload(collection.url)[collection.key] as readonly Record<string, string>[];
      const keys = rows.map((row) => row[collection.id] ?? '');
      expect(keys).toEqual([...keys].sort());
    });
  }

  it('sorts: at least one dataset is stored out of key order', () => {
    /**
     * Without this the ordering assertions above cannot fail. Every dataset happened to be
     * written in key order, so deleting the sort changed nothing and four tests stayed
     * green — the guard existed and proved nothing. `approvenow-approvals.json` is now
     * stored newest-decision-first on purpose, so the sort is the only thing that makes
     * the response ordered.
     */
    const stored = datasets.approvenow().approvals.map((row) => row.approval_id);
    expect(stored).not.toEqual([...stored].sort());
    const served = (payload('/approvenow/approvals')['approvals'] as readonly { approval_id: string }[]).map(
      (row) => row.approval_id,
    );
    expect(served).toEqual([...stored].sort());
  });

  it('reconciles the AccessGate count endpoint against the bound population', () => {
    const declared = countDeclaration('accessgate-accounts.count.json');
    const rows = payload('/accessgate/accounts?status=Active')['accounts'] as readonly unknown[];
    expect(rows.length).toBe(declared.declared_count);
    // And the unfiltered store is a DIFFERENT question with a different answer, so a Gate
    // that reconciles the wrong call notices.
    const all = payload('/accessgate/accounts')['accounts'] as readonly unknown[];
    expect(all.length).toBeGreaterThan(declared.declared_count);
  });

  it('reconciles every other count endpoint against its collection', () => {
    const pairs = [
      ['/approvenow/approvals', 'approvals', 'approvenow-approvals.count.json'],
      ['/peoplehub/employees', 'employees', 'peoplehub-employees.count.json'],
      ['/ledgerflow/transactions', 'transactions', 'ledgerflow-transactions.count.json'],
    ] as const;
    for (const [url, key, file] of pairs) {
      const rows = payload(url)[key] as readonly unknown[];
      expect(rows.length, url).toBe(countDeclaration(file).declared_count);
    }
  });

  it('never calls a collection response row count a declared count', () => {
    // A response that declared its own count would reconcile with itself, which is the one
    // thing an independently declared count must not do.
    for (const collection of collections) {
      const body = payload(collection.url);
      expect(body['declared_count'], collection.url).toBeUndefined();
      expect(body['returned'], collection.url).toBeTypeOf('number');
    }
  });
});

describe('the published files', () => {
  it('serves every allowlisted artifact', () => {
    for (const name of ARTIFACTS.keys()) {
      expect(statusOf(`/files/${name}`), name).toBe(200);
    }
  });

  it('serves bytes whose digest is the one the cover sheet declares', () => {
    const served = handleRequest('GET', '/files/leavers-export.csv').body;
    const sheet = JSON.parse(text('/files/leavers-export.cover-sheet.json')) as {
      content_digest: { value: string };
    };
    expect(createHash('sha256').update(Buffer.from(served)).digest('hex')).toBe(
      sheet.content_digest.value,
    );
  });

  it('refuses a name that is not published, without touching the filesystem', () => {
    // `/files/..%2f..%2fetc%2fpasswd` is a URL anybody can type. The served set is a Map
    // keyed by name and the name is never joined onto a path, so there is nothing to walk.
    expect(statusOf('/files/..%2F..%2Fetc%2Fpasswd')).toBe(404);
    expect(statusOf('/files/constructor')).toBe(404);
    expect(statusOf('/files/toString')).toBe(404);
  });

  it('serves the seeded truncation case as a short file under a full cover sheet', () => {
    const sheet = JSON.parse(text('/files/leavers-export-truncated.cover-sheet.json')) as {
      row_count: number;
      seeded_case: string;
    };
    const lines = text('/files/leavers-export-truncated.csv').trimEnd().split('\n');
    expect(sheet.seeded_case).toBe('declared-count-mismatch');
    expect(lines.length - 2).toBeLessThan(sheet.row_count);
  });
});
