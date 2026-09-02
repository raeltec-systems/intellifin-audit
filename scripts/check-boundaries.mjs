#!/usr/bin/env node
// AD-1 boundary check with a liveness guard.
//
// dependency-cruiser exits 0 when it cruises zero modules, which happens when its
// TypeScript peer is unusable (TypeScript >= 7 today). A silently empty cruise is a
// dead check, so this wrapper runs the cruise in JSON mode, refuses an empty result,
// and prints every violation as `error <rule>: <from> → <to>`.
import { spawnSync } from 'node:child_process';

const args = process.argv.slice(2);
const result = spawnSync(
  'pnpm',
  ['exec', 'depcruise', '--config', '.dependency-cruiser.cjs', '--no-cache', '--output-type', 'json', ...args, 'apps', 'packages'],
  { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
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
