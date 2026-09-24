import { describe, expect, it } from 'vitest';
import { ConversationContentCipher } from './conversation-content.js';

describe('governed conversation content', () => {
  const cipher = new ConversationContentCipher('ab'.repeat(32));
  it('encrypts randomized content and binds it to its exact Run/message', () => {
    const body = 'Synthetic account question: why is record A an exception?';
    const first = cipher.seal('run-a', 'message-a', body);
    const second = cipher.seal('run-a', 'message-a', body);
    expect(first).not.toBe(second);
    expect(first).not.toContain(body);
    expect(cipher.open('run-a', 'message-a', first)).toBe(body);
    expect(() => cipher.open('run-b', 'message-a', first)).toThrow('could not be verified');
    expect(() => cipher.open('run-a', 'message-b', first)).toThrow('could not be verified');
  });
  it('refuses changed bytes, malformed envelopes and the wrong key without echoing content', () => {
    const sealed = cipher.seal('run', 'message', 'synthetic-private-text');
    const bytes = Buffer.from(sealed.slice(3), 'base64url');
    bytes[28] = bytes[28]! ^ 1;
    for (const value of [`v1.${bytes.toString('base64url')}`, 'v2.invalid', 'v1.a', 'v1.!!!!']) {
      expect(() => cipher.open('run', 'message', value)).toThrow('Conversation content could not be verified');
    }
    const other = new ConversationContentCipher('cd'.repeat(32));
    expect(() => other.open('run', 'message', sealed)).toThrow('could not be verified');
    expect(() => new ConversationContentCipher('short')).toThrow('key is unavailable');
  });
  it('bounds storage before encryption while preserving Unicode content', () => {
    const body = '🔎'.repeat(4000);
    expect(cipher.open('r', 'm', cipher.seal('r', 'm', body))).toBe(body);
    expect(() => cipher.seal('r', 'm', 'a'.repeat(65537))).toThrow('exceeds its bound');
  });
});
