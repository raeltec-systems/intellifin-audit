import { readFile, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import openapiTS, { astToString } from 'openapi-typescript';

const source = new URL('../../openapi.json', import.meta.url);
const destination = new URL('../src/generated/api.ts', import.meta.url);
const check = process.argv.includes('--check');
const generated = spawnSync('cargo', ['run', '--quiet', '--locked', '-p', 'zobba-cli', '--', 'openapi'], {
  cwd: new URL('../../', import.meta.url),
  encoding: 'utf8',
  stdio: ['ignore', 'pipe', 'inherit'],
  maxBuffer: 1024 * 1024,
});
if (generated.error || generated.status !== 0) {
  console.error('Could not generate the owned API contract with the pinned Rust toolchain.');
  process.exit(1);
}
if (check) {
  if (await readFile(source, 'utf8').catch(() => '') !== generated.stdout) {
    console.error('OpenAPI is stale relative to the Rust source. Run pnpm api:generate from zobba/.');
    process.exit(1);
  }
} else {
  await writeFile(source, generated.stdout);
}
const output = `// Generated from zobba/openapi.json. Run pnpm api:generate; do not edit.\n${astToString(await openapiTS(source))}`;

if (check) {
  const current = await readFile(destination, 'utf8').catch(() => '');
  if (current !== output) {
    console.error('Generated API types are stale. Run pnpm api:generate from zobba/.');
    process.exitCode = 1;
  }
} else {
  await writeFile(destination, output);
}
