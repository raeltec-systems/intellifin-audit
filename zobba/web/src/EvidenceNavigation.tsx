import { createContext } from 'react';
import type { AccessError } from './auth';
import type { Scope } from './engagements';

export interface EvidenceReference {
  scope: Scope;
  evidenceId: string;
  version: string;
  sha256: string;
}

export interface EvidenceNavigationValue {
  open: (reference: EvidenceReference, opener: HTMLButtonElement, onSourceAccessFailure: (error: AccessError) => void) => void;
}

/** Navigation changes the inspected original, never the engagement or Task
 * that owns the conversation, drafts, and independently authorized knowledge. */
export const EvidenceNavigation = createContext<EvidenceNavigationValue | null>(null);
