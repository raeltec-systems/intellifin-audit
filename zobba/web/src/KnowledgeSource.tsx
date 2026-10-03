import { useContext, useRef, useState } from 'react';
import { EvidenceNavigation } from './EvidenceNavigation';
import { EvidenceSourceInspector } from './EvidenceSourceInspector';
import type { EvidenceSourceInspectorProps } from './EvidenceSourceInspector';

/** Keep inline inspection available while sharing exact source navigation with
 * the current library. Neither action changes the conversation's owner. */
export function KnowledgeSource(props: Omit<EvidenceSourceInspectorProps, 'onClose'>) {
  const [open, setOpen] = useState(false);
  const navigation = useContext(EvidenceNavigation);
  const toggle = useRef<HTMLButtonElement>(null);
  function close() { setOpen(false); requestAnimationFrame(() => { if (toggle.current?.getClientRects().length) toggle.current.focus({ preventScroll: true }); }); }
  return <section className="knowledge-source" aria-label={`Original source ${props.evidenceId}`}>
    <button ref={toggle} type="button" className="text-button" aria-expanded={open} disabled={!props.accessReady && !open} onClick={() => open ? close() : setOpen(true)}>{open ? 'Close original source' : 'Inspect original source'}</button>
    {navigation ? <button type="button" className="text-button" disabled={!props.accessReady} onClick={event => navigation.open({ scope: props.scope, evidenceId: props.evidenceId, version: props.version, sha256: props.sha256 }, event.currentTarget, props.onSourceAccessFailure)}>Open in evidence library</button> : null}
    {open ? <EvidenceSourceInspector {...props} /> : null}
  </section>;
}
