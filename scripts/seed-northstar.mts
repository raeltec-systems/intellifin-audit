#!/usr/bin/env node
/**
 * Register the synthetic Northstar systems and their Population Sources.
 *
 * **Through the commands, never through SQL.** `registerTargetSystem` and
 * `registerPopulationSource` do the authorization check, the read-only credential proof,
 * the digest and the audit append in one transaction each — so a seeded row is audited
 * exactly like one a PoC Administrator typed, and a seeded row that could not be audited
 * does not exist. An `INSERT` here would have produced nine registrations that FR-45 has
 * no record of, which is the state the whole of Story 1.6 exists to prevent.
 *
 * Operator-run, never automatic (AD-15 keeps data changes out of boot). Re-running is
 * safe: a system already registered under the same display name is left alone rather than
 * re-registered, because a second registration would mint a second digest for one system.
 *
 * Usage, from the repository root. `pnpm build` FIRST: this script runs under plain
 * `node`, which resolves `@intellifin/*` through each package's `default` export
 * condition — their built `dist`, not their TypeScript source.
 *
 *   pnpm build
 *   DATABASE_URL=postgres://... \
 *   CREDENTIAL_CAPABILITIES='{"cred://synthetic/northstar-readonly":"read-only"}' \
 *   NORTHSTAR_BASE_URL=http://localhost:4300 \
 *   pnpm seed:northstar --admin-email administrator@example.test
 *
 * `CREDENTIAL_CAPABILITIES` is a DECLARATION and holds no secret — a reference and a
 * verdict. Without it every registration is refused, which is the fail-closed direction:
 * a deployment that has vouched for nothing must not be able to register anything.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import {
  MANAGE_BINDINGS_ACTION,
  MANAGE_REGISTRATIONS_ACTION,
  registerPopulationSource,
  registerTargetSystem,
  type BindingFields,
  type RegistrationFields,
} from '@intellifin/application';
import {
  isDeclaredCountMechanism,
  isPermittedReadAction,
  isPopulationSourceKind,
  isTargetSystemKind,
} from '@intellifin/domain';
import {
  CryptoUuidV7Generator,
  DrizzleBindingRepository,
  DrizzleRegistrationRepository,
  DrizzleRoleRepository,
  ManifestCredentialProvider,
  PostgresRegistrationsUnitOfWork,
  PostgresSourcesUnitOfWork,
  TimerDeadline,
  createDb,
  createSqlClient,
  findUserIdByEmail,
  parseCredentialCapabilities,
} from '@intellifin/infrastructure';

const SYNTHETIC_MARKER = 'SYNTHETIC-NORTHSTAR-FIXTURE';

/** Where the systems catalogue lives, relative to the repository root. */
const CATALOGUE = fileURLToPath(
  new URL('../fixtures/northstar/datasets/systems.json', import.meta.url),
);

interface TargetSystemDeclaration {
  readonly id: string;
  readonly display_name: string;
  readonly kind: string;
  readonly origin_path: string;
  readonly permitted_actions: readonly string[];
  readonly attribute_label_patterns: readonly string[];
  readonly secondary_key: string;
  readonly note: string;
}

interface BindingDeclaration {
  readonly id: string;
  readonly display_name: string;
  readonly kind: string;
  readonly location_path: string | null;
  readonly declared_schema: readonly string[];
  readonly declared_count_mechanism: string;
  readonly sensitive_fields: readonly string[];
  readonly note: string;
}

interface Catalogue {
  readonly synthetic: { readonly marker: string };
  readonly target_systems: readonly TargetSystemDeclaration[];
  readonly population_source_bindings: readonly BindingDeclaration[];
}

function fail(message: string): never {
  process.stderr.write(`seed-northstar: ${message}\n`);
  process.exit(1);
}

function say(message: string): void {
  process.stdout.write(`${message}\n`);
}

function parseArgs(argv: readonly string[]): { readonly adminEmail: string } {
  const values = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (key?.startsWith('--') !== true || value === undefined) {
      fail(`expected --key value pairs, found "${key ?? ''}"`);
    }
    values.set(key.slice(2), value);
  }
  const adminEmail = values.get('admin-email');
  if (adminEmail === undefined || adminEmail === '') fail('--admin-email is required');
  return { adminEmail };
}

function readCatalogue(): Catalogue {
  const parsed = JSON.parse(readFileSync(CATALOGUE, 'utf8')) as Catalogue;
  if (parsed.synthetic.marker !== SYNTHETIC_MARKER) {
    fail(`${CATALOGUE} does not carry the synthetic marker; refusing to register from it`);
  }
  return parsed;
}

/**
 * One process serves every surface, so an allowed origin here is a base URL that INCLUDES
 * the path prefix. Nothing downstream cares: a registration's origins are opaque strings
 * that the probe and the agent both treat as a base to fetch.
 */
function origin(base: string, path: string): string {
  return `${base.replace(/\/+$/, '')}${path}`;
}

