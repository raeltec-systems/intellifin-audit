import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';


describe('the compile-time half of the allowlist', () => {
  it('types the logger so an undocumented field cannot be written silently', () => {
    // `sanitizeTelemetryFields` drops an unknown key at run time, which is right — but
    // with `fields?: unknown` nothing stopped a caller writing one, and the line was
    // emitted with the value gone. It happened twice: the probe sweep logged every count
    // removed, and the migrator's refusal lost its reason. Read off disk, because the
    // defect is in a TYPE and there is nothing to execute.
    const source = readFileSync(
      fileURLToPath(new URL('./logger.ts', import.meta.url)),
      'utf8',
    ).replace(/\/\*[\s\S]*?\*\//g, '');
    expect(source).not.toContain('fields?: unknown');
    expect(source).toContain('fields?: TelemetryFields');
  });
});
