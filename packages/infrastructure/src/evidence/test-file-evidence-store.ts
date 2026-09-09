import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { isAbsolute, relative, resolve } from 'node:path';
import {
  PopulationAcquisitionError,
  type EvidenceStore,
} from '@intellifin/application';

import { EVIDENCE_STORE_MAX_BYTES } from './s3-evidence-store.js';

/**
 * Explicit local backend for deterministic tests only.
 *
 * This module is intentionally not exported from the infrastructure package barrel and
 * is never selected by runtime configuration. Production composition must use
 * {@link import('./s3-evidence-store.js').S3EvidenceStore}.
 */
export class FileEvidenceStore implements EvidenceStore {
  constructor(
    private readonly root: string,
    private readonly maxBytes: number = EVIDENCE_STORE_MAX_BYTES,
  ) {
    if (!isAbsolute(root) || !Number.isSafeInteger(maxBytes) || maxBytes <= 0 || maxBytes > EVIDENCE_STORE_MAX_BYTES) {
      throw new PopulationAcquisitionError('contract');
    }
  }

  async read(key: string, timeoutMs: number): Promise<Uint8Array | null> {
    const path = this.pathFor(key);
    const signal = deadline(timeoutMs);
    try {
      const bytes = new Uint8Array(await readFile(path, { signal: signal.signal }));
      if (bytes.byteLength > this.maxBytes) throw new PopulationAcquisitionError('integrity');
      return bytes;
    } catch (error) {
      if (error instanceof PopulationAcquisitionError) throw error;
      if (isMissing(error)) return null;
      throw new PopulationAcquisitionError('transport');
    } finally {
      signal.controller.abort();
      clearTimeout(signal.timer);
    }
  }

  async putIfAbsent(key: string, bytes: Uint8Array, timeoutMs: number): Promise<void> {
    if (!(bytes instanceof Uint8Array) || bytes.byteLength > this.maxBytes) {
      throw new PopulationAcquisitionError('contract');
    }
    const path = this.pathFor(key);
    const timer = deadline(timeoutMs);
    try {
      await mkdir(resolve(path, '..'), { recursive: true });
      try {
        await writeFile(path, bytes, { flag: 'wx', signal: timer.signal });
      } catch (error) {
        if (!isAlreadyExists(error)) throw error;
        const existing = new Uint8Array(await readFile(path, { signal: timer.signal }));
        if (!equalBytes(existing, bytes)) throw new PopulationAcquisitionError('integrity');
        return;
      }
      const stored = new Uint8Array(await readFile(path, { signal: timer.signal }));
      if (!equalBytes(stored, bytes)) throw new PopulationAcquisitionError('integrity');
    } catch (error) {
      if (error instanceof PopulationAcquisitionError) throw error;
      if (timer.signal.aborted) throw new PopulationAcquisitionError('transport');
      throw new PopulationAcquisitionError('transport');
    } finally {
      timer.controller.abort();
      clearTimeout(timer.timer);
    }
  }

  private pathFor(key: string): string {
    if (typeof key !== 'string' || key.length === 0 || key.length > 1024 || key.startsWith('/')) {
      throw new PopulationAcquisitionError('contract');
    }
    const path = resolve(this.root, key);
    const outside = relative(resolve(this.root), path);
    if (outside === '' || outside.startsWith('..') || isAbsolute(outside) || key.split('/').some((part) => part === '' || part === '.' || part === '..')) {
      throw new PopulationAcquisitionError('contract');
    }
    return path;
  }
}

function deadline(timeoutMs: number): {
  readonly controller: AbortController;
  readonly signal: AbortSignal;
  readonly timer: ReturnType<typeof setTimeout>;
} {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0 || timeoutMs > 2 ** 31 - 1) {
    throw new PopulationAcquisitionError('contract');
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return { controller, signal: controller.signal, timer };
}

function isMissing(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as NodeJS.ErrnoException).code === 'ENOENT';
}

function isAlreadyExists(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as NodeJS.ErrnoException).code === 'EEXIST';
}

function equalBytes(left: Uint8Array, right: Uint8Array): boolean {
  if (left.byteLength !== right.byteLength) return false;
  let difference = 0;
  for (let index = 0; index < left.byteLength; index += 1) difference |= left[index]! ^ right[index]!;
  return difference === 0;
}
