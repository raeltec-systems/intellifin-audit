import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

import type { EvidenceReadGrantSigner } from '@intellifin/application';

import type { EvidenceS3Config } from '../config.js';

/** The standard AWS SDK v3 presigner function, injected by the worker composition root. */
export interface S3GetUrlPresigner {
  getSignedUrl(
    client: S3Client,
    command: GetObjectCommand,
    options: { readonly expiresIn: number },
  ): Promise<string>;
}

export interface S3EvidenceReadSignerOptions {
  readonly bucket: string;
  readonly client: S3Client;
  /** Injected so this module never implements or copies AWS SigV4. */
  readonly presigner: S3GetUrlPresigner;
  readonly now?: () => Date;
}

function fixedInstant(value: Date): string {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) throw new Error('Evidence read signer clock failure');
  return value.toISOString();
}

function secondsUntil(expiresAt: string, now: Date): number {
  const expiry = Date.parse(expiresAt);
  const current = Date.parse(fixedInstant(now));
  if (!Number.isFinite(expiry) || expiry <= current) throw new Error('Evidence read signer capability expired');
  const seconds = Math.floor((expiry - current) / 1000);
  if (seconds < 1 || seconds > 300) throw new Error('Evidence read signer lifetime is outside the bound');
  return seconds;
}

/**
 * Worker-only adapter for a standard AWS SDK presigner.
 *
 * The S3 client and credentials remain in the worker. The application receives only the
 * resulting URL through its grant transaction, and that URL is consumed server-side before
 * a domain snapshot cell is rendered. Signing stays with the official AWS SDK presigner;
 * this adapter never reimplements or copies SigV4.
 */
export class S3EvidenceReadSigner implements EvidenceReadGrantSigner {
  private readonly now: () => Date;

  constructor(private readonly options: S3EvidenceReadSignerOptions) {
    if (options.bucket.trim() === '') throw new Error('Evidence read signer bucket is required');
    this.now = options.now ?? (() => new Date());
  }

  async signGet(input: { readonly bucketKey: string; readonly expiresAt: string }): Promise<{ readonly signedUrl: string; readonly signedUrlExpiresAt: string }> {
    if (typeof input.bucketKey !== 'string' || input.bucketKey.length === 0 || input.bucketKey.length > 1024 || input.bucketKey.startsWith('/') || input.bucketKey.split('/').some((segment) => segment === '' || segment === '.' || segment === '..')) {
      throw new Error('Evidence read signer received an invalid object key');
    }
    const now = this.now();
    const expiresIn = secondsUntil(input.expiresAt, now);
    const signedUrl = await this.options.presigner.getSignedUrl(
      this.options.client,
      new GetObjectCommand({ Bucket: this.options.bucket, Key: input.bucketKey }),
      { expiresIn },
    );
    if (typeof signedUrl !== 'string' || signedUrl.length === 0 || signedUrl.length > 4096) throw new Error('Evidence read signer returned an invalid URL');
    const signedUrlExpiresAt = new Date(Date.parse(fixedInstant(now)) + expiresIn * 1000).toISOString();
    return { signedUrl, signedUrlExpiresAt };
  }
}

/** Build the worker's signer around the same S3 configuration as EvidenceStore. */
export function createS3EvidenceReadSigner(
  config: EvidenceS3Config,
  client?: S3Client,
  now?: () => Date,
): S3EvidenceReadSigner {
  return new S3EvidenceReadSigner({
    bucket: config.bucket,
    client: client ?? new S3Client({
      region: config.region,
      endpoint: config.endpoint,
      forcePathStyle: config.forcePathStyle,
      credentials: { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey },
    }),
    // This is the AWS SDK v3 implementation, kept in the worker-only evidence subpath.
    // Tests can still inject S3GetUrlPresigner into S3EvidenceReadSigner directly.
    presigner: { getSignedUrl },
    now,
  });
}
