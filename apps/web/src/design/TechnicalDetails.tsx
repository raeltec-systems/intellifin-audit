import type { ReactNode } from 'react';

/** The one label every technical disclosure carries, so a reader learns it once. */
export const TECHNICAL_DETAILS_LABEL = 'Technical details';

export interface TechnicalItem {
  readonly label: string;
  readonly value: ReactNode;
  /** Identifiers, digests and ISO instants are monospace (EXPERIENCE.md → Formats). */
  readonly mono?: boolean;
}

/**
 * Where an identifier, a digest, an exact instant or a plan-step id goes when a person
 * does not need it to do their job (UI cleanup 2026-09-21, UX-02, UX-20, UX-24, UX-28).
 *
 * Nothing is deleted: the walkthrough's rule is "move implementation detail into
 * deliberate technical views instead of deleting useful provenance". A native `<details>`
 * works before hydration and with no JavaScript at all, which is the standing rule for a
 * disclosure here; it starts closed, so the ordinary reading of a surface never meets a
 * UUID first.
 */
export function TechnicalDetails({
  items = [],
  summary = TECHNICAL_DETAILS_LABEL,
  children,
}: {
  readonly items?: readonly TechnicalItem[];
  readonly summary?: string;
  readonly children?: ReactNode;
}): React.JSX.Element {
  return (
    <details className="ls-disclosure ls-technical">
      <summary>{summary}</summary>
      <div className="ls-disclosure__body ls-technical__body">
        {items.length === 0 ? null : (
          <dl className="ls-definition">
            {items.map((item) => (
              <div key={item.label}>
                <dt>{item.label}</dt>
                <dd className={item.mono ? 'ls-mono' : undefined}>{item.value}</dd>
              </div>
            ))}
          </dl>
        )}
        {children}
      </div>
    </details>
  );
}
