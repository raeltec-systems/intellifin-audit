#!/usr/bin/env node
/**
 * Create one user and assign one role. Operator-run, never automatic.
 *
 * Story 1.5 owns managing users from the interface. Until it exists somebody has to
 * be able to sign in, and the two ways of arranging that which are NOT acceptable are
 * seeding at process startup (AD-15 keeps data changes out of boot, and a seeded
 * account nobody asked for is a standing credential) and committing a password.
 * So this is a script an operator runs by hand, with the password supplied by them.
 *
 * Usage, from the repository root. `pnpm build` FIRST: this script runs under plain
 * `node`, which resolves `@intellifin/*` through each package's `default` export
 * condition -- their built `dist`, not their TypeScript source. On a fresh clone that
 * folder does not exist and the import fails before any argument is read.
 *
 *   pnpm build
 *   DATABASE_URL=postgres://... BETTER_AUTH_SECRET=... BETTER_AUTH_URL=http://localhost:3000 \
 *   SEED_PASSWORD='<chosen password>' \
 *   pnpm seed:identity --email person@example.com --name 'Full Name' --role auditor
 *
 * The password comes from `SEED_PASSWORD` and is never accepted as an argument: an
 * argument lands in the shell history and in the process table.
 *
 * Re-running for an existing address only re-assigns the role; it never resets a
 * password. Pass `--create-only true` to refuse an existing address instead, which is
 * what any caller taking the address from free text must do.
 */
import { ROLES, isRole, type Role } from '@intellifin/domain';
import {
  createDb,
  createSeedAuth,
  createSqlClient,
  findUserIdByEmail,
} from '@intellifin/infrastructure';

interface Args {
  readonly email: string;
  readonly name: string;
  readonly role: Role;
  /**
   * Refuse an address that already has an account, instead of re-asserting its role.
   *
   * The default is the original behaviour and is what the three fixed demo addresses
   * want: re-running must not lock anybody out, and re-asserting a role is harmless when
   * the address is a constant in the script that seeds it. It is NOT harmless when the
   * address is free text somebody types: this command can assign `poc-administrator`, so
   * without this flag a dispatcher could name an existing account and elevate it in place
   * — an account whose password was printed to a workflow summary when it was created.
   * Found by Codex on PR 40.
   */
  readonly createOnly: boolean;
}

function fail(message: string): never {
  process.stderr.write(`seed-identity: ${message}\n`);
  process.exit(1);
}

function parseArgs(argv: readonly string[]): Args {
  const values = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 2) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!key?.startsWith('--') || value === undefined) {
      fail(`expected --key value pairs, found "${key ?? ''}"`);
    }
    values.set(key.slice(2), value);
  }
  const email = values.get('email');
  const name = values.get('name');
  const role = values.get('role');
  // A pair, not a bare flag: the parser above walks `--key value` two at a time, and a
  // valueless flag would silently consume the next option as its value.
  const createOnly = values.get('create-only');
  if (!email) fail('--email is required');
  if (!name) fail('--name is required');
  if (!isRole(role)) fail(`--role must be one of ${ROLES.join(', ')}`);
  if (createOnly !== undefined && createOnly !== 'true' && createOnly !== 'false') {
    fail('--create-only must be true or false');
  }
  return { email, name, role, createOnly: createOnly === 'true' };
}

/** Named so the failure says what to do, instead of a bare module-resolution stack. */
const MISSING_BUILD_HINT =
  'run `pnpm build` first: this script imports the workspace packages\' built output';

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const databaseUrl = process.env['DATABASE_URL'];
  const secret = process.env['BETTER_AUTH_SECRET'];
  const baseUrl = process.env['BETTER_AUTH_URL'];
  const password = process.env['SEED_PASSWORD'];

  if (!databaseUrl) fail('DATABASE_URL is required');
  if (!secret) fail('BETTER_AUTH_SECRET is required');
  if (!baseUrl) fail('BETTER_AUTH_URL is required');
  if (!password) fail('SEED_PASSWORD is required (never pass a password as an argument)');

  const sql = createSqlClient(databaseUrl, { max: 2 });
  const db = createDb(sql);
  // Sign-up is disabled on the running application on purpose. This script is the
  // administrative path, so it uses the seed instance, which enables it in this
  // process alone and does not sign the new account in.
  const auth = createSeedAuth(db, { secret, baseUrl });

  try {
    let userId = await findUserIdByEmail(db, args.email);

    if (userId === null) {
      const created = await auth.api.signUpEmail({
        body: { email: args.email, name: args.name, password },
      });
      userId = created.user.id;
      process.stdout.write(`created user ${userId}\n`);
    } else if (args.createOnly) {
      // Refused BEFORE the role upsert below, which is the whole point: the role must not
      // move for an account this command did not create.
      fail(`--create-only was given and ${args.email} already has an account; nothing was changed`);
    } else {
      process.stdout.write(`user ${userId} already exists; leaving the password alone\n`);
    }

    // `assigned_by` stays null: no administrator assigned this one, an operator did.
    // Story 1.5 fills it in with the acting administrator's user id.
    await sql`
      INSERT INTO user_role (user_id, role, assigned_by)
      VALUES (${userId}, ${args.role}, NULL)
      ON CONFLICT (user_id) DO UPDATE
        SET role = EXCLUDED.role, assigned_at = now(), assigned_by = NULL
    `;
    process.stdout.write(`assigned role ${args.role}\n`);

    const rows = await sql<{ role: string }[]>`
      SELECT role FROM user_role WHERE user_id = ${userId}
    `;
    process.stdout.write(`user_role now holds ${rows[0]?.role ?? '(nothing)'}\n`);
  } finally {
    await sql.end({ timeout: 5 }).catch(() => undefined);
  }
}

await main().catch((error: unknown) => {
  if (error instanceof Error && /Cannot find module|ERR_MODULE_NOT_FOUND/.test(error.message)) {
    fail(`${error.message}\n  hint: ${MISSING_BUILD_HINT}`);
  }
  throw error;
});
