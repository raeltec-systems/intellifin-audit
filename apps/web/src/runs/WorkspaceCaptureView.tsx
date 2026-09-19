'use client';

import { useEffect, useState, type ReactNode } from 'react';
import './WorkspaceCaptureView.css';

/** Presentation only: the server supplies the same protected, registered evidence stage. */
export function WorkspaceCaptureView({ hasCapture, children }: {
  readonly hasCapture: boolean;
  readonly children: ReactNode;
}): React.JSX.Element {
  const [native, setNative] = useState(false);
  const [ready, setReady] = useState(false);
  useEffect(() => { setReady(true); }, []);
  return <div className="workspace-capture-view">
    {hasCapture && <>
      <div className="workspace-capture-view__controls" role="group" aria-label="Capture size">
        <button type="button" disabled={!ready} aria-pressed={!native} onClick={() => setNative(false)}>Fit capture</button>
        <button type="button" disabled={!ready} aria-pressed={native} onClick={() => setNative(true)}>Native size</button>
      </div>
      <p className="ls-caption">{native ? 'Original image size. Focus the capture and use arrow keys to pan.' : 'Fit view may shrink text. Choose Native size to read the original pixels.'}</p>
    </>}
    <div className={`workspace-capture-view__viewport${native ? ' workspace-capture-view__viewport--native' : ''}`}
      role="region" aria-label="Protected capture image" tabIndex={0}>
      {children}
    </div>
  </div>;
}
