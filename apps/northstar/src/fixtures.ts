import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Reading the synthetic Northstar fixtures off disk (AD-12).
 *
 * The datasets are DATA and they are read as data: this module opens files, it does not
 * `import` them. A JSON import would be bundled into whatever compiled this module, and
 * the point of `fixtures/northstar/` is that one folder holds the populations and one
 * generator writes the counts — not that a copy of them is baked into an application.
 *
 * Nothing here evaluates anything. This application serves what the fixtures say; the
 * expectations under `fixtures/northstar/expectations/` are read by tests and by people,
 * and by nothing that produces a Result.
 */

/** Every dataset and every generated file says this about itself (NFR-13). */
export const SYNTHETIC_MARKER = 'SYNTHETIC-NORTHSTAR-FIXTURE';

/**
 * Find `fixtures/northstar` by walking up from this module.
 *
 * The same source runs from `src/` under Vitest and from `dist/` under `node`, and the
 * two sit at different depths, so a fixed `../../..` is wrong in one of them. Walking up
 * for a directory that exists is right in both. `NORTHSTAR_FIXTURES_DIR` overrides it for
 * a deployment that puts the fixtures somewhere else.
 */
export function findFixturesRoot(startDir: string = dirname(fileURLToPath(import.meta.url))): string {
  const override = process.env['NORTHSTAR_FIXTURES_DIR'];
  if (override !== undefined && override !== '') {
    const absolute = resolve(override);
    if (!existsSync(join(absolute, 'datasets'))) {
      throw new Error(`NORTHSTAR_FIXTURES_DIR="${override}" holds no datasets directory`);
    }
    return absolute;
  }
  let directory = resolve(startDir);
  // Stop at the filesystem root: `dirname('/')` is `'/'`, so the loop must compare.
  for (;;) {
    const candidate = join(directory, 'fixtures', 'northstar');
    if (existsSync(join(candidate, 'datasets'))) return candidate;
    const parent = dirname(directory);
    if (parent === directory) {
      throw new Error(
        'could not find fixtures/northstar above ' +
          `${startDir}. Set NORTHSTAR_FIXTURES_DIR to the folder that holds datasets/.`,
      );
    }
    directory = parent;
  }
}

const ROOT = findFixturesRoot();

export const FIXTURES_ROOT = ROOT;

/** A parsed dataset or generated JSON file. Read once and kept: these files never change
 * while the process runs, and re-reading per request would make a response's cost a
 * property of the disk rather than of the data. */
const jsonCache = new Map<string, unknown>();
const byteCache = new Map<string, Buffer>();

function readJson(relativePath: string): unknown {
  const cached = jsonCache.get(relativePath);
  if (cached !== undefined) return cached;
  const parsed: unknown = JSON.parse(readFileSync(join(ROOT, relativePath), 'utf8'));
  assertSyntheticMarker(relativePath, parsed);
  jsonCache.set(relativePath, parsed);
  return parsed;
}

/**
 * Refuse a fixture that does not say it is synthetic (NFR-13).
 *
 * At load, not only in a test: a test proves the files in the repository carry the marker,
 * and this proves the files this PROCESS is serving do. A deployment that mounted a real
 * export over the fixtures folder would otherwise serve it.
 */
export function assertSyntheticMarker(relativePath: string, value: unknown): void {
  const marker = (value as { synthetic?: { marker?: unknown } } | null)?.synthetic?.marker;
  if (marker !== SYNTHETIC_MARKER) {
    throw new Error(
      `${relativePath} does not carry the synthetic marker "${SYNTHETIC_MARKER}". ` +
        'Northstar refuses to serve a file that does not say it is synthetic.',
    );
  }
}

/** The bytes of a generated artifact, exactly as the generator wrote them. */
export function readGeneratedBytes(fileName: string): Buffer {
  const cached = byteCache.get(fileName);
  if (cached !== undefined) return cached;
  const bytes = readFileSync(join(ROOT, 'generated', fileName));
  if (!bytes.includes(SYNTHETIC_MARKER)) {
    throw new Error(
      `generated/${fileName} does not carry the synthetic marker "${SYNTHETIC_MARKER}".`,
    );
  }
  byteCache.set(fileName, bytes);
  return bytes;
}

export interface SyntheticBlock {
  readonly marker: string;
  readonly organization: string;
  readonly statement: string;
}

export interface LeaversRow {
  readonly employee_id: string;
  readonly full_name: string;
  readonly department: string;
  readonly employment_status: string;
  readonly termination_effective_date: string;
  readonly manager: string;
}

export interface LeaversExport {
  readonly synthetic: SyntheticBlock;
  readonly title: string;
  readonly generation: string;
  readonly declared_schema: readonly string[];
  readonly rows: readonly LeaversRow[];
}

export type LoanCoreBehaviour =
  | 'normal'
  | 'render-failure'
  | 'system-failure'
  | 'different-employee'
  | 'value-only-in-filter'
  | 'transcription-distractor'
  | 'partial-pagination'
  | 'ambiguous-candidates';

export interface LoanCoreAccount {
  readonly employee_id: string;
  readonly full_name: string;
  readonly account_id: string;
  readonly username: string;
  readonly status: string;
  readonly roles: readonly string[];
  readonly last_login: string;
  readonly disabled_time: string;
  readonly page_behaviour: LoanCoreBehaviour;
  readonly page_note: string;
  readonly serves_page_of?: string;
  readonly reported_match_count?: number;
  readonly listed_match_count?: number;
  readonly candidate_usernames?: readonly string[];
}

