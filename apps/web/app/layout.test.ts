import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ identity: vi.fn(), count: vi.fn(), names: vi.fn(), captureError: vi.fn() }));
vi.mock('../src/server-session', () => ({ currentIdentity: mocks.identity }));
vi.mock('../src/bootstrap', () => ({ getRuntime: async () => ({ db: {}, telemetry: { captureError: mocks.captureError } }) }));
vi.mock('@intellifin/infrastructure', () => ({ DrizzleNotificationRepository: class {
  countOpenFor = mocks.count;
}, DrizzleActorNameReader: class {
  namesFor = mocks.names;
} }));
vi.mock('../src/shell/AppShell', () => ({ AppShell: (props: { unreadNotifications?: number; signedIn?: { userId: string; names: ReadonlyMap<string, string> } }) =>
  createElement('output', {
    'data-unread': props.unreadNotifications,
    'data-signed-in': props.signedIn?.userId,
    'data-signed-in-name': props.signedIn?.names.get(props.signedIn.userId),
  }, 'shell') }));
vi.mock('../src/design/EnvironmentRibbon', () => ({ EnvironmentRibbon: () => createElement('p', null, 'Synthetic environment') }));

import RootLayout from './layout';

describe('the application shell notification count', () => {
  const session = { sessionId: 'synthetic-session', userId: 'synthetic-auditor', expiresAt: '2030-01-01T00:00:00.000Z' };
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.identity.mockResolvedValue({ kind: 'identified', role: 'auditor', session });
    mocks.count.mockResolvedValue(137);
    mocks.names.mockResolvedValue(new Map([[session.userId, 'Dana Mwale']]));
  });

  it('supplies the authorized current count, including more than one inbox page, to the bell', async () => {
    const html = renderToStaticMarkup(await RootLayout({ children: 'page' }));
    expect(html).toContain('data-unread="137"');
    expect(mocks.count).toHaveBeenCalledExactlyOnceWith(session);
  });

  it.each(['anonymous', 'degraded'])('does not query notification data for an %s identity', async kind => {
    mocks.identity.mockResolvedValue({ kind });
    const html = renderToStaticMarkup(await RootLayout({ children: 'page' }));
    expect(mocks.count).not.toHaveBeenCalled();
    expect(html).not.toContain('data-unread');
  });

  it('keeps the shell available without inventing zero when the count cannot be read', async () => {
    const databaseError = new Error('synthetic private query', { cause: { parameters: ['synthetic-private-parameter'] } });
    mocks.count.mockRejectedValue(databaseError);
    const html = renderToStaticMarkup(await RootLayout({ children: 'page' }));
    expect(html).toContain('shell');
    expect(html).not.toContain('data-unread');
    expect(mocks.captureError).toHaveBeenCalledOnce();
    const reported = mocks.captureError.mock.calls[0]?.[1] as Error;
    expect(reported).not.toBe(databaseError);
    expect(reported.message).toBe('notification-count-query-failed');
    expect(reported.cause).toBeUndefined();
  });
});

/**
 * UX-01: the shell said nothing about whose session it was, on a product where the role
 * printed there decides whether Approve is yours to press. The name is read here because
 * the session carries an id and nothing else — an address cannot enter the audit chain.
 */
describe('the signed-in identity the shell names', () => {
  const session = { sessionId: 'synthetic-session', userId: 'synthetic-auditor', expiresAt: '2030-01-01T00:00:00.000Z' };
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.identity.mockResolvedValue({ kind: 'identified', role: 'auditor', session });
    mocks.count.mockResolvedValue(0);
    mocks.names.mockResolvedValue(new Map([[session.userId, 'Dana Mwale']]));
  });

  it('resolves the session user through the one id-to-name port and hands it to the shell', async () => {
    const html = renderToStaticMarkup(await RootLayout({ children: 'page' }));
    expect(mocks.names).toHaveBeenCalledExactlyOnceWith([session.userId]);
    expect(html).toContain('data-signed-in="synthetic-auditor"');
    expect(html).toContain('data-signed-in-name="Dana Mwale"');
  });

  it.each(['anonymous', 'degraded'])('names nobody, and reads no name, for an %s identity', async kind => {
    mocks.identity.mockResolvedValue({ kind });
    const html = renderToStaticMarkup(await RootLayout({ children: 'page' }));
    expect(mocks.names).not.toHaveBeenCalled();
    expect(html).not.toContain('data-signed-in=');
  });

  it('still names the session, by id, when the name cannot be read', async () => {
    // The shell must not go blank over a cosmetic read: `ActorName` shows the id, which
    // is honest about what is known. The failure is still recorded.
    mocks.names.mockRejectedValue(new Error('synthetic private query'));
    const html = renderToStaticMarkup(await RootLayout({ children: 'page' }));
    expect(html).toContain('data-signed-in="synthetic-auditor"');
    expect(html).not.toContain('data-signed-in-name');
    expect(mocks.captureError).toHaveBeenCalledOnce();
    expect(mocks.captureError.mock.calls[0]?.[0]).toBe('Signed-in name could not be read');
  });
});
