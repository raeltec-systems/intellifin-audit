import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import { DrizzleNotificationRepository } from '@intellifin/infrastructure';

import { AppShell } from '../src/shell/AppShell';
import { EnvironmentRibbon } from '../src/design/EnvironmentRibbon';
import { currentIdentity } from '../src/server-session';
import { getRuntime } from '../src/bootstrap';

import './tokens.css';
import './globals.css';

export const metadata: Metadata = {
  title: 'IntelliFin Audit',
  description: 'Audit execution platform',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
};

/**
 * The role is resolved per request and never cached (AD-7), so this layout cannot be
 * static. Rendering it once would freeze one person's nav into every other person's
 * page.
 */
export const dynamic = 'force-dynamic';

/**
 * The composition point of the shell.
 *
 * The role reaches `AppShell` from the session and from nowhere else — no cookie, no
 * claim, no client control.
 *
 * Three branches, and the ribbon is in all three. A request with no session renders
 * without the navigation — that is `/sign-in`, since every other path is redirected
 * there by the middleware before it arrives, and a sign-in page wrapped in the
 * application's own navigation would offer links nobody signed in can follow — but it
 * still carries the environment ribbon, because the first page a person sees is the
 * one that most needs to say what this deployment is. A request whose identity could
 * not be resolved renders the whole shell with no role at all: a platform failure
 * removes privilege, it never removes the disclaimer.
 */
export default async function RootLayout({
  children,
}: {
  children: ReactNode;
}): Promise<React.JSX.Element> {
  const identity = await currentIdentity();
  let unreadNotifications: number | undefined;
  if (identity.kind === 'identified') {
    const runtime = await getRuntime();
    try {
      unreadNotifications = await new DrizzleNotificationRepository(runtime.db).countOpenFor(identity.session);
    } catch {
      // A missing count is not zero, and a notification read failure must not remove
      // the auditor's shell or imply that no Run needs attention.
      runtime.telemetry.captureError('Notification count could not be read', new Error('notification-count-query-failed'), { outcome: 'failure' });
    }
  }

  return (
    <html lang="en">
      <body>
        {identity.kind === 'anonymous' ? (
          <>
            <EnvironmentRibbon />
            {children}
          </>
        ) : (
          <AppShell role={identity.kind === 'identified' ? identity.role : null} unreadNotifications={unreadNotifications}>
            {children}
          </AppShell>
        )}
      </body>
    </html>
  );
}
