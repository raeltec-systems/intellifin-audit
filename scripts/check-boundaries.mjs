#!/usr/bin/env node
// AD-1 boundary check with a liveness guard.
//
// dependency-cruiser exits 0 when it cruises zero modules, which happens when its
// TypeScript peer is unusable (TypeScript >= 7 today). A silently empty cruise is a
// dead check, so this wrapper runs the cruise in JSON mode, refuses an empty result,
// and prints every violation as `error <rule>: <from> → <to>`.
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

const args = process.argv.slice(2);
// On Windows `pnpm` is a .CMD shim that spawnSync cannot exec directly, and running
// it through a shell mangles the JSON report. Call corepack's pnpm.js with this same
// Node instead. Everywhere else keep the plain PATH lookup the CI gate already uses.
const corepackCandidates =
  process.platform === 'win32'
    ? [
        join(dirname(process.execPath), 'node_modules', 'corepack', 'dist', 'pnpm.js'),
        resolve(dirname(process.execPath), '..', 'lib', 'node_modules', 'corepack', 'dist', 'pnpm.js'),
      ]
    : [];
const corepackPnpm = corepackCandidates.find(existsSync);
const command = corepackPnpm ? process.execPath : 'pnpm';
const commandArgs = [
  ...(corepackPnpm ? [corepackPnpm] : []),
  'exec',
  'depcruise',
  '--config',
  '.dependency-cruiser.cjs',
  '--no-cache',
  '--output-type',
  'json',
  ...args,
  'apps',
  'packages',
];
const result = spawnSync(
  command,
  commandArgs,
  {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    shell: process.platform === 'win32' && !corepackPnpm,
  },
);

let report;
try {
  report = JSON.parse(result.stdout);
} catch {
  process.stderr.write(`boundaries: dependency-cruiser produced no JSON report\n${result.stderr}\n`);
  process.exit(2);
}

const { totalCruised, violations, error, warn } = report.summary;
if (totalCruised === 0) {
  process.stderr.write(
    'boundaries: dependency-cruiser cruised 0 modules; the check is dead. Is the root typescript pin one dependency-cruiser supports (< 7)?\n',
  );
  process.exit(2);
}

for (const v of violations) {
  process.stdout.write(`${v.rule.severity} ${v.rule.name}: ${v.from} → ${v.to}\n`);
}
if (error > 0) {
  process.stdout.write(`x ${violations.length} dependency violations (${error} errors, ${warn} warnings). ${totalCruised} modules cruised.\n`);
  process.exit(1);
}
process.stdout.write(`✔ no dependency violations found (${totalCruised} modules cruised${warn ? `, ${warn} warnings` : ''})\n`);
