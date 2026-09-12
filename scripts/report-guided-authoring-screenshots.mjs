// Retain a small, explicit set of synthetic UI captures in CI logs as well as the
// standard Playwright artifact. This lets a remote reviewer inspect the actual PNG
// bytes when their environment cannot download the signed artifact URL.
import { readdir, readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';

const selected = [
  'chat-streaming-response', 'chat-conversation-desktop', 'chat-conversation-mobile',
  'dialogue-control-confirmation', 'dialogue-scope-question', 'dialogue-system-choice', 'dialogue-test-intent-mobile',
  'guided-preparation-mobile', 'owner-objective-proposal-before-acceptance',
  'owner-auditor-full-procedure-review', 'owner-manager-revised-procedure-review',
  'writing-stale-suggestion', 'writing-clarification',
  'test-design-intent-revision', 'test-design-intent-mobile',
  'owner-seeded-template-selection',
  'fresh-dialogue-control', 'fresh-dialogue-scope', 'fresh-dialogue-systems',
  'fresh-dialogue-revision', 'fresh-dialogue-mobile', 'fresh-dialogue-plan',
];
const found = new Set();
async function visit(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true }).catch(() => [])) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) await visit(path);
    // Only isolated synthetic authoring journeys; expose their bounded failure
    // context when a remote reviewer cannot download the retained ZIP artifact.
    if (entry.isFile() && entry.name === 'error-context.md' && /(?:owner-walkthrough|guided-dialogue|writing-assistant|hero-workflow)/.test(path)) {
      const context = await readFile(path, 'utf8');
      process.stdout.write(`GUIDED_FAILURE_CONTEXT ${path}\n${context.slice(0, 24_000)}\nGUIDED_FAILURE_END\n`);
    }
    if (!entry.isFile() || !entry.name.endsWith('.png')) continue;
    const name = selected.find(name => entry.name.startsWith(name));
    if (!name || found.has(name)) continue;
    const bytes = await readFile(path);
    if (bytes.length > 2_000_000 || !bytes.subarray(0, 8).equals(Buffer.from('89504e470d0a1a0a', 'hex'))) throw new Error('Unexpected guided authoring capture');
    found.add(name);
    const encoded = bytes.toString('base64'), sha256 = createHash('sha256').update(bytes).digest('hex');
    process.stdout.write(`GUIDED_PNG_BEGIN ${name} ${bytes.length} ${sha256}\n`);
    for (let offset = 0; offset < encoded.length; offset += 12000) process.stdout.write(`GUIDED_PNG_DATA ${encoded.slice(offset, offset + 12000)}\n`);
    process.stdout.write(`GUIDED_PNG_END ${name}\n`);
  }
}
await visit('test-results');
await visit('guided-test-results');
process.stdout.write(`Guided authoring captures available: ${[...found].join(', ') || 'none; inspect test failures'}\n`);
