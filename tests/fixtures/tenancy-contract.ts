import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/**
 * The one reader of `docs/contracts/tenancy-v1.md` (Story 11.1).
 *
 * Two tests hold the contract: the inventory test (unit, over the document and the Drizzle
 * schema) and the unclassified-table test (integration, over the migrated database). Both
 * read the document through this module, so the two cannot disagree about what a row says.
 *
 * It throws only on a STRUCTURAL problem: a missing section, a table with the wrong header
 * or the wrong number of cells, or table rows after a blank line or a line of text — a table
 * interrupted like that would otherwise drop the rows below the gap out of every check with
 * every test green. Everything else is returned exactly as written. A class nobody defined,
 * a command such as `TRUNCATE`, a principal outside the closed list or a malformed entry is
 * a value the inventory test refuses BY NAME: a parser that threw on it would turn each of
 * those rules into a collection error that names no rule at all.
 */

export const CONTRACT_PATH = fileURLToPath(
  new URL('../../docs/contracts/tenancy-v1.md', import.meta.url),
);

/** The five classes, spelled exactly as the planning documents spell them. */
export const TABLE_CLASSES = [
  'tenant-owned',
  'user-owned',
  'client/engagement-owned',
  'global authentication',
  'platform infrastructure',
] as const;

/** The classes that get a tenant policy, and the boundaries each always carries. */
export const PROTECTED_CLASS_BOUNDARIES: Readonly<Record<string, readonly string[]>> = {
  'tenant-owned': ['tenant'],
  'user-owned': ['tenant', 'owner'],
  'client/engagement-owned': ['tenant', 'client', 'engagement'],
};

export const BOUNDARIES = ['tenant', 'client', 'engagement', 'owner'] as const;

/**
 * The four SQL commands, and `LOCK`: a locking read (`FOR UPDATE`, `FOR NO KEY UPDATE`,
 * `FOR SHARE`, `FOR KEY SHARE`). PostgreSQL grants a locking read only with the SELECT
 * privilege and the UPDATE privilege on a column, and applies the SELECT and UPDATE
 * policies' `USING`, although nothing changes, so it is a grant of its own.
 */
