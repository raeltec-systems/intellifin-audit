import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  identity: vi.fn(),
  count: vi.fn(),
  open: vi.fn(),
  names: vi.fn(),
  activeRuns: vi.fn(),
  submitted: vi.fn(),
  pendingCount: vi.fn(),
  captureError: vi.fn(),
}));
vi.mock('../src/server-session', () => ({ currentIdentity: mocks.identity }));
vi.mock('../src/bootstrap', () => ({ getRuntime: async () => ({ db: {}, telemetry: { captureError: mocks.captureError } }) }));
vi.mock('@intellifin/infrastructure', () => ({ DrizzleNotificationRepository: class {
  countOpenFor = mocks.count;
  openFor = mocks.open;
}, DrizzleActorNameReader: class {
  namesFor = mocks.names;
}, DrizzleActiveRunCounter: class {
  countActiveRuns = mocks.activeRuns;
}, DrizzleSubmittedVersionReader: class {
  listSubmitted = mocks.submitted;
  listSubmittedFor = mocks.submitted;
}, DrizzlePendingResultReader: class {
  countPendingResults = mocks.pendingCount;
} }));
vi.mock('../src/shell/AppShell', () => ({ AppShell: (props: {
  unreadNotifications?: number;
  signedIn?: { userId: string; names: ReadonlyMap<string, string> };
  counts?: { runs?: number; review?: number };
  openNotifications?: readonly { key: string; title: string }[];
}) =>
  createElement('output', {
    'data-unread': props.unreadNotifications,
    'data-signed-in': props.signedIn?.userId,
    'data-signed-in-name': props.signedIn?.names.get(props.signedIn.userId),
    'data-runs-count': props.counts?.runs,
    'data-review-count': props.counts?.review,
    'data-bell-items': props.openNotifications?.map((item) => item.title).join('|'),
  }, 'shell') }));
vi.mock('../src/design/EnvironmentRibbon', () => ({ EnvironmentRibbon: () => createElement('p', null, 'Synthetic environment') }));

import RootLayout from './layout';

describe('the application shell notification count', () => {
  const session = { sessionId: 'synthetic-session', userId: 'synthetic-auditor', expiresAt: '2030-01-01T00:00:00.000Z' };
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.identity.mockResolvedValue({ kind: 'identified', role: 'auditor', session });
    mocks.count.mockResolvedValue(137);
    mocks.open.mockResolvedValue([]);
    mocks.names.mockResolvedValue(new Map([[session.userId, 'Dana Mwale']]));
    mocks.activeRuns.mockResolvedValue(4);
    mocks.submitted.mockResolvedValue({ rows: [], total: 2 });
    mocks.pendingCount.mockResolvedValue(3);
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
    const reports = mocks.captureError.mock.calls.filter(
      (call) => (call[1] as Error | undefined)?.message === 'notification-count-query-failed',
    );
    expect(reports).toHaveLength(1);
    const reported = reports[0]?.[1] as Error;
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
    mocks.open.mockResolvedValue([]);
    mocks.names.mockResolvedValue(new Map([[session.userId, 'Dana Mwale']]));
    mocks.activeRuns.mockResolvedValue(0);
    mocks.submitted.mockResolvedValue({ rows: [], total: 0 });
    mocks.pendingCount.mockResolvedValue(0);
  });

  it('resolves the session user through the one id-to-name port and hands it to the shell', async () => {
    const html = renderToStaticMarkup(await RootLayout({ children: 'page' }));
    // Twice: the signed-in person, and the actors the bell's own rows name.
    expect(mocks.names).toHaveBeenCalledWith([session.userId]);
    expect(html).toContain('data-signed-in="synthetic-auditor"');
    expect(html).toContain('data-signed-in-name="Dana Mwale"');
  });

  it.each(['anonymous', 'degraded'])('names nobody, and reads no name, for an %s identity', async kind => {
    mocks.identity.mockResolvedValue({ kind });
    const html = renderToStaticMarkup(await RootLayout({ children: 'page' }));
    expect(mocks.names).not.toHaveBeenCalled();
    expect(html).not.toContain('data-signed-in=');
  });
});

