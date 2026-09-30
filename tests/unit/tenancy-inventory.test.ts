import { existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, it } from 'vitest';

import * as schema from '@intellifin/infrastructure/db';

import {
  AGGREGATES,
  BOUNDARIES,
  COMMANDS,
  POLICY_COMMANDS,
  PRINCIPAL_KINDS,
  PROTECTED_CLASS_BOUNDARIES,
  TABLE_CLASSES,
  UUID_AGGREGATES,
  none,
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
 * The parser returns what the document says; the vocabularies are held HERE. Each case whose
 * rule lives in the document has been proven by breaking that rule in the document and
 * watching this case fail on an assertion, never on a parse error
 * (`scripts/verify-tenancy-contract-mutations.py`). The one that does not, "reads a Drizzle
 * schema that declares tables", keeps the two Drizzle cases from passing over nothing.
 */

const REPO_ROOT = fileURLToPath(new URL('../../', import.meta.url));
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

/** The principals §4.4 names as reaching the Run completion path. */
const COMPLETION_CALLERS = ['member', 'execution delegation', 'wait-timeout'] as const;

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
/** Whether `grants` hold `needed`: the same command, and for a narrow UPDATE its columns too. */
const covers = (grants: readonly Grant[], needed: Grant): boolean =>
  needed.command === 'UPDATE' && needed.columns !== null ? updates(grants, needed.columns) : has(grants, needed.command);

/** The projection and narration grants of §4.3, per table. */
const APPEND_SIDE_GRANTS: readonly (readonly [string, readonly string[]])[] = [
  ['public.run_interaction_command', ['SELECT', 'LOCK']],
  ['public.run_interaction_transition', ['SELECT', 'INSERT']],
  ['public.run_conversation_message', ['SELECT', 'INSERT']],
];

const repeated = <T>(values: readonly T[]): T[] => values.filter((value, index) => values.indexOf(value) !== index);
/** Both directions of a set comparison, each offender labelled. */
const difference = (actual: readonly string[], expected: readonly string[]): string[] => [
  ...expected.filter((value) => !actual.includes(value)).map((value) => `missing ${value}`),
  ...actual.filter((value) => !expected.includes(value)).map((value) => `extra ${value}`),
  ...repeated(actual).map((value) => `repeated ${value}`),
];
const SCHEMA_QUALIFIED = /^[^.\s]+\.[^\s]+$/;
/** Section text with emphasis and code marks removed, so a rule reads as one sentence. */
const plain = (heading: string): string =>
  sectionText(contract.markdown, heading).replace(/[*`]/g, '').replace(/\s+/g, ' ');

describe('tenancy-v1: the classification (§3)', () => {
  it('names each relation once', () => {
    none(repeated(contract.classification.map((row) => row.relation)));
  });

  it('writes every relation schema-qualified', () => {
    const relations = [...contract.classification, ...contract.completion, ...contract.inventory].map((row) => row.relation);
    none(relations.filter((relation) => !SCHEMA_QUALIFIED.test(relation)));
  });

  it('uses only the five class names', () => {
    none(contract.classification
      .filter((row) => !(TABLE_CLASSES as readonly string[]).includes(row.tableClass))
      .map((row) => `${row.relation}: ${row.tableClass}`));
  });

  it('reads a Drizzle schema that declares tables', () => {
    // An empty map would make the two Drizzle cases below pass over nothing at all.
    none(drizzleTables().size > 0 ? [] : ['no Drizzle table found in @intellifin/infrastructure/db']);
  });

  it('classifies every table the Drizzle schema declares', () => {
    none([...drizzleTables().keys()].filter((relation) => !classOf.has(relation)));
  });
});

describe('tenancy-v1: the policy inventory (§5)', () => {
  const inventoryRelations = contract.inventory.map((row) => row.relation);

  it('has exactly one row per protected table', () => {
    none(difference(inventoryRelations, protectedRelations));
  });

  it('gives no tenant policy to an authentication or infrastructure table', () => {
    none(inventoryRelations.filter((relation) => {
      const tableClass = classOf.get(relation);
      return tableClass === 'global authentication' || tableClass === 'platform infrastructure';
    }));
  });

  it('carries at least its class boundaries on every protected table', () => {
    none(contract.inventory.flatMap((row) => {
      const tableClass = classOf.get(row.relation);
      const required = tableClass !== undefined && isProtected(tableClass) ? PROTECTED_CLASS_BOUNDARIES[tableClass]! : [];
      const names = row.boundaries.map((boundary) => boundary.name);
      return required.filter((boundary) => !names.includes(boundary)).map((boundary) => `${row.relation}: ${boundary}`);
    }));
  });

  it('uses only tenant, client, engagement and owner as boundaries', () => {
    none(contract.inventory.flatMap((row) =>
      row.boundaries
        .filter((boundary) => !(BOUNDARIES as readonly string[]).includes(boundary.name))
        .map((boundary) => `${row.relation}: ${boundary.text}`)));
  });

  it('narrows only the owner boundary, and only to policy commands', () => {
    none(contract.inventory.flatMap((row) =>
      row.boundaries
        .filter((boundary) => boundary.commands !== null && (
          boundary.name !== 'owner' ||
          boundary.commands.length === 0 ||
          repeated(boundary.commands).length > 0 ||
          boundary.commands.some((command) => !(POLICY_COMMANDS as readonly string[]).includes(command))))
        .map((boundary) => `${row.relation}: ${boundary.text}`)));
  });

  it('names every UPDATE and DELETE a person holds in an owner boundary that names SELECT', () => {
    // `owner(SELECT)` also binds the reads an UPDATE, a DELETE, a RETURNING and a locking
    // read make, so leaving one of them out of the list would leave it half restricted.
    none(contract.inventory.flatMap((row) =>
      row.boundaries
        .filter((boundary) => boundary.name === 'owner' && boundary.commands?.includes('SELECT'))
        .flatMap((boundary) =>
          (['UPDATE', 'DELETE'] as const)
            .filter((command) => (has(row.member, command) || has(row.delegation, command)) && !boundary.commands!.includes(command))
            .map((command) => `${row.relation}: ${boundary.text} leaves out ${command}`))));
  });

  it('names each boundary at most once per row', () => {
    none(contract.inventory.flatMap((row) =>
      repeated(row.boundaries.map((boundary) => boundary.name)).map((name) => `${row.relation}: ${name}`)));
  });

  it('gives every user-owned table a bare owner boundary', () => {
    none(contract.inventory
      .filter((row) => classOf.get(row.relation) === 'user-owned')
      .filter((row) => !row.boundaries.some((boundary) => boundary.name === 'owner' && boundary.commands === null))
      .map((row) => row.relation));
  });

  it('grants only SELECT, INSERT, UPDATE, DELETE and LOCK', () => {
    none(contract.inventory.flatMap((row) =>
      cellsOf(row).flatMap(({ who, grants }) =>
        grants
          .filter((grant) => !(COMMANDS as readonly string[]).includes(grant.command))
          .map((grant) => `${row.relation} ${who}: ${grant.text}`))));
  });

  it('narrows only UPDATE to columns', () => {
    none(contract.inventory.flatMap((row) =>
      cellsOf(row).flatMap(({ who, grants }) =>
        grants
          .filter((grant) => grant.columns !== null && grant.command !== 'UPDATE')
          .map((grant) => `${row.relation} ${who}: ${grant.text}`))));
  });

  it('names only real columns in a narrow UPDATE', () => {
    const tables = drizzleTables();
    none(contract.inventory.flatMap((row) =>
      cellsOf(row).flatMap(({ who, grants }) =>
        grants.flatMap((grant) =>
          (grant.columns ?? [])
            .filter((column) => !(tables.get(row.relation) ?? []).includes(column))
            .map((column) => `${row.relation} ${who}: ${column === '' ? '(empty)' : column}`)))));
  });

  it('grants each command at most once per principal kind', () => {
    none(contract.inventory.flatMap((row) =>
      cellsOf(row).flatMap(({ who, grants }) =>
        repeated(grants.map((grant) => grant.command)).map((command) => `${row.relation} ${who}: ${command}`))));
  });

  it('grants SELECT wherever it grants UPDATE, DELETE or LOCK', () => {
    // A locking read needs the SELECT privilege; an UPDATE or a DELETE reads the rows it
    // changes (its WHERE, its RETURNING) and meets the SELECT policies too.
    none(contract.inventory.flatMap((row) =>
      cellsOf(row)
        .filter(({ grants }) => ['UPDATE', 'DELETE', 'LOCK'].some((command) => has(grants, command)) && !has(grants, 'SELECT'))
        .map(({ who }) => `${row.relation} ${who}`)));
  });

  it('lets some principal read every protected table', () => {
    none(contract.inventory
      .filter((row) => !cellsOf(row).some(({ grants }) => has(grants, 'SELECT')))
      .map((row) => row.relation));
  });
});

describe('tenancy-v1: the maintenance principals (§4.2)', () => {
  const entries = contract.inventory.flatMap((row) => row.maintenance.map((entry) => ({ row, entry })));

  it('names each maintenance principal once', () => {
    none(repeated(closedList));
  });

  it('names no maintenance principal after a principal kind', () => {
    none(closedList.filter((principal) => (PRINCIPAL_KINDS as readonly string[]).includes(principal)));
  });

  it('names only maintenance principals from the closed list', () => {
    none(entries
      .filter(({ entry }) => entry.principal !== null && !closedList.includes(entry.principal))
      .map(({ row, entry }) => `${row.relation}: ${entry.principal}`));
  });

  it('uses every maintenance principal of the closed list', () => {
    const granted = new Set(entries.filter(({ entry }) => entry.grants.length > 0).map(({ entry }) => entry.principal));
    none(closedList.filter((principal) => !granted.has(principal)));
  });

  it('D7: says which rows each maintenance principal may reach', () => {
    none(contract.principals
      .filter((row) => row.rowsItMayReach.trim() === '' || row.rowsItMayReach.trim() === '—')
      .map((row) => row.principal));
  });

  it('writes every maintenance entry as `principal`: COMMANDS', () => {
    none(entries.filter(({ entry }) => entry.principal === null).map(({ row, entry }) => `${row.relation}: ${entry.text}`));
  });

  it('grants at least one command in every maintenance entry', () => {
    none(entries.filter(({ entry }) => entry.grants.length === 0).map(({ row, entry }) => `${row.relation}: ${entry.text}`));
  });

  it('names each maintenance principal at most once per row', () => {
    none(contract.inventory.flatMap((row) =>
      repeated(row.maintenance.flatMap((entry) => (entry.principal === null ? [] : [entry.principal])))
        .map((principal) => `${row.relation}: ${principal}`)));
  });
});

describe('tenancy-v1: the audit append (§4.3)', () => {
  const appenders = contract.appenders;
  const isMaintenance = (principal: string): boolean => !(PRINCIPAL_KINDS as readonly string[]).includes(principal);
  /** The projection and narration grants a principal holds, each named. */
  const sideGrants = (principal: string, which: 'receipts' | 'narration' | 'both'): string[] =>
    APPEND_SIDE_GRANTS
      .filter(([relation]) => which === 'both' ||
        (which === 'narration') === (relation === 'public.run_conversation_message'))
      .flatMap(([relation, commands]) =>
        commands.filter((command) => has(grantsOf(relation, principal), command)).map((command) => `${principal}: ${command} on ${relation}`));

  it('names only known principals in the audit append', () => {
    const known = [...PRINCIPAL_KINDS, ...closedList];
    none(appenders.map((row) => row.principal).filter((principal) => !known.includes(principal)));
  });

  it('names each appending principal once', () => {
    none(repeated(appenders.map((row) => row.principal)));
  });

  it('names only the known aggregates', () => {
    none(appenders.flatMap((row) =>
      row.aggregates
        .filter((aggregate) => !(AGGREGATES as readonly string[]).includes(aggregate))
        .map((aggregate) => `${row.principal}: ${aggregate}`)));
  });

  it('answers yes or no for command receipts and narrated events', () => {
    none(appenders.flatMap((row) =>
      [row.commandReceipts, row.narratedEvents]
        .filter((answer) => answer !== 'yes' && answer !== 'no')
        .map((answer) => `${row.principal}: ${answer}`)));
  });

  it('answers yes to both for member and execution delegation', () => {
    none(PRINCIPAL_KINDS.flatMap((kind) => {
      const row = appenders.find((appender) => appender.principal === kind);
      if (row === undefined) return [`${kind}: not in the table`];
      return [row.commandReceipts, row.narratedEvents].some((answer) => answer !== 'yes') ? [`${kind}: ${row.commandReceipts}, ${row.narratedEvents}`] : [];
    }));
  });

  it('lists exactly the principals that insert into audit_events', () => {
    const events = rowOf('public.audit_events');
    const inserting = events === undefined ? [] : cellsOf(events).filter(({ grants }) => has(grants, 'INSERT')).map(({ who }) => who);
    none(difference(appenders.map((row) => row.principal), inserting));
  });

  it('gives every appending principal the head it locks and advances', () => {
    none(appenders
      .filter(({ principal }) => {
        const heads = grantsOf('public.audit_event_heads', principal);
        return !(has(heads, 'SELECT') && has(heads, 'INSERT') && has(heads, 'LOCK') &&
          updates(heads, ['last_sequence', 'last_event_hash']));
      })
      .map((row) => row.principal));
  });

  it('gives every appender of a UUID aggregate SELECT and LOCK on audit_run', () => {
    none(appenders
      .filter((row) => row.aggregates.some((aggregate) => (UUID_AGGREGATES as readonly string[]).includes(aggregate)))
      .filter(({ principal }) => {
        const run = grantsOf('public.audit_run', principal);
        return !(has(run, 'SELECT') && has(run, 'LOCK'));
      })
      .map((row) => row.principal));
  });

  it('gives every principal whose events carry a command receipt the projection grants', () => {
    none(appenders
      .filter((row) => row.commandReceipts === 'yes')
      .filter(({ principal }) => {
        const command = grantsOf('public.run_interaction_command', principal);
        const transition = grantsOf('public.run_interaction_transition', principal);
        return !(has(command, 'SELECT') && has(command, 'LOCK') && has(transition, 'SELECT') && has(transition, 'INSERT'));
      })
      .map((row) => row.principal));
  });

  it('gives every principal whose events are narrated the narration grants', () => {
    none(appenders
      .filter((row) => row.narratedEvents === 'yes')
      .filter(({ principal }) => {
        const message = grantsOf('public.run_conversation_message', principal);
        return !(has(message, 'SELECT') && has(message, 'INSERT'));
      })
      .map((row) => row.principal));
  });

  it('gives a maintenance principal marked no none of the projection or narration grants', () => {
    none(appenders.filter((row) => isMaintenance(row.principal)).flatMap((row) => [
      ...(row.commandReceipts === 'no' ? sideGrants(row.principal, 'receipts') : []),
      ...(row.narratedEvents === 'no' ? sideGrants(row.principal, 'narration') : []),
    ]));
  });

  it('gives a closed-list principal outside the audit append no projection or narration grant', () => {
    const appending = appenders.map((row) => row.principal);
    none(closedList.filter((principal) => !appending.includes(principal)).flatMap((principal) => sideGrants(principal, 'both')));
  });
});

describe('tenancy-v1: the Run completion path (§4.4)', () => {
  it('gives member, execution delegation and wait-timeout every command the completion path runs', () => {
    none(COMPLETION_CALLERS.flatMap((caller) =>
      contract.completion.flatMap((row) =>
        row.commands
          .filter((needed) => !covers(grantsOf(row.relation, caller), needed))
          .map((needed) => `${caller} on ${row.relation}: ${needed.text}`))));
  });
});

describe('tenancy-v1: the decisions (§7)', () => {
  const ids = contract.decisions.map((decision) => decision.id);
  const classes = (relations: readonly string[]): string[] =>
    relations.map((relation) => `${relation}: ${classOf.get(relation) ?? '(unclassified)'}`);
  const boundariesOf = (relation: string): string[] => (rowOf(relation)?.boundaries ?? []).map((b) => b.text);

  it('records exactly D1 to D7 and open decisions O1 to O9', () => {
    const expected = [...Array.from({ length: 7 }, (_, i) => `D${i + 1}`), ...Array.from({ length: 9 }, (_, i) => `O${i + 1}`)];
    none(difference(ids, expected));
  });

  it('names the story that settles every decision', () => {
    none(contract.decisions.filter((decision) => !/\bStor(?:y|ies) \d+\.\d+[a-z]?\b/.test(decision.text)).map((d) => d.id));
  });

  it('cites only decisions §7 records', () => {
    // §7 is scanned too, each bullet without its own leading id: a decision that points at
    // another one points at one that exists.
    const text = contract.markdown.split('\n').map((line) => line.replace(/^- \*\*[DO]\d+\./, '- **')).join('\n');
    const cited = [...new Set(text.match(/\b[DO][1-9]\d*\b/g) ?? [])];
    none(cited.filter((id) => !ids.includes(id)));
  });

  it('D1: classifies Procedures, registrations and bindings as client material', () => {
    none(classes(['public.procedure', 'public.target_system_registration', 'public.population_source_binding'])
      .filter((entry) => !entry.endsWith(': client/engagement-owned')));
  });

  it('D2: classifies procedure_change as client material', () => {
    none(classes(['public.procedure_change']).filter((entry) => !entry.endsWith(': client/engagement-owned')));
  });

  it('D3: keeps procedure_configuration platform infrastructure', () => {
    none(classes(['public.procedure_configuration']).filter((entry) => !entry.endsWith(': platform infrastructure')));
  });

  it('D4: keeps a client boundary beside the owner on run_initiation_request', () => {
    none([
      ...classes(['public.run_initiation_request']).filter((entry) => !entry.endsWith(': user-owned')),
      ...['client', 'owner'].filter((boundary) => !boundariesOf('public.run_initiation_request').includes(boundary))
        .map((boundary) => `public.run_initiation_request lacks ${boundary}`),
    ]);
  });

  it('D5: classifies user_role and user_permission_grant as tenant-owned', () => {
    none(classes(['public.user_role', 'public.user_permission_grant']).filter((entry) => !entry.endsWith(': tenant-owned')));
  });

  it('D6: restricts only reads of a notification to its owner, and every command elsewhere', () => {
    const expected: Record<string, string> = {
      'public.notification': 'owner(SELECT)',
      'public.evidence_read_grant': 'owner',
      'public.procedure_authoring_request': 'owner',
      'public.run_review_snapshot': 'owner',
      'public.run_review_snapshot_row': 'owner',
    };
    none(Object.entries(expected).flatMap(([relation, owner]) => {
      const actual = boundariesOf(relation).filter((text) => text.startsWith('owner'));
      return actual.length === 1 && actual[0] === owner ? [] : [`${relation}: ${actual.join(', ') || '(none)'}, expected ${owner}`];
    }));
  });
});

describe('tenancy-v1: the rules Story 11.4 builds policies from', () => {
  const states = (heading: string, sentence: string): string[] =>
    plain(heading).includes(sentence) ? [] : [`${heading} does not say: ${sentence}`];

  it('states that the inventory is scope, not capability', () => {
    none(states('## 1.', 'The inventory states scope, not capability.'));
  });

  it('states that a null scope column means the level above, never unrestricted', () => {
    none(states('## 2.', 'A null scope column means the level above, never unrestricted.'));
  });

  it('states that the inventory is derived from the production code\'s access paths', () => {
    none(states('## 5.', 'derived from the production code\'s access paths'));
  });

  it('states that the owner boundary applies to members and execution delegations only', () => {
    none(states('## 5.', 'applies to members and execution delegations only'));
  });

  it('states that a LOCK without UPDATE is an UPDATE policy whose WITH CHECK is false', () => {
    none(states('## 5.', 'a LOCK without UPDATE is built as an UPDATE policy whose WITH CHECK is false'));
  });
});

describe('tenancy-v1: the paths it cites', () => {
  /** Directories a partial path may resolve under; build output and dependencies are not code. */
  const ROOTS = ['apps', 'packages', 'scripts', 'tests', 'docs', '.github'];
  const SKIP = new Set(['node_modules', 'dist', '.next', '.turbo', 'coverage']);
  const FILE = /\.(?:ts|tsx|mts|mjs|cjs|js|sql|md|json|ya?ml|py|toml|sh)$/;

  const files = (): string[] => {
    const found: string[] = [];
    const walk = (relative: string): void => {
      for (const entry of readdirSync(join(REPO_ROOT, relative), { withFileTypes: true })) {
        if (SKIP.has(entry.name)) continue;
        const path = `${relative}/${entry.name}`;
        if (entry.isDirectory()) walk(path);
        else if (entry.isFile()) found.push(path);
      }
    };
    for (const root of ROOTS) if (existsSync(join(REPO_ROOT, root))) walk(root);
    return found;
  };

  it('cites only repository paths that exist', () => {
    const spans = contract.markdown.replace(/`` .*? ``/g, '').match(/`[^`\n]+`/g) ?? [];
    // A path has no whitespace; a span with a space is a command or a phrase, not a path.
    const cited = [...new Set(spans.map((span) => span.slice(1, -1)).filter((token) => !/\s/.test(token) && FILE.test(token)))];
    const known = files();
    none(cited.filter((token) => {
      const first = token.split('/')[0]!;
      const full = token.includes('/') && existsSync(join(REPO_ROOT, first)) && statSync(join(REPO_ROOT, first)).isDirectory();
      if (full) return !existsSync(join(REPO_ROOT, token));
      return !known.some((file) => file === token || file.endsWith(`/${token}`));
    }));
  });
});
