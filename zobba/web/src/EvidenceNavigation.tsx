import { createContext } from 'react';
import type { AccessError } from './auth';
import type { Scope } from './engagements';
import type { CitedLocation } from './citation';

export interface EvidenceReference {
  scope: Scope;
  evidenceId: string;
  version: string;
  sha256: string;
  /** Cited location to show when opened from a citation. Navigation never
   * changes the original: it only points the viewer at a place in it. */
  location?: CitedLocation;
}

export interface EvidenceNavigationValue {
  open: (reference: EvidenceReference, opener: HTMLButtonElement, onSourceAccessFailure: (error: AccessError) => void) => void;
}

/** Navigation changes the inspected original, never the engagement or Task
 * that owns the conversation, drafts, and independently authorized knowledge. */
export const EvidenceNavigation = createContext<EvidenceNavigationValue | null>(null);
