'use client';

import { Banner } from '../design/Banner';
import { Button } from '../design/Button';

export const UNKNOWN_SAVE_OUTCOME = 'The save response was lost. The change may have been saved. Reload to review the saved version before trying again.';

export function UnknownSaveOutcome({ visible }: { readonly visible: boolean }): React.JSX.Element | null {
  return visible ? <div className="ls-stack"><Banner tone="warning" title={UNKNOWN_SAVE_OUTCOME} /><Button type="button" onClick={() => window.location.reload()}>Reload saved version</Button></div> : null;
}
