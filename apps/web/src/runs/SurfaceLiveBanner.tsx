'use client';

import type { ComponentProps } from 'react';

import { LiveBanner } from './LiveBanner';
import { refreshesSurface } from './refresh-events';

/**
 * The live banner a server-rendered Run surface mounts: Run Detail's frame and the Runs
 * list (Story 10.7 review).
 *
 * It is `LiveBanner` with the Run surfaces' re-read filter (`refreshesSurface`), which
 * skips the three internal event families no surface renders. The filter is applied HERE,
 * on the client, because both callers are server components and a server component cannot
 * hand a function to a client one. Every other prop is the caller's, unchanged.
 */
export function SurfaceLiveBanner(props: Omit<ComponentProps<typeof LiveBanner>, 'refreshOn'>): React.JSX.Element {
  return <LiveBanner {...props} refreshOn={(event) => refreshesSurface(event.eventType)} />;
}
