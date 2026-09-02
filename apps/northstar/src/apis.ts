import { countDeclaration, datasets, type CountDeclaration } from './fixtures.js';
import { json, type NorthstarRequest, type NorthstarResponse } from './http.js';

/**
 * The three read-only JSON APIs and the transaction feed behind them (addendum A.1, A.2).
 *
 *   AccessGate  — the P-2 population AND the P-2 Target System
 *   ApproveNow  — the P-3 Target System
 *   PeopleHub   — the alternative P-1 population
 *   LedgerFlow  — the P-3 population
 *
 * **Order is deterministic and it is part of the contract.** A Run must be reproducible
 * (FR-47), and an adapter that pages, hashes or fingerprints a response cannot do so
 * against an order that is whatever the file happened to be in the day it was read. Every
 * collection is sorted by its primary key with an explicit comparator — `Array.sort`'s
 * default compares stringified values, which is right here only by accident and wrong the
 * moment a key is not a string. The sort is stable, so the two rows that deliberately
 * share a key keep the order the dataset gives them.
 *
 * **The count endpoint serves the generated declaration verbatim.** It does not count the
 * response. A declared count that came from the thing being counted proves nothing about
 * truncation, which is the whole reason FR-6 asks for one.
 */

/** Sort by one string key. Stable, so duplicate keys keep dataset order. */
function orderedBy<T>(rows: readonly T[], key: (row: T) => string): readonly T[] {
  return [...rows].sort((left, right) => {
    const a = key(left);
    const b = key(right);
    return a < b ? -1 : a > b ? 1 : 0;
  });
}

function collection(options: {
  readonly source: string;
  readonly title: string;
  readonly generation: string;
  readonly countRoute: string;
  readonly items: readonly unknown[];
  readonly itemsKey: string;
}): NorthstarResponse {
  return json(200, {
    synthetic: {
      marker: 'SYNTHETIC-NORTHSTAR-FIXTURE',
      organization: 'Northstar Financial Group',
      statement:
        'Every value in this response is invented. No production data and no personal data.',
    },
    source: options.source,
    title: options.title,
    generation: options.generation,
    /**
     * How many rows THIS response carries. Deliberately not called `declared_count`: the
     * declaration lives at the count endpoint and is produced by the fixture generator,
     * and a response that declared its own count would reconcile with itself.
     */
    returned: options.items.length,
    declared_count_endpoint: options.countRoute,
    [options.itemsKey]: options.items,
  });
}

function countResponse(fileName: string): NorthstarResponse {
  const declaration: CountDeclaration = countDeclaration(fileName);
  return json(200, declaration);
}

/**
 * AccessGate accounts, optionally narrowed to a status.
 *
 * The count endpoint declares the ACTIVE population (`status = Active`), which is what
 * addendum C P-2 binds. `?status=Active` is therefore the call a Gate reconciles against;
 * the unfiltered call is the whole store, which is a different question with a different
 * answer.
 */
export function accessgateAccounts(request: NorthstarRequest): NorthstarResponse {
  const data = datasets.accessgate();
  const status = (request.query.get('status') ?? '').trim();
  const filtered = status === '' ? data.accounts : data.accounts.filter((a) => a.status === status);
  return collection({
    source: 'accessgate-accounts',
    title: data.title,
    generation: data.generation,
    countRoute: '/accessgate/accounts/count',
    items: orderedBy(filtered, (account) => account.account_id),
    itemsKey: 'accounts',
  });
}

export function accessgateCount(): NorthstarResponse {
  return countResponse('accessgate-accounts.count.json');
}

export function approvenowApprovals(): NorthstarResponse {
  const data = datasets.approvenow();
  return collection({
    source: 'approvenow-approvals',
    title: data.title,
    generation: data.generation,
    countRoute: '/approvenow/approvals/count',
    items: orderedBy(data.approvals, (approval) => approval.approval_id),
    itemsKey: 'approvals',
  });
}

export function approvenowCount(): NorthstarResponse {
  return countResponse('approvenow-approvals.count.json');
}

export function peoplehubEmployees(): NorthstarResponse {
  const data = datasets.peoplehub();
  return collection({
    source: 'peoplehub-employees',
    title: data.title,
    generation: data.generation,
    countRoute: '/peoplehub/employees/count',
    items: orderedBy(data.employees, (employee) => employee.employee_id),
    itemsKey: 'employees',
  });
}

export function peoplehubCount(): NorthstarResponse {
  return countResponse('peoplehub-employees.count.json');
}

export function ledgerflowTransactions(): NorthstarResponse {
  const data = datasets.ledgerflow();
  return collection({
    source: 'ledgerflow-transactions',
    title: data.title,
    generation: data.generation,
    countRoute: '/ledgerflow/transactions/count',
    items: orderedBy(data.transactions, (transaction) => transaction.transaction_id),
    itemsKey: 'transactions',
  });
}

export function ledgerflowCount(): NorthstarResponse {
  return countResponse('ledgerflow-transactions.count.json');
}
