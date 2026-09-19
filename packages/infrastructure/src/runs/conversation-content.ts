import { createCipheriv, createDecipheriv, createHmac, randomBytes } from 'node:crypto';

/** Governed message content is separate from immutable audit/message metadata.
 * A dedicated deployment key is required: never reuse a credential or identity secret.
 * Rotation/removal policy remains a real-data admission gate, not a guessed retention TTL.
 */
export class ConversationContentCipher {
  private readonly key: Buffer;

  constructor(keyHex: string) {
    if (!/^[a-f0-9]{64}$/i.test(keyHex)) throw new Error('Conversation content key is unavailable');
    this.key = Buffer.from(keyHex, 'hex');
  }

  seal(runId: string, messageId: string, content: string): string {
    if (Buffer.byteLength(content, 'utf8') > 65536) throw new Error('Conversation content exceeds its bound');
    const nonce = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, nonce);
    cipher.setAAD(Buffer.from(JSON.stringify(['run-conversation', 1, runId, messageId])));
    const bytes = Buffer.concat([cipher.update(content, 'utf8'), cipher.final()]);
    return `v1.${Buffer.concat([nonce, cipher.getAuthTag(), bytes]).toString('base64url')}`;
  }

  /** Private-key semantic binding; detected secrets are refused before this is called. */
  fingerprint(semanticPayload: string): string {
    return createHmac('sha256', this.key).update('run-conversation-idempotency-v1\0').update(semanticPayload).digest('hex');
  }

  open(runId: string, messageId: string, sealed: string): string {
    try {
      if (!/^v1\.[A-Za-z0-9_-]+$/.test(sealed) || sealed.length > 90000) throw new Error();
      const encoded = sealed.slice(3);
      const bytes = Buffer.from(encoded, 'base64url');
      if (bytes.length < 28 || bytes.toString('base64url') !== encoded) throw new Error();
      const decipher = createDecipheriv('aes-256-gcm', this.key, bytes.subarray(0, 12));
      decipher.setAAD(Buffer.from(JSON.stringify(['run-conversation', 1, runId, messageId])));
      decipher.setAuthTag(bytes.subarray(12, 28));
      return Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]).toString('utf8');
    } catch {
      // No ciphertext, plaintext, key or OpenSSL details in telemetry/error responses.
      throw new Error('Conversation content could not be verified');
    }
  }
}
