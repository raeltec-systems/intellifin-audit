'use client';

import { useState, type ReactNode } from 'react';

import { RunControlReadProvider, type RunControlView } from './RunControllerLease';

/**
 * One Run-controller read shared by a surface whose Pause / Resume control and controller
 * panel are rendered APART.
 *
 * Live View's header carries Pause / Resume, Cancel and Flag as one row (UI cleanup
 * 2026-09-22, UX-48); the controller panel — who holds control, acquire, release — would
 * turn that row into a stack, so it sits at the top of the rail beside the screen instead.
 * `RunPauseControls` with `showController={false}` reads the controller from here, and the
 * one `RunControllerLease` below publishes into it, exactly as the Auditor Workspace does.
 * One read, so the two cannot disagree about who holds control.
 */
export function SharedRunControl({ children }: { readonly children: ReactNode }): React.JSX.Element {
  const [read, publish] = useState<RunControlView>(null);
  return <RunControlReadProvider value={{ read, publish }}>{children}</RunControlReadProvider>;
}
