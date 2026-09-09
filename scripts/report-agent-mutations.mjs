// Mirror the already-sanitized synthetic mutation artifacts into durable job logs.
// Read data only: this reporter never applies a patch or evaluates report contents.
import { readFile } from 'node:fs/promises';
import { basename } from 'node:path';

for (const path of process.argv.slice(2)) {
  let bytes;
  try { bytes = await readFile(path, 'utf8'); }
  catch (error) {
    if (error.code !== 'ENOENT') throw error;
    process.stdout.write(`AGENT_MUTATION_REPORT_MISSING ${basename(path)}\n`);
    continue;
  }
  const report = JSON.parse(bytes);
  // A single JSON line escapes fixture text, ANSI bytes and workflow-command syntax.
  process.stdout.write(`AGENT_MUTATION_REPORT ${JSON.stringify({ file: basename(path), report })}\n`);
}
