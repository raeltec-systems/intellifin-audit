import type { JsonValue } from '@intellifin/domain';

export type AuthoringSection = { readonly kind: 'objective' } | { readonly kind: 'scope' } | { readonly kind: 'instructions'; readonly registrationId: string };
export interface AuthoringDraftFields {
  readonly procedureId: string; readonly versionId: string; readonly expectedRowVersion: string;
  readonly requestId: string; readonly section: AuthoringSection;
  readonly mode: 'draft' | 'improve' | 'revise'; readonly notes: string; readonly changes: string;
}
export interface AcceptAuthoringFields {
  readonly procedureId: string; readonly versionId: string; readonly expectedRowVersion: string;
  readonly requestId: string; readonly replacement: string;
}
export interface RejectAuthoringFields { readonly procedureId: string; readonly versionId: string; readonly requestId: string }
export interface AuthoringProposal { readonly proposedText: string | null; readonly clarifications: readonly string[] }
export interface AuthoringSuggestionView extends AuthoringProposal {
  readonly requestId: string; readonly section: AuthoringSection; readonly currentText: string;
  readonly state: 'pending' | 'ready' | 'failed' | 'accepted' | 'rejected';
  readonly authoringRevision: number; readonly stale: boolean; readonly message: string | null;
}
export const AUTHORING_IDENTITY = { provider: 'openai', modelId: 'gpt-5.6-terra', promptVersion: 'guided-prose-v1' } as const;
export const AUTHORING_LIMITS = { notes: 8000, changes: 2000, contextBytes: 64000, outputText: 10000, outputTokens: 6144, timeoutMs: 30000, perMinute: 6, perHour: 30, lifetimeMs: 600000 } as const;
export interface AuthoringUsage { readonly inputTokens: number | null; readonly outputTokens: number | null }
/** One prose operation, with no tools, plan-generation or autonomous-write capability. */
export interface ProcedureAuthoringModel {
  readonly identity: typeof AUTHORING_IDENTITY;
  propose(input: { readonly section: AuthoringSection; readonly mode: AuthoringDraftFields['mode']; readonly context: JsonValue; readonly currentText: string; readonly notes: string; readonly changes: string }): Promise<{ readonly proposal: unknown; readonly usage: AuthoringUsage }>;
}
export interface AuthoringRequestRecord extends AuthoringProposal {
  readonly requestId: string; readonly procedureId: string; readonly versionId: string; readonly actorId: string;
  readonly createdAt: string; readonly expiresAt: string; readonly section: AuthoringSection;
  readonly requestDigest: string; readonly authoringRevision: number; readonly contextDigest: string; readonly sectionBasis: string; readonly decisionDigest: string;
  readonly currentText: string; readonly state: AuthoringSuggestionView['state'];
  readonly identity: typeof AUTHORING_IDENTITY; readonly usage: AuthoringUsage | null; readonly message: string | null;
  readonly acceptedDigest: string | null;
}
/** Bound to the same transaction as the existing Procedure writer and audit appender. */
export interface ProcedureAuthoringStore {
  find(requestId: string): Promise<AuthoringRequestRecord | null>;
  countSince(actorId: string, since: string): Promise<number>;
  insert(record: AuthoringRequestRecord): Promise<void>;
  update(record: AuthoringRequestRecord): Promise<void>;
}