export const COMMANDS = ['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'LOCK'] as const;

/** The two principal kinds that are not named maintenance principals (§4.1). */
export const PRINCIPAL_KINDS = ['member', 'execution delegation'] as const;

/** The aggregates of §4.3; the last four are UUIDs, so the append locks `audit_run` for them. */
export const AGGREGATES = ['platform', 'Procedure', 'Run', 'registration', 'binding'] as const;
export const UUID_AGGREGATES = ['Procedure', 'Run', 'registration', 'binding'] as const;

const NONE = '—';

export interface ClassificationRow {
  readonly relation: string;
  readonly tableClass: string;
  readonly why: string;
}

export interface PrincipalRow {
  readonly principal: string;
  readonly authority: string;
  readonly rowsItMayReach: string;
  readonly runsTodayAs: string;
}

export interface AppenderRow {
  readonly principal: string;
  readonly aggregates: readonly string[];
  readonly commandReceipts: string;
  readonly narratedEvents: string;
}

/** One command of a cell, as written: `SELECT`, or `UPDATE(a, b)` with its columns. */
export interface Grant {
  readonly text: string;
  readonly command: string;
  readonly columns: readonly string[] | null;
}

/** One `` `principal`: COMMANDS `` entry; `principal` is null when the entry has another shape. */
export interface MaintenanceEntry {
  readonly text: string;
  readonly principal: string | null;
  readonly grants: readonly Grant[];
}

/** One boundary of a row, as written: `owner`, or `owner(SELECT)` with the commands it restricts. */
export interface BoundaryToken {
  readonly text: string;
  readonly name: string;
  readonly commands: readonly string[] | null;
}

export interface InventoryRow {
  readonly relation: string;
  readonly boundaries: readonly BoundaryToken[];
  readonly member: readonly Grant[];
  readonly delegation: readonly Grant[];
  readonly maintenance: readonly MaintenanceEntry[];
}

export interface Decision {
  readonly id: string;
  readonly text: string;
}

export interface TenancyContract {
  readonly markdown: string;
  readonly classification: readonly ClassificationRow[];
  readonly principals: readonly PrincipalRow[];
  readonly appenders: readonly AppenderRow[];
  readonly inventory: readonly InventoryRow[];
  readonly decisions: readonly Decision[];
}

const HEADING = /^(#{1,6}) /;

/** One pair of enclosing backticks removed, if the value has them. */
const unquote = (value: string): string =>
  value.length >= 2 && value.startsWith('`') && value.endsWith('`') ? value.slice(1, -1) : value;

/**
 * The lines of the section whose heading starts with `heading` (`## 5.`, `### 4.2`), up to
 * the next heading of the same or a higher level. Exactly one heading must match.
 */
function sectionLines(markdown: string, heading: string): { readonly first: number; readonly lines: string[] } {
  const all = markdown.split('\n');
  const starts = all.flatMap((line, index) =>
    line === heading || line.startsWith(`${heading} `) ? [index] : []);
  if (starts.length !== 1) {
    throw new Error(`tenancy-v1: expected one section headed "${heading}", found ${starts.length}`);
  }
  const start = starts[0]!;
  const level = HEADING.exec(all[start]!)?.[1]?.length ?? 0;
  const lines: string[] = [];
  for (const line of all.slice(start + 1)) {
    const next = HEADING.exec(line);
    if (next !== null && next[1]!.length <= level) break;
    lines.push(line);
  }
  return { first: start + 2, lines };
}

/** The text of one section, for the rules the contract states in prose. */
export function sectionText(markdown: string, heading: string): string {
  return sectionLines(markdown, heading).lines.join('\n');
}

/**
 * The body rows of the one table in a section. The header must be exactly `header`, every
 * row must have its cell count, and the table must be contiguous: a row after a blank line
 * or a line of text is refused, never skipped.
 */
function tableIn(markdown: string, heading: string, header: readonly string[]): string[][] {
  const { first, lines } = sectionLines(markdown, heading);
  const rows: string[][] = [];
  let state: 'before' | 'separator' | 'body' | 'after' = 'before';
  lines.forEach((line, index) => {
    const at = `"${heading}" line ${first + index}`;
    if (!line.startsWith('|')) {
      if (state === 'separator') throw new Error(`tenancy-v1: ${at}: a table header with no separator row`);
      if (state === 'body') state = 'after';
      return;
    }
    if (state === 'after') {
      throw new Error(`tenancy-v1: ${at}: a table row after a blank line or text; the table must be contiguous`);
    }
    if (!line.trimEnd().endsWith('|')) throw new Error(`tenancy-v1: ${at}: a table row must end with "|"`);
    const cells = line.trimEnd().split('|').slice(1, -1).map((cell) => cell.trim());
    if (cells.length !== header.length) {
      throw new Error(`tenancy-v1: ${at}: ${cells.length} cells, expected ${header.length}`);
    }
    if (state === 'before') {
      if (cells.join(' | ') !== header.join(' | ')) {
        throw new Error(`tenancy-v1: ${at}: header "${cells.join(' | ')}", expected "${header.join(' | ')}"`);
      }
      state = 'separator';
      return;
    }
    if (state === 'separator') {
      if (!cells.every((cell) => /^:?-{3,}:?$/.test(cell))) throw new Error(`tenancy-v1: ${at}: expected a separator row`);
      state = 'body';
      return;
    }
    rows.push(cells);
  });
  if (state === 'before') throw new Error(`tenancy-v1: "${heading}" has no table`);
  if (state === 'separator') throw new Error(`tenancy-v1: "${heading}": a table header with no separator row`);
  return rows;
}

/**
 * Splits on `separator` where it is not inside parentheses. Never throws: an unbalanced
 * parenthesis leaves the rest as one part, which then fails a vocabulary rule by name.
 */
function splitTopLevel(text: string, separator: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = '';
  for (const character of text) {
    if (character === '(') depth += 1;
    if (character === ')') depth = Math.max(0, depth - 1);
    if (character === separator && depth === 0) {
      parts.push(current.trim());
      current = '';
      continue;
    }
    current += character;
  }
  parts.push(current.trim());
  return parts;
}

/** `NAME` or `NAME(a, b)`, as written; anything else comes back whole as its own name. */
function nameAndList(text: string): { readonly name: string; readonly list: readonly string[] | null } {
  const match = /^([^()]*)\((.*)\)$/s.exec(text);
  if (match === null) return { name: text, list: null };
  return { name: match[1]!.trim(), list: match[2]!.split(',').map((item) => unquote(item.trim())) };
}

export function parseGrants(cell: string): Grant[] {
  if (cell === NONE) return [];
  return splitTopLevel(cell, ',').map((text) => {
    const { name, list } = nameAndList(text);
    return { text, command: name, columns: list };
  });
}

export function parseMaintenance(cell: string): MaintenanceEntry[] {
  if (cell === NONE) return [];
  return splitTopLevel(cell, ';').map((text) => {
    const match = /^`([^`]+)`\s*:\s*(.*)$/s.exec(text);
    if (match === null) return { text, principal: null, grants: [] };
    return { text, principal: match[1]!, grants: parseGrants(match[2]!.trim()) };
  });
}

export function parseBoundaries(cell: string): BoundaryToken[] {
  return splitTopLevel(cell, ',').map((text) => {
    const { name, list } = nameAndList(text);
    return { text, name, commands: list };
  });
}

const DECISION = /^- \*\*([DO]\d+)\.\s/;

export function parseTenancyContract(markdown: string): TenancyContract {
  const classification = tableIn(markdown, '## 3.', ['Relation', 'Class', 'Why']).map(
    ([relation, tableClass, why]) => ({ relation: unquote(relation!), tableClass: tableClass!, why: why! }),
  );

  const principals = tableIn(markdown, '### 4.2', ['Principal', 'Authority', 'Rows it may reach', 'Runs today as']).map(
    ([principal, authority, rowsItMayReach, runsTodayAs]) => ({
      principal: unquote(principal!),
      authority: authority!,
      rowsItMayReach: rowsItMayReach!,
      runsTodayAs: runsTodayAs!,
    }),
  );

  const appenders = tableIn(markdown, '### 4.3', ['Principal', 'Aggregates', 'Command receipts', 'Narrated events']).map(
    ([principal, aggregates, commandReceipts, narratedEvents]) => ({
      principal: unquote(principal!),
      aggregates: splitTopLevel(aggregates!, ',').map(unquote),
      commandReceipts: commandReceipts!,
      narratedEvents: narratedEvents!,
    }),
  );

  const inventory = tableIn(markdown, '## 5.', ['Table', 'Boundaries', 'Member', 'Execution delegation', 'Maintenance principals']).map(
    ([relation, boundaries, member, delegation, maintenance]) => ({
      relation: unquote(relation!),
      boundaries: parseBoundaries(boundaries!),
      member: parseGrants(member!),
      delegation: parseGrants(delegation!),
      maintenance: parseMaintenance(maintenance!),
    }),
  );

  const decisions = sectionLines(markdown, '## 7.').lines.flatMap((line) => {
    const match = DECISION.exec(line);
    return match === null ? [] : [{ id: match[1]!, text: line }];
  });

  return { markdown, classification, principals, appenders, inventory, decisions };
}

export function readTenancyContract(path: string = CONTRACT_PATH): TenancyContract {
  return parseTenancyContract(readFileSync(path, 'utf8'));
}
