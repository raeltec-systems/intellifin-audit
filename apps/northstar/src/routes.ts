import {
  accessgateAccounts,
  accessgateCount,
  approvenowApprovals,
  approvenowCount,
  ledgerflowCount,
  ledgerflowTransactions,
  peoplehubCount,
  peoplehubEmployees,
} from './apis.js';
import * as files from './files.js';
import { decodeSegment, html, json, type NorthstarRequest, type NorthstarResponse } from './http.js';
import * as loancore from './loancore.js';
import { layout } from './page.js';
import * as prodconsole from './prodconsole.js';

/**
 * The route table. Every surface of every synthetic Northstar system is in this array and
 * nowhere else.
 *
 * The read-only rule is NOT here: it is applied once, above routing, in `handleRequest`.
 * A rule expressed per route is a rule a later route forgets, and `read-only.test.ts`
 * asserts the refusal over THIS ARRAY rather than over a list of paths somebody typed —
 * which is why every route must declare a `probe` path that its own pattern matches. A
 * route added without one does not compile; a route whose probe does not match its pattern
 * fails a test. That is what makes "every route" a claim rather than a sample.
 */

export interface Route {
  readonly id: string;
  /** Which synthetic system the surface belongs to. */
  readonly system: string;
  /** Matched against the decoded path. Anchored on both ends. */
  readonly pattern: RegExp;
  /**
   * A concrete path this route serves. Required, and checked against `pattern`.
   *
   * It is the route's own statement of "here is one of me", which is what lets a test
   * walk the table instead of holding its own copy of the paths.
   */
  readonly probe: string;
  readonly summary: string;
  handle(request: NorthstarRequest, match: RegExpExecArray): NorthstarResponse;
}

function systemsIndex(): NorthstarResponse {
  const rows = ROUTES.map(
    (route) =>
      `<tr><td>${route.system}</td><td><a href="${route.probe}">${route.probe}</a></td><td>${route.summary}</td></tr>`,
  ).join('\n');
  return html(
    200,
    layout({
      system: 'Northstar Financial Group',
      title: 'Synthetic systems',
      body: `<h2>Synthetic systems</h2>
<p>Every surface below is read-only. Any method other than GET or HEAD is refused with an explicit denial.</p>
<table>
<caption>Surfaces this process serves</caption>
<tr><th scope="col">System</th><th scope="col">Path</th><th scope="col">What it serves</th></tr>
${rows}
</table>`,
    }),
  );
}

