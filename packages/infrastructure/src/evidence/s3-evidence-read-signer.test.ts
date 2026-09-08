import { describe, expect, it } from 'vitest';

import type { S3Client } from '@aws-sdk/client-s3';

import { S3EvidenceReadSigner, type S3GetUrlPresigner } from './s3-evidence-read-signer.js';

const NOW = new Date('2026-09-07T00:00:00.000Z');

describe('S3EvidenceReadSigner', () => {
  it('delegates exact GET signing to the injected standard SDK presigner', async () => {
    const calls: { bucket?: string; key?: string; expiresIn?: number } = {};
    const presigner: S3GetUrlPresigner = {
      getSignedUrl: async (_client, command, options) => {
        calls.bucket = command.input.Bucket;
        calls.key = command.input.Key;
        calls.expiresIn = options.expiresIn;
        return 'https://objects.invalid/bucket/object?X-Amz-Signature=opaque';
      },
    };
    const signer = new S3EvidenceReadSigner({
      bucket: 'evidence',
      client: {} as S3Client,
      presigner,
      now: () => NOW,
    });
    await expect(signer.signGet({
      bucketKey: 'runs/run/evidence/snapshot',
      expiresAt: '2026-09-07T00:05:00.000Z',
    })).resolves.toEqual({
      signedUrl: 'https://objects.invalid/bucket/object?X-Amz-Signature=opaque',
      signedUrlExpiresAt: '2026-09-07T00:05:00.000Z',
    });
    expect(calls).toEqual({ bucket: 'evidence', key: 'runs/run/evidence/snapshot', expiresIn: 300 });
  });

  it.each(['', '/leading', 'runs//empty', 'runs/../escape', 'runs/./dot'])('refuses unsafe object key %s', async (bucketKey) => {
    const presigner: S3GetUrlPresigner = { getSignedUrl: async () => 'https://objects.invalid' };
    const signer = new S3EvidenceReadSigner({ bucket: 'evidence', client: {} as S3Client, presigner, now: () => NOW });
    await expect(signer.signGet({ bucketKey, expiresAt: '2026-09-07T00:05:00.000Z' })).rejects.toThrow('invalid object key');
  });

  it('refuses expiry outside the five minute bound', async () => {
    const presigner: S3GetUrlPresigner = { getSignedUrl: async () => 'https://objects.invalid' };
    const signer = new S3EvidenceReadSigner({ bucket: 'evidence', client: {} as S3Client, presigner, now: () => NOW });
    await expect(signer.signGet({ bucketKey: 'runs/run/object', expiresAt: '2026-09-07T00:05:01.000Z' })).rejects.toThrow('outside the bound');
    await expect(signer.signGet({ bucketKey: 'runs/run/object', expiresAt: '2026-09-06T23:59:59.000Z' })).rejects.toThrow('expired');
  });
});
