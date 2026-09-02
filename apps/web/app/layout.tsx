import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';

import { AppShell } from '../src/shell/AppShell';
import { currentIdentity } from '../src/server-session';

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
 * claim, no client control. A request with no session renders bare: that is `/sign-in`
 * (every other path is redirected there by the middleware before it arrives), and a
 * sign-in page wrapped in the application's own navigation would be nonsense.
 */
export default async function RootLayout({
  children,
}: {
  children: ReactNode;
}): Promise<React.JSX.Element> {
  const identity = await currentIdentity();

  return (
    <html lang="en">
      <body>
        {identity ? <AppShell role={identity.role}>{children}</AppShell> : children}
      </body>
    </html>
  );
}
