import {
  accessgateAccounts,
  accessgateCount,
  accessgateCredentialEcho,
  approvenowApprovals,
  approvenowCount,
  coredirectoryAccounts,
  coredirectoryCount,
  ledgerflowCount,
  ledgerflowTransactions,
  peoplehubCount,
  peoplehubEmployees,
} from './apis.js';
import * as files from './files.js';
import {
  NON_MUTATING_READS,
  decodeSegment,
  html,
  json,
  type NorthstarRequest,
  type NorthstarResponse,
} from './http.js';
import * as loancore from './loancore.js';
import { layout } from './page.js';
import * as prodconsole from './prodconsole.js';

/**
 * The route table. Every surface of every synthetic Northstar system is in this array and
 * nowhere else.
 *
 * The read-only RULE is not here: it is applied once, above routing, in `handleRequest`.
 * What is here is each route's own DECLARATION of which of its operations mutate no
 * audited business data, which is the only input that rule takes. A rule expressed per
 * route is a rule a later route forgets; a declaration read by one rule is not, because
 * the rule refuses whatever the declaration does not cover — including a route that
 * declares nothing at all.
 *
 * `read-only.test.ts` asserts BOTH directions over THIS ARRAY rather than over a list of
 * paths somebody typed — which is why every route must declare a `probe` path that its own
 * pattern matches. A route added without one does not compile; a route whose probe does
 * not match its pattern fails a test. That is what makes "every route" a claim rather than
 * a sample.
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
  /**
   * The operations this route serves WITHOUT mutating audited business data (FR-3).
   *
   * OPTIONAL, and its absence is the read-only rule's fail-closed default: a route that
   * declares nothing has declared itself entirely mutating, and `enforceReadOnly` refuses
   * every method on it — GET included — until it says otherwise. The default lives in the
   * type rather than in a convention, which is the same forcing function the old
   * "every method but GET and HEAD" rule had, expressed against the thing that is
   * actually true.
   *
   * Written in upper case and matched exactly against the method the client sent. Nearly
   * every route declares {@link NON_MUTATING_READS} and nothing else; the LoanCore sign-in
   * additionally declares its `POST`, because signing in creates a SESSION and touches no
   * audited business data. There is no heuristic that would work this out — the
   * declaration is per route and explicit.
   */
  readonly nonMutating?: readonly string[];
  handle(request: NorthstarRequest, match: RegExpExecArray): NorthstarResponse;
}

/** The route a request resolves to, and what its pattern captured. */
export interface MatchedRoute {
  readonly route: Route;
  readonly match: RegExpExecArray;
}

/**
 * The ONE matcher.
 *
 * `handleRequest` matches once and hands the answer to the read-only rule and to the
 * handler alike, so the rule and the routing can never disagree about which route a
 * request is — which is what would make a "declared non-mutating" operation get its
 * declaration from one route and its behaviour from another.
 *
 * The pattern is matched against the RAW path, so a percent-encoded slash cannot smuggle
 * a segment past an anchored pattern; the handler decodes what it captured.
 */