/**
 * The sidebar counts and the bell's panel rows (UI cleanup 2026-09-22, UX-32).
 *
 * EXPERIENCE.md → Information Architecture puts a count of ACTIVE Runs on the Runs item
 * and one of items awaiting review on Reviews, and NOTHING supplied either: `SidebarCounts`
 * said so in its own doc comment. The panel, meanwhile, listed one link.
 */
describe('the sidebar counts and the bell panel', () => {
  const session = { sessionId: 'synthetic-session', userId: 'synthetic-auditor', expiresAt: '2030-01-01T00:00:00.000Z' };
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.identity.mockResolvedValue({ kind: 'identified', role: 'auditor', session });
    mocks.count.mockResolvedValue(2);
    mocks.open.mockResolvedValue([]);
    mocks.names.mockResolvedValue(new Map());
    mocks.activeRuns.mockResolvedValue(4);
    mocks.submitted.mockResolvedValue({ rows: [], total: 2 });
    mocks.pendingCount.mockResolvedValue(3);
  });

  it('supplies both counts, each read for a role that holds the action behind it', async () => {
    const html = renderToStaticMarkup(await RootLayout({ children: 'page' }));
    expect(html).toContain('data-runs-count="4"');
    // An Auditor may not approve, so the Reviews count is the assessments waiting for
    // them alone — never a queue they cannot act on.
    expect(html).toContain('data-review-count="3"');
    expect(mocks.submitted).not.toHaveBeenCalled();
  });

  it('adds the two queues for an Audit Manager rather than joining them', async () => {
    mocks.identity.mockResolvedValue({ kind: 'identified', role: 'audit-manager', session });
    const html = renderToStaticMarkup(await RootLayout({ children: 'page' }));
    expect(html).toContain('data-review-count="5"');
  });

  it('reads no Run count for a role the Runs register refuses', async () => {
    mocks.identity.mockResolvedValue({ kind: 'identified', role: 'poc-administrator', session });
    const html = renderToStaticMarkup(await RootLayout({ children: 'page' }));
    expect(mocks.activeRuns).not.toHaveBeenCalled();
    expect(html).not.toContain('data-runs-count');
    // And no review count either: a `0` beside Reviews would say every decision is taken.
    expect(html).not.toContain('data-review-count');
  });

  it('shows no count at all when one cannot be read, never a fabricated zero', async () => {
    mocks.activeRuns.mockRejectedValue(new Error('synthetic private query'));
    mocks.pendingCount.mockRejectedValue(new Error('synthetic private query'));
    const html = renderToStaticMarkup(await RootLayout({ children: 'page' }));
    expect(html).toContain('shell');
    expect(html).not.toContain('data-runs-count');
    expect(html).not.toContain('data-review-count');
  });

  it('hands the bell its open items, worded on the server', async () => {
    mocks.open.mockResolvedValue([
      {
        kind: 'escalation',
        recipientId: session.userId,
        procedureId: 'p',
        versionId: 'v',
        procedureName: 'Terminated Users Retaining Access',
        versionNumber: 3,
        runId: 'r',
        waitId: 'w',
        escalationKind: 'choose-candidate',
        deadline: '2030-01-01T00:00:00.000Z',
      },
    ]);
    const html = renderToStaticMarkup(await RootLayout({ children: 'page' }));
    expect(html).toContain('data-bell-items="Terminated Users Retaining Access"');
  });

  it('leaves the panel with no invented rows when the open read fails', async () => {
    mocks.open.mockRejectedValue(new Error('synthetic private query'));
    const html = renderToStaticMarkup(await RootLayout({ children: 'page' }));
    expect(html).toContain('shell');
    expect(html).not.toContain('data-bell-items');
  });

  it('still names the session, by id, when the name cannot be read', async () => {
    // The shell must not go blank over a cosmetic read: `ActorName` shows the id, which
    // is honest about what is known. The failure is still recorded.
    mocks.names.mockRejectedValue(new Error('synthetic private query'));
    const html = renderToStaticMarkup(await RootLayout({ children: 'page' }));
    expect(html).toContain('data-signed-in="synthetic-auditor"');
    expect(html).not.toContain('data-signed-in-name');
    expect(
      mocks.captureError.mock.calls.filter((call) => call[0] === 'Signed-in name could not be read'),
    ).toHaveLength(1);
  });
});
