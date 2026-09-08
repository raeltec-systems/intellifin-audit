import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ identity: vi.fn(), count: vi.fn(), captureError: vi.fn() }));
vi.mock('../src/server-session', () => ({ currentIdentity: mocks.identity }));
vi.mock('../src/bootstrap', () => ({ getRuntime: async () => ({ db: {}, telemetry: { captureError: mocks.captureError } }) }));
vi.mock('@intellifin/infrastructure', () => ({ DrizzleNotificationRepository: class {
  countOpenFor = mocks.count;
} }));
vi.mock('../src/shell/AppShell', () => ({ AppShell: (props: { unreadNotifications?: number }) =>
  createElement('output', { 'data-unread': props.unreadNotifications }, 'shell') }));
vi.mock('../src/design/EnvironmentRibbon', () => ({ EnvironmentRibbon: () => createElement('p', null, 'Synthetic environment') }));

import RootLayout from './layout';

describe('the application shell notification count', () => {
  const session = { sessionId: 'synthetic-session', userId: 'synthetic-auditor', expiresAt: '2030-01-01T00:00:00.000Z' };
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.identity.mockResolvedValue({ kind: 'identified', role: 'auditor', session });
    mocks.count.mockResolvedValue(137);
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
