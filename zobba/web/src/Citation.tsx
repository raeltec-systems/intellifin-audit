import { useContext, useEffect, useId, useRef, useState } from 'react';
import type { AccessError } from './auth';
import type { Scope } from './engagements';
import { EvidenceNavigation } from './EvidenceNavigation';
import { boundedQuote, chipLabel, reasonLabel } from './citation';
import type { CitationSource, UnverifiedReason } from './citation';

interface Props {
  scope: Scope;
  sources: CitationSource[];
  accessReady: boolean;
  onSourceAccessFailure: (error: AccessError) => void;
}

/// A reusable citation chip: the short filename of its first source and `+N`
/// for further sources. Hover or keyboard focus shows a card (WCAG 1.4.13:
/// dismissible with Escape, hoverable, persistent until dismissed or left).
/// Open navigates the evidence viewer to the cited location of the exact
/// original. The card says "unverified" with its closed reason only when a
/// source is unverified; a verified source shows no badge.
export function Citation({ scope, sources, accessReady, onSourceAccessFailure }: Props) {
  const navigation = useContext(EvidenceNavigation);
  const [open, setOpen] = useState(false);
  const chip = useRef<HTMLButtonElement>(null);
  const wrapper = useRef<HTMLSpanElement>(null);
  const closing = useRef<ReturnType<typeof setTimeout> | null>(null);
  const panel = useRef<HTMLSpanElement>(null);
  const card = useId();
  const { label, more } = chipLabel(sources);
  const cancelClose = () => { if (closing.current) { clearTimeout(closing.current); closing.current = null; } };
  const scheduleClose = () => { cancelClose(); closing.current = setTimeout(() => setOpen(false), 200); };
  useEffect(() => cancelClose, []);
  // Keep a shown card inside the scrolled Task details, without moving focus.
  useEffect(() => { if (open) panel.current?.scrollIntoView({ block: 'nearest', inline: 'nearest' }); }, [open]);
  useEffect(() => {
    if (!open) return;
    // Captured first: while the card is shown, Escape dismisses only the card
    // and never also closes the Task details around it.
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
      if (wrapper.current?.contains(document.activeElement)) chip.current?.focus();
    };
    window.addEventListener('keydown', escape, true);
    return () => window.removeEventListener('keydown', escape, true);
  }, [open]);
  const name = `Citation: ${sources.map(source => source.readable && source.filename ? source.filename : 'a source you cannot open').join(', ')}`;
  return <span ref={wrapper} className="citation" onMouseEnter={() => { cancelClose(); setOpen(true); }} onMouseLeave={scheduleClose}
    onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOpen(false); }}>
    <button ref={chip} type="button" className="citation-chip" aria-label={name} aria-expanded={open} aria-controls={card}
      onFocus={() => setOpen(true)} onClick={() => setOpen(true)}>
      <span className="citation-name">{label}</span>{more ? <span className="citation-more" aria-hidden="true">+{more}</span> : null}
    </button>
    <span ref={panel} id={card} role="group" aria-label="Citation sources" className="citation-card" hidden={!open}>
      {sources.map((source, index) => <span key={index} className="citation-source">
        <span className="citation-file">{source.readable && source.filename ? source.filename : 'A source you cannot open'}</span>
        {source.location ? <span className="citation-location">{source.location}</span> : <span className="citation-location">No location given</span>}
        {source.readable && source.quote ? <q className="citation-quote">{boundedQuote(source.quote)}</q> : null}
        {source.verification === 'unverified' ? <span className="citation-unverified">Unverified · {reasonLabel[source.reason as UnverifiedReason]}</span> : null}
        {navigation && source.readable && source.version && source.sha256 ? <button type="button" className="text-button citation-open" disabled={!accessReady}
          onClick={event => {
            const opener = chip.current ?? event.currentTarget;
            setOpen(false);
            navigation.open({
              scope, evidenceId: source.original_id, version: source.version!, sha256: source.sha256!,
              location: source.location ? { label: source.location, byteStart: source.byte_start ?? null, byteEnd: source.byte_end ?? null } : undefined,
            }, opener, onSourceAccessFailure);
          }}>Open{source.location ? ` at ${source.location}` : ''}</button> : null}
      </span>)}
    </span>
  </span>;
}