export interface LoanCoreDataset {
  readonly synthetic: SyntheticBlock;
  readonly title: string;
  readonly generation: string;
  readonly declared_attribute_labels: Readonly<Record<string, string>>;
  readonly accounts: readonly LoanCoreAccount[];
}

export interface AccessGateAccount {
  readonly account_id: string;
  readonly employee_id: string;
  readonly username: string;
  readonly status: string;
  readonly roles: readonly string[];
  readonly disabled_time: string;
}

export interface AccessGateDataset {
  readonly synthetic: SyntheticBlock;
  readonly title: string;
  readonly generation: string;
  readonly declared_schema: readonly string[];
  readonly population_rule: string;
  readonly accounts: readonly AccessGateAccount[];
}

export interface ApprovalRow {
  readonly approval_id: string;
  readonly transaction_id: string;
  readonly decision: string;
  readonly decided_at: string;
  readonly approver: string;
  readonly approver_limit: string;
  readonly currency: string;
}

export interface ApproveNowDataset {
  readonly synthetic: SyntheticBlock;
  readonly title: string;
  readonly generation: string;
  readonly declared_schema: readonly string[];
  readonly approvals: readonly ApprovalRow[];
}

export interface EmployeeRow {
  readonly employee_id: string;
  readonly full_name: string;
  readonly employment_status: string;
  readonly termination_effective_time: string;
}

export interface PeopleHubDataset {
  readonly synthetic: SyntheticBlock;
  readonly title: string;
  readonly generation: string;
  readonly declared_schema: readonly string[];
  readonly employees: readonly EmployeeRow[];
}

export interface TransactionRow {
  readonly transaction_id: string;
  readonly amount: string;
  readonly currency: string;
  readonly initiator: string;
  readonly processed_time: string;
  readonly approval_id: string;
  readonly memo: string;
}

export interface LedgerFlowDataset {
  readonly synthetic: SyntheticBlock;
  readonly title: string;
  readonly generation: string;
  readonly declared_schema: readonly string[];
  readonly transactions: readonly TransactionRow[];
}

export interface ObservedParameter {
  readonly parameter: string;
  readonly observed_value: string;
  readonly description: string;
}

export interface ProdConsoleDataset {
  readonly synthetic: SyntheticBlock;
  readonly title: string;
  readonly generation: string;
  readonly snapshot: {
    readonly snapshot_id: string;
    readonly taken_at: string;
    readonly signature_scheme: string;
    readonly signature_key_id: string;
  };
  readonly observed_parameters: readonly ObservedParameter[];
}

export interface EffectivePeriod {
  readonly from: string;
  readonly to: string;
}

/**
 * A generated count declaration, served verbatim by a count endpoint.
 *
 * The older ProdConsole and LoanCore pages still consume `declared_count`. API
 * population declarations carry the v1 fields below as well; keeping the old
 * field is a compatibility alias for those existing synthetic surfaces, not a
 * second source of truth.
 */
export interface CountDeclaration {
  readonly synthetic: SyntheticBlock;
  readonly source: string;
  readonly generation: string;
  readonly declared_count: number;
  readonly counted_from: string;
  readonly count_rule: string;
  readonly produced_by: string;
  readonly schema_version?: 1;
  readonly representation?: 'population-rows-v1';
  readonly generated_at?: string;
  readonly effective_period?: EffectivePeriod;
  readonly schema?: readonly string[];
  readonly count?: number;
  readonly sha256?: string;
  readonly complete?: boolean;
}

/** The normalized v1 declaration used by API population adapters. */
export interface ApiPopulationDeclaration extends CountDeclaration {
  readonly schema_version: 1;
  readonly representation: 'population-rows-v1';
  readonly generated_at: string;
  readonly effective_period: EffectivePeriod;
  readonly schema: readonly string[];
  readonly count: number;
  readonly sha256: string;
  readonly complete: true;
}

export const datasets = {
  leavers: (): LeaversExport => readJson('datasets/leavers-export.json') as LeaversExport,
  loancore: (): LoanCoreDataset => readJson('datasets/loancore-accounts.json') as LoanCoreDataset,
  accessgate: (): AccessGateDataset =>
    readJson('datasets/accessgate-accounts.json') as AccessGateDataset,
  approvenow: (): ApproveNowDataset =>
    readJson('datasets/approvenow-approvals.json') as ApproveNowDataset,
  peoplehub: (): PeopleHubDataset =>
    readJson('datasets/peoplehub-employees.json') as PeopleHubDataset,
  ledgerflow: (): LedgerFlowDataset =>
    readJson('datasets/ledgerflow-transactions.json') as LedgerFlowDataset,
  prodconsole: (): ProdConsoleDataset =>
    readJson('datasets/prodconsole-parameters.json') as ProdConsoleDataset,
} as const;

export function countDeclaration(fileName: string): CountDeclaration {
  return readJson(`generated/${fileName}`) as CountDeclaration;
}

export function apiDeclaration(fileName: string): ApiPopulationDeclaration {
  const declaration = countDeclaration(fileName);
  if (
    declaration.schema_version !== 1 ||
    declaration.representation !== 'population-rows-v1' ||
    typeof declaration.generated_at !== 'string' ||
    declaration.effective_period === undefined ||
    !Array.isArray(declaration.schema) ||
    typeof declaration.count !== 'number' ||
    typeof declaration.sha256 !== 'string' ||
    declaration.complete !== true
  ) {
    throw new Error(`generated/${fileName} is not a population-rows-v1 declaration`);
  }
  return declaration as ApiPopulationDeclaration;
}