export function matchRoute(rawPath: string): MatchedRoute | null {
  for (const route of ROUTES) {
    const match = route.pattern.exec(rawPath);
    if (match !== null) return { route, match };
  }
  return null;
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
<p>Every surface below is read-only. Any operation a surface has not declared non-mutating is refused with an explicit denial.</p>
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
    nonMutating: NON_MUTATING_READS,
    summary: 'Index of every synthetic surface.',
    handle: () => systemsIndex(),
  },
  {
    id: 'health',
    system: 'Northstar',
    pattern: /^\/health$/,
    probe: '/health',
    nonMutating: NON_MUTATING_READS,
    summary: 'Liveness for the test harness. Says nothing about a Target System.',
    handle: () => json(200, { status: 'ok', service: 'northstar' }),
  },
  {
    id: 'loancore-home',
    system: 'LoanCore',
    pattern: /^\/loancore\/?$/,
    probe: '/loancore',
    nonMutating: NON_MUTATING_READS,
    summary:
      'LoanCore user administration home. The sign-in form to a caller with no session, and the surface the frozen allowed origin names.',
    handle: (request) => loancore.home(request),
  },
  {
    id: 'loancore-sign-in',
    system: 'LoanCore',
    pattern: /^\/loancore\/sign-in$/,
    probe: '/loancore/sign-in',
    // The one route on this process that declares a POST non-mutating. Signing in creates
    // a SESSION; it writes no account, no loan and no audited business data of any kind,
    // which is what FR-3 constrains. Declared here and nowhere else, because the read-only
    // rule takes its answer from the route rather than from the shape of the request.
    nonMutating: [...NON_MUTATING_READS, 'POST'],
    summary:
      'The LoanCore sign-in form, and the POST that submits it. A session, never business data.',
    handle: (request) => loancore.signIn(request),
  },
  {
    id: 'loancore-search',
    system: 'LoanCore',
    pattern: /^\/loancore\/users\/?$/,
    probe: '/loancore/users',
    nonMutating: NON_MUTATING_READS,
    summary: 'Search accounts by employee ID or full name.',
    handle: (request) => loancore.search(request),
  },
  {
    id: 'loancore-account',
    system: 'LoanCore',
    pattern: /^\/loancore\/users\/([^/]+)$/,
    probe: '/loancore/users/E-000103',
    nonMutating: NON_MUTATING_READS,
    summary: 'One account page: Status, Username, Roles, Employee ID.',
    handle: (request, match) => loancore.accountPage(request, decodeSegment(match[1] ?? '')),
  },
  {
    id: 'prodconsole-home',
    system: 'ProdConsole',
    pattern: /^\/prodconsole\/?$/,
    probe: '/prodconsole',
    nonMutating: NON_MUTATING_READS,
    summary: 'ProdConsole home.',
    handle: () => prodconsole.home(),
  },
  {
    id: 'prodconsole-configuration',
    system: 'ProdConsole',
    pattern: /^\/prodconsole\/configuration$/,
    probe: '/prodconsole/configuration',
    nonMutating: NON_MUTATING_READS,
    summary: 'Parameter values, the signed snapshot identifier and the expected parameter count.',
    handle: () => prodconsole.configuration(),
  },
  {
    id: 'accessgate-accounts',
    system: 'AccessGate',
    pattern: /^\/accessgate\/accounts$/,
    probe: '/accessgate/accounts',
    nonMutating: NON_MUTATING_READS,
    summary: 'Accounts, in deterministic order. `?status=` narrows to the bound population.',
    handle: (request) => accessgateAccounts(request),
  },
  {
    id: 'accessgate-count',
    system: 'AccessGate',
    pattern: /^\/accessgate\/accounts\/count$/,
    probe: '/accessgate/accounts/count',
    nonMutating: NON_MUTATING_READS,
    summary: 'The declared count of active accounts, generated from the dataset.',
    handle: () => accessgateCount(),
  },
  {
    id: 'accessgate-credential-echo',
    system: 'AccessGate',
    pattern: /^\/accessgate\/credential-echo$/,
    probe: '/accessgate/credential-echo',
    nonMutating: NON_MUTATING_READS,
    summary:
      'DELIBERATELY HOSTILE (Story 4.3): echoes the caller’s Authorization header into a row, so a Run can be shown to REFUSE to freeze it. Bound by no Procedure and seeded by nothing.',
    handle: (request) => accessgateCredentialEcho(request),
  },
  {
    id: 'accessgate-home',
    system: 'AccessGate',
    pattern: /^\/accessgate\/?$/,
    probe: '/accessgate',
    nonMutating: NON_MUTATING_READS,
    summary: 'AccessGate service description.',
    handle: () => apiHome('AccessGate', ['/accessgate/accounts', '/accessgate/accounts/count']),
  },
  {
    id: 'coredirectory-accounts',
    system: 'CoreDirectory',
    pattern: /^\/coredirectory\/accounts$/,
    probe: '/coredirectory/accounts',
    nonMutating: NON_MUTATING_READS,
    summary: 'Every account of both published CoreDirectory populations, in deterministic order.',
    handle: () => coredirectoryAccounts(),
  },
  {
    id: 'coredirectory-count',
    system: 'CoreDirectory',
    pattern: /^\/coredirectory\/accounts\/count$/,
    probe: '/coredirectory/accounts/count',
    nonMutating: NON_MUTATING_READS,
    summary: 'The declared count of CoreDirectory accounts, generated from the dataset.',
    handle: () => coredirectoryCount(),
  },
  {
    id: 'coredirectory-home',
    system: 'CoreDirectory',
    pattern: /^\/coredirectory\/?$/,
    probe: '/coredirectory',
    nonMutating: NON_MUTATING_READS,
    summary: 'CoreDirectory service description.',
    handle: () =>
      apiHome('CoreDirectory', ['/coredirectory/accounts', '/coredirectory/accounts/count']),
  },
  {
    id: 'approvenow-approvals',
    system: 'ApproveNow',
    pattern: /^\/approvenow\/approvals$/,
    probe: '/approvenow/approvals',
    nonMutating: NON_MUTATING_READS,
    summary: 'Approval decisions and approver limits, in deterministic order.',
    handle: () => approvenowApprovals(),
  },
  {
    id: 'approvenow-count',
    system: 'ApproveNow',
    pattern: /^\/approvenow\/approvals\/count$/,
    probe: '/approvenow/approvals/count',
    nonMutating: NON_MUTATING_READS,
    summary: 'The declared count of approval decisions, generated from the dataset.',
    handle: () => approvenowCount(),
  },
  {
    id: 'approvenow-home',
    system: 'ApproveNow',
    pattern: /^\/approvenow\/?$/,
    probe: '/approvenow',
    nonMutating: NON_MUTATING_READS,
    summary: 'ApproveNow service description.',
    handle: () => apiHome('ApproveNow', ['/approvenow/approvals', '/approvenow/approvals/count']),
  },
  {
    id: 'peoplehub-employees',
    system: 'PeopleHub',
    pattern: /^\/peoplehub\/employees$/,
    probe: '/peoplehub/employees',
    nonMutating: NON_MUTATING_READS,
    summary: 'Employee records, in deterministic order.',
    handle: () => peoplehubEmployees(),
  },
  {
    id: 'peoplehub-count',
    system: 'PeopleHub',
    pattern: /^\/peoplehub\/employees\/count$/,
    probe: '/peoplehub/employees/count',
    nonMutating: NON_MUTATING_READS,
    summary: 'The declared count of employee records, generated from the dataset.',
    handle: () => peoplehubCount(),
  },
  {
    id: 'peoplehub-home',
    system: 'PeopleHub',
    pattern: /^\/peoplehub\/?$/,
    probe: '/peoplehub',
    nonMutating: NON_MUTATING_READS,
    summary: 'PeopleHub service description.',
    handle: () => apiHome('PeopleHub', ['/peoplehub/employees', '/peoplehub/employees/count']),
  },
  {
    id: 'ledgerflow-transactions',
    system: 'LedgerFlow',
    pattern: /^\/ledgerflow\/transactions$/,
    probe: '/ledgerflow/transactions',
    nonMutating: NON_MUTATING_READS,
    summary: 'Processed transactions, in deterministic order.',
    handle: () => ledgerflowTransactions(),
  },
  {
    id: 'ledgerflow-count',
    system: 'LedgerFlow',
    pattern: /^\/ledgerflow\/transactions\/count$/,
    probe: '/ledgerflow/transactions/count',
    nonMutating: NON_MUTATING_READS,
    summary: 'The declared count of processed transactions, generated from the dataset.',
    handle: () => ledgerflowCount(),
  },
  {
    id: 'ledgerflow-home',
    system: 'LedgerFlow',
    pattern: /^\/ledgerflow\/?$/,
    probe: '/ledgerflow',
    nonMutating: NON_MUTATING_READS,
    summary: 'LedgerFlow service description.',
    handle: () =>
      apiHome('LedgerFlow', ['/ledgerflow/transactions', '/ledgerflow/transactions/count']),
  },
  {
    id: 'files-index',
    system: 'Published files',
    pattern: /^\/files\/?$/,
    probe: '/files',
    nonMutating: NON_MUTATING_READS,
    summary: 'Index of the published file sources and their signed cover sheets.',
    handle: () => files.index(),
  },
  {
    id: 'files-artifact',
    system: 'Published files',
    pattern: /^\/files\/([^/]+)$/,
    probe: '/files/leavers-export.csv',
    nonMutating: NON_MUTATING_READS,
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
