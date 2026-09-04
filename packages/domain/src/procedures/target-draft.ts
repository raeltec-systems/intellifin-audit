import { canonicalJson, type JsonValue } from '../canonical-json.js';
import {
  MUTATING_VERBS,
  isTargetSystemKind,
  registrationDigest,
  registrationDigestEnvelope,
  type PermittedReadAction,
  type RegistrationDigestEnvelope,
  type RegistrationDigestInput,
  type TargetSystemKind,
} from '../registrations/target-system.js';
import { findProcedureTemplate, type TemplateId } from './templates.js';

/**
 * Target System selection and per-system Audit Instructions for a Draft Procedure
 * Version (FR-7, FR-8, AD-2).
 *
 * A Procedure Version freezes, per selected Target System, the exact six-field contract
 * the registration digest is taken over — its kind, its allowed origins (or the desktop
 * application identity in that same slot), its credential reference, its permitted read
 * actions, its attribute label patterns and its secondary key — together with the
 * registration's id, its display name and its stored digest. The freezing mechanism is
 * Story 1.6's `registrationDigestEnvelope`/`registrationDigest`, imported and NOT
 * recomputed here, the same way `population-draft.ts` reuses the binding digest: a second
 * implementation would eventually disagree with the one this codebase already has.
 *
 * The scope-widening check is FR-8's authoring-time advisory. It is a PURE domain
 * function: given the instruction text and the systems the Draft has selected, it names
 * the write verb, the out-of-scope origin, or the unregistered system that would widen
 * the agent's reach. It NEVER refuses a save and is NEVER a submission blocker — the
 * enforced control is execution-time denial, a later epic. The runtime code that raises
 * these warnings cannot import the golden fixture that seeds SW-1/SW-2/SW-3 (AD-12); the
 * fixture is data, this is code, and they meet only in a test.
 */

/** The kinds that are agent-driven, and so carry Audit Instructions (FR-7). */
export const AGENT_DRIVEN_KINDS = ['web', 'desktop'] as const satisfies readonly TargetSystemKind[];

/** `true` when a Target System of this kind is driven by the agent and takes instructions. */
export function isAgentDrivenKind(kind: TargetSystemKind): boolean {
  return (AGENT_DRIVEN_KINDS as readonly TargetSystemKind[]).includes(kind);
}

/** Bounds applied before anything else looks at a value. */
export const TARGET_DRAFT_LIMITS = {
  /** How many Target Systems one Draft may select. */
  targets: 32,
  /** How many characters one system's Audit Instructions may hold. */
  instruction: 10000,
} as const;

/**
 * A frozen snapshot of one selected Target System registration.
 *
 * `contract` is the exact six-key envelope AD-2 hashes — including `credential_ref`, which
 * the version freezes and the surface displays but which no audit payload ever carries.
 * `digest` is the value the registration stored; `isProcedureTargetSnapshot` recomputes it
 * from `contract` and refuses a snapshot whose two halves disagree.
 */
export interface ProcedureTargetSnapshot {
  readonly registrationId: string;
  readonly displayName: string;
  readonly digest: string;
  readonly contract: RegistrationDigestEnvelope;
}

/** One system's Audit Instructions, stored verbatim, keyed by the registration it belongs to. */
export interface TargetInstruction {
  readonly registrationId: string;
  readonly text: string;
}

/** The Draft's Target System selection and its per-system Audit Instructions. */
export interface DraftTargetFields {
  /** An ordered selection with unique registration ids. */
  readonly targets: readonly ProcedureTargetSnapshot[];
  /** Verbatim, one per agent-driven selected system; never for an API or file system. */
  readonly instructions: readonly TargetInstruction[];
}

/**
 * Completeness diagnostics for the Target System section (FR-7).
 *
 * These are distinct from the advisory scope warnings: a missing selection, or missing
 * web/desktop coverage for a Template that names both, is a gap in the Draft, surfaced so
 * the auditor can fill it — the same class of value as `populationBlockers`. It is derived
 * from the Template and the current selection, so it is computed on read rather than
 * stored.
 */
