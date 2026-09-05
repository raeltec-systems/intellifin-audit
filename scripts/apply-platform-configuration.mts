#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { applyPlatformConfiguration, type PlatformConfigurationInput } from '@intellifin/application';
import { createDb, createSqlClient, CryptoUuidV7Generator, PostgresProceduresUnitOfWork } from '@intellifin/infrastructure';

/** Release entry point: explicit JSON revision, separate from runtime startup and migration. */
export async function applyConfigurationFile(databaseUrl: string, filename: string): Promise<number> {
  const input = JSON.parse(await readFile(filename, 'utf8')) as PlatformConfigurationInput;
  if (!input || typeof input !== 'object' || Object.keys(input).some(key => !['revision', 'model', 'interpreterContract', 'changeKind'].includes(key))) throw new Error('Configuration file contains unsupported fields.');
  const client = createSqlClient(databaseUrl, { max: 1 });
  try {
    const db = createDb(client);
    const versions = await applyPlatformConfiguration({ unitOfWork: new PostgresProceduresUnitOfWork(db), ids: new CryptoUuidV7Generator() }, input);
    return versions.length;
  } finally { await client.end(); }
}
// `import.meta.main`, never an `argv[1]` comparison: through a symlink (pnpm's
// node_modules, any `--prod deploy` tree) the two paths differ, the module loads, does
// nothing and exits 0 — a release step reporting success for a publication that never
// happened. See CLAUDE.md (Story 1.8) and `db/migrate.ts`, which guard the same way.
const isEntryPoint = import.meta.main;
if (isEntryPoint) {
  if (!process.env.DATABASE_URL || !process.argv[2]) throw new Error('Set DATABASE_URL and pass a configuration JSON file.');
  const count = await applyConfigurationFile(process.env.DATABASE_URL, process.argv[2]);
  process.stdout.write(`Configuration applied; ${count} platform Drafts recorded for this revision.\n`);
}
