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
/** Display-only partial output. It is never an applicable suggestion or a receipt. */
export interface AuthoringProgress { readonly explanation: string; readonly proposedText: string | null; readonly clarification: string | null }
export function isAuthoringProgress(value: unknown): value is AuthoringProgress {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const v = value as Record<string, unknown>;
  return Object.keys(v).length === 3 && typeof v['explanation'] === 'string' && v['explanation'].length <= 2000
    && (v['proposedText'] === null || typeof v['proposedText'] === 'string' && v['proposedText'].length <= 10000)
    && (v['clarification'] === null || typeof v['clarification'] === 'string' && v['clarification'].length <= 1000);
}
export interface AuthoringSuggestionView extends AuthoringProposal {
  readonly requestId: string; readonly section: AuthoringSection; readonly currentText: string;
  readonly state: 'pending' | 'ready' | 'failed' | 'accepted' | 'rejected';
  readonly authoringRevision: number; readonly stale: boolean; readonly message: string | null;
}
export const AUTHORING_IDENTITY = { provider: 'openai', modelId: 'gpt-5.6-terra', promptVersion: 'guided-dialogue-v3' } as const;
export type AuthoringIdentity = Omit<typeof AUTHORING_IDENTITY, 'promptVersion'> & { readonly promptVersion: 'guided-prose-v1' | 'guided-test-design-v2' | typeof AUTHORING_IDENTITY.promptVersion };
export interface AuthoringRevisionContext {
  readonly draft: string;
  readonly history: readonly { readonly feedback: string; readonly proposedText: string | null; readonly clarifications: readonly string[] }[];
}
export const AUTHORING_LIMITS = { notes: 8000, changes: 2000, contextBytes: 64000, outputText: 10000, outputTokens: 6144, timeoutMs: 30000, perMinute: 6, perHour: 30, lifetimeMs: 600000 } as const;
export interface AuthoringUsage { readonly inputTokens: number | null; readonly outputTokens: number | null }
/** Closed operational categories: never carry a provider body, prompt or credential. */
export type AuthoringProviderFailure = 'AUTHENTICATION' | 'ACCESS' | 'REQUEST' | 'RATE_LIMIT' | 'TIMEOUT' | 'UNAVAILABLE' | 'UNCONFIRMED';
export class AuthoringProviderError extends Error {
  override readonly name = 'AuthoringProviderError';
  constructor(readonly code: AuthoringProviderFailure) {
    super('The writing provider did not return a confirmed response');
  }
}
export const AUTHORING_FAILURE_MESSAGES: Record<AuthoringProviderFailure, string> = {
  AUTHENTICATION: 'OpenAI could not authenticate writing assistance. Ask the administrator to check the authoring API key. Your procedure is unchanged.',
  ACCESS: 'OpenAI refused access to the configured authoring model. Ask the administrator to check the authoring configuration and model access. Your procedure is unchanged.',
  REQUEST: 'OpenAI rejected the authoring request configuration. Ask the administrator to check writing assistance. Your procedure is unchanged.',
  RATE_LIMIT: 'Writing assistance reached an OpenAI usage or rate limit. Try later, or ask the administrator to check the authoring account. Your procedure is unchanged.',
  TIMEOUT: 'Writing assistance took too long to respond. Your procedure is unchanged. Try again or keep writing manually.',
  UNAVAILABLE: 'OpenAI is currently unavailable to writing assistance. Your procedure is unchanged. Try again or keep writing manually.',
  UNCONFIRMED: 'Writing assistance could not produce a confirmed draft. Your procedure is unchanged. Try again or keep writing manually.',
};
/** Bounded test preparation, with no tools, executable-plan or autonomous-write capability. */
export interface ProcedureAuthoringModel {
  readonly identity: typeof AUTHORING_IDENTITY;
  /** Synchronous provider-specific input protection, before a receipt is persisted.
   * Implementations with protected configuration must reject it here and in propose. */
  readonly assertSafeInput?: (input: Parameters<ProcedureAuthoringModel['propose']>[0]) => void;
  propose(input: { readonly section: AuthoringSection; readonly mode: AuthoringDraftFields['mode']; readonly context: JsonValue; readonly currentText: string; readonly notes: string; readonly changes: string; readonly revision?: AuthoringRevisionContext }, onProgress?: (progress: AuthoringProgress) => Promise<void> | void): Promise<{ readonly proposal: unknown; readonly usage: AuthoringUsage }>;
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