export type TargetBlocker = 'targets-missing' | 'web-coverage-missing' | 'desktop-coverage-missing';

export const TARGET_DRAFT_MESSAGES = {
  SELECTION: 'Choose one or more registered Target Systems.',
  DUPLICATE: 'A Target System can be selected only once.',
  UNSEEN:
    'That Target System changed since this page was loaded. Reload the page and try again.',
  INELIGIBLE: 'That Target System is not available. Choose an active registration.',
  RETAIN_UNKNOWN: 'That saved Target System is no longer part of this Draft.',
  ORPHAN_INSTRUCTION:
    'An instruction names a Target System that is not selected, or one that takes no agent instructions.',
  INSTRUCTION_TOO_LONG: 'Those Audit Instructions are longer than this field allows.',
  NOT_STORABLE: 'That value contains a character this system cannot store.',
} as const;

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function exact(value: Record<string, unknown>, keys: readonly string[]): boolean {
  return Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}

function storable(value: unknown): boolean {
  try {
    canonicalJson(value as JsonValue);
    return true;
  } catch {
    return false;
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const SHA256 = /^[0-9a-f]{64}$/;

/**
 * Reconstruct the digest input from a stored envelope.
 *
 * The projection is reversible: for a desktop system the application identity occupies the
 * `allowed_origins` slot as a one-element list, and for every other kind that slot holds
 * the origins. `secondary_key` is `null` for "no secondary key" and reads back as the
 * empty string.
 */
function inputFromEnvelope(envelope: RegistrationDigestEnvelope): RegistrationDigestInput {
  const isDesktop = envelope.kind === 'desktop';
  return {
    kind: envelope.kind,
    allowedOrigins: isDesktop ? [] : envelope.allowed_origins,
    applicationIdentity: isDesktop ? (envelope.allowed_origins[0] ?? '') : '',
    credentialRef: envelope.credential_ref,
    permittedActions: envelope.permitted_actions,
    attributeLabelPatterns: envelope.attribute_label_patterns,
    secondaryKey: envelope.secondary_key ?? '',
  };
}

/** `true` when `value` is a well-formed six-key envelope whose stored digest matches it. */
export function isProcedureTargetSnapshot(value: unknown): value is ProcedureTargetSnapshot {
  if (
    !object(value) ||
    !exact(value, ['registrationId', 'displayName', 'digest', 'contract']) ||
    typeof value['registrationId'] !== 'string' ||
    !UUID.test(value['registrationId']) ||
    typeof value['displayName'] !== 'string' ||
    value['displayName'].trim() === '' ||
    value['displayName'].length > 200 ||
    typeof value['digest'] !== 'string' ||
    !SHA256.test(value['digest'])
  ) {
    return false;
  }
  const contract = value['contract'];
  if (
    !object(contract) ||
    !exact(contract, [
      'allowed_origins',
      'attribute_label_patterns',
      'credential_ref',
      'kind',
      'permitted_actions',
      'secondary_key',
    ]) ||
    !isTargetSystemKind(contract['kind']) ||
    typeof contract['credential_ref'] !== 'string' ||
    !(contract['secondary_key'] === null || typeof contract['secondary_key'] === 'string') ||
    !isStringArray(contract['allowed_origins']) ||
    !isStringArray(contract['attribute_label_patterns']) ||
    !isStringArray(contract['permitted_actions'])
  ) {
    return false;
  }
  // Recompute the envelope and the digest from the reconstructed input, then require the
  // stored value to equal them byte for byte. A snapshot whose contract was tampered with,
  // or whose digest was copied from another registration, fails here and reads as nothing.
  const envelope = value as unknown as { contract: RegistrationDigestEnvelope; digest: string };
  const input = inputFromEnvelope(envelope.contract);
  try {
    return (
      storable(value) &&
      canonicalJson(contract as JsonValue) ===
        canonicalJson(registrationDigestEnvelope(input) as unknown as JsonValue) &&
      registrationDigest(input) === envelope.digest
    );
  } catch {
    return false;
  }
}

function isStringArray(value: unknown): value is readonly string[] {
  return Array.isArray(value) && value.every((entry) => typeof entry === 'string');
}

/** `true` when `value` is a per-system instruction with a non-blank, storable, bounded text. */
export function isTargetInstruction(value: unknown): value is TargetInstruction {
  return (
    object(value) &&
    exact(value, ['registrationId', 'text']) &&
    typeof value['registrationId'] === 'string' &&
    UUID.test(value['registrationId']) &&
    typeof value['text'] === 'string' &&
    value['text'].trim() !== '' &&
    value['text'].length <= TARGET_DRAFT_LIMITS.instruction &&
    storable(value['text'])
  );
}

/** The empty selection every new Draft starts with; the auditor selects explicitly. */
export function initialDraftTargets(): DraftTargetFields {
  return { targets: [], instructions: [] };
}

/**
 * Validate the stored target fields as a whole.
 *
 * Every snapshot is well-formed, the selection is unique, and every instruction names a
 * SELECTED, agent-driven system — an instruction for an unselected system or for an API or
 * file system is an orphan the row must not carry. A row that fails this reads as nothing,
 * the same rule the repository applies to the population fields.
 */
export function isDraftTargetFields(value: DraftTargetFields): boolean {
  if (!Array.isArray(value.targets) || value.targets.length > TARGET_DRAFT_LIMITS.targets) {
    return false;
  }
  if (!value.targets.every(isProcedureTargetSnapshot)) return false;
  const byId = new Map<string, ProcedureTargetSnapshot>();
  for (const target of value.targets) {
    if (byId.has(target.registrationId)) return false;
    byId.set(target.registrationId, target);
  }
  if (!Array.isArray(value.instructions) || value.instructions.length > TARGET_DRAFT_LIMITS.targets) {
    return false;
  }
  if (!value.instructions.every(isTargetInstruction)) return false;
  const seen = new Set<string>();
  for (const instruction of value.instructions) {
    if (seen.has(instruction.registrationId)) return false;
    seen.add(instruction.registrationId);
    const target = byId.get(instruction.registrationId);
    if (target === undefined || !isAgentDrivenKind(target.contract.kind)) return false;
  }
  return true;
}

/**
 * The Template's default Target Systems, offered to the auditor by name.
 *
 * The kinds are what drive the P-1 coverage diagnostic below. Selection is never
 * automatic — a registration is never minted from a Template, and an unavailable or
 * ambiguous match is chosen explicitly — so these are guidance, not a stored selection.
 */
export function defaultTargetsFor(
  templateId: TemplateId,
): readonly { readonly name: string; readonly kind: TargetSystemKind }[] {
  return findProcedureTemplate(templateId).defaultTargets;
}

/**
 * Completeness diagnostics for the selection, derived from the Template and the targets.
 *
 * `targets-missing` when nothing is selected; then, for a Template that names agent-driven
 * coverage (P-1 names web AND desktop), a `*-coverage-missing` diagnostic for each such
 * kind the selection does not cover. API and file systems are adapter-acquired and never
 * required here.
 */
export function targetBlockersFor(
  templateId: TemplateId,
  targets: readonly ProcedureTargetSnapshot[],
): readonly TargetBlocker[] {
  const blockers: TargetBlocker[] = [];
  if (targets.length === 0) blockers.push('targets-missing');
  const selectedKinds = new Set(targets.map((target) => target.contract.kind));
  const requiredKinds = new Set(
    defaultTargetsFor(templateId)
      .map((target) => target.kind)
      .filter(isAgentDrivenKind),
  );
  if (requiredKinds.has('web') && !selectedKinds.has('web')) blockers.push('web-coverage-missing');
  if (requiredKinds.has('desktop') && !selectedKinds.has('desktop')) {
    blockers.push('desktop-coverage-missing');
  }
  return blockers;
}

/** The six fields a registration holds, as the reader hands them over. */
export interface RegistrationSixFields {
  readonly registrationId: string;
  readonly displayName: string;
  readonly kind: TargetSystemKind;
  readonly allowedOrigins: readonly string[];
  readonly applicationIdentity: string;
  readonly credentialRef: string;
  readonly permittedActions: readonly PermittedReadAction[];
  readonly attributeLabelPatterns: readonly string[];
  readonly secondaryKey: string;
}

/**
 * Build the frozen snapshot from a resolved registration.
 *
 * The digest is RECOMPUTED here through the domain module, so the snapshot is always
 * self-consistent (`isProcedureTargetSnapshot` passes it). The command compares this
 * recomputed digest against the one the surface rendered before it stores anything.
 */
export function snapshotFromRegistration(record: RegistrationSixFields): ProcedureTargetSnapshot {
  const input: RegistrationDigestInput = {
    kind: record.kind,
    allowedOrigins: record.allowedOrigins,
    applicationIdentity: record.applicationIdentity,
    credentialRef: record.credentialRef,
    permittedActions: record.permittedActions,
    attributeLabelPatterns: record.attributeLabelPatterns,
    secondaryKey: record.secondaryKey,
  };
  return {
    registrationId: record.registrationId,
    displayName: record.displayName,
    digest: registrationDigest(input),
    contract: registrationDigestEnvelope(input),
  };
}

/* ---- The scope-widening check (FR-8, advisory) -------------------------------------- */

/**
 * The write verbs the scope check names.
 *
 * `MUTATING_VERBS` is the domain's vocabulary guard — no permitted read action may contain
 * one — and it deliberately omits `disable`, the verb the seeded SW-2 instruction uses,
 * because no permitted action was ever going to be spelled `disable`. The scope check needs
 * the fuller list, so it takes `MUTATING_VERBS` and adds the write verbs an auditor might
 * actually type. Matching is whole-word, so `disable` flags "disable it" and NOT the
 * read-only status label "disabled" — the false-positive the acceptance criterion forbids.
 */
export const SCOPE_WRITE_VERBS = [
  ...MUTATING_VERBS,
  'disable',
  'enable',
  'deactivate',
  'activate',
  'revoke',
  'reset',
  'grant',
] as const;

export type ScopeWarningKind = 'write-verb' | 'out-of-scope-origin' | 'unregistered-system';

export interface ScopeWarning {
  readonly kind: ScopeWarningKind;
  /** The offending verb, origin, or system name, named so the auditor can find it. */
  readonly offending: string;
  /** A full sentence naming it, for the inline advisory. */
  readonly message: string;
}

/** One selected system, as the scope check reads it. */
export interface ScopeCheckSystem {
  readonly displayName: string;
  readonly kind: TargetSystemKind;
  /** The web origins this system allows; empty for a desktop system. */
  readonly allowedOrigins: readonly string[];
}

interface ParsedOrigin {
  readonly authority: string;
  readonly path: string;
}

/** Split `scheme://authority/path` into a lower-cased authority and a path, or `null`. */
function parseOrigin(raw: string): ParsedOrigin | null {
  const match = /^(https?):\/\/([^/?#\s]+)([^?#\s]*)/i.exec(raw);
  if (match === null) return null;
  const scheme = (match[1] ?? '').toLowerCase();
  const host = (match[2] ?? '').toLowerCase();
  let path = match[3] ?? '';
  // Drop a single trailing slash so `/loancore` and `/loancore/` compare equal.
  if (path.endsWith('/') && path !== '/') path = path.slice(0, -1);
  return { authority: `${scheme}://${host}`, path };
}

/** `true` when `candidate` is the allowed origin or a path-segment under it. */
function originInScope(candidate: ParsedOrigin, allowed: ParsedOrigin): boolean {
  if (candidate.authority !== allowed.authority) return false;
  // An authority-only allowlist (`https://host` or `https://host/`) admits any path under
  // it. Otherwise the candidate path must equal the allowed path or be a segment under it:
  // `/loancore/accounts` is inside `/loancore`, and `/loancore-other` is NOT.
  if (allowed.path === '' || allowed.path === '/') return true;
  return candidate.path === allowed.path || candidate.path.startsWith(`${allowed.path}/`);
}

/**
 * A word matching an internal-caps compound — LoanCore, PayrollVault, LedgerDesk — which
 * is how the synthetic Northstar systems are named. A generic phrase like "Target System"
 * is two ordinary words and matches nothing here.
 */
const SYSTEM_TOKEN = /\b[A-Z][a-z0-9]+(?:[A-Z][a-z0-9]+)+\b/g;

/** The RFC-3986-ish http(s) URLs in free text, trailing sentence punctuation trimmed. */
const URL_TOKEN = /\bhttps?:\/\/[^\s"'<>)\]]+/gi;

function trimTrailingPunctuation(url: string): string {
  return url.replace(/[.,;:!?)\]]+$/, '');
}

/** `true` when `word` occurs as a whole word in `text`, case-insensitively. */
function containsWord(text: string, word: string): boolean {
  return new RegExp(`\\b${word}\\b`, 'i').test(text);
}

/**
 * The advisory scope-widening warnings for one system's Audit Instructions (FR-8).
 *
 * Deterministic and pure. It names, in order: every write verb the text contains (SW-2),
 * every http(s) origin outside the selected systems' allowlists (SW-3), and every
 * system-named token that is not one of the selected systems (SW-1). It returns an empty
 * array for the permitted Template instructions, whose read-only status labels ("status",
 * "disabled") match no write verb. It NEVER refuses and is NEVER a blocker.
 */
export function scopeWideningWarnings(
  text: string,
  systems: readonly ScopeCheckSystem[],
): readonly ScopeWarning[] {
  const warnings: ScopeWarning[] = [];

  // SW-2 — write verb. Deduplicated by the base verb, in vocabulary order.
  for (const verb of SCOPE_WRITE_VERBS) {
    if (containsWord(text, verb)) {
      warnings.push({
        kind: 'write-verb',
        offending: verb,
        message: `This instruction uses the write action "${verb}", which an audit credential cannot perform.`,
      });
    }
  }

  // SW-3 — out-of-scope origin. In scope when it is under any selected system's allowlist.
  const allowed = systems
    .flatMap((system) => (system.kind === 'desktop' ? [] : system.allowedOrigins))
    .map(parseOrigin)
    .filter((origin): origin is ParsedOrigin => origin !== null);
  const seenOrigins = new Set<string>();
  for (const match of text.matchAll(URL_TOKEN)) {
    const raw = trimTrailingPunctuation(match[0]);
    const candidate = parseOrigin(raw);
    if (candidate === null || seenOrigins.has(raw)) continue;
    seenOrigins.add(raw);
    if (!allowed.some((scope) => originInScope(candidate, scope))) {
      warnings.push({
        kind: 'out-of-scope-origin',
        offending: raw,
        message: `This instruction points at ${raw}, which is outside the selected Target Systems' allowed origins.`,
      });
    }
  }

  // SW-1 — unregistered system. A named token is in scope when it appears in a selected
  // system's display name.
  const known = systems.map((system) => system.displayName.toLowerCase());
  const seenTokens = new Set<string>();
  for (const match of text.matchAll(SYSTEM_TOKEN)) {
    const token = match[0];
    const lower = token.toLowerCase();
    if (seenTokens.has(lower)) continue;
    seenTokens.add(lower);
    if (!known.some((name) => name.includes(lower))) {
      warnings.push({
        kind: 'unregistered-system',
        offending: token,
        message: `This instruction names ${token}, which is not a selected Target System.`,
      });
    }
  }

  return warnings;
}
