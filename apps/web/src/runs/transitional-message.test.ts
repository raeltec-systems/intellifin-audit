import { describe, expect, it } from 'vitest';

import { settleMessage } from './transitional-message';

// UI cleanup 2026-09-22, UX-49. "Pause requested." stayed beside a confirmed "Paused by …"
// banner because nothing told the control that the transition it announced had settled.
// The browser half — the message really disappearing after the server re-read — is in
// `tests/e2e/pause-resume.spec.ts`; this is the rule itself.
describe('a transitional control message', () => {
  const requested = { key: 'false|false', message: 'Pause requested.' };

  it('stays while the Run state it was written about still holds', () => {
    expect(settleMessage(requested, 'false|false')).toBe(requested);
  });

  it('is dropped once the server reads the pause as requested', () => {
    expect(settleMessage(requested, 'false|true')).toEqual({ key: 'false|true', message: null });
  });

  it('is dropped once the worker has honoured the pause', () => {
    expect(settleMessage(requested, 'true|false')).toEqual({ key: 'true|false', message: null });
  });

  it('keeps a refusal whose Run state did not move, because nothing settled it', () => {
    const refused = { key: 'false|false', message: 'The pause could not be confirmed.' };
    expect(settleMessage(refused, 'false|false').message).toBe('The pause could not be confirmed.');
  });
});
