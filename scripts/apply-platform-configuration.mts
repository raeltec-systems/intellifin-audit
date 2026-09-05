#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
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
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (!process.env.DATABASE_URL || !process.argv[2]) throw new Error('Set DATABASE_URL and pass a configuration JSON file.');
  const count = await applyConfigurationFile(process.env.DATABASE_URL, process.argv[2]);
  process.stdout.write(`Configuration applied; ${count} platform Drafts recorded for this revision.\n`);
}
