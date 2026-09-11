import type { JsonValue } from '@intellifin/domain';

export type AuthoringSection = { readonly kind: 'objective' } | { readonly kind: 'scope' } | { readonly kind: 'instructions'; readonly registrationId: string };
export interface AuthoringDraftFields {
  readonly procedureId: string; readonly versionId: string; readonly expectedRowVersion: string;
  readonly requestId: string; readonly section: AuthoringSection;
  readonly mode: 'draft' | 'improve' | 'revise'; readonly notes: string; readonly changes: string;
  /** The auditor's full working proposal, including unsaved edits, for a follow-up. */
  readonly revision?: { readonly requestId: string; readonly draft: string };
}
export interface AcceptAuthoringFields {
  readonly procedureId: string; readonly versionId: string; readonly expectedRowVersion: string;
  readonly requestId: string; readonly replacement: string;
}
export interface RejectAuthoringFields { readonly procedureId: string; readonly versionId: string; readonly requestId: string }
export interface AuthoringProposal { readonly proposedText: string | null; readonly clarifications: readonly string[]; readonly explanation?: string }
export interface AuthoringSuggestionView extends AuthoringProposal {
  readonly requestId: string; readonly section: AuthoringSection; readonly currentText: string;
  readonly state: 'pending' | 'ready' | 'failed' | 'accepted' | 'rejected';
  readonly authoringRevision: number; readonly stale: boolean; readonly message: string | null;
}
export const AUTHORING_IDENTITY = { provider: 'openai', modelId: 'gpt-5.6-terra', promptVersion: 'guided-test-design-v2' } as const;
export type AuthoringIdentity = Omit<typeof AUTHORING_IDENTITY, 'promptVersion'> & { readonly promptVersion: 'guided-prose-v1' | typeof AUTHORING_IDENTITY.promptVersion };
export interface AuthoringRevisionContext {
  readonly draft: string;
  readonly history: readonly { readonly feedback: string; readonly proposedText: string | null; readonly clarifications: readonly string[] }[];
}
export const AUTHORING_LIMITS = { notes: 8000, changes: 2000, contextBytes: 64000, outputText: 10000, outputTokens: 6144, timeoutMs: 30000, perMinute: 6, perHour: 30, lifetimeMs: 600000 } as const;
export interface AuthoringUsage { readonly inputTokens: number | null; readonly outputTokens: number | null }
/** Bounded test preparation, with no tools, executable-plan or autonomous-write capability. */
export interface ProcedureAuthoringModel {
  readonly identity: typeof AUTHORING_IDENTITY;
  /** Synchronous provider-specific input protection, before a receipt is persisted.
   * Implementations with protected configuration must reject it here and in propose. */
  readonly assertSafeInput?: (input: Parameters<ProcedureAuthoringModel['propose']>[0]) => void;
  propose(input: { readonly section: AuthoringSection; readonly mode: AuthoringDraftFields['mode']; readonly context: JsonValue; readonly currentText: string; readonly notes: string; readonly changes: string; readonly revision?: AuthoringRevisionContext }): Promise<{ readonly proposal: unknown; readonly usage: AuthoringUsage }>;
}
export interface AuthoringRequestRecord extends AuthoringProposal {
  readonly requestId: string; readonly procedureId: string; readonly versionId: string; readonly actorId: string;
  readonly createdAt: string; readonly expiresAt: string; readonly section: AuthoringSection;
  readonly requestDigest: string; readonly authoringRevision: number; readonly contextDigest: string; readonly sectionBasis: string; readonly decisionDigest: string;
  readonly currentText: string; readonly state: AuthoringSuggestionView['state'];
  readonly identity: AuthoringIdentity; readonly usage: AuthoringUsage | null; readonly message: string | null;
  /** Bounded feedback retained with the existing receipt, never in the immutable audit chain. */
  readonly revision?: { readonly requestId: string; readonly draft: string; readonly feedback: string };
  readonly acceptedDigest: string | null;
}
/** Bound to the same transaction as the existing Procedure writer and audit appender. */
export interface ProcedureAuthoringStore {
  find(requestId: string): Promise<AuthoringRequestRecord | null>;
  countSince(actorId: string, since: string): Promise<number>;
  insert(record: AuthoringRequestRecord): Promise<void>;
  update(record: AuthoringRequestRecord): Promise<void>;
}
