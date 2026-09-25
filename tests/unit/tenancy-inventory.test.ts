import { describe, expect, it } from 'vitest';

import * as schema from '@intellifin/infrastructure/db';

import {
  AGGREGATES,
  BOUNDARIES,
  COMMANDS,
  PRINCIPAL_KINDS,
  PROTECTED_CLASS_BOUNDARIES,
  TABLE_CLASSES,
  UUID_AGGREGATES,
  readTenancyContract,
  sectionText,
  type Grant,
  type InventoryRow,
} from '../fixtures/tenancy-contract.js';

/**
 * The inventory test (Story 11.1, `tenancy-v1` §6).
 *
 * `docs/contracts/tenancy-v1.md` is what Story 11.4 turns into row-level-security policies
 * and Story 11.6 into column privileges. A row missing there is a table nobody decided a
 * policy for; a boundary missing is a policy that would let a member of one client read
 * another's rows; a lock granted without its read is a policy that refuses the product's
 * own append. So every rule the contract states about its own tables is checked here, one
 * named case per rule, against the document — and the classification against the Drizzle
 * schema, so a new table fails in this second rather than in the integration job.
 *
 * The parser returns what the document says; the vocabularies are held HERE. Each case has
 * been proven by breaking its rule in the document and watching this case, and not a parse
 * error, fail (the mutation record is in the Story 11.1 spec).
 */

const contract = readTenancyContract();
const classOf = new Map(contract.classification.map((row) => [row.relation, row.tableClass]));
const isProtected = (tableClass: string | undefined): boolean =>
  tableClass !== undefined && Object.hasOwn(PROTECTED_CLASS_BOUNDARIES, tableClass);
const protectedRelations = contract.classification
  .filter((row) => isProtected(row.tableClass))
  .map((row) => row.relation);
const rowOf = (relation: string): InventoryRow | undefined =>
  contract.inventory.find((row) => row.relation === relation);
const closedList = contract.principals.map((row) => row.principal);

/** Every Drizzle table and its SQL column names, read by the symbols drizzle-orm registers. */
const drizzleTables = (): Map<string, readonly string[]> => {
  const NAME = Symbol.for('drizzle:Name');
  const SCHEMA = Symbol.for('drizzle:Schema');
  const IS_TABLE = Symbol.for('drizzle:IsDrizzleTable');
  // Only `drizzle:Columns`: drizzle-orm 0.45.2 also puts an own enumerable `enableRLS`
  // function on every table, whose `.name` would read as a column called `enableRLS`.
  const COLUMNS = Symbol.for('drizzle:Columns');
  const tables = new Map<string, readonly string[]>();
  for (const value of Object.values(schema)) {
    if (typeof value !== 'object' || value === null) continue;
    const table = value as unknown as Record<symbol, unknown>;
    if (table[IS_TABLE] !== true) continue;
    const relation = `${(table[SCHEMA] as string | undefined) ?? 'public'}.${table[NAME] as string}`;
    const columns = Object.values(table[COLUMNS] as Record<string, { readonly name: string }>).map((c) => c.name);
    tables.set(relation, columns);
  }
  return tables;
};

/**
 * Fails naming every offender in full. Vitest shortens an array in its assertion message
 * (`[ 'public.a', …(2) ]`) and only its default reporter prints the diff that lists the rest,
 * so the names go into the message itself: a failure names everything that broke the rule,
 * whichever reporter shows it.
 */
const none = (offenders: readonly string[]): void => {
  expect(offenders, `offending: ${offenders.join(', ')}`).toEqual([]);
};

interface Cell {
  readonly who: string;
  readonly grants: readonly Grant[];
}

/** Every grant cell of a row: the two principal kinds, then each maintenance entry. */
const cellsOf = (row: InventoryRow): Cell[] => [
  { who: 'member', grants: row.member },
  { who: 'execution delegation', grants: row.delegation },
  ...row.maintenance.map((entry) => ({ who: entry.principal ?? entry.text, grants: entry.grants })),
];

/** What one principal (a kind, or a maintenance principal) may do to one table. */
const grantsOf = (relation: string, principal: string): readonly Grant[] => {
  const row = rowOf(relation);
  if (row === undefined) return [];
  if (principal === 'member') return row.member;
  if (principal === 'execution delegation') return row.delegation;
  return row.maintenance.filter((entry) => entry.principal === principal).flatMap((entry) => entry.grants);
};
const has = (grants: readonly Grant[], command: string): boolean =>
  grants.some((grant) => grant.command === command);
