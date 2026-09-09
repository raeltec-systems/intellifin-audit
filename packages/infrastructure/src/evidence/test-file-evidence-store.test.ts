import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { FileEvidenceStore } from './test-file-evidence-store.js';

const roots: string[] = [];

afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
});

async function store(maxBytes?: number): Promise<FileEvidenceStore> {
  const root = await mkdtemp(join(tmpdir(), 'intellifin-evidence-test-'));
  roots.push(root);
  return new FileEvidenceStore(root, maxBytes);
}

describe('FileEvidenceStore (explicit test backend)', () => {
  it('writes once, reads bytes, and reconciles an identical retry', async () => {
    const evidence = await store();
    const bytes = new TextEncoder().encode('test evidence');
    await evidence.putIfAbsent('run/raw', bytes, 1000);
    await evidence.putIfAbsent('run/raw', bytes, 1000);
    expect(await evidence.read('run/raw', 1000)).toEqual(bytes);
  });

  it('refuses a conflicting retry and path traversal', async () => {
    const evidence = await store();
    await evidence.putIfAbsent('run/raw', new Uint8Array([1]), 1000);
    await expect(evidence.putIfAbsent('run/raw', new Uint8Array([2]), 1000)).rejects.toMatchObject({ code: 'integrity' });
    await expect(evidence.read('../outside', 1000)).rejects.toMatchObject({ code: 'contract' });
  });

  it('enforces its explicit bounded test storage size', async () => {
    const evidence = await store(2);
    await expect(evidence.putIfAbsent('run/raw', new Uint8Array([1, 2, 3]), 1000)).rejects.toMatchObject({ code: 'contract' });
  });
});