async function main(): Promise<void> {
  const { adminEmail } = parseArgs(process.argv.slice(2));
  const databaseUrl = process.env['DATABASE_URL'];
  const base = process.env['NORTHSTAR_BASE_URL'] ?? 'http://localhost:4300';
  const credentialRef =
    process.env['NORTHSTAR_CREDENTIAL_REF'] ?? 'cred://synthetic/northstar-readonly';
  const declared = parseCredentialCapabilities(process.env['CREDENTIAL_CAPABILITIES'] ?? '{}');

  if (databaseUrl === undefined || databaseUrl === '') fail('DATABASE_URL is required');
  if (declared === null) fail('CREDENTIAL_CAPABILITIES is not a JSON object of reference to verdict');
  if (declared.get(credentialRef) !== 'read-only') {
    // Refused here with an instruction rather than left to the command, which would answer
    // the verbatim FR-8 sentence nine times and say nothing about what to do.
    fail(
      `the credential reference "${credentialRef}" is not declared read-only. ` +
        `Set CREDENTIAL_CAPABILITIES='{"${credentialRef}":"read-only"}'.`,
    );
  }
  try {
    new URL(base);
  } catch {
    fail(`NORTHSTAR_BASE_URL="${base}" is not a URL`);
  }

  const catalogue = readCatalogue();
  const sql = createSqlClient(databaseUrl, { max: 2 });
  const db = createDb(sql);

  try {
    const userId = await findUserIdByEmail(db, adminEmail);
    if (userId === null) {
      fail(`no user has the address ${adminEmail}. Run pnpm seed:identity first.`);
    }
    const roles = new DrizzleRoleRepository(db);
    const role = await roles.findRole(userId);
    if (role !== 'poc-administrator') {
      // The command would refuse anyway and audit the refusal. Saying so first means the
      // operator reads one sentence instead of fifteen audited denials.
      fail(
        `${adminEmail} holds the role ${role ?? '(none)'}, which may not perform ` +
          `${MANAGE_REGISTRATIONS_ACTION} or ${MANAGE_BINDINGS_ACTION}.`,
      );
    }

    const session = { userId, sessionId: 'seed-northstar' } as const;
    const ids = new CryptoUuidV7Generator();
    const registrationDeps = {
      roles,
      credentials: new ManifestCredentialProvider(declared),
      deadlines: new TimerDeadline(),
      unitOfWork: new PostgresRegistrationsUnitOfWork(db),
      ids,
    };
    const bindingDeps = { roles, unitOfWork: new PostgresSourcesUnitOfWork(db), ids };

    const existingSystems = new Set(
      (await new DrizzleRegistrationRepository(db).listRegistrations()).map(
        (registration) => registration.displayName,
      ),
    );
    const existingBindings = new Set(
      (await new DrizzleBindingRepository(db).listBindings()).map((binding) => binding.displayName),
    );

    let registered = 0;
    let bound = 0;

    for (const system of catalogue.target_systems) {
      if (existingSystems.has(system.display_name)) {
        say(`target system "${system.display_name}" already registered; leaving it alone`);
        continue;
      }
      if (!isTargetSystemKind(system.kind)) fail(`${system.id}: "${system.kind}" is not a system kind`);
      const actions = system.permitted_actions.filter(isPermittedReadAction);
      if (actions.length !== system.permitted_actions.length) {
        fail(`${system.id}: names an action that is not a permitted read action`);
      }
      const fields: RegistrationFields = {
        displayName: system.display_name,
        kind: system.kind,
        allowedOrigins: [origin(base, system.origin_path)],
        applicationIdentity: '',
        credentialRef,
        permittedActions: actions,
        attributeLabelPatterns: [...system.attribute_label_patterns],
        secondaryKey: system.secondary_key,
        note: system.note,
        status: 'active',
      };
      const result = await registerTargetSystem(registrationDeps, {
        ...fields,
        session,
        // The prefix is the provenance: every event this script appends is findable, and
        // an operator-seeded registration is distinguishable from one a person typed.
        correlationId: `seed-northstar:${system.id}`,
        // An operator script, not a person at a browser. The chain is immutable, so the
        // one field that says where an action came from has to say what happened.
        source: 'platform',
      });
      if (!result.ok) fail(`${system.id}: ${result.reason}`);
      registered += 1;
      say(`registered ${system.display_name} (${system.kind}) digest ${result.digest}`);
    }

    for (const binding of catalogue.population_source_bindings) {
      if (existingBindings.has(binding.display_name)) {
        say(`binding "${binding.display_name}" already registered; leaving it alone`);
        continue;
      }
      if (!isPopulationSourceKind(binding.kind)) fail(`${binding.id}: "${binding.kind}" is not a binding kind`);
      if (!isDeclaredCountMechanism(binding.declared_count_mechanism)) {
        fail(`${binding.id}: "${binding.declared_count_mechanism}" is not a count mechanism`);
      }
      const fields: BindingFields = {
        displayName: binding.display_name,
        kind: binding.kind,
        // A manual upload has no location: the file arrives with the Run.
        location: binding.location_path === null ? '' : origin(base, binding.location_path),
        declaredSchema: [...binding.declared_schema],
        declaredCountMechanism: binding.declared_count_mechanism,
        sensitiveFields: [...binding.sensitive_fields],
        note: binding.note,
        status: 'active',
      };
      const result = await registerPopulationSource(bindingDeps, {
        ...fields,
        session,
        correlationId: `seed-northstar:${binding.id}`,
        source: 'platform',
      });
      if (!result.ok) fail(`${binding.id}: ${result.reason}`);
      bound += 1;
      say(`bound ${binding.display_name} (${binding.kind}) digest ${result.digest}`);
    }

    say(
      `seeded ${String(registered)} target systems and ${String(bound)} population source bindings ` +
        `against ${base}`,
    );
  } finally {
    await sql.end({ timeout: 5 }).catch(() => undefined);
  }
}

const MISSING_BUILD_HINT =
  "run `pnpm build` first: this script imports the workspace packages' built output";

await main().catch((error: unknown) => {
  if (error instanceof Error && /Cannot find module|ERR_MODULE_NOT_FOUND/.test(error.message)) {
    fail(`${error.message}\n  hint: ${MISSING_BUILD_HINT}`);
  }
  throw error;
});