/** An unqualified UPDATE, or a narrow one covering every column named. */
const updates = (grants: readonly Grant[], columns: readonly string[]): boolean =>
  grants.some((grant) => grant.command === 'UPDATE' && (grant.columns === null || columns.every((c) => grant.columns!.includes(c))));

const repeated = <T>(values: readonly T[]): T[] => values.filter((value, index) => values.indexOf(value) !== index);
const SCHEMA_QUALIFIED = /^[^.\s]+\.[^\s]+$/;
/** Section text with emphasis and code marks removed, so a rule reads as one sentence. */
const plain = (heading: string): string =>
  sectionText(contract.markdown, heading).replace(/[*`]/g, '').replace(/\s+/g, ' ');

describe('tenancy-v1: the classification (§3)', () => {
  it('names each relation once', () => {
    none(repeated(contract.classification.map((row) => row.relation)));
  });

  it('writes every relation schema-qualified', () => {
    const relations = [...contract.classification, ...contract.inventory].map((row) => row.relation);
    none(relations.filter((relation) => !SCHEMA_QUALIFIED.test(relation)));
  });

  it('uses only the five class names', () => {
    const unknown = contract.classification
      .filter((row) => !(TABLE_CLASSES as readonly string[]).includes(row.tableClass))
      .map((row) => `${row.relation}: ${row.tableClass}`);
    none(unknown);
  });

  it('classifies every table the Drizzle schema declares', () => {
    const unclassified = [...drizzleTables().keys()].filter((relation) => !classOf.has(relation));
    none(unclassified);
  });
});

describe('tenancy-v1: the policy inventory (§5)', () => {
  const inventoryRelations = contract.inventory.map((row) => row.relation);

  it('has exactly one row per protected table', () => {
    expect([...inventoryRelations].sort()).toEqual([...protectedRelations].sort());
  });

  it('gives no tenant policy to an authentication or infrastructure table', () => {
    const unprotected = inventoryRelations.filter((relation) => {
      const tableClass = classOf.get(relation);
      return tableClass === 'global authentication' || tableClass === 'platform infrastructure';
    });
    none(unprotected);
  });

  it('carries at least its class boundaries on every protected table', () => {
    const missing = contract.inventory.flatMap((row) => {
      const tableClass = classOf.get(row.relation);
      const required = tableClass !== undefined && isProtected(tableClass) ? PROTECTED_CLASS_BOUNDARIES[tableClass]! : [];
      const names = row.boundaries.map((boundary) => boundary.name);
      return required.filter((boundary) => !names.includes(boundary)).map((boundary) => `${row.relation}: ${boundary}`);
    });
    none(missing);
  });

  it('uses only tenant, client, engagement and owner as boundaries', () => {
    const unknown = contract.inventory.flatMap((row) =>
      row.boundaries
        .filter((boundary) => !(BOUNDARIES as readonly string[]).includes(boundary.name))
        .map((boundary) => `${row.relation}: ${boundary.text}`));
    none(unknown);
  });

  it('narrows only the owner boundary, and only to known commands', () => {
    const wrong = contract.inventory.flatMap((row) =>
      row.boundaries
        .filter((boundary) => boundary.commands !== null && (
          boundary.name !== 'owner' ||
          boundary.commands.length === 0 ||
          repeated(boundary.commands).length > 0 ||
          boundary.commands.some((command) => !(COMMANDS as readonly string[]).includes(command))))
        .map((boundary) => `${row.relation}: ${boundary.text}`));
    none(wrong);
  });

  it('names each boundary at most once per row', () => {
    const twice = contract.inventory.flatMap((row) =>
      repeated(row.boundaries.map((boundary) => boundary.name)).map((name) => `${row.relation}: ${name}`));
    none(twice);
  });

  it('gives every user-owned table a bare owner boundary', () => {
    const narrowed = contract.inventory
      .filter((row) => classOf.get(row.relation) === 'user-owned')
      .filter((row) => !row.boundaries.some((boundary) => boundary.name === 'owner' && boundary.commands === null))
      .map((row) => row.relation);
    none(narrowed);
  });

  it('grants only SELECT, INSERT, UPDATE, DELETE and LOCK', () => {
    const unknown = contract.inventory.flatMap((row) =>
      cellsOf(row).flatMap(({ who, grants }) =>
        grants
          .filter((grant) => !(COMMANDS as readonly string[]).includes(grant.command))
          .map((grant) => `${row.relation} ${who}: ${grant.text}`)));
    none(unknown);
  });

  it('narrows only UPDATE to columns', () => {
    const narrowed = contract.inventory.flatMap((row) =>
      cellsOf(row).flatMap(({ who, grants }) =>
        grants
          .filter((grant) => grant.columns !== null && grant.command !== 'UPDATE')
          .map((grant) => `${row.relation} ${who}: ${grant.text}`)));
    none(narrowed);
  });

  it('names only real columns in a narrow UPDATE', () => {
    const tables = drizzleTables();
    const unknown = contract.inventory.flatMap((row) =>
      cellsOf(row).flatMap(({ who, grants }) =>
        grants.flatMap((grant) =>
          (grant.columns ?? [])
            .filter((column) => !(tables.get(row.relation) ?? []).includes(column))
            .map((column) => `${row.relation} ${who}: ${column === '' ? '(empty)' : column}`))));
    none(unknown);
  });

  it('grants each command at most once per principal kind', () => {
    const twice = contract.inventory.flatMap((row) =>
      cellsOf(row).flatMap(({ who, grants }) =>
        repeated(grants.map((grant) => grant.command)).map((command) => `${row.relation} ${who}: ${command}`)));
    none(twice);
  });

  it('grants SELECT wherever it grants LOCK', () => {
    const blind = contract.inventory.flatMap((row) =>
      cellsOf(row)
        .filter(({ grants }) => has(grants, 'LOCK') && !has(grants, 'SELECT'))
        .map(({ who }) => `${row.relation} ${who}`));
    none(blind);
  });

  it('lets some principal read every protected table', () => {
    const unread = contract.inventory
      .filter((row) => !cellsOf(row).some(({ grants }) => has(grants, 'SELECT')))
      .map((row) => row.relation);
    none(unread);
  });
});

describe('tenancy-v1: the maintenance principals (§4.2)', () => {
  const entries = contract.inventory.flatMap((row) => row.maintenance.map((entry) => ({ row, entry })));

  it('names each maintenance principal once', () => {
    none(repeated(closedList));
  });

  it('names only maintenance principals from the closed list', () => {
    const outside = entries
      .filter(({ entry }) => entry.principal !== null && !closedList.includes(entry.principal))
      .map(({ row, entry }) => `${row.relation}: ${entry.principal}`);
    none(outside);
  });

  it('uses every maintenance principal of the closed list', () => {
    const granted = new Set(entries.filter(({ entry }) => entry.grants.length > 0).map(({ entry }) => entry.principal));
    none(closedList.filter((principal) => !granted.has(principal)));
  });

  it('D7: says which rows each maintenance principal may reach', () => {
    const unscoped = contract.principals
      .filter((row) => row.rowsItMayReach.trim() === '' || row.rowsItMayReach.trim() === '—')
      .map((row) => row.principal);
    none(unscoped);
  });

  it('writes every maintenance entry as `principal`: COMMANDS', () => {
    const malformed = entries.filter(({ entry }) => entry.principal === null).map(({ row, entry }) => `${row.relation}: ${entry.text}`);
    none(malformed);
  });

  it('grants at least one command in every maintenance entry', () => {
    const empty = entries.filter(({ entry }) => entry.grants.length === 0).map(({ row, entry }) => `${row.relation}: ${entry.text}`);
    none(empty);
  });

  it('names each maintenance principal at most once per row', () => {
    const twice = contract.inventory.flatMap((row) =>
      repeated(row.maintenance.flatMap((entry) => (entry.principal === null ? [] : [entry.principal])))
        .map((principal) => `${row.relation}: ${principal}`));
    none(twice);
  });
});

describe('tenancy-v1: the audit append (§4.3)', () => {
  const appenders = contract.appenders;
  const isMaintenance = (principal: string): boolean => !(PRINCIPAL_KINDS as readonly string[]).includes(principal);

  it('names only known principals in the audit append', () => {
    const known = [...PRINCIPAL_KINDS, ...closedList];
    none(appenders.map((row) => row.principal).filter((principal) => !known.includes(principal)));
  });

  it('names each appending principal once', () => {
    none(repeated(appenders.map((row) => row.principal)));
  });

  it('names only the known aggregates', () => {
    const unknown = appenders.flatMap((row) =>
      row.aggregates
        .filter((aggregate) => !(AGGREGATES as readonly string[]).includes(aggregate))
        .map((aggregate) => `${row.principal}: ${aggregate}`));
    none(unknown);
  });

  it('answers yes or no for command receipts and narrated events', () => {
    const neither = appenders.flatMap((row) =>
      [row.commandReceipts, row.narratedEvents]
        .filter((answer) => answer !== 'yes' && answer !== 'no')
        .map((answer) => `${row.principal}: ${answer}`));
    none(neither);
  });

  it('lists exactly the principals that insert into audit_events', () => {
    const events = rowOf('public.audit_events');
    const inserting = events === undefined ? [] : cellsOf(events).filter(({ grants }) => has(grants, 'INSERT')).map(({ who }) => who);
    expect([...appenders.map((row) => row.principal)].sort()).toEqual([...inserting].sort());
  });

  it('gives every appending principal the head it locks and advances', () => {
    const short = appenders
      .filter(({ principal }) => {
        const heads = grantsOf('public.audit_event_heads', principal);
        return !(has(heads, 'SELECT') && has(heads, 'INSERT') && has(heads, 'LOCK') &&
          updates(heads, ['last_sequence', 'last_event_hash']));
      })
      .map((row) => row.principal);
    none(short);
  });

  it('gives every appender of a UUID aggregate SELECT and LOCK on audit_run', () => {
    const unlocked = appenders
      .filter((row) => row.aggregates.some((aggregate) => (UUID_AGGREGATES as readonly string[]).includes(aggregate)))
      .filter(({ principal }) => {
        const run = grantsOf('public.audit_run', principal);
        return !(has(run, 'SELECT') && has(run, 'LOCK'));
      })
      .map((row) => row.principal);
    none(unlocked);
  });

  it('gives every principal whose events carry a command receipt the projection grants', () => {
    const short = appenders
      .filter((row) => row.commandReceipts === 'yes')
      .filter(({ principal }) => {
        const command = grantsOf('public.run_interaction_command', principal);
        const transition = grantsOf('public.run_interaction_transition', principal);
        return !(has(command, 'SELECT') && has(command, 'LOCK') && has(transition, 'SELECT') && has(transition, 'INSERT'));
      })
      .map((row) => row.principal);
    none(short);
  });

  it('gives every principal whose events are narrated the narration grants', () => {
    const short = appenders
      .filter((row) => row.narratedEvents === 'yes')
      .filter(({ principal }) => {
        const message = grantsOf('public.run_conversation_message', principal);
        return !(has(message, 'SELECT') && has(message, 'INSERT'));
      })
      .map((row) => row.principal);
    none(short);
  });

  it('gives a maintenance principal marked no none of the projection or narration grants', () => {
    const unused = appenders.filter((row) => isMaintenance(row.principal)).flatMap((row) => [
      ...(row.commandReceipts === 'no'
        ? [
            ...['SELECT', 'LOCK'].filter((c) => has(grantsOf('public.run_interaction_command', row.principal), c))
              .map((c) => `${row.principal}: ${c} on public.run_interaction_command`),
            ...['SELECT', 'INSERT'].filter((c) => has(grantsOf('public.run_interaction_transition', row.principal), c))
              .map((c) => `${row.principal}: ${c} on public.run_interaction_transition`),
          ]
        : []),
      ...(row.narratedEvents === 'no'
        ? ['SELECT', 'INSERT'].filter((c) => has(grantsOf('public.run_conversation_message', row.principal), c))
            .map((c) => `${row.principal}: ${c} on public.run_conversation_message`)
        : []),
    ]);
    none(unused);
  });
});

describe('tenancy-v1: the decisions (§7)', () => {
  const ids = contract.decisions.map((decision) => decision.id);
  const classes = (relations: readonly string[]): Record<string, string | undefined> =>
    Object.fromEntries(relations.map((relation) => [relation, classOf.get(relation)]));
  const boundariesOf = (relation: string): string[] => (rowOf(relation)?.boundaries ?? []).map((b) => b.text);

  it('records decisions D1 to D8 and open decisions O1 to O5, each once', () => {
    const expected = [...Array.from({ length: 8 }, (_, i) => `D${i + 1}`), ...Array.from({ length: 5 }, (_, i) => `O${i + 1}`)];
    expect({ missing: expected.filter((id) => !ids.includes(id)), repeated: repeated(ids) })
      .toEqual({ missing: [], repeated: [] });
  });

  it('names the story that settles every decision', () => {
    const unowned = contract.decisions.filter((decision) => !/\bStor(?:y|ies) \d+\.\d+[a-z]?\b/.test(decision.text)).map((d) => d.id);
    none(unowned);
  });

  it('cites only decisions §7 records', () => {
    const outside7 = contract.markdown.replace(sectionText(contract.markdown, '## 7.'), '');
    const cited = [...new Set(outside7.match(/\b[DO][1-9]\d*\b/g) ?? [])];
    none(cited.filter((id) => !ids.includes(id)));
  });

  it('D1: classifies Procedures, registrations and bindings as client material', () => {
    const relations = ['public.procedure', 'public.target_system_registration', 'public.population_source_binding'];
    expect(classes(relations)).toEqual(Object.fromEntries(relations.map((r) => [r, 'client/engagement-owned'])));
  });

  it('D2: classifies procedure_change as client material', () => {
    expect(classOf.get('public.procedure_change')).toBe('client/engagement-owned');
  });

  it('D3: keeps procedure_configuration platform infrastructure', () => {
    expect(classOf.get('public.procedure_configuration')).toBe('platform infrastructure');
  });

  it('D4: keeps a client boundary beside the owner on run_initiation_request', () => {
    expect(classOf.get('public.run_initiation_request')).toBe('user-owned');
    expect(boundariesOf('public.run_initiation_request')).toEqual(expect.arrayContaining(['client', 'owner']));
  });

  it('D5: classifies user_role and user_permission_grant as tenant-owned', () => {
    expect(classes(['public.user_role', 'public.user_permission_grant'])).toEqual({
      'public.user_role': 'tenant-owned',
      'public.user_permission_grant': 'tenant-owned',
    });
  });

  it('D6: restricts only reads of a notification to its owner, and every command elsewhere', () => {
    const owners = Object.fromEntries(
      ['public.notification', 'public.evidence_read_grant', 'public.procedure_authoring_request',
        'public.run_review_snapshot', 'public.run_review_snapshot_row']
        .map((relation) => [relation, boundariesOf(relation).filter((text) => text.startsWith('owner'))]));
    expect(owners).toEqual({
      'public.notification': ['owner(SELECT)'],
      'public.evidence_read_grant': ['owner'],
      'public.procedure_authoring_request': ['owner'],
      'public.run_review_snapshot': ['owner'],
      'public.run_review_snapshot_row': ['owner'],
    });
  });

  it('D8: widens no maintenance grant for a trigger function\'s read of audit_events', () => {
    const readers = (rowOf('public.audit_events')?.maintenance ?? [])
      .filter((entry) => has(entry.grants, 'SELECT'))
      .map((entry) => entry.principal ?? entry.text);
    none(readers);
  });
});

describe('tenancy-v1: the rules Story 11.4 builds policies from', () => {
  it('states that the inventory is scope, not capability', () => {
    expect(plain('## 1.')).toContain('The inventory states scope, not capability.');
  });

  it('states that a null scope column means the level above, never unrestricted', () => {
    expect(plain('## 2.')).toContain('A null scope column means the level above, never unrestricted.');
  });

  it('states that the inventory is derived from the production code\'s access paths', () => {
    expect(plain('## 5.')).toContain('derived from the production code\'s access paths');
  });

  it('states that the owner boundary applies to members and execution delegations only', () => {
    expect(plain('## 5.')).toContain('applies to members and execution delegations only');
  });

  it('states that a LOCK without UPDATE is an UPDATE policy whose WITH CHECK is false', () => {
    expect(plain('## 5.')).toContain('a LOCK without UPDATE is built as an UPDATE policy whose WITH CHECK is false');
  });
});