export const ROUTES: readonly Route[] = [
  {
    id: 'root',
    system: 'Northstar',
    pattern: /^\/$/,
    probe: '/',
    summary: 'Index of every synthetic surface.',
    handle: () => systemsIndex(),
  },
  {
    id: 'health',
    system: 'Northstar',
    pattern: /^\/health$/,
    probe: '/health',
    summary: 'Liveness for the test harness. Says nothing about a Target System.',
    handle: () => json(200, { status: 'ok', service: 'northstar' }),
  },
  {
    id: 'loancore-home',
    system: 'LoanCore',
    pattern: /^\/loancore\/?$/,
    probe: '/loancore',
    summary: 'LoanCore user administration home.',
    handle: () => loancore.home(),
  },
  {
    id: 'loancore-search',
    system: 'LoanCore',
    pattern: /^\/loancore\/users\/?$/,
    probe: '/loancore/users',
    summary: 'Search accounts by employee ID or full name.',
    handle: (request) => loancore.search(request),
  },
  {
    id: 'loancore-account',
    system: 'LoanCore',
    pattern: /^\/loancore\/users\/([^/]+)$/,
    probe: '/loancore/users/E-000103',
    summary: 'One account page: Status, Username, Roles, Employee ID.',
    handle: (request, match) => loancore.accountPage(request, decodeSegment(match[1] ?? '')),
  },
  {
    id: 'prodconsole-home',
    system: 'ProdConsole',
    pattern: /^\/prodconsole\/?$/,
    probe: '/prodconsole',
    summary: 'ProdConsole home.',
    handle: () => prodconsole.home(),
  },
  {
    id: 'prodconsole-configuration',
    system: 'ProdConsole',
    pattern: /^\/prodconsole\/configuration$/,
    probe: '/prodconsole/configuration',
    summary: 'Parameter values, the signed snapshot identifier and the expected parameter count.',
    handle: () => prodconsole.configuration(),
  },
  {
    id: 'accessgate-accounts',
    system: 'AccessGate',
    pattern: /^\/accessgate\/accounts$/,
    probe: '/accessgate/accounts',
    summary: 'Accounts, in deterministic order. `?status=` narrows to the bound population.',
    handle: (request) => accessgateAccounts(request),
  },
  {
    id: 'accessgate-count',
    system: 'AccessGate',
    pattern: /^\/accessgate\/accounts\/count$/,
    probe: '/accessgate/accounts/count',
    summary: 'The declared count of active accounts, generated from the dataset.',
    handle: () => accessgateCount(),
  },
  {
    id: 'accessgate-home',
    system: 'AccessGate',
    pattern: /^\/accessgate\/?$/,
    probe: '/accessgate',
    summary: 'AccessGate service description.',
    handle: () => apiHome('AccessGate', ['/accessgate/accounts', '/accessgate/accounts/count']),
  },
  {
    id: 'approvenow-approvals',
    system: 'ApproveNow',
    pattern: /^\/approvenow\/approvals$/,
    probe: '/approvenow/approvals',
    summary: 'Approval decisions and approver limits, in deterministic order.',
    handle: () => approvenowApprovals(),
  },
  {
    id: 'approvenow-count',
    system: 'ApproveNow',
    pattern: /^\/approvenow\/approvals\/count$/,
    probe: '/approvenow/approvals/count',
    summary: 'The declared count of approval decisions, generated from the dataset.',
    handle: () => approvenowCount(),
  },
  {
    id: 'approvenow-home',
    system: 'ApproveNow',
    pattern: /^\/approvenow\/?$/,
    probe: '/approvenow',
    summary: 'ApproveNow service description.',
    handle: () => apiHome('ApproveNow', ['/approvenow/approvals', '/approvenow/approvals/count']),
  },
  {
    id: 'peoplehub-employees',
    system: 'PeopleHub',
    pattern: /^\/peoplehub\/employees$/,
    probe: '/peoplehub/employees',
    summary: 'Employee records, in deterministic order.',
    handle: () => peoplehubEmployees(),
  },
  {
    id: 'peoplehub-count',
    system: 'PeopleHub',
    pattern: /^\/peoplehub\/employees\/count$/,
    probe: '/peoplehub/employees/count',
    summary: 'The declared count of employee records, generated from the dataset.',
    handle: () => peoplehubCount(),
  },
  {
    id: 'peoplehub-home',
    system: 'PeopleHub',
    pattern: /^\/peoplehub\/?$/,
    probe: '/peoplehub',
    summary: 'PeopleHub service description.',
    handle: () => apiHome('PeopleHub', ['/peoplehub/employees', '/peoplehub/employees/count']),
  },
  {
    id: 'ledgerflow-transactions',
    system: 'LedgerFlow',
    pattern: /^\/ledgerflow\/transactions$/,
    probe: '/ledgerflow/transactions',
    summary: 'Processed transactions, in deterministic order.',
    handle: () => ledgerflowTransactions(),
  },
  {
    id: 'ledgerflow-count',
    system: 'LedgerFlow',
    pattern: /^\/ledgerflow\/transactions\/count$/,
    probe: '/ledgerflow/transactions/count',
    summary: 'The declared count of processed transactions, generated from the dataset.',
    handle: () => ledgerflowCount(),
  },
  {
    id: 'ledgerflow-home',
    system: 'LedgerFlow',
    pattern: /^\/ledgerflow\/?$/,
    probe: '/ledgerflow',
    summary: 'LedgerFlow service description.',
    handle: () =>
      apiHome('LedgerFlow', ['/ledgerflow/transactions', '/ledgerflow/transactions/count']),
  },
  {
    id: 'files-index',
    system: 'Published files',
    pattern: /^\/files\/?$/,
    probe: '/files',
    summary: 'Index of the published file sources and their signed cover sheets.',
    handle: () => files.index(),
  },
  {
    id: 'files-artifact',
    system: 'Published files',
    pattern: /^\/files\/([^/]+)$/,
    probe: '/files/leavers-export.csv',
    summary: 'One published artifact, served as the bytes its cover sheet covers.',
    handle: (_request, match) => files.artifact(decodeSegment(match[1] ?? '')),
  },
];

function apiHome(system: string, endpoints: readonly string[]): NorthstarResponse {
  return json(200, {
    service: system,
    synthetic: true,
    access: 'read-only',
    endpoints: [...endpoints],
  });
}
